// src/routes/v1/users.ts

import { Router, Response } from 'express';
import { 
  requireAuth, 
  AuthenticatedRequest,
  updateUser
} from '../../middleware/authMiddleware';
import { userService } from '../../services/userService';
import { 
  licenseService, 
  PlanId,
  PRO_PLANS,
} from '../../services/licenseService';

const router = Router();

// Configuration
const NETWORK = process.env.POP402_NETWORK || 'solana';
const MOCK_MODE = process.env.POP402_MOCK_MODE === 'true';

/**
 * Check if a string is a valid Solana address (base58, 32-44 chars)
 */
function isValidSolanaAddress(address: string): boolean {
  if (!address) return false;
  if (address.startsWith('0x')) return false;
  if (address.length < 32 || address.length > 44) return false;
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

// ============================================================================
// USER PROFILE ROUTES
// ============================================================================

/**
 * GET /api/v1/me - Get current user profile
 */
router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

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
      createdAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[API] Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

/**
 * PATCH /api/v1/me - Update current user profile
 */
router.patch('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { walletAddress, settings } = req.body;
    const updates: any = {};
    
    if (walletAddress !== undefined) updates.walletAddress = walletAddress;
    if (settings !== undefined) updates.settings = settings;

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
 * GET /api/v1/me/configs - Get current user's configs
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
 * GET /api/v1/me/revenue - Get current user's revenue statistics
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
 * GET /api/v1/me/limits - Get current user's tier limits and usage
 */
router.get('/limits', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const configs = await userService.getUserConfigs(req.user.id);
    const configCount = configs.length;
    const runsToday = configs.reduce((sum, c) => sum + c.runsToday, 0);

    let aiUsage = null;
    if (req.user.tier === 'paid' || req.user.tier === 'admin') {
      aiUsage = await userService.getUserAiUsage(req.user.id);
    }

    const limits = {
      free: {
        maxConfigs: parseInt(process.env.FREE_TIER_MAX_CONFIGS || '1'),
        maxRunsPerDay: parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY || '3'),
        canMonetize: false,
        canCreatePrivate: false,
        storageType: 'platform' as const,
        aiModel: process.env.FREE_TIER_AI_MODEL || 'gpt-4o-mini',
      },
      paid: {
        maxConfigs: -1,
        maxRunsPerDay: -1,
        canMonetize: true,
        canCreatePrivate: true,
        storageType: 'platform' as const,
        dailyAiCalls: parseInt(process.env.PRO_TIER_DAILY_AI_CALLS || '1000'),
        aiModel: process.env.PRO_TIER_AI_MODEL || 'gpt-4o',
      },
      admin: {
        maxConfigs: -1,
        maxRunsPerDay: -1,
        canMonetize: true,
        canCreatePrivate: true,
        storageType: 'platform' as const,
        dailyAiCalls: -1,
        aiModel: process.env.PRO_TIER_AI_MODEL || 'gpt-4o',
      },
    };

    const tierLimits = limits[req.user.tier];

    const response: any = {
      tier: req.user.tier,
      limits: tierLimits,
      usage: { configCount, runsToday },
      canCreateConfig: tierLimits.maxConfigs === -1 || configCount < tierLimits.maxConfigs,
      canRunAggregation: tierLimits.maxRunsPerDay === -1 || runsToday < tierLimits.maxRunsPerDay,
    };

    if (aiUsage) {
      response.usage.aiCallsToday = aiUsage.callsToday;
      response.aiCallsLimit = aiUsage.limit;
      response.aiResetAt = aiUsage.resetAt.toISOString();
      response.canUsePlatformAI = req.user.tier === 'admin' || aiUsage.callsToday < aiUsage.limit;
    }

    res.json(response);
  } catch (error: any) {
    console.error('[API] Error getting user limits:', error);
    res.status(500).json({ error: 'Failed to get user limits' });
  }
});

// ============================================================================
// LICENSE ROUTES
// ============================================================================

/**
 * GET /api/v1/me/license - Get current user's license status
 */
