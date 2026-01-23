/**
 * pop402 Service - Client-side helpers for pop402 integration
 * 
 * Handles challenge-response authentication and payment meta encoding
 * for the pop402 payment protocol.
 */

const FACILITATOR_URL = 'https://facilitator.pop402.com';

/**
 * Challenge response from pop402 facilitator
 */
export interface Challenge {
  id: string;
  message: string;
  expiresAt: number;
  expiresIn: number;
}

/**
 * Get a challenge from pop402 facilitator for wallet authentication
 * 
 * @param walletAddress - Solana wallet address (base58)
 * @param ttl - Time-to-live in seconds (default: 1 hour)
 * @returns Challenge object with message to sign
 */
export async function getChallenge(walletAddress: string, ttl = 3600): Promise<Challenge> {
  const response = await fetch(`${FACILITATOR_URL}/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress,
      ttl,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get challenge: ${error}`);
  }

  const data = await response.json();
  return data.challenge;
}

/**
 * Encode payment metadata to base64url format for X-PAYMENT-META header
 * 
 * @param meta - Payment metadata object
 * @returns Base64url encoded string
 */
export function encodePaymentMeta(meta: object): string {
  const json = JSON.stringify(meta);
  const b64 = btoa(json);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode base64url payment metadata
 * 
 * @param encoded - Base64url encoded string
 * @returns Decoded payment metadata object
 */
export function decodePaymentMeta<T = object>(encoded: string): T {
  // Restore base64 padding and characters
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  const json = atob(b64);
  return JSON.parse(json);
}

/**
 * Sign a message with a Solana wallet
 * This is a helper that works with Privy's wallet interface
 * 
 * @param message - Message string to sign
 * @param signMessage - Sign function from wallet (e.g., from Privy)
 * @returns Base58 encoded signature
 */
export async function signChallengeMessage(
  message: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await signMessage(messageBytes);
  
  // Convert to base58 - using a simple implementation
  // In production, you might use a library like bs58
  return uint8ArrayToBase58(signatureBytes);
}

/**
 * Simple base58 encoding (Bitcoin alphabet)
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function uint8ArrayToBase58(bytes: Uint8Array): string {
  const digits = [0];
  
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Convert leading zeros
  let output = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output += BASE58_ALPHABET[0];
  }
  
  // Convert digits to string (reversed)
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  
  return output;
}

export const pop402 = {
  getChallenge,
  encodePaymentMeta,
  decodePaymentMeta,
  signChallengeMessage,
  FACILITATOR_URL,
};

export default pop402;
