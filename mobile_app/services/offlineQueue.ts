// services/offlineQueue.ts
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

let db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase | null {
  if (Platform.OS === 'web') return null;
  if (!db) db = SQLite.openDatabaseSync('sage_offline.db');
  return db;
}

export function queueWrite(collection: string, operation: string, payload: object) {
  const d = getDb();
  if (!d) return;
  d.runSync(
    `INSERT INTO sync_queue (collection, operation, payload, created_at) VALUES (?, ?, ?, ?)`,
    [collection, operation, JSON.stringify(payload), new Date().toISOString()]
  );
}

export function getPendingWrites(): any[] {
  const d = getDb();
  if (!d) return [];
  return d.getAllSync(`SELECT * FROM sync_queue WHERE is_synced = 0`);
}

export function markSynced(id: number) {
  const d = getDb();
  if (!d) return;
  d.runSync(`UPDATE sync_queue SET is_synced = 1 WHERE id = ?`, [id]);
}

export function initOfflineQueue() {
  const d = getDb();
  if (!d) return;
  d.runSync(`
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