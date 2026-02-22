// src/routes/v1/configs.ts

import { Router, Response } from 'express';
import { 
  requireAuth, 
  optionalAuth,
  requireConfigOwner,
  requireConfigAccess,
  AuthenticatedRequest 
} from '../../middleware/authMiddleware';
import { userService } from '../../services/userService';
import { contextService } from '../../services/contextService';
import { databaseService } from '../../services/databaseService';
import { AggregatorService } from '../../services/aggregatorService';
import { adminService } from '../../services/adminService';
import { jobService } from '../../services/jobService';
import { licenseService, RUN_PAYMENT } from '../../services/licenseService';
import { requirePayment } from '../../middleware/x402Middleware';

// ============================================
// ACCESS GRANTS — 24-hour purchasable data access
// ============================================

/** Ensure the config_access_grants table exists (idempotent) */
let accessGrantsTableReady = false;
async function ensureAccessGrantsTable(): Promise<void> {
  if (accessGrantsTableReady) return;
  await databaseService.query(`
    CREATE TABLE IF NOT EXISTS config_access_grants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      config_id UUID NOT NULL REFERENCES configs(id) ON DELETE CASCADE,
      user_id UUID,
      wallet_address TEXT NOT NULL,
      amount DECIMAL(12, 6) NOT NULL,
      platform_fee DECIMAL(12, 6) DEFAULT 0,
      tx_signature TEXT UNIQUE,
      memo TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_config_access_grants_lookup
      ON config_access_grants(config_id, expires_at);
  `);
  accessGrantsTableReady = true;
}

/** Ensure the hide_items column exists on configs (idempotent migration) */
let hideItemsColumnReady = false;
async function ensureHideItemsColumn(): Promise<void> {
  if (hideItemsColumnReady) return;
  await databaseService.query(`
    ALTER TABLE configs ADD COLUMN IF NOT EXISTS hide_items BOOLEAN DEFAULT FALSE
  `);
  hideItemsColumnReady = true;
}

// Run migration on module load (non-blocking)
ensureHideItemsColumn().catch(err =>
  console.warn('[configs] Failed to add hide_items column (may already exist):', err.message)
);

/** Check if a user/wallet has an active (unexpired) access grant for a config */
async function hasActiveAccessGrant(
  configId: string,
  userId: string | null | undefined,
  walletAddress: string | null | undefined
): Promise<{ hasAccess: boolean; expiresAt?: Date }> {
  await ensureAccessGrantsTable();
  const result = await databaseService.query(`
    SELECT expires_at FROM config_access_grants
    WHERE config_id = $1
      AND (
        (user_id IS NOT NULL AND user_id = $2)
        OR (wallet_address IS NOT NULL AND wallet_address = $3)
      )
      AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1
  `, [configId, userId || null, walletAddress || null]);

  if (result.rows.length > 0) {
    return { hasAccess: true, expiresAt: new Date(result.rows[0].expires_at) };
  }
  return { hasAccess: false };
}

/**
 * Middleware: check if request has active data access (owner/admin/grant).
 * Sets req.hasDataAccess = true if full data should be returned.
 * Must run AFTER requireConfigAccess so req.config and req.accessType exist.
 */
async function checkDataAccess(
  req: any,
  _res: any,
  next: any
): Promise<void> {
  const accessType = req.accessType;
  if (accessType === 'owner' || accessType === 'admin') {
    req.hasDataAccess = true;
    next();
    return;
  }

  const config = req.config;
  if (!config?.monetization_enabled || !config?.price_per_query || parseFloat(config.price_per_query) <= 0) {
    // Non-monetized config — everyone has access
    req.hasDataAccess = true;
    next();
    return;
  }

  // Monetized config — check for active grant
  const user = req.user;
  const grant = await hasActiveAccessGrant(
    config.id,
    user?.id,
    user?.walletAddress
  );

  req.hasDataAccess = grant.hasAccess;
  req.grantExpiresAt = grant.expiresAt;
  next();
}

/** Max items/summaries shown in monetized preview mode */
const PREVIEW_ITEM_LIMIT = 3;
/** Max chars of text shown per item in preview */
const PREVIEW_TEXT_LIMIT = 200;
/** Max chars of markdown shown per summary in preview */
const PREVIEW_MARKDOWN_LIMIT = 300;

/**
 * Check if a request is in preview mode (non-owner accessing monetized config
 * without an active access grant).
 * Returns false for owners/admins, non-monetized configs, or users with active grants.
 */
function isPreviewMode(req: any): boolean {
  const accessType = req.accessType;
  if (accessType === 'owner' || accessType === 'admin') return false;
  // If checkDataAccess middleware ran, use its result
  if (req.hasDataAccess === true) return false;
  const config = req.config;
  return config?.monetization_enabled && config?.price_per_query && parseFloat(config.price_per_query) > 0;
}

/**
 * Build payment info object from a config row for preview responses.
 */
function getPreviewPaymentInfo(config: any): object {
  return {
    pricePerQuery: config.price_per_query ? parseFloat(config.price_per_query) : 0.001,
    currency: 'USDC',
    network: process.env.PAYMENT_NETWORK || 'solana',
    message: 'Pay per query to access full data via the API.',
  };
}

// Get singleton instance of aggregator service for running configs
const aggregatorService = AggregatorService.getInstance();

/**
 * Fire-and-forget: increment total_queries on a config whenever its data is accessed.
 * Tracks any read of context, summary, topics, stats, or search results.
 * Non-blocking — errors are silently logged so they never break the request.
 */
export function trackConfigQuery(configId: string): void {
  databaseService.query(
    'UPDATE configs SET total_queries = total_queries + 1 WHERE id = $1',
    [configId]
  ).catch(err => {
    console.error('[trackConfigQuery] Failed to increment total_queries:', err.message);
  });
}

const router = Router();

/**
 * GET /api/v1/configs
 * List public configs (for discovery) with ranking/sorting
 * 
 * Query params:
 *   - limit: number (default 20, max 100)
 *   - offset: number (default 0)
 *   - search: string (text search on name/description)
 *   - sort: 'trending' | 'popular' | 'newest' | 'revenue' (default 'trending')
 */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = '20', offset = '0', search, sort = 'trending' } = req.query;

    // Validate sort parameter
    const validSorts = ['trending', 'popular', 'newest', 'revenue'];
    const sortValue = validSorts.includes(sort as string) ? sort as string : 'trending';

    const result = await userService.getPublicConfigs({
      limit: Math.min(parseInt(limit as string) || 20, 100),
      offset: parseInt(offset as string) || 0,
      search: search as string | undefined,
      sort: sortValue as any,
    });

    res.json({
      configs: result.configs.map(config => ({
        id: config.id,
        name: config.name,
        slug: config.slug,
        description: config.description,
        status: config.status,
        monetizationEnabled: config.monetizationEnabled,
        pricePerQuery: config.pricePerQuery,
        totalItems: config.totalItems,
        totalQueries: config.totalQueries,
        totalRevenue: config.totalRevenue,
        lastRunAt: config.lastRunAt,
        createdAt: config.createdAt,
      })),
      total: result.total,
      sort: sortValue,
      limit: Math.min(parseInt(limit as string) || 20, 100),
      offset: parseInt(offset as string) || 0,
    });
  } catch (error: any) {
    console.error('[API] Error listing configs:', error);
    res.status(500).json({ error: 'Failed to list configs' });
  }
});

