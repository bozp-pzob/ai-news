// src/routes/v1/admin.ts

import { Router, Response } from 'express';
import { 
  requireAuth, 
  requireAdmin,
  AuthenticatedRequest 
} from '../../middleware/authMiddleware';
import { 
  adminService, 
  TimeRange, 
  UserTier,
  UserFilterOptions,
  ConfigFilterOptions 
} from '../../services/adminService';

const router = Router();

// All admin routes require authentication and admin tier
router.use(requireAuth, requireAdmin);

// ============================================================================
// STATISTICS ROUTES
// ============================================================================

/**
 * GET /api/v1/admin/stats - Get system-wide statistics
 * Query params: range (today, 7d, 30d, 90d, all)
 */
router.get('/stats', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const range = (req.query.range as TimeRange) || 'all';
    const stats = await adminService.getSystemStats(range);
    res.json(stats);
  } catch (error: any) {
    console.error('[Admin API] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get system statistics' });
  }
});

/**
 * GET /api/v1/admin/stats/usage - Get usage statistics over time
 * Query params: range (today, 7d, 30d, 90d, all)
 */
router.get('/stats/usage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const range = (req.query.range as TimeRange) || '30d';
    const usageData = await adminService.getUsageOverTime(range);
    res.json({ data: usageData });
  } catch (error: any) {
    console.error('[Admin API] Error getting usage stats:', error);
    res.status(500).json({ error: 'Failed to get usage statistics' });
  }
});

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/v1/admin/users - List all users with pagination and filters
 * Query params: page, limit, search, tier, isBanned, sortBy, sortOrder
 */
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const options: UserFilterOptions = {
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
      search: req.query.search as string,
      tier: req.query.tier as UserTier,
      isBanned: req.query.isBanned !== undefined 
        ? req.query.isBanned === 'true' 
        : undefined,
      sortBy: req.query.sortBy as string || 'created_at',
      sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
    };

    const result = await adminService.getAllUsers(options);

    res.json({
      users: result.users,
      total: result.total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(result.total / options.limit!),
    });
  } catch (error: any) {
    console.error('[Admin API] Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * GET /api/v1/admin/users/:id - Get a single user by ID
 */
router.get('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await adminService.getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error: any) {
    console.error('[Admin API] Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PATCH /api/v1/admin/users/:id/tier - Update user tier
 * Body: { tier: 'free' | 'paid' | 'admin' }
 */
router.patch('/users/:id/tier', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tier } = req.body;

    if (!tier || !['free', 'paid', 'admin'].includes(tier)) {
      return res.status(400).json({ 
        error: 'Invalid tier',
        validTiers: ['free', 'paid', 'admin']
      });
    }

    const user = await adminService.updateUserTier(
      req.user!,
      req.params.id,
      tier as UserTier
    );

    res.json({
      success: true,
      user,
      message: `User tier updated to ${tier}`,
    });
  } catch (error: any) {
    console.error('[Admin API] Error updating user tier:', error);
    
    if (error.message === 'Cannot modify your own account') {
      return res.status(400).json({ error: error.message });
    }
    if (error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update user tier' });
  }
});

/**
 * POST /api/v1/admin/users/:id/ban - Ban a user
 * Body: { reason?: string }
 */
router.post('/users/:id/ban', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason } = req.body;

    const user = await adminService.banUser(
      req.user!,
      req.params.id,
      reason
    );

    res.json({
      success: true,
      user,
      message: 'User has been banned',
    });
  } catch (error: any) {
    console.error('[Admin API] Error banning user:', error);
    
    if (error.message === 'Cannot modify your own account') {
      return res.status(400).json({ error: error.message });
    }
    if (error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * POST /api/v1/admin/users/:id/unban - Unban a user
 */
router.post('/users/:id/unban', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await adminService.unbanUser(req.params.id);

    res.json({
      success: true,
      user,
      message: 'User has been unbanned',
    });
  } catch (error: any) {
    console.error('[Admin API] Error unbanning user:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

/**
 * POST /api/v1/admin/users/:id/impersonate - Create an impersonation token
 */
router.post('/users/:id/impersonate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await adminService.createImpersonationToken(
      req.user!,
      req.params.id
    );

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[Admin API] Error creating impersonation token:', error);
    
    if (error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'Cannot impersonate another admin') {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to create impersonation token' });
  }
});

// ============================================================================
// CONFIG MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/v1/admin/configs - List all configs with pagination and filters
 * Query params: page, limit, search, visibility, isFeatured, userId, sortBy, sortOrder
 */
router.get('/configs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const options: ConfigFilterOptions = {
      page: parseInt(req.query.page as string) || 1,
      limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
      search: req.query.search as string,
      visibility: req.query.visibility as string,
      isFeatured: req.query.isFeatured !== undefined 
        ? req.query.isFeatured === 'true' 
        : undefined,
      userId: req.query.userId as string,
      sortBy: req.query.sortBy as string || 'created_at',
      sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
    };

    const result = await adminService.getAllConfigs(options);

    res.json({
      configs: result.configs,
      total: result.total,
      page: options.page,
      limit: options.limit,
      totalPages: Math.ceil(result.total / options.limit!),
    });
  } catch (error: any) {
    console.error('[Admin API] Error listing configs:', error);
    res.status(500).json({ error: 'Failed to list configs' });
  }
});

/**
 * PATCH /api/v1/admin/configs/:id/featured - Set config featured status
 * Body: { featured: boolean }
 */
router.patch('/configs/:id/featured', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { featured } = req.body;

    if (typeof featured !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid request',
        details: 'featured must be a boolean'
      });
    }

    const config = await adminService.setConfigFeatured(req.params.id, featured);

    res.json({
      success: true,
      config,
      message: featured 
        ? 'Config has been featured' 
        : 'Config has been unfeatured',
    });
  } catch (error: any) {
    console.error('[Admin API] Error updating config featured status:', error);
    
    if (error.message === 'Config not found') {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to update config featured status' });
  }
});

// ============================================================================
// FEATURED CONFIGS (Public Endpoint)
// ============================================================================

/**
 * GET /api/v1/admin/featured - Get featured configs (public)
 * This endpoint doesn't require admin access
 */
// Note: This is defined in the router but accessed via /api/v1/configs/featured instead

export default router;
