// services/offlineQueue.ts
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('sage_offline.db');

export function queueWrite(collection: string, operation: string, payload: object) {
  db.runSync(
    `INSERT INTO sync_queue (collection, operation, payload, created_at) VALUES (?, ?, ?, ?)`,
    [collection, operation, JSON.stringify(payload), new Date().toISOString()]
  );
}

export function getPendingWrites(): any[] {
  return db.getAllSync(`SELECT * FROM sync_queue WHERE is_synced = 0`);
}

export function markSynced(id: number) {
  db.runSync(`UPDATE sync_queue SET is_synced = 1 WHERE id = ?`, [id]);
}

export function initOfflineQueue() {
  db.runSync(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0
    )
  `);
}