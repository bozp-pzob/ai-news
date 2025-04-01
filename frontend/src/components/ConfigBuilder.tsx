import React, { useState, useEffect } from 'react';
import { Config, PluginConfig, PluginInfo, PluginType } from '../types';
import { NodeGraph } from './NodeGraph';
import { PluginParamDialog } from './PluginParamDialog';

interface ConfigBuilderProps {
  config: Config;
  configName: string;
  onConfigUpdate: (config: Config) => void;
  onSave: () => void;
}

export const ConfigBuilder: React.FC<ConfigBuilderProps> = ({
  config: initialConfig,
  configName,
  onConfigUpdate,
  onSave,
}) => {
  const [currentConfig, setCurrentConfig] = useState<Config>(initialConfig);
  const [showPluginDialog, setShowPluginDialog] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginConfig | null>(null);
  const [plugins, setPlugins] = useState<{ [key: string]: PluginInfo[] }>({});
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped');

  useEffect(() => {
    setCurrentConfig(initialConfig);
  }, [initialConfig]);

  useEffect(() => {
    const fetchPlugins = async () => {
      try {
        const response = await fetch('/api/plugins');
        const data = await response.json();
        setPlugins(data);
      } catch (error) {
        console.error('Error fetching plugins:', error);
      }
    };
    fetchPlugins();
  }, []);

  const handlePluginAdd = (plugin: PluginConfig) => {
    const newConfig = { ...currentConfig };
    
    // Map between PluginType and config property
    let configProperty: keyof Config;
    switch (plugin.type) {
      case 'source':
        configProperty = 'sources';
        break;
      case 'enricher':
        configProperty = 'enrichers';
        break;
      case 'generator':
        configProperty = 'generators';
        break;
      case 'ai':
      case 'storage':
        configProperty = plugin.type;
        break;
      default:
        configProperty = plugin.type as keyof Config;
    }
    
    // Check if this is an array property
    if (configProperty === 'sources' || 
        configProperty === 'ai' || 
        configProperty === 'enrichers' || 
        configProperty === 'generators' || 
        configProperty === 'storage' || 
        configProperty === 'providers') {
      
      // TypeScript needs help understanding that these are array properties
      const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
      newConfig[arrayProp] = [...(newConfig[arrayProp] || []), plugin];
      setCurrentConfig(newConfig);
      onConfigUpdate(newConfig);
    }
  };

  const handlePluginUpdate = (plugin: PluginConfig) => {
    const newConfig = { ...currentConfig };
    
    // Map between PluginType and config property
    let configProperty: keyof Config;
    switch (plugin.type) {
      case 'source':
        configProperty = 'sources';
        break;
      case 'enricher':
        configProperty = 'enrichers';
        break;
      case 'generator':
        configProperty = 'generators';
        break;
      case 'ai':
      case 'storage':
        configProperty = plugin.type;
        break;
      default:
        configProperty = plugin.type as keyof Config;
    }
    
    // Check if this is an array property
    if (configProperty === 'sources' || 
        configProperty === 'ai' || 
        configProperty === 'enrichers' || 
        configProperty === 'generators' || 
        configProperty === 'storage' || 
        configProperty === 'providers') {
      
      // TypeScript needs help understanding that these are array properties
      const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
      newConfig[arrayProp] = (newConfig[arrayProp] || []).map((p: PluginConfig) =>
        p.name === plugin.name ? plugin : p
      );
      setCurrentConfig(newConfig);
      onConfigUpdate(newConfig);
    }
  };

  const handlePluginDelete = (plugin: PluginConfig) => {
    const newConfig = { ...currentConfig };
    
    // Map between PluginType and config property
    let configProperty: keyof Config;
    switch (plugin.type) {
      case 'source':
        configProperty = 'sources';
        break;
      case 'enricher':
        configProperty = 'enrichers';
        break;
      case 'generator':
        configProperty = 'generators';
        break;
      case 'ai':
      case 'storage':
        configProperty = plugin.type;
        break;
      default:
        configProperty = plugin.type as keyof Config;
    }
    
    // Check if this is an array property
    if (configProperty === 'sources' || 
        configProperty === 'ai' || 
        configProperty === 'enrichers' || 
        configProperty === 'generators' || 
        configProperty === 'storage' || 
        configProperty === 'providers') {
      
      // TypeScript needs help understanding that these are array properties
      const arrayProp = configProperty as 'sources' | 'ai' | 'enrichers' | 'generators' | 'storage' | 'providers';
      newConfig[arrayProp] = (newConfig[arrayProp] || []).filter((p: PluginConfig) =>
        p.name !== plugin.name
      );
      setCurrentConfig(newConfig);
      onConfigUpdate(newConfig);
    }
  };

  const handleSettingsUpdate = (settings: Config['settings']) => {
    const newConfig = { ...currentConfig, settings };
    setCurrentConfig(newConfig);
    onConfigUpdate(newConfig);
  };

  const handleAddPlugin = (type: keyof Config) => {
    // Convert Config key to a valid PluginType
    let pluginType: PluginType;
    
    switch (type) {
      case 'sources':
        pluginType = 'source';
        break;
      case 'enrichers':
        pluginType = 'enricher';
        break;
      case 'generators':
        pluginType = 'generator';
        break;
      case 'ai':
      case 'storage':
      case 'settings':
        pluginType = type;
        break;
      default:
        pluginType = type as PluginType;
    }
    
    setSelectedPlugin({ type: pluginType, name: '', params: {} });
    setShowPluginDialog(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 bg-gray-800 text-white">
        <div className="flex space-x-4">
          <button
            onClick={() => handleAddPlugin('sources')}
            className="px-4 py-2 bg-amber-500 text-gray-900 rounded hover:bg-amber-400"
          >
            Add Source
          </button>
          <button
            onClick={() => handleAddPlugin('ai')}
            className="px-4 py-2 bg-amber-500 text-gray-900 rounded hover:bg-amber-400"
          >
            Add AI
          </button>
          <button
            onClick={() => handleAddPlugin('enrichers')}
            className="px-4 py-2 bg-amber-500 text-gray-900 rounded hover:bg-amber-400"
          >
            Add Enricher
          </button>
          <button
            onClick={() => handleAddPlugin('generators')}
            className="px-4 py-2 bg-amber-500 text-gray-900 rounded hover:bg-amber-400"
          >
            Add Generator
          </button>
        </div>
        <button
          onClick={onSave}
          className="px-4 py-2 bg-amber-500 text-gray-900 rounded hover:bg-amber-400"
        >
          Save Configuration
        </button>
      </div>

      {/* Node Graph */}
      <div className="flex-1 p-4">
        <NodeGraph
          config={currentConfig}
          onConfigUpdate={onConfigUpdate}
        />
      </div>

      {/* Plugin Dialog */}
      {showPluginDialog && (
        <PluginParamDialog
          plugin={selectedPlugin || { type: 'sources', name: '', params: {} }}
          isOpen={showPluginDialog}
          onClose={() => {
            setShowPluginDialog(false);
            setSelectedPlugin(null);
          }}
          onAdd={(plugin) => {
            // Extract params and interval from the plugin object
            const updatedPlugin = {
              ...selectedPlugin!,
              params: plugin.params,
              interval: plugin.interval,
            };
            if (selectedPlugin) {
              handlePluginUpdate(updatedPlugin);
            } else {
              handlePluginAdd(updatedPlugin);
            }
          }}
        />
      )}
    </div>
  );
}; 