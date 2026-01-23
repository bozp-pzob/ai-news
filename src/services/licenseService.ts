// src/services/licenseService.ts

/**
 * License Service - pop402 Integration
 *
 * Handles license verification and purchase for Pro subscriptions.
 * Uses pop402 facilitator for cryptographic license management.
 * 
 * Based on pop402-gallery reference implementation:
 * - License check: POST to facilitator /license endpoint
 * - Challenge: POST to facilitator /challenge endpoint
 * - Settlement: Handled via X-PAYMENT header through middleware
 */

/**
 * Pro subscription plans
 */
export const PRO_PLANS = {
  '1d': { id: '1d', name: '1 Day', days: 1, price: 10000, priceDisplay: 0.01 },
  '7d': { id: '7d', name: '7 Days', days: 7, price: 5_000_000, priceDisplay: 5 },
  '30d': { id: '30d', name: '30 Days', days: 30, price: 10_000_000, priceDisplay: 10 },
  '365d': { id: '365d', name: '1 Year', days: 365, price: 100_000_000, priceDisplay: 100 },
} as const;

export type PlanId = keyof typeof PRO_PLANS;

/**
 * Configuration
 */
const SKU = process.env.POP402_SKU || 'pro';
const FACILITATOR_URL = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
const NETWORK = process.env.POP402_NETWORK || 'solana';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Mock mode - for development/testing without a real pop402 facilitator
 * Set POP402_MOCK_MODE=true to enable (disabled by default)
 */
const MOCK_MODE = process.env.POP402_MOCK_MODE === 'true';

/**
 * In-memory mock license storage (for mock mode only)
 */
const mockLicenses = new Map<string, { expiresAt: Date }>();

/**
 * License status returned by verification
 */
export interface LicenseStatus {
  isActive: boolean;
  expiresAt?: Date;
  walletAddress?: string;
  sku?: string;
}

/**
 * Challenge response from pop402
 */
export interface Challenge {
  id: string;
  message: string;
  expiresAt: number;
  expiresIn: number;
}

/**
 * Purchase parameters (for mock mode only)
 */
export interface PurchaseParams {
  planId: PlanId;
  walletAddress: string;
  existingExpiresAt?: Date;
}

/**
 * Purchase result
 */
export interface PurchaseResult {
  success: boolean;
  expiresAt?: Date;
  txSignature?: string;
  error?: string;
}

/**
 * Cached license entry
 */
interface CacheEntry {
  status: LicenseStatus;
  cachedAt: Date;
}

/**
 * In-memory license cache (keyed by wallet address)
 */
const licenseCache = new Map<string, CacheEntry>();

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry: CacheEntry): boolean {
  const age = Date.now() - entry.cachedAt.getTime();
  return age < CACHE_TTL_MS;
}

/**
 * Get cached license status if valid
 */
function getCachedLicense(walletAddress: string): LicenseStatus | null {
  const entry = licenseCache.get(walletAddress.toLowerCase());
  if (entry && isCacheValid(entry)) {
    return entry.status;
  }
  return null;
}

/**
 * Set license status in cache
 */
function setCachedLicense(walletAddress: string, status: LicenseStatus): void {
  licenseCache.set(walletAddress.toLowerCase(), {
    status,
    cachedAt: new Date(),
  });
}

/**
 * Clear license cache for a wallet
 */
export function clearLicenseCache(walletAddress: string): void {
  licenseCache.delete(walletAddress.toLowerCase());
}

/**
 * Verify license status with pop402 facilitator
 * 
 * Uses the /license endpoint as per pop402-gallery reference:
 * POST /license with { sku, walletAddress }
 *
 * @param walletAddress - Solana wallet address (base58)
 * @param skipCache - Force fresh check, bypass cache
 * @returns License status
 */