/**
 * GET /api/v1/configs/featured
 * List featured configs (curated by admins)
 */
router.get('/featured', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const featuredConfigs = await adminService.getFeaturedConfigs(limit);

    res.json({
      configs: featuredConfigs.map(config => ({
        id: config.id,
        name: config.name,
        slug: config.slug,
        description: config.description,
        monetizationEnabled: config.monetizationEnabled,
        pricePerQuery: config.pricePerQuery,
        totalItems: config.totalItems,
        totalQueries: config.totalQueries,
        ownerWalletAddress: config.ownerWalletAddress,
        featuredAt: config.featuredAt,
        createdAt: config.createdAt,
      })),
      total: featuredConfigs.length,
    });
  } catch (error: any) {
    console.error('[API] Error listing featured configs:', error);
    res.status(500).json({ error: 'Failed to list featured configs' });
  }
});

/**
 * POST /api/v1/configs
 * Create a new config
 */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user can create a new config
    const canCreate = await userService.canCreateConfig(req.user);
    if (!canCreate.allowed) {
      return res.status(403).json({ 
        error: 'Config limit reached',
        message: canCreate.reason 
      });
    }

    const { 
      name, 
      description, 
      visibility = 'private',
      storageType,
      externalDbUrl,
      skipValidation,
      configJson,
      secrets 
    } = req.body;

    // Validate required fields
    if (!name || !configJson) {
      return res.status(400).json({ error: 'Name and configJson are required' });
    }

    // Determine storage type based on tier
    let finalStorageType = storageType;
    if (req.user.tier === 'free') {
      // Free tier uses platform storage - no external DB option
      finalStorageType = 'platform';
    } else {
      // Paid/admin can choose, default to platform
      finalStorageType = storageType || 'platform';
    }

    // Validate external DB if provided (unless skipValidation is true)
    if (finalStorageType === 'external' && externalDbUrl && !skipValidation) {
      const validation = await databaseService.validateExternalDatabase(externalDbUrl);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: 'Invalid external database',
          message: validation.error 
        });
      }
    }

    // Free users can only create public/unlisted configs
    let finalVisibility = visibility;
    if (req.user.tier === 'free' && visibility === 'private') {
      finalVisibility = 'unlisted';
    }

    const config = await userService.createConfig({
      userId: req.user.id,
      name,
      description,
      visibility: finalVisibility,
      storageType: finalStorageType,
      externalDbUrl,
      configJson,
      secrets,
    });

    res.status(201).json({
      id: config.id,
      name: config.name,
      slug: config.slug,
      description: config.description,
      visibility: config.visibility,
      storageType: config.storageType,
      status: config.status,
      createdAt: config.createdAt,
    });
  } catch (error: any) {
    // Handle duplicate name error
    if (error.code === '23505' && error.constraint === 'configs_user_id_name_key') {
      return res.status(409).json({ 
        error: 'Config name already exists',
        message: `You already have a config named "${req.body.name}". Please choose a different name.`
      });
    }
    console.error('[API] Error creating config:', error);
    res.status(500).json({ error: 'Failed to create config' });
  }
});

/**
 * GET /api/v1/configs/:id
 * Get a specific config by ID or slug
 */
router.get('/:id', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = (req as any).config;
    const accessType = (req as any).accessType;

    const isOwner = accessType === 'owner' || accessType === 'admin';

    // Compute data access level for the frontend
    // - 'full': owner/admin — can see everything including runs, settings, raw config
    // - 'open': non-owner, non-monetized OR has active access grant
    // - 'payment_required': non-owner, monetized, no active grant
    let dataAccess: 'full' | 'open' | 'payment_required' = 'open';
    let accessGrantExpiresAt: string | undefined;
    if (isOwner) {
      dataAccess = 'full';
    } else if (config.monetization_enabled && config.price_per_query && parseFloat(config.price_per_query) > 0) {
      // Check if user has an active access grant
      const grant = await hasActiveAccessGrant(
        config.id,
        req.user?.id,
        req.user?.walletAddress
      );
      if (grant.hasAccess) {
        dataAccess = 'open';
        accessGrantExpiresAt = grant.expiresAt!.toISOString();
      } else {
        dataAccess = 'payment_required';
      }
    }

    // Build response based on access level
    const response: any = {
      id: config.id,
      name: config.name,
      slug: config.slug,
      description: config.description,
      visibility: config.visibility,
      monetizationEnabled: config.monetization_enabled,
      pricePerQuery: config.price_per_query ? parseFloat(config.price_per_query) : undefined,
      totalItems: config.total_items,
      totalQueries: config.total_queries,
      status: config.status,
      lastRunAt: config.last_run_at,
      createdAt: config.created_at,
      hideItems: config.hide_items || false,
      isOwner,
      accessType,
      dataAccess,
      ...(accessGrantExpiresAt ? { accessGrantExpiresAt } : {}),
    };

    // Only include sensitive info for owners/admins
    if (isOwner) {
      response.storageType = config.storage_type;
      response.externalDbValid = config.external_db_valid;
      response.externalDbError = config.external_db_error;
      response.totalRevenue = config.total_revenue ? parseFloat(config.total_revenue) : 0;
      response.runsToday = config.runs_today;
      response.lastError = config.last_error;
      response.configJson = config.config_json;
      response.activeJobId = config.active_job_id || undefined;
    }

    res.json(response);
  } catch (error: any) {
    console.error('[API] Error getting config:', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
});

/**
 * PATCH /api/v1/configs/:id
 * Update a config
 */
