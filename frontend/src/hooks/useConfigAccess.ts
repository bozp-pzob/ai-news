/**
 * useConfigAccess — hook for purchasing 24-hour data access to monetized configs.
 *
 * Payment flow:
 * 1. Call `purchase()` → hits POST /access/purchase → gets 402 with payment details
 * 2. Build USDC transfer transaction via solanaPayment
 * 3. Sign with Privy wallet
 * 4. Send transaction to Solana
 * 5. Retry POST /access/purchase with X-Payment-Proof header
 * 6. Backend verifies → creates 24h access grant → returns success
 */

import { useState, useCallback, useRef } from 'react';
import {
  configApi,
  AccessPurchasePaymentDetails,
  AccessAlreadyGrantedError,
} from '../services/api';
import { createUSDCTransferTransaction } from '../services/solanaPayment';
import { Connection } from '@solana/web3.js';

export interface UseConfigAccessReturn {
  /** Initiate the full purchase flow */
  purchase: (
    configId: string,
    walletAddress: string,
    signTransaction: (tx: any, conn: Connection) => Promise<any>,
    authToken?: string | null
  ) => Promise<{ success: boolean; expiresAt?: string }>;

  /** Whether a purchase is currently in progress */
  isLoading: boolean;

  /** Current step of the purchase flow (for UI feedback) */
  step: PurchaseStep | null;

  /** Error message from the last failed attempt */
  error: string | null;

  /** Clear error state */
  clearError: () => void;
}

export type PurchaseStep =
  | 'requesting'    // Hitting purchase endpoint for payment details
  | 'building_tx'   // Building USDC transfer transaction
  | 'signing'       // Waiting for wallet signature
  | 'submitting'    // Submitting signed transaction to Solana
  | 'confirming'    // Confirming transaction on-chain
  | 'verifying';    // Sending proof to backend for verification

export function useConfigAccess(): UseConfigAccessReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<PurchaseStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prevent double-purchase race conditions
  const purchasingRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const purchase = useCallback(async (
    configId: string,
    walletAddress: string,
    signTransaction: (tx: any, conn: Connection) => Promise<any>,
    authToken?: string | null,
  ): Promise<{ success: boolean; expiresAt?: string }> => {
    if (purchasingRef.current) {
      return { success: false };
    }

    purchasingRef.current = true;
    setIsLoading(true);
    setError(null);
    setStep('requesting');

    try {
      // Step 1: Hit purchase endpoint to get payment details (402 response)
      let paymentDetails: AccessPurchasePaymentDetails;
      try {
        paymentDetails = await configApi.purchaseAccess(configId, authToken, walletAddress);
      } catch (err) {
        if (err instanceof AccessAlreadyGrantedError) {
          // Already has access — success
          return { success: true, expiresAt: err.access.expiresAt };
        }
        throw err;
      }

      // Step 2: Build USDC transfer transaction
      setStep('building_tx');
      const { transaction, connection } = await createUSDCTransferTransaction(
        walletAddress,
        paymentDetails.recipient,
        paymentDetails.amount
      );

      // Step 3: Sign the transaction with Privy wallet
      setStep('signing');
      const signedTx = await signTransaction(transaction, connection);

      // Step 4: Submit to Solana
      setStep('submitting');
      const rawTransaction = signedTx.serialize();
      const signature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log('[useConfigAccess] Transaction submitted:', signature);

      // Step 5: Wait for confirmation
      setStep('confirming');
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: transaction.recentBlockhash!,
          lastValidBlockHeight: transaction.lastValidBlockHeight!,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('[useConfigAccess] Transaction confirmed:', signature);

      // Step 6: Send proof to backend
      setStep('verifying');
      const result = await configApi.purchaseAccessWithProof(
        configId,
        signature,
        paymentDetails.memo,
        authToken,
        walletAddress
      );

      if (result.success) {
        return { success: true, expiresAt: result.access.expiresAt };
      } else {
        throw new Error('Backend rejected the payment proof');
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'Purchase failed';
      console.error('[useConfigAccess] Purchase error:', message);
      setError(message);
      return { success: false };
    } finally {
      setIsLoading(false);
      setStep(null);
      purchasingRef.current = false;
    }
  }, []);

  return {
    purchase,
    isLoading,
    step,
    error,
    clearError,
  };
}
