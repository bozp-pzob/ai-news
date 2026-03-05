/**
 * Drizzle ORM migration runner.
 *
 * Reads SQL migrations from the `drizzle/` directory and applies any
 * that haven't been run yet.  Uses a `__drizzle_migrations` journal
 * table (created automatically) to track applied migrations.
 *
 * For existing databases that pre-date Drizzle, the initial migration
 * (0000_*) is automatically "stamped" as already applied when the
 * platform tables are detected but the Drizzle journal table is not.
 *
 * Called during platform database initialization — errors are logged
 * but treated as non-fatal so the server can still start.
 *
 * @module db/migrate
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import fs from 'fs';
import { logger } from '../helpers/cliHelper';

/** Absolute path to the drizzle migrations folder */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../drizzle');

/**
 * For existing databases: stamp the initial (0000_*) migration as already
 * applied so Drizzle doesn't try to re-create tables that already exist.
 *
 * This only runs when:
 *  1. The `users` table exists (i.e. the platform schema is already live)
 *  2. The `__drizzle_migrations` table does NOT exist (first Drizzle run)
 */
async function stampBaselineIfNeeded(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Check if platform tables already exist
    const tablesResult = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const hasExistingTables = tablesResult.rows.length > 0;

    if (!hasExistingTables) {
      // Fresh database — let Drizzle create everything from scratch
      return;
    }

    // Check if Drizzle journal already exists in the `drizzle` schema
    // (Drizzle ORM uses `drizzle.__drizzle_migrations`, not `public.__drizzle_migrations`)
    const journalResult = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    `);
    const hasDrizzleJournal = journalResult.rows.length > 0;

    if (hasDrizzleJournal) {
      // Check if the table already has at least one entry (fully stamped)
      const entryResult = await client.query(`
        SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1
      `);
      if (entryResult.rows.length > 0) {
        // Drizzle has already been initialized — nothing to stamp
        return;
      }
    }

    // Read the journal to find the initial migration hash
    const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
    if (!fs.existsSync(journalPath)) {
      logger.warn('Drizzle: No journal found at', journalPath, '— skipping baseline stamp');
      return;
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    const firstEntry = journal.entries?.[0];
    if (!firstEntry) {
      logger.warn('Drizzle: Journal has no entries — skipping baseline stamp');
      return;
    }

    // Create the Drizzle migrations table in the `drizzle` schema and stamp the initial migration
    // Drizzle ORM uses drizzle.__drizzle_migrations (not public.__drizzle_migrations)
    logger.info('Drizzle: Existing database detected — stamping initial migration as applied');
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `);

    // Read the migration SQL to compute the hash Drizzle would use
    // Drizzle stores the migration file content hash
    const migrationSqlPath = path.join(MIGRATIONS_DIR, `${firstEntry.tag}.sql`);
    if (!fs.existsSync(migrationSqlPath)) {
      logger.warn('Drizzle: Migration SQL not found:', migrationSqlPath);
      return;
    }

    const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(migrationSql).digest('hex');

    // Check if already stamped (idempotent)
    const existingResult = await client.query(
      'SELECT 1 FROM drizzle."__drizzle_migrations" WHERE hash = $1',
      [hash]
    );
    if (existingResult.rows.length > 0) {
      return;
    }

    await client.query(
      'INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
      [hash, firstEntry.when]
    );

    logger.info('Drizzle: Baseline migration stamped successfully:', firstEntry.tag);
  } finally {
    client.release();
  }
}

/**
 * Run all pending Drizzle migrations against the given pool.
 *
 * @param pool — The `pg.Pool` that's already connected to the platform database.
 * @returns `true` if migrations ran (or were already up-to-date), `false` on error.
 */
export async function runDrizzleMigrations(pool: Pool): Promise<boolean> {
  try {
    // For existing databases, stamp the baseline migration first
    await stampBaselineIfNeeded(pool);

    const db = drizzle(pool);

    logger.info('Drizzle: Running migrations from', MIGRATIONS_DIR);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    logger.info('Drizzle: Migrations completed successfully');
    return true;
  } catch (error) {
    logger.error('Drizzle: Migration error (non-fatal)', error);
    return false;
  }
}
