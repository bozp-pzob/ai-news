import React, { useState, useEffect } from 'react';
import { Config, PluginInfo, PluginType, PluginConfig } from '../types';
import { getConfig, saveConfig, getPlugins, startAggregation, stopAggregation, getAggregationStatus } from '../services/api';
import { PluginSelector } from './PluginSelector';
import { PluginParamDialog } from './PluginParamDialog';

interface ConfigEditorProps {
  configName: string;
  onSave: () => void;
  onConfigUpdate: (config: Config) => void;
  onPluginAdd: (plugin: PluginConfig) => void;
  onPluginUpdate: (plugin: PluginConfig) => void;
  onPluginDelete: (plugin: PluginConfig) => void;
}

// Helper function to map PluginType to Config property
const mapPluginTypeToConfigProperty = (pluginType: PluginType): keyof Config => {
  switch (pluginType) {
    case 'source':
      return 'sources';
    case 'enricher':
      return 'enrichers';
    case 'generator':
      return 'generators';
    case 'ai':
    case 'storage':
      return pluginType;
    case 'sources':
    case 'enrichers':
    case 'generators':
    case 'settings':
      return pluginType;
    default:
      return pluginType as keyof Config;
  }
};

export const ConfigEditor: React.FC<ConfigEditorProps> = ({
  configName,
  onSave,
  onConfigUpdate,
  onPluginAdd,
  onPluginUpdate,
  onPluginDelete,
}) => {
  const [config, setConfig] = useState<Config>({
    sources: [],
    ai: [],
    enrichers: [],
    generators: [],
    providers: [],
    storage: [],
    settings: {
      runOnce: false,
      onlyFetch: false
    }
  });
  const [plugins, setPlugins] = useState<{ [key: string]: PluginInfo[] }>({});
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped');
  const [isPluginDialogOpen, setIsPluginDialogOpen] = React.useState(false);
  const [selectedPlugin, setSelectedPlugin] = React.useState<PluginConfig | null>(null);

  useEffect(() => {
    loadData();
  }, [configName]);

  const loadData = async () => {
    try {
      const [configData, pluginsData] = await Promise.all([
        getConfig(configName),
        getPlugins()
      ]);
      setConfig(configData);
      setPlugins(pluginsData);
      const aggregationStatus = await getAggregationStatus(configName);
      setStatus(aggregationStatus);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleAddPlugin = (plugin: PluginInfo, pluginConfig: Record<string, any>, interval?: number) => {
    console.log('handleAddPlugin called with:', { plugin, pluginConfig, interval });
    
    if (plugin) {
      const newPlugin = {
        type: plugin.type,
        name: plugin.name,
        params: pluginConfig,
        interval
      };
      
      console.log('Creating new plugin:', newPlugin);
      console.log('Current config:', config);
      
      setConfig(prevConfig => {
        const pluginType = plugin.type as PluginType;
        console.log('Plugin type:', pluginType);
        
        // Map plugin type to config property
        const configProperty = mapPluginTypeToConfigProperty(pluginType);
        console.log('Config property:', configProperty);
        console.log('Previous config for property:', prevConfig[configProperty]);
        
        // Check if this is an array property
        if (configProperty === 'sources' || 
            configProperty === 'ai' || 
            configProperty === 'enrichers' || 
            configProperty === 'generators' || 
            configProperty === 'storage' || 
            configProperty === 'providers') {
          
          // TypeScript needs help understanding that these are array properties
          const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
          
          const updatedConfig = {
            ...prevConfig,
            [arrayProp]: [...(prevConfig[arrayProp] || []), newPlugin]
          };
          
          console.log('Updated config:', updatedConfig);
          return updatedConfig;
        }
        
        return prevConfig;
      });
    }
  };

  const handleRemovePlugin = (type: PluginType, index: number) => {
    setConfig(prevConfig => {
      // Map plugin type to config property
      const configProperty = mapPluginTypeToConfigProperty(type);
      
      // Check if this is an array property
      if (configProperty === 'sources' || 
          configProperty === 'ai' || 
          configProperty === 'enrichers' || 
          configProperty === 'generators' || 
          configProperty === 'storage' || 
          configProperty === 'providers') {
        
        // TypeScript needs help understanding that these are array properties
        const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
        
        return {
          ...prevConfig,
          [arrayProp]: prevConfig[arrayProp].filter((_, i) => i !== index)
        };
      }
      
      return prevConfig;
    });
  };

  const handleSave = async () => {
    try {
      await saveConfig(configName, config);
      onSave();
    } catch (error) {
      console.error('Error saving config:', error);
    }
  };

  const handleStartAggregation = async () => {
    try {
      await startAggregation(configName);
      setStatus('running');
    } catch (error) {
      console.error('Error starting aggregation:', error);
    }
  };

  const handleStopAggregation = async () => {
    try {
      await stopAggregation(configName);
      setStatus('stopped');
    } catch (error) {
      console.error('Error stopping aggregation:', error);
    }
  };

  const handlePluginAdd = (params: Record<string, any>, interval?: number) => {
    if (selectedPlugin) {
      onPluginAdd({
        ...selectedPlugin,
        params,
        interval,
      });
      setIsPluginDialogOpen(false);
      setSelectedPlugin(null);
    }
  };

  const handlePluginUpdate = (params: Record<string, any>, interval?: number) => {
    if (selectedPlugin) {
      onPluginUpdate({
        ...selectedPlugin,
        params,
        interval,
      });
      setIsPluginDialogOpen(false);
      setSelectedPlugin(null);
    }
  };

  const renderPluginList = (type: PluginType, title: string) => {
    // Map plugin type to config property
    const configProperty = mapPluginTypeToConfigProperty(type);
    
    // Check if this is an array property and cast it to the right type
    if (configProperty === 'sources' || 
        configProperty === 'ai' || 
        configProperty === 'enrichers' || 
        configProperty === 'generators' || 
        configProperty === 'storage' || 
        configProperty === 'providers') {
      
      // TypeScript needs help understanding that these are array properties
      const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
      const plugins = config[arrayProp];
      
      return (
        <div className="mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
          <div className="space-y-4">
            {plugins.map((plugin: PluginConfig, index: number) => (
              <div key={index} className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">{plugin.name}</span>
                  <button
                    onClick={() => handleRemovePlugin(type, index)}
                    className="text-red-600 hover:text-red-800"
                  >
                    Remove
                  </button>
                </div>
                <div className="text-sm text-gray-500">
                  <div>Type: {plugin.type}</div>
                  <div>Interval: {plugin.interval ? `${plugin.interval}ms` : 'Not set'}</div>
                  <div className="mt-2">
                    <div className="font-medium">Parameters:</div>
                    <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
                      {JSON.stringify(plugin.params, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    
    // Return an empty div if the type doesn't correspond to an array property
    return <div></div>;
  };

  const renderPluginEditor = () => {
    if (!config.activePlugin) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          Select a plugin from the sidebar to edit
        </div>
      );
    }

    if (config.activePlugin.type === 'settings') {
      return (
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config.settings?.runOnce || false}
                  onChange={(e) => onConfigUpdate({
                    ...config,
                    settings: { ...config.settings, runOnce: e.target.checked }
                  })}
                  className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
                <span className="ml-2 text-sm text-gray-700">Run Once</span>
              </label>
            </div>
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config.settings?.onlyFetch || false}
                  onChange={(e) => onConfigUpdate({
                    ...config,
                    settings: { ...config.settings, onlyFetch: e.target.checked }
                  })}
                  className="rounded border-gray-300 text-indigo-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                />
                <span className="ml-2 text-sm text-gray-700">Only Fetch</span>
              </label>
            </div>
          </div>
        </div>
      );
    }

    const plugin = config.activePlugin as PluginConfig;
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-medium text-gray-900">
            {plugin.name}
          </h2>
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setSelectedPlugin(plugin);
                setIsPluginDialogOpen(true);
              }}
              className="px-3 py-1 text-sm text-indigo-600 hover:text-indigo-900"
            >
              Edit
            </button>
            <button
              onClick={() => onPluginDelete(plugin)}
              className="px-3 py-1 text-sm text-red-600 hover:text-red-900"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-500">Parameters</h3>
            <pre className="mt-2 p-4 bg-gray-50 rounded-md text-sm text-gray-700 overflow-auto">
              {JSON.stringify(plugin.params, null, 2)}
            </pre>
          </div>
          {plugin.interval && (
            <div>
              <h3 className="text-sm font-medium text-gray-500">Interval</h3>
              <p className="mt-1 text-sm text-gray-700">
                {plugin.interval}ms
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Configuration: {configName}</h2>
        <div className="flex space-x-4">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Save Changes
          </button>
          {status === 'stopped' ? (
            <button
              onClick={handleStartAggregation}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Start Aggregation
            </button>
          ) : (
            <button
              onClick={handleStopAggregation}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Stop Aggregation
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Current Configuration</h3>
          {renderPluginList('sources', 'Sources')}
          {renderPluginList('ai', 'AI Providers')}
          {renderPluginList('enrichers', 'Enrichers')}
          {renderPluginList('generators', 'Generators')}
          {renderPluginList('storage', 'Storage')}
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Available Plugins</h3>
          {Object.entries(plugins).map(([type, typePlugins]) => (
            <div key={type} className="mb-6">
              <h4 className="text-md font-medium text-gray-700 mb-2">{type}</h4>
              <div className="space-y-4">
                {typePlugins.map((plugin) => (
                  <PluginSelector
                    key={plugin.name}
                    plugin={plugin}
                    onAdd={handleAddPlugin}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 h-full overflow-hidden">
        {renderPluginEditor()}
        {isPluginDialogOpen && selectedPlugin && (
          <PluginParamDialog
            plugin={selectedPlugin}
            isOpen={isPluginDialogOpen}
            onClose={() => {
              setIsPluginDialogOpen(false);
              setSelectedPlugin(null);
            }}
            onAdd={handlePluginAdd}
          />
        )}
      </div>
    </div>
  );
}; 