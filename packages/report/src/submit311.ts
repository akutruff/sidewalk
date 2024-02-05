/* eslint-disable no-empty */
import { mkdir } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { writeFile } from 'fs/promises'
import type { Browser, ElementHandle } from "puppeteer-core";
import puppeteer from "puppeteer-core";

import { doesEventAlreadyHaveServiceRequest, getFileSizeInMB, getNyTime, lastSubmissionRunFile, fetchAndSaveFrigateEvents, sleep, isFileSizeValid } from './frigate.js';
import { log } from './logger.js';
import { readFileAsJson, writeFileAsJson } from './serialization.js';
import type { EventDatabase, FrigateEvent, ServiceRequestDefinition, SubmissionRun } from './types.js';
import { updateDb } from './database.js';
import type { FrigateEventPaths } from './frigateEvent.js';
import { CLIP_S3_BUCKET, getEventPaths } from './frigateEvent.js';

import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { hasClipBeenReviewedEnough, loadReviewStatus, minimumRequiredReviews } from './reviews.js';

const fallbackToUploadToAws = process.env.AWS_ACCESS_KEY_ID != null && process.env.AWS_SECRET_ACCESS_KEY != null;
if (!process.env.AWS_ACCESS_KEY_ID) {
    throw new Error('AWS_ACCESS_KEY_ID not set');
}

if (!process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_SECRET_ACCESS_KEY not set');
}

let s3Client: S3Client | undefined = undefined;

if (fallbackToUploadToAws) {
    s3Client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } });
}

export async function uploadClipToS3(event: FrigateEvent) {
    if (!s3Client) {
        throw new Error('aws upload not configured');
    }

    const paths = getEventPaths(event.id);

    const fileStream = createReadStream(paths.clipPath);

    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: CLIP_S3_BUCKET,
            Key: paths.s3ObjectKey,
            Body: fileStream
        }
    });

    upload.on("httpUploadProgress", (progress) => {
        console.log(progress);
    });

    await upload.done();
}

if (process.env.EVENTS_BASE_PATH == null) {
    throw new Error('EVENTS_BASE_PATH not set');
}

if (process.env.TOKEN == null) {
    throw new Error('TOKEN not set');
}

if (process.env.API_311 == null) {
    throw new Error('API_311 not set');
}

if (process.env.WEBSITE_USERNAME == null) {
    throw new Error('WEBSITE_USERNAME not set');
}

if (process.env.WEBSITE_PASSWORD == null) {
    throw new Error('WEBSITE_PASSWORD not set');
}

if (process.env.BROWSERLESS_ADDRESS == null) {
    throw new Error('BROWSERLESS_ADDRESS not set');
}

if (process.env.SERVICE_REQUEST_DEFINITIONS_PATH == null) {
    throw new Error('SERVICE_REQUESTION_DEFINITIONS not set');
}

const serviceRequestDefinitions = await readFileAsJson<ServiceRequestDefinition[]>(process.env.SERVICE_REQUEST_DEFINITIONS_PATH!)

async function takeScreenshot(page: puppeteer.Page, basePath: string, screenshotId: number) {
    await log.clog(`shot ${screenshotId}`);
    await page.screenshot({ path: path.join(basePath, `shot${screenshotId}.png`), fullPage: true });
}

async function clickXPath(page: puppeteer.Page, xpath: string) {
    const element = await page.waitForXPath(xpath)
    if (!element) {
        console.error(`xpath not found: ${xpath} `);
        throw new Error(`xpath not found: ${xpath} `);
    }
    await (element as ElementHandle<Element>).click();
}

const maxRetriesBeforeS3Fallback = process.env.RETRIES_BEFORE_S3_FALLBACK ? Number.parseInt(process.env.RETRIES_BEFORE_S3_FALLBACK) : 1;