router.get('/license', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!req.user.walletAddress) {
      return res.json({
        isActive: false,
        tier: req.user.tier === 'admin' ? 'admin' : 'free',
        walletAddress: null,
        message: 'Connect a wallet to check license status',
      });
    }

    if (!isValidSolanaAddress(req.user.walletAddress)) {
      return res.json({
        isActive: false,
        tier: req.user.tier === 'admin' ? 'admin' : 'free',
        walletAddress: req.user.walletAddress,
        message: 'License requires a Solana wallet',
      });
    }

    console.log(`[API] Checking license for user ${req.user.id}, wallet: ${req.user.walletAddress.slice(0, 8)}...${req.user.walletAddress.slice(-4)}`);
    
    const license = await licenseService.verifyLicense(req.user.walletAddress);

    let effectiveTier: 'free' | 'paid' | 'admin' = 'free';
    if (req.user.tier === 'admin') {
      effectiveTier = 'admin';
    } else if (license.isActive) {
      effectiveTier = 'paid';
    }

    res.json({
      isActive: license.isActive,
      tier: effectiveTier,
      expiresAt: license.expiresAt?.toISOString(),
      walletAddress: req.user.walletAddress,
      sku: license.sku,
    });
  } catch (error: any) {
    console.error('[API] Error getting license:', error);
    res.status(500).json({ error: 'Failed to get license status' });
  }
});

/**
 * GET /api/v1/me/plans - Get available subscription plans
 */
router.get('/plans', async (_req, res: Response) => {
  try {
    const plans = licenseService.getAllPlans();
    const config = licenseService.getLicenseConfig();
    const platformWallet = process.env.PLATFORM_WALLET_ADDRESS;

    if (!platformWallet) {
      console.error('[API] PLATFORM_WALLET_ADDRESS not configured');
      return res.status(500).json({ error: 'Payment configuration error' });
    }

    res.json({
      plans: plans.map(plan => ({
        id: plan.id,
        name: plan.name,
        price: plan.priceDisplay,
        currency: 'USDC',
        days: plan.days,
        pricePerDay: (plan.priceDisplay / plan.days).toFixed(2),
      })),
      sku: config.sku,
      network: config.network,
      platformWallet,
      // Expose mock mode to frontend so it knows which purchase flow to use
      mockMode: MOCK_MODE,
    });
  } catch (error: any) {
    console.error('[API] Error getting plans:', error);
    res.status(500).json({ error: 'Failed to get plans' });
  }
});

/**
 * POST /api/v1/me/license/challenge - Get a challenge for authentication
 */
router.post('/license/challenge', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { walletAddress, ttl } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    if (!isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({ 
        error: 'Invalid wallet address',
        details: 'Challenge requires a valid Solana wallet address',
      });
    }

    const challenge = await licenseService.getChallenge(walletAddress, ttl || 300);
    res.json({ challenge });
  } catch (error: any) {
    console.error('[API] Error getting challenge:', error);
    res.status(500).json({ error: 'Failed to get challenge' });
  }
});

// ============================================================================
// LICENSE PURCHASE ROUTES
// These routes are protected by the pop402 middleware at the app level.
// The middleware handles:
// 1. Returning 402 with payment requirements if no X-PAYMENT header
// 2. Verifying and settling the payment if X-PAYMENT header is present
// 3. Passing through to the handler on successful payment
// ============================================================================

/**
 * Handle successful license purchase after payment verification
 */
