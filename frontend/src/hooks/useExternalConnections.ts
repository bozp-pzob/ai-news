/**
 * External Connections Hooks - React hooks for external platform connections
 * 
 * Handles connection management for Discord, Telegram, Slack, etc.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  connectionsApi, 
  ExternalConnection, 
  ExternalChannel,
  PlatformInfo,
  PlatformType,
  AuthUrlResult,
} from '../services/api';

/**
 * Hook for fetching available platforms
 */
export function usePlatforms() {
  const { authToken, isAuthenticated } = useAuth();
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    if (!authToken || !isAuthenticated) {
      setPlatforms([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await connectionsApi.getPlatforms(authToken);
      setPlatforms(response.platforms);
    } catch (err) {
      console.error('[usePlatforms] Error fetching platforms:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch platforms');
      setPlatforms([]);
    } finally {
      setIsLoading(false);
    }
  }, [authToken, isAuthenticated]);

  useEffect(() => {
    fetchPlatforms();
  }, [fetchPlatforms]);

  return {
    platforms,
    isLoading,
    error,
    refetch: fetchPlatforms,
  };
}

/**
 * Add legacy field aliases to an ExternalConnection for backward compatibility
 */
function addConnectionLegacyFields(conn: ExternalConnection): ExternalConnection {
  return {
    ...conn,
    // Legacy Discord field aliases
    guildId: conn.externalId,
    guildName: conn.externalName,
    guildIcon: conn.externalIcon,
  };
}

/**
 * Add legacy field aliases to an ExternalChannel for backward compatibility
 */
function addChannelLegacyFields(channel: ExternalChannel): ExternalChannel {
  return {
    ...channel,
    // Legacy Discord field aliases
    guildConnectionId: channel.connectionId,
    channelId: channel.externalId,
    channelName: channel.externalName,
    channelType: channel.resourceType,
    categoryId: channel.parentId,
    categoryName: channel.parentName,
  };
}

/**
 * Hook for managing external connections (all platforms or filtered by platform)
 */
