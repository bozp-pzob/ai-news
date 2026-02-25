/**
 * ConnectPlatformDialog - Dialog for connecting external platforms from anywhere in the app
 * 
 * Used in Builder when a source requires a platform connection that isn't available.
 * Opens OAuth flow in a popup window to avoid navigating away from the current page.
 */

import React, { useState, useEffect } from 'react';
import { useConnectionAuth, usePlatforms, PopupConnectionResult } from '../hooks/useExternalConnections';
import { PlatformIcon, getPlatformDisplayName, getPlatformColor } from './connections/PlatformIcon';
import { PlatformType, AuthUrlResult } from '../services/api';

interface ConnectPlatformDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback to close the dialog */
  onClose: () => void;
  /** Optional: Pre-select a specific platform */
  platform?: PlatformType;
  /** Callback when connection is successful */
  onConnected?: (result: PopupConnectionResult) => void;
  /** Custom title */
  title?: string;
  /** Custom description */
  description?: string;
}

/**
 * ConnectPlatformDialog component
 * 
 * Shows a dialog to connect external platforms. For OAuth platforms (Discord, Slack),
 * opens the auth flow in a popup. For webhook platforms (Telegram), shows instructions.
 */
export const ConnectPlatformDialog: React.FC<ConnectPlatformDialogProps> = ({
  isOpen,
  onClose,
  platform: preselectedPlatform,
  onConnected,
  title,
  description,
}) => {
  const { platforms, isLoading: platformsLoading } = usePlatforms();
  const { startPopupAuthFlow, isLoading: authLoading, error, authResult, clearAuthResult } = useConnectionAuth();
  
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType | null>(preselectedPlatform || null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [connectionResult, setConnectionResult] = useState<PopupConnectionResult | null>(null);

  // Filter to only enabled platforms
  const enabledPlatforms = platforms.filter(p => p.isEnabled);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPlatform(preselectedPlatform || null);
      setConnectionStatus('idle');
      setConnectionResult(null);
      clearAuthResult();
    }
  }, [isOpen, preselectedPlatform, clearAuthResult]);

  // Handle connecting to a platform
  const handleConnect = async (platformType: PlatformType) => {
    setSelectedPlatform(platformType);
    setConnectionStatus('connecting');

    const result = await startPopupAuthFlow(platformType);
    
    if (result.success) {
      setConnectionStatus('success');
      setConnectionResult(result);
      onConnected?.(result);
    } else if (result.error === 'Popup closed') {
      // User closed popup - might have succeeded, refresh connections
      setConnectionStatus('idle');
      onConnected?.({ success: false, error: 'popup_closed' });
    } else {
      setConnectionStatus('error');
      setConnectionResult(result);
    }
  };

  // Handle success acknowledgment
  const handleSuccessContinue = () => {
    onClose();
  };

  if (!isOpen) return null;

  const dialogTitle = title || (preselectedPlatform 
    ? `Connect ${getPlatformDisplayName(preselectedPlatform)}`
    : 'Connect a Platform');

  const dialogDescription = description || (preselectedPlatform
    ? `Connect your ${getPlatformDisplayName(preselectedPlatform)} to use it as a data source.`
    : 'Choose a platform to connect as a data source.');

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-stone-800">{dialogTitle}</h3>
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-stone-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-stone-500">{dialogDescription}</p>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Loading platforms */}
          {platformsLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            </div>
          )}

          {/* Success state */}
          {connectionStatus === 'success' && connectionResult && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-stone-800 mb-2">Connected Successfully!</h4>
              <p className="text-stone-500 text-sm mb-6">
                {connectionResult.connectionName} has been connected. You can now select channels to monitor.
              </p>
              <button
                onClick={handleSuccessContinue}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {/* Error state */}
          {connectionStatus === 'error' && connectionResult && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-stone-800 mb-2">Connection Failed</h4>
              <p className="text-stone-500 text-sm mb-6">
                {connectionResult.error || 'An unknown error occurred.'}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    setConnectionStatus('idle');
                    setConnectionResult(null);
                  }}
                  className="px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium rounded-lg transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Connecting state */}
          {connectionStatus === 'connecting' && selectedPlatform && (
            <div className="text-center py-8">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div 
                  className="absolute inset-0 rounded-full animate-pulse"
                  style={{ backgroundColor: `${getPlatformColor(selectedPlatform)}20` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <PlatformIcon 
                    platform={selectedPlatform} 
                    size="xl" 
                    className="text-stone-700"
                  />
                </div>
              </div>
              <h4 className="text-lg font-medium text-stone-800 mb-2">
                Connecting to {getPlatformDisplayName(selectedPlatform)}...
              </h4>
              <p className="text-stone-500 text-sm">
                Complete the authorization in the popup window.
              </p>
              <p className="text-stone-500 text-xs mt-4">
                If the popup was blocked, please allow popups and try again.
              </p>
            </div>
          )}

          {/* Webhook instructions (for Telegram) */}
          {authResult && authResult.authType === 'webhook' && connectionStatus !== 'success' && (
            <div className="py-4">
              <div className="flex items-center gap-3 mb-4">
                <PlatformIcon 
                  platform={authResult.platform} 
                  size="lg" 
                  className="text-stone-700" 
                />
                <h4 className="text-lg font-medium text-stone-800">
                  Connect {getPlatformDisplayName(authResult.platform)}
                </h4>
              </div>
              
              {authResult.instructions && (
                <p className="text-stone-600 text-sm mb-4">{authResult.instructions}</p>
              )}

              <div className="bg-stone-50 rounded-lg p-3 mb-4">
                <p className="text-xs text-stone-500 mb-1">Connection Link:</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-emerald-600 flex-1 truncate">{authResult.url}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(authResult.url);
                    }}
                    className="p-1.5 rounded bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors"
                    title="Copy link"
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
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
                >
                  Open Link
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Platform selection */}
          {!platformsLoading && connectionStatus === 'idle' && !authResult && (
            <div className="space-y-3">
              {/* If preselected platform, show only that */}
              {preselectedPlatform ? (
                <button
                  onClick={() => handleConnect(preselectedPlatform)}
                  disabled={authLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors text-left border border-stone-200 hover:border-emerald-500/50"
                >
                  <div 
                    className="w-12 h-12 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${getPlatformColor(preselectedPlatform)}20` }}
                  >
                    <PlatformIcon 
                      platform={preselectedPlatform} 
                      size="lg" 
                      className="text-stone-700" 
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-stone-800 font-medium">
                      Connect {getPlatformDisplayName(preselectedPlatform)}
                    </div>
                    <div className="text-xs text-stone-400 mt-0.5">
                      {preselectedPlatform === 'discord' && 'Add the bot to your Discord server'}
                      {preselectedPlatform === 'telegram' && 'Add the bot to your Telegram group'}
                      {preselectedPlatform === 'slack' && 'Install the app to your Slack workspace'}
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                /* Show all available platforms */
                enabledPlatforms.map((p) => (
                  <button
                    key={p.platform}
                    onClick={() => handleConnect(p.platform)}
                    disabled={authLoading}
                    className="w-full flex items-center gap-4 p-4 rounded-lg bg-stone-50 hover:bg-stone-100 transition-colors text-left border border-stone-200 hover:border-emerald-500/50"
                  >
                    <div 
                      className="w-12 h-12 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${getPlatformColor(p.platform)}20` }}
                    >
                      <PlatformIcon 
                        platform={p.platform} 
                        size="lg" 
                        className="text-stone-700" 
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-stone-800 font-medium">{p.displayName}</div>
                      <div className="text-xs text-stone-400 mt-0.5">{p.description}</div>
                    </div>
                    <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))
              )}

              {enabledPlatforms.length === 0 && !preselectedPlatform && (
                <div className="text-center py-8 text-stone-400">
                  <p>No platforms are currently available.</p>
                  <p className="text-sm mt-1">Please contact support if you need assistance.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with error */}
        {error && connectionStatus === 'idle' && (
          <div className="px-6 py-3 bg-red-50 border-t border-red-200">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectPlatformDialog;
