// frontend/src/components/ConfigInfoPanel.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { ConfigVisibility, UserLimits, relayApi } from '../services/api';
import { localServerSettings, LocalServerSettings } from '../services/localConfigStorage';
import { useAuth } from '../context/AuthContext';

export interface ConfigInfo {
  name: string;
  description: string;
  visibility: ConfigVisibility;
  isLocalExecution?: boolean;
}

interface ConfigInfoPanelProps {
  open: boolean;
  onClose: () => void;
  onSave: (info: ConfigInfo) => void;
  initialValues?: Partial<ConfigInfo>;
  limits: UserLimits | null;
  isEditing?: boolean;
  isSaving?: boolean;
  configId?: string;
}

export function ConfigInfoPanel({
  open,
  onClose,
  onSave,
  initialValues,
  limits,
  isEditing = false,
  isSaving = false,
  configId,
}: ConfigInfoPanelProps) {
  const { authToken } = useAuth();
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [visibility, setVisibility] = useState<ConfigVisibility>(initialValues?.visibility || 'public');
  const [isLocalExecution, setIsLocalExecution] = useState(initialValues?.isLocalExecution || false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Local server settings (browser-only)
  const [serverUrl, setServerUrl] = useState('');
  const [serverKey, setServerKey] = useState('');
  const [showServerKey, setShowServerKey] = useState(false);
  const [connectionTestStatus, setConnectionTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionTestMessage, setConnectionTestMessage] = useState('');

  const canBePrivate = limits?.limits.canCreatePrivate;

  // Update form when initial values change
  useEffect(() => {
    if (initialValues) {
      setName(initialValues.name || '');
      setDescription(initialValues.description || '');
      setVisibility(initialValues.visibility || 'public');
      setIsLocalExecution(initialValues.isLocalExecution || false);
    }
  }, [initialValues]);

  // Load local server settings from localStorage when panel opens
  useEffect(() => {
    if (open && configId) {
      const settings = localServerSettings.get(configId);
      if (settings) {
        setServerUrl(settings.url);
        setServerKey(settings.key);
      } else {
        setServerUrl('');
        setServerKey('');
      }
      setConnectionTestStatus('idle');
      setConnectionTestMessage('');
    }
  }, [open, configId]);

  // Save local server settings to localStorage whenever they change
  const saveLocalServerSettings = useCallback(() => {
    if (!configId) return;
    if (serverUrl.trim() && serverKey.trim()) {
      localServerSettings.set(configId, { url: serverUrl.trim(), key: serverKey.trim() });
    } else {
      localServerSettings.clear(configId);
    }
  }, [configId, serverUrl, serverKey]);

  // Test connection to local server via relay
  const handleTestConnection = async () => {
    if (!authToken || !serverUrl.trim()) return;

    setConnectionTestStatus('testing');
    setConnectionTestMessage('');

    try {
      const result = await relayApi.health(authToken, serverUrl.trim());
      if (result.status === 'ok') {
        setConnectionTestStatus('success');
        setConnectionTestMessage(`Connected! v${result.version} | Key: ${result.hasKey ? 'configured' : 'missing'}`);
      } else {
        setConnectionTestStatus('error');
        setConnectionTestMessage('Server responded but status is not ok');
      }
    } catch (err: any) {
      setConnectionTestStatus('error');
      setConnectionTestMessage(err?.message || 'Connection failed');
    }
  };

  const handleSave = () => {
    // Validate
    if (!name.trim()) {
      setValidationError('Config name is required');
      return;
    }

    // Save local server settings to localStorage
    saveLocalServerSettings();

    setValidationError(null);
    onSave({
      name: name.trim(),
      description: description.trim(),
      visibility,
      isLocalExecution,
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-stone-900 border-l border-stone-700 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-700">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Config Settings' : 'New Config'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">
              Config Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Community Context"
              className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none"
            />
            <p className="text-stone-500 text-xs mt-1">
              This will be the display name for your config
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what context this config aggregates..."
              rows={3}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Visibility
            </label>
            <div className="space-y-2">
              {(['public', 'unlisted', 'private'] as ConfigVisibility[]).map((v) => (
                <label
                  key={v}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility === v
                      ? 'border-amber-500 bg-amber-900/20'
                      : 'border-stone-600 hover:border-stone-500'
                  } ${v === 'private' && !canBePrivate ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => canBePrivate || v !== 'private' ? setVisibility(v) : null}
                    disabled={v === 'private' && !canBePrivate}
                    className="mt-0.5 accent-amber-500"
                  />
                  <div>
                    <div className="font-medium text-white capitalize text-sm">{v}</div>
                    <div className="text-stone-400 text-xs">
                      {v === 'public' && 'Anyone can discover and query this config'}
                      {v === 'unlisted' && 'Only people with the link can access'}
                      {v === 'private' && (canBePrivate ? 'Only you can access this config' : 'Upgrade to Pro for private configs')}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Local Execution */}
          {isEditing && configId && (
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-2">
                Execution Mode
              </label>
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isLocalExecution
                    ? 'border-blue-500 bg-blue-900/20'
                    : 'border-stone-600 hover:border-stone-500'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isLocalExecution}
                  onChange={(e) => setIsLocalExecution(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <div className="font-medium text-white text-sm">Run on local server</div>
                  <div className="text-stone-400 text-xs">
                    Execute this config on your own server via encrypted relay. Secrets and results stay on your infrastructure.
                  </div>
                </div>
              </label>

              {/* Local server settings (only shown when local execution is enabled) */}
              {isLocalExecution && (
                <div className="mt-3 space-y-3 pl-2 border-l-2 border-blue-800 ml-1">
                  {/* Server URL */}
                  <div>
                    <label className="block text-xs font-medium text-stone-400 mb-1">
                      Server URL
                    </label>
                    <input
                      type="url"
                      value={serverUrl}
                      onChange={(e) => {
                        setServerUrl(e.target.value);
                        setConnectionTestStatus('idle');
                      }}
                      placeholder="http://localhost:3000"
                      className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white text-sm placeholder-stone-500 focus:border-blue-500 focus:outline-none"
                    />
                    <p className="text-stone-500 text-xs mt-1">
                      The URL of your local ai-news server
                    </p>
                  </div>

                  {/* Encryption Key */}
                  <div>
                    <label className="block text-xs font-medium text-stone-400 mb-1">
                      Encryption Key
                    </label>
                    <div className="relative">
                      <input
                        type={showServerKey ? 'text' : 'password'}
                        value={serverKey}
                        onChange={(e) => setServerKey(e.target.value)}
                        placeholder="Base64-encoded AES-256 key from server logs"
                        className="w-full px-3 py-2 pr-10 bg-stone-800 border border-stone-600 rounded-lg text-white text-sm placeholder-stone-500 focus:border-blue-500 focus:outline-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowServerKey(!showServerKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {showServerKey ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          )}
                        </svg>
                      </button>
                    </div>
                    <p className="text-stone-500 text-xs mt-1">
                      Shown in your server's console on startup. Stored only in this browser.
                    </p>
                  </div>

                  {/* Test Connection Button */}
                  <div>
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={!serverUrl.trim() || connectionTestStatus === 'testing'}
                      className="px-3 py-1.5 bg-stone-700 hover:bg-stone-600 disabled:bg-stone-800 disabled:text-stone-500 text-white text-sm rounded-lg transition-colors"
                    >
                      {connectionTestStatus === 'testing' ? (
                        <span className="flex items-center gap-2">
                          <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Testing...
                        </span>
                      ) : (
                        'Test Connection'
                      )}
                    </button>
                    {connectionTestStatus === 'success' && (
                      <p className="text-green-400 text-xs mt-1">{connectionTestMessage}</p>
                    )}
                    {connectionTestStatus === 'error' && (
                      <p className="text-red-400 text-xs mt-1">{connectionTestMessage}</p>
                    )}
                  </div>

                  {/* Security note */}
                  <div className="p-2 bg-blue-900/20 border border-blue-800 rounded text-xs text-blue-300">
                    Your server URL and encryption key are stored only in this browser's localStorage. They are never saved to our database.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Storage info */}
          <div className="p-3 bg-stone-800 rounded-lg border border-stone-700">
            <p className="text-stone-400 text-sm">
              <span className="text-amber-400 font-medium">Storage:</span> Configure storage by adding a PostgresStorage plugin in the builder. Pro users can use platform-hosted storage.
            </p>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
              <p className="text-red-400 text-sm">{validationError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 disabled:text-stone-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              isEditing ? 'Save Settings' : 'Create Config'
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default ConfigInfoPanel;
