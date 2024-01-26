
import fs from "fs";
import { buildDatabase } from './frigate.js';

import { readFileAsJson, writeFileAsJson, writeFileAsJsonSync } from './serialization.js';
import type { EventDatabase, EventState } from './types.js';
import path from 'path';

if (!process.env.DB_PATH) {
    throw new Error('DB_PATH not set!');
}
export const databasePath = path.join(process.env.DB_PATH!, 'database.json');

export function createDatabase(): EventDatabase {
    return {
        events: new Map()
    };
}

export function saveDatabase(db: EventDatabase) {
    return writeFileAsJson(databasePath, db);
}

export function saveDatabaseSync(db: EventDatabase) {
    return writeFileAsJsonSync(databasePath, db);
}

export async function loadDatabase() {
    const db: EventDatabase = fs.existsSync(databasePath) ?
        await readFileAsJson<EventDatabase>(databasePath) :
        createDatabase();
    await buildDatabase(db);
    await saveDatabase(db);
    return db;
}

export function exists(db: EventDatabase, eventId: string) {
    return db.events.has(eventId);
}

export function createInDb(db: EventDatabase, eventId: string, newEntry: EventState) {
    const eventState = db.events.get(eventId);
    if (eventState) {
        throw new Error(`event ${eventId} already exists in db`);
    }

    db.events.set(eventId, newEntry);
    // await saveDatabase(db);
}

export function updateDb(db: EventDatabase, eventId: string, saveFunction: (eventEntry: EventState) => EventState) {
    const eventState = db.events.get(eventId);
    if (!eventState) {
        throw new Error(`event ${eventId} not found in db`);
    }

    const newEntry = saveFunction(eventState);
    db.events.set(eventId, newEntry);
    // await saveDatabase(db);
}
