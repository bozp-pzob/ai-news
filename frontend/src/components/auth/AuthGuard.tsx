// frontend/src/components/auth/AuthGuard.tsx

import React, { ReactNode } from 'react';
import { useAuth, UserTier } from '../../context/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
  /** If true, shows login prompt instead of hiding content */
  showLoginPrompt?: boolean;
  /** Required tier(s) to access the content */
  requiredTier?: UserTier | UserTier[];
  /** Fallback component to show when not authorized */
  fallback?: ReactNode;
  /** Loading component */
  loadingComponent?: ReactNode;
}

/**
 * Loading spinner component
 */
function DefaultLoading() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Default login prompt
 */
function DefaultLoginPrompt({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border border-stone-200">
      <svg 
        className="w-12 h-12 text-stone-400 mb-4" 
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
      <h3 className="text-lg font-medium text-stone-800 mb-2">
        Sign in required
      </h3>
      <p className="text-stone-500 text-sm text-center mb-4 max-w-sm">
        You need to sign in to access this content.
      </p>
      <button
        onClick={onLogin}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
      >
        Sign In
      </button>
    </div>
  );
}

/**
 * Upgrade prompt for insufficient tier
 */
function UpgradePrompt({ currentTier, requiredTier }: { currentTier: UserTier; requiredTier: UserTier[] }) {
  const tierLabels: Record<UserTier, string> = {
    free: 'Free',
    paid: 'Pro',
    admin: 'Admin',
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border border-stone-200">
      <svg 
        className="w-12 h-12 text-emerald-500 mb-4" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1.5} 
          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" 
        />
      </svg>
      <h3 className="text-lg font-medium text-stone-800 mb-2">
        Upgrade Required
      </h3>
      <p className="text-stone-500 text-sm text-center mb-4 max-w-sm">
        This feature requires a {requiredTier.map(t => tierLabels[t]).join(' or ')} plan.
        You're currently on the {tierLabels[currentTier]} plan.
      </p>
      <a
        href="/upgrade"
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
      >
        Upgrade Now
      </a>
    </div>
  );
}

/**
 * Error state when authenticated but API call failed
 */
function AuthErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border border-stone-200">
      <svg 
        className="w-12 h-12 text-red-500 mb-4" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1.5} 
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
        />
      </svg>
      <h3 className="text-lg font-medium text-stone-800 mb-2">
        Authentication Error
      </h3>
      <p className="text-stone-500 text-sm text-center mb-4 max-w-sm">
        {error || 'Failed to load your profile. Please try again.'}
      </p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * AuthGuard component that protects content based on authentication and tier
 */
export function AuthGuard({
  children,
  showLoginPrompt = true,
  requiredTier,
  fallback,
  loadingComponent,
}: AuthGuardProps) {
  const { isPrivyReady, isAuthenticated, isLoading, user, login, error, refreshUser } = useAuth();

  console.log('[AuthGuard] State:', { isPrivyReady, isAuthenticated, isLoading, hasUser: !!user, error });

  // Show loading while checking auth
  if (!isPrivyReady || isLoading) {
    return <>{loadingComponent || <DefaultLoading />}</>;
  }

  // User is authenticated with Privy but we failed to load their profile
  if (isAuthenticated && !user && error) {
    return <AuthErrorState error={error} onRetry={refreshUser} />;
  }

  // Not authenticated at all
  if (!isAuthenticated) {
    if (showLoginPrompt) {
      return <DefaultLoginPrompt onLogin={login} />;
    }
    return <>{fallback || null}</>;
  }

  // Authenticated but no user yet (still syncing)
  if (!user) {
    return <>{loadingComponent || <DefaultLoading />}</>;
  }

  // Check tier requirement
  if (requiredTier) {
    const tiers = Array.isArray(requiredTier) ? requiredTier : [requiredTier];
    
    // Admin always has access
    if (user.tier !== 'admin' && !tiers.includes(user.tier)) {
      return <UpgradePrompt currentTier={user.tier} requiredTier={tiers} />;
    }
  }

  // Authorized - render children
  return <>{children}</>;
}

/**
 * Hook to check if user meets tier requirement
 */
export function useTierCheck(requiredTier: UserTier | UserTier[]): boolean {
  const { user } = useAuth();
  
  if (!user) return false;
  if (user.tier === 'admin') return true;
  
  const tiers = Array.isArray(requiredTier) ? requiredTier : [requiredTier];
  return tiers.includes(user.tier);
}

export default AuthGuard;
