/**
 * Multi-DB reader for WhatsApp server (wajom-client) instance databases.
 *
 * Arsitektur:
 *   - DB utama Wajom (users, whatsapps, sales, ...) → WAJOM_DB_PATH
 *   - Setiap WhatsApp device punya WA server instance di port tertentu
 *     (whatsapps.port). Setiap instance punya SQLite DB sendiri di
 *     `{WA_SERVER_DB_DIR}/{port}.sqlite3` (production) berisi tabel
 *     `queue` (outbound messages) dan `bailey_messages` (all messages).
 *
 * Relasi ke user_id tidak langsung: whatsapps.port → {port}.sqlite3.
 * Tidak ada kolom user_id di WA server DB; join dilakukan via port.
 *
 * Semua akses read-only (readonly: true + query_only = 1), sama seperti
 * DB utama. DB per instance dibuka lazy dan di-cache per session.
 */

import Database from "better-sqlite3";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

export interface WaServerDbSchema {
  hasQueue: boolean;
  hasBaileyMessages: boolean;
}

const SCHEMA_CACHE = new Map<string, WaServerDbSchema>();
const TABLE_CACHE = new Map<string, Set<string>>();

function loadTables(path: string): Set<string> {
  const cached = TABLE_CACHE.get(path);
  if (cached) return cached;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string }[];
    const set = new Set(rows.map((r) => r.name));
    TABLE_CACHE.set(path, set);
    return set;
  } finally {
    db.close();
  }
}

function schemaOf(path: string): WaServerDbSchema {
  const cached = SCHEMA_CACHE.get(path);
  if (cached) return cached;
  const tables = loadTables(path);
  const s: WaServerDbSchema = {
    hasQueue: tables.has("queue"),
    hasBaileyMessages: tables.has("bailey_messages"),
  };
  SCHEMA_CACHE.set(path, s);
  return s;
}

/**
 * Resolve path ke WA server DB untuk port tertentu.
 * Mencoba beberapa kandidat (prioritas: yang paling spesifik ke port):
 *   1. {dbDir}/prod-{port}.sqlite3   (production pattern dari knexfile)
 *   2. {dbDir}/{port}.sqlite3        (alt production / staging)
 *   3. {dbDir}/devdb.sqlite3         (dev fallback, single instance)
 *   4. {dbDir}/{port}/devdb.sqlite3
 *
 * Untuk dev dengan multiple stale DBs, pilih yang paling baru (mtime)
 * di antara kandidat yang ada — dev sering punya 6543.sqlite3 (lama)
 * dan devdb.sqlite3 (baru) untuk port yang sama.
 */
export function resolveWaServerDb(
  dbDir: string,
  port: string | number
): string | null {
  const candidates = [
    resolve(dbDir, `prod-${port}.sqlite3`),
    resolve(dbDir, `${port}.sqlite3`),
    resolve(dbDir, "devdb.sqlite3"),
    resolve(dbDir, String(port), "devdb.sqlite3"),
  ];
  const existing = candidates.filter((c) => existsSync(c));
  if (existing.length === 0) return null;
  if (existing.length === 1) return existing[0];
  // Multiple matches: pick the most recently modified.
  let best = existing[0];
  let bestMtime = 0;
  for (const c of existing) {
    const stat = statSync(c);
    if (stat.mtimeMs > bestMtime) {
      bestMtime = stat.mtimeMs;
      best = c;
    }
  }
  return best;
}

/**
 * Query queue table di WA server DB untuk port tertentu.
 * Return rows atau empty array kalau DB/tabel tidak ada.
 */
export function queryQueue<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
  ...params: unknown[]
): T[] {
  const s = schemaOf(dbPath);
  if (!s.hasQueue) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("query_only = 1");
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/**
 * Query one row dari queue table di WA server DB.
 */
export function queryQueueOne<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
  ...params: unknown[]
): T | undefined {
  const s = schemaOf(dbPath);
  if (!s.hasQueue) return undefined;
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("query_only = 1");
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

/**
 * Query bailey_messages table di WA server DB.
 */
export function queryBaileyMessages<T = Record<string, unknown>>(
  dbPath: string,
  sql: string,
  ...params: unknown[]
): T[] {
  const s = schemaOf(dbPath);
  if (!s.hasBaileyMessages) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("query_only = 1");
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** Cek apakah WA server DB ada dan punya tabel queue. */
export function hasQueueTable(dbPath: string): boolean {
  return schemaOf(dbPath).hasQueue;
}

/** Cek apakah WA server DB ada dan punya tabel bailey_messages. */
export function hasBaileyMessagesTable(dbPath: string): boolean {
  return schemaOf(dbPath).hasBaileyMessages;
}
