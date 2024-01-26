/* eslint-disable @typescript-eslint/no-misused-promises */
import express from 'express';
import { checkOverlapping, checkServiceRequestResolution, cleanStagedClips, deleteFrigateEvent, fetchAndSaveFrigateClipsToStaging, fetchFrigateEvents, getNyTime, getReportsByDate, getResolutionSummary, lastSubmissionRunFile, listServiceRequests } from './frigate.js';
import { readFile, stat } from 'fs/promises'
import fs from 'fs'
import { cancelSubmission, eventCountInCurrentBatch, eventsSubmittedInCurrentBatch, isSubmitting, lastEventDateForSubmission, submitEventRangeTo311 } from './submit311.js';
import { log } from './logger.js';
import { WebSocketServer } from 'ws';
import { readFileAsJson } from './serialization.js';

import type { FrigateEvent, ReviewStatus, SubmissionRun } from './types.js';
import { getDb } from './db.js';
import { getEventPaths } from './frigateEvent.js';
import { loadReviewStatus, incrementReviewStatus, hasClipBeenReviewedEnough, minimumRequiredReviews } from './reviews.js';

const wss: WebSocketServer = new WebSocketServer({ port: 8080 });

log.onLog.use((context, next) => {
    const message = toLinesMessage([context.line]);
    for (const client of wss.clients) {
        client.send(message);
    }

    return next();
});

log.onLogError.use((context, next) => {
    const message = toLinesMessage([context.line]);
    for (const client of wss.clients) {
        client.send(message);
    }

    return next();
});

interface Message {
    type: 'wholeLogRequest' | 'checkOverlapping' | 'cancelSubmission'
}

interface DeleteEventMessage {
    type: 'deleteEvent',
    eventId: string
}

interface SetEventValid {
    type: 'setEventValid',
    eventId: string,
    newTotalReviews: number
}
type MessageTypes = Message | DeleteEventMessage | SetEventValid;

wss.on('connection', function connection(ws) {
    console.log('web socket connected');
    ws.on('error', console.error);
    ws.on('close', () => console.log('web socket closed'));

    ws.on('message', async (data: string) => {
        const message = JSON.parse(data) as MessageTypes;
        console.log('received:', message.type);
        switch (message.type) {
            case 'wholeLogRequest': {
                ws.send(toLinesMessage([...log.logLines]));
                break;
            }
            case 'checkOverlapping': {
                const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);
                const lastRunTime = new Date(lastSubmissionRun.lastRunTime);

                await checkOverlapping(lastRunTime, new Date());
                break;
            }
            case 'cancelSubmission': {
                await log.clog('cancelling submission - this may take up to 30 seconds but it will stop before current event is submitted.');
                cancelSubmission();
                break;
            }
            case 'setEventValid': {
                await incrementReviewStatus(message.eventId, message.newTotalReviews);
                break;
            }
            case 'deleteEvent': {
                try {
                    await deleteFrigateEvent(message.eventId);
                    ws.send(JSON.stringify({ type: 'deleteOK', eventId: message.eventId }));
                } catch (error) {
                    ws.send(JSON.stringify({ type: 'deleteFailed', eventId: message.eventId }));
                }
                break;
            }
            default:
                break;
        }
    });
});

function toLinesMessage(lines: string[]) {
    return JSON.stringify({ type: 'logLines', lines });
}

const app = express();

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

const sidewalkServerWebSocketUrl = process.env.WEBSOCKET_URL!;