router.patch('/:id', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { 
      name, 
      description, 
      visibility,
      storageType,
      externalDbUrl,
      skipValidation,
      monetizationEnabled,
      pricePerQuery,
      ownerWallet,
      configJson,
      secrets,
      isLocalExecution,
      hideItems,
    } = req.body;

    // Build update object
    const updates: any = {};
    
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (visibility !== undefined) updates.visibility = visibility;
    if (storageType !== undefined) updates.storageType = storageType;
    if (externalDbUrl !== undefined) updates.externalDbUrl = externalDbUrl;
    if (monetizationEnabled !== undefined) updates.monetizationEnabled = monetizationEnabled;
    if (pricePerQuery !== undefined) updates.pricePerQuery = pricePerQuery;
    if (ownerWallet !== undefined) updates.ownerWallet = ownerWallet;
    if (configJson !== undefined) updates.configJson = configJson;
    if (secrets !== undefined) updates.secrets = secrets;
    if (isLocalExecution !== undefined) updates.isLocalExecution = isLocalExecution;
    if (hideItems !== undefined) updates.hideItems = hideItems;

    // Check monetization permission
    if (monetizationEnabled && req.user?.tier === 'free') {
      return res.status(403).json({ 
        error: 'Upgrade required',
        message: 'Free tier cannot enable monetization'
      });
    }

    // Check private visibility permission
    if (visibility === 'private' && req.user?.tier === 'free') {
      return res.status(403).json({ 
        error: 'Upgrade required',
        message: 'Free tier cannot create private configs'
      });
    }

    // Ensure hide_items column exists before trying to update it
    if (hideItems !== undefined) {
      await ensureHideItemsColumn();
    }

    // Validate external DB if being updated (unless skipValidation is true)
    if (externalDbUrl && !skipValidation) {
      const validation = await databaseService.validateExternalDatabase(externalDbUrl);
      if (!validation.valid) {
        return res.status(400).json({ 
          error: 'Invalid external database',
          message: validation.error 
        });
      }
    }

    const config = await userService.updateConfig(configId, updates);

    res.json({
      id: config.id,
      name: config.name,
      slug: config.slug,
      description: config.description,
      visibility: config.visibility,
      storageType: config.storageType,
      status: config.status,
      monetizationEnabled: config.monetizationEnabled,
      pricePerQuery: config.pricePerQuery,
      isLocalExecution: config.isLocalExecution,
      hideItems: config.hideItems,
      updatedAt: config.updatedAt,
    });
  } catch (error: any) {
    // Handle duplicate name error (when renaming to an existing name)
    if (error.code === '23505' && error.constraint === 'configs_user_id_name_key') {
      return res.status(409).json({ 
        error: 'Config name already exists',
        message: `You already have a config named "${req.body.name}". Please choose a different name.`
      });
    }
    console.error('[API] Error updating config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * DELETE /api/v1/configs/:id
 * Delete a config
 */
router.delete('/:id', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    
    await userService.deleteConfig(configId);

    res.status(204).send();
  } catch (error: any) {
    console.error('[API] Error deleting config:', error);
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

/**
 * GET /api/v1/configs/:id/context
 * Get context for a config (for LLM consumption)
 */
router.get('/:id/context', optionalAuth, requireConfigAccess, requirePayment, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { date, format = 'json' } = req.query;

    if (format === 'text') {
      // Return LLM-optimized text format
      const maxLength = parseInt(req.query.maxLength as string) || 8000;
      const text = await contextService.formatContextForLLM(configId, date as string, maxLength);
      
      trackConfigQuery(configId);
      res.type('text/plain').send(text);
    } else {
      // Return JSON format
      const context = await contextService.getContext(configId, date as string);
      
      trackConfigQuery(configId);
      res.json(context);
    }
  } catch (error: any) {
    console.error('[API] Error getting context:', error);
    res.status(500).json({ error: 'Failed to get context' });
  }
});

/**
 * GET /api/v1/configs/:id/summary
 * Get summary for a config on a specific date
 */
router.get('/:id/summary', optionalAuth, requireConfigAccess, requirePayment, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { date, type } = req.query;

    const summary = await contextService.getSummary(configId, date as string, type as string);

    if (!summary) {
      return res.status(404).json({ error: 'No summary found for the specified date' });
    }

    trackConfigQuery(configId);
    res.json(summary);
  } catch (error: any) {
    console.error('[API] Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

/**
 * GET /api/v1/configs/:id/topics
 * Get topics with frequency counts
 */
router.get('/:id/topics', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { limit = '50', afterDate, beforeDate } = req.query;

    const topics = await contextService.getTopics(configId, {
      limit: parseInt(limit as string),
      afterDate: afterDate as string,
      beforeDate: beforeDate as string,
    });

    trackConfigQuery(configId);
    res.json({ topics });
  } catch (error: any) {
    console.error('[API] Error getting topics:', error);
    res.status(500).json({ error: 'Failed to get topics' });
  }
});

/**
 * GET /api/v1/configs/:id/stats
 * Get statistics for a config
 */
router.get('/:id/stats', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const accessType = (req as any).accessType;
    const isOwner = accessType === 'owner' || accessType === 'admin';

    const [configStats, sourceStats] = await Promise.all([
      contextService.getConfigStats(configId),
      contextService.getSourceStats(configId),
    ]);

    // Hide totalRevenue from non-owners
    if (!isOwner) {
      delete (configStats as any).totalRevenue;
    }

    trackConfigQuery(configId);
    res.json({
      ...configStats,
      sources: sourceStats,
    });
  } catch (error: any) {
    console.error('[API] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * POST /api/v1/configs/:id/run
 * Trigger aggregation for a config (paid route)
 * 
 * This route is protected by pop402:
 * - Users with an active pro license can run without payment
 * - Users without pro must pay per run ($0.10)
 * 
 * Payment flow:
 * 1. Request comes in with X-PAYMENT header (pop402 handled at app level)
 * 2. Or user has a valid pro license (checked here)
 */
router.post('/:id/run', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  const configId = req.params.id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has pro license (skip pop402 payment if they do)
    let hasProLicense = false;
    if (req.user.tier === 'admin') {
      hasProLicense = true;
    } else if (req.user.walletAddress) {
      const license = await licenseService.verifyLicense(req.user.walletAddress);
      hasProLicense = license.isActive;
    }

    // If no pro license, check if request has pop402 payment
    // The pop402 middleware at app level handles payment verification
    // If we reach here without pro and without payment, the middleware would have
    // returned 402. But since we're using dynamic routes, we need to check manually.
    const hasPaymentHeader = !!req.headers['x-payment'];
    
    if (!hasProLicense && !hasPaymentHeader) {
      // Return 402 Payment Required with run payment details
      const platformWallet = process.env.PLATFORM_WALLET_ADDRESS || '';
      const facilitatorUrl = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
      const network = process.env.POP402_NETWORK || 'solana';
      
      return res.status(402).json({
        error: 'Payment Required',
        code: 'PAYMENT_REQUIRED',
        message: 'This is a paid run. Pay per run or upgrade to Pro for unlimited runs.',
        payment: {
          amount: RUN_PAYMENT.price,
          amountDisplay: `$${RUN_PAYMENT.priceDisplay}`,
          currency: 'USDC',
          network,
          recipient: platformWallet,
          facilitatorUrl,
          description: RUN_PAYMENT.description,
        },
        alternative: {
          message: 'Or upgrade to Pro for unlimited runs',
          upgradeUrl: '/upgrade',
        }
      });
    }

    // If we have a payment header but no pro license, the payment was already verified
    // by the pop402 middleware. If not, we need to verify manually for dynamic routes.
    // For now, we trust that payment-bearing requests are valid since pop402 middleware
    // runs at app level. In a production setup, you'd want to verify the payment here too.

    // Legacy check - keeping for backwards compatibility during transition
    const canRun = await userService.canRunAggregation(req.user, configId);
    if (!canRun.allowed && !hasProLicense && !hasPaymentHeader) {
      return res.status(403).json({ 
        error: 'Run limit reached',
        message: canRun.reason 
      });
    }

    // Get config from database
    const config = await userService.getConfigById(configId);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    // Check if browser sent a fully-resolved config (secrets already injected client-side)
    // The browser resolves $SECRET:uuid$ references, but ALL_CAPS env var references
    // still need server-side resolution via resolveParam()
    const resolvedConfig = req.body?.resolvedConfig;
    if (resolvedConfig) {
      // Browser-side secret resolution: the UI injected $SECRET:uuid$ references.
      // Still pass server secrets for ALL_CAPS env var references.
      const clientPathSecrets = await userService.getConfigSecrets(configId) || {};
      await userService.updateConfigRunStatus(configId, 'running');
      
      const startTime = Date.now();
      const jobId = await aggregatorService.runOneTimeJob(
        configId,
        req.user.id,
        config.name,
        resolvedConfig,
        { runOnce: true },
        clientPathSecrets
      );

      // Set up listener to update status when job completes
      aggregatorService.on(`job:${jobId}`, async (jobStatus: any) => {
        if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
          const durationMs = Date.now() - startTime;
          await userService.updateConfigRunStatus(
            configId,
            jobStatus.status === 'completed' ? 'idle' : 'error',
            durationMs,
            jobStatus.error
          );
          if (jobStatus.status === 'completed') {
            await userService.incrementRunCount(configId);
          }
        }
      });

      return res.json({
        message: 'Aggregation started (client-resolved config)',
        configId,
        jobId,
        queuedAt: new Date().toISOString(),
      });
    }

    // Get decrypted secrets for the config
    const secrets = await userService.getConfigSecrets(configId) || {};

    // Update status to running
    await userService.updateConfigRunStatus(configId, 'running');

    // Prepare config JSON for aggregation
    let configJson = config.configJson as any;
    let aggregationSecrets = { ...secrets };

    // Detect if config uses platform AI
    const usesPlatformAI = configJson.ai?.some((ai: any) => 
      ai.params?.usePlatformAI === true
    );

    // Track whether we need to skip AI processing (quota exhausted)
    let skipAiProcessing = false;
    let aiQuotaExhausted = false;

    // Check AI quota for pro users using platform AI
    if (req.user.tier === 'paid' && usesPlatformAI) {
      const canUseAi = await userService.canUsePlatformAI(req.user);
      if (!canUseAi.allowed) {
        // Don't block - just skip AI processing and store raw data
        skipAiProcessing = true;
        aiQuotaExhausted = true;
        console.log(`[API] AI quota exhausted for user ${req.user.id}, running without AI processing`);
      }
    }

    // Inject platform AI credentials if needed (free tier always, admin always, or pro tier with usePlatformAI)
    const isFreeTier = req.user?.tier === 'free';
    const isAdminTier = req.user?.tier === 'admin';
    const shouldInjectPlatformAI = isFreeTier || isAdminTier || usesPlatformAI;
    
    if (shouldInjectPlatformAI && !skipAiProcessing) {
      const model = isFreeTier
        ? (process.env.FREE_TIER_AI_MODEL || 'openai/gpt-4o-mini')
        : (process.env.PRO_TIER_AI_MODEL || 'openai/gpt-4o');
      const platformApiKey = process.env.OPENAI_API_KEY;
      const siteUrl = process.env.SITE_URL || '';
      const siteName = process.env.SITE_NAME || '';
      
      if (!platformApiKey) {
        console.warn('[API] No OPENAI_API_KEY configured for platform AI');
      }
            
      // Inject credentials into AI plugins that use platform AI (or all for free/admin tier)
      // Platform AI uses OpenRouter as the backend provider
      configJson.ai = configJson.ai?.map((ai: any) => {
        if (ai.params?.usePlatformAI || isFreeTier || isAdminTier) {
          return {
            ...ai,
            params: {
              ...ai.params,
              model,
              apiKey: platformApiKey,
              useOpenRouter: true,
              siteUrl,
              siteName,
            }
          };
        }
        return ai;
      }) || [];
      
      // Free tier: skip file output for generators
      if (isFreeTier && configJson.generators && Array.isArray(configJson.generators)) {
        configJson.generators = configJson.generators.map((gen: any) => ({
          ...gen,
          params: {
            ...gen.params,
            skipFileOutput: true, // Free tier stores in platform DB only, no file output
          }
        }));
      }
    }

    // If AI quota exhausted, remove AI processing entirely (store raw data only)
    if (skipAiProcessing) {
      console.log('[API] Skipping AI processing - quota exhausted, storing raw data only');
      configJson = {
        ...configJson,
        ai: [], // No AI provider
        enrichers: [], // Skip enrichers (they typically use AI)
        generators: configJson.generators?.map((gen: any) => ({
          ...gen,
          params: {
            ...gen.params,
            skipAiProcessing: true, // Flag for generators to skip AI steps
          }
        })) || []
      };
    }

    // Inject platform storage credentials if needed (free tier always, or usePlatformStorage flag)
    const usesPlatformStorage = configJson.storage?.some((storage: any) => 
      storage.params?.usePlatformStorage === true
    );
    const shouldUsePlatformStorage = config.storageType === 'platform' || isFreeTier || isAdminTier || usesPlatformStorage;
    
    if (shouldUsePlatformStorage) {
      const platformDbUrl = process.env.DATABASE_URL;
      
      if (!platformDbUrl) {
        console.warn('[API] No DATABASE_URL configured for platform storage');
      }
            
      // Inject credentials into storage plugins that use platform storage (or all for free/admin tier)
      configJson.storage = configJson.storage?.map((storage: any) => {
        if (storage.params?.usePlatformStorage || isFreeTier || isAdminTier) {
          return {
            ...storage,
            params: {
              ...storage.params,
              configId, // For multi-tenant isolation
              connectionString: platformDbUrl,
            }
          };
        }
        return storage;
      }) || [];
      
      // Log storage config count (not params - may contain credentials)
    }

    // Run aggregation using DB-backed job
    const startTime = Date.now();
    const jobId = await aggregatorService.runOneTimeJob(
      configId,
      req.user.id,
      config.name,
      configJson,
      { runOnce: true },
      aggregationSecrets
    );

    // Set up listener to update status when job completes
    aggregatorService.on(`job:${jobId}`, async (jobStatus: any) => {
      if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
        const durationMs = Date.now() - startTime;
        await userService.updateConfigRunStatus(
          configId,
          jobStatus.status === 'completed' ? 'idle' : 'error',
          durationMs,
          jobStatus.error
        );
        
        // Only count successful runs against the daily limit
        if (jobStatus.status === 'completed') {
          await userService.incrementRunCount(configId);
          
          // Track AI usage for pro users using platform AI (if not skipped)
          if (req.user && req.user.tier === 'paid' && usesPlatformAI && !skipAiProcessing) {
            // Estimate AI calls based on job stats, default to 1 if not available
            const aiCallCount = jobStatus.aggregationStatus?.stats?.aiCalls || 1;
            await userService.incrementAiUsage(req.user.id, aiCallCount);
          }
        }
      }
    });

    // Build response message
    let message = 'Aggregation started';
    if (aiQuotaExhausted) {
      message = 'Aggregation started (AI processing skipped - daily quota exhausted, raw data will be collected)';
    }

    res.json({
      message,
      configId,
      jobId,
      aiSkipped: aiQuotaExhausted,
      queuedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error running aggregation:', error);
    // Update status to error
    try {
      await userService.updateConfigRunStatus(configId, 'error', undefined, error.message);
    } catch (updateError) {
      console.error('[API] Error updating config status:', updateError);
    }
    res.status(500).json({ error: 'Failed to run aggregation', message: error.message });
  }
});

/**
 * POST /api/v1/configs/:id/validate-db
 * Validate external database connection
 */
router.post('/:id/validate-db', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    
    // Get decrypted DB URL
    const dbUrl = await userService.getConfigExternalDbUrl(configId);
    
    if (!dbUrl) {
      return res.status(400).json({ error: 'No external database configured' });
    }

    const validation = await databaseService.validateExternalDatabase(dbUrl);

    // Update config with validation result
    await databaseService.query(
      `UPDATE configs SET 
        external_db_valid = $1,
        external_db_error = $2
       WHERE id = $3`,
      [validation.valid, validation.error || null, configId]
    );

    res.json({
      valid: validation.valid,
      error: validation.error,
      hasVectorExtension: validation.hasVectorExtension,
      hasTables: validation.hasTables,
    });
  } catch (error: any) {
    console.error('[API] Error validating database:', error);
    res.status(500).json({ error: 'Failed to validate database' });
  }
});