export function useConnections(platform?: PlatformType) {
  const { authToken, isAuthenticated } = useAuth();
  const [connections, setConnections] = useState<ExternalConnection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    if (!authToken || !isAuthenticated) {
      setConnections([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = platform
        ? await connectionsApi.getConnectionsByPlatform(authToken, platform)
        : await connectionsApi.getConnections(authToken);
      // Add legacy field aliases for backward compatibility
      setConnections(response.connections.map(addConnectionLegacyFields));
    } catch (err) {
      console.error('[useConnections] Error fetching connections:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch connections');
      setConnections([]);
    } finally {
      setIsLoading(false);
    }
  }, [authToken, isAuthenticated, platform]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const removeConnection = useCallback(async (connectionId: string) => {
    if (!authToken) return;

    try {
      await connectionsApi.removeConnection(authToken, connectionId);
      setConnections(prev => prev.filter(c => c.id !== connectionId));
    } catch (err) {
      console.error('[useConnections] Error removing connection:', err);
      throw err;
    }
  }, [authToken]);

  const verifyConnection = useCallback(async (connectionId: string): Promise<boolean> => {
    if (!authToken) return false;

    try {
      const result = await connectionsApi.verifyConnection(authToken, connectionId);
      return result.valid;
    } catch (err) {
      console.error('[useConnections] Error verifying connection:', err);
      return false;
    }
  }, [authToken]);

  return {
    connections,
    isLoading,
    error,
    refetch: fetchConnections,
    removeConnection,
    verifyConnection,
  };
}

/**
 * Hook for managing channels within a specific connection
 */
export function useConnectionChannels(connectionId: string | null) {
  const { authToken } = useAuth();
  const [channels, setChannels] = useState<ExternalChannel[]>([]);
  const [groupedChannels, setGroupedChannels] = useState<Record<string, ExternalChannel[]>>({});
  const [connectionName, setConnectionName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    if (!authToken || !connectionId) {
      setChannels([]);
      setGroupedChannels({});
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await connectionsApi.getChannels(authToken, connectionId);
      // Add legacy field aliases for backward compatibility
      const channelsWithLegacy = response.channels.map(addChannelLegacyFields);
      setChannels(channelsWithLegacy);
      // Also add legacy fields to grouped channels
      const groupedWithLegacy: Record<string, ExternalChannel[]> = {};
      for (const [key, value] of Object.entries(response.grouped)) {
        groupedWithLegacy[key] = value.map(addChannelLegacyFields);
      }
      setGroupedChannels(groupedWithLegacy);
      setConnectionName(response.connectionName);
    } catch (err) {
      console.error('[useConnectionChannels] Error fetching channels:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch channels');
      setChannels([]);
      setGroupedChannels({});
    } finally {
      setIsLoading(false);
    }
  }, [authToken, connectionId]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const syncChannels = useCallback(async () => {
    if (!authToken || !connectionId) return;

    setIsSyncing(true);
    setError(null);

    try {
      const response = await connectionsApi.syncChannels(authToken, connectionId);
      // Add legacy field aliases for backward compatibility
      const channelsWithLegacy = response.channels.map(addChannelLegacyFields);
      setChannels(channelsWithLegacy);
      // Rebuild grouped channels with legacy fields
      const grouped: Record<string, ExternalChannel[]> = {};
      for (const channel of channelsWithLegacy) {
        const category = channel.parentName || 'No Category';
        if (!grouped[category]) {
          grouped[category] = [];
        }
        grouped[category].push(channel);
      }
      setGroupedChannels(grouped);
    } catch (err) {
      console.error('[useConnectionChannels] Error syncing channels:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync channels');
    } finally {
      setIsSyncing(false);
    }
  }, [authToken, connectionId]);

  return {
    channels,
    groupedChannels,
    connectionName,
    isLoading,
    isSyncing,
    error,
    refetch: fetchChannels,
    syncChannels,
  };
}

/**
 * Connection result from popup flow
 */
export interface PopupConnectionResult {
  success: boolean;
  platform?: PlatformType;
  connectionId?: string;
  connectionName?: string;
  error?: string;
}

/**
 * Hook for starting platform connection flow (OAuth or webhook-based)
 */
export function useConnectionAuth() {
  const { authToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<AuthUrlResult | null>(null);

  const startAuthFlow = useCallback(async (platform: PlatformType, redirectUrl?: string) => {
    if (!authToken) {
      setError('Not authenticated');
      return null;
    }

    setIsLoading(true);
    setError(null);
    setAuthResult(null);

    try {
      const response = await connectionsApi.getAuthUrl(authToken, platform, redirectUrl);
      setAuthResult(response);
      
      // For OAuth-based platforms, redirect immediately
      if (response.authType === 'oauth') {
        window.location.href = response.url;
        return response;
      }
      
      // For webhook-based platforms (like Telegram), return the result
      // so the UI can display instructions
      return response;
    } catch (err) {
      console.error('[useConnectionAuth] Error starting auth flow:', err);
      setError(err instanceof Error ? err.message : `Failed to start ${platform} connection`);
      setIsLoading(false);
      return null;
    }
  }, [authToken]);

  /**
   * Start auth flow in a popup window
   * Returns a promise that resolves when the popup completes
   */
  const startPopupAuthFlow = useCallback(async (platform: PlatformType): Promise<PopupConnectionResult> => {
    if (!authToken) {
      return { success: false, error: 'Not authenticated' };
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get auth URL with popup mode
      const response = await connectionsApi.getAuthUrl(authToken, platform, undefined, true);
      
      // For webhook-based platforms, can't use popup - return the result for manual handling
      if (response.authType === 'webhook') {
        setAuthResult(response);
        setIsLoading(false);
        return { success: false, error: 'Webhook-based platforms require manual connection' };
      }

      // Open popup window
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        response.url,
        'connect_platform',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      );

      if (!popup) {
        setIsLoading(false);
        return { success: false, error: 'Popup was blocked. Please allow popups and try again.' };
      }

      // Wait for popup to complete
      return new Promise<PopupConnectionResult>((resolve) => {
        // Listen for message from popup
        const handleMessage = (event: MessageEvent) => {
          // Verify origin if needed
          if (event.data?.type === 'connection_result') {
            window.removeEventListener('message', handleMessage);
            clearInterval(pollInterval);
            setIsLoading(false);

            if (event.data.success) {
              resolve({
                success: true,
                platform: event.data.platform,
                connectionId: event.data.connectionId,
                connectionName: event.data.connectionName,
              });
            } else {
              setError(event.data.error);
              resolve({
                success: false,
                error: event.data.error,
              });
            }
          }
        };

        window.addEventListener('message', handleMessage);

        // Also poll for popup closure (in case message fails)
        const pollInterval = setInterval(() => {
          if (popup.closed) {
            window.removeEventListener('message', handleMessage);
            clearInterval(pollInterval);
            setIsLoading(false);
            // Don't resolve as error - user might have successfully connected
            // The caller should refetch connections
            resolve({ success: false, error: 'Popup closed' });
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          clearInterval(pollInterval);
          if (!popup.closed) {
            popup.close();
          }
          setIsLoading(false);
          resolve({ success: false, error: 'Connection timed out' });
        }, 5 * 60 * 1000);
      });
    } catch (err) {
      console.error('[useConnectionAuth] Error starting popup auth flow:', err);
      const errorMsg = err instanceof Error ? err.message : `Failed to start ${platform} connection`;
      setError(errorMsg);
      setIsLoading(false);
      return { success: false, error: errorMsg };
    }
  }, [authToken]);

  const clearAuthResult = useCallback(() => {
    setAuthResult(null);
    setError(null);
  }, []);

  return {
    startAuthFlow,
    startPopupAuthFlow,
    isLoading,
    error,
    authResult,
    clearAuthResult,
  };
}

// ============================================================================
// LEGACY EXPORTS - For backward compatibility with existing Discord hooks
// ============================================================================

/**
 * @deprecated Use useConnections('discord') instead
 */
export function useDiscordGuilds() {
  const { connections, isLoading, error, refetch, removeConnection } = useConnections('discord');
  
  // Map to legacy format
  const guilds = connections.map(c => ({
    ...c,
    guildId: c.externalId,
    guildName: c.externalName,
    guildIcon: c.externalIcon,
  }));

  return {
    guilds,
    isLoading,
    error,
    refetch,
    removeGuild: removeConnection,
  };
}

/**
 * @deprecated Use useConnectionChannels instead
 */
export function useDiscordChannels(connectionId: string | null) {
  const { channels, groupedChannels, connectionName, isLoading, isSyncing, error, refetch, syncChannels } = 
    useConnectionChannels(connectionId);

  // Map to legacy format
  const mappedChannels = channels.map(c => ({
    ...c,
    guildConnectionId: c.connectionId,
    channelId: c.externalId,
    channelName: c.externalName,
    channelType: c.resourceType,
    categoryId: c.parentId,
    categoryName: c.parentName,
  }));

  const mappedGrouped = Object.fromEntries(
    Object.entries(groupedChannels).map(([k, v]) => [
      k,
      v.map(c => ({
        ...c,
        guildConnectionId: c.connectionId,
        channelId: c.externalId,
        channelName: c.externalName,
        channelType: c.resourceType,
        categoryId: c.parentId,
        categoryName: c.parentName,
      })),
    ])
  );

  return {
    channels: mappedChannels,
    groupedChannels: mappedGrouped,
    guildName: connectionName,
    isLoading,
    isSyncing,
    error,
    refetch,
    syncChannels,
  };
}

/**
 * @deprecated Use useConnectionAuth instead
 */
export function useDiscordOAuth() {
  const { startAuthFlow, isLoading, error } = useConnectionAuth();

  return {
    startOAuthFlow: (redirectUrl?: string) => startAuthFlow('discord', redirectUrl),
    isLoading,
    error,
  };
}

export default {
  usePlatforms,
  useConnections,
  useConnectionChannels,
  useConnectionAuth,
  // Legacy
  useDiscordGuilds,
  useDiscordChannels,
  useDiscordOAuth,
};
