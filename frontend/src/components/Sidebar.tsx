import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Config, PluginInfo } from '../types';
import { pluginRegistry } from '../services/PluginRegistry';
import { secretManager } from '../services/SecretManager';
import { configStateManager } from '../services/ConfigStateManager';
import { useToast } from './ToastProvider';
import { useConnections } from '../hooks/useExternalConnections';
import { useSecretPersistence } from '../hooks/useSecretPersistence';
import { PlatformType } from '../services/api';
import { ConnectPlatformDialog } from './ConnectPlatformDialog';
import { PlatformIcon, getPlatformDisplayName } from './connections/PlatformIcon';

interface SidebarProps {
  configs: string[];
  selectedConfig: string | null;
  onConfigSelect: (configName: string) => void;
  onNewConfig: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onOpenSecretsManager?: () => void;
  onOpenSecretSettings?: () => void;
  onUnlockDatabase?: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  hasUnsavedChanges: boolean;
  onRunAggregation?: () => Promise<void>;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onDragPlugin?: (plugin: PluginInfo, clientX: number, clientY: number) => void;
  config?: Config;
  onConfigNameSave?: (name: string) => void;
  viewMode?: 'graph' | 'json';
  onViewModeChange?: (mode: 'graph' | 'json') => void;
  saveConfiguration?: () => Promise<boolean>;
  resetConfiguration?: () => void;
  // Platform mode props
  platformMode?: boolean;
  isSaving?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  configs,
  selectedConfig,
  onConfigSelect,
  onNewConfig,
  onExportJSON,
  onImportJSON,
  onOpenSecretsManager,
  onOpenSecretSettings,
  onUnlockDatabase,
  fileInputRef,
  hasUnsavedChanges,
  onRunAggregation,
  activeTab,
  setActiveTab,
  onDragPlugin,
  config,
  onConfigNameSave,
  viewMode = 'graph',
  onViewModeChange,
  saveConfiguration,
  resetConfiguration,
  platformMode = false,
  isSaving = false
}) => {
  // Dropdown states
  const [configDropdownOpen, setConfigDropdownOpen] = useState(false);
  
  // Toast hook for notifications
  const { showToast } = useToast();
  
  // Config rename state
  const [isEditingConfigName, setIsEditingConfigName] = useState(false);
  const [configName, setConfigName] = useState('');
  
  // Module states - always start with checking if plugins are already loaded
  const [plugins, setPlugins] = useState<Record<string, PluginInfo[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    // Support both singular and plural keys
    sources: true,
    source: true,
    ai: true,
    enrichers: true,
    enricher: true,
    generators: true,
    generator: true,
    storage: true
  });
  
  // Secret persistence (state + logic extracted to hook)
  const secretPersistence = useSecretPersistence(activeTab, showToast);
  const {
    isPersistenceEnabled, setIsPersistenceEnabled,
    isPasswordProtected,
    password, setPassword,
    confirmPassword, setConfirmPassword,
    oldPassword, setOldPassword,
    isChangingPassword,
    loading,
    showRemovePasswordConfirm, setShowRemovePasswordConfirm,
    hasSavedPassword,
    isDatabaseLocked,
    handleSavePersistence,
    handleRemovePasswordConfirm,
    handlePasswordProtectedToggle,
  } = secretPersistence;
  
  // Update configName when config changes
  useEffect(() => {
    if (config && config.name) {
      setConfigName(config.name);
    }
  }, [config]);
  
  // Fetch user's external connections in platform mode
  // This is used to filter which platform-specific plugins to show
  const { connections, refetch: refetchConnections } = useConnections();
  
  // State for platform connection dialog
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [connectDialogPlatform, setConnectDialogPlatform] = useState<PlatformType | undefined>();
  
  // Create a Set of connected platform types for efficient lookup
  const connectedPlatforms = useMemo(() => {
    if (!platformMode || !connections || connections.length === 0) {
      return undefined;
    }
    const platforms = new Set<PlatformType>();
    for (const conn of connections) {
      if (conn.isActive) {
        platforms.add(conn.platform);
      }
    }
    return platforms.size > 0 ? platforms : undefined;
  }, [platformMode, connections]);
  
  // Get platforms that have plugins but aren't connected
  // This is used to show "Connect X" prompts in the sidebar
  const unconnectedPlatforms = useMemo(() => {
    if (!platformMode || isLoading) return [];
    
    // Get all plugins (unfiltered) to find which platforms have plugins
    const allPlugins = pluginRegistry.getPlugins();
    const platformsWithPlugins: PlatformType[] = [];
    
    for (const categoryPlugins of Object.values(allPlugins)) {
      for (const plugin of categoryPlugins) {
        if (plugin.requiresPlatform && !plugin.hidden) {
          if (!platformsWithPlugins.includes(plugin.requiresPlatform)) {
            platformsWithPlugins.push(plugin.requiresPlatform);
          }
        }
      }
    }
    
    // Filter to only platforms that aren't connected
    return platformsWithPlugins.filter(platform => 
      !connectedPlatforms || !connectedPlatforms.has(platform)
    );
  }, [platformMode, connectedPlatforms, isLoading, plugins]);
  
  // Handle connection success
  const handleConnectionSuccess = () => {
    setConnectDialogOpen(false);
    refetchConnections();
  };
  
  // Load plugins - in platform mode, load immediately; otherwise when on modules tab
  React.useEffect(() => {
    const shouldLoadPlugins = platformMode || activeTab === 'modules' || activeTab === 'plugins';
    
    if (!shouldLoadPlugins) {
      return;
    }

    // Function to update state with plugins
    const updatePlugins = () => {
      // Filter plugins based on platform mode and user's connections
      const loadedPlugins = pluginRegistry.getPluginsFiltered({
        platformMode,
        connectedPlatforms,
      });
      setPlugins(loadedPlugins);
      setIsLoading(false);
    };

    // If already loaded, update immediately
    if (pluginRegistry.isPluginsLoaded()) {
      updatePlugins();
      return;
    }

    // Subscribe to updates
    const unsubscribe = pluginRegistry.subscribe(updatePlugins);

    // Trigger loading
    pluginRegistry.loadPlugins().then(() => {
      // Also check after load completes in case notification was missed
      if (pluginRegistry.isPluginsLoaded()) {
        updatePlugins();
      }
    });

    return unsubscribe;
  }, [activeTab, platformMode, connectedPlatforms]);
  
  // Handle saving the config name
  const handleSaveConfigName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (onConfigNameSave && configName.trim()) {
      onConfigNameSave(configName.trim());
      setIsEditingConfigName(false);
    }
  };
  
  // Handler for starting drag
  const handleDragStart = (plugin: PluginInfo, e: React.DragEvent<HTMLDivElement>) => {
    if (!onDragPlugin) return;
    
    e.dataTransfer.setData('application/json', JSON.stringify(plugin));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Set a drag image with yellow amber styling
    const dragImg = document.createElement('div');
    dragImg.textContent = "_";
    document.body.appendChild(dragImg);
    e.dataTransfer.setDragImage(dragImg, 0, 0);
    
    // Pass the plugin and position to parent
    onDragPlugin(plugin, e.clientX, e.clientY);
    
    // Clean up drag image after a short delay
    setTimeout(() => {
      document.body.removeChild(dragImg);
    }, 100);
  };

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Filter plugins based on search term
  const filterPlugins = (plugin: PluginInfo) => {
    // First check if the plugin has constructorInterface.parameters
    if (!plugin.constructorInterface || !plugin.constructorInterface.parameters || 
        plugin.constructorInterface.parameters.length === 0) {
      return false;
    }
    
    // Then apply search term filter if there is one
    if (!searchTerm) return true;
    return plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
           plugin.description.toLowerCase().includes(searchTerm.toLowerCase());
  };
  
  // Handle view mode toggle
  const handleViewModeToggle = () => {
    if (onViewModeChange) {
      if (viewMode === 'graph') {
        // Force a sync before switching to JSON view, but don't mark as having pending changes
        configStateManager.forceSync(false);
      }
      onViewModeChange(viewMode === 'graph' ? 'json' : 'graph');
    }
  };
  
  // Render plugins/modules content - shared between platform mode and legacy 'modules' tab
  const renderPluginsContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-amber-100/20">
        <h3 className="text-lg font-medium text-amber-300">
          {platformMode ? 'Available Plugins' : 'Available Modules'}
        </h3>
        
        {/* Search input */}
        <div className="mt-3 relative">
          <input
            type="text"
            placeholder="Search plugins..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 bg-stone-800 rounded-md border border-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm placeholder-gray-500 text-gray-200"
          />
        </div>
        
        {/* Platform mode: View toggle and Save button */}
        {platformMode && (
          <div className="mt-4 space-y-3">
            {/* View mode toggle */}
            <div className="flex rounded-md overflow-hidden bg-stone-800 border border-stone-700">
              <button
                onClick={() => onViewModeChange && onViewModeChange('graph')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium flex items-center justify-center ${
                  viewMode === 'graph' 
                    ? 'bg-amber-500/20 text-amber-300' 
                    : 'hover:bg-stone-700 hover:text-amber-300/80 text-stone-400'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                </svg>
                Graph
              </button>
              <button
                onClick={() => onViewModeChange && onViewModeChange('json')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium flex items-center justify-center ${
                  viewMode === 'json' 
                    ? 'bg-amber-500/20 text-amber-300' 
                    : 'hover:bg-stone-700 hover:text-amber-300/80 text-stone-400'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                </svg>
                JSON
              </button>
            </div>
            
            {/* Save button */}
            {saveConfiguration && (
              <button
                onClick={saveConfiguration}
                disabled={!hasUnsavedChanges || isSaving}
                className={`w-full py-2 rounded text-sm flex items-center justify-center ${
                  hasUnsavedChanges && !isSaving
                    ? 'bg-amber-400 hover:bg-amber-500 text-black'
                    : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                }`}
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-stone-400 border-t-transparent rounded-full animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Save Config
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
      
      <div className="overflow-y-auto flex-grow p-4">
        {isLoading ? (
          <div className="flex flex-col justify-center items-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
            <span className="mt-3 text-sm text-amber-100/60">Loading plugins...</span>
          </div>
        ) : (
          <>
            {Object.keys(plugins).length === 0 ? (
              <div className="text-center py-8 text-amber-100/60">
                No plugins available
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(plugins).map(([categoryKey, categoryPlugins]) => {
                  // Find category info by id (support both singular and plural keys)
                  const category = {
                    sources: 'Data Sources',
                    source: 'Data Sources',
                    ai: 'AI & ML Models',
                    enrichers: 'Data Processors',
                    enricher: 'Data Processors',
                    generators: 'Content Creators',
                    generator: 'Content Creators',
                    storage: 'Data Storage'
                  }[categoryKey] || categoryKey;
                  
                  const filteredPlugins = categoryPlugins.filter(filterPlugins);
                  
                  // Skip empty categories when searching
                  if (searchTerm && filteredPlugins.length === 0) return null;
                  
                  return (
                    <div key={categoryKey} className="pb-2">
                      <button
                        onClick={() => toggleCategory(categoryKey)}
                        className="flex justify-between items-center w-full px-2 py-2 rounded-md hover:bg-stone-800"
                      >
                        <h4 className="text-sm font-medium text-amber-300 flex items-center">
                          {category}
                          <span className="ml-2 text-xs text-amber-100/60">
                            ({filteredPlugins.length})
                          </span>
                        </h4>
                        <svg 
                          xmlns="http://www.w3.org/2000/svg" 
                          className={`h-4 w-4 transition-transform ${expandedCategories[categoryKey] ? 'rotate-180' : ''}`} 
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {expandedCategories[categoryKey] && (
                        <div className="mt-2 space-y-2 pl-2">
                          {/* Show "Connect Platform" prompts for unconnected platforms in sources category */}
                          {platformMode && (categoryKey === 'sources' || categoryKey === 'source') && unconnectedPlatforms.map(platform => (
                            <button
                              key={`connect-${platform}`}
                              onClick={() => {
                                setConnectDialogPlatform(platform);
                                setConnectDialogOpen(true);
                              }}
                              className="w-full bg-stone-800/50 p-3 rounded-md border border-dashed border-stone-600 hover:border-amber-400 hover:bg-stone-800 transition-all text-left group"
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded bg-stone-700 group-hover:bg-amber-500/20 flex items-center justify-center flex-shrink-0 transition-colors">
                                  <PlatformIcon platform={platform} size="sm" className="text-stone-400 group-hover:text-amber-400 transition-colors" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-300 group-hover:text-amber-300 transition-colors">
                                    {getPlatformDisplayName(platform)}Source
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    Connect to unlock this plugin
                                  </div>
                                </div>
                                <svg className="w-4 h-4 text-stone-500 group-hover:text-amber-400 flex-shrink-0 mt-1 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                              </div>
                            </button>
                          ))}
                          
                          {filteredPlugins.map(plugin => (
                            <div
                              key={`${plugin.type}-${plugin.name}`}
                              draggable={true}
                              onDragStart={(e) => handleDragStart(plugin, e)}
                              className="bg-stone-800 p-3 rounded-md border border-stone-700 hover:border-amber-400/50 transition-colors cursor-move"
                              title={plugin.description}
                            >
                              <div className="text-sm font-medium text-gray-300">{plugin.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Connect Platform Dialog */}
      {platformMode && (
        <ConnectPlatformDialog
          isOpen={connectDialogOpen}
          onClose={() => {
            setConnectDialogOpen(false);
            setConnectDialogPlatform(undefined);
            // Always refetch connections when dialog closes
            // This handles webhook-based platforms (Telegram) where 
            // connection happens asynchronously
            refetchConnections();
          }}
          platform={connectDialogPlatform}
          onConnected={handleConnectionSuccess}
        />
      )}
    </div>
  );

  // Tab content rendering
  const renderTabContent = () => {
    // In platform mode, always show plugins/modules content
    if (platformMode) {
      return renderPluginsContent();
    }
    
    switch (activeTab) {
      case 'configs':
        return (
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-medium text-amber-300">Configurations</h3>
            </div>
            
            {/* View mode toggle */}
            <div className="flex items-center text-stone-400">
              <div className="flex rounded-md overflow-hidden bg-stone-800 border border-stone-700">
                <button
                  onClick={() => onViewModeChange && onViewModeChange('graph')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center ${
                    viewMode === 'graph' 
                      ? 'bg-amber-500/20 text-amber-300' 
                      : 'hover:bg-stone-700 hover:text-amber-300/80'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                  </svg>
                  Graph
                </button>
                <button
                  onClick={() => onViewModeChange && onViewModeChange('json')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center ${
                    viewMode === 'json' 
                      ? 'bg-amber-500/20 text-amber-300' 
                      : 'hover:bg-stone-700 hover:text-amber-300/80'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  JSON
                </button>
              </div>
            </div>
            
            {/* Configuration Actions */}
            {selectedConfig && (
              <div className="space-y-2">
                <div className="flex flex-col gap-2">
                  <button
                    onClick={saveConfiguration}
                    disabled={!hasUnsavedChanges}
                    className={`w-full py-1.5 rounded text-sm flex items-center justify-center ${
                      hasUnsavedChanges 
                        ? 'bg-amber-400 hover:bg-amber-500 text-black'
                        : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    Save Config
                  </button>
                  
                  <button
                    onClick={resetConfiguration}
                    disabled={!hasUnsavedChanges}
                    className={`w-full py-1.5 rounded text-sm flex items-center justify-center ${
                      hasUnsavedChanges 
                        ? 'bg-stone-700 hover:bg-stone-600 text-white'
                        : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset Config
                  </button>
                </div>
              </div>
            )}
            
            <div className="mb-3">
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-medium text-amber-300">Current Configuration</label>
                  <button 
                    onClick={onNewConfig}
                    className="text-xs px-2 py-0.5 bg-stone-800 text-white rounded hover:bg-stone-700 border border-stone-700"
                    title="Create new configuration"
                  >
                    + New
                  </button>
                </div>
                
                <button
                  onClick={() => setConfigDropdownOpen(!configDropdownOpen)}
                  className="w-full px-2.5 py-1.5 bg-stone-800 text-white rounded-md border border-stone-700 flex justify-between items-center hover:bg-stone-700 text-sm"
                >
                  <span className="truncate">{selectedConfig || "Select a configuration"}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {configDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-stone-800 rounded-md shadow-lg max-h-60 overflow-auto">
                    {configs.length > 0 ? (
                      configs.map((config) => (
                        <button
                          key={config}
                          onClick={() => {
                            onConfigSelect(config);
                            setConfigDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-stone-700 text-sm ${
                            selectedConfig === config ? 'bg-stone-700' : ''
                          }`}
                        >
                          {config}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-gray-400 text-sm">No configurations available</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Configuration Name Settings */}
            {selectedConfig && config && onConfigNameSave && (
              <div className="mb-3 bg-stone-800/70 p-2.5 rounded-md border border-stone-700">
                {isEditingConfigName ? (
                  <form onSubmit={handleSaveConfigName} className="space-y-2">
                    <input
                      type="text"
                      id="configName"
                      value={configName}
                      onChange={(e) => setConfigName(e.target.value)}
                      className="p-1.5 w-full rounded-md border-stone-600 bg-stone-700 text-gray-200 shadow-sm focus:border-amber-500 focus:ring-amber-500 text-sm"
                      required
                      placeholder="Enter configuration name"
                    />
                    <div className="flex justify-end space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingConfigName(false);
                          setConfigName(config.name || '');
                        }}
                        className="px-2 py-0.5 text-xs bg-stone-700 text-white rounded hover:bg-stone-600 border border-stone-600"
                      >
                        Cancel
                      </button>
              <button
                        type="submit"
                        className="px-2 py-0.5 text-xs bg-amber-500 text-black rounded hover:bg-amber-400"
              >
                        Save
              </button>
            </div>
                  </form>
                ) : (
                  <div className="w-full flex flex-row justify-between items-center">
                    <div className="text-sm text-gray-300 truncate py-1">{config.name || "Unnamed configuration"}</div>
                    <div className="flex items-center justify-between mb-1">
                    {!isEditingConfigName && (
                      <button
                        onClick={() => {
                          setConfigName(config.name || '');
                          setIsEditingConfigName(true);
                        }}
                        className="text-amber-400 hover:text-amber-300 bg-stone-700 p-1 rounded"
                        title="Rename configuration"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                )}
              </div>
            )}
            
            {/* Import/Export */}
            <div className="space-y-1">
              <label className="block text-xs font-medium text-amber-300 mb-4">Import/Export</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onExportJSON}
                  className="px-2 py-1.5 bg-stone-800 text-white rounded-md hover:bg-stone-700 border border-stone-700 flex items-center justify-center text-xs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" className="mr-1">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                  </svg>
                  Export Config
                </button>
                
                <button
                  onClick={onImportJSON}
                  className="px-2 py-1.5 bg-stone-800 text-white rounded-md hover:bg-stone-700 border border-stone-700 flex items-center justify-center text-xs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" className="mr-1">
                    <path d="M.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5H.5zm1 5.5A.5.5 0 0 1 2 8h12a.5.5 0 0 1 0 1H2a.5.5 0 0 1-.5-.5z"/>
                    <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
                  </svg>
                  Import Config
                </button>
              </div>
            </div>
          </div>
        );
      
      case 'modules':
        return renderPluginsContent();
      
      case 'secrets':
        return (
          <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
            <h3 className="text-lg font-medium text-amber-300 mb-2">Secrets Management</h3>
            
            <div className="flex flex-col space-y-3">
              <button
                onClick={onOpenSecretsManager}
                className="w-full px-3 py-3 bg-stone-800 text-white rounded-md hover:bg-stone-700 border border-amber-400/30 flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="mr-2">
                  <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                </svg>
                Manage Secrets
              </button>
              
              {/* Add Unlock Database button only if the database is locked */}
              {isPersistenceEnabled && isPasswordProtected && isDatabaseLocked && onUnlockDatabase && (
                <button
                  onClick={onUnlockDatabase}
                  className="w-full px-3 py-3 bg-stone-800 text-white rounded-md hover:bg-stone-700 border border-amber-400/30 flex items-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="mr-2">
                    <path d="M3.5 11.5a3.5 3.5 0 1 1 3.163-5H14L15.5 8 14 9.5l-1-1-1 1-1-1-1 1-1-1-1 1H6.663a3.5 3.5 0 0 1-3.163 2zM2.5 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
                  </svg>
                  Unlock Database
                </button>
              )}
            </div>
            
            <div className="mt-6">
              <h4 className="text-sm font-medium text-amber-300 mb-3">Secret Persistence</h4>
              
              {/* Error and success messages have been replaced by Toast notifications */}
              
              <p className="text-xs text-gray-300 mb-3">
                By default, secrets are only stored in memory and will be lost when you refresh or close the page.
                Enable secure persistence to keep your secrets available between browser sessions.
              </p>
              
              <div className="space-y-3">
                <div className="flex items-center">
                  <input
                    id="enablePersistence"
                    type="checkbox"
                    checked={isPersistenceEnabled}
                    onChange={(e) => setIsPersistenceEnabled(e.target.checked)}
                    disabled={loading}
                    className="rounded text-amber-500 focus:ring-amber-500 mr-2 disabled:opacity-50"
                    style={{ width: '16px', height: '16px' }}
                  />
                  <label htmlFor="enablePersistence" className="text-sm font-medium">
                    Enable secret persistence
                  </label>
                </div>
                
                {isPersistenceEnabled && (
                    <div className="bg-blue-900/20 border border-blue-500/30 text-blue-200 px-3 py-2 rounded mb-3 text-xs">
                      Secrets will be stored in your browser using encrypted storage.
                      They will never be sent to any server except when needed for API calls.
                    </div>
                )}
                    
                    <div className="flex items-center">
                      <input
                        id="passwordProtect"
                        type="checkbox"
                        checked={isPasswordProtected}
                    onChange={(e) => handlePasswordProtectedToggle(e.target.checked)}
                    disabled={loading || !isPersistenceEnabled}
                    className="rounded text-amber-500 focus:ring-amber-500 disabled:opacity-50 mr-2"
                    style={{ width: '16px', minWidth: '16px', height: '16px', minHeight: '16px' }}
                  />
                  <label htmlFor="passwordProtect" className={`text-sm font-medium ${!isPersistenceEnabled ? 'text-gray-500' : ''}`}>
                        Protect with password (recommended)
                      </label>
                    </div>
                    
                {/* Password Protection Confirmation Dialog */}
                {showRemovePasswordConfirm && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-stone-800 p-4 rounded-md shadow-lg w-80 border border-amber-400/30 shadow-amber-300/5">
                      <h4 className="text-amber-300 font-medium mb-2">Remove Password Protection?</h4>
                      <p className="text-xs text-gray-300 mb-4">
                        WARNING: This will permanently delete all your encrypted secrets and secure data.
                        This action is designed to help when you've forgotten your password, but it means all protected data will be lost.
                        This cannot be undone. Do you want to proceed?
                      </p>
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => setShowRemovePasswordConfirm(false)}
                          className="px-3 py-1.5 bg-stone-700 text-white text-xs rounded-md hover:bg-stone-600"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleRemovePasswordConfirm}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-md hover:bg-red-700"
                        >
                          Remove Protection & Delete Data
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Show the old password field when password protection is already enabled */}
                {isPersistenceEnabled && isPasswordProtected && ((secretManager.persistenceState?.passwordProtected && hasSavedPassword) || isChangingPassword) && (
                  <div className="mt-4">
                    <div className="mb-4">
                      <label htmlFor="old-password" className="block text-xs font-medium mb-1">
                        Current Password
                              </label>
                              <input
                                type="password"
                        id="old-password"
                        className="w-full bg-stone-700 border border-stone-600 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                        disabled={loading || !isPersistenceEnabled}
                        placeholder="Enter your current password"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        Enter your current password to update to a new password
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Show password fields when password protection is enabled */}
                {isPersistenceEnabled && isPasswordProtected && (
                  <div className="mt-4">
                    <div className="mb-4">
                      <label htmlFor="password" className="block text-xs font-medium mb-1">
                        {isChangingPassword ? "New Password" : "Password"}
                          </label>
                          <input
                            type="password"
                        id="password"
                        className="w-full bg-stone-700 border border-stone-600 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        disabled={loading || !isPersistenceEnabled}
                        placeholder="Enter a password with at least 8 characters"
                          />
                        </div>
                    <div className="mb-4">
                      <label htmlFor="confirm-password" className="block text-xs font-medium mb-1">
                        {isChangingPassword ? "Confirm New Password" : "Confirm Password"}
                          </label>
                          <input
                            type="password"
                        id="confirm-password"
                        className="w-full bg-stone-700 border border-stone-600 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={loading || !isPersistenceEnabled}
                        placeholder="Confirm your password"
                          />
                        </div>
                        
                    <p className="text-xs text-gray-400 mb-4">
                      {isChangingPassword 
                        ? "Your new password will be used to encrypt your secrets. Make sure to remember it." 
                        : "This password will be used to encrypt your secrets. If you forget this password, you will lose access to your stored secrets."}
                        </p>
                      </div>
                )}
                
                <div className="pt-2">
                  <button
                    onClick={handleSavePersistence}
                    disabled={loading}
                    className="w-full px-3 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </span>
                    ) : "Save Settings"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="bg-stone-900 border-r border-amber-100/20 h-full flex flex-col overflow-hidden" style={{ width: '270px' }}>
      {/* Navigation Tabs */}
      <div className="flex border-b border-amber-100/20 shrink-0">
        {/* In platform mode, only show Plugins tab */}
        {platformMode ? (
          <button
            className="flex-1 py-2 text-center text-sm text-amber-300 border-b-2 border-amber-300"
          >
            Plugins
          </button>
        ) : (
          <>
            <button
              className={`flex-1 py-2 text-center text-sm ${
                activeTab === 'configs' 
                  ? 'text-amber-300 border-b-2 border-amber-300' 
                  : 'text-amber-100/60 hover:text-amber-100'
              }`}
              onClick={() => setActiveTab('configs')}
            >
              Configs
            </button>
            <button
              className={`flex-1 py-2 text-center text-sm ${
                activeTab === 'modules' 
                  ? 'text-amber-300 border-b-2 border-amber-300' 
                  : 'text-amber-100/60 hover:text-amber-100'
              }`}
              onClick={() => setActiveTab('modules')}
            >
              Modules
            </button>
            <button
              className={`flex-1 py-2 text-center text-sm ${
                activeTab === 'secrets' 
                  ? 'text-amber-300 border-b-2 border-amber-300' 
                  : 'text-amber-100/60 hover:text-amber-100'
              }`}
              onClick={() => setActiveTab('secrets')}
            >
              Secrets
            </button>
          </>
        )}
      </div>
      
      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {renderTabContent()}
      </div>
      
      {/* Footer with Status */}
      {selectedConfig && (
        <div className="px-4 py-3 border-t border-amber-100/20 text-xs text-amber-100/60 shrink-0">
          <div className="flex items-center">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
            <span>Configuration: {selectedConfig}</span>
          </div>
          {hasUnsavedChanges && (
            <div className="flex items-center mt-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 mr-2"></span>
              <span>Unsaved changes</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Sidebar; 