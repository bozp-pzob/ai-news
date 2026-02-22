import React, { useState, useEffect, useRef } from 'react';
import { configStateManager } from '../services/ConfigStateManager';
import { PluginInfo, PluginConfig, PluginType } from '../types';
import { SecretInputField } from './SecretInputField';
import { SecretInputSelectField } from './SecretInputSelectField';
import { pluginRegistry } from '../services/PluginRegistry';
import { useToast } from './ToastProvider';
import { deepCopy } from '../utils/deepCopy';
import { isSensitiveParam, isLookupVariable } from '../utils/secretValidation';
import { ConnectionChannelPicker } from './ConnectionChannelPicker';
import { GitHubRepoPicker } from './GitHubRepoPicker';
import { PlatformType, ExternalConnection } from '../services/api';
import { MediaDownloadConfig } from './MediaDownloadConfig';

// Re-export for backwards compatibility with existing code
const isSensitiveParameter = isSensitiveParam;

interface PluginParamDialogProps {
  plugin: PluginInfo | PluginConfig;
  isOpen: boolean;
  onClose: () => void;
  onAdd: (plugin: any) => void;
  // Platform mode props for storage plugin handling
  platformMode?: boolean;
  isPlatformPro?: boolean;
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

// Add TypeScript interface to type param.secret property
interface ConstructorInterfaceParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required: boolean;
  description: string;
  secret?: boolean;
}

interface ConstructorInterface {
  parameters: ConstructorInterfaceParameter[];
}

