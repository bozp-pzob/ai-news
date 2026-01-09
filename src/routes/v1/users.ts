// src/routes/v1/users.ts

import { Router, Response } from 'express';
import { 
  requireAuth, 
  AuthenticatedRequest,
  updateUser
} from '../../middleware/authMiddleware';
import { userService } from '../../services/userService';

const router = Router();

/**
 * GET /api/v1/me
 * Get current user profile
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get additional user stats
    const revenue = await userService.getUserRevenue(req.user.id);
    const configs = await userService.getUserConfigs(req.user.id);

    res.json({
      id: req.user.id,
      privyId: req.user.privyId,
      email: req.user.email,
      walletAddress: req.user.walletAddress,
      tier: req.user.tier,
      stats: {
        configCount: configs.length,
        totalRevenue: revenue.totalRevenue,
        totalQueries: revenue.totalTransactions,
      },
      createdAt: new Date().toISOString(), // TODO: get from DB
    });
  } catch (error: any) {
    console.error('[API] Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * PATCH /api/v1/me
 * Update current user profile
 */
router.patch('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { walletAddress, settings } = req.body;

    // Only allow updating specific fields
    const updates: any = {};
    if (walletAddress !== undefined) {
      updates.walletAddress = walletAddress;
    }
    if (settings !== undefined) {
      updates.settings = settings;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid updates provided' });
    }

    const updatedUser = await updateUser(req.user.id, updates);

    res.json({
      id: updatedUser.id,
      privyId: updatedUser.privyId,
      email: updatedUser.email,
      walletAddress: updatedUser.walletAddress,
      tier: updatedUser.tier,
    });
  } catch (error: any) {
    console.error('[API] Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

/**
 * GET /api/v1/me/configs
 * Get current user's configs
 */
router.get('/configs', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const configs = await userService.getUserConfigs(req.user.id);

    res.json({
      configs: configs.map(config => ({
        id: config.id,
        name: config.name,
        slug: config.slug,
        description: config.description,
        visibility: config.visibility,
        storageType: config.storageType,
        status: config.status,
        monetizationEnabled: config.monetizationEnabled,
        pricePerQuery: config.pricePerQuery,
        totalItems: config.totalItems,
        totalQueries: config.totalQueries,
        totalRevenue: config.totalRevenue,
        lastRunAt: config.lastRunAt,
        createdAt: config.createdAt,
      })),
      total: configs.length,
    });
  } catch (error: any) {
    console.error('[API] Error getting user configs:', error);
    res.status(500).json({ error: 'Failed to get user configs' });
  }
});

/**
 * GET /api/v1/me/revenue
 * Get current user's revenue statistics
 */
router.get('/revenue', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const revenue = await userService.getUserRevenue(req.user.id);

    res.json(revenue);
  } catch (error: any) {
    console.error('[API] Error getting user revenue:', error);
    res.status(500).json({ error: 'Failed to get revenue statistics' });
  }
});

/**
 * GET /api/v1/me/limits
 * Get current user's tier limits and usage
 */
router.get('/limits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const configs = await userService.getUserConfigs(req.user.id);
    
    // Calculate current usage
    const configCount = configs.length;
    const runsToday = configs.reduce((sum, c) => sum + c.runsToday, 0);

    // Get tier limits
    const limits = {
      free: {
        maxConfigs: parseInt(process.env.FREE_TIER_MAX_CONFIGS || '1'),
        maxRunsPerDay: parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY || '1'),
        canMonetize: false,
        canCreatePrivate: false,
        storageType: 'external' as const,
      },
      paid: {
        maxConfigs: -1, // unlimited
        maxRunsPerDay: -1, // unlimited
        canMonetize: true,
        canCreatePrivate: true,
        storageType: 'platform' as const,
      },
      admin: {
        maxConfigs: -1,
        maxRunsPerDay: -1,
        canMonetize: true,
        canCreatePrivate: true,
        storageType: 'platform' as const,
      },
    };

    const tierLimits = limits[req.user.tier];

    res.json({
      tier: req.user.tier,
      limits: tierLimits,
      usage: {
        configCount,
        runsToday,
      },
      canCreateConfig: tierLimits.maxConfigs === -1 || configCount < tierLimits.maxConfigs,
      canRunAggregation: tierLimits.maxRunsPerDay === -1 || runsToday < tierLimits.maxRunsPerDay,
    });
  } catch (error: any) {
    console.error('[API] Error getting user limits:', error);
    res.status(500).json({ error: 'Failed to get user limits' });
  }
});

export default router;
