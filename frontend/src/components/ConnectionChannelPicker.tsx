/**
 * ConnectionChannelPicker - A component for selecting external connections and channels
 * 
 * Used in PluginParamDialog for plugins that require a platform connection (Discord, Telegram, etc.)
 * Automatically fetches available connections and channels based on the platform type.
 * If no connections exist, shows a dialog to connect the platform.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useConnections, useConnectionChannels } from '../hooks/useExternalConnections';
import { PlatformType, ExternalConnection, ExternalChannel } from '../services/api';
import { ConnectPlatformDialog } from './ConnectPlatformDialog';
import { PlatformIcon, getPlatformDisplayName } from './connections/PlatformIcon';

interface ConnectionChannelPickerProps {
  /** Platform type to filter connections (e.g., 'discord', 'telegram') */
  platform: PlatformType;
  /** Currently selected connection ID */
  selectedConnectionId?: string;
  /** Currently selected channel IDs */
  selectedChannelIds?: string[];
  /** Callback when connection changes */
  onConnectionChange: (connectionId: string | undefined, connection?: ExternalConnection) => void;
  /** Callback when selected channels change */
  onChannelsChange: (channelIds: string[]) => void;
  /** Whether channel selection is required */
  channelsRequired?: boolean;
  /** Label for the connection field */
  connectionLabel?: string;
  /** Label for the channels field */
  channelsLabel?: string;
  /** Optional filter for channel types (e.g., [5] for Discord announcement channels only) */
  channelTypeFilter?: number[];
  /** Message to show when no channels match the filter */
  noChannelsMessage?: string;
}

/**
 * Platform display names
 */
const platformNames: Record<PlatformType, string> = {
  discord: 'Discord Server',
  telegram: 'Telegram Group',
  slack: 'Slack Workspace',
  github: 'GitHub Account',
};

/**
 * ConnectionChannelPicker component
 */