export const PluginParamDialog: React.FC<PluginParamDialogProps> = ({
  plugin,
  isOpen,
  onClose,
  onAdd,
  platformMode = false,
  isPlatformPro = false,
}) => {
  const { showToast } = useToast();
  
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
    'interval' in plugin && plugin.interval !== undefined ? plugin.interval : 60000
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
      // Prefer pluginName for lookups if available, fallback to name
      pluginName = 'pluginName' in plugin ? (plugin as any).pluginName : plugin.name;
      pluginType = 'type' in plugin ? plugin.type : undefined;
      
      // Handle name mismatches between config names and actual plugin names
      // This mapping helps correct common mismatches
      const pluginNameMapping: Record<string, string> = {
        'topicEnricher': 'AiTopicsEnricher',
        'imageEnricher': 'AiImageEnricher',
        // Add more mappings as needed
      };
      
      // Check if we have a mapping for this plugin name
      if (pluginName && pluginNameMapping[pluginName]) {
        pluginName = pluginNameMapping[pluginName];
      }
    }
    
    if (pluginName) {      
      // Try to get schema from registry
      const pluginInfo = pluginRegistry.findPlugin(pluginName, pluginType);
      
      if (pluginInfo) {
        setPluginSchema(pluginInfo);
      } else {
        // If no exact match found, try getting all plugins and fuzzy matching
        const allPlugins = pluginRegistry.getPlugins();
        let foundPlugin = null;
        
        if (Object.keys(allPlugins).length > 0) {
          // Check each category of plugins
          for (const category in allPlugins) {
            // Only check the same category/type if specified
            if (pluginType && category !== pluginType) continue;
            
            // Check each plugin in this category
            for (const p of allPlugins[category]) {
              // Try multiple ways to match:
              // 1. Check if plugin name includes our search term
              // 2. Check if our search term includes plugin name
              if (p.pluginName && pluginName && (
                  p.pluginName.toLowerCase().includes(pluginName.toLowerCase()) || 
                  pluginName.toLowerCase().includes(p.pluginName.toLowerCase()))) {
                foundPlugin = p;
                break;
              }
            }
            
            if (foundPlugin) break;
          }
          
          if (foundPlugin) {
            setPluginSchema(foundPlugin);
          }
        }
        
        // Load plugins if not already loaded
        if (!pluginRegistry.isPluginsLoaded()) {
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
                    if (p.pluginName && pluginName && (
                        p.pluginName.toLowerCase().includes(pluginName.toLowerCase()) || 
                        pluginName.toLowerCase().includes(p.pluginName.toLowerCase()))) {
                      updatedPluginInfo = p;
                      break;
                    }
                  }
                  
                  if (updatedPluginInfo) break;
                }
              }
              
              if (updatedPluginInfo) {
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
        // Initialize empty parameters for all constructorInterface parameters
        const initializedParams = { ...node.params };
        
        setParams(initializedParams);
        
        // Also update the interval if it's available in the node
        if (node.interval !== undefined) {
          setInterval(node.interval);
        }
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
    
    // Get constructor parameters from schema
    const constructorParams = pluginSchema.constructorInterface.parameters;
    
    // Check if this is free tier (platform mode but not pro)
    const isFreeTier = platformMode && !isPlatformPro;
    
    // Determine plugin type
    let pluginType = '';
    if ('type' in plugin) {
      pluginType = plugin.type;
    }
    
    // Create a new parameters object with default values for missing fields
    setParams(currentParams => {
      const updatedParams = { ...currentParams };
      
      // For free tier storage plugins, force usePlatformStorage to true
      if (isFreeTier && pluginType === 'storage') {
        updatedParams.usePlatformStorage = true;
      }
      
      // Initialize any missing parameters with appropriate values
      constructorParams.forEach(param => {
        if (updatedParams[param.name] === undefined) {
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
        }
        
        // Special handling for DiscordSource mode - set default to 'detailed'
        if (pluginSchema?.pluginName === 'DiscordSource' && param.name === 'mode' && !updatedParams.mode) {
          updatedParams.mode = 'detailed';
        }
        
        // Special handling for GitHubSource mode - set default to 'summarized'
        if (pluginSchema?.pluginName === 'GitHubSource' && param.name === 'mode' && !updatedParams.mode) {
          updatedParams.mode = 'summarized';
        }
        
        if (param.required) {
          // Ensure required fields don't have empty values
          if (
            updatedParams[param.name] === '' || 
            updatedParams[param.name] === null || 
            (Array.isArray(updatedParams[param.name]) && updatedParams[param.name].length === 0)
          ) {
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
  }, [pluginSchema, platformMode, isPlatformPro, plugin]);

  // Handle adding a new item to an array
  const handleAddArrayItem = (key: string) => {    
    setParams(prev => {
      // Create a deep copy of the current array or initialize a new one
      const currentArray = Array.isArray(prev[key]) ? [...prev[key]] : [];
      // Add the new empty item
      currentArray.push('');
      
      // Return the new params object with the updated array
      return {
        ...prev,
        [key]: currentArray
      };
    });
  };

  // Handle removing an item from an array
  const handleRemoveArrayItem = (key: string, index: number) => {    
    setParams(prev => {
      // Create a deep copy of the current array
      const currentArray = Array.isArray(prev[key]) ? [...prev[key]] : [];
      // Remove the item at the specified index
      const newArray = currentArray.filter((_, i) => i !== index);
      
      // Return the new params object with the updated array
      return {
        ...prev,
        [key]: newArray
      };
    });
  };

  // Handle updating a single array item
  const handleUpdateArrayItem = (key: string, index: number, value: string) => {    
    setParams(prev => {
      // Create a deep copy of the current array
      const currentArray = Array.isArray(prev[key]) ? [...prev[key]] : [];
      // Update the value at the specified index
      const newArray = [...currentArray];
      newArray[index] = value;
      
      // Return the new params object with the updated array
      return {
        ...prev,
        [key]: newArray
      };
    });
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Basic validation of required fields
    if (pluginSchema?.constructorInterface?.parameters) {
      const requiredMissing = pluginSchema.constructorInterface.parameters
        .filter(param => param.required)
        .some(param => {
          const key = param.name;
          const value = params[key];
          return value === undefined || value === null || value === '' || 
                 (Array.isArray(value) && value.length === 0);
        });
      
      if (requiredMissing) {
        showToast("Please fill in all required fields marked with *", 'warning');
        return;
      }
      
      // Validate that sensitive fields don't contain actual secrets
      // Secrets should be stored via SecretManager and referenced as $SECRET:uuid$, 
      // process.env.X, or ALL_CAPS variable names
      const secretViolations: string[] = [];
      
      pluginSchema.constructorInterface.parameters.forEach((param: any) => {
        const key = param.name;
        const value = params[key];
        
        // Check if this field is sensitive
        const isSensitive = param.secret === true || isSensitiveParameter(key);
        
        if (isSensitive && typeof value === 'string' && !isLookupVariable(value)) {
          secretViolations.push(key);
        }
      });
      
      if (secretViolations.length > 0) {
        showToast(
          `The field(s) "${secretViolations.join(', ')}" contain actual secrets instead of references. ` +
          `Please use the secure input field to store secrets, or use ALL_CAPS variable names (e.g., MY_API_KEY).`,
          'error'
        );
        return;
      }
    }
    
    // Create a true deep copy of all parameters
    const paramsCopy = deepCopy(params);
  
    
    // Create updated plugin with new params and custom name
    const updatedPlugin = {
      ...plugin,
      name: customName,
      params: paramsCopy,
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
    // Split by commas, but preserve commas within quotes
    const arrayValue = value.split(',').map(item => {
      const trimmed = item.trim();
      // Remove quotes if the item is quoted
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || 
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.substring(1, trimmed.length - 1);
      }
      return trimmed;
    }).filter(Boolean);
      
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

    // Check if this is free tier (platform mode but not pro)
    const isFreeTier = platformMode && !isPlatformPro;

    // For free tier AI plugins, show simplified read-only view
    if (isFreeTier && pluginType === 'ai') {
      return (
        <div className="space-y-4">
          <div className="p-4 bg-stone-700 rounded-lg border border-amber-500/30">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="font-medium text-white">Free Tier AI (GPT-4o-mini)</span>
            </div>
            <p className="text-stone-400 text-sm">
              Your pipeline uses GPT-4o-mini, optimized for cost-effectiveness.
              Upgrade to Pro for GPT-4o with higher quality outputs and configurable daily quota.
            </p>
          </div>
        </div>
      );
    }

    // For free tier storage plugins, show simplified read-only view
    if (isFreeTier && pluginType === 'storage') {
      return (
        <div className="space-y-4">
          <div className="p-4 bg-stone-700 rounded-lg border border-amber-500/30">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
              <span className="font-medium text-white">Platform Storage</span>
            </div>
            <p className="text-stone-400 text-sm">
              Your data will be stored securely on our platform with PostgreSQL and pgvector for semantic search.
              Upgrade to Pro to use your own external database.
            </p>
          </div>
        </div>
      );
    }
    
    // Get constructor interface from plugin or schema
    const constructorInterface = pluginSchema?.constructorInterface || 
                               ('constructorInterface' in plugin ? (plugin as any).constructorInterface : null);
    
    // CSS classes for inputs
    const inputClasses = "p-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500";
    
    
    // Check if plugin has provider/storage parameters in constructor interface
    const hasProviderParameter = constructorInterface?.parameters.some((param: { name: string }) => param.name === 'provider') ?? false;
    
    // For DiscordSource, provider is only required in 'summarized' mode
    const isDiscordSource = pluginSchema?.pluginName === 'DiscordSource';
    const isProviderRequired = isDiscordSource 
      ? params.mode === 'summarized'
      : constructorInterface?.parameters.some(
          (param: { name: string; required: boolean }) => param.name === 'provider' && param.required
        ) ?? false;
    
    const hasStorageParameter = constructorInterface?.parameters.some((param: { name: string }) => param.name === 'storage') ?? false;
    
    // For DiscordSource, storage is required in 'detailed' and 'summarized' modes but not 'simple'
    const isStorageRequired = isDiscordSource
      ? params.mode !== 'simple'
      : constructorInterface?.parameters.some(
          (param: { name: string; required: boolean }) => param.name === 'storage' && param.required
        ) ?? false;
    
    return (
      <div className="space-y-4">
        {/* Only render provider field if it's explicitly in the constructor interface */}
        {/* For DiscordSource, only show in summarized mode */}
        {hasProviderParameter && (!isDiscordSource || params.mode === 'summarized') && (
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
        {/* For DiscordSource, hide in simple mode (not required) */}
        {hasStorageParameter && (!isDiscordSource || params.mode !== 'simple') && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Storage
              {isStorageRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            <select
              value={params.storage || ''}
              name="storage"
              onChange={(e) => handleParamChange('storage', e.target.value)}
              className="py-2 px-1 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
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
        
        {/* Special handling for PostgresStorage in platform mode */}
        {platformMode && pluginSchema?.pluginName === 'PostgresStorage' && (
          <div className="mb-6 p-4 bg-stone-700 rounded-lg border border-stone-600">
            {/* Free tier: Platform storage is always enabled (no choice) */}
            {!isPlatformPro ? (
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-green-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">Platform Storage Enabled</div>
                  <p className="text-gray-400 text-xs mt-1">
                    Your data is stored securely on our managed PostgreSQL with pgvector.
                    Upgrade to Pro to use your own external database.
                  </p>
                </div>
              </div>
            ) : (
              /* Pro users can choose between platform and external storage */
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!params.usePlatformStorage}
                  onChange={(e) => handleParamChange('usePlatformStorage', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-stone-600 text-amber-600 focus:ring-amber-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">Use Platform Storage</div>
                  <p className="text-gray-400 text-xs mt-1">
                    Use our managed PostgreSQL with pgvector. We handle backups, scaling, and maintenance.
                  </p>
                </div>
              </label>
            )}
          </div>
        )}

        {/* Special handling for AI providers in platform mode */}
        {platformMode && (pluginSchema?.pluginName === 'OpenAIProvider' || pluginSchema?.pluginName === 'OpenRouterProvider') && (
          <div className="mb-6 p-4 bg-stone-700 rounded-lg border border-stone-600">
            {/* Free tier: Platform AI is always enabled (no choice) */}
            {!isPlatformPro ? (
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-green-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">Platform AI Enabled (GPT-4o-mini)</div>
                  <p className="text-gray-400 text-xs mt-1">
                    Using GPT-4o-mini, optimized for cost-effectiveness.
                    Upgrade to Pro for GPT-4o with higher quality outputs.
                  </p>
                </div>
              </div>
            ) : (
              /* Pro users can choose between platform AI and their own key */
              <>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!params.usePlatformAI}
                    onChange={(e) => handleParamChange('usePlatformAI', e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-stone-600 text-amber-600 focus:ring-amber-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-white text-sm">Use Platform AI (GPT-4o)</div>
                    <p className="text-gray-400 text-xs mt-1">
                      Use our managed AI with GPT-4o. Daily usage quota applies. We handle API costs and rate limiting.
                    </p>
                  </div>
                </label>
                {params.usePlatformAI && (
                  <div className="mt-3 p-2 bg-stone-600 rounded text-xs text-gray-300">
                    <p className="text-amber-300">
                      Daily AI calls are tracked. When quota is exhausted, aggregation will continue but skip AI processing (raw data only).
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Mode selector for unified DiscordSource */}
        {pluginSchema?.pluginName === 'DiscordSource' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Mode
              <span className="text-red-500 ml-1">*</span>
            </label>
            <select
              value={params.mode || 'detailed'}
              onChange={(e) => {
                const newMode = e.target.value;
                handleParamChange('mode', newMode);
                // Clear provider if switching away from summarized mode
                if (newMode !== 'summarized' && params.provider) {
                  handleParamChange('provider', '');
                }
                // Clear channels when switching to/from simple mode (different channel types)
                if ((newMode === 'simple') !== (params.mode === 'simple')) {
                  handleParamChange('channelIds', []);
                }
              }}
              className="py-2 px-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="detailed">Detailed - Full message data with metadata</option>
              <option value="summarized">AI Summary - AI-generated conversation summaries</option>
              <option value="simple">Simple - Basic messages from announcement channels</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              {params.mode === 'summarized' 
                ? 'Requires an AI provider to generate summaries'
                : params.mode === 'simple'
                ? 'Only shows announcement channels - basic message content without extra processing'
                : 'Full message data with reactions, attachments, and user metadata'}
            </p>
          </div>
        )}

        {/* Connection/Channel Picker for platform-specific sources (Discord, Telegram, etc.) */}
        {platformMode && pluginSchema?.requiresPlatform && (
          <ConnectionChannelPicker
            platform={pluginSchema.requiresPlatform as PlatformType}
            selectedConnectionId={params.connectionId}
            selectedChannelIds={params.channelIds || []}
            onConnectionChange={(connectionId, connection) => {
              handleParamChange('connectionId', connectionId || '');
              // Also set the name if it's empty and we have a connection
              if (connection && !customName) {
                setCustomName(`${connection.externalName} Source`);
              }
            }}
            onChannelsChange={(channelIds) => {
              handleParamChange('channelIds', channelIds);
            }}
            channelsRequired={constructorInterface?.parameters.some(
              (p: any) => p.name === 'channelIds' && p.required
            )}
            // For Simple mode, only show announcement channels (Discord channel type 5)
            channelTypeFilter={
              pluginSchema?.pluginName === 'DiscordSource' && params.mode === 'simple' 
                ? [5] 
                : undefined
            }
            noChannelsMessage={
              pluginSchema?.pluginName === 'DiscordSource' && params.mode === 'simple'
                ? 'No announcement channels found in this server. Simple mode only works with announcement channels.'
                : undefined
            }
          />
        )}

        {/* Media Download Config - only for DiscordSource in detailed mode */}
        {pluginSchema?.pluginName === 'DiscordSource' && (!params.mode || params.mode === 'detailed') && (
          <div className="mb-4">
            <MediaDownloadConfig
              value={params.mediaDownload}
              onChange={(settings) => handleParamChange('mediaDownload', settings)}
              platformMode={platformMode}
            />
          </div>
        )}

        {/* GitHub Repo Picker - for GitHubSource */}
        {pluginSchema?.pluginName === 'GitHubSource' && (
          <div className="mb-4">
            <GitHubRepoPicker
              selectedConnectionId={params.connectionId}
              selectedRepos={params.repos || []}
              onConnectionChange={(connectionId, connection) => {
                handleParamChange('connectionId', connectionId || '');
                // Also set the name if it's empty and we have a connection
                if (connection && !customName) {
                  setCustomName(`${connection.externalName} GitHub Source`);
                }
              }}
              onReposChange={(repos) => {
                handleParamChange('repos', repos);
              }}
            />
          </div>
        )}

        {/* Mode selector for GitHubSource */}
        {pluginSchema?.pluginName === 'GitHubSource' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Mode
            </label>
            <select
              value={params.mode || 'summarized'}
              onChange={(e) => {
                handleParamChange('mode', e.target.value);
              }}
              className="py-2 px-2 w-full rounded-md border-gray-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
            >
              <option value="summarized">Summarized - Single summary per repo with all activity</option>
              <option value="raw">Raw - Individual items for each PR, issue, commit</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              {params.mode === 'raw' 
                ? 'Outputs individual ContentItems for each PR, issue, commit, review, plus summary'
                : 'Outputs a single comprehensive summary per repo (default)'}
            </p>
          </div>
        )}

        {/* AI Summary toggle for GitHubSource - only show in summarized mode */}
        {pluginSchema?.pluginName === 'GitHubSource' && params.mode === 'summarized' && (
          <div className="mb-4 p-3 bg-stone-700 rounded-lg border border-stone-600">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={params.aiSummary?.enabled || false}
                onChange={(e) => {
                  handleParamChange('aiSummary', { 
                    ...params.aiSummary, 
                    enabled: e.target.checked 
                  });
                  // If disabling, also clear the provider
                  if (!e.target.checked) {
                    handleParamChange('provider', '');
                  }
                }}
                className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-stone-600 text-amber-600 focus:ring-amber-500"
              />
              <div className="flex-1">
                <div className="font-medium text-white text-sm">AI-Powered Summary</div>
                <p className="text-gray-400 text-xs mt-1">
                  Use AI to generate more detailed and insightful summaries of GitHub activity.
                </p>
              </div>
            </label>
            
            {/* Provider selector - only show when AI summary is enabled */}
            {params.aiSummary?.enabled && (
              <div className="mt-3 pt-3 border-t border-stone-600">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  AI Provider
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <select
                  value={params.provider || ''}
                  onChange={(e) => handleParamChange('provider', e.target.value)}
                  className="py-2 px-2 w-full rounded-md border-gray-600 bg-stone-600 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500"
                  required
                >
                  <option value="">Select an AI provider</option>
                  {availableProviders.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
                {availableProviders.length === 0 && (
                  <p className="mt-1 text-xs text-amber-400">
                    No AI providers configured. Add an AI provider to your pipeline first.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Render constructor interface parameters */}
        {constructorInterface && (constructorInterface.parameters as Array<{
          name: string;
          type: 'string' | 'number' | 'boolean' | 'string[]';
          required: boolean;
          description: string;
          secret?: boolean;
          platformOnly?: boolean;
        }>).map(param => {
          const key = param.name;
          
          // Skip provider and storage fields (handled separately)
          if ((key === 'provider' && hasProviderParameter) || 
              (key === 'storage' && hasStorageParameter)) {
            return null;
          }
          
          // Skip usePlatformStorage and usePlatformAI - handled above with special UI
          if (key === 'usePlatformStorage' || key === 'usePlatformAI') {
            return null;
          }
          
          // In platform mode with requiresPlatform, hide connection-related fields
          // These are handled by the ConnectionChannelPicker above
          if (platformMode && pluginSchema?.requiresPlatform) {
            const connectionFields = ['connectionId', 'channelIds', 'chatIds', 'botToken', 'guildId'];
            if (connectionFields.includes(key)) {
              return null;
            }
          }
          
          // Skip mode and mediaDownload fields for DiscordSource - handled with special UI above
          if (pluginSchema?.pluginName === 'DiscordSource' && (key === 'mode' || key === 'mediaDownload')) {
            return null;
          }
          
          // Skip GitHubSource fields handled with custom UI above
          if (pluginSchema?.pluginName === 'GitHubSource') {
            const githubHandledFields = ['repos', 'connectionId', 'mode', 'aiSummary', 'interval', 'provider'];
            if (githubHandledFields.includes(key)) {
              return null;
            }
          }
          
          // In platform mode, hide connection params when using platform storage
          if (platformMode && params.usePlatformStorage) {
            // Hide all DB connection parameters when platform storage is enabled
            const connectionParams = ['connectionString', 'host', 'port', 'database', 'user', 'password'];
            if (connectionParams.includes(key)) {
              return null;
            }
          }
          
          // In platform mode, hide AI config fields when using platform AI
          // The platform injects apiKey, model, and OpenRouter-specific settings
          if (platformMode && params.usePlatformAI) {
            const platformAIFields = ['apiKey', 'model', 'temperature', 'siteUrl', 'siteName', 'fallbackModel'];
            if (platformAIFields.includes(key)) {
              return null;
            }
          }
          
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
                <div className="space-y-2">
                  {(params[key] || []).map((item: string, index: number) => (
                    <div key={index} className="relative">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => handleUpdateArrayItem(key, index, e.target.value)}
                        className={`${inputClasses} pr-8`}
                        placeholder={`Item ${index + 1}`}
                        data-index={index}
                        data-array-key={key}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveArrayItem(key, index)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-red-400 hover:text-red-300 focus:outline-none"
                        title="Remove item"
                        data-index={index}
                        data-array-key={key}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleAddArrayItem(key)}
                    className="mt-2 px-3 py-1 text-sm text-amber-400 hover:text-amber-300 border border-amber-400 hover:border-amber-300 rounded-md focus:outline-none"
                    data-array-key={key}
                  >
                    + Add Item
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  {param.description || "Add items to the list"}
                </p>
              </div>
            );
          } else {
            // Check if this is a sensitive parameter that should use SecretInputSelectField
            // @ts-ignore: param.secret is added to the constructorInterface.parameters type in index.ts
            if (param.secret === true || isSensitiveParameter(key)) {
              return (
                <div key={key} className="mb-4">
                  <SecretInputSelectField
                    id={`param-${key}`}
                    label={key}
                    value={params[key] !== undefined ? params[key] : ''}
                    onChange={(value) => handleParamChange(key, value)}
                    placeholder={`Enter value for ${key}`}
                    required={param.required}
                    description={param.description}
                    secretType={key}
                  />
                </div>
              );
            } else {
              // Standard input for non-sensitive string parameters
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
                      // Force a sync to ensure everything is updated properly
                      configStateManager.forceSync();
                      // Close the dialog after successful deletion
                      onClose();
                    } else {
                      console.error(`Failed to remove node: ${customName} (${nodeId})`);
                      showToast("Failed to delete the plugin. Please try again.", 'error');
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
                className="px-4 py-2 text-sm font-medium text-black bg-amber-300 rounded-md hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-amber-500"
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