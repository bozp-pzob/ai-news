// src/middleware/x402Middleware.ts

import { Request, Response, NextFunction } from 'express';
import { databaseService } from '../services/databaseService';

/**
 * x402/pop402 Payment Protocol Implementation
 * 
 * This middleware implements the HTTP 402 Payment Required flow:
 * 1. Client requests a monetized resource
 * 2. Server responds with 402 + payment details in headers
 * 3. Client pays via pop402 facilitator (USDC on Solana)
 * 4. Client retries request with X-Payment-Proof header
 * 5. Server verifies payment and grants access
 */

/**
 * Payment configuration
 */
interface PaymentConfig {
  /** Platform fee percentage (0-100) */
  platformFeePercent: number;
  /** Platform wallet address for fee collection */
  platformWallet: string;
  /** pop402 facilitator URL */
  facilitatorUrl: string;
  /** Payment token (default: USDC) */
  paymentToken: string;
  /** Network (default: solana) */
  network: string;
}

/**
 * Payment details returned in 402 response
 */
interface PaymentRequired {
  amount: string;           // Amount in smallest unit (lamports for USDC = 6 decimals)
  currency: string;         // e.g., "USDC"
  network: string;          // e.g., "solana"
  recipient: string;        // Config owner wallet
  platformWallet: string;   // Platform fee wallet
  platformFee: string;      // Platform fee amount
  facilitatorUrl: string;   // pop402 facilitator URL
  memo: string;             // Unique identifier for this payment
  expiresAt: string;        // ISO timestamp when offer expires
}

/**
 * Payment proof submitted by client
 */
interface PaymentProof {
  signature: string;        // Transaction signature
  memo: string;            // Memo used in payment
}

/**
 * Get payment configuration from environment
 */
function getPaymentConfig(): PaymentConfig {
  return {
    platformFeePercent: parseInt(process.env.PLATFORM_FEE_PERCENT || '10'),
    platformWallet: process.env.PLATFORM_WALLET_ADDRESS || '',
    facilitatorUrl: process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com',
    paymentToken: process.env.PAYMENT_TOKEN || 'USDC',
    network: process.env.PAYMENT_NETWORK || 'solana',
  };
}

/**
 * Calculate platform fee
 */
function calculateFees(pricePerQuery: number, platformFeePercent: number): {
  totalAmount: number;
  platformFee: number;
  ownerAmount: number;
} {
  const platformFee = Math.floor(pricePerQuery * platformFeePercent / 100);
  const ownerAmount = pricePerQuery - platformFee;
  
  return {
    totalAmount: pricePerQuery,
    platformFee,
    ownerAmount,
  };
}

/**
 * Generate unique memo for payment
 */
function generatePaymentMemo(configId: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `ctx:${configId}:${timestamp}:${random}`;
}

/**
 * Verify payment with pop402 facilitator
 */
