import React, { useState, useEffect } from 'react';
import { PluginInfo, PluginConfig } from '../types';
import { getPlugins, getConfig } from '../services/api';

interface PluginParamDialogProps {
  plugin: PluginInfo | PluginConfig;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (params: Record<string, any>, interval?: number) => void;
}

export const PluginParamDialog: React.FC<PluginParamDialogProps> = ({
  plugin,
  isOpen,
  onClose,
  onAdd,
}) => {
  const [params, setParams] = useState<Record<string, any>>(
    'params' in plugin ? plugin.params : {}
  );
  const [interval, setInterval] = useState<number | undefined>(
    'interval' in plugin ? plugin.interval : undefined
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableProviders, setAvailableProviders] = useState<Array<{id: string, name: string}>>([]);
  const [availableStorage, setAvailableStorage] = useState<Array<{id: string, name: string}>>([]);

  useEffect(() => {
    // Fetch available providers and storage options when component mounts
    const fetchPluginOptions = async () => {
      try {
        // Get the active config to fetch configured ai providers and storage
        const activeConfig = await getConfig('default');
        
        // Get AI providers from config
        const providers: Array<{id: string, name: string}> = [];
        
        // Add configured AI instances 
        if (activeConfig?.ai) {
          activeConfig.ai.forEach((aiConfig, index) => {
            providers.push({ 
              id: `ai-${index}`, // This is the node ID format used in connections
              name: aiConfig.name // This is the display name
            });
          });
        }
        
        setAvailableProviders(providers);
        
        // Get storage options from config
        const storageOptions: Array<{id: string, name: string}> = [];
        
        // Add configured storage instances
        if (activeConfig?.storage) {
          activeConfig.storage.forEach((storageConfig, index) => {
            storageOptions.push({ 
              id: `storage-${index}`, // This is the node ID format used in connections
              name: storageConfig.name // This is the display name
            });
          });
        }
        
        setAvailableStorage(storageOptions);
      } catch (error) {
        console.error('Failed to fetch plugin options:', error);
      }
    };

    fetchPluginOptions();
  }, []);

  const getConstructorInterface = () => {
    if ('constructorInterface' in plugin) {
      return plugin.constructorInterface;
    }
    return undefined;
  };

  const validateConfig = (): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    const constructorInterface = getConstructorInterface();
    if (constructorInterface) {
      constructorInterface.parameters.forEach((param) => {
        if (param.required) {
          if (param.type === 'string[]' && (!params[param.name] || params[param.name].length === 0)) {
            newErrors[param.name] = 'At least one value is required';
            isValid = false;
          } else if (param.type !== 'string[]' && !params[param.name]) {
            newErrors[param.name] = 'This field is required';
            isValid = false;
          }
        }
      });
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required parameters if we have a constructor interface
    const constructorInterface = getConstructorInterface();
    if (constructorInterface) {
      const newErrors: Record<string, string> = {};
      let hasErrors = false;
      
      constructorInterface.parameters.forEach((param) => {
        if (param.required) {
          if (param.type === 'string[]') {
            if (!params[param.name] || !Array.isArray(params[param.name]) || params[param.name].length === 0) {
              newErrors[param.name] = 'This field is required';
              hasErrors = true;
            }
          } else if (!params[param.name] && params[param.name] !== false) {
            newErrors[param.name] = 'This field is required';
            hasErrors = true;
          }
        }
      });
      
      if (hasErrors) {
        setErrors(newErrors);
        return;
      }
    }
    
    // Call onAdd with params and interval
    onAdd({
      ...plugin,
      params: params
    }, interval);
  };

  const handleParamChange = (key: string, value: any) => {
    setParams(prev => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors(prev => ({ ...prev, [key]: '' }));
    }
  };

  const handleArrayChange = (key: string, value: string) => {
    const arrayValue = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    handleParamChange(key, arrayValue);
  };

  const renderConfigFields = () => {
    const constructorInterface = getConstructorInterface();
    
    // If we have a constructor interface, use it to generate fields
    if (constructorInterface) {
      return constructorInterface.parameters.map((param) => {
        const error = errors[param.name];
        const inputClasses = `w-full rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 
          ${error ? 'border-red-500' : 'border-gray-600'} bg-gray-700 text-gray-200`;

        // Special handling for provider parameters
        if (param.name === 'provider' && availableProviders.length > 0) {
          return (
            <div key={param.name} className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {param.description || 'Select Provider'}
                {param.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              <select
                value={params[param.name] || ''}
                onChange={(e) => handleParamChange(param.name, e.target.value)}
                className={inputClasses}
                required={param.required}
              >
                <option value="">Select a provider...</option>
                {availableProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
              <p className="mt-1 text-xs text-gray-400">
                Select an AI provider for this plugin
              </p>
            </div>
          );
        }

        // Special handling for storage parameters
        if (param.name === 'storage' && availableStorage.length > 0) {
          return (
            <div key={param.name} className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                {param.description || 'Select Storage'}
                {param.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              <select
                value={params[param.name] || ''}
                onChange={(e) => handleParamChange(param.name, e.target.value)}
                className={inputClasses}
                required={param.required}
              >
                <option value="">Select a storage...</option>
                {availableStorage.map((storage) => (
                  <option key={storage.id} value={storage.id}>
                    {storage.name}
                  </option>
                ))}
              </select>
              {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
              <p className="mt-1 text-xs text-gray-400">
                Select a storage option for this plugin
              </p>
            </div>
          );
        }

        // Normal parameter types
        switch (param.type) {
          case 'string[]':
            return (
              <div key={param.name} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {param.description}
                  {param.required && <span className="text-red-400 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={Array.isArray(params[param.name]) ? params[param.name].join(', ') : ''}
                  onChange={(e) => handleArrayChange(param.name, e.target.value)}
                  className={inputClasses}
                  required={param.required}
                  placeholder="Comma-separated values"
                />
                {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
                <p className="mt-1 text-xs text-gray-400">
                  Enter multiple values separated by commas
                </p>
              </div>
            );
          case 'string':
            return (
              <div key={param.name} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {param.description}
                  {param.required && <span className="text-red-400 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={params[param.name] || ''}
                  onChange={(e) => handleParamChange(param.name, e.target.value)}
                  className={inputClasses}
                  required={param.required}
                />
                {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
              </div>
            );
          case 'number':
            return (
              <div key={param.name} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {param.description}
                  {param.required && <span className="text-red-400 ml-1">*</span>}
                </label>
                <input
                  type="number"
                  value={params[param.name] || ''}
                  onChange={(e) => handleParamChange(param.name, e.target.value ? Number(e.target.value) : '')}
                  className={inputClasses}
                  required={param.required}
                />
                {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
              </div>
            );
          case 'boolean':
            return (
              <div key={param.name} className="mb-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={params[param.name] || false}
                    onChange={(e) => handleParamChange(param.name, e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-indigo-500 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-800"
                  />
                  <span className="ml-2 text-sm text-gray-300">{param.description}</span>
                </label>
              </div>
            );
          default:
            return null;
        }
      });
    }
    
    // No constructor interface, but we have existing params - show a generic editor
    if ('params' in plugin && plugin.params && Object.keys(plugin.params).length > 0) {
      return (
        <div>
          <h4 className="text-md font-medium text-gray-200 mb-4">Edit Parameters</h4>
          {Object.entries(params).map(([key, value]) => {
            const inputClasses = "w-full rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500";
            
            // Special handling for provider params
            if (key === 'provider' && availableProviders.length > 0) {
              return (
                <div key={key} className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Provider
                  </label>
                  <select
                    value={value || ''}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    className={inputClasses}
                  >
                    <option value="">Select a provider...</option>
                    {availableProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    Select an AI provider for this plugin
                  </p>
                </div>
              );
            }
            
            // Special handling for storage params
            if (key === 'storage' && availableStorage.length > 0) {
              return (
                <div key={key} className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Storage
                  </label>
                  <select
                    value={value || ''}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    className={inputClasses}
                  >
                    <option value="">Select a storage...</option>
                    {availableStorage.map((storage) => (
                      <option key={storage.id} value={storage.id}>
                        {storage.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    Select a storage option for this plugin
                  </p>
                </div>
              );
            }
            
            // Determine the input type based on the value type
            if (typeof value === 'boolean') {
              return (
                <div key={key} className="mb-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={value || false}
                      onChange={(e) => handleParamChange(key, e.target.checked)}
                      className="rounded border-gray-600 bg-gray-700 text-indigo-500 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-800"
                    />
                    <span className="ml-2 text-sm text-gray-300">{key}</span>
                  </label>
                </div>
              );
            } else if (typeof value === 'number') {
              return (
                <div key={key} className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {key}
                  </label>
                  <input
                    type="number"
                    value={value || ''}
                    onChange={(e) => handleParamChange(key, e.target.value ? Number(e.target.value) : '')}
                    className={inputClasses}
                  />
                </div>
              );
            } else if (Array.isArray(value)) {
              return (
                <div key={key} className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {key}
                  </label>
                  <input
                    type="text"
                    value={Array.isArray(value) ? value.join(', ') : ''}
                    onChange={(e) => handleArrayChange(key, e.target.value)}
                    className={inputClasses}
                    placeholder="Comma-separated values"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Enter multiple values separated by commas
                  </p>
                </div>
              );
            } else {
              return (
                <div key={key} className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {key}
                  </label>
                  <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => handleParamChange(key, e.target.value)}
                    className={inputClasses}
                  />
                </div>
              );
            }
          })}
          
          {/* Add new parameter */}
          <div className="mt-6 border-t border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-gray-200 mb-2">Add New Parameter</h4>
            <div className="flex space-x-2">
              <input
                type="text"
                id="newParamKey"
                placeholder="Parameter Name"
                className="w-1/2 rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <input
                type="text"
                id="newParamValue"
                placeholder="Parameter Value"
                className="w-1/2 rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => {
                  const keyInput = document.getElementById('newParamKey') as HTMLInputElement;
                  const valueInput = document.getElementById('newParamValue') as HTMLInputElement;
                  
                  if (keyInput && valueInput && keyInput.value) {
                    handleParamChange(keyInput.value, valueInput.value);
                    keyInput.value = '';
                    valueInput.value = '';
                  }
                }}
                className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    // No constructor interface and no existing params
    return (
      <div className="my-4">
        <p className="text-gray-400 italic">No parameters available for this plugin.</p>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 text-gray-200">
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-100">{plugin.name} Configuration</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200"
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {'description' in plugin ? plugin.description : 'Configure node parameters'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4">
          {renderConfigFields()}

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Interval (milliseconds)
            </label>
            <input
              type="number"
              value={interval || ''}
              onChange={(e) => setInterval(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full rounded-md bg-gray-700 border-gray-600 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              placeholder="Optional"
            />
            <p className="mt-1 text-xs text-gray-400">
              Leave empty for no interval
            </p>
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 border border-gray-600 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}; 