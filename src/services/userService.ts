// src/services/userService.ts

import { databaseService } from './databaseService';
import { encryptionService } from './encryptionService';
import { AuthUser } from '../middleware/authMiddleware';

/**
 * Config visibility options
 */
export type ConfigVisibility = 'public' | 'private' | 'shared' | 'unlisted';

/**
 * Config storage type
 */
export type StorageType = 'platform' | 'external';

/**
 * Config entity
 */
export interface Config {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: ConfigVisibility;
  storageType: StorageType;
  externalDbUrl?: string;
  externalDbValid?: boolean;
  externalDbError?: string;
  monetizationEnabled: boolean;
  pricePerQuery?: number;
  ownerWallet?: string;
  configJson: object;
  status: 'idle' | 'running' | 'error' | 'paused';
  lastRunAt?: Date;
  lastRunDurationMs?: number;
  lastError?: string;
  runsToday: number;
  runsTodayResetAt: Date;
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Config creation parameters
 */
export interface CreateConfigParams {
  userId: string;
  name: string;
  description?: string;
  visibility?: ConfigVisibility;
  storageType?: StorageType;
  externalDbUrl?: string;
  configJson: object;
  secrets?: Record<string, string>;
}

/**
 * Config update parameters
 */
export interface UpdateConfigParams {
  name?: string;
  description?: string;
  visibility?: ConfigVisibility;
  storageType?: StorageType;
  externalDbUrl?: string;
  monetizationEnabled?: boolean;
  pricePerQuery?: number;
  ownerWallet?: string;
  configJson?: object;
  secrets?: Record<string, string>;
  status?: 'idle' | 'running' | 'error' | 'paused';
}

/**
 * Free tier limits
 */
const FREE_TIER_LIMITS = {
  maxConfigs: parseInt(process.env.FREE_TIER_MAX_CONFIGS || '1'),
  maxRunsPerDay: parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY || '1'),
};

/**
 * Generate a URL-safe slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Ensure slug is unique by appending a number if necessary
 */
async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const query = excludeId
      ? 'SELECT 1 FROM configs WHERE slug = $1 AND id != $2'
      : 'SELECT 1 FROM configs WHERE slug = $1';
    
    const params = excludeId ? [slug, excludeId] : [slug];
    const result = await databaseService.query(query, params);

    if (result.rows.length === 0) {
      return slug;
    }

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/**
 * Convert database row to Config object
 */
