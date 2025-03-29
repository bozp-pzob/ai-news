import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PluginInfo, PluginConfig } from '../types';
import { getPlugins, getConfig } from '../services/api';
import { configStateManager } from '../services/ConfigStateManager';

interface PluginParamDialogProps {
  plugin: PluginInfo | PluginConfig;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (plugin: any) => void;
}

export const PluginParamDialog: React.FC<PluginParamDialogProps> = ({
  plugin,
  isOpen,
  onClose,
  onAdd,
}) => {
  console.log("PluginParamDialog rendered with plugin:", plugin);

  // Track whether this is the initial mount
  const [isMounted, setIsMounted] = useState(false);
  
  // Create a ref to track if params were manually edited
  const manuallyEdited = useRef<Set<string>>(new Set());
  
  // Initialize params from plugin or ConfigStateManager
  const [params, setParams] = useState<Record<string, any>>(() => {
    // If plugin has an ID, try to get the latest state from ConfigStateManager
    if ('id' in plugin && plugin.id) {
      const latestNode = configStateManager.findNodeById(plugin.id);
      if (latestNode && latestNode.params) {
        console.log('🔄 Initializing params from ConfigStateManager:', latestNode.params);
        return JSON.parse(JSON.stringify(latestNode.params));
      }
    }
    
    // Fallback to plugin params
    console.log('🔄 Initializing params from plugin prop:', 'params' in plugin ? plugin.params : {});
    return 'params' in plugin ? JSON.parse(JSON.stringify(plugin.params)) : {};
  });
  
  const [interval, setInterval] = useState<number | undefined>(
    'interval' in plugin ? plugin.interval : undefined
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableProviders, setAvailableProviders] = useState<Array<{id: string, name: string}>>([]);
  const [availableStorage, setAvailableStorage] = useState<Array<{id: string, name: string}>>([]);

  // On initial mount and when dialog opens, initialize from ConfigStateManager
  useEffect(() => {
    if (!isOpen) return;
    
    console.log('🔄 Dialog opened, initializing state from ConfigStateManager');
    
    // First, force ConfigStateManager to broadcast its current state
    configStateManager.forceSync();
    
    // Then set up multiple refresh attempts to ensure we have the latest state
    const refreshAttempts = [10, 50, 100, 300, 500];
    const timeoutIds: NodeJS.Timeout[] = [];
    
    // Execute refreshes at different time intervals
    refreshAttempts.forEach(delay => {
      const timeoutId = setTimeout(() => {
        console.log(`🔄 Refresh attempt at ${delay}ms delay`);
        refreshFromStateManager();
      }, delay);
      
      timeoutIds.push(timeoutId);
    });
    
    setIsMounted(true);
    
    // Clean up all timeouts if component unmounts
    return () => {
      timeoutIds.forEach(id => clearTimeout(id));
    };
  }, [isOpen, 'id' in plugin ? plugin.id : null]);

  // Helper function to safely get plugin ID
  const getPluginId = useCallback((): string | undefined => {
    return 'id' in plugin ? plugin.id : undefined;
  }, [plugin]);

  // Helper function to safely get plugin params
  const getPluginParams = useCallback((): Record<string, any> => {
    return 'params' in plugin ? plugin.params : {};
  }, [plugin]);

  // Helper function to refresh data from ConfigStateManager
  const refreshFromStateManager = useCallback(() => {
    const pluginId = getPluginId();
    if (!pluginId || !isOpen) return;
    
    try {
      // Get the latest node state directly from ConfigStateManager
      const latestNode = configStateManager.findNodeById(pluginId);
      if (latestNode && latestNode.params) {
        console.log('🔄 Refreshing params from ConfigStateManager:', latestNode.params);
        
        // Create deep copies for comparison
        const currentParamsJson = JSON.stringify(params);
        const newParamsJson = JSON.stringify(latestNode.params);
        
        if (currentParamsJson !== newParamsJson) {
          console.log('🔄 Params changed, determining which values to update');
          
          // Create a deep copy of the latest params
          const updatedParams = JSON.parse(JSON.stringify(latestNode.params));
          
          // For each key, only update if it hasn't been manually edited
          const editedKeys = Array.from(manuallyEdited.current);
          console.log('🔄 Manually edited keys that will be preserved:', editedKeys);
          
          // For each edited key, keep the user's value
          editedKeys.forEach(key => {
            if (key in params) {
              updatedParams[key] = params[key];
            }
          });
          
          console.log('🔄 Final merged params:', updatedParams);
          setParams(updatedParams);
        } else {
          console.log('🔄 Params unchanged, keeping current state');
        }
      } else {
        console.log('🔄 Node not found in ConfigStateManager or has no params');
      }
      
      // Also refresh provider and storage options
      const config = configStateManager.getConfig();
      
      // Refresh providers
      if (config.ai) {
        const providers = config.ai.map(ai => ({ id: ai.name, name: ai.name }));
        setAvailableProviders(providers);
      }
      
      // Refresh storage options
      if (config.storage) {
        const storage = config.storage.map(s => ({ id: s.name, name: s.name }));
        setAvailableStorage(storage);
      }
    } catch (error) {
      console.error('Error refreshing from ConfigStateManager:', error);
    }
  }, [isOpen, getPluginId, params]);

  // Set up periodic refresh to ensure we're always up to date
  useEffect(() => {
    const pluginId = getPluginId();
    if (!isOpen || !pluginId) return;
    
    console.log('🔄 Setting up periodic refresh for dialog');
    
    // Force a refresh immediately
    refreshFromStateManager();
    
    // Then refresh periodically to ensure we stay in sync
    const intervalId = window.setInterval(() => {
      console.log('🔄 Periodic refresh from ConfigStateManager');
      refreshFromStateManager();
    }, 2000); // Reduced frequency to every 2 seconds to lower overhead
    
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOpen, getPluginId, refreshFromStateManager]);

  // Subscribe to all relevant ConfigStateManager events
  useEffect(() => {
    if (!isOpen) return;
    
    console.log('🔄 Setting up ConfigStateManager subscriptions');
    
    // Subscribe to config updates for providers and storage
    const unsubscribeConfig = configStateManager.subscribe('config-updated', (updatedConfig) => {
      if (!updatedConfig) return;
      
      console.log('🔄 Config updated event received');
      
      // Get AI providers from config
      const providers: Array<{id: string, name: string}> = [];
      if (updatedConfig.ai) {
        updatedConfig.ai.forEach((aiConfig: {name: string}) => {
          providers.push({ id: aiConfig.name, name: aiConfig.name });
        });
      }
      setAvailableProviders(providers);
      
      // Get storage options from config
      const storageOptions: Array<{id: string, name: string}> = [];
      if (updatedConfig.storage) {
        updatedConfig.storage.forEach((storageConfig: {name: string}) => {
          storageOptions.push({ id: storageConfig.name, name: storageConfig.name });
        });
      }
      setAvailableStorage(storageOptions);
      
      // We don't need to refresh state here - just update providers/storage
    });
    
    // Subscribe to plugin-specific updates
    let unsubscribePluginUpdated = () => {};
    let unsubscribeConnections = () => {};
    let unsubscribeNodes = () => {};
    
    const pluginId = getPluginId();
    if (pluginId) {
      // Listen for plugin updates
      unsubscribePluginUpdated = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
        if (!updatedPlugin || updatedPlugin.id !== pluginId) return;
        console.log('🔄 Plugin updated event received for this plugin:', updatedPlugin);
        refreshFromStateManager();
      });
      
      // Listen for connection changes - but only refresh if this plugin changed
      unsubscribeConnections = configStateManager.subscribe('connections-updated', () => {
        console.log('🔄 Connections updated event received');
        // We'll only refresh if a connection affects this plugin's params (provider/storage)
        // This happens automatically via plugin-updated events
      });
      
      // Listen for node changes
      unsubscribeNodes = configStateManager.subscribe('nodes-updated', () => {
        console.log('🔄 Nodes updated event received');
        // Don't refresh automatically - this might cause loops
        // We'll only refresh if the node's params changed via plugin-updated events
      });
    }
    
    // Clean up all subscriptions
    return () => {
      unsubscribeConfig();
      unsubscribePluginUpdated();
      unsubscribeConnections();
      unsubscribeNodes();
    };
  }, [isOpen, getPluginId, refreshFromStateManager]);

  // Fetch initial data from API if needed
  useEffect(() => {
    if (!isOpen || !isMounted) return;
    
    // Initial fetch from API
    const fetchPluginOptions = async () => {
      try {
        console.log("Starting fetchPluginOptions...");
        
        // Get the active config
        console.log("About to fetch config...");
        let activeConfig;
        try {
          activeConfig = await getConfig('sources');
          console.log("Active config response:", activeConfig);
        } catch (err) {
          console.error("Error fetching config, using fallback:", err);
          // Use current config from state manager as fallback
          activeConfig = configStateManager.getConfig();
          console.log("Using state manager config as fallback:", activeConfig);
        }
        
        // Get AI providers from config
        const providers: Array<{id: string, name: string}> = [];
        if (activeConfig?.ai) {
          console.log("Found AI providers in config:", activeConfig.ai);
          activeConfig.ai.forEach((aiConfig) => {
            providers.push({ 
              id: aiConfig.name,
              name: aiConfig.name
            });
          });
        }
        
        // Always add known providers as a backup if none found
        if (providers.length === 0) {
          const knownProviders = ["summaryOpenAiProvider", "miniOpenAiProvider"];
          knownProviders.forEach(name => {
            providers.push({
              id: name,
              name: name
            });
          });
        }
        
        setAvailableProviders(prev => 
          prev.length > 0 ? prev : providers
        );
        
        // Get storage options from config
        const storageOptions: Array<{id: string, name: string}> = [];
        if (activeConfig?.storage) {
          console.log("Found storage options in config:", activeConfig.storage);
          activeConfig.storage.forEach((storageConfig) => {
            storageOptions.push({ 
              id: storageConfig.name,
              name: storageConfig.name
            });
          });
        }
        
        // Always add known storage options as a backup if none found
        if (storageOptions.length === 0) {
          const knownStorage = ["SQLiteStorage"];
          knownStorage.forEach(name => {
            storageOptions.push({
              id: name,
              name: name
            });
          });
        }
        
        setAvailableStorage(prev => 
          prev.length > 0 ? prev : storageOptions
        );
      } catch (error) {
        console.error('Failed to fetch plugin options:', error);
      }
    };

    fetchPluginOptions();
  }, [isOpen, isMounted]);

  // Explicitly reset the manually edited keys when the plugin changes
  useEffect(() => {
    console.log('🔄 Plugin changed, resetting manually edited keys');
    manuallyEdited.current.clear();
    
    const pluginId = getPluginId();
    // When the plugin changes, we need to fetch the most up-to-date version
    if (isOpen && pluginId) {
      console.log('🔄 Getting latest state for new plugin:', pluginId);
      
      // Force ConfigStateManager to sync all data
      configStateManager.forceSync();
      
      // Small delay to ensure sync is complete
      setTimeout(() => {
        // Get the node with this ID from the ConfigStateManager
        const latestNode = configStateManager.findNodeById(pluginId);
        if (latestNode && latestNode.params) {
          console.log('🔄 Found latest node state for new plugin:', latestNode.params);
          // Update with a deep copy of the latest params
          setParams(JSON.parse(JSON.stringify(latestNode.params)));
        } else {
          // If node not found, use params from the plugin prop
          const pluginParams = getPluginParams();
          console.log('🔄 Using params from plugin prop for new plugin:', pluginParams);
          setParams(JSON.parse(JSON.stringify(pluginParams)));
        }
      }, 100);
    }
  }, [isOpen, getPluginId, getPluginParams]);

  // Update provider and storage values when options change
  useEffect(() => {
    // If we have providers and storage, make sure the selected ones are in the options
    if (availableProviders.length > 0 && params.provider) {
      const provider = availableProviders.find(p => p.name === params.provider);
      if (!provider && availableProviders[0]) {
        // If selected provider not found, select the first available
        console.log(`Provider ${params.provider} not found, selecting ${availableProviders[0].name}`);
        setParams(prev => ({ ...prev, provider: availableProviders[0].name }));
      }
    }
    
    if (availableStorage.length > 0 && params.storage) {
      const storage = availableStorage.find(s => s.name === params.storage);
      if (!storage && availableStorage[0]) {
        // If selected storage not found, select the first available
        console.log(`Storage ${params.storage} not found, selecting ${availableStorage[0].name}`);
        setParams(prev => ({ ...prev, storage: availableStorage[0].name }));
      }
    }
  }, [availableProviders, availableStorage, params.provider, params.storage]);

  const handleSubmit = async (e: React.FormEvent) => {
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
    
    // Create a new plugin object with the updated params
    const updatedPlugin = {
      ...plugin,
      params: { ...params },
      interval: interval
    };
    
    console.log('💾 Saving plugin with params:', JSON.stringify(updatedPlugin.params));
    
    // Call onAdd with the complete updated plugin object
    onAdd(updatedPlugin);
  };

  // Get the constructor interface if available
  const getConstructorInterface = () => {
    if ('constructorInterface' in plugin) {
      return plugin.constructorInterface;
    }
    return null;
  };

  const isRequired = (key: string) => {
    const constructorInterface = getConstructorInterface();
    if (constructorInterface) {
      const param = constructorInterface.parameters.find(p => p.name === key);
      return param ? param.required : false;
    }
    return false;
  };

  const handleParamChange = (key: string, value: any) => {
    console.log(`🧩 Parameter ${key} changed to:`, value);
    
    // Mark this key as manually edited
    manuallyEdited.current.add(key);
    
    // Special handling for provider or storage changes
    if (key === 'provider' || key === 'storage') {
      console.log(`🧩 IMPORTANT: ${key} selection changed to: ${value}`);
    }
    
    setParams(prev => {
      const updated = { ...prev, [key]: value };
      console.log("🧩 Updated params:", updated);
      return updated;
    });
    
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

  const renderProviderSelect = (key: string, value: any) => {
    const inputClasses = "w-full rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500";
    return (
      <div key={key} className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Provider
        </label>
        <select
          value={params[key] || ''}
          name="provider"
          onChange={(e) => {
            const selectedValue = e.target.value;
            console.log(`🧩 Provider selection changed to: ${selectedValue}`);
            
            // Store the selected provider value in params
            handleParamChange(key, selectedValue);
          }}
          className={inputClasses}
        >
          <option value="">Select a provider...</option>
          {availableProviders.length > 0 ? (
            availableProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))
          ) : (
            <option value="" disabled>No providers available</option>
          )}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Select an AI provider for this plugin
        </p>
      </div>
    );
  };

  const renderStorageSelect = (key: string, value: any) => {
    const inputClasses = "w-full rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500";
    return (
      <div key={key} className="mb-4">
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Storage
        </label>
        <select
          value={params[key] || ''}
          name="storage"
          onChange={(e) => {
            console.log("🧩 Selected storage:", e.target.value);
            handleParamChange(key, e.target.value);
          }}
          className={inputClasses}
        >
          <option value="">Select a storage...</option>
          {availableStorage.length > 0 ? (
            availableStorage.map((storage) => (
              <option key={storage.id} value={storage.id}>
                {storage.name}
              </option>
            ))
          ) : (
            <option value="" disabled>No storage options available</option>
          )}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Select a storage option for this plugin
        </p>
      </div>
    );
  };

  const renderConfigFields = () => {
    console.log("Rendering config fields");
    console.log("Plugin:", plugin);
    console.log("Params:", params);
    
    if (!params) {
      console.error("Params object is null or undefined");
      return <div>No parameters available</div>;
    }
    
    // Use the constructor interface if available
    const constructorInterface = getConstructorInterface();
              const inputClasses = "w-full rounded-md border-gray-600 bg-gray-700 text-gray-200 shadow-sm focus:border-indigo-500 focus:ring-indigo-500";
              
    if (constructorInterface) {
                return (
        <div className="space-y-4">
          {constructorInterface.parameters.map((param) => (
            <div key={param.name} className="mb-4">
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                {param.name}
                {param.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
              
              {param.type === 'string' && (
                    <input
                      type="text"
                  value={params[param.name] || ''}
                  onChange={(e) => handleParamChange(param.name, e.target.value)}
                      className={inputClasses}
                  required={param.required}
                />
              )}
              
              {param.type === 'number' && (
              <input
                type="number"
                  value={params[param.name] || ''}
                  onChange={(e) => handleParamChange(param.name, e.target.value ? Number(e.target.value) : '')}
                  className={inputClasses}
                  required={param.required}
                />
              )}
              
              {param.type === 'boolean' && (
                <div className="flex items-center">
                <input
                    type="checkbox"
                    checked={!!params[param.name]}
                    onChange={(e) => handleParamChange(param.name, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="ml-2 text-sm text-gray-300">{param.name}</span>
              </div>
              )}
              
              {param.type === 'string[]' && (
                <>
                <input
                  type="text"
                  value={Array.isArray(params[param.name]) ? params[param.name].join(', ') : ''}
                    onChange={(e) => handleArrayChange(param.name, e.target.value)}
                  className={inputClasses}
                    required={param.required}
                  placeholder="Comma-separated values"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Enter multiple values separated by commas
                </p>
                </>
              )}
              
              {errors[param.name] && (
                <p className="mt-1 text-xs text-red-500">{errors[param.name]}</p>
              )}
              
              <p className="mt-1 text-xs text-gray-400">
                  {param.description}
              </p>
              </div>
          ))}
              </div>
            );
    }
    
    // If we get here, use the params object to render fields
    if (Object.keys(params).length > 0) {
      return (
        <div className="space-y-4">
          {Object.entries(params).map(([key, value]) => {
            if (key === 'provider') {
              return renderProviderSelect(key, value);
            }
            
            if (key === 'storage') {
              return renderStorageSelect(key, value);
            }
            
            if (typeof value === 'boolean') {
              return (
                <div key={key} className="mb-4 flex items-center">
                    <input
                      type="checkbox"
                    checked={!!value}
                    onChange={(e) => handleParamChange(key, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label className="ml-2 text-sm text-gray-300">
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
                    onChange={(e) => {
                      console.log(`Setting numeric parameter ${key}:`, e.target.value);
                      const numValue = e.target.value ? Number(e.target.value) : '';
                      handleParamChange(key, numValue);
                    }}
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
                    onChange={(e) => {
                      handleArrayChange(key, e.target.value);
                    }}
                    className={inputClasses}
                    required={isRequired(key)}
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
                    value={params[key] || ''}
                    onChange={(e) => {
                      handleParamChange(key, e.target.value);
                    }}
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
                    const key = keyInput.value;
                    const value = valueInput.value;
                    handleParamChange(key, value);
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

  // Function to force a refresh from ConfigStateManager
  const forceRefreshFromStateManager = () => {
    console.log('🔄 Forcing refresh from ConfigStateManager');
    
    // Reset manually edited keys
    manuallyEdited.current.clear();
    
    // First force the ConfigStateManager to sync
    configStateManager.forceSync();
    
    // Then wait a bit to ensure sync is complete
    setTimeout(() => {
      const pluginId = getPluginId();
      if (pluginId) {
        const latestNode = configStateManager.findNodeById(pluginId);
        if (latestNode && latestNode.params) {
          console.log('🔄 Found latest node state:', latestNode.params);
          // Do a deep copy to ensure no reference issues
          setParams(JSON.parse(JSON.stringify(latestNode.params)));
        }
      }
    }, 100);
  };

  // Add a button to refresh state
  const renderRefreshButton = () => {
    const pluginId = getPluginId();
    if (!pluginId) return null;
    
    return (
      <button
        type="button"
        onClick={forceRefreshFromStateManager}
        className="px-3 py-1 text-sm font-medium text-gray-200 bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 absolute top-4 right-16"
        title="Refresh parameters from graph state"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 text-gray-200">
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-100">{plugin.name} Configuration</h3>
            <div className="flex items-center">
              {renderRefreshButton()}
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
          </div>
          <p className="mt-1 text-sm text-gray-400">
            {'description' in plugin ? plugin.description : 'Configure node parameters'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4">
          {renderConfigFields()}

          {/* Only show interval field if not already shown in custom form */}
          {'params' in plugin && plugin.params && ('provider' in plugin.params || 'storage' in plugin.params) ? null : (
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
          )}

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