async function verifyPaymentWithFacilitator(
  facilitatorUrl: string,
  signature: string,
  expectedMemo: string,
  expectedAmount: number,
  expectedRecipients: string[]
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature,
        expectedMemo,
        expectedAmount,
        expectedRecipients,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { valid: false, error: `Facilitator error: ${error}` };
    }

    const result = await response.json();
    return { valid: result.valid, error: result.error };
  } catch (error) {
    console.error('[x402] Error verifying payment:', error);
    return { 
      valid: false, 
      error: `Failed to verify payment: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Record payment in database
 */
async function recordPayment(
  configId: string,
  userId: string | null,
  walletAddress: string | null,
  amount: number,
  platformFee: number,
  ownerAmount: number,
  signature: string,
  memo: string
): Promise<void> {
  await databaseService.query(`
    INSERT INTO payments (
      config_id, user_id, payer_wallet, amount, platform_fee, owner_amount,
      tx_signature, memo, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed')
  `, [configId, userId, walletAddress, amount, platformFee, ownerAmount, signature, memo]);

  // Update config stats
  await databaseService.query(`
    UPDATE configs SET
      total_queries = total_queries + 1,
      total_revenue = total_revenue + $2
    WHERE id = $1
  `, [configId, amount]);
}

/**
 * Check if a payment proof has already been used
 */
async function isPaymentUsed(signature: string): Promise<boolean> {
  const result = await databaseService.query(
    'SELECT 1 FROM payments WHERE tx_signature = $1',
    [signature]
  );
  return result.rows.length > 0;
}

/**
 * Middleware to require payment for monetized configs
 * 
 * Usage:
 * router.get('/configs/:id/search', requirePayment, async (req, res) => { ... })
 */
export async function requirePayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Owner/admin bypass — owners never pay for their own config's data
    const accessType = (req as any).accessType;
    if (accessType === 'owner' || accessType === 'admin') {
      next();
      return;
    }

    const configId = req.params.id || req.params.configId;
    
    if (!configId) {
      res.status(400).json({ error: 'Config ID required' });
      return;
    }

    // Use config from requireConfigAccess if available, otherwise query DB
    let config = (req as any).config;
    if (!config) {
      const configResult = await databaseService.query(
        `SELECT id, monetization_enabled, price_per_query, owner_wallet, user_id
         FROM configs WHERE id = $1`,
        [configId]
      );

      if (configResult.rows.length === 0) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      config = configResult.rows[0];
    }

    // If monetization is not enabled, allow access
    if (!config.monetization_enabled) {
      next();
      return;
    }

    // Check if price is configured
    const pricePerQuery = config.price_per_query ? parseFloat(config.price_per_query) : 0;
    if (pricePerQuery <= 0) {
      next();
      return;
    }

    // Check for payment proof header
    const paymentProofHeader = req.headers['x-payment-proof'] as string;
    
    if (!paymentProofHeader) {
      // Return 402 Payment Required
      const paymentConfig = getPaymentConfig();
      const fees = calculateFees(pricePerQuery, paymentConfig.platformFeePercent);
      const memo = generatePaymentMemo(configId);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

      const paymentDetails: PaymentRequired = {
        amount: fees.totalAmount.toString(),
        currency: paymentConfig.paymentToken,
        network: paymentConfig.network,
        recipient: config.owner_wallet,
        platformWallet: paymentConfig.platformWallet,
        platformFee: fees.platformFee.toString(),
        facilitatorUrl: paymentConfig.facilitatorUrl,
        memo,
        expiresAt,
      };

      res.status(402);
      res.setHeader('X-Payment-Required', JSON.stringify(paymentDetails));
      res.setHeader('X-Payment-Amount', fees.totalAmount.toString());
      res.setHeader('X-Payment-Currency', paymentConfig.paymentToken);
      res.setHeader('X-Payment-Network', paymentConfig.network);
      res.setHeader('X-Payment-Recipient', config.owner_wallet);
      res.setHeader('X-Payment-Memo', memo);
      res.setHeader('X-Payment-Expires', expiresAt);
      
      res.json({
        error: 'Payment Required',
        code: 'PAYMENT_REQUIRED',
        payment: paymentDetails,
      });
      return;
    }

    // Parse payment proof
    let paymentProof: PaymentProof;
    try {
      paymentProof = JSON.parse(paymentProofHeader);
    } catch {
      res.status(400).json({ error: 'Invalid payment proof format' });
      return;
    }

    // Validate payment proof structure
    if (!paymentProof.signature || !paymentProof.memo) {
      res.status(400).json({ error: 'Payment proof must include signature and memo' });
      return;
    }

    // Check if payment has already been used
    if (await isPaymentUsed(paymentProof.signature)) {
      res.status(400).json({ error: 'Payment has already been used' });
      return;
    }

    // Verify payment with facilitator
    const paymentConfig = getPaymentConfig();
    const fees = calculateFees(pricePerQuery, paymentConfig.platformFeePercent);
    
    const verification = await verifyPaymentWithFacilitator(
      paymentConfig.facilitatorUrl,
      paymentProof.signature,
      paymentProof.memo,
      fees.totalAmount,
      [config.owner_wallet, paymentConfig.platformWallet]
    );

    if (!verification.valid) {
      res.status(402).json({ 
        error: 'Payment verification failed',
        details: verification.error,
      });
      return;
    }

    // Record the payment
    const user = (req as any).user;
    await recordPayment(
      configId,
      user?.id || null,
      user?.walletAddress || null,
      fees.totalAmount,
      fees.platformFee,
      fees.ownerAmount,
      paymentProof.signature,
      paymentProof.memo
    );

    // Payment verified, allow access
    next();
  } catch (error) {
    console.error('[x402] Error in payment middleware:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
}

/**
 * Optional payment middleware - allows access but tracks payments
 * Use this for endpoints that can work without payment but benefit from it
 */
export async function optionalPayment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const paymentProofHeader = req.headers['x-payment-proof'] as string;
  
  if (!paymentProofHeader) {
    // No payment provided, continue without
    (req as any).hasPaid = false;
    next();
    return;
  }

  // Process payment if provided
  try {
    // Similar logic to requirePayment but doesn't block on failure
    const configId = req.params.id || req.params.configId;
    
    if (configId) {
      let paymentProof: PaymentProof;
      try {
        paymentProof = JSON.parse(paymentProofHeader);
        
        if (paymentProof.signature && paymentProof.memo && !(await isPaymentUsed(paymentProof.signature))) {
          const configResult = await databaseService.query(
            `SELECT id, price_per_query, owner_wallet FROM configs WHERE id = $1`,
            [configId]
          );
          
          if (configResult.rows.length > 0) {
            const config = configResult.rows[0];
            const pricePerQuery = config.price_per_query ? parseFloat(config.price_per_query) : 0;
            
            if (pricePerQuery > 0) {
              const paymentConfig = getPaymentConfig();
              const fees = calculateFees(pricePerQuery, paymentConfig.platformFeePercent);
              
              const verification = await verifyPaymentWithFacilitator(
                paymentConfig.facilitatorUrl,
                paymentProof.signature,
                paymentProof.memo,
                fees.totalAmount,
                [config.owner_wallet, paymentConfig.platformWallet]
              );
              
              if (verification.valid) {
                const user = (req as any).user;
                await recordPayment(
                  configId,
                  user?.id || null,
                  user?.walletAddress || null,
                  fees.totalAmount,
                  fees.platformFee,
                  fees.ownerAmount,
                  paymentProof.signature,
                  paymentProof.memo
                );
                (req as any).hasPaid = true;
              }
            }
          }
        }
      } catch {
        // Ignore payment errors in optional mode
      }
    }
  } catch {
    // Ignore errors in optional mode
  }
  
  next();
}

/**
 * Helper to check if request has paid
 */
export function hasPaid(req: Request): boolean {
  return (req as any).hasPaid === true;
}

/**
 * Get payment statistics for a config
 */
export async function getPaymentStats(configId: string): Promise<{
  totalRevenue: number;
  totalQueries: number;
  uniquePayers: number;
  recentPayments: any[];
}> {
  const [statsResult, recentResult] = await Promise.all([
    databaseService.query(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_revenue,
        COUNT(*) as total_queries,
        COUNT(DISTINCT COALESCE(user_id::text, payer_wallet)) as unique_payers
      FROM payments
      WHERE config_id = $1 AND status = 'completed'
    `, [configId]),
    databaseService.query(`
      SELECT amount, payer_wallet, created_at
      FROM payments
      WHERE config_id = $1 AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 10
    `, [configId]),
  ]);

  const stats = statsResult.rows[0];
  
  return {
    totalRevenue: parseFloat(stats.total_revenue) || 0,
    totalQueries: parseInt(stats.total_queries) || 0,
    uniquePayers: parseInt(stats.unique_payers) || 0,
    recentPayments: recentResult.rows,
  };
}

export const x402Middleware = {
  requirePayment,
  optionalPayment,
  hasPaid,
  getPaymentStats,
};
