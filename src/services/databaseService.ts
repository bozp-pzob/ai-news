// src/services/databaseService.ts

import { Pool, PoolClient } from 'pg';
import { PostgresStorage } from '../plugins/storage/PostgresStorage';
import { encryptionService } from './encryptionService';

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
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(config_id, type, date)
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
 * Run database migrations to add missing columns
 * This is safe to run multiple times (idempotent)
 */
async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Add ai_calls_today columns if they don't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS ai_calls_today INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_calls_today_reset_at DATE DEFAULT CURRENT_DATE
    `);
    
    // Add index if it doesn't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_ai_reset ON users(ai_calls_today_reset_at)
    `);

    // Admin system: Add ban columns to users
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS banned_reason TEXT
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_banned ON users(is_banned) WHERE is_banned = TRUE
    `);

    // Admin system: Add featured columns to configs
    await client.query(`
      ALTER TABLE configs
      ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_configs_featured ON configs(is_featured, featured_at DESC) WHERE is_featured = TRUE
    `);

    // Local execution: configs that run on user's local server
    await client.query(`
      ALTER TABLE configs
      ADD COLUMN IF NOT EXISTS is_local_execution BOOLEAN DEFAULT FALSE
    `);

    // AI token usage and cost tracking on aggregation jobs
    await client.query(`
      ALTER TABLE aggregation_jobs
      ADD COLUMN IF NOT EXISTS total_prompt_tokens INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_completion_tokens INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_ai_calls INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6) DEFAULT 0
    `);

    // Encrypted resolved config/secrets for server restart resilience (continuous jobs)
    await client.query(`
      ALTER TABLE aggregation_jobs
      ADD COLUMN IF NOT EXISTS resolved_config_encrypted BYTEA,
      ADD COLUMN IF NOT EXISTS resolved_secrets_encrypted BYTEA
    `);
    
    console.log('[DatabaseService] Migrations completed successfully');
  } catch (error) {
    console.error('[DatabaseService] Migration error (non-fatal):', error);
    // Don't throw - migrations are best-effort
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
    console.log('[DatabaseService] Platform database connected successfully');
  } finally {
    client.release();
  }

  // Run migrations
  await runMigrations(platformPool);
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
