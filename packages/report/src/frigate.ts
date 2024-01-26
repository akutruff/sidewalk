
import fs from "fs";
import { mkdir, readdir, stat, rm } from "fs/promises";
import path from "path";
import { writeFile } from 'fs/promises'
import { log } from './logger.js';
import { writeFileAsJson, readFileAsJson } from './serialization.js';
import type { EventDatabase, FrigateEvent, ServiceRequest, ServiceRequestStatus } from './types.js';
import { statusToCode } from './types.js';
import { createInDb, updateDb } from './database.js';
import { getEventPaths, eventBasePath, clipStagingBasePath } from './frigateEvent.js';

const host = new URL(process.env.FRIGATE_URL!);

export function dateToEpochSeconds(date: Date) {
    return Math.floor(date.getTime() / 1000);
}

export async function buildDatabase(db: EventDatabase) {
    await log.clog('building database');
    const eventIds = await getSavedEventIds();

    for (const eventId of eventIds) {
        if (db.events.has(eventId)) {
            continue;
        }
        const paths = getEventPaths(eventId);
        try {
            await log.clog(`${eventId}: indexing`);
            const event = apiReponseToFrigateEvent(await readFileAsJson<FrigateEvent>(paths.frigateClipJson));
            const eventEntry = await readEventEntry(eventId, event);
            db.events.set(eventId, eventEntry);

        } catch (err) {
            await log.cerror(`${eventId}: error loading`, err);
        }
    }
    await log.clog('database built');
    return db;
}

async function readEventEntry(eventId: string, event: FrigateEvent) {
    const paths = getEventPaths(eventId);

    const hasServiceRequest = doesEventAlreadyHaveServiceRequest(eventId);
    let serviceRequest = undefined;
    let hasResolution = false;
    let serviceRequestStatus = undefined;
    if (hasServiceRequest) {
        serviceRequest = await readFileAsJson<ServiceRequest>(paths.serviceRequestJsonPath);
        hasResolution = doesEventAlreadyHaveResolution(eventId);
        serviceRequestStatus = await loadResolution(eventId);
    }

    const eventEntry = {
        event,
        hasResolution,
        serviceRequest,
        serviceRequestStatus
    };

    return eventEntry;
}

let fetchAndSaveFrigateEventsRunning = false;
export async function fetchAndSaveFrigateEvents(db: EventDatabase, eventsAfter: Date, eventsBefore: Date): Promise<FrigateEvent[]> {
    if (fetchAndSaveFrigateEventsRunning) {
        return [];
    }
    fetchAndSaveFrigateEventsRunning = true;

    try {

        const events: FrigateEvent[] = await fetchFrigateEvents(eventsAfter, eventsBefore);

        await log.clog(`events fetched: ${events.length}`);

        for (const event of events) {
            // console.log(event);
            const paths = getEventPaths(event.id);
            if (!db.events.has(event.id)) {
                const eventEntry = await readEventEntry(event.id, event);
                createInDb(db, event.id, eventEntry);
            }
            // again, using actual file instead of db for safety
            if (doesEventAlreadyHaveServiceRequest(event.id)) {
                await log.clog(`${event.id} - ${getNyTime(event.timestamp)}: skipping event with service request`);
                continue;
            }

            if (!fs.existsSync(paths.clipStagingPath)) {
                throw new Error(`${event.id} - ${getNyTime(event.timestamp)}: staging clip not found for ${getNyTime(event.timestamp)}`);
            }

            await log.clog(`downloading event ${event.id} - ${getNyTime(event.timestamp)}`);

            const stagedClipStats = await stat(paths.clipStagingPath);

            let shouldDownload = true;
            if (fs.existsSync(paths.clipPath)) {
                const fetchedClipStats = await stat(paths.clipPath);

                if (fetchedClipStats.size === stagedClipStats.size) {
                    await log.clog(`already downloaded: ${event.id}`);
                    shouldDownload = false;
                }
            }

            if (shouldDownload) {
                await downloadClip(event, paths.eventPath, paths.clipPath);
            }

            const fetchedClipStats = await stat(paths.clipPath);

            const fileSizeInMegabytes = toMegabytes(fetchedClipStats.size);
            await log.clog(`file size: ${fileSizeInMegabytes}MB`);

            if (fetchedClipStats.size !== stagedClipStats.size) {
                throw new Error(`${event.id} - ${getNyTime(event.timestamp)}: clip and staging size mismatch: ${fetchedClipStats.size} !== ${stagedClipStats.size}`);
            }

            //This will just print the file size check.
            await isFileSizeValid(event.id, fileSizeInMegabytes);

            const evResponseJson = await (await fetch(new URL(`api/events/${event.id}`, host))).json() as object;

            await writeFile(paths.frigateClipJson, JSON.stringify(evResponseJson, null, 2));
        }
        await log.clog("downloading events successful.");

        return events;
    } finally {
        fetchAndSaveFrigateEventsRunning = false;
    }
}

