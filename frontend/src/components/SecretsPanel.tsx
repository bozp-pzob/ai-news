// frontend/src/components/SecretsPanel.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { secretManager } from '../services/SecretManager';

interface SecretsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface SecretEntry {
  id: string;
  type: string;
  expiresAt: number;
  description?: string;
}

/**
 * Common secret types for the type dropdown
 */
const SECRET_TYPES = [
  { value: 'apiKey', label: 'API Key' },
  { value: 'token', label: 'Token' },
  { value: 'password', label: 'Password' },
  { value: 'connectionString', label: 'Connection String' },
  { value: 'other', label: 'Other' },
];

/**
 * Format time remaining until expiry
 */
function formatTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const diffMs = expiresAt - now;
  
  if (diffMs <= 0) return 'Expired';
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * SecretsPanel - Manages secret key-value pairs stored in the browser's SecretManager.
 * Values never leave the browser unless the user explicitly runs a config that references them.
 */
export function SecretsPanel({ open, onClose }: SecretsPanelProps) {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState('apiKey');
  const [newDescription, setNewDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load secrets list
  const refreshSecrets = useCallback(() => {
    const list = secretManager.listSecrets();
    setSecrets(list);
  }, []);

  useEffect(() => {
    if (open) {
      refreshSecrets();
      // Auto-refresh every 30s for expiry updates
      const interval = setInterval(refreshSecrets, 30000);
      return () => clearInterval(interval);
    }
  }, [open, refreshSecrets]);

  const handleAddSecret = async () => {
    if (!newValue.trim()) {
      setAddError('Secret value is required');
      return;
    }

    setIsAdding(true);
    setAddError(null);

    try {
      const id = await secretManager.storeSecret(
        newValue.trim(),
        newType,
        24 * 60 * 60 * 1000, // 24 hour TTL
        newDescription.trim() || undefined
      );

      // Reset form
      setNewValue('');
      setNewType('apiKey');
      setNewDescription('');
      setShowAddForm(false);
      refreshSecrets();

      // Show the reference ID briefly
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 3000);
    } catch (err: any) {
      setAddError(err?.message || 'Failed to store secret');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveSecret = async (id: string) => {
    try {
      await secretManager.removeSecret(id);
      refreshSecrets();
    } catch (err) {
      console.error('Failed to remove secret:', err);
    }
  };

  const handleCopyRef = (id: string) => {
    const ref = `$SECRET:${id}$`;
    navigator.clipboard.writeText(ref).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white border-l border-stone-200 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
          <div>
            <h2 className="text-lg font-semibold text-stone-800">Secrets</h2>
            <p className="text-xs text-stone-500">
              Stored in this browser only
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-stone-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Info banner */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-600">
            <p className="font-medium mb-1">How secrets work</p>
            <p>
              Secrets are encrypted and stored only in this browser. When you add a secret to a plugin parameter field,
              a <code className="bg-blue-100 px-1 rounded">$SECRET:id$</code> reference is saved in the config.
              The actual value is resolved at runtime before executing.
            </p>
          </div>

          {/* Secrets List */}
          {secrets.length === 0 && !showAddForm && (
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto text-stone-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-stone-400 text-sm">No secrets stored</p>
              <p className="text-stone-500 text-xs mt-1">
                Add secrets to use in your config parameters
              </p>
            </div>
          )}

          {secrets.map((secret) => (
            <div
              key={secret.id}
              className="p-3 bg-stone-50 border border-stone-200 rounded-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
                      {secret.type}
                    </span>
                    <span className="text-xs text-stone-500">
                      {formatTimeRemaining(secret.expiresAt)}
                    </span>
                  </div>
                  {secret.description && (
                    <p className="text-sm text-stone-600 mt-1 truncate">
                      {secret.description}
                    </p>
                  )}
                  <p className="text-xs font-mono text-stone-500 mt-1 truncate">
                    ID: {secret.id}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Copy reference */}
                  <button
                    onClick={() => handleCopyRef(secret.id)}
                    className="p-1.5 text-stone-400 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors"
                    title="Copy $SECRET:id$ reference"
                  >
                    {copiedId === secret.id ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  {/* Remove */}
                  <button
                    onClick={() => handleRemoveSecret(secret.id)}
                    className="p-1.5 text-stone-400 hover:text-red-400 hover:bg-stone-100 rounded transition-colors"
                    title="Remove secret"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Add Secret Form */}
          {showAddForm && (
            <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg space-y-3">
              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1">
                  Type
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {SECRET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1">
                  Description <span className="text-stone-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="e.g. OpenAI API Key for production"
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 text-sm placeholder-stone-400 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-400 mb-1">
                  Value <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-stone-800 text-sm font-mono placeholder-stone-400 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {addError && (
                <p className="text-red-400 text-xs">{addError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewValue('');
                    setNewDescription('');
                    setAddError(null);
                  }}
                  className="flex-1 px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSecret}
                  disabled={isAdding || !newValue.trim()}
                  className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-200 disabled:text-stone-400 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isAdding ? 'Storing...' : 'Store Secret'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-200 flex justify-between items-center">
          <p className="text-xs text-stone-500">
            {secrets.length} secret{secrets.length !== 1 ? 's' : ''} stored
          </p>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Secret
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default SecretsPanel;