export async function verifyLicense(
  walletAddress: string,
  skipCache = false
): Promise<LicenseStatus> {
  if (!walletAddress) {
    return { isActive: false };
  }

  // Check cache first (unless skipping)
  if (!skipCache) {
    const cached = getCachedLicense(walletAddress);
    if (cached !== null) {
      console.log(`[LicenseService] Cache hit for ${walletAddress.slice(0, 8)}...`);
      return cached;
    }
  }

  console.log(`[LicenseService] Verifying license for ${walletAddress.slice(0, 8)}... (mock: ${MOCK_MODE})`);

  // Mock mode - check in-memory storage
  if (MOCK_MODE) {
    const mockLicense = mockLicenses.get(walletAddress.toLowerCase());
    const isActive = mockLicense ? mockLicense.expiresAt > new Date() : false;
    const status: LicenseStatus = {
      isActive,
      walletAddress,
      sku: SKU,
      expiresAt: mockLicense?.expiresAt,
    };
    setCachedLicense(walletAddress, status);
    console.log(`[LicenseService] MOCK: License ${isActive ? 'ACTIVE' : 'INACTIVE'} for ${walletAddress.slice(0, 8)}...`);
    return status;
  }

  try {
    // Use the /license endpoint as per pop402-gallery reference
    const requestBody = {
      sku: SKU,
      walletAddress,
    };
    
    console.log(`[LicenseService] Checking license with facilitator:`, {
      url: `${FACILITATOR_URL}/license`,
      sku: SKU,
      walletAddress: walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4),
    });
    
    const response = await fetch(`${FACILITATOR_URL}/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log(`[LicenseService] Facilitator /license response: ${response.status}`);

    // 404 = no license found (expected for new users)
    if (response.status === 404) {
      const status: LicenseStatus = { isActive: false, walletAddress, sku: SKU };
      setCachedLicense(walletAddress, status);
      console.log(`[LicenseService] No license found for ${walletAddress.slice(0, 8)}...`);
      return status;
    }

    if (!response.ok) {
      console.error(`[LicenseService] Verify failed: ${response.status} ${response.statusText}`);
      const status: LicenseStatus = { isActive: false, walletAddress };
      // Don't cache errors to allow retry
      return status;
    }

    const result = await response.json();
    console.log(`[LicenseService] Facilitator response:`, JSON.stringify(result, null, 2));

    // Parse response based on pop402 format
    // Expected format: { license: { expirationDate: timestamp } }
    const license = result.license;
    const expirationDate = license?.expirationDate;
    const isActive = expirationDate ? expirationDate > Date.now() : false;

    const status: LicenseStatus = {
      isActive,
      walletAddress,
      sku: SKU,
      expiresAt: expirationDate ? new Date(expirationDate) : undefined,
    };

    // Cache the result
    setCachedLicense(walletAddress, status);

    console.log(
      `[LicenseService] License ${status.isActive ? 'ACTIVE' : 'INACTIVE'} for ${walletAddress.slice(0, 8)}...` +
      (status.expiresAt ? ` (expires: ${status.expiresAt.toISOString()})` : '')
    );

    return status;
  } catch (error) {
    console.error('[LicenseService] Error verifying license:', error);
    // On error, return inactive but don't cache (allow retry)
    return { isActive: false, walletAddress };
  }
}

/**
 * Get a challenge for authentication/purchase
 *
 * @param walletAddress - Solana wallet address (base58)
 * @param ttl - Time-to-live in seconds (default: 5 minutes)
 * @returns Challenge object
 */
export async function getChallenge(walletAddress: string, ttl = 300): Promise<Challenge> {
  console.log(`[LicenseService] Getting challenge for ${walletAddress.slice(0, 8)}... (mock: ${MOCK_MODE})`);

  // Mock mode - generate a simple challenge
  if (MOCK_MODE) {
    const id = `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const expiresAt = Date.now() + ttl * 1000;
    return {
      id,
      message: `Sign this message to verify your wallet ownership.\n\nWallet: ${walletAddress}\nTimestamp: ${Date.now()}\nNonce: ${id}`,
      expiresAt,
      expiresIn: ttl,
    };
  }

  // Call facilitator /challenge endpoint
  const requestBody = {
    walletAddress,
    ttl,
    network: NETWORK,
  };
  
  console.log(`[LicenseService] Requesting challenge from ${FACILITATOR_URL}/challenge:`, requestBody);
  
  const response = await fetch(`${FACILITATOR_URL}/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  console.log(`[LicenseService] Challenge response (${response.status}):`, responseText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Failed to get challenge: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  
  // Handle different response formats
  const challenge = data.challenge || data;
  
  const result = {
    id: challenge.id || challenge.challengeId || challenge.challenge_id,
    message: challenge.message || challenge.challengeMessage || challenge.challenge_message,
    expiresAt: challenge.expiresAt || (Date.now() + ttl * 1000),
    expiresIn: challenge.expiresIn || ttl,
  };
  
  console.log(`[LicenseService] Parsed challenge:`, {
    id: result.id,
    messagePreview: result.message?.slice(0, 50) + '...',
    expiresIn: result.expiresIn,
  });
  
  return result;
}

/**
 * Mock purchase for testing (only works in mock mode)
 * 
 * For real purchases, use the purchase route with X-PAYMENT header
 */
export async function mockPurchase(params: PurchaseParams): Promise<PurchaseResult> {
  const { planId, walletAddress, existingExpiresAt } = params;

  const plan = PRO_PLANS[planId];
  if (!plan) {
    return { success: false, error: `Invalid plan: ${planId}` };
  }

  if (!MOCK_MODE) {
    return { success: false, error: 'Mock purchase only available in mock mode. Use the purchase route with X-PAYMENT header for real purchases.' };
  }

  console.log(
    `[LicenseService] MOCK: Processing purchase: ${planId} for ${walletAddress.slice(0, 8)}...`
  );

  // Calculate expiration date
  const baseDate = existingExpiresAt && existingExpiresAt > new Date() ? existingExpiresAt : new Date();
  const expiresAt = new Date(baseDate.getTime() + plan.days * 24 * 60 * 60 * 1000);

  // Store the mock license
  mockLicenses.set(walletAddress.toLowerCase(), { expiresAt });
  clearLicenseCache(walletAddress);

  console.log(`[LicenseService] MOCK: Purchase successful! Expires: ${expiresAt.toISOString()}`);

  return {
    success: true,
    expiresAt,
    txSignature: `mock_tx_${Date.now()}`,
  };
}

/**
 * Get plan details
 */
export function getPlanDetails(planId: string) {
  return PRO_PLANS[planId as PlanId] || null;
}

/**
 * Get all available plans
 */
export function getAllPlans() {
  return Object.values(PRO_PLANS);
}

/**
 * Get configuration for frontend
 */
export function getLicenseConfig() {
  return {
    sku: SKU,
    network: NETWORK,
    facilitatorUrl: FACILITATOR_URL,
  };
}

export const licenseService = {
  verifyLicense,
  getChallenge,
  mockPurchase,
  getPlanDetails,
  getAllPlans,
  getLicenseConfig,
  clearLicenseCache,
  PRO_PLANS,
};

export default licenseService;
