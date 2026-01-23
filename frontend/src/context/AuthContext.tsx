// frontend/src/context/AuthContext.tsx
// @ts-nocheck - Privy types will be available after npm install

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { usePrivy, useLogout, User as PrivyUser } from '@privy-io/react-auth';

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
  const { ready, authenticated, user: privyUser, getAccessToken, login: privyLogin } = usePrivy();
  const { logout: privyLogout } = useLogout();
  
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start true to show loading on initial load
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [hasSynced, setHasSynced] = useState(false); // Track if we've done initial sync

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
      console.log('[AuthContext] syncAuth called:', { 
        ready, 
        authenticated, 
        hasPrivyUser: !!privyUser,
        hasSynced,
        hasUser: !!user,
        hasToken: !!authToken
      });
      
      if (!ready) {
        console.log('[AuthContext] Privy not ready yet');
        return;
      }
      
      // Skip if already synced and have user data
      if (hasSynced && user && authToken) {
        console.log('[AuthContext] Already synced with user data, skipping');
        return;
      }
      
      if (authenticated && privyUser) {
        console.log('[AuthContext] User is authenticated, fetching token...');
        setIsLoading(true);
        setError(null);
        
        try {
          // Get access token from Privy
          const token = await getAccessToken();
          console.log('[AuthContext] Got token:', token ? `yes (${token.substring(0, 20)}...)` : 'no');
          
          if (token) {
            setAuthToken(token);
            
            // Fetch platform user from our backend
            console.log('[AuthContext] Fetching platform user from API...');
            const platformUser = await fetchPlatformUser(token);
            console.log('[AuthContext] Platform user response:', platformUser);
            
            if (platformUser) {
              setUser(platformUser);
              setHasSynced(true);
              
              // Check for post-login redirect
              const redirectPath = sessionStorage.getItem('postLoginRedirect');
              if (redirectPath) {
                sessionStorage.removeItem('postLoginRedirect');
                // Use window.location for redirect since we're outside Router
                window.location.href = redirectPath;
              }
            } else {
              console.warn('[AuthContext] No platform user returned');
              setError('Failed to load user profile');
            }
          } else {
            console.warn('[AuthContext] No token returned from Privy');
            setError('Failed to get authentication token');
          }
        } catch (err) {
          console.error('[AuthContext] Auth sync error:', err);
          setError(err instanceof Error ? err.message : 'Authentication failed');
        } finally {
          setIsLoading(false);
        }
      } else if (ready) {
        // Privy is ready but user is not authenticated - clear state
        console.log('[AuthContext] User not authenticated, clearing state');
        setUser(null);
        setAuthToken(null);
        setError(null);
        setIsLoading(false);
        setHasSynced(true);
      }
    };

    syncAuth();
  }, [ready, authenticated, privyUser?.id]); // Minimal deps to avoid loops

  /**
   * Login action
   */
  const login = useCallback(() => {
    // Only call login if not already authenticated
    if (!authenticated) {
      console.log('[AuthContext] Calling Privy login...');
      privyLogin();
    } else {
      console.log('[AuthContext] Already authenticated, triggering re-sync...');
      // Force a re-sync if already authenticated but no user data
      if (!user && !isLoading) {
        // Manually trigger sync by getting token and fetching user
        (async () => {
          setIsLoading(true);
          try {
            const token = await getAccessToken();
            if (token) {
              setAuthToken(token);
              const platformUser = await fetchPlatformUser(token);
              setUser(platformUser);
            }
          } catch (err) {
            console.error('[AuthContext] Re-sync error:', err);
          } finally {
            setIsLoading(false);
          }
        })();
      }
    }
  }, [authenticated, privyLogin, user, isLoading, getAccessToken, fetchPlatformUser]);

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