app.get('/', async (req, res) => {
    try {
        const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);
        const lastRunTime = new Date(lastSubmissionRun.lastRunTime);

        const events = (await fetchFrigateEvents(lastRunTime));
        const logOutputContainerId = 'logOutputContainer';
        const logOutputId = 'logOutput';
        const shouldAutoScrollId = 'shouldAutoScroll';

        let mostRecentValidEvent = getNyTime(new Date());
        let hasEvents = false;
        let latestValidEvent: FrigateEvent | undefined;

        if (events.length > 0) {
            hasEvents = true;

            for (const event of events) {
                const reviewStatus = await loadReviewStatus(event.id);
                if (hasClipBeenReviewedEnough(reviewStatus)) {
                    latestValidEvent = event;
                } else {
                    break;
                }
            }

            if (latestValidEvent) {
                mostRecentValidEvent = getNyTime(latestValidEvent.timestamp);
            }
        }

        res.send(`
            <html>    
            <script>                
                const socket = new WebSocket("${sidewalkServerWebSocketUrl}");

                // Connection opened
                socket.addEventListener("open", (event) => {
                    socket.send(JSON.stringify({type: 'wholeLogRequest'}));      
                });

                window.addEventListener("unload", function () {            
                    if(socket.readyState == WebSocket.OPEN) {
                        console.log('closing socket');
                        socket.close();
                    }
                });

                const logLines = [];

                // Listen for messages
                socket.addEventListener("message", (event) => {
                const message = JSON.parse(event.data);          
                switch(message.type) { 
                    case 'logLines': {                
                        const container = document.getElementById("${logOutputContainerId}");
                        const logOutput = document.getElementById("${logOutputId}");
                        const shouldAutoScroll = document.getElementById("${shouldAutoScrollId}");
                        
                        logLines.push(...message.lines);
                        const maxLogLines = 1000;
                        if (logLines.length > maxLogLines) {
                            console.log('trimming log lines');
                            logLines.splice(0, logLines.length - maxLogLines);
                            //logLines.shift();
                        }
                        
                        if (logOutput) {                
                            logOutput.innerHTML = logLines.join('\\n');
                            if (shouldAutoScroll.checked) {
                                container.scrollTop = container.scrollHeight;
                            }                        
                        }
                    }                    
                    break;
                    case 'submitProgress': {                
                        const progressElement = document.getElementById("submitProgress");
                    
                        if (progressElement) {                
                            progressElement.innerHTML = "Progress: " + message.current + " / " + message.total;                    
                        }
                    }
                    break;
                    default:
                    break;
                }
                });

                function checkOverlapping() { 
                    socket.send(JSON.stringify({type: 'checkOverlapping'}));     
                }
                
                function cancelSubmission() { 
                    socket.send(JSON.stringify({type: 'cancelSubmission'}));     
                }

                function scrollToBottom(id) { 
                    document.getElementById(id).scrollTop = document.getElementById(id).scrollHeight 
                }

                
                window.addEventListener('load', function () {
                    scrollToBottom("${logOutputContainerId}");
                });

                let selectedEventId = null;
                function selectEventAsLatest(eventId, eventTime) {
                    const eventTimeTextBox = document.getElementById('eventTime');
                    if(!eventTimeTextBox || !eventTime) {
                        return;
                    }
                    
                    eventTimeTextBox.value = eventTime;

                    const div = document.getElementById(eventId);
                    div.style="padding: 1px; background-color: #ADD8E6;"
                    if (selectedEventId) {
                        const selectedDiv = document.getElementById(selectedEventId);
                        selectedDiv.style="padding: 1px; background-color: #EBEBEB;"
                    }
                    
                    selectedEventId = eventId;
                }
            </script>
            <head>
            <title>Sidewalk - 311 Submit</title>
            </head>
            <body>
            <h3>311 Submit</h3>
            <p><a href="/review">Review clips</a> (to submit: come back this page and hit refresh after reviewing.)</p>
            <p><a href="/stats">Stats</a></p>
            <p><a href="/list-requests">List requests</a></p>
            <p><a href="/resolution-summary">Resolution summary</a></p>
            <p><a href="/check-resolutions">Check resolutions</a></p>
            <p>Most recent event submitted to 311: ${getNyTime(lastRunTime)}</p>
            <p>Final event in current submission: ${lastEventDateForSubmission ? getNyTime(lastEventDateForSubmission) : 'n/a'}</p>
            <p>Count: ${events.length}</p>
            ${hasEvents && latestValidEvent ?
                `                    
                    <form method="POST" action='submit'>
                        <label for="eventTime">Last event to submit:</label>
                        <input type="text" id="eventTime" name="eventTime" value="${mostRecentValidEvent}" style="
                        width: 300px;
                        font-size: medium;
                        ">
                        <br/>
                        <label for="dryRun">Dry run:</label>
                        <input type="checkbox" id="dryRun" name="dryRun" value="dryRun">            
                        <br/>      
                        <input type="submit" value="Submit" style="
                        width: 10rem;
                        height: 3rem;
                        ">
                    </form>
                    ${`<p id="submitProgress">Progress: ${eventsSubmittedInCurrentBatch} / ${eventCountInCurrentBatch}</p>`}
                `
                :
                `
                <p>Most recent event submitted to 311: ${getNyTime(lastRunTime)}</p>
                `
            }
            <div id="${logOutputContainerId}" style="height:500px;border:1px solid #ccc;font-family:monospace;overflow:auto;">
                <pre id="${logOutputId}"></pre>
            </div>
            <input type="checkbox" id="${shouldAutoScrollId}" name="${shouldAutoScrollId}" checked value="${shouldAutoScrollId}">
            <label for="${shouldAutoScrollId}">autoscroll</label>
            <button onclick="checkOverlapping()">Check Overlapping</button>
            <button onclick="cancelSubmission()">Cancel submission</button>
            <p><a href="/clean-staged-clips">Clean Staged Clips</a></p>            
            <div style="height:500px;border:1px solid #ccc;font-family:monospace;overflow:auto;">
                ${events.reverse().map(x => indexPageEventControl(x)).join('\n')}
            </div>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(400).send("server error.");
        await log.cerror(error)
    }
});

function indexPageEventControl(event: FrigateEvent) {
    const eventTime = getNyTime(event.timestamp);
    return `
    <div id="${event.id}" style="padding: 1px; background-color: #EBEBEB;" onclick="selectEventAsLatest('${event.id}', '${eventTime}')">
     <p>Event time: ${eventTime} [${event.zones.join(', ')}]</p>
    </div>
 `;
}

app.post('/check-overlapping', async (req, res) => {
    try {
        const lastSubmissionRun = JSON.parse(await readFile(lastSubmissionRunFile, 'utf8')) as SubmissionRun;
        const lastRunTime = new Date(lastSubmissionRun.lastRunTime);
        await checkOverlapping(lastRunTime, new Date());
        res.send('Done');
    } catch (error) {
        await log.cerror(error)
    }
});

interface EventStatus {
    event: FrigateEvent,
    reviewStatus?: ReviewStatus
}

app.get('/review', async (req, res) => {
    try {
        const lastSubmissionRun = await readFileAsJson<SubmissionRun>(lastSubmissionRunFile);
        const lastRunTime = new Date(lastSubmissionRun.lastRunTime);

        const events = (await fetchAndSaveFrigateClipsToStaging(lastRunTime, new Date(), false)).reverse();

        await log.clog(`Found ${events.length} events to stage`);

        let mostRecentEventTime;
        if (events.length === 0) {
            mostRecentEventTime = getNyTime(new Date());
        }
        else {
            const latestEvent = events[0]!;
            mostRecentEventTime = getNyTime(latestEvent.timestamp);
        }

        // events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

        const eventStatus: EventStatus[] = [];
        for (const event of events) {
            const reviewStatus = await loadReviewStatus(event.id);
            eventStatus.push({ event, reviewStatus });
        }

        res.send(`
            <html>    
            <script>                
                const socket = new WebSocket("${sidewalkServerWebSocketUrl}");

                // Connection opened
                socket.addEventListener("open", (event) => {                    
                });

                window.addEventListener("unload", function () {            
                    if(socket.readyState == WebSocket.OPEN) {
                        console.log('closing socket');
                        socket.close();
                    }
                });

                window.addEventListener('load', function () {
                    showVideo("${events[0]?.id}");
                });
                
                // Listen for messages
                socket.addEventListener("message", (event) => {
                    const message = JSON.parse(event.data);          
                    switch(message.type) {                         
                        case 'deleteOK': {         
                            const div = document.getElementById(message.eventId);
                            if(div) {
                                div.innerHTML = '<div style="display: flex; padding: 1px; background-color: red;">Deleted</div>';                                
                            }
                            break;    
                        }
                        case 'deleteFailed': {         
                            console.log("deleting event failed!");
                            alert("deleting event failed!");
                            break;    
                        }
                        default:
                        break;
                    }
                });

                let selectedEventId = null;
                function showVideo(eventId) {
                    const videoPlayer = document.getElementById('videoPlayer');
                    if(!videoPlayer) {
                        return;
                    }
                    try {
                    videoPlayer.src = '/events/' + eventId + '/clip';
                    } catch (error) {}
                    
                    videoPlayer.play();
                    console.log('showing video');
                    if (selectedEventId) {
                        const selectedDiv = document.getElementById(selectedEventId);
                        selectedDiv.style="display: flex; cursor: pointer; padding: 1px; background-color: #EBEBEB;"
                    }
                    console.log('selecting ', eventId);
                    selectedEventId = eventId;

                    const div = document.getElementById(eventId);
                    div.style="display: flex; cursor: pointer; padding: 1px; background-color: #ADD8E6;"
                }

                function setEventValid(eventId, nextEventId, newTotalReviews) {
                    socket.send(JSON.stringify({type: 'setEventValid', eventId, newTotalReviews }));     
                    console.log('validating ', eventId, nextEventId);
                    
                    const div = document.getElementById(eventId);
                    div.style="display: flex; cursor: pointer; padding: 1px; background-color: #90EE90;"  
                    document.getElementById(eventId + '-valid-button').disabled = true;     
                    
                    if(nextEventId) {
                        showVideo(nextEventId);
                    }        
                }

                function deleteEvent(eventId, nextEventId) {
                    const div = document.getElementById(eventId);
                    div.style="display: flex; padding: 1px; background-color: yellow;"       

                    socket.send(JSON.stringify({type: 'deleteEvent', eventId}));     
                    console.log('deleting ', eventId, nextEventId);
                    if(nextEventId) {                        
                        showVideo(nextEventId);
                    }           
                }

                ${events.length > 0 ? `showVideo('${events[0]?.id}')` : ''}
            </script>
            <head>
                <title>Sidewalk - 311 Clip Review</title>
                
            </head>
            <body>
            <h3>311 Clip Review</h3>
            <h4>Clips must be reviewed ${minimumRequiredReviews} times. Refresh page to do another round.</h4>
            <p>Most recent time: ${mostRecentEventTime}</p>
            <p>Last run time: ${getNyTime(lastRunTime)}</p>            
            <br>
            ${events.length === 0 ? `<p>No events found</p>` : `
                <video id="videoPlayer" width="100%" controls muted="muted">
                    <source src="/events/${events[0]?.id}/clip" type="video/mp4" />
                </video>           
            `}
            <div style="height:500px;border:1px solid #ccc;font-family:monospace;overflow:auto;">
                ${eventStatus.map((x, index) => eventControl(x, eventStatus[index + 1])).join('\n')}
            </div>
            
            </body>
            </html>
        `);
    } catch (error) {
        res.status(400).send("failed to review.");
        await log.cerror(error)
    }
});

function eventControl(eventStatus: EventStatus, nextEventStatus?: EventStatus) {
    const nextEventId = nextEventStatus?.event.id ? `'${nextEventStatus.event.id}'` : null;
    const event = eventStatus.event;
    const reviewCount = eventStatus.reviewStatus ? eventStatus.reviewStatus.totalReviews : 0;
    const color = hasClipBeenReviewedEnough(eventStatus.reviewStatus) ? 'green' : '#EBEBEB';
    return `
    <div id="${event.id}" style="display: flex; cursor: pointer; padding: 1px; background-color: ${color};">
     <p onclick="showVideo('${event.id}')">Event time: ${getNyTime(event.timestamp)} [${event.zones.join(', ')}]</p> 
     <button id='${event.id}-valid-button' onclick="setEventValid('${event.id}', ${nextEventId}, ${reviewCount + 1})">VALID</button> 
     <button onclick="deleteEvent('${event.id}', ${nextEventId})">DELETE</button>
     <p>current review: ${reviewCount} </p>
    </div>
 `;
}

app.get("/events/:id/clip", async (req, res) => {
    try {
        const range = req.headers.range;
        if (!range || typeof range !== 'string') {
            await log.cerror('Requires Range header');
            res.status(400).send("Requires Range header");
            return;
        }
        if (!req.params.id) {
            await log.cerror('Requires id');
            res.status(400).send("Requires id");
            return;
        }

        const eventId = req.params.id;
        const paths = getEventPaths(eventId);
        const videoPath = paths.clipStagingPath;

        const videoSize = (await stat(videoPath)).size;

        const CHUNK_SIZE = 10 ** 6;
        const start = Number(range.replace(/\D/g, ""));
        const end = Math.min(start + CHUNK_SIZE, videoSize - 1);

        const contentLength = end - start + 1;
        const headers = {
            "Content-Range": `bytes ${start}-${end}/${videoSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": contentLength,
            "Content-Type": "video/mp4",
        };
        res.writeHead(206, headers);
        const videoStream = fs.createReadStream(videoPath, { start, end });
        videoStream.pipe(res);
    } catch (error) {
        res.status(400).send("clip failed to load.");
        await log.cerror(error)
    }
});


