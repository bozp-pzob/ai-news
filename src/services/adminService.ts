// src/services/adminService.ts

import { databaseService } from './databaseService';
import { AuthUser } from '../middleware/authMiddleware';
import crypto from 'crypto';

/**
 * User tier options
 */
export type UserTier = 'free' | 'paid' | 'admin';

/**
 * Admin user view (includes all user fields for admin)
 */
export interface AdminUser {
  id: string;
  privyId: string;
  email?: string;
  walletAddress?: string;
  tier: UserTier;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  aiCallsToday: number;
  createdAt: Date;
  updatedAt: Date;
  // Computed fields
  configCount?: number;
}

/**
 * Admin config view (includes owner info)
 */
export interface AdminConfig {
  id: string;
  userId: string;
  ownerEmail?: string;
  ownerWalletAddress?: string;
  name: string;
  slug: string;
  description?: string;
  visibility: string;
  storageType: string;
  monetizationEnabled: boolean;
  pricePerQuery?: number;
  status: string;
  lastRunAt?: Date;
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  isFeatured: boolean;
  featuredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Time range for statistics
 */
export type TimeRange = 'today' | '7d' | '30d' | '90d' | 'all';

/**
 * System statistics
 */
export interface SystemStats {
  users: {
    total: number;
    free: number;
    paid: number;
    admin: number;
    banned: number;
    newInRange: number;
  };
  configs: {
    total: number;
    public: number;
    private: number;
    unlisted: number;
    shared: number;
    featured: number;
  };
  usage: {
    totalRuns: number;
    totalAiCalls: number;
    totalApiRequests: number;
  };
  revenue: {
    totalPayments: number;
    totalAmount: number;
    platformFees: number;
  };
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * User filter options
 */
export interface UserFilterOptions extends PaginationOptions {
  tier?: UserTier;
  isBanned?: boolean;
}

/**
 * Config filter options
 */
export interface ConfigFilterOptions extends PaginationOptions {
  visibility?: string;
  isFeatured?: boolean;
  userId?: string;
}

/**
 * Get time range SQL condition
 */
function getTimeRangeCondition(column: string, range: TimeRange): string {
  switch (range) {
    case 'today':
      return `${column} >= CURRENT_DATE`;
    case '7d':
      return `${column} >= CURRENT_DATE - INTERVAL '7 days'`;
    case '30d':
      return `${column} >= CURRENT_DATE - INTERVAL '30 days'`;
    case '90d':
      return `${column} >= CURRENT_DATE - INTERVAL '90 days'`;
    case 'all':
    default:
      return '1=1'; // No filter
  }
}

/**
 * Convert database row to AdminUser
 */
function rowToAdminUser(row: any): AdminUser {
  return {
    id: row.id,
    privyId: row.privy_id,
    email: row.email || undefined,
    walletAddress: row.wallet_address || undefined,
    tier: row.tier,
    isBanned: row.is_banned || false,
    bannedAt: row.banned_at ? new Date(row.banned_at) : undefined,
    bannedReason: row.banned_reason || undefined,
    aiCallsToday: row.ai_calls_today || 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    configCount: row.config_count !== undefined ? parseInt(row.config_count) : undefined,
  };
}

/**
 * Convert database row to AdminConfig
 */
function rowToAdminConfig(row: any): AdminConfig {
  return {
    id: row.id,
    userId: row.user_id,
    ownerEmail: row.owner_email || undefined,
    ownerWalletAddress: row.owner_wallet_address || undefined,
    name: row.name,
    slug: row.slug,
    description: row.description || undefined,
    visibility: row.visibility,
    storageType: row.storage_type,
    monetizationEnabled: row.monetization_enabled || false,
    pricePerQuery: row.price_per_query ? parseFloat(row.price_per_query) : undefined,
    status: row.status,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
    totalItems: row.total_items || 0,
    totalQueries: row.total_queries || 0,
    totalRevenue: row.total_revenue ? parseFloat(row.total_revenue) : 0,
    isFeatured: row.is_featured || false,
    featuredAt: row.featured_at ? new Date(row.featured_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * Get all users with pagination and filters
 */
export async function getAllUsers(
  options: UserFilterOptions = {}
): Promise<{ users: AdminUser[]; total: number }> {
  const { 
    page = 1, 
    limit = 20, 
    search, 
    tier, 
    isBanned,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = options;

  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(
      email ILIKE $${paramIndex} OR 
      wallet_address ILIKE $${paramIndex} OR
      id::text ILIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (tier) {
    conditions.push(`tier = $${paramIndex++}`);
    params.push(tier);
  }

  if (isBanned !== undefined) {
    conditions.push(`is_banned = $${paramIndex++}`);
    params.push(isBanned);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column to prevent SQL injection
  const validSortColumns = ['created_at', 'updated_at', 'email', 'tier', 'ai_calls_today'];
  const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Get total count
  const countResult = await databaseService.query(
    `SELECT COUNT(*) as count FROM users ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Get users with config count
  const usersQuery = `
    SELECT u.*, 
           (SELECT COUNT(*) FROM configs WHERE user_id = u.id) as config_count
    FROM users u
    ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await databaseService.query(usersQuery, [...params, limit, offset]);

  return {
    users: result.rows.map(rowToAdminUser),
    total,
  };
}

/**
 * Get a single user by ID
 */
export async function getUserById(userId: string): Promise<AdminUser | null> {
  const result = await databaseService.query(
    `SELECT u.*, 
            (SELECT COUNT(*) FROM configs WHERE user_id = u.id) as config_count
     FROM users u
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToAdminUser(result.rows[0]);
}

/**
 * Update user tier
 * @throws Error if trying to modify own account or user not found
 */
export async function updateUserTier(
  adminUser: AuthUser,
  targetUserId: string,
  newTier: UserTier
): Promise<AdminUser> {
  // Self-protection: prevent admin from modifying their own tier
  if (adminUser.id === targetUserId) {
    throw new Error('Cannot modify your own account');
  }

  // Validate tier
  if (!['free', 'paid', 'admin'].includes(newTier)) {
    throw new Error('Invalid tier');
  }

  const result = await databaseService.query(
    `UPDATE users 
     SET tier = $1, updated_at = NOW() 
     WHERE id = $2 
     RETURNING *`,
    [newTier, targetUserId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  return rowToAdminUser(result.rows[0]);
}

/**
 * Ban a user
 * @throws Error if trying to ban own account or user not found
 */
export async function banUser(
  adminUser: AuthUser,
  targetUserId: string,
  reason?: string
): Promise<AdminUser> {
  // Self-protection: prevent admin from banning themselves
  if (adminUser.id === targetUserId) {
    throw new Error('Cannot modify your own account');
  }

  const result = await databaseService.query(
    `UPDATE users 
     SET is_banned = TRUE, 
         banned_at = NOW(), 
         banned_reason = $1,
         updated_at = NOW()
     WHERE id = $2 
     RETURNING *`,
    [reason || null, targetUserId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  return rowToAdminUser(result.rows[0]);
}

/**
 * Unban a user
 */
export async function unbanUser(targetUserId: string): Promise<AdminUser> {
  const result = await databaseService.query(
    `UPDATE users 
     SET is_banned = FALSE, 
         banned_at = NULL, 
         banned_reason = NULL,
         updated_at = NOW()
     WHERE id = $1 
     RETURNING *`,
    [targetUserId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  return rowToAdminUser(result.rows[0]);
}

/**
 * In-memory store for impersonation tokens
 * In production, you might want to use Redis or database storage
 */
interface ImpersonationSession {
  token: string;
  adminId: string;
  adminEmail?: string;
  targetUserId: string;
  targetEmail?: string;
  expiresAt: Date;
}

const impersonationSessions = new Map<string, ImpersonationSession>();

// Clean up expired sessions periodically
setInterval(() => {
  const now = new Date();
  for (const [token, session] of impersonationSessions.entries()) {
    if (session.expiresAt < now) {
      impersonationSessions.delete(token);
    }
  }
}, 60 * 1000); // Check every minute

/**
 * Create an impersonation token
 * This creates a short-lived token that allows admin to act as another user
 */
export async function createImpersonationToken(
  adminUser: AuthUser,
  targetUserId: string
): Promise<{ token: string; expiresAt: Date }> {
  // Verify target user exists
  const targetUser = await getUserById(targetUserId);
  if (!targetUser) {
    throw new Error('User not found');
  }

  // Cannot impersonate another admin
  if (targetUser.tier === 'admin') {
    throw new Error('Cannot impersonate another admin');
  }

  const expiresIn = 60 * 60 * 1000; // 1 hour in milliseconds
  const expiresAt = new Date(Date.now() + expiresIn);

  // Create a secure random token
  const token = crypto.randomBytes(32).toString('hex');

  // Store the session
  const session: ImpersonationSession = {
    token,
    adminId: adminUser.id,
    adminEmail: adminUser.email,
    targetUserId: targetUser.id,
    targetEmail: targetUser.email,
    expiresAt,
  };
  impersonationSessions.set(token, session);

  return { token, expiresAt };
}

/**
 * Verify an impersonation token and return the session
 */
export function verifyImpersonationToken(token: string): ImpersonationSession | null {
  const session = impersonationSessions.get(token);
  
  if (!session) {
    return null;
  }

  // Check if expired
  if (session.expiresAt < new Date()) {
    impersonationSessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Invalidate an impersonation token
 */
export function invalidateImpersonationToken(token: string): void {
  impersonationSessions.delete(token);
}

// ============================================
// CONFIG MANAGEMENT
// ============================================

/**
 * Get all configs with pagination and filters
 */
export async function getAllConfigs(
  options: ConfigFilterOptions = {}
): Promise<{ configs: AdminConfig[]; total: number }> {
  const { 
    page = 1, 
    limit = 20, 
    search, 
    visibility, 
    isFeatured,
    userId,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = options;

  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(
      c.name ILIKE $${paramIndex} OR 
      c.slug ILIKE $${paramIndex} OR
      c.description ILIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (visibility) {
    conditions.push(`c.visibility = $${paramIndex++}`);
    params.push(visibility);
  }

  if (isFeatured !== undefined) {
    conditions.push(`c.is_featured = $${paramIndex++}`);
    params.push(isFeatured);
  }

  if (userId) {
    conditions.push(`c.user_id = $${paramIndex++}`);
    params.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column
  const validSortColumns = ['created_at', 'updated_at', 'name', 'total_items', 'total_queries', 'last_run_at'];
  const sortColumn = validSortColumns.includes(sortBy) ? `c.${sortBy}` : 'c.created_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Get total count
  const countResult = await databaseService.query(
    `SELECT COUNT(*) as count FROM configs c ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Get configs with owner info
  const configsQuery = `
    SELECT c.*, 
           u.email as owner_email,
           u.wallet_address as owner_wallet_address
    FROM configs c
    LEFT JOIN users u ON c.user_id = u.id
    ${whereClause}
    ORDER BY ${sortColumn} ${order}
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  const result = await databaseService.query(configsQuery, [...params, limit, offset]);

  return {
    configs: result.rows.map(rowToAdminConfig),
    total,
  };
}

/**
 * Set config featured status
 */
export async function setConfigFeatured(
  configId: string,
  featured: boolean
): Promise<AdminConfig> {
  const result = await databaseService.query(
    `UPDATE configs 
     SET is_featured = $1, 
         featured_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $2 
     RETURNING *`,
    [featured, configId]
  );

  if (result.rows.length === 0) {
    throw new Error('Config not found');
  }

  // Get full config with owner info
  const fullResult = await databaseService.query(
    `SELECT c.*, 
            u.email as owner_email,
            u.wallet_address as owner_wallet_address
     FROM configs c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.id = $1`,
    [configId]
  );

  return rowToAdminConfig(fullResult.rows[0]);
}

/**
 * Get featured configs (for public display)
 */
export async function getFeaturedConfigs(
  limit: number = 10
): Promise<AdminConfig[]> {
  const result = await databaseService.query(
    `SELECT c.*, 
            u.email as owner_email,
            u.wallet_address as owner_wallet_address
     FROM configs c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.is_featured = TRUE 
       AND c.visibility IN ('public', 'unlisted')
     ORDER BY c.featured_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map(rowToAdminConfig);
}

// ============================================
// STATISTICS
// ============================================

/**
 * Get system-wide statistics
 */
export async function getSystemStats(range: TimeRange = 'all'): Promise<SystemStats> {
  const timeCondition = getTimeRangeCondition('created_at', range);

  // User stats
  const userStatsResult = await databaseService.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tier = 'free') as free,
      COUNT(*) FILTER (WHERE tier = 'paid') as paid,
      COUNT(*) FILTER (WHERE tier = 'admin') as admin,
      COUNT(*) FILTER (WHERE is_banned = TRUE) as banned,
      COUNT(*) FILTER (WHERE ${timeCondition}) as new_in_range
    FROM users
  `);
  const userStats = userStatsResult.rows[0];

  // Config stats
  const configStatsResult = await databaseService.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE visibility = 'public') as public,
      COUNT(*) FILTER (WHERE visibility = 'private') as private,
      COUNT(*) FILTER (WHERE visibility = 'unlisted') as unlisted,
      COUNT(*) FILTER (WHERE visibility = 'shared') as shared,
      COUNT(*) FILTER (WHERE is_featured = TRUE) as featured
    FROM configs
  `);
  const configStats = configStatsResult.rows[0];

  // Usage stats
  const usageTimeCondition = getTimeRangeCondition('created_at', range);
  const usageStatsResult = await databaseService.query(`
    SELECT 
      (SELECT COUNT(*) FROM aggregation_jobs WHERE ${usageTimeCondition}) as total_runs,
      (SELECT COALESCE(SUM(ai_calls_today), 0) FROM users) as total_ai_calls,
      (SELECT COUNT(*) FROM api_usage WHERE ${usageTimeCondition}) as total_api_requests
  `);
  const usageStats = usageStatsResult.rows[0];

  // Revenue stats
  const revenueTimeCondition = getTimeRangeCondition('created_at', range);
  const revenueStatsResult = await databaseService.query(`
    SELECT 
      COUNT(*) as total_payments,
      COALESCE(SUM(amount), 0) as total_amount,
      COALESCE(SUM(platform_fee), 0) as platform_fees
    FROM payments
    WHERE status = 'settled'
      AND ${revenueTimeCondition}
  `);
  const revenueStats = revenueStatsResult.rows[0];

  return {
    users: {
      total: parseInt(userStats.total) || 0,
      free: parseInt(userStats.free) || 0,
      paid: parseInt(userStats.paid) || 0,
      admin: parseInt(userStats.admin) || 0,
      banned: parseInt(userStats.banned) || 0,
      newInRange: parseInt(userStats.new_in_range) || 0,
    },
    configs: {
      total: parseInt(configStats.total) || 0,
      public: parseInt(configStats.public) || 0,
      private: parseInt(configStats.private) || 0,
      unlisted: parseInt(configStats.unlisted) || 0,
      shared: parseInt(configStats.shared) || 0,
      featured: parseInt(configStats.featured) || 0,
    },
    usage: {
      totalRuns: parseInt(usageStats.total_runs) || 0,
      totalAiCalls: parseInt(usageStats.total_ai_calls) || 0,
      totalApiRequests: parseInt(usageStats.total_api_requests) || 0,
    },
    revenue: {
      totalPayments: parseInt(revenueStats.total_payments) || 0,
      totalAmount: parseFloat(revenueStats.total_amount) || 0,
      platformFees: parseFloat(revenueStats.platform_fees) || 0,
    },
  };
}

/**
 * Get usage statistics over time (for charts)
 */
export async function getUsageOverTime(
  range: TimeRange = '30d'
): Promise<{ date: string; runs: number; apiRequests: number }[]> {
  let interval: string;
  let days: number;

  switch (range) {
    case 'today':
      interval = '1 hour';
      days = 1;
      break;
    case '7d':
      interval = '1 day';
      days = 7;
      break;
    case '30d':
      interval = '1 day';
      days = 30;
      break;
    case '90d':
      interval = '1 day';
      days = 90;
      break;
    default:
      interval = '1 week';
      days = 365;
  }

  const result = await databaseService.query(`
    WITH date_series AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '${days} days',
        CURRENT_DATE,
        INTERVAL '${interval}'
      )::date as date
    )
    SELECT 
      ds.date::text,
      COALESCE((
        SELECT COUNT(*) 
        FROM aggregation_jobs 
        WHERE DATE(created_at) = ds.date
      ), 0) as runs,
      COALESCE((
        SELECT COUNT(*) 
        FROM api_usage 
        WHERE DATE(created_at) = ds.date
      ), 0) as api_requests
    FROM date_series ds
    ORDER BY ds.date
  `);

  return result.rows.map((row: any) => ({
    date: row.date,
    runs: parseInt(row.runs) || 0,
    apiRequests: parseInt(row.api_requests) || 0,
  }));
}

// ============================================
// EXPORTS
// ============================================

export const adminService = {
  // Users
  getAllUsers,
  getUserById,
  updateUserTier,
  banUser,
  unbanUser,
  createImpersonationToken,
  verifyImpersonationToken,
  invalidateImpersonationToken,
  // Configs
  getAllConfigs,
  setConfigFeatured,
  getFeaturedConfigs,
  // Stats
  getSystemStats,
  getUsageOverTime,
};
