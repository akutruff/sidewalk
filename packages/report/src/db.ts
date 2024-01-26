import { createDatabase, loadDatabase, saveDatabase, saveDatabaseSync } from './database.js';
import { buildDatabase } from './frigate.js';
import type { EventDatabase } from './types.js';

let db: EventDatabase | undefined = undefined;

export async function getDb() {
    if (db == undefined) {
        db = await loadDatabase();
    }
    return db;
}

export async function rebuildDatabase() {
    db = createDatabase();
    await buildDatabase(db);
    await saveDatabase(db);
}

export function saveDb() {
    if (db) {
        saveDatabaseSync(db);
    }
}