export function getServiceRequestDefinition(event: FrigateEvent) {
    for (const zoneName of event.zones) {
        const definition = serviceRequestDefinitions.find(definition => definition.zoneNames.includes(zoneName));
        if (definition) {
            return definition;
        }
    }

    return undefined;
}

export async function submitSidewalkComplaintTo311(db: EventDatabase, event: FrigateEvent, submissionId: number, isDryRun: boolean) {

    const maxRetries = 10;
    let failedFileUploadAttempts = 0

    for (let i = 0; i < maxRetries; i++) {
        //Check if there is a file directly so there is a single source of truth for the event
        if (doesEventAlreadyHaveServiceRequest(event.id)) {
            await log.clog(`event ${event.id} already has a service request`);
            return;
        }

        if (isSubmissionCanceled(submissionId)) {
            return;
        }
        const reviewStatus = await loadReviewStatus(event.id);
        if (!hasClipBeenReviewedEnough(reviewStatus)) {
            throw new Error(`event ${event.id} - ${getNyTime(event.timestamp)} has not been reviewed ${minimumRequiredReviews} times.`);
        }

        const paths = getEventPaths(event.id);

        // const isNorth = isNorthSidewalk(event);
        const serviceRequestDefinition = getServiceRequestDefinition(event);
        if (!serviceRequestDefinition) {
            throw new Error(`event ${event.id} - ${getNyTime(event.timestamp)} does not have a service request definition matching it's zones: ${event.zones.join(', ')}.`);
        }

        const incidentDate = event.timestamp.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });

        const incidentTime = event.timestamp.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            timeStyle: 'short',
        });

        const incidentDateTime = `${incidentDate} ${incidentTime}`;

        // await log.clog(`event ${event.id} - report time: ${incidentDateTime}`);

        await log.clog(`submitting to 311: event ${event.id} - incident date: ${incidentDateTime} location: ${event.zones.join(', ')}`);

        const fileSizeInMegabytes = await getFileSizeInMB(event, paths.clipPath);

        if (!await isFileSizeValid(event.id, fileSizeInMegabytes)) {
            return;
        }

        const screenshot = await setupScreenshotSession(paths);

        let browser: Browser | null = null;

        try {
            const connectionTimeout = 6 * 60 * 1000;
            browser = await puppeteer.connect({
                // browserWSEndpoint: `ws://localhost:3000?token=${process.env.TOKEN}&launch={"args":["--window-size=1920,1080", "--disable-features=site-per-process", "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",  "--no-first-run", "--disable-extensions", "--disable-features=IsolateOrigins"]}`,                
                browserWSEndpoint: `ws://${process.env.BROWSERLESS_ADDRESS}?token=${process.env.TOKEN}&timeout=${connectionTimeout}`,
            });

            const page = await browser.newPage();

            const pageTimeout = 60 * 1000;
            page.setDefaultTimeout(pageTimeout);
            page.setDefaultNavigationTimeout(pageTimeout);

            await page.emulateTimezone('America/New_York');

            await log.clog(`navigating to 311`);
            await page.goto('https://portal.311.nyc.gov/article/?kanumber=KA-02232');

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            await page.waitForNetworkIdle();

            await screenshot(page);

            await clickXPath(page, "//*[@id='signin-links']//a[contains(., 'Sign In')]");
            await page.waitForNavigation();

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            await log.clog(`logging in`);
            await page.waitForSelector("#logonIdentifier");
            await page.focus("#logonIdentifier");
            await page.keyboard.type(process.env.WEBSITE_USERNAME!);

            await page.focus("#password");
            await page.keyboard.type(process.env.WEBSITE_PASSWORD!);

            await screenshot(page);

            await clickXPath(page, "//button[@id='next']");

            await log.clog(`login submitted.`);

            await page.waitForNavigation();
            await log.clog(`waiting for idle after login`);

            await screenshot(page);

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            await log.clog('beginning report');

            await clickXPath(page, "//a[contains(., 'Report past or recurring hazardous biking, rollerblading or skating')]");
            await page.waitForNavigation();

            await sleep(2000);
            await log.clog('first page loaded');
            await screenshot(page);

            if (!await page.waitForSelector("#n311_datetimeobserved_datepicker_description", { visible: true })) {
                await log.clog('date picker not found')
                return;
            }

            await page.focus('#n311_datetimeobserved_datepicker_description');

            await page.keyboard.type(incidentDateTime);

            let wasClipUploaded = false;

            await clickXPath(page, "//*[@id='attachments-addbutton']")

            await log.clog(`uploading clip`);

            await sleep(100);

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            const uploadFileInputHandle = await page.waitForSelector("input[type=file]");

            if (!uploadFileInputHandle) {
                throw new Error('uploadFileInputHandle not found')
            }

            await log.clog(`uploading file: ${paths.clipPathInBrowserlessContainer}`)
            await uploadFileInputHandle.uploadFile(paths.clipPathInBrowserlessContainer);
            await log.clog(`file uploaded`)

            await sleep(200);
            await log.clog(`waiting for modal to accept clip`);
            await screenshot(page);

            await clickXPath(page, "//div[contains(@class, 'modal-footer')]//button[contains(., 'Add Attachment')]");

            await sleep(2000);

            await log.clog(`attachment clicked`);

            const maxChecksForFileUpload = 3;
            for (let i = 0; i < maxChecksForFileUpload; i++) {
                try {
                    await page.waitForXPath("//*[@id='ServiceActivity']//p[contains(., 'sidewalk_rider_clip' )]", { timeout: 10000 });
                    wasClipUploaded = true;
                    await log.clog(`clip upload confirmed`);
                    await screenshot(page);

                    break;
                }
                catch {
                    await sleep(200);
                }
            }


            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            if (!wasClipUploaded) {
                failedFileUploadAttempts++;
                if (fallbackToUploadToAws && failedFileUploadAttempts > maxRetriesBeforeS3Fallback) {
                    await log.cerror(`${event.id} - File upload failed after ${i} attempts. falling back to S3.`);
                    await log.clog(`${event.id} - attempting to snap error page`);
                    await screenshot(page);
                    await sleep(1000);

                    await page.waitForXPath("//div[contains(@class, 'modal-body')]//div[contains(., 'error')]");

                    await screenshot(page);
                    await sleep(500);

                    await page.keyboard.press('Escape');
                    await sleep(2000);

                    await uploadClipToS3(event);
                    await log.clog(`${event.id} - File uploaded to S3: ${paths.s3Url}`);
                } else {
                    if (i >= maxRetries - 1) {
                        throw new Error(`${event.id} - clip upload failed`);
                    }
                    const maxWaitTime = 10 * 60 * 1000;

                    const waitTime = Math.min(Math.pow(2, i) * 1000, maxWaitTime);

                    const startWait = Date.now();
                    await log.cerror(`${event.id} - File upload failed, retrying after waiting a bit: ${waitTime / 1000 / 60} minutes`);
                    await screenshot(page);

                    while (Date.now() - startWait < waitTime) {
                        await sleep(10000)

                        if (isSubmissionCanceled(submissionId)) {
                            return;
                        }
                    }

                    continue;
                }
            }

            await sleep(200);

            await page.waitForSelector("#n311_description", { visible: true })

            await page.focus('#n311_description');

            let description = serviceRequestDefinition.problemDescription;
            if (!description || description.trim() === '') {
                throw new Error(`event ${event.id} - ${getNyTime(event.timestamp)} does not have a problem defined for it's zones: ${event.zones.join(', ')}.`);
            }

            if (!wasClipUploaded) {
                description = `Video evidence here:  ${paths.s3Url} (The 311 website is broken and is not accepting file uploads.)` + '\n' + description;
            }

            await page.keyboard.type(description, { delay: 10 });

            await page.click("#n311_isthisarecurringproblem_1");

            await page.focus('#n311_describethedaysandtimestheproblemhappens');
            await page.keyboard.type('The infractions occur all day every day but are especially bad during peak food delivery times.');

            await sleep(200);

            await screenshot(page);

            await log.clog(`clicking next`);

            await clickXPath(page, "//*[@id='NextButton']");

            await page.waitForNavigation();

            await sleep(2000);

            await screenshot(page);

            const locationSelector = await page.waitForXPath("//*[@id='n311_locationtypeid_select']", { timeout: 30000 });

            if (!locationSelector) {
                throw new Error('locationSelector not found');
            }

            await log.clog(`finding sidewalkSelector`);

            const sidewalkSelector = await page.waitForXPath("//*[@id='n311_locationtypeid_select']/option[contains(.,'Sidewalk')]");

            if (!sidewalkSelector) {
                throw new Error('sidewalkSelector not found');
            }
            await log.clog(`finding sidewalkOptionValue`);

            const sidewalkOptionValue = await (await sidewalkSelector.getProperty('value')).jsonValue();

            await locationSelector.select(sidewalkOptionValue as string);

            await sleep(2000);

            await screenshot(page);

            await clickXPath(page, "//*[@id='SelectAddressWhere']");
            const addressInputBox = await page.waitForXPath("//*[@id='address-search-box-input']");

            if (!addressInputBox) {
                await log.clog('addressInputBox not found')
                return;
            }

            await addressInputBox.focus();

            await log.clog('typing address')

            const address = serviceRequestDefinition.address;
            if (!address || address.trim() === '') {
                throw new Error(`event ${event.id} - ${getNyTime(event.timestamp)} does not have an address defined for it's zones: ${event.zones.join(', ')}.`);
            }

            const chars = [...address];
            for (const character of chars) {
                await addressInputBox.type(character);
                await sleep(200);
            }
            await sleep(500);

            await log.clog('waiting for address typing network idle')

            try {
                await addressInputBox.press('Enter');
            } catch (e) {
                console.error(e);
            }

            await log.clog('waiting for address enter idle')
            try { await page.waitForNetworkIdle({ timeout: 3000 }); } catch { }

            await sleep(100);

            await log.clog('submitting address')
            await screenshot(page);

            await clickXPath(page, "//*[@id='SelectAddressMap'][not(@disabled)]")

            try { await page.waitForNavigation({ timeout: 3000 }); } catch { }

            await log.clog('address selection completed.')
            await sleep(100);
            await screenshot(page);

            await clickXPath(page, "//*[@id='NextButton']")
            await page.waitForNavigation();

            await log.clog('contact info page');
            await sleep(2000);
            await screenshot(page);

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            await clickXPath(page, "//*[@id='NextButton']");
            await page.waitForNavigation();

            await log.clog('Review and submit page');
            await sleep(100);
            await screenshot(page);

            if (isSubmissionCanceled(submissionId)) {
                return;
            }

            if (isDryRun) {
                await log.clog('skipping submission for dry run');
                return;
            }

            const pendingServiceRequest = { serviceRequestNumber: 'pending', incidentDate, incidentDateTime };

            //IMPORTANT: write service request in a pending state in case the service request ends up being submitted without confirmation.
            //  this will prevent accidental double submisstions.
            await writeFile(paths.serviceRequestJsonPath, JSON.stringify(pendingServiceRequest, null, 2));

            updateDb(db, event.id, entry => ({ ...entry, serviceRequest: pendingServiceRequest }));

            await clickXPath(page, "//*[@id='NextButton']");
            await page.waitForNavigation();

            await log.clog('Confirmation page');
            await sleep(1000);
            await screenshot(page);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
            const serviceRequestNumber = await page.$eval('#n311_name', ({ value }: any) => value) as string;

            await log.clog("service request number: ", serviceRequestNumber);

            const confirmedServiceRequest = { serviceRequestNumber, incidentDate, incidentDateTime };
            updateDb(db, event.id, entry => ({ ...entry, serviceRequest: confirmedServiceRequest }));

            await writeFileAsJson(paths.serviceRequestJsonPath, confirmedServiceRequest);
            // await writeFile(paths.serviceRequestJsonPath, JSON.stringify({ serviceRequestNumber, incidentDate, incidentDateTime }, null, 2));

            const currentSubmissionRun: SubmissionRun = { lastRunTime: getNyTime(event.timestamp) };
            // await log.clog(`writing to submission ${currentSubmissionRun.lastRunTime}`);
            await writeFileAsJson(lastSubmissionRunFile, currentSubmissionRun);

        } finally {
            if (browser) {
                await browser.disconnect();
            }
        }

        break;
    }
}

