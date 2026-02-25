/**
 * Channel Picker - Select channels from a connection
 * 
 * Used in the PluginParamDialog for configuring data sources
 */

import React, { useState, useEffect } from 'react';
import { useConnections, useConnectionChannels } from '../../hooks/useExternalConnections';
import { ExternalChannel, PlatformType } from '../../services/api';
import { PlatformIcon, getPlatformDisplayName } from './PlatformIcon';

interface ChannelPickerProps {
  /** Filter to a specific platform (optional) */
  platform?: PlatformType;
  /** Currently selected connection ID */
  connectionId?: string;
  /** Currently selected channel IDs */
  selectedChannelIds: string[];
  /** Callback when connection changes */
  onConnectionChange: (connectionId: string, externalId: string) => void;
  /** Callback when channel selection changes */
  onChannelsChange: (channelIds: string[]) => void;
  /** Max channels that can be selected (optional) */
  maxChannels?: number;
  /** Whether to show the add connection button */
  showAddConnection?: boolean;
}

export const ChannelPicker: React.FC<ChannelPickerProps> = ({
  platform,
  connectionId,
  selectedChannelIds,
  onConnectionChange,
  onChannelsChange,
  maxChannels,
  showAddConnection = true,
}) => {
  const { connections, isLoading: isLoadingConnections, error: connectionsError } = useConnections(platform);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(connectionId || null);

  // Find the selected connection
  const selectedConnection = connections.find(c => c.id === selectedConnectionId);

  const { 
    channels, 
    groupedChannels, 
    connectionName,
    isLoading: isLoadingChannels, 
    isSyncing,
    syncChannels,
  } = useConnectionChannels(selectedConnectionId);

  // Update selected connection when connectionId prop changes
  useEffect(() => {
    if (connectionId && connectionId !== selectedConnectionId) {
      setSelectedConnectionId(connectionId);
    }
  }, [connectionId, selectedConnectionId]);

  // Handle connection selection
  const handleConnectionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const conn = connections.find(c => c.id === e.target.value);
    if (conn) {
      setSelectedConnectionId(conn.id);
      onConnectionChange(conn.id, conn.externalId);
      onChannelsChange([]); // Clear channel selection when connection changes
    }
  };

  // Handle channel toggle
  const handleChannelToggle = (channelExternalId: string) => {
    const isSelected = selectedChannelIds.includes(channelExternalId);
    let newSelection: string[];

    if (isSelected) {
      newSelection = selectedChannelIds.filter(id => id !== channelExternalId);
    } else {
      if (maxChannels && selectedChannelIds.length >= maxChannels) {
        return; // Don't add if at max
      }
      newSelection = [...selectedChannelIds, channelExternalId];
    }

    onChannelsChange(newSelection);
  };

  // Handle select all in category
  const handleSelectCategory = (categoryChannels: ExternalChannel[]) => {
    const categoryIds = categoryChannels.map(c => c.externalId);
    const allSelected = categoryIds.every(id => selectedChannelIds.includes(id));

    if (allSelected) {
      // Deselect all in category
      onChannelsChange(selectedChannelIds.filter(id => !categoryIds.includes(id)));
    } else {
      // Select all in category (respecting max)
      const newIds = categoryIds.filter(id => !selectedChannelIds.includes(id));
      const available = maxChannels ? maxChannels - selectedChannelIds.length : newIds.length;
      onChannelsChange([...selectedChannelIds, ...newIds.slice(0, available)]);
    }
  };

  if (isLoadingConnections) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500"></div>
        <span className="ml-2 text-sm text-stone-500">Loading connections...</span>
      </div>
    );
  }

  if (connectionsError) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
        <p className="text-red-400 text-sm">{connectionsError}</p>
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="text-center py-6 bg-stone-50 rounded-lg border border-stone-200">
        <div className="mx-auto h-10 w-10 text-stone-400 flex items-center justify-center">
          {platform ? (
            <PlatformIcon platform={platform} size="xl" />
          ) : (
            <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          )}
        </div>
        <p className="mt-2 text-sm text-stone-500">
          No {platform ? getPlatformDisplayName(platform) : ''} connections found
        </p>
        <p className="mt-1 text-xs text-stone-400">
          Connect from your dashboard first
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection selector */}
      <div>
        <label className="block text-sm font-medium text-stone-600 mb-1">
          {platform ? getPlatformDisplayName(platform) : 'Connection'}
        </label>
        <select
          value={selectedConnectionId || ''}
          onChange={handleConnectionSelect}
          className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        >
          <option value="">Select a connection...</option>
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id}>
              {conn.externalName} ({conn.channelCount} channels)
            </option>
          ))}
        </select>
      </div>

      {/* Channel selector */}
      {selectedConnectionId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-300">
              Channels {maxChannels && `(max ${maxChannels})`}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500">
                {selectedChannelIds.length} selected
              </span>
              <button
                onClick={syncChannels}
                disabled={isSyncing}
                className="text-xs text-emerald-600 hover:text-emerald-700 disabled:text-stone-400"
              >
                {isSyncing ? 'Syncing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {isLoadingChannels ? (
            <div className="flex items-center justify-center py-4 bg-stone-50 rounded-lg">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500"></div>
              <span className="ml-2 text-sm text-stone-500">Loading channels...</span>
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-4 bg-stone-50 rounded-lg">
              <p className="text-sm text-stone-500">No accessible channels found</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto bg-white rounded-lg border border-stone-200">
              {Object.entries(groupedChannels).map(([category, categoryChannels]) => (
                <div key={category} className="border-b border-stone-200 last:border-b-0">
                  {/* Category header */}
                  <button
                    onClick={() => handleSelectCategory(categoryChannels)}
                    className="w-full px-3 py-2 flex items-center justify-between bg-stone-50 hover:bg-stone-100 text-left text-sm font-medium text-stone-600"
                  >
                    <span>{category}</span>
                    <span className="text-xs text-stone-400">
                      {categoryChannels.filter(c => selectedChannelIds.includes(c.externalId)).length}/{categoryChannels.length}
                    </span>
                  </button>

                  {/* Channels in category */}
                  <div className="divide-y divide-stone-100">
                    {categoryChannels.map((channel) => {
                      const isSelected = selectedChannelIds.includes(channel.externalId);
                      const isDisabled = !isSelected && !!maxChannels && selectedChannelIds.length >= maxChannels;

                      return (
                        <label
                          key={channel.externalId}
                          className={`
                            flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors
                            ${isSelected ? 'bg-emerald-50' : 'hover:bg-stone-50'}
                            ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleChannelToggle(channel.externalId)}
                            disabled={isDisabled}
                            className="w-4 h-4 rounded border-stone-300 bg-white text-emerald-500 focus:ring-emerald-500"
                          />
                          <span className="text-stone-400">#</span>
                          <span className={`text-sm ${isSelected ? 'text-stone-800' : 'text-stone-600'}`}>
                            {channel.externalName}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChannelPicker;
