/**
 * External Connection Manager - Manage connected external services
 * 
 * Displays connected platforms and allows adding/removing connections
 */

import React, { useState } from 'react';
import { useConnections, useConnectionAuth, usePlatforms } from '../../hooks/useExternalConnections';
import { ConnectionCard } from './ConnectionCard';
import { PlatformIcon, getPlatformDisplayName } from './PlatformIcon';
import { useToast } from '../ToastProvider';
import { PlatformType } from '../../services/api';

interface ExternalConnectionManagerProps {
  /** Filter to a specific platform (optional) */
  platform?: PlatformType;
  /** Callback when a connection is selected */
  onSelectConnection?: (connectionId: string) => void;
  /** Currently selected connection ID */
  selectedConnectionId?: string;
  /** Whether to show channel count */
  showChannelCount?: boolean;
}

export const ExternalConnectionManager: React.FC<ExternalConnectionManagerProps> = ({
  platform,
  onSelectConnection,
  selectedConnectionId,
  showChannelCount = true,
}) => {
  const { showToast } = useToast();
  const { platforms, isLoading: isLoadingPlatforms } = usePlatforms();
  const { connections, isLoading, error, refetch, removeConnection } = useConnections(platform);
  const { startAuthFlow, isLoading: isAuthLoading, authResult, clearAuthResult } = useConnectionAuth();
  
  const [removingConnectionId, setRemovingConnectionId] = useState<string | null>(null);
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);

  // Filter platforms to enabled ones
  const enabledPlatforms = platforms.filter(p => p.isEnabled);

  const handleAddConnection = async (selectedPlatform: PlatformType) => {
    try {
      setShowPlatformSelector(false);
      const result = await startAuthFlow(selectedPlatform);
      
      // For webhook-based platforms, show instructions
      if (result && result.authType === 'webhook') {
        // The authResult state will be set, and we'll show the modal
      }
    } catch (err) {
      showToast(`Failed to start ${getPlatformDisplayName(selectedPlatform)} connection`, 'error');
    }
  };

  const handleRemoveConnection = async (connectionId: string, connectionName: string, connectionPlatform: PlatformType) => {
    if (!window.confirm(`Remove "${connectionName}" from your connected ${getPlatformDisplayName(connectionPlatform)} accounts?\n\nThis will disable any configs using channels from this connection.`)) {
      return;
    }

    setRemovingConnectionId(connectionId);
    try {
      await removeConnection(connectionId);
      showToast(`Removed "${connectionName}" from connections`, 'success');
    } catch (err) {
      showToast(`Failed to remove connection: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setRemovingConnectionId(null);
    }
  };

  // Webhook instructions modal
  const renderWebhookInstructionsModal = () => {
    if (!authResult || authResult.authType !== 'webhook') return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 border border-stone-200">
          <div className="flex items-center gap-3 mb-4">
            <PlatformIcon platform={authResult.platform} size="lg" className="text-stone-600" />
            <h3 className="text-lg font-medium text-stone-800">
              Connect {getPlatformDisplayName(authResult.platform)}
            </h3>
          </div>
          
          {authResult.instructions && (
            <p className="text-stone-600 mb-4">{authResult.instructions}</p>
          )}

          <div className="bg-stone-50 rounded-lg p-3 mb-4">
            <p className="text-xs text-stone-500 mb-1">Connection Link:</p>
            <div className="flex items-center gap-2">
              <code className="text-sm text-emerald-600 flex-1 truncate">{authResult.url}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(authResult.url);
                  showToast('Link copied!', 'success');
                }}
                className="p-1.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => window.open(authResult.url, '_blank')}
              className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Open Link
            </button>
            <button
              onClick={() => {
                clearAuthResult();
                refetch();
              }}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-sm font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Platform selector modal
  const renderPlatformSelectorModal = () => {
    if (!showPlatformSelector) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 border border-stone-200">
          <h3 className="text-lg font-medium text-stone-800 mb-4">Choose a Platform</h3>
          
          <div className="space-y-2">
            {enabledPlatforms.map((p) => (
              <button
                key={p.platform}
                onClick={() => handleAddConnection(p.platform)}
                disabled={isAuthLoading}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors text-left"
              >
                <PlatformIcon platform={p.platform} size="lg" className="text-stone-600" />
                <div className="flex-1">
                  <div className="text-stone-800 font-medium">{p.displayName}</div>
                  <div className="text-xs text-stone-500">{p.description}</div>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowPlatformSelector(false)}
            className="mt-4 w-full px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  if (isLoading || isLoadingPlatforms) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
        <span className="ml-3 text-stone-500">Loading connections...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={refetch}
          className="mt-2 text-sm text-red-300 hover:text-red-200 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-stone-800">
          {platform ? `Connected ${getPlatformDisplayName(platform)} Servers` : 'Connected Platforms'}
        </h3>
        <button
          onClick={() => {
            if (platform) {
              handleAddConnection(platform);
            } else {
              setShowPlatformSelector(true);
            }
          }}
          disabled={isAuthLoading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {isAuthLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Connecting...
            </>
          ) : (
            <>
              {platform ? (
                <PlatformIcon platform={platform} size="md" />
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              )}
              Add {platform ? getPlatformDisplayName(platform) : 'Connection'}
            </>
          )}
        </button>
      </div>

      {/* Connection list */}
      {connections.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-lg border border-stone-200">
          {platform ? (
             <PlatformIcon platform={platform} size="xl" className="mx-auto text-stone-400" />
          ) : (
            <svg className="mx-auto h-12 w-12 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          )}
          <h3 className="mt-4 text-sm font-medium text-stone-800">
            No {platform ? getPlatformDisplayName(platform) : ''} connections
          </h3>
          <p className="mt-2 text-sm text-stone-500">
            Add a {platform ? getPlatformDisplayName(platform) : 'platform'} connection to use as a data source
          </p>
          <button
            onClick={() => {
              if (platform) {
                handleAddConnection(platform);
              } else {
                setShowPlatformSelector(true);
              }
            }}
            disabled={isAuthLoading}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Your First Connection
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              isSelected={selectedConnectionId === connection.id}
              isRemoving={removingConnectionId === connection.id}
              showChannelCount={showChannelCount}
              onSelect={onSelectConnection ? () => onSelectConnection(connection.id) : undefined}
              onRemove={() => handleRemoveConnection(connection.id, connection.externalName, connection.platform)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {renderPlatformSelectorModal()}
      {renderWebhookInstructionsModal()}
    </div>
  );
};

export default ExternalConnectionManager;