function convertLinesToHtmlBreaks(content: string) {
    return content.replaceAll('\n', '<br/>');
}

app.get('/stats', async (req, res) => {
    try {
        const summary = convertLinesToHtmlBreaks(getReportsByDate(await getDb()));

        res.send(
            `
            <html>
            <head>
            <title>Sidewalk - Summary</title>
            </head>
            <body>
                    ${summary}
            </body>
            </html>
        `);
    } catch (error) {
        res.status(400).send("failed to get status.");
        await log.cerror(error)
    }
});

app.get('/list-requests', async (req, res) => {
    const results = convertLinesToHtmlBreaks(listServiceRequests(await getDb()));

    res.send(
        `
    <html>
    <head>
    <title>Sidewalk - Summary</title>
    </head>
    <body>
            ${results}
    </body>
    </html>
`);
});

app.get('/resolution-summary', async (req, res) => {
    const summary = convertLinesToHtmlBreaks(await getResolutionSummary(await getDb()));
    res.send(
        `
    <html>
    <head>
    <title>Sidewalk - Resolution Summary</title>
    </head>
    <body>
            ${summary}
    </body>
    </html>
`);
});

app.get('/clean-staged-clips', async (req, res) => {
    try {
        await cleanStagedClips();
        res.send(`
            <html>
            <head>
            <title>Sidewalk - Clean Clips</title>
            </head>
            <body>
                    Staged clips cleaned.
            </body>
            </html>
        `);
    } catch (error) {
        res.send('Clean failed');
        await log.cerror(error)
    }
});

