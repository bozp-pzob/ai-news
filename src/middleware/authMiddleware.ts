// src/middleware/authMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { PrivyClient } from '@privy-io/server-auth';
import { databaseService } from '../services/databaseService';

/**
 * User object attached to request after authentication
 */
export interface AuthUser {
  id: string;           // Internal UUID
  privyId: string;      // Privy DID
  email?: string;
  walletAddress?: string;
  tier: 'free' | 'paid' | 'admin';
}

/**
 * Extended request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  privyUser?: any;  // Raw Privy user object
}

/**
 * Initialize Privy client
 */
let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (!privyClient) {
    const appId = process.env.PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set');
    }

    privyClient = new PrivyClient(appId, appSecret);
  }
  return privyClient;
}

/**
 * Get or create user in database from Privy user
 */
async function getOrCreateUser(privyUser: any): Promise<AuthUser> {
  const privyId = privyUser.id;
  
  // Try to find existing user
  const existingResult = await databaseService.query(
    'SELECT * FROM users WHERE privy_id = $1',
    [privyId]
  );

  if (existingResult.rows.length > 0) {
    const user = existingResult.rows[0];
    return {
      id: user.id,
      privyId: user.privy_id,
      email: user.email || undefined,
      walletAddress: user.wallet_address || undefined,
      tier: user.tier
    };
  }

  // Extract email and wallet from Privy user
  let email: string | undefined;
  let walletAddress: string | undefined;

  if (privyUser.email?.address) {
    email = privyUser.email.address;
  }

  // Check linked accounts for wallet
  if (privyUser.wallet?.address) {
    walletAddress = privyUser.wallet.address;
  } else if (privyUser.linkedAccounts) {
    const walletAccount = privyUser.linkedAccounts.find(
      (account: any) => account.type === 'wallet'
    );
    if (walletAccount) {
      walletAddress = walletAccount.address;
    }
  }

  // Create new user
  const insertResult = await databaseService.query(
    `INSERT INTO users (privy_id, email, wallet_address, tier)
     VALUES ($1, $2, $3, 'free')
     RETURNING *`,
    [privyId, email || null, walletAddress || null]
  );

  const newUser = insertResult.rows[0];
  return {
    id: newUser.id,
    privyId: newUser.privy_id,
    email: newUser.email || undefined,
    walletAddress: newUser.wallet_address || undefined,
    tier: newUser.tier
  };
}

/**
 * Middleware to verify Privy authentication token
 * Attaches user to request if valid, otherwise returns 401
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    const client = getPrivyClient();
    
    // Verify the token with Privy
    const verifiedClaims = await client.verifyAuthToken(token);
    
    if (!verifiedClaims || !verifiedClaims.userId) {
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }

    // Get user details from Privy
    const privyUser = await client.getUser(verifiedClaims.userId);
    
    if (!privyUser) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Get or create user in our database
    const user = await getOrCreateUser(privyUser);

    req.user = user;
    req.privyUser = privyUser;
    
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware to optionally authenticate user
 * Attaches user to request if valid token provided, continues otherwise
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth header, continue without user
      next();
      return;
    }

    const token = authHeader.substring(7);

    const client = getPrivyClient();
    
    try {
      const verifiedClaims = await client.verifyAuthToken(token);
      
      if (verifiedClaims && verifiedClaims.userId) {
        const privyUser = await client.getUser(verifiedClaims.userId);
        
        if (privyUser) {
          const user = await getOrCreateUser(privyUser);
          req.user = user;
          req.privyUser = privyUser;
        }
      }
    } catch {
      // Token verification failed, continue without user
    }
    
    next();
  } catch (error) {
    // Any error, continue without user
    next();
  }
}

/**
 * Middleware to require specific tier level
 */
