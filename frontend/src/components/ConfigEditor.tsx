import React, { useState, useEffect, useRef } from 'react';
import { Config, PluginInfo, PluginType, PluginConfig, AggregationStatus } from '../types';
import { getConfig, saveConfig, getPlugins, startAggregation, stopAggregation, runAggregation, getAggregationStatus } from '../services/api';
import { PluginSelector } from './PluginSelector';
import { PluginParamDialog } from './PluginParamDialog';
import { useWebSocket } from '../hooks/useWebSocket';

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
  // First check if the type contains keywords that indicate its category
  if (typeof pluginType === 'string') {
    const lowerType = pluginType.toLowerCase();
    if (lowerType.includes('source')) {
      return 'sources';
    } else if (lowerType.includes('enricher')) {
      return 'enrichers';
    } else if (lowerType.includes('generator')) {
      return 'generators';
    } else if (lowerType.includes('ai') || lowerType.includes('provider')) {
      return 'ai';
    } else if (lowerType.includes('storage')) {
      return 'storage';
    }
  }
  
  // Fall back to base type mappings
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
      // For any unknown type, try to infer from the name or default to sources
      return 'sources';
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
  const [isPluginDialogOpen, setIsPluginDialogOpen] = React.useState(false);
  const [selectedPlugin, setSelectedPlugin] = React.useState<PluginConfig | null>(null);
  const [isRunningOnce, setIsRunningOnce] = useState<boolean>(false);
  
  // Use WebSocket hook for real-time status updates
  const { 
    status, 
    error: wsError, 
    isConnected: wsConnected,
    startAggregation: wsStartAggregation,
    runAggregation: wsRunAggregation,
    stopAggregation: wsStopAggregation,
  } = useWebSocket(configName);

  // Fallback to polling if WebSocket is not available
  const statusPollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [polledStatus, setPolledStatus] = useState<AggregationStatus>({ status: 'stopped' });

  useEffect(() => {
    loadData();
    
    // Start polling for status updates as a fallback
    if (!wsConnected) {
      startStatusPolling();
    }
    
    // Clean up interval on unmount
    return () => {
      if (statusPollingIntervalRef.current) {
        clearInterval(statusPollingIntervalRef.current);
      }
    };
  }, [configName, wsConnected]);

  // Helper function to format timestamps
  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  };

  const loadData = async () => {
    try {
      const [configData, pluginsData] = await Promise.all([
        getConfig(configName),
        getPlugins()
      ]);
      setConfig(configData);
      setPlugins(pluginsData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const startStatusPolling = () => {
    // Poll for status every 2 seconds
    if (statusPollingIntervalRef.current) {
      clearInterval(statusPollingIntervalRef.current);
    }
    
    statusPollingIntervalRef.current = setInterval(async () => {
      try {
        const aggregationStatus = await getAggregationStatus(configName);
        setPolledStatus(aggregationStatus);
      } catch (error) {
        console.error('Error fetching aggregation status:', error);
      }
    }, 2000);
  };

  // Determine which status to use (WebSocket or polled)
  const currentStatus = wsConnected ? status || { status: 'stopped' } : polledStatus;

  const handleAddPlugin = (plugin: PluginInfo, pluginConfig: Record<string, any>, interval?: number) => {
    if (plugin) {
      const newPlugin = {
        type: plugin.type,
        name: plugin.name,
        params: pluginConfig,
        interval
      };
      
      setConfig(prevConfig => {
        const pluginType = plugin.type as PluginType;
        
        // Map plugin type to config property
        const configProperty = mapPluginTypeToConfigProperty(pluginType);
        
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
      if (wsConnected) {
        // Use WebSocket for real-time updates but with REST API for control
        await wsStartAggregation(config);
      } else {
        // Fallback to REST API
        const configObject = await getConfig(configName);
        await startAggregation(configName, configObject);
        const aggregationStatus = await getAggregationStatus(configName);
        setPolledStatus(aggregationStatus);
        // Ensure polling is active
        startStatusPolling();
      }
    } catch (error) {
      console.error('Error starting aggregation:', error);
    }
  };

  const handleStopAggregation = async () => {
    try {
      if (wsConnected) {
        // Use WebSocket for real-time updates but with REST API for control
        await wsStopAggregation();
      } else {
        // Fallback to REST API
        await stopAggregation(configName);
        const aggregationStatus = await getAggregationStatus(configName);
        setPolledStatus(aggregationStatus);
      }
    } catch (error) {
      console.error('Error stopping aggregation:', error);
    }
  };

  const handleRunAggregation = async () => {
    try {
      setIsRunningOnce(true);
      
      if (wsConnected) {
        // Use WebSocket for real-time updates but with REST API for control
        await wsRunAggregation(config);
      } else {
        // Fallback to REST API
        const configObject = await getConfig(configName);
        await runAggregation(configName, configObject);
        const aggregationStatus = await getAggregationStatus(configName);
        setPolledStatus(aggregationStatus);
        // Ensure polling is active to see the progress
        startStatusPolling();
      }
    } catch (error) {
      console.error('Error running aggregation:', error);
    } finally {
      setIsRunningOnce(false);
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
                  className="rounded border-gray-300 text-amber-500 shadow-sm focus:border-amber-400 focus:ring-amber-400"
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
                  className="rounded border-gray-300 text-amber-500 shadow-sm focus:border-amber-400 focus:ring-amber-400"
                />
                <span className="ml-2 text-sm text-gray-700">Only Fetch</span>
              </label>
            </div>
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config.settings?.onlyGenerate || false}
                  onChange={(e) => onConfigUpdate({
                    ...config,
                    settings: { ...config.settings, onlyGenerate: e.target.checked }
                  })}
                  className="rounded border-gray-300 text-amber-500 shadow-sm focus:border-amber-400 focus:ring-amber-400"
                />
                <span className="ml-2 text-sm text-gray-700">Only Generate</span>
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
              className="px-3 py-1 text-sm text-amber-300 hover:text-amber-400"
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

  // Render detailed status
  const renderDetailedStatus = () => {
    return (
      <div className="mb-8 bg-gray-50 p-4 rounded-lg">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Aggregation Status</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Status:</p>
            <p className={`text-sm ${currentStatus.status === 'running' ? 'text-green-600' : 'text-red-600'}`}>
              {currentStatus.status.toUpperCase()}
            </p>
          </div>
          
          {currentStatus.currentSource && (
            <div>
              <p className="text-sm font-medium text-gray-700">Current Source:</p>
              <p className="text-sm">{currentStatus.currentSource}</p>
            </div>
          )}
          
          {currentStatus.currentPhase && (
            <div>
              <p className="text-sm font-medium text-gray-700">Current Phase:</p>
              <p className="text-sm capitalize">{currentStatus.currentPhase}</p>
            </div>
          )}
          
          {currentStatus.lastUpdated && (
            <div>
              <p className="text-sm font-medium text-gray-700">Last Updated:</p>
              <p className="text-sm">{formatTimestamp(currentStatus.lastUpdated)}</p>
            </div>
          )}
        </div>
        
        {currentStatus.stats && (
          <div className="mt-4">
            <h4 className="text-md font-medium text-gray-800 mb-2">Statistics</h4>
            <div className="text-sm">
              <p>Total Items Fetched: {currentStatus.stats.totalItemsFetched || 0}</p>
              
              {currentStatus.stats.itemsPerSource && Object.keys(currentStatus.stats.itemsPerSource).length > 0 && (
                <div className="mt-2">
                  <p className="font-medium">Items Per Source:</p>
                  <ul className="list-disc pl-5 mt-1">
                    {Object.entries(currentStatus.stats.itemsPerSource).map(([source, count]) => (
                      <li key={source}>
                        {source}: {count} items
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {currentStatus.stats.lastFetchTimes && Object.keys(currentStatus.stats.lastFetchTimes).length > 0 && (
                <div className="mt-2">
                  <p className="font-medium">Last Fetch Times:</p>
                  <ul className="list-disc pl-5 mt-1">
                    {Object.entries(currentStatus.stats.lastFetchTimes).map(([source, time]) => (
                      <li key={source}>
                        {source}: {formatTimestamp(time)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
        
        {currentStatus.errors && currentStatus.errors.length > 0 && (
          <div className="mt-4">
            <h4 className="text-md font-medium text-red-600 mb-2">Errors</h4>
            <div className="max-h-40 overflow-y-auto">
              {currentStatus.errors.map((error, index) => (
                <div key={index} className="bg-red-50 p-2 rounded mb-2 text-sm">
                  <p className="font-medium">
                    {error.source ? `Error in ${error.source}:` : 'Error:'}
                  </p>
                  <p className="text-red-700">{error.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatTimestamp(error.timestamp)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
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
            className="px-4 py-2 bg-amber-300 text-black rounded-md hover:bg-amber-400"
          >
            Update
          </button>
          {currentStatus.status === 'stopped' ? (
            <>
              <button
                onClick={handleStartAggregation}
                className="px-4 py-2 bg-amber-300 text-black rounded-md hover:bg-amber-400"
              >
                Start Aggregation
              </button>
              <button
                onClick={handleRunAggregation}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Run aggregation once without starting a continuous process"
                disabled={isRunningOnce}
              >
                {isRunningOnce ? 'Running...' : 'Run Once'}
              </button>
            </>
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

      {/* Detailed Status Display */}
      {renderDetailedStatus()}

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