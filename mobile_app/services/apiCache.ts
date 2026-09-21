import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('sage_cache.db');

export interface ApiCacheHit {
  body: string;
  fetchedAt: number;
  ttlSeconds: number;
}

let currentUserId: number | null = null;
let initialized = false;

/** Scope cache keys to the signed-in user so accounts never see each other's data. */
export function setCacheUserId(id: number | null) {
  currentUserId = id;
}

export function getCacheUserId(): number | null {
  return currentUserId;
}

export function initApiCache() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS http_cache (
      cache_key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL
    );
  `);
  // Prune expired rows on startup so the DB never balloons.
  db.runSync('DELETE FROM http_cache WHERE fetched_at + (ttl_seconds * 1000) < ?', [Date.now()]);
  initialized = true;
}

/** Lazily init so reads are safe even before the root layout effect runs. */
function ensureInitialized() {
  if (!initialized) initApiCache();
}

export function getCachedResponse(key: string): ApiCacheHit | null {
  ensureInitialized();
  const row = db.getFirstSync<{ body: string; fetched_at: number; ttl_seconds: number }>(
    'SELECT body, fetched_at, ttl_seconds FROM http_cache WHERE cache_key = ?',
    [key]
  );
  if (!row) return null;
  return { body: row.body, fetchedAt: row.fetched_at, ttlSeconds: row.ttl_seconds };
}

export function setCachedResponse(key: string, body: string, ttlSeconds: number) {
  ensureInitialized();
  db.runSync(
    `INSERT INTO http_cache (cache_key, body, fetched_at, ttl_seconds) VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       body = excluded.body,
       fetched_at = excluded.fetched_at,
       ttl_seconds = excluded.ttl_seconds`,
    [key, body, Date.now(), ttlSeconds]
  );
}

/** Drop cached rows whose URL contains prefix (used to invalidate after writes). */
export function invalidateCachePrefix(prefix: string) {
  ensureInitialized();
  db.runSync('DELETE FROM http_cache WHERE cache_key LIKE ?', [`%${prefix}%`]);
}

export function clearApiCache() {
  ensureInitialized();
  db.runSync('DELETE FROM http_cache');
}

/** Parse a stored body, returning null for corrupt rows so callers fall through to the network. */
export function parseCached<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}