function rowToConfig(row: any): Config {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    visibility: row.visibility,
    storageType: row.storage_type,
    externalDbUrl: row.external_db_url || undefined,
    externalDbValid: row.external_db_valid,
    externalDbError: row.external_db_error || undefined,
    monetizationEnabled: row.monetization_enabled,
    pricePerQuery: row.price_per_query ? parseFloat(row.price_per_query) : undefined,
    ownerWallet: row.owner_wallet || undefined,
    configJson: row.config_json,
    status: row.status,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
    lastRunDurationMs: row.last_run_duration_ms || undefined,
    lastError: row.last_error || undefined,
    runsToday: row.runs_today,
    runsTodayResetAt: new Date(row.runs_today_reset_at),
    totalItems: row.total_items,
    totalQueries: row.total_queries,
    totalRevenue: row.total_revenue ? parseFloat(row.total_revenue) : 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

/**
 * Check if user can create a new config (tier limits)
 */
export async function canCreateConfig(user: AuthUser): Promise<{ allowed: boolean; reason?: string }> {
  if (user.tier === 'admin' || user.tier === 'paid') {
    return { allowed: true };
  }

  // Free tier: check config count
  const result = await databaseService.query(
    'SELECT COUNT(*) as count FROM configs WHERE user_id = $1',
    [user.id]
  );

  const count = parseInt(result.rows[0].count);
  
  if (count >= FREE_TIER_LIMITS.maxConfigs) {
    return {
      allowed: false,
      reason: `Free tier is limited to ${FREE_TIER_LIMITS.maxConfigs} config(s). Upgrade to create more.`
    };
  }

  return { allowed: true };
}

/**
 * Check if user can run aggregation (tier limits)
 */
export async function canRunAggregation(
  user: AuthUser,
  configId: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (user.tier === 'admin' || user.tier === 'paid') {
    return { allowed: true };
  }

  // Free tier: check daily run count
  const result = await databaseService.query(
    `SELECT runs_today, runs_today_reset_at FROM configs WHERE id = $1`,
    [configId]
  );

  if (result.rows.length === 0) {
    return { allowed: false, reason: 'Config not found' };
  }

  const config = result.rows[0];
  const resetAt = new Date(config.runs_today_reset_at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // If reset date is before today, runs_today should be 0
  // The database trigger handles this, but we check just in case
  let runsToday = config.runs_today;
  if (resetAt < today) {
    runsToday = 0;
  }

  if (runsToday >= FREE_TIER_LIMITS.maxRunsPerDay) {
    return {
      allowed: false,
      reason: `Free tier is limited to ${FREE_TIER_LIMITS.maxRunsPerDay} aggregation run(s) per day. Upgrade for unlimited runs.`
    };
  }

  return { allowed: true };
}

/**
 * Create a new config
 */
export async function createConfig(params: CreateConfigParams): Promise<Config> {
  const {
    userId,
    name,
    description,
    visibility = 'private',
    storageType = 'platform',
    externalDbUrl,
    configJson,
    secrets
  } = params;

  // Generate unique slug
  const baseSlug = generateSlug(name);
  const slug = await ensureUniqueSlug(baseSlug);

  // Encrypt secrets if provided
  let encryptedSecrets: Buffer | null = null;
  
  // We'll set this after we have the config ID
  const tempConfigId = 'temp';

  // Encrypt external DB URL if provided
  let encryptedDbUrl: string | null = null;
  if (externalDbUrl && storageType === 'external') {
    encryptedDbUrl = encryptionService.encryptDbUrl(externalDbUrl, tempConfigId);
  }

  const result = await databaseService.query(
    `INSERT INTO configs (
      user_id, name, slug, description, visibility,
      storage_type, external_db_url, config_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    RETURNING *`,
    [
      userId,
      name,
      slug,
      description || null,
      visibility,
      storageType,
      encryptedDbUrl,
      JSON.stringify(configJson)
    ]
  );

  const config = rowToConfig(result.rows[0]);

  // Re-encrypt with actual config ID if we have secrets or external URL
  if (secrets || externalDbUrl) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (secrets) {
      const encrypted = encryptionService.encryptSecrets(secrets, config.id);
      updates.push(`secrets = $${paramIndex++}`);
      values.push(Buffer.from(encrypted, 'base64'));
    }

    if (externalDbUrl) {
      const encrypted = encryptionService.encryptDbUrl(externalDbUrl, config.id);
      updates.push(`external_db_url = $${paramIndex++}`);
      values.push(encrypted);
    }

    if (updates.length > 0) {
      values.push(config.id);
      await databaseService.query(
        `UPDATE configs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }
  }

  return config;
}

/**
 * Update a config
 */
export async function updateConfig(configId: string, params: UpdateConfigParams): Promise<Config> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(params.name);
    
    // Update slug
    const baseSlug = generateSlug(params.name);
    const slug = await ensureUniqueSlug(baseSlug, configId);
    updates.push(`slug = $${paramIndex++}`);
    values.push(slug);
  }

  if (params.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(params.description);
  }

  if (params.visibility !== undefined) {
    updates.push(`visibility = $${paramIndex++}`);
    values.push(params.visibility);
  }

  if (params.storageType !== undefined) {
    updates.push(`storage_type = $${paramIndex++}`);
    values.push(params.storageType);
  }

  if (params.externalDbUrl !== undefined) {
    const encrypted = params.externalDbUrl 
      ? encryptionService.encryptDbUrl(params.externalDbUrl, configId)
      : null;
    updates.push(`external_db_url = $${paramIndex++}`);
    values.push(encrypted);
    
    // Reset validation status
    updates.push(`external_db_valid = NULL`);
    updates.push(`external_db_error = NULL`);
  }

  if (params.monetizationEnabled !== undefined) {
    updates.push(`monetization_enabled = $${paramIndex++}`);
    values.push(params.monetizationEnabled);
  }

  if (params.pricePerQuery !== undefined) {
    updates.push(`price_per_query = $${paramIndex++}`);
    values.push(params.pricePerQuery);
  }

  if (params.ownerWallet !== undefined) {
    updates.push(`owner_wallet = $${paramIndex++}`);
    values.push(params.ownerWallet);
  }

  if (params.configJson !== undefined) {
    updates.push(`config_json = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(params.configJson));
  }

  if (params.secrets !== undefined) {
    const encrypted = encryptionService.encryptSecrets(params.secrets, configId);
    updates.push(`secrets = $${paramIndex++}`);
    values.push(Buffer.from(encrypted, 'base64'));
  }

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(params.status);
  }

  if (updates.length === 0) {
    throw new Error('No updates provided');
  }

  values.push(configId);

  const result = await databaseService.query(
    `UPDATE configs SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Config not found');
  }

  return rowToConfig(result.rows[0]);
}

/**
 * Get a config by ID
 */
export async function getConfigById(configId: string): Promise<Config | null> {
  const result = await databaseService.query(
    'SELECT * FROM configs WHERE id = $1',
    [configId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToConfig(result.rows[0]);
}

/**
 * Get a config by slug
 */
export async function getConfigBySlug(slug: string): Promise<Config | null> {
  const result = await databaseService.query(
    'SELECT * FROM configs WHERE slug = $1',
    [slug]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToConfig(result.rows[0]);
}

/**
 * Get all configs for a user
 */
export async function getUserConfigs(userId: string): Promise<Config[]> {
  const result = await databaseService.query(
    'SELECT * FROM configs WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );

  return result.rows.map(rowToConfig);
}

/**
 * Get public configs (for discovery)
 */
export async function getPublicConfigs(options: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ configs: Config[]; total: number }> {
  const { limit = 20, offset = 0, search } = options;

  let whereClause = "visibility = 'public'";
  const params: any[] = [];
  let paramIndex = 1;

  if (search) {
    whereClause += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // Get total count
  const countResult = await databaseService.query(
    `SELECT COUNT(*) as count FROM configs WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Get paginated results
  params.push(limit, offset);
  const result = await databaseService.query(
    `SELECT * FROM configs WHERE ${whereClause}
     ORDER BY total_queries DESC, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return {
    configs: result.rows.map(rowToConfig),
    total
  };
}

/**
 * Delete a config
 */
export async function deleteConfig(configId: string): Promise<void> {
  await databaseService.query('DELETE FROM configs WHERE id = $1', [configId]);
}

/**
 * Get decrypted secrets for a config
 */
export async function getConfigSecrets(configId: string): Promise<Record<string, string> | null> {
  const result = await databaseService.query(
    'SELECT secrets FROM configs WHERE id = $1',
    [configId]
  );

  if (result.rows.length === 0 || !result.rows[0].secrets) {
    return null;
  }

  const encryptedSecrets = result.rows[0].secrets.toString('base64');
  return encryptionService.decryptSecrets(encryptedSecrets, configId);
}

/**
 * Get decrypted external database URL for a config
 */
export async function getConfigExternalDbUrl(configId: string): Promise<string | null> {
  const result = await databaseService.query(
    'SELECT external_db_url FROM configs WHERE id = $1',
    [configId]
  );

  if (result.rows.length === 0 || !result.rows[0].external_db_url) {
    return null;
  }

  return encryptionService.decryptDbUrl(result.rows[0].external_db_url, configId);
}

/**
 * Increment run count for a config
 */
export async function incrementRunCount(configId: string): Promise<void> {
  await databaseService.query(
    `UPDATE configs SET 
      runs_today = runs_today + 1,
      last_run_at = NOW()
     WHERE id = $1`,
    [configId]
  );
}

/**
 * Update config status after run
 */
export async function updateConfigRunStatus(
  configId: string,
  status: 'idle' | 'running' | 'error',
  durationMs?: number,
  error?: string
): Promise<void> {
  await databaseService.query(
    `UPDATE configs SET 
      status = $1,
      last_run_duration_ms = $2,
      last_error = $3
     WHERE id = $4`,
    [status, durationMs || null, error || null, configId]
  );
}

/**
 * Get user revenue statistics
 */
export async function getUserRevenue(userId: string): Promise<{
  totalVolume: number;
  totalRevenue: number;
  totalPlatformFees: number;
  totalTransactions: number;
  uniquePayers: number;
}> {
  const result = await databaseService.query(
    `SELECT * FROM user_revenue_summary WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return {
      totalVolume: 0,
      totalRevenue: 0,
      totalPlatformFees: 0,
      totalTransactions: 0,
      uniquePayers: 0
    };
  }

  const row = result.rows[0];
  return {
    totalVolume: parseFloat(row.total_volume) || 0,
    totalRevenue: parseFloat(row.total_revenue) || 0,
    totalPlatformFees: parseFloat(row.total_platform_fees) || 0,
    totalTransactions: parseInt(row.total_transactions) || 0,
    uniquePayers: parseInt(row.unique_payers) || 0
  };
}

export const userService = {
  canCreateConfig,
  canRunAggregation,
  createConfig,
  updateConfig,
  getConfigById,
  getConfigBySlug,
  getUserConfigs,
  getPublicConfigs,
  deleteConfig,
  getConfigSecrets,
  getConfigExternalDbUrl,
  incrementRunCount,
  updateConfigRunStatus,
  getUserRevenue
};
