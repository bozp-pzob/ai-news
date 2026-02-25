// frontend/src/pages/UpgradePage.tsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useFundWallet, useSignTransaction, useSignMessage } from '@privy-io/react-auth/solana';
import { useAuth } from '../context/AuthContext';
import { useLicense, usePlans, usePurchase } from '../hooks/useLicense';
import { Plan } from '../services/api';
import { solanaPayment } from '../services/solanaPayment';

/**
 * Feature item component
 */
function FeatureItem({ text, included = true }: { text: string; included?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      {included ? (
        <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-5 h-5 text-stone-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span className={included ? 'text-stone-600' : 'text-stone-400'}>{text}</span>
    </li>
  );
}

/**
 * Plan card component
 */
function PlanCard({
  plan,
  isSelected,
  onSelect,
  isPopular = false,
}: {
  plan: Plan;
  isSelected: boolean;
  onSelect: () => void;
  isPopular?: boolean;
}) {
  // Calculate savings compared to daily rate
  const dailyPrice = 1; // $1/day base rate
  const expectedPrice = dailyPrice * plan.days;
  const savings = expectedPrice > plan.price 
    ? Math.round((1 - plan.price / expectedPrice) * 100) 
    : 0;

  return (
    <button
      onClick={onSelect}
      className={`relative p-6 rounded-xl border-2 transition-all text-left w-full ${
        isSelected 
          ? 'border-emerald-500 bg-emerald-50' 
          : 'border-stone-200 bg-white hover:border-stone-300'
      }`}
    >
      {isPopular && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full">
          BEST VALUE
        </span>
      )}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-stone-800">{plan.name}</h3>
        <div className="mt-2">
          <span className="text-3xl font-bold text-stone-800">${plan.price}</span>
          <span className="text-stone-500 ml-1">USDC</span>
        </div>
        <p className="text-stone-500 text-sm mt-1">
          ${plan.pricePerDay}/day
        </p>
        {savings > 0 && (
          <span className="inline-block mt-2 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs rounded">
            Save {savings}%
          </span>
        )}
      </div>
      {isSelected && (
        <div className="absolute top-3 right-3 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </button>
  );
}

/**
 * Success modal component
 */
function SuccessModal({ 
  expiresAt, 
  onClose 
}: { 
  expiresAt?: string; 
  onClose: () => void;
}) {
  const navigate = useNavigate();
  
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl border border-stone-200 p-8 max-w-md w-full text-center shadow-lg">
        <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-stone-800 mb-2">Welcome to Pro!</h2>
        <p className="text-stone-500 mb-4">
          Your subscription is now active
          {expiresAt && ` until ${new Date(expiresAt).toLocaleDateString()}`}.
        </p>
        <p className="text-stone-400 text-sm mb-6">
          You now have access to unlimited configs, external storage, and custom AI models.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 transition-colors"
          >
            Stay Here
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Upgrade Page - Pro subscription management
 */
export default function UpgradePage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, user, authToken, refreshUser } = useAuth();
  const { ready: privyReady, authenticated: privyAuthenticated } = usePrivy();
  const { wallets: solanaWallets, createWallet: createSolanaWallet } = useSolanaWallets();
  const { fundWallet } = useFundWallet();
  const { signTransaction: privySignTransaction } = useSignTransaction();
  const { signMessage: privySignMessage } = useSignMessage();
  
  const { license, isActive, daysRemaining, timeRemainingText, isLoading: licenseLoading, refetch: refetchLicense } = useLicense();
  const { plans, platformWallet, sku, network, mockMode, isLoading: plansLoading } = usePlans();
  const { purchase, purchaseMock, isLoading: purchaseLoading, error: purchaseError, success: purchaseSuccess, reset: resetPurchase } = usePurchase();
  
  const [selectedPlanId, setSelectedPlanId] = useState<string>('30d');
  const [showSuccess, setShowSuccess] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{ expiresAt?: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [showWalletInfo, setShowWalletInfo] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  // Get the connected Solana wallet (prefer embedded wallet)
  const connectedWallet = solanaWallets.find(w => w.walletClientType === 'privy') || solanaWallets[0];

  // Update user's wallet to Solana wallet when connected
  // This ensures license checks use the correct wallet
  useEffect(() => {
    const updateWalletIfNeeded = async () => {
      if (!connectedWallet?.address || !authToken || !user) return;
      
      // Only update if the current user wallet is different (e.g., Ethereum wallet)
      if (user.walletAddress !== connectedWallet.address) {
        console.log('[UpgradePage] Updating user wallet to Solana:', connectedWallet.address.slice(0, 8) + '...');
        try {
          const { userApi } = await import('../services/api');
          await userApi.updateMe(authToken, { walletAddress: connectedWallet.address });
          console.log('[UpgradePage] Wallet updated successfully');
          // Refresh user data (updates tier) and license status
          await refreshUser();
          refetchLicense();
        } catch (error) {
          console.error('[UpgradePage] Failed to update wallet:', error);
        }
      }
    };
    
    updateWalletIfNeeded();
  }, [connectedWallet?.address, authToken, user?.walletAddress, refreshUser, refetchLicense]);

  // Fetch USDC balance when wallet is connected
  useEffect(() => {
    const fetchBalance = async () => {
      if (!connectedWallet?.address) {
        setUsdcBalance(null);
        return;
      }
      
      setIsLoadingBalance(true);
      try {
        const balance = await solanaPayment.getUSDCBalance(connectedWallet.address);
        setUsdcBalance(balance);
      } catch (error) {
        console.error('[UpgradePage] Error fetching USDC balance:', error);
        setUsdcBalance(0);
      } finally {
        setIsLoadingBalance(false);
      }
    };

    fetchBalance();
    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [connectedWallet?.address]);

  // Handle funding wallet - try Privy's fundWallet first, fallback to manual info
  const handleFundWallet = async () => {
    if (!connectedWallet?.address) return;
    
    try {
      // Try Privy's built-in funding modal for Solana
      // Uses SolanaFundingConfig from @privy-io/react-auth/solana
      await fundWallet(connectedWallet.address, { 
        cluster: { name: 'mainnet-beta' },
        asset: 'USDC',
      });
    } catch (error) {
      console.warn('[UpgradePage] Privy fundWallet failed, showing manual info:', error);
      // Fallback to manual transfer info
      setShowWalletInfo(true);
      navigator.clipboard.writeText(connectedWallet.address);
    }
  };

  // Copy wallet address to clipboard
  const copyWalletAddress = () => {
    if (connectedWallet?.address) {
      navigator.clipboard.writeText(connectedWallet.address);
      // Could add a toast notification here
    }
  };

  // Fallback plans for when API hasn't loaded
  const fallbackPlans: Plan[] = [
    { id: '1d', name: '1 Day', price: 1, currency: 'USDC', days: 1, pricePerDay: '1.00' },
    { id: '7d', name: '7 Days', price: 5, currency: 'USDC', days: 7, pricePerDay: '0.71' },
    { id: '30d', name: '30 Days', price: 10, currency: 'USDC', days: 30, pricePerDay: '0.33' },
    { id: '365d', name: '1 Year', price: 100, currency: 'USDC', days: 365, pricePerDay: '0.27' },
  ];

  // Use API plans if available, otherwise fallback
  const availablePlans = plans.length > 0 ? plans : fallbackPlans;
  const selectedPlan = availablePlans.find(p => p.id === selectedPlanId);

  // Create Solana wallet if user doesn't have one
  const handleCreateWallet = async () => {
    setIsCreatingWallet(true);
    setLocalError(null);
    try {
      await createSolanaWallet();
    } catch (error) {
      console.error('[UpgradePage] Error creating wallet:', error);
      setLocalError('Failed to create wallet');
    } finally {
      setIsCreatingWallet(false);
    }
  };

  const handlePurchase = async () => {
    setLocalError(null);
    
    console.log('[UpgradePage] handlePurchase called', { 
      selectedPlan: selectedPlan?.id,
      hasWallet: !!connectedWallet,
      walletAddress: connectedWallet?.address,
      platformWallet,
    });
    
    if (!selectedPlan) {
      setLocalError('Please select a plan');
      console.log('[UpgradePage] No plan selected');
      return;
    }
    
    if (!connectedWallet) {
      setLocalError('Please connect or create a Solana wallet first');
      console.log('[UpgradePage] No Solana wallet connected');
      return;
    }

    if (!platformWallet) {
      setLocalError('Payment configuration not loaded. Please refresh the page.');
      console.log('[UpgradePage] No platform wallet configured');
      return;
    }

    console.log('[UpgradePage] Starting purchase:', { 
      plan: selectedPlan.id, 
      price: selectedPlan.price,
      wallet: connectedWallet.address,
      platformWallet,
      walletType: connectedWallet.walletClientType,
      mockMode,
    });

    try {
      let result;
      
      // Use mock purchase when in mock mode (bypasses pop402 flow)
      if (mockMode) {
        console.log('[UpgradePage] Using MOCK purchase flow');
        result = await purchaseMock(selectedPlan.id, connectedWallet.address);
      } else {
        // Full pop402 payment flow
        // Check if this is an embedded wallet (no popup needed)
        const isEmbeddedWallet = connectedWallet.walletClientType === 'privy';
        
        // Sign message function - for challenge signature (proves wallet ownership)
        const signMessageFn = async (message: Uint8Array) => {
          console.log('[UpgradePage] Signing challenge message with Privy...', {
            messageLength: message.length,
            messagePreview: new TextDecoder().decode(message).slice(0, 100),
            isEmbeddedWallet,
          });
          
          const signature = await privySignMessage({
            message,
            options: {
              address: connectedWallet.address,
              // Hide modal for embedded wallets - they don't need user confirmation
              uiOptions: isEmbeddedWallet ? { showWalletUIs: false } : undefined,
            },
          });
          
          console.log('[UpgradePage] Challenge message signed:', {
            signatureType: typeof signature,
            isUint8Array: signature instanceof Uint8Array,
            signatureLength: signature?.length,
            signaturePreview: signature ? Array.from(signature.slice(0, 10)) : null,
          });
          
          return { signature };
        };

        // Sign transaction function - uses Privy's useSignTransaction hook
        // This properly signs Solana transactions (not just messages)
        const signTransactionFn = async (transaction: any, connection: any) => {
          console.log('[UpgradePage] Signing Solana transaction with Privy...');
          
          const signedTx = await privySignTransaction({
            transaction,
            connection,
            address: connectedWallet.address,
          });
          
          console.log('[UpgradePage] Transaction signed successfully');
          return signedTx;
        };

        result = await purchase(
          selectedPlan.id,
          selectedPlan.price,
          selectedPlan.days,
          connectedWallet.address,
          platformWallet,
          sku || 'pro',        // SKU from plans API
          network || 'solana', // Network from plans API
          signMessageFn,
          signTransactionFn
        );
      }
      
      console.log('[UpgradePage] Purchase result:', result);
      
      if (result.success) {
        setPurchaseResult({ expiresAt: result.license?.expiresAt });
        setShowSuccess(true);
        refetchLicense();
      } else if (result.error) {
        setLocalError(result.error);
      }
    } catch (error) {
      console.error('[UpgradePage] Purchase error:', error);
      setLocalError(error instanceof Error ? error.message : 'Purchase failed');
    }
  };

  const handleCloseSuccess = () => {
    setShowSuccess(false);
    resetPurchase();
  };

  const isLoading = licenseLoading || plansLoading;

  // Show loading state
  if (!privyReady || isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-xl font-semibold text-stone-800">Upgrade to Pro</h1>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Mock Mode Banner */}
        {mockMode && (
          <div className="mb-8 p-4 bg-purple-50 border border-purple-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-stone-800">Test Mode Active</p>
                <p className="text-sm text-stone-500">
                  Purchases are simulated - no real payments will be processed
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Active Subscription Banner */}
        {isActive && (
          <div className="mb-8 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-stone-800">Pro Subscription Active</p>
                  <p className="text-sm text-stone-500">
                    {timeRemainingText || 'Active'}
                  </p>
                </div>
              </div>
              <span className="text-emerald-600 text-sm">
                Extend below to add more time
              </span>
            </div>
          </div>
        )}

        {/* Heading */}
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-stone-800 mb-3">
            {isActive ? 'Extend Your Subscription' : 'Unlock Pro Features'}
          </h2>
          <p className="text-stone-500 max-w-xl mx-auto">
            Get unlimited configs, external database support, and bring your own API keys for premium AI models.
            Pay with USDC on Solana - no credit card needed.
          </p>
        </div>

        {/* Plan Selection */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {availablePlans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isSelected={selectedPlanId === plan.id}
              onSelect={() => setSelectedPlanId(plan.id)}
              isPopular={plan.id === '365d'}
            />
          ))}
        </div>

        {/* Feature Comparison */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Free Tier */}
          <div className="bg-white rounded-xl border border-stone-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium rounded">
                FREE
              </span>
              <h3 className="text-lg font-semibold text-stone-800">Basic</h3>
            </div>
            <ul className="space-y-3">
              <FeatureItem text="1 config" />
              <FeatureItem text="3 runs per day" />
              <FeatureItem text="Platform storage only" />
              <FeatureItem text="GPT-4o-mini model only" />
              <FeatureItem text="External database" included={false} />
              <FeatureItem text="Custom API keys" included={false} />
              <FeatureItem text="Advanced AI models" included={false} />
            </ul>
          </div>

          {/* Pro Tier */}
          <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2 py-1 bg-emerald-600 text-white text-xs font-medium rounded">
                PRO
              </span>
              <h3 className="text-lg font-semibold text-stone-800">Professional</h3>
            </div>
            <ul className="space-y-3">
              <FeatureItem text="Unlimited configs" />
              <FeatureItem text="Unlimited runs with small models" />
              <FeatureItem text="Premium models with your API keys" />
              <FeatureItem text="Your own PostgreSQL database" />
              <FeatureItem text="External storage support" />
              <FeatureItem text="Bring your own OpenAI/OpenRouter keys" />
              <FeatureItem text="Access GPT-4, Claude, and more" />
            </ul>
          </div>
        </div>

        {/* Purchase Section */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
          {(purchaseError || localError) && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600">{purchaseError || localError}</p>
            </div>
          )}

          {!isAuthenticated ? (
            <div className="text-center py-4">
              <p className="text-stone-500 mb-4">Sign in to upgrade your account</p>
              <button
                onClick={login}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                Sign In to Continue
              </button>
            </div>
          ) : !connectedWallet ? (
            <div className="text-center py-4">
              <p className="text-stone-500 mb-4">You need a Solana wallet to purchase with USDC</p>
              <button
                onClick={handleCreateWallet}
                disabled={isCreatingWallet}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreatingWallet ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Creating Wallet...
                  </span>
                ) : (
                  'Create Solana Wallet'
                )}
              </button>
              <p className="text-stone-400 text-xs mt-2">
                Or connect an external Solana wallet like Phantom
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Wallet Info */}
              <div className="flex items-center justify-between p-3 bg-stone-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-stone-500 text-xs">Solana Wallet</p>
                    <button 
                      onClick={copyWalletAddress}
                      className="text-stone-800 text-sm font-mono hover:text-emerald-600 transition-colors flex items-center gap-1"
                      title="Click to copy"
                    >
                      {connectedWallet.address.slice(0, 8)}...{connectedWallet.address.slice(-6)}
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-stone-500 text-xs">USDC Balance</p>
                  <p className="text-stone-800 font-semibold">
                    {isLoadingBalance ? (
                      <span className="text-stone-400">Loading...</span>
                    ) : usdcBalance !== null ? (
                      `$${usdcBalance.toFixed(2)}`
                    ) : (
                      <span className="text-stone-400">--</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Insufficient Balance Warning */}
              {usdcBalance !== null && selectedPlan && usdcBalance < selectedPlan.price && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-amber-700 font-medium">Insufficient USDC Balance</p>
                      <p className="text-stone-500 text-sm mt-1">
                        You need ${selectedPlan.price} USDC but only have ${usdcBalance.toFixed(2)}. 
                        Fund your wallet to continue.
                      </p>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={handleFundWallet}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          {showWalletInfo ? 'Address Copied!' : 'Get Wallet Address'}
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Manual Transfer Info */}
                  {showWalletInfo && (
                    <div className="mt-4 p-3 bg-white rounded-lg border border-stone-200">
                      <p className="text-stone-600 text-sm mb-2">Send USDC (Solana) to this address:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-2 bg-stone-50 rounded text-emerald-600 text-xs font-mono break-all">
                          {connectedWallet.address}
                        </code>
                        <button
                          onClick={copyWalletAddress}
                          className="p-2 bg-stone-100 hover:bg-stone-200 rounded transition-colors"
                          title="Copy address"
                        >
                          <svg className="w-4 h-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-stone-400 text-xs mt-2">
                        Only send USDC on Solana network. Other tokens will be lost.
                      </p>
                      <div className="mt-3 pt-3 border-t border-stone-200">
                        <p className="text-stone-500 text-xs mb-2">Get USDC on Solana from:</p>
                        <div className="flex flex-wrap gap-2">
                          <a 
                            href="https://www.coinbase.com/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded transition-colors"
                          >
                            Coinbase
                          </a>
                          <a 
                            href="https://www.kraken.com/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded transition-colors"
                          >
                            Kraken
                          </a>
                          <a 
                            href="https://www.binance.com/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded transition-colors"
                          >
                            Binance
                          </a>
                          <a 
                            href="https://jup.ag/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded transition-colors"
                          >
                            Jupiter (Swap)
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Purchase Button */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-stone-500 text-sm">Selected Plan</p>
                  <p className="text-xl font-semibold text-stone-800">
                    {selectedPlan?.name} - ${selectedPlan?.price} USDC
                  </p>
                </div>
                <button
                  onClick={handlePurchase}
                  disabled={purchaseLoading || !selectedPlan || (usdcBalance !== null && selectedPlan && usdcBalance < selectedPlan.price)}
                  className={`px-8 py-3 rounded-lg font-medium transition-colors ${
                    purchaseLoading || !selectedPlan || (usdcBalance !== null && selectedPlan && usdcBalance < selectedPlan.price)
                      ? 'bg-stone-200 text-stone-400 cursor-not-allowed' 
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  {purchaseLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Processing...
                    </span>
                  ) : isActive ? (
                  'Extend Subscription'
                ) : (
                  'Subscribe Now'
                )}
              </button>
              </div>
            </div>
          )}
        </div>

        {/* FAQ Section */}
        <div className="mt-12 pt-12 border-t border-stone-200">
          <h3 className="text-xl font-semibold text-stone-800 mb-6 text-center">
            Frequently Asked Questions
          </h3>
          <div className="space-y-4">
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <h4 className="font-medium text-stone-800 mb-2">How do I pay?</h4>
              <p className="text-stone-500 text-sm">
                Payments are made with USDC on Solana. When you sign in, an embedded wallet is 
                automatically created for you. You can fund it or connect an external Solana wallet.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <h4 className="font-medium text-stone-800 mb-2">What happens when my subscription expires?</h4>
              <p className="text-stone-500 text-sm">
                Your configs are preserved, but new runs will use platform storage and the free tier 
                AI model. You can renew anytime to restore Pro features.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <h4 className="font-medium text-stone-800 mb-2">Can I extend my subscription early?</h4>
              <p className="text-stone-500 text-sm">
                Yes! When you purchase additional time, it's added to your existing expiration date. 
                For example, if you have 10 days left and buy 30 more days, you'll have 40 days total.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-4">
              <h4 className="font-medium text-stone-800 mb-2">Is there a refund policy?</h4>
              <p className="text-stone-500 text-sm">
                Due to the nature of blockchain payments, all sales are final. However, we're 
                confident you'll love Pro features!
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Success Modal */}
      {showSuccess && (
        <SuccessModal
          expiresAt={purchaseResult?.expiresAt}
          onClose={handleCloseSuccess}
        />
      )}
    </div>
  );
}