export async function cleanStagedClips() {
    const stagedClipDirectories = await getStagedClipDirectories();

    for (const eventId of stagedClipDirectories) {
        const paths = getEventPaths(eventId);
        await log.clog(`deleting ${paths.eventStagingPath}`);
        await rm(paths.eventStagingPath, { recursive: true, force: true });
    }
}

const MAX_FILE_SIZE = 74;
const MIN_FILE_SIZE = 1;
export async function isFileSizeValid(eventId: string, fileSizeInMegabytes: number) {
    if (fileSizeInMegabytes < MIN_FILE_SIZE) {
        await log.cerror(`${eventId}: ERROR:  file size too small: ${fileSizeInMegabytes}MB `);
        return false;
    }

    if (fileSizeInMegabytes > MAX_FILE_SIZE) {
        await log.cerror(`${eventId}: ERROR:  file size too big: ${fileSizeInMegabytes}MB `);
        return false;
    }
    return true;
}

let isStagingFetchRunning = false;
export async function fetchAndSaveFrigateClipsToStaging(eventsAfter: Date, eventsBefore: Date, isDryRun: boolean): Promise<FrigateEvent[]> {
    if (isStagingFetchRunning)
        return [];
    isStagingFetchRunning = true;

    try {
        const events: FrigateEvent[] = await fetchFrigateEvents(eventsAfter, eventsBefore);
        await log.clog(events.length);

        for (const event of events) {
            const paths = getEventPaths(event.id);

            if (fs.existsSync(paths.clipStagingPath) && await isFileSizeValid(event.id, await getFileSizeInMB(event, paths.clipStagingPath))) {
                await log.clog(`${event.id} - ${getNyTime(event.timestamp)}: staging clip already exists`);
                continue;
            }

            await log.clog(`${event.id} - ${getNyTime(event.timestamp)}: downloading staging clip`);
            if (isDryRun) {
                continue;
            }

            await downloadClip(event, paths.eventStagingPath, paths.clipStagingPath);

        }
        await log.clog("downloading staging successful.");
        return events;
    }
    finally {
        isStagingFetchRunning = false;
    }

}

export async function checkOverlapping(eventsAfter: Date, eventsBefore: Date): Promise<FrigateEvent[]> {
    await log.clog(`checking overlapping`);

    const events: FrigateEvent[] = await fetchFrigateEvents(eventsAfter, eventsBefore);
    await log.clog(events.length);

    const eventsToDeleteSet = new Set<FrigateEvent>();
    const eventsToDelete = [];

    for (const event of events) {
        const duration = event.end_time - event.start_time;

        const maxClipLength = 45;
        if (duration >= maxClipLength) {
            await log.clog(`${event.id} - ${getNyTime(event.timestamp)} - duration ${Math.fround(duration)}s too long: `);

            if (!eventsToDeleteSet.has(event)) {
                eventsToDeleteSet.add(event);
                eventsToDelete.push(event);
            }
        }
    }

    for (let i = 1; i < events.length; i++) {
        const current = events[i]!;
        const previous = events[i - 1]!;
        if (current?.start_time >= previous?.start_time && current?.start_time <= previous?.end_time) {
            console.log(previous.start_time, previous.end_time);
            console.log(current.start_time, current.end_time);

            const previousDuration = previous.end_time - previous.start_time;
            const currentDuration = current.end_time - current.start_time;

            const overlapTime = previous?.end_time - current.start_time;
            const percentOverlap = Math.round(overlapTime / currentDuration * 100);

            await log.clog(`${previous.id} - ${getNyTime(previous.timestamp)} overlaps${current.id} - ${getNyTime(current.timestamp)} by ${percentOverlap}% ${previousDuration}s/${currentDuration}s`);

            const maxPercentOverlap = 25;
            if (percentOverlap >= maxPercentOverlap) {
                const eventToDelete = currentDuration > previousDuration ? current : previous;
                if (!eventsToDeleteSet.has(eventToDelete)) {
                    eventsToDeleteSet.add(eventToDelete);
                    eventsToDelete.push(eventToDelete);
                }
            }
        }
    }

    for (const event of eventsToDelete) {
        const url = new URL(`api/events/${event.id}`, host);

        await log.clog(`${event.id} - ${getNyTime(event.timestamp)} deleting`);
        await fetch(url, { method: 'DELETE' });
        await sleep(100);
    }

    await log.clog("done checking overlapping.");
    return eventsToDelete;
}

