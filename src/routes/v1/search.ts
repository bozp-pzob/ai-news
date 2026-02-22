// src/routes/v1/search.ts

import { Router, Response } from 'express';
import { 
  optionalAuth,
  requireConfigAccess,
  AuthenticatedRequest 
} from '../../middleware/authMiddleware';
import { requirePayment } from '../../middleware/x402Middleware';
import { contextService } from '../../services/contextService';
import { databaseService } from '../../services/databaseService';
import { trackConfigQuery } from './configs';

const router = Router();

/**
 * Helper: check if a user can access a config and whether payment is required.
 * Returns { allowed, accessType, config } or sends an error response.
 */
async function checkConfigAccess(
  configId: string,
  userId: string | null,
  walletAddress: string | null,
  userTier: string | null
): Promise<{ allowed: boolean; accessType: string; config: any; paymentRequired: boolean } | null> {
  const result = await databaseService.query(
    `SELECT c.*, 
            CASE 
              WHEN c.user_id = $2 THEN 'owner'
              WHEN c.visibility = 'public' THEN 'public'
              WHEN c.visibility = 'unlisted' THEN 'unlisted'
              ELSE NULL
            END as access_type
     FROM configs c
     WHERE c.id = $1`,
    [configId, userId || null]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const config = result.rows[0];
  let accessType = config.access_type;

  // Admin bypass
  if (userTier === 'admin') {
    accessType = 'admin';
  }

  if (!accessType) {
    return { allowed: false, accessType: 'none', config, paymentRequired: false };
  }

  const isOwner = accessType === 'owner' || accessType === 'admin';

  // If items are hidden and user is not owner, deny access (search returns items)
  if (!isOwner && config.hide_items) {
    return { allowed: false, accessType: 'hidden', config, paymentRequired: false };
  }

  const isMonetized = config.monetization_enabled && config.price_per_query && parseFloat(config.price_per_query) > 0;
  const paymentRequired = !isOwner && isMonetized;

  return { allowed: true, accessType, config, paymentRequired };
}

/**
 * POST /api/v1/search
 * Semantic search across a config's content
 * 
 * Body:
 * - configId: string (required) - Config to search
 * - query: string (required) - Search query
 * - limit: number (optional) - Max results (default 20)
 * - threshold: number (optional) - Similarity threshold 0-1 (default 0.7)
 * - type: string (optional) - Filter by content type
 * - source: string (optional) - Filter by source
 * - afterDate: string (optional) - ISO date string
 * - beforeDate: string (optional) - ISO date string
 */
router.post('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      configId, 
      query, 
      limit = 20, 
      threshold = 0.7,
      type,
      source,
      afterDate,
      beforeDate
    } = req.body;

    // Validate required fields
    if (!configId) {
      return res.status(400).json({ error: 'configId is required' });
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required and must be a string' });
    }

    // Check config access
    const access = await checkConfigAccess(
      configId,
      req.user?.id || null,
      req.user?.walletAddress || null,
      req.user?.tier || null
    );

    if (!access) {
      return res.status(404).json({ error: 'Config not found' });
    }
    if (!access.allowed) {
      if (access.accessType === 'hidden') {
        return res.status(403).json({ error: 'Items are not publicly available for this config', code: 'ITEMS_HIDDEN' });
      }
      return res.status(403).json({ error: 'You do not have permission to access this config' });
    }

    // Check monetization — delegate to requirePayment middleware inline
    if (access.paymentRequired) {
      // Set up req for requirePayment middleware
      req.params.id = configId;
      (req as any).config = access.config;
      (req as any).accessType = access.accessType;
      
      return requirePayment(req, res, () => {
        // Payment verified, continue with search
        contextService.search({
          query,
          configId,
          limit: Math.min(limit, 100),
          threshold: Math.max(0, Math.min(1, threshold)),
          type,
          source,
          afterDate,
          beforeDate,
        }).then(result => {
          trackConfigQuery(configId);
          res.json({
            query,
            configId,
            results: result.results,
            totalFound: result.totalFound,
            searchTimeMs: result.searchTimeMs,
          });
        }).catch(error => {
          console.error('[API] Error searching:', error);
          res.status(500).json({ error: 'Search failed' });
        });
      });
    }

    const result = await contextService.search({
      query,
      configId,
      limit: Math.min(limit, 100),
      threshold: Math.max(0, Math.min(1, threshold)),
      type,
      source,
      afterDate,
      beforeDate,
    });

    trackConfigQuery(configId);
    res.json({
      query,
      configId,
      results: result.results,
      totalFound: result.totalFound,
      searchTimeMs: result.searchTimeMs,
    });
  } catch (error: any) {
    console.error('[API] Error searching:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/v1/search/:configId
 * Semantic search with GET (for simpler integrations)
 * 
 * Query params:
 * - q: string (required) - Search query
 * - limit: number (optional)
 * - threshold: number (optional)
 * - type: string (optional)
 * - source: string (optional)
 * - after: string (optional) - ISO date
 * - before: string (optional) - ISO date
 */
router.get('/:configId', optionalAuth, 
  // Map :configId to :id for requireConfigAccess middleware
  (req, _res, next) => { req.params.id = req.params.configId; next(); },
  requireConfigAccess, requirePayment,
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { configId } = req.params;
    const { 
      q: query, 
      limit = '20', 
      threshold = '0.7',
      type,
      source,
      after: afterDate,
      before: beforeDate
    } = req.query;

    // Validate query
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'q (query) parameter is required' });
    }

    const result = await contextService.search({
      query,
      configId,
      limit: Math.min(parseInt(limit as string), 100),
      threshold: Math.max(0, Math.min(1, parseFloat(threshold as string))),
      type: type as string | undefined,
      source: source as string | undefined,
      afterDate: afterDate as string | undefined,
      beforeDate: beforeDate as string | undefined,
    });

    trackConfigQuery(configId);
    res.json({
      query,
      configId,
      results: result.results,
      totalFound: result.totalFound,
      searchTimeMs: result.searchTimeMs,
    });
  } catch (error: any) {
    console.error('[API] Error searching:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * POST /api/v1/search/multi
 * Search across multiple configs at once
 * 
 * Body:
 * - configIds: string[] (required) - Configs to search
 * - query: string (required) - Search query
 * - limit: number (optional) - Max results per config (default 10)
 * - threshold: number (optional)
 */
router.post('/multi', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      configIds, 
      query, 
      limit = 10, 
      threshold = 0.7 
    } = req.body;

    // Validate required fields
    if (!Array.isArray(configIds) || configIds.length === 0) {
      return res.status(400).json({ error: 'configIds array is required' });
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    // Limit configs to search
    const limitedConfigIds = configIds.slice(0, 10);

    // Check access for each config — filter out inaccessible and payment-required ones
    const accessChecks = await Promise.all(
      limitedConfigIds.map(configId =>
        checkConfigAccess(
          configId,
          req.user?.id || null,
          req.user?.walletAddress || null,
          req.user?.tier || null
        ).then(access => ({ configId, access }))
      )
    );

    const accessibleConfigIds = accessChecks
      .filter(({ access }) => access && access.allowed && !access.paymentRequired)
      .map(({ configId }) => configId);

    const blockedResults = accessChecks
      .filter(({ access }) => !access || !access.allowed)
      .map(({ configId, access }) => ({
        configId,
        error: access?.accessType === 'hidden' ? 'Items hidden' : 'Access denied',
        code: access?.accessType === 'hidden' ? 'ITEMS_HIDDEN' : undefined,
        results: [] as any[],
        totalFound: 0,
        searchTimeMs: 0,
      }));

    const paymentRequiredResults = accessChecks
      .filter(({ access }) => access && access.allowed && access.paymentRequired)
      .map(({ configId }) => ({
        configId,
        error: 'Payment required',
        code: 'PAYMENT_REQUIRED',
        results: [] as any[],
        totalFound: 0,
        searchTimeMs: 0,
      }));

    // Search accessible configs in parallel
    const searchPromises = accessibleConfigIds.map(configId =>
      contextService.search({
        query,
        configId,
        limit: Math.min(limit, 20),
        threshold,
      }).then(result => ({
        configId,
        ...result,
      })).catch(error => ({
        configId,
        error: error.message,
        results: [] as any[],
        totalFound: 0,
        searchTimeMs: 0,
      }))
    );

    const searchResults = await Promise.all(searchPromises);
    const results = [...searchResults, ...blockedResults, ...paymentRequiredResults];

    // Track queries for each config that returned results
    for (const r of searchResults) {
      if (!('error' in r)) {
        trackConfigQuery(r.configId);
      }
    }

    // Aggregate stats
    const totalResults = results.reduce((sum, r) => sum + r.totalFound, 0);
    const totalTime = results.length > 0 ? Math.max(...results.map(r => r.searchTimeMs)) : 0;

    res.json({
      query,
      results,
      totalResults,
      searchTimeMs: totalTime,
    });
  } catch (error: any) {
    console.error('[API] Error multi-searching:', error);
    res.status(500).json({ error: 'Multi-search failed' });
  }
});

export default router;
