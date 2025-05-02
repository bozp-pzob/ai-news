import React, { useState, useEffect } from 'react';
import { Config } from './types';
import { getConfigs, saveConfig, getConfig, runAggregation } from './services/api';
import { NodeGraph } from './components/NodeGraph';
import { useWebSocket } from './hooks/useWebSocket';
import { configStateManager } from './services/ConfigStateManager';
import { useToast } from './components/ToastProvider';

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
  const { showToast } = useToast();

  // Use WebSocket hook for real-time status updates
  const { 
    status, 
    error: wsError, 
    isConnected: wsConnected,
    refreshStatus
  } = useWebSocket(selectedConfig);

  useEffect(() => {
    loadConfigs();
  }, []);

  // Update node statuses when websocket status updates come in
  useEffect(() => {
    if (status && wsConnected) {
      console.log('Received websocket status update:', status);
      // Update node statuses in ConfigStateManager
      configStateManager.updateNodeStatus(status);
    }
  }, [status, wsConnected]);

  // Refresh status periodically when connected
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (wsConnected && selectedConfig) {
      // Refresh status every 5 seconds
      intervalId = setInterval(() => {
        refreshStatus();
      }, 5000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [wsConnected, selectedConfig, refreshStatus]);

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
      showToast(`Failed to load configuration ${configName}. Please try again.`, 'error');
    }
  };

  const handleConfigUpdate = (config: Config, isReset?: boolean) => {
    setConfig(config);
    
    // Only set unsaved changes if this is not a reset operation
    if (!isReset) {
      setHasUnsavedChanges(true);
    }
    
    // Automatically enable the Save Config button when changes are made
    if (selectedConfig && !isReset) {
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

      await configStateManager.saveToServer()
      
      // // Force sync the config state manager to ensure all changes are captured
      // configStateManager.forceSync();
      
      // // Get the latest config directly from the state manager rather than using the local state
      // const latestConfig = configStateManager.getConfig();
      
      // // Ensure the name is properly set
      // latestConfig.name = configName;
      
      // // Save the LATEST config to the server
      // await saveConfig(configName, latestConfig);
      
      // // Update our local state with the latest config that was saved
      // setConfig(latestConfig);
      
      // // Update the selected config name if it was a new config
      // if (!selectedConfig) {
      //   setSelectedConfig(configName);
        
      //   // Also refresh the list of configs
      //   await loadConfigs();
      // }
      
      // Clear unsaved changes flag
      setHasUnsavedChanges(false);
      
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      showToast('Failed to save configuration. Please try again.', 'error');
      return false;
    }
  };

  // Handle running aggregation once
  const handleRunAggregation = async () => {
    try {
      if (!selectedConfig) {
        showToast('Please select or save a configuration first.', 'warning');
        return;
      }
      
      const configObject = await getConfig(selectedConfig);
      await runAggregation(selectedConfig, configObject);
      showToast(`Aggregation started for ${selectedConfig}`, 'info');
    } catch (error) {
      console.error('Error running aggregation:', error);
      showToast('Failed to run aggregation. Please try again.', 'error');
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
                  className="px-3 py-1 text-black bg-amber-300 rounded-md hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-gray-800"
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
            runAggregation={selectedConfig ? handleRunAggregation : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export default App; 