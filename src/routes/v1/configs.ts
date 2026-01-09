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
      configJson,
      secrets 
    } = req.body;

    // Validate required fields
    if (!name || !configJson) {
      return res.status(400).json({ error: 'Name and configJson are required' });
    }

    // Free users must use external storage
    let finalStorageType = storageType;
    if (req.user.tier === 'free') {
      if (!externalDbUrl) {
        return res.status(400).json({ 
          error: 'Free tier requires external database',
          message: 'Please provide an externalDbUrl to your PostgreSQL database'
        });
      }
      finalStorageType = 'external';
    } else {
      finalStorageType = storageType || 'platform';
    }

    // Validate external DB if provided
    if (finalStorageType === 'external' && externalDbUrl) {
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

    // Validate external DB if being updated
    if (externalDbUrl) {
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
  try {
    const configId = req.params.id;

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

    // Increment run count
    await userService.incrementRunCount(configId);

    // TODO: Queue aggregation job with Bull
    // For now, return a placeholder response
    res.json({
      message: 'Aggregation queued',
      configId,
      queuedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error running aggregation:', error);
    res.status(500).json({ error: 'Failed to queue aggregation' });
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

export default router;
