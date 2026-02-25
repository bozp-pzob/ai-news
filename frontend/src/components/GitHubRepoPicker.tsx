/**
 * GitHubRepoPicker - A component for selecting GitHub repositories
 * 
 * Supports two modes:
 * 1. Public repos: Enter repo URLs or "owner/repo" strings manually
 * 2. Private repos: Select from repos available via GitHub App connection
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useConnections, useConnectionChannels } from '../hooks/useExternalConnections';
import { ExternalConnection, ExternalChannel } from '../services/api';
import { ConnectPlatformDialog } from './ConnectPlatformDialog';

interface GitHubRepoPickerProps {
  /** Currently selected connection ID (for GitHub App mode) */
  selectedConnectionId?: string;
  /** Currently selected repos (as "owner/repo" strings) */
  selectedRepos: string[];
  /** Callback when connection changes */
  onConnectionChange: (connectionId: string | undefined, connection?: ExternalConnection) => void;
  /** Callback when selected repos change */
  onReposChange: (repos: string[]) => void;
}

/**
 * Parse a repo input into "owner/repo" format
 */
function parseRepoInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // Handle full URL: https://github.com/owner/repo or https://github.com/owner/repo.git
  const urlMatch = trimmed.match(/github\.com\/([^\/]+)\/([^\/\.\s]+)/);
  if (urlMatch) {
    return `${urlMatch[1]}/${urlMatch[2]}`;
  }
  
  // Handle shorthand: owner/repo
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }
  
  return null;
}

/**
 * GitHubRepoPicker component
 */
