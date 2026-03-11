// src/services/databaseService.ts

import { Pool, PoolClient } from 'pg';
import { PostgresStorage } from '../plugins/storage/PostgresStorage';
import { encryptionService } from './encryptionService';
import { logger } from '../helpers/cliHelper';
import { runDrizzleMigrations } from '../db/migrate';

/**
 * Database validation result
 */
export interface DatabaseValidationResult {
  valid: boolean;
  error?: string;
  hasVectorExtension?: boolean;
  hasTables?: boolean;
}

/**
 * Content tables SQL for external databases
 */
const CONTENT_TABLES_SQL = `
-- Enable pgvector if not exists (user must have superuser or extension permission)
CREATE EXTENSION IF NOT EXISTS vector;

-- Content items table
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL,
  cid TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  text TEXT,
  link TEXT,
  topics TEXT[],
  date BIGINT,
  metadata JSONB,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, cid)
);

-- Summaries table
CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  categories JSONB,
  markdown TEXT,
  date BIGINT,
  content_hash TEXT,
  start_date BIGINT,
  end_date BIGINT,
  granularity TEXT DEFAULT 'daily',
  metadata JSONB,
  tokens_used INTEGER,
  estimated_cost_usd REAL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, type, date, COALESCE(granularity, 'daily'))
);

-- Cursors table
CREATE TABLE IF NOT EXISTS cursors (
  id SERIAL PRIMARY KEY,
  config_id UUID NOT NULL,
  cid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, cid)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_items_config ON items(config_id);
CREATE INDEX IF NOT EXISTS idx_items_config_date ON items(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_items_config_type ON items(config_id, type);
CREATE INDEX IF NOT EXISTS idx_summaries_config ON summaries(config_id);
CREATE INDEX IF NOT EXISTS idx_summaries_config_date ON summaries(config_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cursors_config ON cursors(config_id);
`;

/**
 * Platform database pool singleton
 */
let platformPool: Pool | null = null;

/**
 * Cache of external database connections
 */
const externalPools: Map<string, Pool> = new Map();

/**
 * Run custom SQL that Drizzle ORM cannot generate:
 *   - Partial/filtered indexes (WHERE clauses)
 *   - Expression-based unique indexes (COALESCE)
 *   - Legacy constraint migration (PL/pgSQL DO block)
 *   - pgvector extension & embedding columns
 *
 * All statements are idempotent — safe to run on every startup.
 * Table DDL is handled by Drizzle migrations (see src/db/migrate.ts).
 */