// function doBoxesIntersect(r1 : BoundingBox, r2 : BoundingBox) {
//     return !(r2.left > r1.right ||
//         r2.right < r1.left ||
//         r2.top > r1.bottom ||
//         r2.bottom < r1.top);
// }

// export async function checkBoundingBoxes(eventsAfter: Date, eventsBefore: Date): Promise<FrigateEvent[]> {
//     await log.clog(`checking bounding boxes`);

//     const events: FrigateEvent[] = await fetchFrigateEvents(eventsAfter, eventsBefore);
//     await log.clog(events.length);

//     for (let i = 1; i < events.length; i++) {
//         const current = events[i]!;
//         const previous = events[i - 1]!;
//         if (current?.start_time >= previous?.start_time && current?.start_time <= previous?.end_time) {
//             // await log.clog(`${current.id} - ${getNyTime(current.timestamp)} ${getNyTime(getEventTimestamp(current.end_time))} overlaps ${previous.id} - ${getNyTime(previous.timestamp)} ${getNyTime(getEventTimestamp(previous.end_time))}`);
//             await log.clog(`${current.id} - ${getNyTime(current.timestamp)} overlaps ${previous.id} - ${getNyTime(previous.timestamp)}`);
//         }
//     }
//     await log.clog("done checking overlapping.");
//     return events;
// }

async function downloadClip(event: FrigateEvent, basePath: string, path: string) {
    await sleep(100);

    await mkdir(basePath, { recursive: true });

    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let fetchError: any = undefined;

        try {
            const clipResponse = await fetch(new URL(`api/events/${event.id}/clip.mp4`, host));
            await writeFile(path, Buffer.from(await clipResponse.arrayBuffer()));
        } catch (err: unknown) {
            await log.cerror(`${event.id} - ${getNyTime(event.timestamp)}: fetch error`);
            fetchError = err;
        }

        if (fetchError) {
            if (i >= maxAttempts - 1) {
                throw fetchError;
            }
        } else {
            const fileSizeInMB = await getFileSizeInMB(event, path)

            if (fileSizeInMB > MAX_FILE_SIZE) {
                throw new Error(`${event.id} - ${getNyTime(event.timestamp)}: file too large. remove clip from Frigate: ${event.id}`);
            }

            //download suceeded
            if (fileSizeInMB >= MIN_FILE_SIZE) {
                return;
            }
        }

        if (i < maxAttempts - 1) {
            await log.clog(`${event.id} - ${getNyTime(event.timestamp)}: retrying download attempt ${i + 1} of ${maxAttempts}}`);
            await sleep(5000 * (i + 1));
        }
    }

    // await log.cerror(`error getting clip for ${event.id} - ${getNyTime(event.timestamp)}`);
    throw new Error(`${event.id} - ${getNyTime(event.timestamp)}: download failed: ${event.id}`);
}

// async function doesPathExist(path: string) {
//     try {
//         await fs.promises.access(path, fs.constants.F_OK);
//         return true;
//     } catch {
//         return false;
//     }
// }

function normalizeZoneName(x: string) {
    return x === 'sidewalk-north' || x === 'sidewalk-dahua' || x === 'sidewalk' ? 'sidewalk-north' : x;
}

export function isNorthSidewalk(event: FrigateEvent) {
    return !!event.zones.find(x => normalizeZoneName(x) === 'sidewalk-north');
}

export function getZoneName(event: FrigateEvent) {
    return isNorthSidewalk(event) ? 'sidewalk-north' : 'sidewalk-south';
}

