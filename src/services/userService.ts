// src/services/userService.ts

import { databaseService } from './databaseService';
import { encryptionService } from './encryptionService';
import { AuthUser } from '../middleware/authMiddleware';
import { sanitizeConfigSecrets } from '../helpers/secretSanitizer';

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
  isLocalExecution: boolean;
  hideItems: boolean;
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
  isLocalExecution?: boolean;
  hideItems?: boolean;
}

/**
 * Free tier limits
 */
const FREE_TIER_LIMITS = {
  maxConfigs: parseInt(process.env.FREE_TIER_MAX_CONFIGS || '1'),
  maxRunsPerDay: parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY || '3'),
  storageType: 'platform' as const,
  aiModel: process.env.FREE_TIER_AI_MODEL || 'gpt-4o-mini',
};

/**
 * Pro tier limits
 */
const PRO_TIER_LIMITS = {
  dailyAiCalls: parseInt(process.env.PRO_TIER_DAILY_AI_CALLS || '1000'),
  aiModel: process.env.PRO_TIER_AI_MODEL || 'gpt-4o',
  // Token budget for generation guardrails
  dailyTokenBudget: parseInt(process.env.PRO_TIER_DAILY_TOKEN_BUDGET || '500000'),
  dailyCostBudgetCents: parseInt(process.env.PRO_TIER_DAILY_COST_BUDGET_CENTS || '100'), // $1.00/day
  maxRangeGenerationDays: parseInt(process.env.PRO_TIER_MAX_RANGE_DAYS || '30'),
};

/**
 * Get next midnight UTC as Date
 */
