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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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
    setConfig(config);
    
    // Set unsaved changes flag when config is updated
    setHasUnsavedChanges(true);
    
    // Automatically enable the Save Config button when changes are made
    if (selectedConfig) {
      console.log(`Config "${selectedConfig}" updated, ready to save`);
    }
  };
  
  // Function to save the current configuration that can be called by child components
  const saveConfiguration = async () => {
    return await handleSave();
  };

  // Handle saving the configuration
  const handleSave = async () => {
    try {
      if (!config) {
        console.error('No configuration to save');
        return false;
      }
      
      // If the configuration needs a name, prompt for it
      let configName = selectedConfig || '';
      if (!configName || configName.trim() === '') {
        const userInput = prompt('Please enter a name for this configuration:', 'my-config');
        if (!userInput || userInput.trim() === '') {
          return false; // User cancelled or provided empty name
        }
        configName = userInput.trim();
      }
      
      // Save the config with the proper name
      config.name = configName;
      await saveConfig(configName, config);
      
      // Update the selected config name if it was a new config
      if (!selectedConfig) {
        setSelectedConfig(configName);
        
        // Also refresh the list of configs
        await loadConfigs();
      }
      
      // Clear unsaved changes flag
      setHasUnsavedChanges(false);
      
      alert(`Configuration ${configName} saved successfully`);
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      alert('Failed to save configuration. Please try again.');
      return false;
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* Top Bar */}
      <div className="bg-stone-900 border-b border-amber-100/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">AI News Configuration</h1>
              <div className="ml-8 flex items-center space-x-4">
                <select
                  value={selectedConfig || ''}
                  onChange={(e) => handleConfigSelect(e.target.value)}
                  className="px-2 py-1 bg-stone-500 text-white rounded-md border-gray-600 shadow-sm focus:border-amber-400 focus:ring-amber-400"
                >
                  <option value="">Select a configuration</option>
                  {configs.map((config) => (
                    <option key={config} value={config}>
                      {config}
                    </option>
                  ))}
                </select>
                
                <button
                  onClick={() => {
                    // Clear selected config and reset state to empty
                    setSelectedConfig(null);
                    setConfig({
                      name: '',
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
                    setHasUnsavedChanges(false);
                  }}
                  className="px-3 py-1 bg-amber-500 text-gray-900 rounded-md hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-gray-800"
                >
                  New Config
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="h-[calc(100vh-4rem)]">
        <div className="h-full">
          <NodeGraph
            config={selectedConfig ? config : {
              name: '',
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
            }}
            onConfigUpdate={handleConfigUpdate}
            saveConfiguration={saveConfiguration}
          />
        </div>
      </div>
    </div>
  );
}

export default App; 