export function requireTier(...allowedTiers: Array<'free' | 'paid' | 'admin'>) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedTiers.includes(req.user.tier)) {
      res.status(403).json({ 
        error: 'Insufficient permissions',
        requiredTier: allowedTiers,
        currentTier: req.user.tier
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require paid or admin tier
 */
export const requirePaid = requireTier('paid', 'admin');

/**
 * Middleware to require admin tier
 */
export const requireAdmin = requireTier('admin');

/**
 * Check if user owns a specific config
 */
export async function requireConfigOwner(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const configId = req.params.id || req.params.configId;
  
  if (!configId) {
    res.status(400).json({ error: 'Config ID required' });
    return;
  }

  try {
    const result = await databaseService.query(
      'SELECT user_id FROM configs WHERE id = $1',
      [configId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    const config = result.rows[0];
    
    // Admin can access any config
    if (req.user.tier === 'admin') {
      next();
      return;
    }

    if (config.user_id !== req.user.id) {
      res.status(403).json({ error: 'You do not have permission to access this config' });
      return;
    }

    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error checking config ownership:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Check if user can access a config (owner, shared, or public)
 */
export async function requireConfigAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const configId = req.params.id || req.params.configId;
  
  if (!configId) {
    res.status(400).json({ error: 'Config ID required' });
    return;
  }

  try {
    const result = await databaseService.query(
      `SELECT c.*, 
              CASE 
                WHEN c.user_id = $2 THEN 'owner'
                WHEN c.visibility = 'public' THEN 'public'
                WHEN cs.id IS NOT NULL THEN 'shared'
                ELSE NULL
              END as access_type
       FROM configs c
       LEFT JOIN config_shares cs ON cs.config_id = c.id 
         AND (cs.shared_with_user_id = $2 OR cs.shared_with_wallet = $3)
       WHERE c.id = $1`,
      [configId, req.user?.id || null, req.user?.walletAddress || null]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    const config = result.rows[0];

    // Admin can access any config
    if (req.user?.tier === 'admin') {
      (req as any).config = config;
      (req as any).accessType = 'admin';
      next();
      return;
    }

    // Check visibility and access
    if (!config.access_type) {
      if (config.visibility === 'unlisted') {
        // Unlisted configs can be accessed by anyone with the ID
        (req as any).config = config;
        (req as any).accessType = 'unlisted';
        next();
        return;
      }
      
      res.status(403).json({ error: 'You do not have permission to access this config' });
      return;
    }

    (req as any).config = config;
    (req as any).accessType = config.access_type;
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Error checking config access:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update user information in database
 */
export async function updateUser(
  userId: string,
  updates: Partial<{
    email: string;
    walletAddress: string;
    tier: 'free' | 'paid' | 'admin';
    settings: object;
  }>
): Promise<AuthUser> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(updates.email);
  }
  if (updates.walletAddress !== undefined) {
    setClauses.push(`wallet_address = $${paramIndex++}`);
    values.push(updates.walletAddress);
  }
  if (updates.tier !== undefined) {
    setClauses.push(`tier = $${paramIndex++}`);
    values.push(updates.tier);
  }
  if (updates.settings !== undefined) {
    setClauses.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(updates.settings));
  }

  if (setClauses.length === 0) {
    throw new Error('No updates provided');
  }

  values.push(userId);
  
  const result = await databaseService.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  const user = result.rows[0];
  return {
    id: user.id,
    privyId: user.privy_id,
    email: user.email || undefined,
    walletAddress: user.wallet_address || undefined,
    tier: user.tier
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const result = await databaseService.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  return {
    id: user.id,
    privyId: user.privy_id,
    email: user.email || undefined,
    walletAddress: user.wallet_address || undefined,
    tier: user.tier
  };
}

/**
 * Get user by Privy ID
 */
export async function getUserByPrivyId(privyId: string): Promise<AuthUser | null> {
  const result = await databaseService.query(
    'SELECT * FROM users WHERE privy_id = $1',
    [privyId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const user = result.rows[0];
  return {
    id: user.id,
    privyId: user.privy_id,
    email: user.email || undefined,
    walletAddress: user.wallet_address || undefined,
    tier: user.tier
  };
}
