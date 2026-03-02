/**
 * pop402 Payment Verification Helper
 * 
 * Verifies X-PAYMENT headers against the pop402 facilitator.
 * Used for dynamic-route payment verification (run, generate) where
 * the pop402 express middleware can't be applied statically.
 * 
 * This calls the same facilitator endpoint that @pop402/x402-express uses internally.
 */

const FACILITATOR_URL = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
const NETWORK = process.env.POP402_NETWORK || 'solana';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || '';
const MOCK_MODE = process.env.POP402_MOCK_MODE === 'true';

export interface Pop402VerificationResult {
  valid: boolean;
  error?: string;
}

/**
 * Decode and verify a pop402 X-PAYMENT header against the facilitator.
 * 
 * @param paymentHeader - The raw X-PAYMENT header value (base64-encoded JSON)
 * @param payTo - The wallet address to receive payment
 * @param price - The price in USD format (e.g. "$0.10")
 * @param resource - The resource being paid for (e.g. the request URL)
 * @returns Verification result from the facilitator
 */
export async function verifyPop402Payment(
  paymentHeader: string,
  payTo: string,
  price: string,
  resource: string,
): Promise<Pop402VerificationResult> {
  if (MOCK_MODE) {
    console.log('[pop402] Mock mode - skipping payment verification');
    return { valid: true };
  }

  if (!payTo) {
    return { valid: false, error: 'Platform wallet not configured' };
  }

  try {
    // Decode the base64 X-PAYMENT header
    let paymentData: any;
    try {
      const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
      paymentData = JSON.parse(decoded);
    } catch {
      return { valid: false, error: 'Invalid X-PAYMENT header format' };
    }

    // Verify with the facilitator (same endpoint @pop402/x402-express uses)
    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: paymentData.payload || paymentData,
        network: NETWORK,
        payTo,
        maxAmountRequired: price,
        resource,
        scheme: paymentData.scheme || 'exact',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[pop402] Facilitator verification failed:', response.status, errorText);
      return { valid: false, error: `Facilitator returned ${response.status}` };
    }

    const result = await response.json() as any;
    return { valid: !!result.isValid, error: result.error };
  } catch (error) {
    console.error('[pop402] Payment verification error:', error);
    return { valid: false, error: 'Payment verification failed' };
  }
}

/**
 * Build a pop402-compatible 402 Payment Required response body.
 * Used when a route needs to return 402 with payment details.
 */
export function buildPaymentRequiredResponse(opts: {
  price: string;
  description: string;
  resource: string;
  payTo?: string;
  network?: string;
  facilitatorUrl?: string;
}) {
  return {
    error: 'Payment Required',
    code: 'PAYMENT_REQUIRED',
    x402Version: 1,
    payment: {
      price: opts.price,
      currency: 'USDC',
      network: opts.network || NETWORK,
      payTo: opts.payTo || PLATFORM_WALLET,
      facilitatorUrl: opts.facilitatorUrl || FACILITATOR_URL,
      description: opts.description,
      resource: opts.resource,
    },
  };
}

export const pop402Helper = {
  verifyPop402Payment,
  buildPaymentRequiredResponse,
};