export const lastSubmissionRunFile = path.join(eventBasePath, 'lastSubmissionRun.json');

export async function getFileSizeInMB(event: FrigateEvent, path: string) {
    const stats = await stat(path);
    const fileSizeInBytes = stats.size;

    return toMegabytes(fileSizeInBytes);
}

export function toMegabytes(bytes: number) {
    return bytes / (1024 * 1024);
}

export async function fetchFrigateEvents(eventsAfter: Date, eventsBefore?: Date): Promise<FrigateEvent[]> {
    await log.clog('fetching events...');

    const url = new URL(`api/events`, host);
    url.searchParams.append('after', (dateToEpochSeconds(eventsAfter) + 1).toString());
    if (eventsBefore != null) {
        url.searchParams.append('before', (dateToEpochSeconds(eventsBefore) + 1).toString());
    }
    url.searchParams.append('limit', (250).toString());

    const response = await fetch(url);

    const fetchedEvents = (await response.json() as Omit<FrigateEvent, 'timestamp'>[]);

    const events: FrigateEvent[] = fetchedEvents.map(x => apiReponseToFrigateEvent(x)).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return events;
}

function apiReponseToFrigateEvent(x: Omit<FrigateEvent, "timestamp">): FrigateEvent {
    return { ...x, timestamp: getEventTimestamp(x.start_time) };
}

export async function deleteFrigateEvent(eventId: string) {
    const url = new URL(`api/events/${eventId}`, host);
    const response = await fetch(url, {
        method: "DELETE"
    });

    if (!response.ok) {
        await log.cerror(`${eventId} deleting event failed.`);
        throw new Error(`${eventId} deleting event failed.`);
    }

    await log.clog(`${eventId}: deleted`);
}


export function doesEventAlreadyHaveServiceRequest(eventId: string) {
    const paths = getEventPaths(eventId);
    return fs.existsSync(paths.serviceRequestJsonPath);
}

export function doesEventAlreadyHaveResolution(eventId: string) {
    const paths = getEventPaths(eventId);
    return fs.existsSync(paths.serviceRequestResolutionJsonPath);
}

function getEventTimestamp(start_time: number) {
    return new Date(start_time * 1000);
}

async function getDirectories(source: string) {
    return (await readdir(source, { withFileTypes: true }))
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
}

export function getNyTime(date: Date) {
    return date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        timeZoneName: 'short'
    });
}

export function getReportsByDate(db: EventDatabase) {
    const index = new Map<string, string[]>();

    const serviceRequests = [...db.events.values()].filter(x => x.serviceRequest !== undefined);
    for (const { serviceRequest } of db.events.values()) {
        if (serviceRequest === undefined) {
            continue;
        }
        let srsForDate = index.get(serviceRequest.incidentDate);
        if (srsForDate === undefined) {
            srsForDate = [];
            index.set(serviceRequest.incidentDate, srsForDate);
        }
        srsForDate.push(serviceRequest.serviceRequestNumber);
    }

    let output = `\nTotal reports: ${serviceRequests.length}\n\n`;

    for (const [date, srs] of index) {
        output += `\nDate: ${date}\n\n`;

        for (const request of srs.sort((a, b) => a.localeCompare(b))) {
            output += `${request} `;
        }
        output += `\n\nTotal: ${srs.length}\n`;
    }
    return output;
}

async function loadResolution(eventId: string) {
    const paths = getEventPaths(eventId);
    try {
        return await readFileAsJson<ServiceRequestStatus>(paths.serviceRequestResolutionJsonPath);
    } catch {
        return undefined;
    }
}



export async function getResolutionSummary(db: EventDatabase) {
    const index: Record<string, number> = { unknown: 0 };

    let output = '';
    for (const { serviceRequestStatus } of db.events.values()) {
        if (serviceRequestStatus?.ResolutionAction == null) {
            index.unknown++;
        } else {

            if (serviceRequestStatus.ResolutionAction.includes('below')) {
                await log.clog(`${serviceRequestStatus.SRNumber}: additional information`);
            }

            if (index[serviceRequestStatus.ResolutionAction] === undefined) {
                index[serviceRequestStatus.ResolutionAction] = 0;
            }
            index[serviceRequestStatus.ResolutionAction]++;
        }
    }

    for (const action of Object.keys(index)) {
        output += `${index[action]}, ${action}\n`;
    }

    return output;
}