/**
 * GET /api/v1/configs/:id/items
 * Get content items for a config
 */
router.get('/:id/items', optionalAuth, requireConfigAccess, checkDataAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const config = (req as any).config;
    const accessType = (req as any).accessType;
    const isOwner = accessType === 'owner' || accessType === 'admin';

    // Enforce hide_items for non-owners
    if (!isOwner && config?.hide_items) {
      return res.status(403).json({
        error: 'Items are not publicly available for this config',
        code: 'ITEMS_HIDDEN',
      });
    }

    const preview = isPreviewMode(req);
    
    // In preview mode: ignore pagination params, return limited items
    const limit = preview ? PREVIEW_ITEM_LIMIT : (parseInt(req.query.limit as string) || 50);
    const offset = preview ? 0 : (parseInt(req.query.offset as string) || 0);
    const source = req.query.source as string;
    const type = req.query.type as string;

    let query = `
      SELECT id, config_id, cid, type, source, title, text, link, topics, date, metadata, created_at
      FROM items 
      WHERE config_id = $1
    `;
    const params: any[] = [configId];
    let paramIndex = 2;

    if (source) {
      query += ` AND source = $${paramIndex++}`;
      params.push(source);
    }

    if (type) {
      query += ` AND type = $${paramIndex++}`;
      params.push(type);
    }

    query += ` ORDER BY date DESC, created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await databaseService.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM items WHERE config_id = $1`;
    const countParams: any[] = [configId];
    let countParamIndex = 2;

    if (source) {
      countQuery += ` AND source = $${countParamIndex++}`;
      countParams.push(source);
    }

    if (type) {
      countQuery += ` AND type = $${countParamIndex++}`;
      countParams.push(type);
    }

    const countResult = await databaseService.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    // In preview mode: truncate text, strip metadata, add payment info
    let items = result.rows;
    if (preview) {
      items = items.map((item: any) => ({
        ...item,
        text: item.text && item.text.length > PREVIEW_TEXT_LIMIT
          ? item.text.slice(0, PREVIEW_TEXT_LIMIT) + '...'
          : item.text,
        metadata: undefined, // Don't leak full metadata in preview
      }));
    }

    res.json({
      items,
      pagination: {
        total,
        limit,
        offset,
        hasMore: preview ? false : (offset + result.rows.length < total),
      },
      ...(preview ? {
        preview: true,
        previewLimit: PREVIEW_ITEM_LIMIT,
        payment: getPreviewPaymentInfo((req as any).config),
      } : {}),
    });
  } catch (error: any) {
    console.error('[API] Error getting items:', error);
    res.status(500).json({ error: 'Failed to get items' });
  }
});