async function runCustomSQL(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // ── pgvector extension & embedding columns ──────────────────────
    // Silently skip if extension isn't available (e.g. local dev without pgvector)
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query('ALTER TABLE items ADD COLUMN IF NOT EXISTS embedding vector(1536)');
      await client.query('ALTER TABLE summaries ADD COLUMN IF NOT EXISTS embedding vector(1536)');
    } catch {
      logger.warn('DatabaseService: pgvector not available — embedding columns skipped');
    }

    // ── Partial / filtered indexes ─────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_banned
      ON users(is_banned) WHERE is_banned = TRUE
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_configs_featured
      ON configs(is_featured, featured_at DESC) WHERE is_featured = TRUE
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_buffer_pending
      ON webhook_buffer(webhook_id, processed) WHERE processed = FALSE
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_configs_cron_active
      ON configs(cron_expression) WHERE cron_expression IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_outbound_webhooks_config_active
      ON outbound_webhooks(config_id, is_active) WHERE is_active = TRUE
    `);

    // ── Expression-based unique indexes ────────────────────────────

    // Legacy constraint migration: drop old 3-column unique on summaries
    // before creating the new expression-based unique index.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE c.conrelid = 'summaries'::regclass
            AND c.contype = 'u'
            AND n.nspname = 'public'
            AND NOT EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.conrelid
                AND a.attnum = ANY(c.conkey)
                AND a.attname = 'granularity'
            )
            AND array_length(c.conkey, 1) = 3
        )
        THEN
          EXECUTE (
            SELECT 'ALTER TABLE summaries DROP CONSTRAINT ' || quote_ident(c.conname)
            FROM pg_constraint c
            JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE c.conrelid = 'summaries'::regclass
              AND c.contype = 'u'
              AND n.nspname = 'public'
              AND NOT EXISTS (
                SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.conrelid
                  AND a.attnum = ANY(c.conkey)
                  AND a.attname = 'granularity'
              )
              AND array_length(c.conkey, 1) = 3
            LIMIT 1
          );
        END IF;
      END $$
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_config_type_date_granularity
      ON summaries (config_id, type, date, COALESCE(granularity, 'daily'))
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_site_parsers_unique
      ON site_parsers(domain, path_pattern, COALESCE(object_type_string, ''))
    `);

    // ── Functions ───────────────────────────────────────────────────
    // All use CREATE OR REPLACE — safe to run on every startup.

    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION reset_daily_runs()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.runs_today_reset_at < CURRENT_DATE THEN
          NEW.runs_today = 0;
          NEW.runs_today_reset_at = CURRENT_DATE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION reset_daily_ai_calls()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.ai_calls_today_reset_at < CURRENT_DATE THEN
          NEW.ai_calls_today = 0;
          NEW.ai_calls_today_reset_at = CURRENT_DATE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION reset_daily_token_usage()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.tokens_used_today_reset_at < CURRENT_DATE THEN
          NEW.tokens_used_today = 0;
          NEW.estimated_cost_today_cents = 0;
          NEW.tokens_used_today_reset_at = CURRENT_DATE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION update_config_item_count()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          UPDATE configs SET total_items = total_items + 1 WHERE id = NEW.config_id;
        ELSIF TG_OP = 'DELETE' THEN
          UPDATE configs SET total_items = total_items - 1 WHERE id = OLD.config_id;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION update_config_revenue()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.status = 'settled' AND (OLD.status IS NULL OR OLD.status != 'settled') THEN
          UPDATE configs
          SET total_revenue = total_revenue + NEW.owner_revenue,
              total_queries = total_queries + 1
          WHERE id = NEW.config_id;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION generate_slug(name TEXT)
      RETURNS TEXT AS $$
      BEGIN
        RETURN lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\\s-]', '', 'g'), '\\s+', '-', 'g'));
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION reset_free_run_used()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.free_run_used_at IS NOT NULL AND NEW.free_run_used_at < CURRENT_DATE THEN
          NEW.free_run_used_at = NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION mark_inactive_discord_connections(guild_ids TEXT[])
      RETURNS INTEGER AS $$
      DECLARE
        updated_count INTEGER;
      BEGIN
        UPDATE discord_guild_connections
        SET is_active = FALSE, updated_at = NOW()
        WHERE guild_id = ANY(guild_ids) AND is_active = TRUE;
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        RETURN updated_count;
      END;
      $$ LANGUAGE plpgsql
    `);

    // ── Cleanup functions ───────────────────────────────────────────

    await client.query(`
      CREATE OR REPLACE FUNCTION cleanup_expired_temp_retention()
      RETURNS INTEGER AS $$
      DECLARE
        deleted_count INTEGER;
      BEGIN
        DELETE FROM temp_retention WHERE expires_at < NOW();
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION cleanup_old_api_usage()
      RETURNS INTEGER AS $$
      DECLARE
        deleted_count INTEGER;
      BEGIN
        DELETE FROM api_usage WHERE created_at < NOW() - INTERVAL '90 days';
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION cleanup_expired_discord_oauth_states()
      RETURNS INTEGER AS $$
      DECLARE
        deleted_count INTEGER;
      BEGIN
        DELETE FROM discord_oauth_states WHERE expires_at < NOW();
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION cleanup_old_aggregation_jobs(retention_days INTEGER DEFAULT 90)
      RETURNS INTEGER AS $$
      DECLARE
        deleted_count INTEGER;
      BEGIN
        DELETE FROM aggregation_jobs
        WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL
          AND status != 'running';
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        RETURN deleted_count;
      END;
      $$ LANGUAGE plpgsql
    `);

    // ── Triggers ────────────────────────────────────────────────────
    // DROP IF EXISTS + CREATE ensures idempotency.

    // updated_at triggers
    await client.query(`DROP TRIGGER IF EXISTS users_updated_at ON users`);
    await client.query(`CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at()`);

    await client.query(`DROP TRIGGER IF EXISTS configs_updated_at ON configs`);
    await client.query(`CREATE TRIGGER configs_updated_at BEFORE UPDATE ON configs FOR EACH ROW EXECUTE FUNCTION update_updated_at()`);

    await client.query(`DROP TRIGGER IF EXISTS cursors_updated_at ON cursors`);
    await client.query(`CREATE TRIGGER cursors_updated_at BEFORE UPDATE ON cursors FOR EACH ROW EXECUTE FUNCTION update_updated_at()`);

    await client.query(`DROP TRIGGER IF EXISTS discord_guild_connections_updated_at ON discord_guild_connections`);
    await client.query(`CREATE TRIGGER discord_guild_connections_updated_at BEFORE UPDATE ON discord_guild_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at()`);

    // Daily reset triggers
    await client.query(`DROP TRIGGER IF EXISTS configs_reset_runs ON configs`);
    await client.query(`CREATE TRIGGER configs_reset_runs BEFORE UPDATE ON configs FOR EACH ROW EXECUTE FUNCTION reset_daily_runs()`);

    await client.query(`DROP TRIGGER IF EXISTS users_reset_ai_calls ON users`);
    await client.query(`CREATE TRIGGER users_reset_ai_calls BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reset_daily_ai_calls()`);

    await client.query(`DROP TRIGGER IF EXISTS users_reset_token_usage ON users`);
    await client.query(`CREATE TRIGGER users_reset_token_usage BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reset_daily_token_usage()`);

    await client.query(`DROP TRIGGER IF EXISTS users_reset_free_run ON users`);
    await client.query(`CREATE TRIGGER users_reset_free_run BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reset_free_run_used()`);

    // Stats triggers
    await client.query(`DROP TRIGGER IF EXISTS items_update_count ON items`);
    await client.query(`CREATE TRIGGER items_update_count AFTER INSERT OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION update_config_item_count()`);

    await client.query(`DROP TRIGGER IF EXISTS payments_update_revenue ON payments`);
    await client.query(`CREATE TRIGGER payments_update_revenue AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_config_revenue()`);

    // ── Views ───────────────────────────────────────────────────────
    // All use CREATE OR REPLACE — safe to run on every startup.

    await client.query(`
      CREATE OR REPLACE VIEW public_configs AS
      SELECT
        c.id,
        c.slug,
        c.name,
        c.description,
        c.monetization_enabled,
        c.price_per_query,
        c.total_items,
        c.total_queries,
        c.last_run_at,
        c.created_at,
        u.wallet_address as owner_wallet,
        (SELECT COUNT(*) FROM items WHERE config_id = c.id AND date > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')) as items_last_24h
      FROM configs c
      JOIN users u ON c.user_id = u.id
      WHERE c.visibility = 'public'
    `);

    await client.query(`
      CREATE OR REPLACE VIEW featured_configs AS
      SELECT
        c.id,
        c.slug,
        c.name,
        c.description,
        c.monetization_enabled,
        c.price_per_query,
        c.total_items,
        c.total_queries,
        c.last_run_at,
        c.featured_at,
        c.created_at,
        u.wallet_address as owner_wallet
      FROM configs c
      JOIN users u ON c.user_id = u.id
      WHERE c.is_featured = TRUE
        AND c.visibility IN ('public', 'unlisted')
      ORDER BY c.featured_at DESC
    `);

    await client.query(`
      CREATE OR REPLACE VIEW user_revenue_summary AS
      SELECT
        c.user_id,
        SUM(p.amount) as total_volume,
        SUM(p.owner_revenue) as total_revenue,
        SUM(p.platform_fee) as total_platform_fees,
        COUNT(p.id) as total_transactions,
        COUNT(DISTINCT p.payer_wallet) as unique_payers
      FROM payments p
      JOIN configs c ON p.config_id = c.id
      WHERE p.status = 'settled'
      GROUP BY c.user_id
    `);

    logger.info('DatabaseService: Custom SQL completed successfully');
  } catch (error) {
    logger.error('DatabaseService: Custom SQL error (non-fatal)', error);
    // Don't throw — custom SQL is best-effort
  } finally {
    client.release();
  }
}

/**
 * Initialize the platform database connection
 */
export async function initPlatformDatabase(): Promise<void> {
  if (platformPool) {
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  platformPool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  const client = await platformPool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('DatabaseService: Platform database connected successfully');
  } finally {
    client.release();
  }

  // Run Drizzle migrations (table DDL), then custom SQL (partial indexes, pgvector, etc.)
  await runDrizzleMigrations(platformPool);
  await runCustomSQL(platformPool);
}

/**
 * Get the platform database pool
 */
export function getPlatformPool(): Pool {
  if (!platformPool) {
    throw new Error('Platform database not initialized. Call initPlatformDatabase() first.');
  }
  return platformPool;
}

/**
 * Execute a query on the platform database
 */
export async function query(text: string, params?: any[]): Promise<any> {
  const pool = getPlatformPool();
  return pool.query(text, params);
}

/**
 * Get a client from the platform pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPlatformPool();
  return pool.connect();
}

/**
 * Create a PostgresStorage instance for the platform database
 */
export function getPlatformStorage(configId: string): PostgresStorage {
  const storage = new PostgresStorage({
    name: 'platform',
    connectionString: process.env.DATABASE_URL,
    configId
  });
  return storage;
}

/**
 * Validate an external database URL
 * Tests connection, pgvector extension, and optionally creates tables
 */
export async function validateExternalDatabase(
  dbUrl: string,
  createTables: boolean = false
): Promise<DatabaseValidationResult> {
  let client: PoolClient | null = null;
  let pool: Pool | null = null;

  try {
    // Create a temporary pool with timeout
    pool = new Pool({
      connectionString: dbUrl,
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 5000,
    });

    client = await pool.connect();

    // Test basic connection
    await client.query('SELECT 1');

    // Check for pgvector extension
    const extResult = await client.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    );
    const hasVectorExtension = extResult.rows.length > 0;

    if (!hasVectorExtension) {
      // Try to create the extension
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      } catch (extError) {
        return {
          valid: false,
          error: 'pgvector extension is not installed and could not be created. Please run: CREATE EXTENSION vector;',
          hasVectorExtension: false,
          hasTables: false
        };
      }
    }

    // Check for required tables
    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('items', 'summaries', 'cursors')
    `);
    const existingTables = tablesResult.rows.map((r: any) => r.table_name);
    const hasTables = existingTables.length === 3;

    // Create tables if requested and they don't exist
    if (createTables && !hasTables) {
      try {
        await client.query(CONTENT_TABLES_SQL);
      } catch (tableError) {
        return {
          valid: false,
          error: `Failed to create required tables: ${tableError instanceof Error ? tableError.message : String(tableError)}`,
          hasVectorExtension: true,
          hasTables: false
        };
      }
    }

    return {
      valid: true,
      hasVectorExtension: true,
      hasTables: createTables ? true : hasTables
    };

  } catch (error) {
    return {
      valid: false,
      error: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      hasVectorExtension: false,
      hasTables: false
    };
  } finally {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
  }
}

