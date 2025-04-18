import React, { useState, useEffect } from 'react';
import { PluginInfo, PluginConfig } from '../types';
import { configStateManager } from '../services/ConfigStateManager';
import { pluginRegistry } from '../services/PluginRegistry';

interface PluginParamDialogProps {
  plugin: PluginInfo | PluginConfig;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (plugin: any) => void;
}

// Determine if a plugin type supports provider or storage connections
const supportsProviderStorage = (pluginType: string): { provider: boolean, storage: boolean } => {
  // Source, enricher, and generator nodes can have provider and storage inputs
  if (pluginType === 'source' || pluginType === 'enricher' || pluginType === 'generator') {
    return { provider: true, storage: true };
  }
  
  // Other types don't support provider/storage connections
  return { provider: false, storage: false };
};

export const PluginParamDialog: React.FC<PluginParamDialogProps> = ({
  plugin,
  isOpen,
  onClose,
  onAdd,
}) => {
  // Store plugin schema from registry
  const [pluginSchema, setPluginSchema] = useState<PluginInfo | null>(null);
  
  // Store editable params
  const [params, setParams] = useState<Record<string, any>>(
    'params' in plugin ? { ...plugin.params } : {}
  );
  
  // Store custom name for the plugin
  const [customName, setCustomName] = useState<string>(
    'name' in plugin ? plugin.name : ''
  );
  
  // Store interval for source and generator plugins
  const [interval, setInterval] = useState<number | undefined>(
    'interval' in plugin ? plugin.interval : 60000
  );

  // Load available providers and storage
  const [availableProviders, setAvailableProviders] = useState<{id: string, name: string}[]>([]);
  const [availableStorage, setAvailableStorage] = useState<{id: string, name: string}[]>([]);

  // Get plugin ID helper
  const getPluginId = (): string | undefined => {
    return 'id' in plugin ? plugin.id : undefined;
  };

  // Load plugin schema from registry when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    
    // Get plugin name and type
    let pluginName: string | undefined;
    let pluginType: string | undefined;
    
    if ('name' in plugin) {
      pluginName = plugin.name;
      pluginType = 'type' in plugin ? plugin.type : undefined;
      
      // Handle name mismatches between config names and actual plugin names
      // This mapping helps correct common mismatches
      const pluginNameMapping: Record<string, string> = {
        'topicEnricher': 'AiTopicsEnricher',
        'imageEnricher': 'AiImageEnricher',
        // Add more mappings as needed
      };
      
      // Check if we have a mapping for this plugin name
      if (pluginNameMapping[pluginName]) {
        console.log(`Mapping plugin name from "${pluginName}" to "${pluginNameMapping[pluginName]}"`);
        pluginName = pluginNameMapping[pluginName];
      }
    }
    
    if (pluginName) {
      console.log(`Looking for plugin schema for ${pluginName}, type: ${pluginType}`);
      
      // Try to get schema from registry
      const pluginInfo = pluginRegistry.findPlugin(pluginName, pluginType);
      
      if (pluginInfo) {
        console.log('Found plugin schema:', pluginInfo);
        
        // Log the constructor interface to debug
        if (pluginInfo.constructorInterface) {
          console.log('Constructor interface:', pluginInfo.constructorInterface);
        } else {
          console.log('No constructor interface found in plugin schema');
        }
        
        setPluginSchema(pluginInfo);
      } else {
        console.log('Plugin schema not found, attempting to load plugins');
        
        // If no exact match found, try getting all plugins and fuzzy matching
        const allPlugins = pluginRegistry.getPlugins();
        let foundPlugin = null;
        
        if (Object.keys(allPlugins).length > 0) {
          console.log('Trying fuzzy matching with available plugins');
          
          // Check each category of plugins
          for (const category in allPlugins) {
            // Only check the same category/type if specified
            if (pluginType && category !== pluginType) continue;
            
            // Check each plugin in this category
            for (const p of allPlugins[category]) {
              // Try multiple ways to match:
              // 1. Check if plugin name includes our search term
              // 2. Check if our search term includes plugin name
              if (p.name.toLowerCase().includes(pluginName.toLowerCase()) || 
                  pluginName.toLowerCase().includes(p.name.toLowerCase())) {
                console.log(`Found potential match: ${p.name}`);
                foundPlugin = p;
                break;
              }
            }
            
            if (foundPlugin) break;
          }
          
          if (foundPlugin) {
            console.log('Using fuzzy-matched plugin:', foundPlugin);
            setPluginSchema(foundPlugin);
          }
        }
        
        // Load plugins if not already loaded
        if (!pluginRegistry.isPluginsLoaded()) {
          console.log('Loading plugins from registry');
          
          // Subscribe to registry updates
          const unsubscribe = pluginRegistry.subscribe(() => {
            if (pluginName) {
              // Try exact match first
              let updatedPluginInfo = pluginRegistry.findPlugin(pluginName, pluginType);
              
              // If no exact match, try fuzzy matching
              if (!updatedPluginInfo) {
                const allUpdatedPlugins = pluginRegistry.getPlugins();
                
                // Check each category of plugins
                for (const category in allUpdatedPlugins) {
                  // Only check the same category/type if specified
                  if (pluginType && category !== pluginType) continue;
                  
                  // Check each plugin in this category
                  for (const p of allUpdatedPlugins[category]) {
                    // Try multiple ways to match
                    if (p.name.toLowerCase().includes(pluginName.toLowerCase()) || 
                        pluginName.toLowerCase().includes(p.name.toLowerCase())) {
                      console.log(`Found potential match after loading: ${p.name}`);
                      updatedPluginInfo = p;
                      break;
                    }
                  }
                  
                  if (updatedPluginInfo) break;
                }
              }
              
              if (updatedPluginInfo) {
                console.log('Found plugin after registry update:', updatedPluginInfo);
                setPluginSchema(updatedPluginInfo);
              }
            }
          });
          
          // Trigger plugin loading
          pluginRegistry.loadPlugins();
          
          return () => unsubscribe();
        }
      }
    }
  }, [isOpen, plugin]);

  // Load params from ConfigStateManager if plugin has an ID, but preserve constructorInterface parameters
  useEffect(() => {
    if (!isOpen) return;
    
    const pluginId = getPluginId();
    if (pluginId) {
      const node = configStateManager.findNodeById(pluginId);
      if (node && node.params) {
        console.log('Loaded params from node:', node.params);
        
        // Initialize empty parameters for all constructorInterface parameters
        const initializedParams = { ...node.params };
        
        setParams(initializedParams);
      }
    }
  }, [isOpen, plugin]);

  // Load available providers and storage from ConfigStateManager
  useEffect(() => {
    if (!isOpen) return;
    
    const config = configStateManager.getConfig();
    
    // Load providers
    if (config.ai) {
      const providers = config.ai.map(ai => ({ id: ai.name, name: ai.name }));
      setAvailableProviders(providers);
    }
    
    // Load storage
    if (config.storage) {
      const storage = config.storage.map(s => ({ id: s.name, name: s.name }));
      setAvailableStorage(storage);
    }
  }, [isOpen]);

  // Initialize defaults when plugin schema changes
  useEffect(() => {
    if (!pluginSchema || !pluginSchema.constructorInterface) return;
    
    console.log('Initializing params from constructorInterface');
    
    // Get constructor parameters from schema
    const constructorParams = pluginSchema.constructorInterface.parameters;
    
    // Create a new parameters object with default values for missing fields
    setParams(currentParams => {
      const updatedParams = { ...currentParams };
      
      // Initialize any missing parameters with appropriate values
      constructorParams.forEach(param => {
        if (updatedParams[param.name] === undefined) {
          console.log(`Initializing missing parameter: ${param.name}, required: ${param.required}`);
          
          // Set appropriate default value based on type
          if (param.type === 'boolean') {
            updatedParams[param.name] = false;
          } else if (param.type === 'number') {
            // For required number fields, use 0 as default instead of empty string
            updatedParams[param.name] = param.required ? 0 : '';
          } else if (param.type === 'string[]') {
            updatedParams[param.name] = [];
          } else {
            // For required fields, use a placeholder to indicate it's required
            updatedParams[param.name] = param.required ? '' : '';
          }
        } else if (param.required) {
          // Ensure required fields don't have empty values
          if (
            updatedParams[param.name] === '' || 
            updatedParams[param.name] === null || 
            (Array.isArray(updatedParams[param.name]) && updatedParams[param.name].length === 0)
          ) {
            console.log(`Ensuring non-empty value for required parameter: ${param.name}`);
            if (param.type === 'boolean') {
              updatedParams[param.name] = false;
            } else if (param.type === 'number') {
              updatedParams[param.name] = 0;
            } else if (param.type === 'string[]') {
              // Keep empty for UI indication that it needs to be filled
              updatedParams[param.name] = [];
            } else {
              // Keep empty string for UI indication that it needs to be filled
              updatedParams[param.name] = '';
            }
          }
        }
      });
      
      return updatedParams;
    });
  }, [pluginSchema]);

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Get constructor interface to check for required fields
    const constructorInterface = pluginSchema?.constructorInterface || 
                               ('constructorInterface' in plugin ? plugin.constructorInterface : null);
    
    // Validate required fields
    if (constructorInterface) {
      const requiredMissing = constructorInterface.parameters
        .filter(param => param.required)
        .some(param => {
          const value = params[param.name];
          // Check if value is missing, empty string, or empty array
          return value === undefined || 
                 value === null || 
                 value === '' || 
                 (Array.isArray(value) && value.length === 0);
        });
      
      if (requiredMissing) {
        alert("Please fill in all required fields marked with *");
        return;
      }
    }
    
    // Create updated plugin with new params and custom name
    const updatedPlugin = {
      ...plugin,
      name: customName,
      params: { ...params },
      interval
    };
    
    // Keep schema info in the plugin if available
    if (pluginSchema) {
      if (pluginSchema.configSchema) {
        (updatedPlugin as any).configSchema = pluginSchema.configSchema;
      }
      if (pluginSchema.constructorInterface) {
        (updatedPlugin as any).constructorInterface = pluginSchema.constructorInterface;
      }
      if (pluginSchema.description) {
        (updatedPlugin as any).description = pluginSchema.description;
      }
    }
    
    console.log('Saving plugin with params:', updatedPlugin);
    
    // Call onAdd callback
    onAdd(updatedPlugin);
    
    // Close dialog
    onClose();
  };

  // Handle param change
  const handleParamChange = (key: string, value: any) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // Handle string array change (comma-separated values)
  const handleArrayChange = (key: string, value: string) => {
    const arrayValue = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    handleParamChange(key, arrayValue);
  };

  // Render form fields based on plugin schema
  const renderConfigFields = () => {
    // Determine plugin type
    let pluginType = '';
    if ('type' in plugin) {
      pluginType = plugin.type;
    } else {
      const pluginId = getPluginId();
      if (pluginId) {
        const idParts = pluginId.split('-');
        pluginType = idParts[0] || '';
      }
    }
    
    // Get constructor interface from plugin or schema
    const constructorInterface = pluginSchema?.constructorInterface || 
                               ('constructorInterface' in plugin ? plugin.constructorInterface : null);
    
    // CSS classes for inputs
    const inputClasses = "p-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500";
    
    // Debug logging to see the constructor interface and params
    console.log('Current params:', params);
    if (constructorInterface) {
      console.log('Rendering fields from constructor interface:', constructorInterface.parameters);
    } else {
      console.log('No constructor interface available to render fields from');
    }
    
    // Check if plugin has provider/storage parameters in constructor interface
    const hasProviderParameter = constructorInterface?.parameters.some(param => param.name === 'provider') ?? false;
    const isProviderRequired = constructorInterface?.parameters.some(
      param => param.name === 'provider' && param.required
    ) ?? false;
    
    const hasStorageParameter = constructorInterface?.parameters.some(param => param.name === 'storage') ?? false;
    const isStorageRequired = constructorInterface?.parameters.some(
      param => param.name === 'storage' && param.required
    ) ?? false;
    
    return (
      <div className="space-y-4">
        {/* Only render provider field if it's explicitly in the constructor interface */}
        {hasProviderParameter && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Provider
              {isProviderRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={params.provider || ''}
              name="provider"
              onChange={(e) => handleParamChange('provider', e.target.value)}
              className="py-2 px-1 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
              required={isProviderRequired}
            >
              <option value="">No provider selected</option>
              {availableProviders.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Select an AI provider for this plugin
            </p>
          </div>
        )}
        
        {/* Only render storage field if it's explicitly in the constructor interface */}
        {hasStorageParameter && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Storage
              {isStorageRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={params.storage || ''}
              name="storage"
              onChange={(e) => handleParamChange('storage', e.target.value)}
              className="w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
              required={isStorageRequired}
            >
              <option value="">No storage selected</option>
              {availableStorage.map(storage => (
                <option key={storage.id} value={storage.id}>
                  {storage.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Select a storage option for this plugin
            </p>
          </div>
        )}
        
        {/* Render constructor interface parameters */}
        {constructorInterface && constructorInterface.parameters.map(param => {
          const key = param.name;
          
          // Skip provider and storage fields (handled separately)
          if ((key === 'provider' && hasProviderParameter) || 
              (key === 'storage' && hasStorageParameter)) {
            return null;
          }
          
          console.log(`Rendering parameter: ${key}, type: ${param.type}, current value: ${params[key]}`);
          
          // Render different input types based on parameter type
          if (param.type === 'boolean') {
            return (
              <div key={key} className="mb-4 flex items-center">
                <input
                  type="checkbox"
                  checked={!!params[key]}
                  onChange={(e) => handleParamChange(key, e.target.checked)}
                  className="p-2 h-4 w-4 rounded border-gray-600 bg-stone-700 text-amber-600 focus:ring-amber-500"
                />
                <label className="ml-2 text-sm text-gray-300">
                  {key}
                </label>
              </div>
            );
          } else if (param.type === 'number') {
            return (
              <div key={key} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {key}
                  {param.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="number"
                  value={params[key] !== undefined ? params[key] : ''}
                  onChange={(e) => {
                    const numValue = e.target.value ? Number(e.target.value) : '';
                    handleParamChange(key, numValue);
                  }}
                  className={inputClasses}
                  required={param.required}
                />
                <p className="mt-1 text-xs text-gray-400">
                  {param.description}
                </p>
              </div>
            );
          } else if (param.type === 'string[]') {
            return (
              <div key={key} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {key}
                  {param.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={Array.isArray(params[key]) ? params[key].join(', ') : ''}
                  onChange={(e) => handleArrayChange(key, e.target.value)}
                  className={inputClasses}
                  required={param.required}
                  placeholder="Comma-separated values"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {param.description}
                </p>
              </div>
            );
          } else {
            return (
              <div key={key} className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {key}
                  {param.required && <span className="text-red-500 ml-1">*</span>}
                </label>
                <input
                  type="text"
                  value={params[key] !== undefined ? params[key] : ''}
                  onChange={(e) => handleParamChange(key, e.target.value)}
                  className={inputClasses}
                  required={param.required}
                />
                <p className="mt-1 text-xs text-gray-400">
                  {param.description}
                </p>
              </div>
            );
          }
        })}
        
        {/* If no constructor interface found, show message */}
        {!constructorInterface && (
          <div className="text-sm text-gray-400 p-2 bg-stone-700 rounded-md">
            No configuration parameters defined for this plugin.
          </div>
        )}
        
        {/* Show interval field for source and generator plugins */}
        {(('type' in plugin && (plugin.type === 'source' || plugin.type === 'generator')) || 
           (!('type' in plugin) && (getPluginId()?.startsWith('source') || getPluginId()?.startsWith('generator')))) && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Interval (milliseconds)<span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="number"
              value={interval || 60000}
              onChange={(e) => setInterval(Math.max(60000, Number(e.target.value) || 60000))}
              className={inputClasses}
              placeholder="Minimum 60000 (1 minute)"
              required
              min={60000}
            />
            <p className="mt-1 text-xs text-gray-400">
              Minimum interval is 1 minute (60000 ms)
            </p>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-stone-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 text-gray-200 flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-100">{customName} Configuration</h3>
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
            {'description' in plugin ? plugin.description : 'Configure plugin parameters'}
          </p>
        </div>

        <div className="overflow-y-auto">
          <form onSubmit={handleSubmit} className="px-6 py-4">
            {/* Name Field */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Name<span className="text-red-500 ml-1">*</span>
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="p-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                required
                placeholder="Enter a name for this plugin"
              />
              <p className="mt-1 text-xs text-gray-400">
                A descriptive name to identify this plugin in the workflow
              </p>
            </div>
            
            {renderConfigFields()}
          </form>
        </div>

        <div className="mt-auto px-6 py-4 border-t border-gray-700">
          <div className="flex justify-between">
            {/* Delete button - only show for existing plugins with an ID */}
            {getPluginId() ? (
              <button
                type="button"
                onClick={() => {
                  // Confirm before deleting
                  if (window.confirm(`Are you sure you want to delete the plugin "${customName}"?`)) {
                    // Call removeNode on the ConfigStateManager
                    const nodeId = getPluginId() as string;
                    const removed = configStateManager.removeNode(nodeId);
                    
                    if (removed) {
                      console.log(`Successfully removed node: ${customName} (${nodeId})`);
                      // Close the dialog after successful deletion
                      onClose();
                    } else {
                      console.error(`Failed to remove node: ${customName} (${nodeId})`);
                      alert("Failed to delete the plugin. Please try again.");
                    }
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-red-500"
              >
                Delete
              </button>
            ) : (
              // Empty div to maintain layout when no delete button
              <div></div>
            )}
            
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 bg-stone-700 border border-gray-600 rounded-md hover:bg-stone-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-amber-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                className="px-4 py-2 text-sm font-medium text-gray-300 bg-amber-700 rounded-md hover:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-amber-500"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 