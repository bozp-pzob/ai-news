// frontend/src/context/AuthContext.tsx
// @ts-nocheck - Privy types will be available after npm install

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { usePrivy, useLogin, useLogout, User as PrivyUser } from '@privy-io/react-auth';

/**
 * User tier in our system
 */
export type UserTier = 'free' | 'paid' | 'admin';

/**
 * Platform user (from our backend)
 */
export interface PlatformUser {
  id: string;
  privyId: string;
  email?: string;
  walletAddress?: string;
  tier: UserTier;
  settings?: Record<string, any>;
  createdAt: string;
}

/**
 * Auth context state
 */
interface AuthContextState {
  // Privy state
  isPrivyReady: boolean;
  isAuthenticated: boolean;
  privyUser: PrivyUser | null;
  
  // Platform user state
  user: PlatformUser | null;
  isLoading: boolean;
  error: string | null;
  
  // Auth token for API calls
  authToken: string | null;
  
  // Actions
  login: () => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
  
  // Tier checks
  isFreeUser: boolean;
  isPaidUser: boolean;
  isAdmin: boolean;
  canCreateConfig: boolean;
}

const AuthContext = createContext<AuthContextState | undefined>(undefined);

/**
 * API base URL
 */
const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * AuthProvider component
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, user: privyUser, getAccessToken } = usePrivy();
  const { login: privyLogin } = useLogin();
  const { logout: privyLogout } = useLogout();
  
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  /**
   * Get auth headers for API calls
   */
  const getAuthHeaders = useCallback((): Record<string, string> => {
    if (!authToken) return {};
    return {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    };
  }, [authToken]);

  /**
   * Fetch platform user from our backend
   */
  const fetchPlatformUser = useCallback(async (token: string): Promise<PlatformUser | null> => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token invalid or expired
          return null;
        }
        throw new Error(`Failed to fetch user: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      console.error('[AuthContext] Error fetching platform user:', err);
      return null;
    }
  }, []);

  /**
   * Refresh user data from backend
   */
  const refreshUser = useCallback(async () => {
    if (!authToken) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const platformUser = await fetchPlatformUser(authToken);
      setUser(platformUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh user');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, fetchPlatformUser]);

  /**
   * Handle authentication state changes
   */
  useEffect(() => {
    const syncAuth = async () => {
      if (!ready) return;
      
      if (authenticated && privyUser) {
        setIsLoading(true);
        setError(null);
        
        try {
          // Get access token from Privy
          const token = await getAccessToken();
          
          if (token) {
            setAuthToken(token);
            
            // Fetch platform user from our backend
            const platformUser = await fetchPlatformUser(token);
            setUser(platformUser);
          }
        } catch (err) {
          console.error('[AuthContext] Auth sync error:', err);
          setError(err instanceof Error ? err.message : 'Authentication failed');
        } finally {
          setIsLoading(false);
        }
      } else {
        // Not authenticated - clear state
        setUser(null);
        setAuthToken(null);
        setError(null);
      }
    };

    syncAuth();
  }, [ready, authenticated, privyUser, getAccessToken, fetchPlatformUser]);

  /**
   * Login action
   */
  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  /**
   * Logout action
   */
  const logout = useCallback(async () => {
    try {
      await privyLogout();
      setUser(null);
      setAuthToken(null);
      setError(null);
    } catch (err) {
      console.error('[AuthContext] Logout error:', err);
    }
  }, [privyLogout]);

  // Compute tier checks
  const isFreeUser = user?.tier === 'free';
  const isPaidUser = user?.tier === 'paid' || user?.tier === 'admin';
  const isAdmin = user?.tier === 'admin';
  
  // Free users can only create 1 config (checked in backend, but we can hint here)
  const canCreateConfig = isPaidUser || isAdmin || isFreeUser;

  const value: AuthContextState = {
    isPrivyReady: ready,
    isAuthenticated: authenticated,
    privyUser: privyUser || null,
    user,
    isLoading,
    error,
    authToken,
    login,
    logout,
    refreshUser,
    getAuthHeaders,
    isFreeUser,
    isPaidUser,
    isAdmin,
    canCreateConfig
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to use auth context
 */
export function useAuth(): AuthContextState {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
}

/**
 * Hook that requires authentication
 * Returns auth context or null if not authenticated
 */
export function useRequireAuth(): (AuthContextState & { isAuthenticated: true; user: PlatformUser }) | null {
  const auth = useAuth();
  
  if (!auth.isAuthenticated || !auth.user) {
    return null;
  }
  
  return auth as AuthContextState & { isAuthenticated: true; user: PlatformUser };
}
