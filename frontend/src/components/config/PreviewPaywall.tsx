/**
 * PreviewPaywall — shared component shown below preview data in monetized configs.
 *
 * Primary CTA: "Unlock for 24 hours" — triggers Solana USDC payment flow.
 * Secondary: collapsible "API Access" section with endpoint/header info.
 *
 * Handles auth states:
 *   - Not signed in → Privy login prompt
 *   - No Solana wallet → create/connect wallet prompt
 *   - Ready → pay button
 */

import React, { useState } from 'react';
import { useSolanaWallets } from '@privy-io/react-auth';
import { useSignTransaction } from '@privy-io/react-auth/solana';
import { useAuth } from '../../context/AuthContext';
import { useConfigAccess, PurchaseStep } from '../../hooks/useConfigAccess';

interface PreviewPaywallProps {
  /** Config UUID */
  configId: string;
  /** Type of content being previewed (for display) */
  contentType: 'items' | 'content';
  /** Number of items/content entries shown in preview */
  previewLimit: number;
  /** Total available items/content entries */
  total: number;
  /** Payment info from backend preview response */
  payment: {
    pricePerQuery: number;
    currency: string;
    network?: string;
    message?: string;
  };
  /** Called after successful purchase so parent can reload data */
  onAccessGranted?: () => void;
}

const STEP_LABELS: Record<PurchaseStep, string> = {
  requesting: 'Getting payment details...',
  building_tx: 'Building transaction...',
  signing: 'Waiting for wallet signature...',
  submitting: 'Submitting to Solana...',
  confirming: 'Confirming transaction...',
  verifying: 'Verifying payment...',
};

export function PreviewPaywall({
  configId,
  contentType,
  previewLimit,
  total,
  payment,
  onAccessGranted,
}: PreviewPaywallProps) {
  const { login, isAuthenticated, authToken } = useAuth();
  const { wallets: solanaWallets, createWallet: createSolanaWallet } = useSolanaWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();
  const { purchase, isLoading, step, error, clearError } = useConfigAccess();

  const [showApiDetails, setShowApiDetails] = useState(false);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // Prefer embedded Privy wallet, fall back to first Solana wallet
  const connectedWallet =
    solanaWallets.find((w) => w.walletClientType === 'privy') || solanaWallets[0];

  const handleCreateWallet = async () => {
    setIsCreatingWallet(true);
    setWalletError(null);
    try {
      await createSolanaWallet();
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setIsCreatingWallet(false);
    }
  };

  const handlePurchase = async () => {
    clearError();
    if (!connectedWallet?.address) return;

    const signTxFn = async (transaction: any, connection: any) => {
      return privySignTransaction({
        transaction,
        connection,
        address: connectedWallet.address,
      });
    };

    const result = await purchase(
      configId,
      connectedWallet.address,
      signTxFn,
      authToken
    );

    if (result.success) {
      onAccessGranted?.();
    }
  };

  // Decide which CTA to render
  const renderCTA = () => {
    // In-progress purchase
    if (isLoading && step) {
      return (
        <button
          disabled
          className="w-full px-6 py-3 bg-emerald-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 cursor-wait"
        >
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {STEP_LABELS[step]}
        </button>
      );
    }

    // Not signed in
    if (!isAuthenticated) {
      return (
        <button
          onClick={login}
          className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
        >
          Sign in to unlock
        </button>
      );
    }

    // No Solana wallet
    if (!connectedWallet) {
      return (
        <button
          onClick={handleCreateWallet}
          disabled={isCreatingWallet}
          className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white rounded-lg font-medium transition-colors"
        >
          {isCreatingWallet ? 'Creating wallet...' : 'Create Solana Wallet to Unlock'}
        </button>
      );
    }

    // Ready to pay
    return (
      <button
        onClick={handlePurchase}
          className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
      >
        Unlock for 24 hours — ${payment.pricePerQuery.toFixed(4)} {payment.currency}
      </button>
    );
  };

  return (
    <div className="relative mt-4">
      {/* Gradient fade overlay above the paywall box */}
      <div className="absolute -top-16 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none z-10" />

      <div className="bg-white/80 border border-emerald-200 rounded-lg p-6 backdrop-blur-sm space-y-4">
        {/* Lock icon + headline */}
        <div className="text-center">
          <svg
            className="w-10 h-10 mx-auto text-emerald-500 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-stone-800 font-medium mb-1">
            Showing {previewLimit} of {total.toLocaleString()} {contentType}
          </p>
          <p className="text-stone-400 text-sm">
            Purchase 24-hour full access for{' '}
            <span className="text-emerald-600 font-medium">
              ${payment.pricePerQuery.toFixed(4)} {payment.currency}
            </span>
          </p>
        </div>

        {/* Primary CTA */}
        <div>{renderCTA()}</div>

        {/* Error display */}
        {(error || walletError) && (
          <p className="text-red-400 text-sm text-center">
            {error || walletError}
          </p>
        )}

        {/* API Access details (collapsible) */}
        <div className="border-t border-stone-200 pt-3">
          <button
            onClick={() => setShowApiDetails(!showApiDetails)}
            className="flex items-center gap-1 text-stone-500 hover:text-stone-300 text-xs transition-colors mx-auto"
          >
            <span>API Access</span>
            <svg
              className={`w-3 h-3 transition-transform ${showApiDetails ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {showApiDetails && (
            <div className="mt-3 text-stone-500 text-xs space-y-2 bg-stone-50 rounded p-3">
              <p>
                Access data programmatically with an{' '}
                <code className="text-stone-600 bg-stone-100 px-1 rounded">
                  X-Payment-Proof
                </code>{' '}
                header.
              </p>
              <p className="font-medium text-stone-600">Endpoints:</p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>
                  <code className="text-stone-600 bg-stone-100 px-1 rounded">
                    POST /api/v1/configs/{configId}/access/purchase
                  </code>
                </li>
                <li>
                  <code className="text-stone-600 bg-stone-100 px-1 rounded">
                    GET /api/v1/configs/{configId}/items
                  </code>
                </li>
                <li>
                  <code className="text-stone-600 bg-stone-100 px-1 rounded">
                    GET /api/v1/configs/{configId}/content
                  </code>
                </li>
              </ul>
              <p className="text-stone-400 mt-2">
                First call POST without proof → get 402 with payment details → pay on Solana → retry
                with{' '}
                <code className="text-stone-600 bg-stone-100 px-1 rounded">
                  {'X-Payment-Proof: {"signature":"...","memo":"..."}'}
                </code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