/**
 * GET /api/v1/configs/:id/content
 * Get generated content (summaries) for a config
 */
router.get('/:id/content', optionalAuth, requireConfigAccess, checkDataAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const preview = isPreviewMode(req);
    
    const limit = preview ? PREVIEW_ITEM_LIMIT : (parseInt(req.query.limit as string) || 20);
    const offset = preview ? 0 : (parseInt(req.query.offset as string) || 0);
    const type = req.query.type as string;

    let query = `
      SELECT id, config_id, type, title, categories, markdown, date, created_at
      FROM summaries 
      WHERE config_id = $1
    `;
    const params: any[] = [configId];
    let paramIndex = 2;

    if (type) {
      query += ` AND type = $${paramIndex++}`;
      params.push(type);
    }

    query += ` ORDER BY date DESC, created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await databaseService.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM summaries WHERE config_id = $1`;
    const countParams: any[] = [configId];

    if (type) {
      countQuery += ` AND type = $2`;
      countParams.push(type);
    }

    const countResult = await databaseService.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    // In preview mode: truncate markdown, strip categories
    let content = result.rows;
    if (preview) {
      content = content.map((s: any) => ({
        ...s,
        markdown: s.markdown && s.markdown.length > PREVIEW_MARKDOWN_LIMIT
          ? s.markdown.slice(0, PREVIEW_MARKDOWN_LIMIT) + '\n\n*[Preview truncated — pay to access full content]*'
          : s.markdown,
        categories: undefined,
      }));
    }

    res.json({
      content,
      pagination: {
        total,
        limit,
        offset,
        hasMore: preview ? false : (offset + result.rows.length < total),
      },
      ...(preview ? {
        preview: true,
        previewLimit: PREVIEW_ITEM_LIMIT,
        payment: getPreviewPaymentInfo((req as any).config),
      } : {}),
    });
  } catch (error: any) {
    console.error('[API] Error getting content:', error);
    res.status(500).json({ error: 'Failed to get content' });
  }
});