function getNextMidnightUTC(): Date {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return tomorrow;
}

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
    isLocalExecution: row.is_local_execution || false,
    hideItems: row.hide_items || false,
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

  // Sanitize config to remove any actual secrets that may have slipped through
  // Preserves lookup variables like $SECRET:uuid$, process.env.X, and ALL_CAPS references
  const { sanitizedConfig, removedSecrets } = sanitizeConfigSecrets(configJson);
  
  if (removedSecrets.length > 0) {
    console.warn('[UserService] Removed actual secrets from config before saving:', 
      removedSecrets.length, 'field(s)');
  }

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
      JSON.stringify(sanitizedConfig)
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
    // Sanitize config to remove any actual secrets that may have slipped through
    const { sanitizedConfig, removedSecrets } = sanitizeConfigSecrets(params.configJson);
    
    if (removedSecrets.length > 0) {
      console.warn('[UserService] Removed actual secrets from config update:', 
        removedSecrets.length, 'field(s)');
    }
    
    updates.push(`config_json = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(sanitizedConfig));
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

  if (params.isLocalExecution !== undefined) {
    updates.push(`is_local_execution = $${paramIndex++}`);
    values.push(params.isLocalExecution);
  }

  if (params.hideItems !== undefined) {
    updates.push(`hide_items = $${paramIndex++}`);
    values.push(params.hideItems);
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
 * Get a user by ID
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await databaseService.query(
    'SELECT id, privy_id, wallet_address, email, tier FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    privyId: row.privy_id,
    walletAddress: row.wallet_address || undefined,
    email: row.email || undefined,
    tier: row.tier,
  };
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
 * Valid sort options for public config discovery
 */
export type PublicConfigSort = 'trending' | 'popular' | 'newest' | 'revenue';

/**
 * Get public configs (for discovery) with ranking support
 */
export async function getPublicConfigs(options: {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: PublicConfigSort;
}): Promise<{ configs: Config[]; total: number }> {
  const { limit = 20, offset = 0, search, sort = 'trending' } = options;

  let whereClause = "c.visibility = 'public'";
  const params: any[] = [];
  let paramIndex = 1;

  if (search) {
    whereClause += ` AND (c.name ILIKE $${paramIndex} OR c.description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // Get total count
  const countResult = await databaseService.query(
    `SELECT COUNT(*) as count FROM configs c WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Build ORDER BY based on sort option
  // Uses a live_items subquery to get accurate item counts even when the
  // configs.total_items counter is stale (DB trigger not yet applied).
  // Trending uses a composite ranking score:
  //   - total_queries (primary signal: how many people fetch data from this config)
  //   - live item count * 0.1 (secondary signal: data volume/activity)
  //   - total_revenue * 100 (quality signal: monetized configs with paying users rank higher)
  const liveItemsExpr = '(SELECT COUNT(*) FROM items i WHERE i.config_id = c.id)';
  let orderBy: string;
  switch (sort) {
    case 'popular':
      orderBy = 'c.total_queries DESC, c.created_at DESC';
      break;
    case 'newest':
      orderBy = 'c.created_at DESC';
      break;
    case 'revenue':
      orderBy = 'c.total_revenue DESC, c.total_queries DESC';
      break;
    case 'trending':
    default:
      orderBy = `(COALESCE(c.total_queries, 0) * 1.0 + COALESCE(${liveItemsExpr}, 0) * 0.1 + COALESCE(c.total_revenue, 0) * 100) DESC, c.created_at DESC`;
      break;
  }

  // Get paginated results with live item counts from the items table
  // (configs.total_items may be stale if the DB trigger wasn't applied)
  params.push(limit, offset);
  const result = await databaseService.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM items i WHERE i.config_id = c.id) AS live_item_count
     FROM configs c WHERE ${whereClause}
     ORDER BY ${orderBy}
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return {
    configs: result.rows.map((row: any) => {
      const config = rowToConfig(row);
      // Use live count from the items table if the cached counter is 0
      const liveCount = parseInt(row.live_item_count) || 0;
      if (config.totalItems === 0 && liveCount > 0) {
        config.totalItems = liveCount;
      }
      return config;
    }),
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

/**
 * Check if user can use platform AI (has remaining quota)
 * Returns allowed: true with remaining count, or allowed: false with reason
 */
export async function canUsePlatformAI(
  user: AuthUser
): Promise<{ allowed: boolean; reason?: string; remaining: number; resetAt: Date }> {
  // Admin always allowed with unlimited quota
  if (user.tier === 'admin') {
    return { allowed: true, remaining: Infinity, resetAt: getNextMidnightUTC() };
  }
  
  // Free tier uses platform AI but has no AI call limit tracking 
  // (their limit is enforced by runs per day instead)
  if (user.tier === 'free') {
    return { allowed: true, remaining: Infinity, resetAt: getNextMidnightUTC() };
  }
  
  // Pro tier: check daily AI call quota
  const usage = await getUserAiUsage(user.id);
  const remaining = PRO_TIER_LIMITS.dailyAiCalls - usage.callsToday;
  
  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `Daily AI quota exhausted (${PRO_TIER_LIMITS.dailyAiCalls} calls). Resets at midnight UTC. Run will continue but AI processing will be skipped.`,
      remaining: 0,
      resetAt: getNextMidnightUTC()
    };
  }
  
  return { allowed: true, remaining, resetAt: getNextMidnightUTC() };
}

/**
 * Get user's AI usage stats (resets at midnight UTC if needed)
 */
export async function getUserAiUsage(userId: string): Promise<{
  callsToday: number;
  limit: number;
  resetAt: Date;
}> {
  const todayUTC = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Check if we need to reset (last reset date is before today)
  // The database trigger handles the reset, but we query it here
  const result = await databaseService.query(
    `UPDATE users 
     SET ai_calls_today = CASE 
       WHEN ai_calls_today_reset_at < $1 THEN 0 
       ELSE ai_calls_today 
     END,
     ai_calls_today_reset_at = CASE
       WHEN ai_calls_today_reset_at < $1 THEN $1
       ELSE ai_calls_today_reset_at
     END
     WHERE id = $2
     RETURNING ai_calls_today`,
    [todayUTC, userId]
  );
  
  return {
    callsToday: result.rows[0]?.ai_calls_today || 0,
    limit: PRO_TIER_LIMITS.dailyAiCalls,
    resetAt: getNextMidnightUTC()
  };
}

/**
 * Increment user's AI usage counter
 */
export async function incrementAiUsage(userId: string, calls: number = 1): Promise<void> {
  const todayUTC = new Date().toISOString().split('T')[0];
  
  await databaseService.query(
    `UPDATE users 
     SET ai_calls_today = CASE 
       WHEN ai_calls_today_reset_at < $1 THEN $2
       ELSE ai_calls_today + $2
     END,
     ai_calls_today_reset_at = CASE
       WHEN ai_calls_today_reset_at < $1 THEN $1
       ELSE ai_calls_today_reset_at
     END
     WHERE id = $3`,
    [todayUTC, calls, userId]
  );
}

// ============================================
// TOKEN BUDGET TRACKING (for generation guardrails)
// ============================================

/**
 * Check if user can run a generation (has remaining token budget).
 * Returns remaining budget information for pre-flight cost estimation.
 */
export async function canGenerate(
  user: AuthUser
): Promise<{ allowed: boolean; reason?: string; remainingTokens: number; remainingCostCents: number; resetAt: Date }> {
  // Admin always allowed with unlimited budget
  if (user.tier === 'admin') {
    return { allowed: true, remainingTokens: Infinity, remainingCostCents: Infinity, resetAt: getNextMidnightUTC() };
  }
  
  // Free tier cannot generate (they consume existing summaries only)
  if (user.tier === 'free') {
    return {
      allowed: false,
      reason: 'Generation requires a Pro subscription.',
      remainingTokens: 0,
      remainingCostCents: 0,
      resetAt: getNextMidnightUTC(),
    };
  }
  
  // Pro tier: check daily token budget
  const usage = await getUserTokenUsage(user.id);
  const remainingTokens = usage.tokenBudget - usage.tokensToday;
  const remainingCostCents = usage.costBudgetCents - usage.costTodayCents;
  
  if (remainingTokens <= 0 || remainingCostCents <= 0) {
    return {
      allowed: false,
      reason: `Daily generation budget exhausted (${usage.tokensToday.toLocaleString()} / ${usage.tokenBudget.toLocaleString()} tokens). Resets at midnight UTC.`,
      remainingTokens: Math.max(0, remainingTokens),
      remainingCostCents: Math.max(0, remainingCostCents),
      resetAt: getNextMidnightUTC(),
    };
  }
  
  return { allowed: true, remainingTokens, remainingCostCents, resetAt: getNextMidnightUTC() };
}

/**
 * Get user's token usage stats for the current day.
 * Auto-resets if the last reset date is before today (same pattern as AI call tracking).
 */
export async function getUserTokenUsage(userId: string): Promise<{
  tokensToday: number;
  costTodayCents: number;
  tokenBudget: number;
  costBudgetCents: number;
  resetAt: Date;
}> {
  const todayUTC = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  const result = await databaseService.query(
    `UPDATE users 
     SET tokens_used_today = CASE 
       WHEN tokens_used_today_reset_at < $1 THEN 0 
       ELSE tokens_used_today 
     END,
     estimated_cost_today_cents = CASE
       WHEN tokens_used_today_reset_at < $1 THEN 0
       ELSE estimated_cost_today_cents
     END,
     tokens_used_today_reset_at = CASE
       WHEN tokens_used_today_reset_at < $1 THEN $1
       ELSE tokens_used_today_reset_at
     END
     WHERE id = $2
     RETURNING tokens_used_today, estimated_cost_today_cents`,
    [todayUTC, userId]
  );
  
  return {
    tokensToday: result.rows[0]?.tokens_used_today || 0,
    costTodayCents: result.rows[0]?.estimated_cost_today_cents || 0,
    tokenBudget: PRO_TIER_LIMITS.dailyTokenBudget,
    costBudgetCents: PRO_TIER_LIMITS.dailyCostBudgetCents,
    resetAt: getNextMidnightUTC(),
  };
}

/**
 * Increment user's token usage after a generation completes.
 * @param userId - User ID
 * @param tokens - Number of tokens consumed
 * @param costCents - Estimated cost in 1/100 cent units
 */
export async function incrementTokenUsage(userId: string, tokens: number, costCents: number = 0): Promise<void> {
  const todayUTC = new Date().toISOString().split('T')[0];
  
  await databaseService.query(
    `UPDATE users 
     SET tokens_used_today = CASE 
       WHEN tokens_used_today_reset_at < $1 THEN $2
       ELSE tokens_used_today + $2
     END,
     estimated_cost_today_cents = CASE
       WHEN tokens_used_today_reset_at < $1 THEN $3
       ELSE estimated_cost_today_cents + $3
     END,
     tokens_used_today_reset_at = CASE
       WHEN tokens_used_today_reset_at < $1 THEN $1
       ELSE tokens_used_today_reset_at
     END
     WHERE id = $4`,
    [todayUTC, tokens, costCents, userId]
  );
}

/**
 * Get the maximum number of days allowed for range generation.
 */
export function getMaxRangeGenerationDays(): number {
  return PRO_TIER_LIMITS.maxRangeGenerationDays;
}

/**
 * Get tier limits for display purposes
 */
export function getTierLimits(tier: string): {
  maxConfigs?: number;
  maxRunsPerDay?: number;
  dailyAiCalls?: number;
  dailyTokenBudget?: number;
  dailyCostBudgetCents?: number;
  maxRangeGenerationDays?: number;
  aiModel: string;
} {
  if (tier === 'free') {
    return {
      maxConfigs: FREE_TIER_LIMITS.maxConfigs,
      maxRunsPerDay: FREE_TIER_LIMITS.maxRunsPerDay,
      aiModel: FREE_TIER_LIMITS.aiModel,
    };
  }
  
  if (tier === 'paid') {
    return {
      dailyAiCalls: PRO_TIER_LIMITS.dailyAiCalls,
      dailyTokenBudget: PRO_TIER_LIMITS.dailyTokenBudget,
      dailyCostBudgetCents: PRO_TIER_LIMITS.dailyCostBudgetCents,
      maxRangeGenerationDays: PRO_TIER_LIMITS.maxRangeGenerationDays,
      aiModel: PRO_TIER_LIMITS.aiModel,
    };
  }
  
  // Admin - unlimited
  return {
    aiModel: PRO_TIER_LIMITS.aiModel,
  };
}

export const userService = {
  canCreateConfig,
  canRunAggregation,
  createConfig,
  updateConfig,
  getConfigById,
  getConfigBySlug,
  getUserById,
  getUserConfigs,
  getPublicConfigs,
  deleteConfig,
  getConfigSecrets,
  getConfigExternalDbUrl,
  incrementRunCount,
  updateConfigRunStatus,
  getUserRevenue,
  // AI usage tracking
  canUsePlatformAI,
  getUserAiUsage,
  incrementAiUsage,
  getTierLimits,
  // Token budget tracking (generation guardrails)
  canGenerate,
  getUserTokenUsage,
  incrementTokenUsage,
  getMaxRangeGenerationDays,
};