async function handleLicensePurchase(
  req: AuthenticatedRequest, 
  res: Response,
  planId: PlanId
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const plan = PRO_PLANS[planId];
    if (!plan) {
      res.status(400).json({ error: 'Invalid plan' });
      return;
    }

    // Get wallet address from X-PAYMENT-META header (set by middleware)
    const paymentMetaHeader = req.headers['x-payment-meta'] as string;
    let walletAddress: string | undefined;
    let paymentSku: string | undefined;
    
    if (paymentMetaHeader) {
      try {
        const paymentMeta = JSON.parse(Buffer.from(paymentMetaHeader, 'base64').toString());
        walletAddress = paymentMeta.payerPubkey;
        paymentSku = paymentMeta.sku;
        console.log('[API] Payment meta:', { 
          sku: paymentMeta.sku, 
          walletAddress: walletAddress?.slice(0, 8) + '...' + walletAddress?.slice(-4),
          challengeId: paymentMeta.challengeId?.slice(0, 20) + '...',
          expirationDate: paymentMeta.expirationDate ? new Date(paymentMeta.expirationDate).toISOString() : 'not set',
        });
      } catch (e) {
        console.error('[API] Failed to parse X-PAYMENT-META:', e);
      }
    }

    // Fallback to request body
    if (!walletAddress) {
      walletAddress = req.body.walletAddress;
    }

    if (!walletAddress) {
      res.status(400).json({ error: 'Wallet address not found' });
      return;
    }

    // Check for existing license (for extension)
    let existingExpiresAt: Date | undefined;
    const existingLicense = await licenseService.verifyLicense(walletAddress, true);
    if (existingLicense.isActive && existingLicense.expiresAt) {
      existingExpiresAt = existingLicense.expiresAt;
    }

    // Calculate new expiration date
    const baseDate = existingExpiresAt && existingExpiresAt > new Date() ? existingExpiresAt : new Date();
    const expiresAt = new Date(baseDate.getTime() + plan.days * 24 * 60 * 60 * 1000);

    // Clear license cache so next check goes to facilitator
    licenseService.clearLicenseCache(walletAddress);

    // Always update user's wallet to the Solana wallet used for payment
    // This is required because pop402 licenses are tied to the Solana wallet
    if (walletAddress && req.user.walletAddress !== walletAddress) {
      console.log(`[API] Updating user wallet from ${req.user.walletAddress?.slice(0, 8) || 'none'}... to ${walletAddress.slice(0, 8)}... (Solana)`);
      await updateUser(req.user.id, { walletAddress });
    }

    console.log(`[API] License purchase successful!`, {
      planId,
      wallet: walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4),
      paymentSku,
      calculatedExpires: expiresAt.toISOString(),
    });

    res.json({
      success: true,
      license: {
        planId,
        expiresAt: expiresAt.toISOString(),
        walletAddress,
      },
    });
  } catch (error: any) {
    console.error('[API] Error processing license purchase:', error);
    res.status(500).json({ error: 'Failed to process license purchase' });
  }
}

// Purchase routes for each plan
router.post('/license/purchase/1d', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  handleLicensePurchase(req, res, '1d');
});

router.post('/license/purchase/7d', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  handleLicensePurchase(req, res, '7d');
});

router.post('/license/purchase/30d', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  handleLicensePurchase(req, res, '30d');
});

router.post('/license/purchase/365d', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  handleLicensePurchase(req, res, '365d');
});

/**
 * POST /api/v1/me/license/purchase-mock - Mock purchase for testing
 */
router.post('/license/purchase-mock', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!MOCK_MODE) {
      return res.status(400).json({ 
        error: 'Mock purchases disabled',
        details: 'Set POP402_MOCK_MODE=true to enable'
      });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { planId, walletAddress } = req.body;

    if (!planId || !walletAddress) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['planId', 'walletAddress']
      });
    }

    if (!isValidSolanaAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid Solana wallet address' });
    }

    let existingExpiresAt: Date | undefined;
    const existingLicense = await licenseService.verifyLicense(walletAddress, true);
    if (existingLicense.isActive && existingLicense.expiresAt) {
      existingExpiresAt = existingLicense.expiresAt;
    }

    const result = await licenseService.mockPurchase({
      planId: planId as PlanId,
      walletAddress,
      existingExpiresAt,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    if (!req.user.walletAddress && walletAddress) {
      await updateUser(req.user.id, { walletAddress });
    }

    res.json({
      success: true,
      license: {
        expiresAt: result.expiresAt?.toISOString(),
        txSignature: result.txSignature,
      },
    });
  } catch (error: any) {
    console.error('[API] Error processing mock purchase:', error);
    res.status(500).json({ error: 'Failed to process mock purchase' });
  }
});

export default router;