export function listServiceRequests(db: EventDatabase) {
    const eventsWithRequests = getEventsWithServiceRequests(db);

    if (eventsWithRequests.length === 0) {
        return '';
    }

    let output = '';
    const srColumns: (keyof ServiceRequest)[] = ['serviceRequestNumber', 'incidentDate', 'incidentDateTime'];
    output += toCSVRow([...srColumns, 'zone', 'eventId']) + '\n';

    for (const { event, serviceRequest } of eventsWithRequests) {
        const values = srColumns.map(x => serviceRequest![x].toString());
        values.push(getZoneName(event));
        values.push(event.id);

        output += toCSVRow(values) + '\n';
    }
    return output;
}


function getEventsWithServiceRequests(db: EventDatabase) {
    return [...db.events.values()].filter(x => x.serviceRequest !== undefined);
}

let isCheckServiceRequestResolutionRunning = false;
export async function checkServiceRequestResolution(db: EventDatabase) {
    if (isCheckServiceRequestResolutionRunning)
        return false;
    isCheckServiceRequestResolutionRunning = true;

    try {
        const serviceRequests = getEventsWithServiceRequests(db).filter(x => !x.hasResolution);

        for (const { event, serviceRequest } of serviceRequests) {
            if (!serviceRequest) {
                continue;
            }

            const headers = new Headers()
            headers.append('Cache-Control', 'no-cache');
            headers.append('Ocp-Apim-Subscription-Key', process.env.API_311!);

            do {
                const response = await fetch(`https://api.nyc.gov/public/api/GetServiceRequest?srnumber=${serviceRequest.serviceRequestNumber}`, { cache: 'no-cache', headers })

                if (response.status === 429) {
                    await log.clog(await response.json());
                    await sleep(60 * 1000);
                    continue;
                }
                const serviceRequestStatus = await response.json() as ServiceRequestStatus;

                if (serviceRequestStatus.Status === statusToCode.closed) {
                    const paths = getEventPaths(event.id);
                    await writeFileAsJson(paths.serviceRequestResolutionJsonPath, serviceRequestStatus);

                    updateDb(db, event.id, x => ({ ...x, hasResolution: true, serviceRequestStatus }));
                    await log.clog(`${event.id}\n\t${serviceRequestStatus.ResolutionAction} - resolved`);
                } else {
                    await log.clog(serviceRequestStatus);
                    await log.clog(response.status);

                    updateDb(db, event.id, x => ({ ...x, hasResolution: false, serviceRequestStatus }));
                    await log.clog(`${event.id}\n\t${serviceRequestStatus.ResolutionAction} - not resolved`);
                }
                break;
                // eslint-disable-next-line no-constant-condition
            } while (true);
        }
    } finally {
        isCheckServiceRequestResolutionRunning = false;
        await log.clog('done checking service request resolution.');
    }
}

function toCSVRow(keys: string[]) {
    let output = '';
    for (let i = 0; i < keys.length; i++) {
        output += `"${keys[i]}"`;
        output += i === keys.length - 1 ? '' : ',';
    }
    return output;
}


async function getSavedEventIds() {
    return (await getDataDirectories(eventBasePath));
}

async function getStagedClipDirectories() {
    return (await getDataDirectories(clipStagingBasePath));
}


async function getDataDirectories(path: string) {
    return (await getDirectories(path)).filter(x => !x.includes(".tmp.driveupload")).sort((a, b) => a.localeCompare(b));
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//POST https://api.nyc.gov/public/api/GetServiceRequestList 

// async function postData(url = "", data = {}) {
//     // Default options are marked with *
//     const response = await fetch(url, {
//         method: "POST", // *GET, POST, PUT, DELETE, etc.
//         mode: "cors", // no-cors, *cors, same-origin
//         cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
//         credentials: "same-origin", // include, *same-origin, omit
//         headers: {
//             "Content-Type": "application/json",
//             // 'Content-Type': 'application/x-www-form-urlencoded',
//         },
//         redirect: "follow", // manual, *follow, error
//         referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
//         body: JSON.stringify(data), // body data type must match "Content-Type" header
//     });
//     return response.json(); // parses JSON response into native JavaScript objects
// }