/**
 * GET /api/v1/configs/:id/content/:contentId
 * Get a specific content entry (summary) with full content
 */
router.get('/:id/content/:contentId', optionalAuth, requireConfigAccess, requirePayment, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const contentId = req.params.contentId;

    const result = await databaseService.query(
      `SELECT * FROM summaries WHERE config_id = $1 AND id = $2`,
      [configId, contentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('[API] Error getting content:', error);
    res.status(500).json({ error: 'Failed to get content' });
  }
});

// ============================================
// ACCESS GRANT ROUTES — 24-hour purchasable access
// ============================================

/**
 * GET /api/v1/configs/:id/access
 * Check current user's access status for a monetized config.
 */
router.get('/:id/access', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = (req as any).config;
    const accessType = (req as any).accessType;
    const isOwner = accessType === 'owner' || accessType === 'admin';

    // Owners always have access
    if (isOwner) {
      return res.json({ hasAccess: true, reason: 'owner' });
    }

    // Non-monetized configs are always open
    if (!config.monetization_enabled || !config.price_per_query || parseFloat(config.price_per_query) <= 0) {
      return res.json({ hasAccess: true, reason: 'open' });
    }

    // Check for active grant
    const grant = await hasActiveAccessGrant(
      config.id,
      req.user?.id,
      req.user?.walletAddress
    );

    if (grant.hasAccess) {
      const remainingMs = grant.expiresAt!.getTime() - Date.now();
      const remainingHours = Math.max(0, remainingMs / (1000 * 60 * 60));
      return res.json({
        hasAccess: true,
        reason: 'grant',
        expiresAt: grant.expiresAt!.toISOString(),
        remainingHours: Math.round(remainingHours * 10) / 10,
      });
    }

    res.json({
      hasAccess: false,
      pricePerQuery: parseFloat(config.price_per_query),
      currency: 'USDC',
      network: process.env.PAYMENT_NETWORK || 'solana',
      durationHours: 24,
    });
  } catch (error: any) {
    console.error('[API] Error checking access:', error);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

/**
 * POST /api/v1/configs/:id/access/purchase
 * Purchase 24-hour data access for a monetized config.
 *
 * Flow:
 * 1. Without X-Payment-Proof header → return 402 with payment details
 * 2. With valid X-Payment-Proof → verify, create 24h grant, return success
 */
router.post('/:id/access/purchase', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = (req as any).config;
    const accessType = (req as any).accessType;
    const isOwner = accessType === 'owner' || accessType === 'admin';

    if (isOwner) {
      return res.json({ success: true, access: { reason: 'owner' } });
    }

    // Check if config is monetized
    const pricePerQuery = config.price_per_query ? parseFloat(config.price_per_query) : 0;
    if (!config.monetization_enabled || pricePerQuery <= 0) {
      return res.json({ success: true, access: { reason: 'open' } });
    }

    // Check if user already has access
    const existingGrant = await hasActiveAccessGrant(
      config.id,
      req.user?.id,
      req.user?.walletAddress
    );
    if (existingGrant.hasAccess) {
      const remainingMs = existingGrant.expiresAt!.getTime() - Date.now();
      const remainingHours = Math.max(0, remainingMs / (1000 * 60 * 60));
      return res.json({
        success: true,
        access: {
          expiresAt: existingGrant.expiresAt!.toISOString(),
          remainingHours: Math.round(remainingHours * 10) / 10,
          durationHours: 24,
        },
      });
    }

    // Check for payment proof header
    const paymentProofHeader = req.headers['x-payment-proof'] as string;

    if (!paymentProofHeader) {
      // Return 402 with payment details
      const platformFeePercent = parseInt(process.env.PLATFORM_FEE_PERCENT || '10');
      const platformFee = Math.floor(pricePerQuery * platformFeePercent / 100 * 1e6) / 1e6;
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const memo = `access:${config.id}:${timestamp}:${random}`;

      return res.status(402).json({
        error: 'Payment Required',
        code: 'PAYMENT_REQUIRED',
        payment: {
          amount: pricePerQuery,
          currency: 'USDC',
          network: process.env.PAYMENT_NETWORK || 'solana',
          recipient: config.owner_wallet,
          platformWallet: process.env.PLATFORM_WALLET_ADDRESS || '',
          platformFee,
          facilitatorUrl: process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com',
          memo,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          sku: config.id,
          durationHours: 24,
          description: `24-hour data access to "${config.name}"`,
        },
      });
    }

    // Parse payment proof
    let paymentProof: { signature: string; memo: string };
    try {
      paymentProof = JSON.parse(paymentProofHeader);
    } catch {
      return res.status(400).json({ error: 'Invalid payment proof format' });
    }

    if (!paymentProof.signature || !paymentProof.memo) {
      return res.status(400).json({ error: 'Payment proof must include signature and memo' });
    }

    // Check for duplicate payment
    await ensureAccessGrantsTable();
    const dupCheck = await databaseService.query(
      'SELECT 1 FROM config_access_grants WHERE tx_signature = $1',
      [paymentProof.signature]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Payment has already been used' });
    }

    // Verify payment with facilitator
    const facilitatorUrl = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
    const platformFeePercent = parseInt(process.env.PLATFORM_FEE_PERCENT || '10');
    const platformFee = Math.floor(pricePerQuery * platformFeePercent / 100 * 1e6) / 1e6;
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS || '';

    let verification: { valid: boolean; error?: string };
    try {
      const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: paymentProof.signature,
          expectedMemo: paymentProof.memo,
          expectedAmount: pricePerQuery,
          expectedRecipients: [config.owner_wallet, platformWallet].filter(Boolean),
        }),
      });
      if (!verifyRes.ok) {
        const errText = await verifyRes.text();
        verification = { valid: false, error: `Facilitator error: ${errText}` };
      } else {
        verification = await verifyRes.json();
      }
    } catch (err: any) {
      verification = { valid: false, error: `Failed to verify: ${err.message}` };
    }

    if (!verification.valid) {
      return res.status(402).json({
        error: 'Payment verification failed',
        details: verification.error,
      });
    }

    // Create 24-hour access grant
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const walletAddress = req.user?.walletAddress || req.body?.walletAddress || '';

    await databaseService.query(`
      INSERT INTO config_access_grants (
        config_id, user_id, wallet_address, amount, platform_fee,
        tx_signature, memo, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      config.id,
      req.user?.id || null,
      walletAddress,
      pricePerQuery,
      platformFee,
      paymentProof.signature,
      paymentProof.memo,
      expiresAt.toISOString(),
    ]);

    // Update config revenue stats
    await databaseService.query(`
      UPDATE configs SET
        total_queries = total_queries + 1,
        total_revenue = total_revenue + $2
      WHERE id = $1
    `, [config.id, pricePerQuery]);

    res.json({
      success: true,
      access: {
        expiresAt: expiresAt.toISOString(),
        durationHours: 24,
      },
    });
  } catch (error: any) {
    console.error('[API] Error purchasing access:', error);
    res.status(500).json({ error: 'Failed to process access purchase' });
  }
});

// ============================================
// RUN MANAGEMENT ROUTES
// ============================================

/**
 * POST /api/v1/configs/:id/run/free
 * Trigger a free one-time aggregation (1 per day per user)
 */
router.post('/:id/run/free', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  const configId = req.params.id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user can use their free run today
    const canRunFree = await jobService.canUserRunFree(req.user.id);
    if (!canRunFree) {
      const freeRunStatus = await jobService.getFreeRunStatus(req.user.id);
      return res.status(429).json({ 
        error: 'Free run already used today',
        message: 'You have already used your free run today. Upgrade to Pro for unlimited runs.',
        resetAt: freeRunStatus.resetAt.toISOString(),
      });
    }

    // Get config from database
    const config = await userService.getConfigById(configId);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    // Mark free run as used BEFORE starting to prevent double-runs
    await jobService.markFreeRunUsed(req.user.id);

    // Check if browser sent a fully-resolved config (secrets already injected client-side)
    // The browser resolves $SECRET:uuid$ references, but ALL_CAPS env var references
    // still need server-side resolution via resolveParam()
    const resolvedConfig = req.body?.resolvedConfig;
    if (resolvedConfig) {
      // Browser-side secret resolution: the UI injected $SECRET:uuid$ references.
      // Still pass server secrets for ALL_CAPS env var references.
      const clientPathSecrets = await userService.getConfigSecrets(configId) || {};
      await userService.updateConfigRunStatus(configId, 'running');
      
      const startTime = Date.now();
      const jobId = await aggregatorService.runOneTimeJob(
        configId,
        req.user.id,
        config.name,
        resolvedConfig,
        { runOnce: true },
        clientPathSecrets
      );

      // Set up listener to update status when job completes
      aggregatorService.on(`job:${jobId}`, async (jobStatus: any) => {
        if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
          const durationMs = Date.now() - startTime;
          await userService.updateConfigRunStatus(
            configId,
            jobStatus.status === 'completed' ? 'idle' : 'error',
            durationMs,
            jobStatus.error
          );
          if (jobStatus.status === 'completed') {
            await userService.incrementRunCount(configId);
          }
        }
      });

      const freeRunStatus = await jobService.getFreeRunStatus(req.user.id);

      return res.json({
        message: 'Free run started (client-resolved config)',
        configId,
        jobId,
        freeRunReset: freeRunStatus.resetAt.toISOString(),
        queuedAt: new Date().toISOString(),
      });
    }

    // Get decrypted secrets for the config
    const secrets = await userService.getConfigSecrets(configId) || {};

    // Prepare config JSON for aggregation (same logic as existing run route)
    let configJson = config.configJson as any;
    let aggregationSecrets = { ...secrets };

    // Free tier always uses platform AI with efficient model
    const model = process.env.FREE_TIER_AI_MODEL || 'openai/gpt-4o-mini';
    const platformApiKey = process.env.OPENAI_API_KEY;
    const siteUrl = process.env.SITE_URL || '';
    const siteName = process.env.SITE_NAME || '';
    
    // Inject platform AI credentials
    configJson.ai = configJson.ai?.map((ai: any) => ({
      ...ai,
      params: {
        ...ai.params,
        model,
        apiKey: platformApiKey,
        useOpenRouter: true,
        siteUrl,
        siteName,
      }
    })) || [];
    
    // Free tier: skip file output for generators
    if (configJson.generators && Array.isArray(configJson.generators)) {
      configJson.generators = configJson.generators.map((gen: any) => ({
        ...gen,
        params: {
          ...gen.params,
          skipFileOutput: true,
        }
      }));
    }

    // Inject platform storage credentials
    const platformDbUrl = process.env.DATABASE_URL;
    configJson.storage = configJson.storage?.map((storage: any) => ({
      ...storage,
      params: {
        ...storage.params,
        configId,
        connectionString: platformDbUrl,
      }
    })) || [];

    // Run aggregation using new DB-backed job
    const jobId = await aggregatorService.runOneTimeJob(
      configId,
      req.user.id,
      config.name,
      configJson,
      { runOnce: true },
      aggregationSecrets
    );

    const freeRunStatus = await jobService.getFreeRunStatus(req.user.id);

    res.json({
      message: 'Free run started',
      configId,
      jobId,
      freeRunReset: freeRunStatus.resetAt.toISOString(),
      queuedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error running free aggregation:', error);
    res.status(500).json({ error: 'Failed to run aggregation', message: error.message });
  }
});

/**
 * POST /api/v1/configs/:id/run/continuous
 * Start a continuous aggregation job (pro only)
 * 
 * This route requires an active pro license via pop402.
 * Continuous jobs run indefinitely until stopped.
 */
router.post('/:id/run/continuous', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  const configId = req.params.id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has pro license - REQUIRED for continuous runs
    let hasProLicense = false;
    if (req.user.tier === 'admin') {
      hasProLicense = true;
    } else if (req.user.walletAddress) {
      const license = await licenseService.verifyLicense(req.user.walletAddress);
      hasProLicense = license.isActive;
    }

    if (!hasProLicense) {
      return res.status(403).json({
        error: 'Pro license required',
        code: 'PRO_REQUIRED',
        message: 'Continuous aggregation requires a Pro subscription. Upgrade to Pro for unlimited continuous runs.',
        upgradeUrl: '/upgrade',
      });
    }

    // Check if there's already a running continuous job for this config
    const existingJob = await jobService.getActiveContinuousJob(configId);
    if (existingJob) {
      return res.status(409).json({ 
        error: 'Continuous job already running',
        message: 'A continuous job is already running for this config. Stop it first before starting a new one.',
        jobId: existingJob.id,
      });
    }

    // Get global interval from request body or config
    const globalInterval = req.body.globalInterval || 3600000; // Default 1 hour

    // Get config from database
    const config = await userService.getConfigById(configId);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    // Check if browser sent a fully-resolved config (secrets already injected client-side)
    // The browser resolves $SECRET:uuid$ references, but ALL_CAPS env var references
    // (like CODEX_API_KEY) and process.env.X references still need server-side resolution
    const resolvedConfig = req.body?.resolvedConfig;

    // Always get server-side secrets — even with resolvedConfig, ALL_CAPS references
    // need the secrets map for resolution via resolveParam()
    const secrets = await userService.getConfigSecrets(configId) || {};

    // Use resolvedConfig if provided (browser resolved $SECRET:uuid$ references),
    // otherwise fall back to the raw config from the database
    let configJson = resolvedConfig || (config.configJson as any);
    let aggregationSecrets = { ...secrets };

    // Detect if config uses platform AI
    const usesPlatformAI = configJson.ai?.some((ai: any) => 
      ai.params?.usePlatformAI === true
    );
    const isAdmin = req.user.tier === 'admin';
    const shouldInjectPlatformAI = isAdmin || usesPlatformAI;

    // Inject platform AI credentials if needed (admin always, or usePlatformAI flag)
    if (shouldInjectPlatformAI) {
      const model = process.env.PRO_TIER_AI_MODEL || 'openai/gpt-4o';
      const platformApiKey = process.env.OPENAI_API_KEY;
      const siteUrl = process.env.SITE_URL || '';
      const siteName = process.env.SITE_NAME || '';

      if (!platformApiKey) {
        console.warn('[API] No OPENAI_API_KEY configured for platform AI');
      }

      // Inject credentials into AI plugins that use platform AI (or all for admin)
      configJson.ai = configJson.ai?.map((ai: any) => {
        if (ai.params?.usePlatformAI || isAdmin) {
          return {
            ...ai,
            params: {
              ...ai.params,
              model,
              apiKey: platformApiKey,
              useOpenRouter: true,
              siteUrl,
              siteName,
            }
          };
        }
        return ai;
      }) || [];
    }

    // Inject platform storage credentials if needed
    const usesPlatformStorage = configJson.storage?.some((storage: any) => 
      storage.params?.usePlatformStorage === true
    );
    const shouldUsePlatformStorage = config.storageType === 'platform' || isAdmin || usesPlatformStorage;
    
    if (shouldUsePlatformStorage) {
      const platformDbUrl = process.env.DATABASE_URL;

      if (!platformDbUrl) {
        console.warn('[API] No DATABASE_URL configured for platform storage');
      }

      // Inject credentials into storage plugins that use platform storage (or all for admin)
      configJson.storage = configJson.storage?.map((storage: any) => {
        if (storage.params?.usePlatformStorage || config.storageType === 'platform' || isAdmin) {
          return {
            ...storage,
            params: {
              ...storage.params,
              configId,
              connectionString: platformDbUrl,
            }
          };
        }
        return storage;
      }) || [];
    }

    // Start continuous aggregation
    const jobId = await aggregatorService.startContinuousJob(
      configId,
      req.user.id,
      config.name,
      configJson,
      { runOnce: false },
      aggregationSecrets,
      globalInterval
    );

    res.json({
      message: 'Continuous aggregation started',
      configId,
      jobId,
      globalInterval,
      queuedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error starting continuous aggregation:', error);
    res.status(500).json({ error: 'Failed to start continuous aggregation', message: error.message });
  }
});

/**
 * POST /api/v1/configs/:id/run/stop
 * Stop a running continuous job
 */
router.post('/:id/run/stop', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  const configId = req.params.id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find the active continuous job for this config
    const activeJob = await jobService.getActiveContinuousJob(configId);
    if (!activeJob) {
      return res.status(404).json({ 
        error: 'No running job found',
        message: 'There is no active continuous job for this config.',
      });
    }

    // Stop the job
    const stopped = await aggregatorService.stopContinuousJob(activeJob.id);
    if (!stopped) {
      return res.status(500).json({ error: 'Failed to stop job' });
    }

    res.json({
      message: 'Continuous job stopped',
      configId,
      jobId: activeJob.id,
    });
  } catch (error: any) {
    console.error('[API] Error stopping continuous job:', error);
    res.status(500).json({ error: 'Failed to stop job', message: error.message });
  }
});

/**
 * GET /api/v1/configs/:id/runs
 * Get run history for a config
 */
router.get('/:id/runs', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await jobService.getJobsByConfig(configId, { limit, offset });

    res.json({
      runs: result.jobs.map(job => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        globalInterval: job.globalInterval,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        itemsFetched: job.itemsFetched,
        itemsProcessed: job.itemsProcessed,
        runCount: job.runCount,
        lastFetchAt: job.lastFetchAt?.toISOString(),
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
      })),
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: result.hasMore,
      }
    });
  } catch (error: any) {
    console.error('[API] Error getting run history:', error);
    res.status(500).json({ error: 'Failed to get run history' });
  }
});

/**
 * GET /api/v1/configs/:id/runs/:runId
 * Get details of a specific run
 */
router.get('/:id/runs/:runId', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const runId = req.params.runId;

    const job = await jobService.getJob(runId);

    if (!job) {
      return res.status(404).json({ error: 'Run not found' });
    }

    // Verify the job belongs to this config
    if (job.configId !== configId) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.json({
      id: job.id,
      configId: job.configId,
      userId: job.userId,
      jobType: job.jobType,
      status: job.status,
      globalInterval: job.globalInterval,
      startedAt: job.startedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      itemsFetched: job.itemsFetched,
      itemsProcessed: job.itemsProcessed,
      runCount: job.runCount,
      lastFetchAt: job.lastFetchAt?.toISOString(),
      errorMessage: job.errorMessage,
      logs: job.logs,
      createdAt: job.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error getting run details:', error);
    res.status(500).json({ error: 'Failed to get run details' });
  }
});

export default router;
