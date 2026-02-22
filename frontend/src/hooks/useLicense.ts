/**
 * License Hooks - React hooks for Pro subscription management
 * 
 * Uses pop402 payment protocol with two-step flow:
 * 1. First request with X-PAYMENT-META only -> get 402 with payment requirements
 * 2. Second request with X-PAYMENT (signed tx) and X-PAYMENT-META -> complete purchase
 */

import { useState, useEffect, useCallback } from 'react';
import { Transaction, VersionedTransaction, Connection } from '@solana/web3.js';
import { useAuth } from '../context/AuthContext';
import { API_BASE, licenseApi, LicenseStatus, Plan, userApi } from '../services/api';
import { solanaPayment } from '../services/solanaPayment';
import { encodeBase58 } from '../services/pop402';

type SolanaTransaction = Transaction | VersionedTransaction;

export function useLicense() {
  const { authToken, user, isAuthenticated } = useAuth();
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLicense = useCallback(async () => {
    if (!authToken || !isAuthenticated) {
      setLicense(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const status = await licenseApi.getStatus(authToken);
      setLicense(status);
    } catch (err) {
      console.error('[useLicense] Error fetching license:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch license status');
      setLicense(null);
    } finally {
      setIsLoading(false);
    }
  }, [authToken, isAuthenticated]);

  useEffect(() => {
    fetchLicense();
  }, [fetchLicense]);

  const isActive = license?.isActive ?? false;
  const tier = license?.tier ?? (user?.tier || 'free');
  const expiresAt = license?.expiresAt ? new Date(license.expiresAt) : null;
  
  let daysRemaining: number | null = null;
  let hoursRemaining: number | null = null;
  let timeRemainingText: string | null = null;
  
  if (expiresAt) {
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const totalHours = diffMs / (1000 * 60 * 60);
    
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    hoursRemaining = Math.max(0, Math.ceil(totalHours));
    
    // Generate human-readable time remaining text
    if (diffMs <= 0) {
      timeRemainingText = 'Expired';
    } else if (totalHours < 1) {
      const minutes = Math.ceil(diffMs / (1000 * 60));
      timeRemainingText = `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
    } else if (totalHours < 24) {
      const hours = Math.ceil(totalHours);
      timeRemainingText = `${hours} hour${hours === 1 ? '' : 's'} remaining`;
    } else {
      timeRemainingText = `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`;
    }
  }

  return {
    license,
    isActive,
    tier,
    expiresAt,
    daysRemaining,
    hoursRemaining,
    timeRemainingText,
    isLoading,
    error,
    refetch: fetchLicense,
  };
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sku, setSku] = useState<string>('');
  const [network, setNetwork] = useState<string>('');
  const [platformWallet, setPlatformWallet] = useState<string>('');
  const [mockMode, setMockMode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await licenseApi.getPlans();
      setPlans(response.plans);
      setSku(response.sku);
      setNetwork(response.network);
      setPlatformWallet(response.platformWallet);
      setMockMode(response.mockMode ?? false);
    } catch (err) {
      console.error('[usePlans] Error fetching plans:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch plans');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  return { plans, sku, network, platformWallet, mockMode, isLoading, error, refetch: fetchPlans };
}

interface SignedMessage {
  signature: Uint8Array;
}

interface PaymentRequirements {
  accepts: Array<{
    payTo: string;
    maxAmountRequired: string;
    asset: string;
    network: string;
  }>;
}

export function usePurchase() {
  const { authToken, refreshUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /**
   * Purchase flow following pop402-gallery pattern:
   * 1. Get challenge from backend
   * 2. Sign challenge message
   * 3. Make initial request with X-PAYMENT-META -> get 402 with payment requirements
   * 4. Build transaction using payment requirements from 402
   * 5. Sign transaction
   * 6. Make second request with X-PAYMENT and X-PAYMENT-META -> complete purchase
   */
  const purchase = useCallback(async (
    planId: string,
    _priceUSDC: number, // Not used - we use the price from 402 response
    planDays: number,
    walletAddress: string,
    _platformWallet: string, // Not used - we use payTo from 402 response
    sku: string,
    network: string,
    signMessage: (message: Uint8Array) => Promise<SignedMessage>,
    signTransaction: (transaction: Transaction, connection: Connection) => Promise<SolanaTransaction>
  ) => {
    if (!authToken) {
      setError('Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    // First, update the user's wallet to the Solana wallet being used for payment
    // This ensures license checks use the correct wallet (not an Ethereum wallet)
    try {
      console.log('[usePurchase] Updating user wallet to Solana address:', walletAddress.slice(0, 8) + '...');
      await userApi.updateMe(authToken, { walletAddress });
      console.log('[usePurchase] Wallet updated successfully');
    } catch (err) {
      console.warn('[usePurchase] Failed to update wallet (non-fatal):', err);
      // Continue anyway - the backend purchase handler will also try to update
    }

    try {
      // Step 1: Get challenge from backend
      console.log('[usePurchase] Step 1: Getting challenge...');
      const challengeResponse = await licenseApi.getChallenge(authToken, walletAddress, 300);
      const { challenge } = challengeResponse;
      
      if (!challenge?.id || !challenge?.message) {
        throw new Error('Invalid challenge response');
      }
      console.log('[usePurchase] Got challenge:', challenge.id.slice(0, 20) + '...');

      // Step 2: Sign the challenge message
      console.log('[usePurchase] Step 2: Signing challenge message...', {
        challengeMessage: challenge.message.slice(0, 100) + '...',
      });
      const encodedMessage = new TextEncoder().encode(challenge.message);
      const signedMessage = await signMessage(encodedMessage);
      
      console.log('[usePurchase] Raw signature:', {
        signedMessageType: typeof signedMessage,
        hasSignature: !!signedMessage?.signature,
        signatureType: typeof signedMessage?.signature,
        signatureLength: signedMessage?.signature?.length,
      });
      
      const signature = encodeBase58(signedMessage.signature);
      console.log('[usePurchase] Challenge signed, base58 signature:', signature.slice(0, 20) + '...');

      // Step 3: Build initial payment metadata (WITHOUT expirationDate for first request)
      // Following pop402-gallery pattern: expirationDate only added in second request
      const initialPaymentMeta = {
        sku,
        payerPubkey: walletAddress,
        signature,
        challengeId: challenge.id,
      };
      const initialXPaymentMetaHeader = btoa(JSON.stringify(initialPaymentMeta));

      // Step 4: Make first request to get 402 with payment requirements
      console.log('[usePurchase] Step 3: Requesting payment requirements...');
      const initialResponse = await fetch(`${API_BASE}/api/v1/me/license/purchase/${planId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-PAYMENT-META': initialXPaymentMetaHeader,
        },
        body: JSON.stringify({ walletAddress }),
      });

      // If it's not 402, something unexpected happened
      if (initialResponse.status !== 402) {
        if (initialResponse.ok) {
          // Already has access? This shouldn't happen for a new purchase
          const result = await initialResponse.json();
          console.log('[usePurchase] Unexpected success on first request:', result);
          setSuccess(true);
          if (refreshUser) await refreshUser();
          return { success: true, license: result.license };
        }
        const errorData = await initialResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Unexpected response: ${initialResponse.status}`);
      }

      // Parse 402 response to get payment requirements
      const paymentInfo: PaymentRequirements = await initialResponse.json();
      console.log('[usePurchase] Got 402 payment requirements:', paymentInfo);

      const acceptedPayment = paymentInfo.accepts?.[0];
      if (!acceptedPayment) {
        throw new Error('No payment options in 402 response');
      }

      const { payTo, maxAmountRequired, asset } = acceptedPayment;
      const amountUSDC = parseInt(maxAmountRequired) / 1_000_000; // Convert from smallest unit

      console.log('[usePurchase] Payment details:', {
        payTo: payTo.slice(0, 8) + '...',
        amount: amountUSDC,
        asset: asset.slice(0, 8) + '...',
      });

      // Step 5: Build USDC transfer transaction using the payment details
      console.log('[usePurchase] Step 4: Building transaction...');
      const { transaction, connection } = await solanaPayment.createUSDCTransferTransaction(
        walletAddress,
        payTo,
        amountUSDC
      );

      // Step 6: Sign the transaction
      console.log('[usePurchase] Step 5: Signing transaction...');
      const signedTx = await signTransaction(transaction, connection);
      
      // Serialize to base64
      const serializedBytes = signedTx.serialize();
      const signedTransaction = Buffer.from(serializedBytes).toString('base64');
      console.log('[usePurchase] Transaction signed, length:', signedTransaction.length);

      // Step 7: Build X-PAYMENT header
      const x402Payload = {
        x402Version: 1,
        scheme: 'exact',
        network,
        payload: {
          transaction: signedTransaction,
        },
      };
      const xPaymentHeader = btoa(JSON.stringify(x402Payload));

      // Step 8: Build final payment metadata WITH expirationDate (for second request only)
      const expirationDate = Date.now() + (planDays * 24 * 60 * 60 * 1000);
      const finalPaymentMeta = {
        sku,
        payerPubkey: walletAddress,
        signature,
        challengeId: challenge.id,
        expirationDate,
      };
      const finalXPaymentMetaHeader = btoa(JSON.stringify(finalPaymentMeta));

      // Step 9: Make second request with payment
      console.log('[usePurchase] Step 6: Submitting payment...');
      const finalResponse = await fetch(`${API_BASE}/api/v1/me/license/purchase/${planId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'X-PAYMENT': xPaymentHeader,
          'X-PAYMENT-META': finalXPaymentMetaHeader,
        },
        body: JSON.stringify({ walletAddress }),
      });

      if (!finalResponse.ok) {
        const errorData = await finalResponse.json().catch(() => ({}));
        console.error('[usePurchase] Payment failed:', errorData);
        throw new Error(errorData.error || 'Payment failed');
      }

      const result = await finalResponse.json();
      console.log('[usePurchase] Purchase successful!', result);

      setSuccess(true);
      if (refreshUser) await refreshUser();

      return { success: true, license: result.license };
    } catch (err) {
      console.error('[usePurchase] Error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Purchase failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [authToken, refreshUser]);

  /**
   * Mock purchase for testing - bypasses pop402 flow completely
   * Only works when backend has POP402_MOCK_MODE=true
   */
  const purchaseMock = useCallback(async (
    planId: string,
    walletAddress: string
  ) => {
    if (!authToken) {
      setError('Not authenticated');
      return { success: false, error: 'Not authenticated' };
    }

    setIsLoading(true);
    setError(null);
    setSuccess(false);

    // Update the user's wallet to the Solana wallet being used
    try {
      console.log('[usePurchase] Updating user wallet to Solana address:', walletAddress.slice(0, 8) + '...');
      await userApi.updateMe(authToken, { walletAddress });
    } catch (err) {
      console.warn('[usePurchase] Failed to update wallet (non-fatal):', err);
    }

    try {
      console.log('[usePurchase] Mock purchase:', { planId, walletAddress: walletAddress.slice(0, 8) + '...' });
      
      const result = await licenseApi.purchaseMock(authToken, planId, walletAddress);
      
      if (!result.success) {
        throw new Error(result.error || 'Mock purchase failed');
      }
      
      console.log('[usePurchase] Mock purchase successful!', result);
      setSuccess(true);
      if (refreshUser) await refreshUser();

      return { success: true, license: result.license };
    } catch (err) {
      console.error('[usePurchase] Mock purchase error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Purchase failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsLoading(false);
    }
  }, [authToken, refreshUser]);

  const reset = useCallback(() => {
    setError(null);
    setSuccess(false);
  }, []);

  return { purchase, purchaseMock, isLoading, error, success, reset };
}

export default { useLicense, usePlans, usePurchase };