async function setupScreenshotSession(paths: FrigateEventPaths) {
    await mkdir(paths.shotsPath, { recursive: true });

    let nextShotId = 0;
    const screenshot = (page: puppeteer.Page) => takeScreenshot(page, paths.shotsPath, nextShotId++);
    return screenshot;
}


export let isSubmitting = false;
export let eventCountInCurrentBatch = 0;
export let eventsSubmittedInCurrentBatch = 0;

export let lastEventDateForSubmission: Date | null = null;

export let currentSubmissionId = 0;
export let canceledSubmissionId = 0;

export function allocationSubmissionId() {
    return ++currentSubmissionId;
}

export function cancelSubmission() {
    canceledSubmissionId = currentSubmissionId;
}

export function isSubmissionCanceled(submissionId: number) {
    return submissionId <= canceledSubmissionId;
}

export async function submitEventRangeTo311(db: EventDatabase, lastRunTime: Date, eventsBefore: Date, isDryRun: boolean) {
    if (isSubmitting) {
        await log.clog('already submitting');
        return;
    }
    try {
        lastEventDateForSubmission = eventsBefore;
        isSubmitting = true;
        const submissionId = allocationSubmissionId();

        const events = await fetchAndSaveFrigateEvents(db, lastRunTime, eventsBefore);

        eventCountInCurrentBatch = events.length;
        eventsSubmittedInCurrentBatch = 0;

        for (const event of events) {
            try {
                await execWithRetryBackoff(async () => {
                    if (isSubmissionCanceled(submissionId)) {
                        await log.clog(`Submission canceled`);
                        return;
                    }
                    await log.clog(`--- Submitting event: ${eventsSubmittedInCurrentBatch + 1} / ${eventCountInCurrentBatch} ---`);

                    await submitSidewalkComplaintTo311(db, event, submissionId, isDryRun);
                }, submissionId);

            } catch (e) {
                await log.cerror(`error processing: ${event.id}`, e);
                throw e;
            }
            eventsSubmittedInCurrentBatch++;
        }

    } finally {
        await log.clog('done submitting');
        isSubmitting = false;
    }
}


export async function execWithRetryBackoff(func: () => Promise<void>, submissionId: number, maxRetries = 10) {
    for (let i = 0; i < maxRetries; i++) {
        if (isSubmissionCanceled(submissionId)) {
            return;
        }
        try {
            await func();
            return;
        }
        catch (e) {
            if (i >= maxRetries - 1) {
                await log.cerror('max retries exceeded. throwing error.');
                throw e;
            }
        }

        const maxWaitTime = 10 * 60 * 1000;

        const baseWaitTime = 10 * 1000;
        const backoffWaitTime = Math.pow(2, i) * 1000;
        const waitTime = Math.min(baseWaitTime + backoffWaitTime, maxWaitTime);

        const startWait = Date.now();

        while (Date.now() - startWait < waitTime) {
            if (isSubmissionCanceled(submissionId)) {
                return;
            }
            await sleep(1000)
        }
    }
}