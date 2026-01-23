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

// Create aggregator service instance for running configs
const aggregatorService = new AggregatorService();

const router = Router();

/**
 * GET /api/v1/configs
 * List public configs (for discovery)
 */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit = '20', offset = '0', search } = req.query;

    const result = await userService.getPublicConfigs({
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      search: search as string | undefined,
    });

    res.json({
      configs: result.configs.map(config => ({
        id: config.id,
        name: config.name,
        slug: config.slug,
        description: config.description,
        monetizationEnabled: config.monetizationEnabled,
        pricePerQuery: config.pricePerQuery,
        totalItems: config.totalItems,
        totalQueries: config.totalQueries,
        createdAt: config.createdAt,
      })),
      total: result.total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    console.error('[API] Error listing configs:', error);
    res.status(500).json({ error: 'Failed to list configs' });
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
    };

    // Only include sensitive info for owners/admins
    if (accessType === 'owner' || accessType === 'admin') {
      response.storageType = config.storage_type;
      response.externalDbValid = config.external_db_valid;
      response.externalDbError = config.external_db_error;
      response.totalRevenue = config.total_revenue ? parseFloat(config.total_revenue) : 0;
      response.runsToday = config.runs_today;
      response.lastError = config.last_error;
      response.configJson = config.config_json;
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
      secrets 
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
      updatedAt: config.updatedAt,
    });
  } catch (error: any) {
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
router.get('/:id/context', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { date, format = 'json' } = req.query;

    // TODO: Check payment if monetization is enabled

    if (format === 'text') {
      // Return LLM-optimized text format
      const maxLength = parseInt(req.query.maxLength as string) || 8000;
      const text = await contextService.formatContextForLLM(configId, date as string, maxLength);
      
      res.type('text/plain').send(text);
    } else {
      // Return JSON format
      const context = await contextService.getContext(configId, date as string);
      
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
router.get('/:id/summary', optionalAuth, requireConfigAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const { date, type } = req.query;

    // TODO: Check payment if monetization is enabled

    const summary = await contextService.getSummary(configId, date as string, type as string);

    if (!summary) {
      return res.status(404).json({ error: 'No summary found for the specified date' });
    }

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

    const [configStats, sourceStats] = await Promise.all([
      contextService.getConfigStats(configId),
      contextService.getSourceStats(configId),
    ]);

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
 * Trigger aggregation for a config
 */
router.post('/:id/run', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  const configId = req.params.id;
  
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user can run aggregation
    const canRun = await userService.canRunAggregation(req.user, configId);
    if (!canRun.allowed) {
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

    // Inject platform AI credentials if needed (free tier always, or pro tier with usePlatformAI)
    const isFreeTier = req.user?.tier === 'free';
    const shouldInjectPlatformAI = isFreeTier || usesPlatformAI;
    
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
      
      console.log(`[API] Injecting platform AI credentials with model: ${model} for tier: ${req.user?.tier} (using OpenRouter)`);
      
      // Inject credentials into AI plugins that use platform AI (or all for free tier)
      // Platform AI uses OpenRouter as the backend provider
      configJson.ai = configJson.ai?.map((ai: any) => {
        if (ai.params?.usePlatformAI || isFreeTier) {
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
    const shouldUsePlatformStorage = config.storageType === 'platform' || isFreeTier || usesPlatformStorage;
    console.log('[API] Platform storage check:', { tier: req.user?.tier, storageType: config.storageType, usesPlatformStorage, shouldUsePlatformStorage, configId });
    
    if (shouldUsePlatformStorage) {
      const platformDbUrl = process.env.DATABASE_URL;
      
      if (!platformDbUrl) {
        console.warn('[API] No DATABASE_URL configured for platform storage');
      }
      
      console.log('[API] Injecting platform storage credentials:', { configId, hasDbUrl: !!platformDbUrl });
      
      // Inject credentials into storage plugins that use platform storage (or all for free tier)
      configJson.storage = configJson.storage?.map((storage: any) => {
        if (storage.params?.usePlatformStorage || isFreeTier) {
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
      console.log('[API] Configured platform storage for', configJson.storage?.length || 0, 'storage plugin(s)');
    }
    
    // Log config summary (not params - may contain injected credentials)
    console.log('[API] Sending config to aggregator:', {
      configId,
      storageCount: configJson.storage?.length || 0,
      aiCount: configJson.ai?.length || 0,
      generatorCount: configJson.generators?.length || 0,
      enricherCount: configJson.enrichers?.length || 0,
      sourceCount: configJson.sources?.length || 0,
    });

    // Run aggregation
    const startTime = Date.now();
    const jobId = await aggregatorService.runAggregationOnce(
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
            console.log(`[API] Tracked ${aiCallCount} AI calls for user ${req.user.id}`);
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
router.get('/:id/items', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
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

    res.json({
      items: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      }
    });
  } catch (error: any) {
    console.error('[API] Error getting items:', error);
    res.status(500).json({ error: 'Failed to get items' });
  }
});

/**
 * GET /api/v1/configs/:id/summaries
 * Get summaries for a config
 */
router.get('/:id/summaries', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
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

    res.json({
      summaries: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      }
    });
  } catch (error: any) {
    console.error('[API] Error getting summaries:', error);
    res.status(500).json({ error: 'Failed to get summaries' });
  }
});

/**
 * GET /api/v1/configs/:id/summaries/:summaryId
 * Get a specific summary with full content
 */
router.get('/:id/summaries/:summaryId', requireAuth, requireConfigOwner, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configId = req.params.id;
    const summaryId = req.params.summaryId;

    const result = await databaseService.query(
      `SELECT * FROM summaries WHERE config_id = $1 AND id = $2`,
      [configId, summaryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error('[API] Error getting summary:', error);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

export default router;
