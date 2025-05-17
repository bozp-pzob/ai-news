import React, { useState, useEffect, useRef } from 'react';
import { secretManager } from '../services/SecretManager';

interface SecretsManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export const SecretsManagerDialog: React.FC<SecretsManagerDialogProps> = ({ open, onClose }) => {
  const [secrets, setSecrets] = useState<Array<{ id: string; type: string; expiresAt: number; description?: string }>>([]);
  const [newSecret, setNewSecret] = useState({ key: '', value: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [secretsText, setSecretsText] = useState('');
  const [activeTab, setActiveTab] = useState<'individual' | 'bulk'>('individual');
  const secretValueRefs = useRef<{ [id: string]: string }>({});

  // Load secrets from SecretManager when the dialog opens
  useEffect(() => {
    if (open) {
      loadSecrets();
    }
  }, [open]);

  const loadSecrets = async () => {
    setLoading(true);
    try {
      // Get list of secrets
      const secretsList = secretManager.listSecrets();
      setSecrets(secretsList);

      // Pre-load secret values
      const values: { [id: string]: string } = {};
      for (const secret of secretsList) {
        const value = await secretManager.getSecret(secret.id);
        if (value !== null) {
          values[secret.id] = value;
        }
      }
      secretValueRefs.current = values;
      setLoading(false);
    } catch (err) {
      setError(`Error loading secrets: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setLoading(false);
    }
  };

  const handleAddSecret = async () => {
    if (!newSecret.key.trim() || !newSecret.value.trim()) {
      setError('Both key and value are required');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const secretId = await secretManager.storeSecret(
        newSecret.value,
        'api_key', // Default type
        undefined, // Default TTL
        newSecret.key // Use key as description
      );
      
      // Update secrets list
      await loadSecrets();
      
      // Clear the form
      setNewSecret({ key: '', value: '' });
      setSuccess(`Secret "${newSecret.key}" added successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to add secret: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSecret = async (id: string, description?: string) => {
    if (!window.confirm(`Are you sure you want to delete the secret ${description || id}?`)) {
      return;
    }

    setLoading(true);
    
    try {
      await secretManager.removeSecret(id);
      await loadSecrets();
      setSuccess('Secret deleted successfully');
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to delete secret: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBulkImport = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Parse the .env format
      const lines = secretsText.split('\n');
      let successCount = 0;
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (!trimmedLine || trimmedLine.startsWith('#')) {
          continue;
        }
        
        // Basic .env parsing
        const match = trimmedLine.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          
          // Handle quoted values
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          
          if (key && value) {
            await secretManager.storeSecret(
              value,
              'api_key', // Default type
              undefined, // Default TTL
              key // Use key as description
            );
            successCount++;
          }
        }
      }
      
      // Update secrets list
      await loadSecrets();
      
      // Clear the form
      setSecretsText('');
      setSuccess(`${successCount} secrets imported successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to import secrets: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const exportSecrets = async () => {
    setLoading(true);
    
    try {
      let envText = '# Exported Secrets\n';
      
      for (const secret of secrets) {
        const value = await secretManager.getSecret(secret.id);
        if (value !== null && secret.description) {
          // Escape quotes and special characters in value if needed
          const escapedValue = value.includes('"') || value.includes("'") || value.includes(' ') 
            ? `"${value.replace(/"/g, '\\"')}"` 
            : value;
          
          envText += `${secret.description}=${escapedValue}\n`;
        }
      }
      
      setSecretsText(envText);
      setActiveTab('bulk');
      setSuccess('Secrets exported to editor');
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(`Failed to export secrets: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-800 rounded-lg shadow-xl max-w-2xl w-full p-6 text-white max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
            </svg>
            Secrets Manager
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        {error && (
          <div className="bg-red-900/30 border border-red-500 text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-900/30 border border-green-500 text-green-200 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}
        
        <p className="text-sm text-gray-300 mb-4">
          Add and manage your secrets. These can be referenced in plugin parameters using the select dropdown when configuring plugins.
        </p>
        
        {/* Tabs */}
        <div className="flex border-b border-stone-700 mb-4">
          <button
            onClick={() => setActiveTab('individual')}
            className={`py-2 px-4 font-medium ${activeTab === 'individual' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Add/View Secrets
          </button>
          <button
            onClick={() => setActiveTab('bulk')}
            className={`py-2 px-4 font-medium ${activeTab === 'bulk' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-gray-400 hover:text-gray-300'}`}
          >
            Bulk Import/Export
          </button>
        </div>
        
        <div className="flex-1 overflow-auto">
          {activeTab === 'individual' ? (
            <>
              {/* Add Secret Form */}
              <div className="mb-4 bg-stone-700/50 p-4 rounded-md">
                <h3 className="text-sm font-medium mb-3">Add New Secret</h3>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="API_KEY"
                    value={newSecret.key}
                    onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value })}
                    className="p-2 flex-1 rounded-md border-gray-600 bg-stone-800 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  />
                  <input
                    type="password"
                    placeholder="Secret value"
                    value={newSecret.value}
                    onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
                    className="p-2 flex-1 rounded-md border-gray-600 bg-stone-800 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  />
                  <button
                    onClick={handleAddSecret}
                    disabled={loading || !newSecret.key || !newSecret.value}
                    className={`px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                      loading || !newSecret.key || !newSecret.value
                        ? 'bg-amber-700/50 text-amber-300/50 cursor-not-allowed'
                        : 'bg-amber-500 text-black hover:bg-amber-400'
                    }`}
                  >
                    Add
                  </button>
                </div>
              </div>
              
              {/* Secrets List */}
              <div className="overflow-y-auto">
                <h3 className="text-sm font-medium mb-3">Your Secrets</h3>
                {secrets.length === 0 ? (
                  <p className="text-gray-400 text-sm">No secrets found. Add one using the form above.</p>
                ) : (
                  <div className="space-y-2">
                    {secrets.map((secret) => (
                      <div key={secret.id} className="bg-stone-700/30 p-3 rounded-md flex items-center justify-between">
                        <div className="overflow-hidden">
                          <div className="font-medium text-amber-300">{secret.description || 'Unknown'}</div>
                          <div className="text-xs text-gray-400 truncate">
                            ID: {secret.id} • Expires: {new Date(secret.expiresAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center">
                          <button
                            onClick={() => handleDeleteSecret(secret.id, secret.description)}
                            className="text-gray-400 hover:text-red-400 p-1"
                            title="Delete secret"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between mb-2">
                <h3 className="text-sm font-medium">Import/Export (.env format)</h3>
                <button 
                  onClick={exportSecrets}
                  className="text-xs px-2 py-1 bg-blue-900/40 text-blue-300 border border-blue-700/50 rounded hover:bg-blue-800/40"
                >
                  Export Current Secrets
                </button>
              </div>
              <textarea
                value={secretsText}
                onChange={(e) => setSecretsText(e.target.value)}
                placeholder="# Import secrets in .env format\nAPI_KEY=your_api_key\nANOTHER_SECRET=another_value"
                className="p-3 w-full h-60 rounded-md border-gray-600 bg-stone-900 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500 font-mono text-sm"
              />
              <div className="bg-blue-900/20 border border-blue-500/30 text-blue-200 px-4 py-3 rounded text-xs">
                <p className="mb-1">Format: <code>KEY=VALUE</code> (one per line)</p>
                <p>Example: <code>OPENAI_API_KEY=sk-1234567890abcdef</code></p>
              </div>
              <button
                onClick={handleBulkImport}
                disabled={loading || !secretsText.trim()}
                className={`w-full px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  loading || !secretsText.trim()
                    ? 'bg-amber-700/50 text-amber-300/50 cursor-not-allowed'
                    : 'bg-amber-500 text-black hover:bg-amber-400'
                }`}
              >
                Import Secrets
              </button>
            </div>
          )}
        </div>
        
        <div className="mt-6 flex justify-end space-x-3 pt-3 border-t border-stone-700">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-stone-700 text-white rounded hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}; 