
import { getReportsByDate, listServiceRequests, checkServiceRequestResolution, getResolutionSummary, fetchFrigateEvents, getNyTime, lastSubmissionRunFile, cleanStagedClips, fetchAndSaveFrigateClipsToStaging, checkOverlapping } from './frigate.js';
import { submitEventRangeTo311, uploadClipToS3 } from './submit311.js';
import { eventBasePath } from './frigateEvent.js';
import { createInterface } from 'readline';
import fs from 'fs'
import { mkdir } from 'fs/promises'
import { runWebServer } from './webServer.js';
import { log } from './logger.js';
import { readFileAsJson, writeFileAsJson } from './serialization.js';
import type { SubmissionRun } from './types.js';
import { getDb, rebuildDatabase, saveDb } from './db.js';

const readline = createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question: string) {
    return new Promise(resolve => {
        readline.question(question, input => resolve(input));
    });
}


process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

function shutDown() {
    console.log('index.ts - Received kill signal, shutting down gracefully');
    saveDb();
    process.exit(0);
}

async function ensureLastSubmissionRunFileExists() {
    if (fs.existsSync(lastSubmissionRunFile)) {
        return;
    }
    await mkdir(eventBasePath, { recursive: true });
    const submissionRun: SubmissionRun = { lastRunTime: getNyTime(new Date()) };
    await writeFileAsJson(lastSubmissionRunFile, submissionRun);
}

(async () => {

    console.log('index.ts - Starting up');
    if (process.argv.length < 3) {
        console.error('Expected exactly one argument!');
        process.exit(1);
    }

    switch (process.argv[2]) {
        case "build-db":
            {
                await rebuildDatabase();
            }
            break;
        case "webserver":
            {
                await ensureLastSubmissionRunFileExists();
                await runWebServer();
            }
            break;
        case "get-reports-by-date":
            {
                await log.clog(getReportsByDate(await getDb()));
            }
            break;
        case "upload-to-s3":
            {
                const db = await getDb();
                const event = db.events.get(process.argv[3]!);
                if (!event) {
                    throw new Error(`event ${process.argv[3]} not found`);
                }
                await uploadClipToS3(event.event);
            }
            break;
        case "check-resolution":
            {
                await checkServiceRequestResolution(await getDb());
            }
            break;
        case "list-requests":
            {
                await log.clog(listServiceRequests(await getDb()));
            }
            break;
        case "resolution-summary":
            {
                await log.clog(await getResolutionSummary(await getDb()));
            }
            break;
        case "clean-staged-clips":
            {
                await cleanStagedClips();
            }
            break;
        case "check-overlapping":
            {
                const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);
                const lastRunTime = new Date(lastSubmissionRun.lastRunTime);

                await checkOverlapping(lastRunTime, new Date());
            }
            break;
        case "fetch-staged-clips":
            {
                const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);
                const lastRunTime = new Date(lastSubmissionRun.lastRunTime);

                await fetchAndSaveFrigateClipsToStaging(lastRunTime, new Date(), false);
            }
            break;
        case "seed-last-run-time":
            {
                await ensureLastSubmissionRunFileExists();
            }
            break;
        case "submit-to-311":
            {
                await ensureLastSubmissionRunFileExists();

                const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);;
                const lastRunTime = new Date(lastSubmissionRun.lastRunTime);
                await log.clog(`last run time: ${getNyTime(lastRunTime)}`)

                let eventsBefore: Date;
                if (process.argv.length != 4) {
                    const events = await fetchFrigateEvents(lastRunTime);
                    if (events.length == 0) {
                        console.error('no events found');
                        process.exit(1);
                    }
                    const latestEvent = events[events.length - 1]!;

                    await log.clog(`latest event at ${getNyTime(latestEvent.timestamp)}`);

                    const answer = await ask(`submit? [y/N] `);
                    if (answer != 'y') {
                        await log.clog('exiting');
                        process.exit(0);
                    }

                    eventsBefore = latestEvent.timestamp;
                } else {
                    let eventsBeforeArg = process.argv[3];
                    if (eventsBeforeArg == null) {
                        throw new Error('eventsBefore not set');
                    }

                    if (!eventsBeforeArg?.endsWith(' EST')) {
                        eventsBeforeArg += ' EST';
                    }

                    if (!Date.parse(eventsBeforeArg)) {
                        throw new Error(`Invalid date: ${eventsBeforeArg}`);
                    }
                    eventsBefore = new Date(eventsBeforeArg);
                }

                // try {
                //     await fs.promises.access(lastSubmissionRunFile, fs.constants.F_OK);
                // } catch {
                //     console.error(`Unable to access ${lastSubmissionRunFile}`);
                //     console.error(`  run --seed-last-run-time to create it.`);
                // }

                await submitEventRangeTo311(await getDb(), lastRunTime, eventsBefore, false);
            }
            break;
        default:
            console.error('Unknown command');
            process.exit(1);
    }

    // https://nyctmc.org/api/cameras/db5f8b82-99b1-45f3-a520-7d1f91d0a49a/image?t=1700162000593
    // https://nyctmc.org/api/cameras/23994d9e-7e59-4808-8d47-405f779d19cf/image?t=1700162036050
    process.exit(0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});