app.get('/check-resolutions', async (req, res) => {
    res.send(
        `
    <html>
    <head>
    <title>Sidewalk - Summary</title>
    </head>
    <body>
       starting check.
    </body>
    </html>
`);

    await checkServiceRequestResolution(await getDb());
});


app.post('/submit', async (req, res) => {
    try {
        const lastSubmissionRun = JSON.parse(await readFile(lastSubmissionRunFile, 'utf8')) as SubmissionRun;
        const lastRunTime = new Date(lastSubmissionRun.lastRunTime);
        res.send('Submitted. Click back to watch progress.');
        console.log(req.body);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        await submitEventRangeTo311(await getDb(), lastRunTime, new Date(req.body.eventTime), !!req.body.dryRun);
    } catch (error) {
        await log.cerror(error)
    }
});

export async function runWebServer() {
    await log.clog('Starting web server');
    await getDb();
    await new Promise((resolve) => {
        const server = app.listen(3010, function () {
            log.clog('Server started').catch(console.error);

            // If you wanted to test this code, you could close it here.
            // this.close()
        })
        server.on('close', resolve)
    })
    console.log('closing');
    await log.clog('After listen')
}

function toProgressMessage(current: number, total: number) {
    return JSON.stringify({ type: 'submitProgress', current, total });
}

setInterval(() => {
    if (isSubmitting) {
        const message = toProgressMessage(eventsSubmittedInCurrentBatch, eventCountInCurrentBatch);
        wss.clients.forEach((client) => { client.send(message); });
    }
    wss.clients.forEach((client) => { client.ping(); });
}, 10000);
