/**
 * Connection Card - Displays a connected external service
 */

import React from 'react';
import { ExternalConnection } from '../../services/api';
import { PlatformIcon, getConnectionIconUrl, getPlatformDisplayName } from './PlatformIcon';

interface ConnectionCardProps {
  connection: ExternalConnection;
  isSelected?: boolean;
  isRemoving?: boolean;
  showChannelCount?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  connection,
  isSelected = false,
  isRemoving = false,
  showChannelCount = true,
  onSelect,
  onRemove,
}) => {
  const iconUrl = getConnectionIconUrl(
    connection.platform,
    connection.externalId,
    connection.externalIcon
  );

  return (
    <div
      className={`
        relative group p-4 rounded-lg border transition-all
        ${isSelected 
          ? 'bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500' 
          : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'}
        ${onSelect ? 'cursor-pointer' : ''}
        ${isRemoving ? 'opacity-50 pointer-events-none' : ''}
      `}
      onClick={onSelect}
    >
      <div className="flex items-start gap-3">
        {/* Connection icon */}
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={connection.externalName}
            className="w-12 h-12 rounded-full bg-gray-700 flex-shrink-0"
            onError={(e) => {
              // Hide broken images and show platform icon instead
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-gray-700 flex-shrink-0 flex items-center justify-center">
            <PlatformIcon platform={connection.platform} size="lg" className="text-gray-400" />
          </div>
        )}

        {/* Connection info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-white font-medium truncate">{connection.externalName}</h4>
            <PlatformIcon platform={connection.platform} size="sm" className="text-gray-400 flex-shrink-0" />
          </div>
          
          <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
            {showChannelCount && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                {connection.channelCount} channel{connection.channelCount !== 1 ? 's' : ''}
              </span>
            )}
            
            {connection.isActive ? (
              <span className="flex items-center gap-1 text-green-400">
                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-400"></span>
                Inactive
              </span>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-500">
            {getPlatformDisplayName(connection.platform)} - Added {new Date(connection.addedAt).toLocaleDateString()}
          </p>
        </div>

        {/* Remove button */}
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-gray-700/50 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
            title="Remove connection"
          >
            {isRemoving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2">
          <svg className="w-5 h-5 text-indigo-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  );
};

export default ConnectionCard;
