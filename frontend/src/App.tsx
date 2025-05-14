import React, { useState, useEffect, useRef } from 'react';
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
  
  // Add file input ref for importing JSON
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      
      setConfig(sanitizedConfig);
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

  // Handle export config as JSON
  const handleExportJSON = () => {
    try {
      // Make sure everything is in sync before exporting
      configStateManager.forceSync();
      
      // Get the current config from ConfigStateManager
      const currentConfig = configStateManager.getConfig();
      
      // Convert the config to a JSON string with pretty formatting
      const jsonString = JSON.stringify(currentConfig, null, 2);
      
      // Create a blob from the JSON string
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      // Create a URL for the blob
      const url = URL.createObjectURL(blob);
      
      // Create a temporary anchor element to trigger the download
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentConfig.name || 'config'}.json`;
      document.body.appendChild(a);
      
      // Trigger the download
      a.click();
      
      // Clean up
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('Configuration exported successfully', 'success');
    } catch (error) {
      console.error('Error exporting config:', error);
      showToast('Failed to export configuration', 'error');
    }
  };
  
  // Handle import config from JSON
  const handleImportJSON = () => {
    // Trigger the file input click
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  // Handle the actual file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const importedConfig = JSON.parse(content) as Config;
        
        // Validate the imported config has the minimum required structure
        if (!importedConfig || typeof importedConfig !== 'object') {
          throw new Error('Invalid configuration format');
        }
        
        // Initialize the minimum required fields if not present
        if (!importedConfig.name) {
          const userProvidedName = prompt('Please provide a name for this imported configuration:', 'imported-config');
          if (!userProvidedName) {
            throw new Error('Configuration name is required');
          }
          importedConfig.name = userProvidedName;
        }
        
        // Ensure all required arrays exist
        importedConfig.sources = importedConfig.sources || [];
        importedConfig.enrichers = importedConfig.enrichers || [];
        importedConfig.generators = importedConfig.generators || [];
        importedConfig.ai = importedConfig.ai || [];
        importedConfig.storage = importedConfig.storage || [];
        importedConfig.providers = importedConfig.providers || [];
        
        // Ensure settings object exists
        importedConfig.settings = importedConfig.settings || {
          runOnce: false,
          onlyFetch: false
        };
        
        // Load the imported config
        configStateManager.loadConfig(importedConfig);
        configStateManager.forceSync();
        
        // Update local state
        setConfig(importedConfig);
        setSelectedConfig(importedConfig.name);
        
        // Update hasUnsavedChanges
        setHasUnsavedChanges(true);
        
        // Reset the file input so the same file can be imported again if needed
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        
        showToast(`Configuration "${importedConfig.name}" imported successfully`, 'success');
      } catch (error) {
        console.error('Error importing config:', error);
        showToast('Failed to import configuration: ' + (error instanceof Error ? error.message : 'Invalid format'), 'error');
        
        // Reset the file input so the user can try again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-stone-950 text-white">
      {/* Hidden file input for JSON import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".json"
        className="hidden"
      />
      
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
                
                {/* Export JSON button */}
                <button
                  onClick={handleExportJSON}
                  className="px-3 py-1 bg-stone-800 text-amber-300 border border-amber-400/30 rounded-md hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-gray-800 flex items-center"
                  title="Export configuration as JSON"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="mr-1.5">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                  </svg>
                  Export
                </button>
                
                {/* Import JSON button */}
                <button
                  onClick={handleImportJSON}
                  className="px-3 py-1 bg-stone-800 text-amber-300 border border-amber-400/30 rounded-md hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-gray-800 flex items-center"
                  title="Import configuration from JSON"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="mr-1.5">
                    <path d="M.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H.5zm1 5.5A.5.5 0 0 1 2 8h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5z"/>
                    <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
                  </svg>
                  Import
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