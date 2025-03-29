import React, { useState, useEffect } from 'react';
import { Config } from './types';
import { getConfigs, saveConfig, getConfig } from './services/api';
import { NodeGraph } from './components/NodeGraph';

function App() {
  const [configs, setConfigs] = useState<string[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
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

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const configList = await getConfigs();
      setConfigs(configList);
    } catch (error) {
      console.error('Error loading configs:', error);
    }
  };

  const handleConfigSelect = (configName: string) => {
    setSelectedConfig(configName);
    loadConfig(configName);
  };

  const loadConfig = async (configName: string) => {
    try {
      console.log(`Loading configuration: ${configName}`);
      
      // Show loading indicator or disable UI here if needed
      
      const loadedConfig = await getConfig(configName);
      
      if (!loadedConfig) {
        throw new Error('Received empty configuration from server');
      }
      
      // Ensure all required properties exist
      const sanitizedConfig = {
        name: configName, // Ensure the name is set correctly
        sources: loadedConfig.sources || [],
        ai: loadedConfig.ai || [],
        enrichers: loadedConfig.enrichers || [],
        generators: loadedConfig.generators || [],
        providers: loadedConfig.providers || [],
        storage: loadedConfig.storage || [],
        settings: loadedConfig.settings || {
          runOnce: false,
          onlyFetch: false
        }
      };
      
      // Update the state with the fully-validated config
      console.log(`Setting config state with:`, sanitizedConfig);
      setConfig(sanitizedConfig);
      
      console.log(`Configuration ${configName} loaded successfully`);
    } catch (error) {
      console.error('Error loading config:', error);
      alert(`Failed to load configuration ${configName}. Please try again.`);
    }
  };

  const handleConfigUpdate = (config: Config) => {
    console.log('Config update received:', config);
    
    // Update the local state
    setConfig(config);
    
    // Save the config to the server automatically whenever there's an update
    if (selectedConfig) {
      console.log('Auto-saving config update to server:', selectedConfig);
      saveConfig(selectedConfig, config)
        .then(() => {
          console.log(`Configuration ${selectedConfig} auto-saved successfully`);
        })
        .catch(error => {
          console.error('Error auto-saving config:', error);
          alert('Failed to save configuration changes. Please try the Save button or refresh the page.');
        });
    }
  };

  const handleSave = async () => {
    if (!selectedConfig || !config) {
      alert('No configuration is selected or loaded.');
      return;
    }
    
    try {
      console.log(`Manually saving configuration: ${selectedConfig}`);
      
      // Ensure the config has the correct name
      const configToSave = {
        ...config,
        name: selectedConfig
      };
      
      // Save to the server
      await saveConfig(selectedConfig, configToSave);
      console.log(`Configuration ${selectedConfig} saved successfully`);
      
      // Refresh the config list in case a new one was created
      await loadConfigs();
      
      // Show success message
      alert(`Configuration "${selectedConfig}" saved successfully.`);
    } catch (error) {
      console.error('Error saving config:', error);
      alert(`Failed to save configuration "${selectedConfig}". ${error instanceof Error ? error.message : 'Please try again.'}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top Bar */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">AI News Configuration</h1>
              <div className="ml-8">
                <select
                  value={selectedConfig || ''}
                  onChange={(e) => handleConfigSelect(e.target.value)}
                  className="bg-gray-700 text-white rounded-md border-gray-600 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                >
                  <option value="">Select a configuration</option>
                  {configs.map((config) => (
                    <option key={config} value={config}>
                      {config}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {selectedConfig && (
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                >
                  Save Config
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="h-[calc(100vh-4rem)]">
        {selectedConfig && config ? (
          <div className="h-full">
            <NodeGraph
              config={config}
              onConfigUpdate={handleConfigUpdate}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-4">Welcome to AI News Configuration</h2>
              <p className="text-gray-400">Select a configuration from the dropdown above to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App; 