import React, { useState, useEffect, useRef } from 'react';
import { secretManager } from '../services/SecretManager';

interface SecretsManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

export const SecretsManagerDialog: React.FC<SecretsManagerDialogProps> = ({ open, onClose }) => {
  const [secrets, setSecrets] = useState<Array<{ id: string; type: string; expiresAt: number; description?: string }>>([]);
  const [newSecret, setNewSecret] = useState({ key: '', value: '', ttl: 3600000 }); // Default TTL: 1 hour
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [secretsText, setSecretsText] = useState('');
  const [bulkTtl, setBulkTtl] = useState(3600000); // Default TTL for bulk import: 1 hour
  const [activeTab, setActiveTab] = useState<'individual' | 'bulk'>('individual');
  const secretValueRefs = useRef<{ [id: string]: string }>({});
  const [expirationInfo, setExpirationInfo] = useState<{[id: string]: { formattedExpiry: string, isExpired: boolean }}>({});

  // Available TTL options
  const ttlOptions = secretManager.getAvailableTtlOptions();

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

      // Get expiration info for all secrets
      const expirationData: {[id: string]: { formattedExpiry: string, isExpired: boolean }} = {};
      for (const secret of secretsList) {
        const info = secretManager.getSecretExpirationInfo(secret.id);
        if (info) {
          expirationData[secret.id] = {
            formattedExpiry: info.formattedExpiry,
            isExpired: info.isExpired
          };
        }
      }
      setExpirationInfo(expirationData);

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
        newSecret.ttl, // Use selected TTL
        newSecret.key // Use key as description
      );
      
      // Update secrets list
      await loadSecrets();
      
      // Clear the form
      setNewSecret({ key: '', value: '', ttl: 3600000 });
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
      const secretsToImport: Array<{value: string, type: string, description: string}> = [];
      
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
            secretsToImport.push({
              value,
              type: 'api_key', // Default type
              description: key
            });
          }
        }
      }
      
      // Use the bulk import method with common TTL
      if (secretsToImport.length > 0) {
        const secretIds = await secretManager.storeSecretsBulk(
          secretsToImport,
          bulkTtl,
          true // persist to storage
        );
        
        // Update secrets list
        await loadSecrets();
        
        // Clear the form
        setSecretsText('');
        setSuccess(`${secretIds.length} secrets imported successfully with ${secretManager.formatTtl(bulkTtl)} expiration`);
      } else {
        setError('No valid secrets found in the input');
      }
      
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
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full h-[min(90vh,650px)] p-4 text-stone-800 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-medium flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"></path>
            </svg>
            Secrets Manager
          </h2>
          <button 
            onClick={onClose} 
            className="text-stone-400 hover:text-stone-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-300 text-red-600 px-3 py-2 rounded mb-2 text-sm">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-50 border border-green-300 text-green-600 px-3 py-2 rounded mb-2 text-sm">
            {success}
          </div>
        )}
        
        {/* Tabs */}
        <div className="flex border-b border-stone-200 mb-3">
          <button
            onClick={() => setActiveTab('individual')}
            className={`py-1.5 px-3 text-sm font-medium ${activeTab === 'individual' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            Add/View Secrets
          </button>
          <button
            onClick={() => setActiveTab('bulk')}
            className={`py-1.5 px-3 text-sm font-medium ${activeTab === 'bulk' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
          >
            Bulk Import/Export
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'individual' ? (
            <div className="flex flex-col h-full">
              {/* Add Secret Form */}
              <div className="mb-3 bg-stone-50 p-3 rounded-md">
                <form onSubmit={(e) => { e.preventDefault(); handleAddSecret(); }} className="flex flex-col gap-2">
                  <div className="flex items-center">
                    <label className="text-xs w-24 font-medium">Secret Name:</label>
                    <input
                      type="text"
                      placeholder="API_KEY"
                      value={newSecret.key}
                      onChange={(e) => setNewSecret({ ...newSecret, key: e.target.value })}
                      className="p-1.5 flex-1 text-sm rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex items-center">
                    <label className="text-xs w-24 font-medium">Secret Value:</label>
                    <input
                      type="password"
                      placeholder="Secret value"
                      value={newSecret.value}
                      onChange={(e) => setNewSecret({ ...newSecret, value: e.target.value })}
                      className="p-1.5 flex-1 text-sm rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="flex items-center">
                    <label className="text-xs w-24 font-medium">
                      <span className="flex items-center">
                        Expiration:
                        <span className="ml-1 text-emerald-500/80" title="Cannot be changed after creation">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                      </span>
                    </label>
                    <select
                      value={newSecret.ttl}
                      onChange={(e) => setNewSecret({ ...newSecret, ttl: parseInt(e.target.value) })}
                      className="p-1.5 text-sm rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 flex-1"
                    >
                      {ttlOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={loading || !newSecret.key || !newSecret.value}
                      className={`ml-2 px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        loading || !newSecret.key || !newSecret.value
                          ? 'bg-emerald-100 text-emerald-300 cursor-not-allowed'
                          : 'bg-emerald-600 text-white hover:bg-emerald-500'
                      }`}
                    >
                      Add
                    </button>
                  </div>
                  <div className="text-xs text-stone-400">
                    Note: Expiration time cannot be changed after a secret is created.
                  </div>
                </form>
              </div>
              
              {/* Secrets List */}
              <div className="overflow-y-auto flex-grow">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Your Secrets</h3>
                  <span className="text-xs text-stone-400">{secrets.length} {secrets.length === 1 ? 'secret' : 'secrets'}</span>
                </div>
                
                {secrets.length === 0 ? (
                  <p className="text-stone-400 text-sm">No secrets found. Add one using the form above.</p>
                ) : (
                  <div className="space-y-2">
                    {secrets.map((secret) => (
                      <div key={secret.id} className="bg-stone-50 p-2 rounded-md border border-stone-200">
                        <div className="flex items-center justify-between">
                          <div className="overflow-hidden">
                            <div className="font-medium text-emerald-600 truncate pr-2" title={secret.description || 'Unknown'}>
                              {secret.description || 'Unknown'}
                            </div>
                          </div>
                          <div className="flex items-center space-x-1">
                            <span className="text-xs text-stone-400 mr-1">
                              Expires in: {expirationInfo[secret.id]?.formattedExpiry || 'Unknown'}
                              {expirationInfo[secret.id]?.isExpired && (
                                <span className="ml-1 text-red-500">EXPIRED</span>
                              )}
                            </span>
                            <button
                              onClick={() => handleDeleteSecret(secret.id, secret.description)}
                              className="text-stone-400 hover:text-red-500 p-1"
                              title="Delete secret"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex justify-between text-xs mt-1">
                          <div className="text-stone-400 truncate">
                            ID: {secret.id.substring(0, 8)}...
                          </div>
                          <div className="text-stone-400">
                            Expires: {new Date(secret.expiresAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="flex-grow">
                  <h3 className="text-sm font-medium">Import/Export Secrets (.env format)</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <label className="text-xs text-stone-600 mr-1">
                      <span className="flex items-center">
                        Expiration:
                        <span className="ml-1 text-emerald-500/80" title="Cannot be changed after creation">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                      </span>
                    </label>
                    <select
                      value={bulkTtl}
                      onChange={(e) => setBulkTtl(parseInt(e.target.value))}
                      className="text-xs p-1 rounded-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                    >
                      {ttlOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={exportSecrets}
                    className="text-xs px-2 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100"
                  >
                    Export Current
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col flex-grow">
                <div className="flex bg-blue-50 border border-blue-200 text-blue-600 px-2 py-1 rounded-t text-xs mb-0">
                  <div className="flex-grow">Format: <code>KEY=VALUE</code> (one per line). Example: <code>OPENAI_API_KEY=sk-1234...</code></div>
                </div>
                <textarea
                  value={secretsText}
                  onChange={(e) => setSecretsText(e.target.value)}
                  placeholder="# Import secrets in .env format\nAPI_KEY=your_api_key\nANOTHER_SECRET=another_value"
                  className="p-3 w-full flex-grow rounded-t-none rounded-b-md border-stone-300 bg-white text-stone-800 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 font-mono text-sm min-h-[200px]"
                />
              </div>
              
              <button
                onClick={handleBulkImport}
                disabled={loading || !secretsText.trim()}
                className={`w-full mt-3 px-4 py-2 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  loading || !secretsText.trim()
                    ? 'bg-emerald-100 text-emerald-300 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                Import Secrets
              </button>
            </div>
          )}
        </div>
        
        <div className="mt-3 flex justify-between items-center pt-2 border-t border-stone-200 text-xs">
          <div className="text-stone-400">
            Secrets automatically expire after their set time period. Expiration times cannot be changed after creation.
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1 bg-stone-100 text-stone-700 rounded hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-stone-300 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}; 