export const ConnectionChannelPicker: React.FC<ConnectionChannelPickerProps> = ({
  platform,
  selectedConnectionId,
  selectedChannelIds = [],
  onConnectionChange,
  onChannelsChange,
  channelsRequired = false,
  connectionLabel,
  channelsLabel,
  channelTypeFilter,
  noChannelsMessage,
}) => {
  // Fetch user's connections for this platform
  const { connections, isLoading: connectionsLoading, refetch: refetchConnections } = useConnections(platform);
  
  // Track the selected connection internally to fetch channels
  const [internalConnectionId, setInternalConnectionId] = useState<string | undefined>(selectedConnectionId);
  
  // Track connect dialog state
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  
  // Fetch channels for the selected connection
  const { 
    channels, 
    groupedChannels, 
    connectionName,
    isLoading: channelsLoading, 
    isSyncing,
    syncChannels 
  } = useConnectionChannels(internalConnectionId || null);

  // Update internal state when prop changes
  useEffect(() => {
    setInternalConnectionId(selectedConnectionId);
  }, [selectedConnectionId]);

  // Filter connections to only active ones
  const activeConnections = useMemo(() => {
    return connections.filter(c => c.isActive);
  }, [connections]);

  // Handle successful connection
  const handleConnectionSuccess = (result: any) => {
    // Refetch connections after successful connection
    refetchConnections();
    setShowConnectDialog(false);
    
    // If a connection was made, select it
    if (result.connectionId) {
      setInternalConnectionId(result.connectionId);
      // Find the connection to pass to onConnectionChange
      setTimeout(() => {
        const newConnection = connections.find(c => c.id === result.connectionId);
        onConnectionChange(result.connectionId, newConnection);
      }, 500);
    }
  };

  // Filter channels by type if filter is specified
  const filteredChannels = useMemo(() => {
    if (!channelTypeFilter || channelTypeFilter.length === 0) {
      return channels;
    }
    return channels.filter(c => channelTypeFilter.includes(Number(c.resourceType)));
  }, [channels, channelTypeFilter]);

  // Rebuild grouped channels from filtered channels
  const filteredGroupedChannels = useMemo(() => {
    if (!channelTypeFilter || channelTypeFilter.length === 0) {
      return groupedChannels;
    }
    // Rebuild grouped channels from filtered list
    const grouped: Record<string, ExternalChannel[]> = {};
    for (const channel of filteredChannels) {
      const category = channel.parentName || 'No Category';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(channel);
    }
    return grouped;
  }, [filteredChannels, groupedChannels, channelTypeFilter]);

  // Handle connection selection
  const handleConnectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const connectionId = e.target.value || undefined;
    setInternalConnectionId(connectionId);
    
    // Find the connection object
    const connection = connectionId 
      ? activeConnections.find(c => c.id === connectionId) 
      : undefined;
    
    // Clear channels when connection changes
    onChannelsChange([]);
    onConnectionChange(connectionId, connection);
  };

  // Handle channel toggle
  const handleChannelToggle = (channelId: string) => {
    const newChannelIds = selectedChannelIds.includes(channelId)
      ? selectedChannelIds.filter(id => id !== channelId)
      : [...selectedChannelIds, channelId];
    onChannelsChange(newChannelIds);
  };

  // Handle select all in a category
  const handleSelectAllInCategory = (categoryChannels: ExternalChannel[]) => {
    const categoryIds = categoryChannels.map(c => c.externalId);
    const allSelected = categoryIds.every(id => selectedChannelIds.includes(id));
    
    if (allSelected) {
      // Deselect all in this category
      onChannelsChange(selectedChannelIds.filter(id => !categoryIds.includes(id)));
    } else {
      // Select all in this category
      const newIds = new Set([...selectedChannelIds, ...categoryIds]);
      onChannelsChange(Array.from(newIds));
    }
  };

  // Get display label for connection field
  const connLabel = connectionLabel || platformNames[platform] || 'Connection';
  const chanLabel = channelsLabel || 'Channels';

  // No connections available - show connect button
  if (!connectionsLoading && activeConnections.length === 0) {
    return (
      <>
        <div className="p-4 bg-stone-700 rounded-lg border border-amber-500/30">
          <div className="flex items-center gap-2 mb-2">
            <PlatformIcon platform={platform} size="md" className="text-amber-400" />
            <span className="font-medium text-white">No {platformNames[platform]} Connected</span>
          </div>
          <p className="text-stone-400 text-sm mb-3">
            You need to connect a {platformNames[platform].toLowerCase()} before you can use this source.
          </p>
          <button
            onClick={() => setShowConnectDialog(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Connect {getPlatformDisplayName(platform)}
          </button>
        </div>
        
        <ConnectPlatformDialog
          isOpen={showConnectDialog}
          onClose={() => setShowConnectDialog(false)}
          platform={platform}
          onConnected={handleConnectionSuccess}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Connection Picker */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-300">
              {connLabel}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowConnectDialog(true)}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Connect Another
            </button>
          </div>
          <select
            value={internalConnectionId || ''}
            onChange={handleConnectionChange}
            disabled={connectionsLoading}
            className="py-2 px-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
          >
            <option value="">
              {connectionsLoading ? 'Loading...' : `Select a ${platformNames[platform].toLowerCase()}`}
            </option>
            {activeConnections.map(conn => (
              <option key={conn.id} value={conn.id}>
                {conn.externalName} {conn.channelCount > 0 && `(${conn.channelCount} channels)`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            Select which {platformNames[platform].toLowerCase()} to pull data from
          </p>
        </div>

      {/* Channel Picker - only show if connection is selected */}
      {internalConnectionId && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-300">
              {chanLabel}
              {channelsRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            <div className="flex items-center gap-2">
              {selectedChannelIds.length > 0 && (
                <span className="text-xs text-amber-400">
                  {selectedChannelIds.length} selected
                </span>
              )}
              <button
                type="button"
                onClick={() => syncChannels()}
                disabled={isSyncing}
                className="text-xs text-gray-400 hover:text-amber-400 flex items-center gap-1"
              >
                <svg 
                  className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isSyncing ? 'Syncing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {channelsLoading ? (
            <div className="p-4 bg-stone-700 rounded-md border border-stone-600 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-400 mx-auto mb-2"></div>
              <span className="text-sm text-gray-400">Loading channels...</span>
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="p-4 bg-stone-700 rounded-md border border-stone-600 text-center">
              <span className="text-sm text-gray-400">
                {noChannelsMessage || 'No channels available. Try refreshing.'}
              </span>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-stone-700 rounded-md border border-stone-600">
              {Object.entries(filteredGroupedChannels).map(([category, categoryChannels]) => {
                const categoryIds = categoryChannels.map(c => c.externalId);
                const selectedInCategory = categoryIds.filter(id => selectedChannelIds.includes(id)).length;
                const allSelected = selectedInCategory === categoryChannels.length;
                
                return (
                  <div key={category} className="border-b border-stone-600 last:border-b-0">
                    {/* Category header */}
                    <div 
                      className="flex items-center justify-between px-3 py-2 bg-stone-800 cursor-pointer hover:bg-stone-750"
                      onClick={() => handleSelectAllInCategory(categoryChannels)}
                    >
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                        {category}
                      </span>
                      <span className="text-xs text-gray-500">
                        {selectedInCategory}/{categoryChannels.length}
                      </span>
                    </div>
                    
                    {/* Channels in category */}
                    <div className="divide-y divide-stone-600">
                      {categoryChannels.map(channel => {
                        const isSelected = selectedChannelIds.includes(channel.externalId);
                        return (
                          <label
                            key={channel.id}
                            className={`flex items-center px-3 py-2 cursor-pointer hover:bg-stone-650 ${
                              isSelected ? 'bg-amber-500/10' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleChannelToggle(channel.externalId)}
                              className="h-4 w-4 rounded border-gray-600 bg-stone-600 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="ml-2 text-sm text-gray-300 flex items-center gap-1">
                              <span className="text-gray-500">#</span>
                              {channel.externalName}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Select which channels to monitor for messages
          </p>
        </div>
      )}
      </div>
      
      {/* Connect Platform Dialog */}
      <ConnectPlatformDialog
        isOpen={showConnectDialog}
        onClose={() => {
          setShowConnectDialog(false);
          // Always refetch connections when dialog closes
          // This handles webhook-based platforms where connection happens asynchronously
          refetchConnections();
        }}
        platform={platform}
        onConnected={handleConnectionSuccess}
      />
    </>
  );
};

export default ConnectionChannelPicker;
