import React, { useState, useEffect } from 'react';
import { Config } from './types';
import { getConfigs, saveConfig, getConfig } from './services/api';
import { ConfigBuilder } from './components/ConfigBuilder';
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
  const [viewMode, setViewMode] = useState<'traditional' | 'comfyui'>('comfyui');

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
      const config = await getConfig(configName);
      setConfig(config);
    } catch (error) {
      console.error('Error loading config:', error);
    }
  };

  const handleConfigUpdate = (config: Config) => {
    setConfig(config);
  };

  const handleSave = async () => {
    if (selectedConfig && config) {
      try {
        await saveConfig(selectedConfig, config);
        await loadConfigs();
      } catch (error) {
        console.error('Error saving config:', error);
      }
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
              <button
                onClick={() => setViewMode(viewMode === 'traditional' ? 'comfyui' : 'traditional')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
              >
                Switch to {viewMode === 'traditional' ? 'ComfyUI' : 'Traditional'} View
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="h-[calc(100vh-4rem)]">
        {selectedConfig && config ? (
          viewMode === 'traditional' ? (
            <ConfigBuilder
              config={config}
              configName={selectedConfig}
              onConfigUpdate={handleConfigUpdate}
              onSave={handleSave}
            />
          ) : (
            <div className="h-full">
              <NodeGraph
                config={config}
                onConfigUpdate={handleConfigUpdate}
              />
            </div>
          )
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