export const GitHubRepoPicker: React.FC<GitHubRepoPickerProps> = ({
  selectedConnectionId,
  selectedRepos = [],
  onConnectionChange,
  onReposChange,
}) => {
  // Fetch user's GitHub connections
  const { connections, isLoading: connectionsLoading, refetch: refetchConnections } = useConnections('github' as any);
  
  // Track the selected connection internally
  const [internalConnectionId, setInternalConnectionId] = useState<string | undefined>(selectedConnectionId);
  
  // Input for adding public repos
  const [repoInput, setRepoInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  
  // Track connect dialog state
  const [showConnectDialog, setShowConnectDialog] = useState(false);
  
  // Fetch repos for the selected connection
  const { 
    channels: repos, 
    isLoading: reposLoading, 
    isSyncing,
    syncChannels: syncRepos 
  } = useConnectionChannels(internalConnectionId || null);

  // Debug logging
  useEffect(() => {
    if (internalConnectionId) {
      console.log('[GitHubRepoPicker] Connection:', internalConnectionId);
      console.log('[GitHubRepoPicker] Repos loaded:', repos.length, repos);
      console.log('[GitHubRepoPicker] Loading:', reposLoading, 'Syncing:', isSyncing);
    }
  }, [internalConnectionId, repos, reposLoading, isSyncing]);

  // Update internal state when prop changes
  useEffect(() => {
    setInternalConnectionId(selectedConnectionId);
  }, [selectedConnectionId]);

  // Auto-sync repos when connection is selected but no repos are found
  // This handles the case where repos weren't synced during initial connection
  useEffect(() => {
    if (internalConnectionId && !reposLoading && !isSyncing && repos.length === 0) {
      console.log('[GitHubRepoPicker] No repos found, triggering sync...');
      syncRepos();
    }
  }, [internalConnectionId, reposLoading, isSyncing, repos.length, syncRepos]);

  // Filter connections to only active GitHub ones
  const activeConnections = useMemo(() => {
    return connections.filter(c => c.isActive && c.platform === 'github');
  }, [connections]);

  // Handle successful connection
  const handleConnectionSuccess = (result: any) => {
    refetchConnections();
    setShowConnectDialog(false);
    
    if (result.connectionId) {
      setInternalConnectionId(result.connectionId);
      // Give time for state to update, then sync repos
      setTimeout(() => {
        const newConnection = connections.find(c => c.id === result.connectionId);
        onConnectionChange(result.connectionId, newConnection);
        // Trigger repo sync for the new connection
        syncRepos();
      }, 500);
    }
  };

  // Handle connection selection
  const handleConnectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const connectionId = e.target.value || undefined;
    setInternalConnectionId(connectionId);
    
    const connection = connectionId 
      ? activeConnections.find(c => c.id === connectionId) 
      : undefined;
    
    // Clear repos when connection changes
    onReposChange([]);
    onConnectionChange(connectionId, connection);
  };

  // Handle repo toggle (for connection mode)
  const handleRepoToggle = (repoFullName: string) => {
    const newRepos = selectedRepos.includes(repoFullName)
      ? selectedRepos.filter(r => r !== repoFullName)
      : [...selectedRepos, repoFullName];
    onReposChange(newRepos);
  };

  // Handle adding a public repo
  const handleAddPublicRepo = () => {
    const parsed = parseRepoInput(repoInput);
    
    if (!parsed) {
      setInputError('Invalid format. Use "owner/repo" or a GitHub URL.');
      return;
    }
    
    if (selectedRepos.includes(parsed)) {
      setInputError('This repository is already added.');
      return;
    }
    
    onReposChange([...selectedRepos, parsed]);
    setRepoInput('');
    setInputError(null);
  };

  // Handle removing a public repo
  const handleRemovePublicRepo = (repo: string) => {
    onReposChange(selectedRepos.filter(r => r !== repo));
  };

  // Handle key press in input
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddPublicRepo();
    }
  };

  // Clear connection (switch to public mode)
  const handleClearConnection = () => {
    setInternalConnectionId(undefined);
    onConnectionChange(undefined, undefined);
    onReposChange([]);
  };

  const inputClasses = "p-2 w-full rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500";

  return (
    <>
      <div className="space-y-4">
        {/* Mode Toggle / Connection Picker */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-stone-600">
              Repository Source
            </label>
            {activeConnections.length > 0 && !internalConnectionId && (
              <button
                type="button"
                onClick={() => setShowConnectDialog(true)}
                className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Connect GitHub App
              </button>
            )}
          </div>
          
          {/* Show connection dropdown if user has GitHub connections */}
          {activeConnections.length > 0 ? (
            <div className="flex gap-2">
              <select
                value={internalConnectionId || ''}
                onChange={handleConnectionChange}
                disabled={connectionsLoading}
                className={`${inputClasses} flex-1`}
              >
                <option value="">Public Repos (enter URLs)</option>
                {activeConnections.map(conn => (
                  <option key={conn.id} value={conn.id}>
                    {conn.externalName} ({conn.channelCount} repos)
                  </option>
                ))}
              </select>
              {internalConnectionId && (
                <button
                  type="button"
                  onClick={handleClearConnection}
                  className="px-3 py-2 text-sm text-stone-500 hover:text-stone-800 border border-stone-300 rounded-md"
                  title="Switch to public repos"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-stone-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-stone-600">
                    Track public GitHub repos (rate limited to 60 req/hr)
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowConnectDialog(true)}
                    className="mt-2 text-xs text-emerald-600 hover:text-emerald-700"
                  >
                    Connect GitHub App for private repos →
                  </button>
                </div>
              </div>
            </div>
          )}
          <p className="mt-1 text-xs text-stone-400">
            {internalConnectionId 
              ? 'Select repos from your GitHub App connection' 
              : 'Enter public repo URLs or connect a GitHub App for private repos'}
          </p>
        </div>

        {/* Public Repo Input (when no connection selected) */}
        {!internalConnectionId && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Add Repositories
              <span className="text-red-500 ml-1">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={repoInput}
                onChange={(e) => {
                  setRepoInput(e.target.value);
                  setInputError(null);
                }}
                onKeyPress={handleKeyPress}
                placeholder="facebook/react or https://github.com/owner/repo"
                className={`${inputClasses} flex-1`}
              />
              <button
                type="button"
                onClick={handleAddPublicRepo}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
              >
                Add
              </button>
            </div>
            {inputError && (
              <p className="mt-1 text-xs text-red-400">{inputError}</p>
            )}
            
            {/* List of added repos */}
            {selectedRepos.length > 0 && (
              <div className="mt-3 space-y-2">
                {selectedRepos.map(repo => (
                  <div 
                    key={repo}
                    className="flex items-center justify-between p-2 bg-stone-50 rounded-md border border-stone-200"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-stone-400" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                      <span className="text-sm text-stone-700">{repo}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePublicRepo(repo)}
                      className="p-1 text-red-400 hover:text-red-300"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {selectedRepos.length === 0 && (
              <p className="mt-2 text-xs text-emerald-600">
                Add at least one repository to track
              </p>
            )}
          </div>
        )}

        {/* Connection Repo Picker (when connection selected) */}
        {internalConnectionId && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-stone-600">
                Select Repositories
                <span className="text-red-500 ml-1">*</span>
              </label>
              <div className="flex items-center gap-2">
                {selectedRepos.length > 0 && (
                  <span className="text-xs text-emerald-600">
                    {selectedRepos.length} selected
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => syncRepos()}
                  disabled={isSyncing}
                  className="text-xs text-stone-500 hover:text-emerald-600 flex items-center gap-1"
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

            {reposLoading ? (
              <div className="p-4 bg-stone-50 rounded-md border border-stone-200 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mx-auto mb-2"></div>
                <span className="text-sm text-stone-500">Loading repositories...</span>
              </div>
            ) : repos.length === 0 ? (
              <div className="p-4 bg-stone-50 rounded-md border border-stone-200 text-center">
                <span className="text-sm text-stone-500">
                  No repositories found. Make sure your GitHub App has access to repositories.
                </span>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto bg-white rounded-md border border-stone-200">
                {/* Group by owner */}
                {Object.entries(
                  repos.reduce((acc, repo) => {
                    const owner = repo.parentName || repo.metadata?.owner || 'Unknown';
                    if (!acc[owner]) acc[owner] = [];
                    acc[owner].push(repo);
                    return acc;
                  }, {} as Record<string, ExternalChannel[]>)
                ).map(([owner, ownerRepos]) => (
                  <div key={owner} className="border-b border-stone-200 last:border-b-0">
                    {/* Owner header */}
                    <div className="px-3 py-2 bg-stone-50">
                      <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                        {owner}
                      </span>
                    </div>
                    
                    {/* Repos */}
                    <div className="divide-y divide-stone-100">
                      {ownerRepos.map(repo => {
                        const fullName = repo.metadata?.fullName || repo.externalName || `${owner}/${repo.metadata?.name}`;
                        const isSelected = selectedRepos.includes(fullName);
                        const isPrivate = repo.metadata?.private;
                        
                        return (
                          <label
                            key={repo.id}
                            className={`flex items-center px-3 py-2 cursor-pointer hover:bg-stone-50 ${
                              isSelected ? 'bg-emerald-50' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleRepoToggle(fullName)}
                              className="h-4 w-4 rounded border-stone-300 bg-white text-emerald-600 focus:ring-emerald-500"
                            />
                            <div className="ml-2 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-stone-600">
                                  {repo.metadata?.name || repo.externalName}
                                </span>
                                {isPrivate && (
                                  <span className="px-1.5 py-0.5 text-xs bg-stone-100 text-stone-500 rounded">
                                    private
                                  </span>
                                )}
                              </div>
                              {repo.metadata?.description && (
                                <p className="text-xs text-gray-500 truncate max-w-xs">
                                  {repo.metadata.description}
                                </p>
                              )}
                            </div>
                            {repo.metadata?.stars && repo.metadata.stars > 0 && (
                              <span className="text-xs text-stone-400 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                                </svg>
                                {repo.metadata?.stars}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {selectedRepos.length === 0 && !reposLoading && repos.length > 0 && (
              <p className="mt-2 text-xs text-emerald-600">
                Select at least one repository to track
              </p>
            )}
          </div>
        )}
      </div>
      
      {/* Connect Platform Dialog */}
      <ConnectPlatformDialog
        isOpen={showConnectDialog}
        onClose={() => {
          setShowConnectDialog(false);
          refetchConnections();
        }}
        platform={'github' as any}
        onConnected={handleConnectionSuccess}
      />
    </>
  );
};

export default GitHubRepoPicker;
