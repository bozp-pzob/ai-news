// src/routes/v1/search.ts

import { Router, Response } from 'express';
import { 
  optionalAuth,
  requireConfigAccess,
  AuthenticatedRequest 
} from '../../middleware/authMiddleware';
import { contextService } from '../../services/contextService';

const router = Router();

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
    // We need to manually check here since this is a POST endpoint
    // Store original params and set configId for middleware
    req.params.id = configId;
    
    // TODO: Integrate with x402 payment check for monetized configs

    const result = await contextService.search({
      query,
      configId,
      limit: Math.min(limit, 100), // Cap at 100
      threshold: Math.max(0, Math.min(1, threshold)), // Clamp 0-1
      type,
      source,
      afterDate,
      beforeDate,
    });

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
router.get('/:configId', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
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

    // TODO: Check config access and payment

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

    // TODO: Check access for each config
    // TODO: Check payments for monetized configs

    // Search all configs in parallel
    const searchPromises = limitedConfigIds.map(configId =>
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
        results: [],
        totalFound: 0,
        searchTimeMs: 0,
      }))
    );

    const results = await Promise.all(searchPromises);

    // Aggregate stats
    const totalResults = results.reduce((sum, r) => sum + r.totalFound, 0);
    const totalTime = Math.max(...results.map(r => r.searchTimeMs));

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
