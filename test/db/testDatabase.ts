/**
 * SQLite in-memory test database
 *
 * Provides a lightweight, self-contained database environment for integration
 * tests. It implements the same `query(sql, params)` interface as
 * `databaseService` so route handlers run real business logic against SQLite
 * instead of PostgreSQL — with zero external dependencies.
 *
 * Translation layer handles the main PostgreSQL → SQLite differences:
 *   - Parameter placeholders: $1, $2 → ?, ?
 *   - Date functions: NOW() → datetime('now'), CURRENT_DATE → date('now')
 *   - Types in DDL: UUID/JSONB/BOOLEAN/BYTEA → SQLite equivalents
 *   - INSERT … RETURNING *: execute then fetch by last_insert_rowid()
 */

import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { randomUUID } from 'crypto';

// ─── Singleton db ──────────────────────────────────────────────────────────

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) throw new Error('Test database not initialised — call initTestDatabase() first');
  return _db;
}

// ─── Schema ────────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  privy_id    TEXT NOT NULL UNIQUE,
  email       TEXT,
  wallet_address TEXT,
  tier        TEXT NOT NULL DEFAULT 'free',
  settings    TEXT DEFAULT '{}',
  ai_calls_today             INTEGER DEFAULT 0,
  ai_calls_today_reset_at    TEXT    DEFAULT (date('now')),
  tokens_used_today          INTEGER DEFAULT 0,
  tokens_used_today_reset_at TEXT    DEFAULT (date('now')),
  estimated_cost_today_cents INTEGER DEFAULT 0,
  free_run_used_at TEXT,
  is_banned   INTEGER DEFAULT 0,
  banned_at   TEXT,
  banned_reason TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT,
  visibility   TEXT NOT NULL DEFAULT 'private',
  storage_type TEXT NOT NULL DEFAULT 'platform',
  config_json  TEXT NOT NULL DEFAULT '{}',
  secrets      BLOB,
  status       TEXT DEFAULT 'idle',
  last_run_at  TEXT,
  last_run_duration_ms INTEGER,
  last_error   TEXT,
  global_interval INTEGER,
  active_job_id TEXT,
  cron_expression TEXT,
  schedule_timezone TEXT DEFAULT 'UTC',
  runs_today   INTEGER DEFAULT 0,
  runs_today_reset_at TEXT DEFAULT (date('now')),
  total_items  INTEGER DEFAULT 0,
  total_queries INTEGER DEFAULT 0,
  total_revenue REAL DEFAULT 0,
  is_local_execution INTEGER DEFAULT 0,
  hide_items   INTEGER DEFAULT 0,
  is_featured  INTEGER DEFAULT 0,
  featured_at  TEXT,
  monetization_enabled INTEGER DEFAULT 0,
  price_per_query REAL DEFAULT 0.001,
  owner_wallet TEXT,
  external_db_url TEXT,
  external_db_valid INTEGER,
  external_db_error TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS config_shares (
  id                   TEXT PRIMARY KEY,
  config_id            TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  shared_with_user_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
  shared_with_wallet   TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aggregation_jobs (
  id           TEXT PRIMARY KEY,
  config_id    TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type     TEXT DEFAULT 'one-time',
  global_interval INTEGER,
  status       TEXT DEFAULT 'pending',
  started_at   TEXT,
  completed_at TEXT,
  items_fetched    INTEGER DEFAULT 0,
  items_processed  INTEGER DEFAULT 0,
  run_count        INTEGER DEFAULT 1,
  last_fetch_at    TEXT,
  total_prompt_tokens     INTEGER DEFAULT 0,
  total_completion_tokens INTEGER DEFAULT 0,
  total_ai_calls          INTEGER DEFAULT 0,
  estimated_cost_usd      REAL DEFAULT 0,
  error_message TEXT,
  logs          TEXT DEFAULT '[]',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config_access_grants (
  id           TEXT PRIMARY KEY,
  config_id    TEXT NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
  user_id      TEXT,
  wallet_address TEXT NOT NULL,
  amount       REAL NOT NULL,
  platform_fee REAL DEFAULT 0,
  tx_signature TEXT UNIQUE,
  memo         TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
);
`;

// ─── Initialise / teardown ─────────────────────────────────────────────────

export async function initTestDatabase(): Promise<Database> {
  _db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await _db.exec(SCHEMA);
  return _db;
}

export async function closeTestDatabase(): Promise<void> {
  if (_db) {
    await _db.close();
    _db = null;
  }
}

/** Wipe all rows between tests — faster than re-creating the schema */
export async function clearTestDatabase(): Promise<void> {
  const db = getDb();
  // Disable FKs temporarily so deletion order doesn't matter
  await db.exec('PRAGMA foreign_keys = OFF');
  await db.exec(`
    DELETE FROM config_access_grants;
    DELETE FROM aggregation_jobs;
    DELETE FROM config_shares;
    DELETE FROM configs;
    DELETE FROM users;
  `);
  await db.exec('PRAGMA foreign_keys = ON');
}

// ─── Query translation ─────────────────────────────────────────────────────

/**
 * Translate a PostgreSQL-flavoured SQL string into SQLite-compatible SQL.
 * Handles the subset of PG syntax used in this codebase.
 */
function translateSql(sql: string): string {
  return sql
    // Positional params:  $1, $2 → ?, ?
    .replace(/\$\d+/g, '?')
    // Date helpers
    .replace(/\bCURRENT_DATE\b/gi, "date('now')")
    .replace(/\bNOW\s*\(\s*\)/gi, "datetime('now')")
    // UUID generator
    .replace(/gen_random_uuid\s*\(\s*\)/gi, "(lower(hex(randomblob(16))))")
    // DDL type mapping
    .replace(/\bUUID\b(?!\s*\()/g, 'TEXT')
    .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT')
    .replace(/\bTIMESTAMP\s+WITH\s+TIME\s+ZONE\b/gi, 'TEXT')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/\bBYTEA\b/gi, 'BLOB')
    .replace(/\bDECIMAL\s*\([^)]+\)/gi, 'REAL')
    .replace(/\bNUMERIC\s*\([^)]+\)/gi, 'REAL')
    .replace(/\bSERIAL\b/gi, 'INTEGER')
    .replace(/\bBIGSERIAL\b/gi, 'INTEGER')
    // bigint(mode:'number') in Drizzle → just INTEGER in raw SQL
    .replace(/\bBIGINT\b/gi, 'INTEGER')
    // PG-specific index options ignored by SQLite
    .replace(/\bCONCURRENTLY\b/gi, '')
    // IF NOT EXISTS on ALTER TABLE column (SQLite 3.35+)
    .replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, 'ADD COLUMN IF NOT EXISTS');
}

/** Extract the table name from an INSERT INTO … statement */
function extractInsertTable(sql: string): string | null {
  const m = sql.match(/INSERT\s+INTO\s+["']?(\w+)["']?/i);
  return m ? m[1] : null;
}

/** Strip the RETURNING … clause from the end of a DML statement */
function stripReturning(sql: string): string {
  return sql.replace(/\s+RETURNING\s+.+$/is, '');
}

// ─── Core query function ───────────────────────────────────────────────────

/**
 * Execute a PostgreSQL-style parameterised query against the SQLite test DB.
 * Returns `{ rows: any[] }` matching the databaseService interface.
 */
export async function testQuery(
  sql: string,
  params: any[] = []
): Promise<{ rows: any[] }> {
  const db = getDb();
  const hasReturning = /\bRETURNING\b/i.test(sql);
  const translated = translateSql(sql);
  const upper = translated.trimStart().toUpperCase();

  // ── SELECT / WITH ────────────────────────────────────────────────────────
  if (upper.startsWith('SELECT') || upper.startsWith('WITH')) {
    const rows = await db.all(translated, params);
    return { rows };
  }

  // ── INSERT … RETURNING * ────────────────────────────────────────────────
  if (upper.startsWith('INSERT') && hasReturning) {
    const tableName = extractInsertTable(translated);
    const insertSql = stripReturning(translated);
    await db.run(insertSql, params);
    if (tableName) {
      const row = await db.get(
        `SELECT * FROM "${tableName}" WHERE rowid = last_insert_rowid()`
      );
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  }

  // ── UPDATE … RETURNING * ─────────────────────────────────────────────────
  if (upper.startsWith('UPDATE') && hasReturning) {
    const updateSql = stripReturning(translated);
    const tableName = updateSql.match(/UPDATE\s+["']?(\w+)["']?/i)?.[1];
    await db.run(updateSql, params);
    // Return the updated row if we can identify it from params / WHERE clause
    // For simplicity return empty — callers that need the row do a separate SELECT
    if (tableName) {
      // Try to find last modified row by updated_at timestamp if the column exists
      const row = await db.get(
        `SELECT * FROM "${tableName}" WHERE rowid = last_insert_rowid()`
      ).catch(() => null);
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  }

  // ── DDL & other DML ──────────────────────────────────────────────────────
  try {
    await db.run(translated, params);
  } catch (err: any) {
    // Silently swallow "duplicate column" errors from ADD COLUMN IF NOT EXISTS
    // and similar idempotent migration DDL that may already be satisfied by
    // the pre-built schema above.
    const msg: string = err?.message ?? '';
    if (
      msg.includes('duplicate column name') ||
      msg.includes('already exists') ||
      msg.includes('no such table') && upper.startsWith('DROP')
    ) {
      // benign — schema already correct
      return { rows: [] };
    }
    throw err;
  }
  return { rows: [] };
}

// ─── Convenience helpers for tests ────────────────────────────────────────

/** Insert a test user and return the full row */
export async function createDbUser(overrides: Partial<{
  id: string;
  privy_id: string;
  email: string;
  tier: 'free' | 'paid' | 'admin';
  free_run_used_at: string | null;
}> = {}): Promise<any> {
  const id = overrides.id ?? randomUUID();
  const privyId = overrides.privy_id ?? `privy-${id}`;
  const db = getDb();
  await db.run(
    `INSERT INTO users (id, privy_id, email, tier, free_run_used_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      privyId,
      overrides.email ?? `test-${id}@example.com`,
      overrides.tier ?? 'free',
      overrides.free_run_used_at ?? null,
    ]
  );
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}

/** Insert a test config and return the full row */
export async function createDbConfig(
  userId: string,
  overrides: Partial<{
    id: string;
    name: string;
    slug: string;
    visibility: string;
    config_json: string;
  }> = {}
): Promise<any> {
  const id = overrides.id ?? randomUUID();
  const name = overrides.name ?? `Config ${id.slice(0, 6)}`;
  const slug = overrides.slug ?? `config-${id.slice(0, 6)}`;
  const db = getDb();
  await db.run(
    `INSERT INTO configs (id, user_id, name, slug, visibility, config_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      name,
      slug,
      overrides.visibility ?? 'private',
      overrides.config_json ?? '{"sources":[],"generators":[]}',
    ]
  );
  return db.get('SELECT * FROM configs WHERE id = ?', [id]);
}