/**
 * Get or create a PostgresStorage for an external database
 */
export async function getExternalStorage(
  configId: string,
  encryptedDbUrl: string
): Promise<PostgresStorage> {
  // Check cache first
  if (externalPools.has(configId)) {
    const storage = new PostgresStorage({
      name: `external-${configId}`,
      configId
    });
    // @ts-ignore - accessing private pool
    storage.pool = externalPools.get(configId);
    return storage;
  }

  // Decrypt the URL
  const dbUrl = encryptionService.decryptDbUrl(encryptedDbUrl, configId);

  // Create new pool
  const pool = new Pool({
    connectionString: dbUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  // Cache the pool
  externalPools.set(configId, pool);

  // Create storage instance
  const storage = new PostgresStorage({
    name: `external-${configId}`,
    connectionString: dbUrl,
    configId
  });

  await storage.init();
  return storage;
}

/**
 * Close an external database connection
 */
export async function closeExternalConnection(configId: string): Promise<void> {
  const pool = externalPools.get(configId);
  if (pool) {
    await pool.end();
    externalPools.delete(configId);
  }
}

/**
 * Close all database connections
 */
export async function closeAllConnections(): Promise<void> {
  // Close external connections
  for (const [configId, pool] of externalPools) {
    await pool.end();
  }
  externalPools.clear();

  // Close platform connection
  if (platformPool) {
    await platformPool.end();
    platformPool = null;
  }
}

/**
 * Get storage for a config (platform or external based on config settings)
 */
export async function getStorageForConfig(config: {
  id: string;
  storage_type: 'platform' | 'external';
  external_db_url?: string;
}): Promise<PostgresStorage> {
  if (config.storage_type === 'external' && config.external_db_url) {
    return getExternalStorage(config.id, config.external_db_url);
  }
  
  const storage = getPlatformStorage(config.id);
  await storage.init();
  return storage;
}

/**
 * Save data to temp retention when external DB write fails
 */
export async function saveToTempRetention(
  configId: string,
  dataType: 'items' | 'summary',
  data: any,
  reason: string
): Promise<void> {
  await query(`
    INSERT INTO temp_retention (config_id, data_type, data, reason)
    VALUES ($1, $2, $3::jsonb, $4)
  `, [configId, dataType, JSON.stringify(data), reason]);
}

/**
 * Get temp retention items for a config
 */
export async function getTempRetentionItems(configId: string): Promise<any[]> {
  const result = await query(`
    SELECT * FROM temp_retention
    WHERE config_id = $1
    ORDER BY created_at ASC
  `, [configId]);
  return result.rows;
}

/**
 * Delete temp retention item after successful retry
 */
export async function deleteTempRetentionItem(id: string): Promise<void> {
  await query('DELETE FROM temp_retention WHERE id = $1', [id]);
}

/**
 * Update temp retention item after failed retry
 */
export async function updateTempRetentionRetry(id: string, error: string): Promise<void> {
  await query(`
    UPDATE temp_retention
    SET retry_count = retry_count + 1,
        last_retry_at = NOW(),
        last_retry_error = $2
    WHERE id = $1
  `, [id, error]);
}

export const databaseService = {
  initPlatformDatabase,
  getPlatformPool,
  query,
  getClient,
  getPlatformStorage,
  validateExternalDatabase,
  getExternalStorage,
  closeExternalConnection,
  closeAllConnections,
  getStorageForConfig,
  saveToTempRetention,
  getTempRetentionItems,
  deleteTempRetentionItem,
  updateTempRetentionRetry
};
