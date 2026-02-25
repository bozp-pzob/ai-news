import React, { useState, useEffect, useRef } from 'react';
import { Config, PluginInfo } from './types';
import { getConfigs, saveConfig, getConfig, runAggregation } from './services/api';
import { NodeGraph } from './components/NodeGraph';
import { useWebSocket } from './hooks/useWebSocket';
import { configStateManager } from './services/ConfigStateManager';
import { useToast } from './components/ToastProvider';
import { SecretsManagerDialog } from './components/SecretsManagerDialog';
import { ResetDialog } from './components/ResetDialog';
import Sidebar from './components/Sidebar';
import { secretManager } from './services/SecretManager';
import { UnlockDatabaseDialog } from './components/UnlockDatabaseDialog';
import { createEmptyConfig, sanitizeConfig, createDefaultPlatformConfig } from './utils/configDefaults';



/**
 * Props for platform mode integration
 */
interface AppProps {
  // Platform mode - when true, uses platform API instead of legacy API
  platformMode?: boolean;
  // Platform config ID (for edit mode)
  platformConfigId?: string;
  // Platform config JSON (pre-loaded config for edit mode)
  platformConfigJson?: any;
  // Callback when saving in platform mode
  onPlatformSave?: (configJson: any) => Promise<boolean>;
  // Callback to open config settings panel
  onOpenConfigSettings?: () => void;
  // Whether a save operation is in progress
  isSaving?: boolean;
  // Config name (for display in platform mode)
  configName?: string;
  // Whether user is a pro user (for platform storage option)
  isPlatformPro?: boolean;
}

function App({
  platformMode = false,
  platformConfigId,
  platformConfigJson,
  onPlatformSave,
  onOpenConfigSettings,
  isSaving: externalIsSaving = false,
  configName: externalConfigName,
  isPlatformPro = false,
}: AppProps = {}) {
  const [configs, setConfigs] = useState<string[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(createEmptyConfig());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [secretSettingsOpen, setSecretSettingsOpen] = useState(false);
  const [secretsManagerOpen, setSecretsManagerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('configs'); // State for sidebar tab
  const [viewMode, setViewMode] = useState<'graph' | 'json'>('graph'); // State for view mode
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [unlockDatabaseOpen, setUnlockDatabaseOpen] = useState(false);
  const [_databaseLocked, setDatabaseLocked] = useState(false);
  const { showToast } = useToast();
  
  // Track the last processed config to prevent duplicate processing
  const lastProcessedConfigRef = useRef<string | null>(null);

  // Reference to the NodeGraph component for accessing its functions
  const nodeGraphRef = useRef<any>(null);
  
  // Add file input ref for importing JSON
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use WebSocket hook for real-time status updates
  const { 
    status, 
    error: _wsError, 
    isConnected: wsConnected,
    refreshStatus
  } = useWebSocket(selectedConfig);

  // Add a flag to track if we're currently in a reset operation
  const [isResetting, setIsResetting] = useState(false);
  
  // Add a flag to track if we're currently loading a config (to prevent false unsaved changes)
  const isLoadingRef = useRef(false);

  useEffect(() => {
    // In platform mode, we don't load configs from legacy API
    if (!platformMode) {
      loadConfigs();
    }
  }, [platformMode]);

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

  // Initialize SecretManager on app startup (only in legacy mode)
  useEffect(() => {
    if (platformMode) return; // Skip in platform mode
    
    console.log('App starting, initializing SecretManager...');
    secretManager.initialize().then(() => {
      console.log('SecretManager initialized in App component');
      checkDatabaseLockStatus();
    }).catch(error => {
      console.error('Error initializing SecretManager in App component:', error);
    });
  }, [platformMode]);

  // Load platform config when provided
  useEffect(() => {
    if (platformMode && platformConfigJson) {
      // Set loading flag to prevent false unsaved changes detection
      isLoadingRef.current = true;
      
      const sanitizedConfig = sanitizeConfig(platformConfigJson, externalConfigName || platformConfigJson.name);
      setConfig(sanitizedConfig);
      setSelectedConfig(sanitizedConfig.name || null);
      configStateManager.loadConfig(sanitizedConfig);
      
      // Reset loading flag after a short delay to allow events to propagate
      setTimeout(() => {
        isLoadingRef.current = false;
        setHasUnsavedChanges(false);
      }, 100);
    }
  }, [platformMode, platformConfigJson, externalConfigName]);

  // Check if the database is password-protected and locked
  const checkDatabaseLockStatus = () => {
    const persistence = secretManager.persistenceState;
    if (persistence?.enabled && persistence?.passwordProtected) {
      // Check if we can access secrets to determine if the database is locked
      const secrets = secretManager.listSecrets();
      const isLocked = secrets.length === 0; // If we can't access secrets, the database is likely locked
      setDatabaseLocked(isLocked);
      if (isLocked) {
        console.log('Database is locked and requires a password');
        // Only automatically show the unlock dialog if we're not already in a different dialog
        if (!secretSettingsOpen && !secretsManagerOpen && !showResetDialog) {
          setUnlockDatabaseOpen(true);
        }
      }
    }
  };
  
  // Handle successful database unlock
  const handleDatabaseUnlocked = () => {
    setDatabaseLocked(false);
    showToast('Database unlocked successfully', 'success');
  };

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
      // Set loading flag to prevent false unsaved changes detection
      isLoadingRef.current = true;
      
      const loadedConfig = await getConfig(configName);
      
      if (!loadedConfig) {
        throw new Error('Received empty configuration from server');
      }
      
      // Ensure all required properties exist
      const sanitizedConfig = sanitizeConfig(loadedConfig, configName);
      
      setConfig(sanitizedConfig);
      configStateManager.loadConfig(sanitizedConfig);
      
      // Reset loading flag after a short delay to allow events to propagate
      setTimeout(() => {
        isLoadingRef.current = false;
        setHasUnsavedChanges(false);
      }, 100);
    } catch (error) {
      console.error('Error loading config:', error);
      showToast(`Failed to load configuration ${configName}. Please try again.`, 'error');
      isLoadingRef.current = false;
    }
  };

  // Handle updates to the configuration from NodeGraph
  const handleConfigUpdate = (updatedConfig: Config, isReset: boolean = false) => {
    // Create a string representation of the updated config for comparison
    const updatedConfigString = JSON.stringify(updatedConfig);
    
    // If this is exactly the same config we just processed, break the loop
    if (lastProcessedConfigRef.current === updatedConfigString) {
      return;
    }
    
    // Keep track of this config to prevent duplicate processing
    lastProcessedConfigRef.current = updatedConfigString;
    
    // If this is a reset operation, we're in reset protection mode, or we're loading a config, don't set hasUnsavedChanges
    if (isReset || isResetting || isLoadingRef.current) {
      setConfig(updatedConfig);
      return;
    }
    
    // Check if this is a substantive change to avoid unnecessary state updates
    if (config) {
      // Use the configStateManager to check for substantive changes
      const hasSubstantiveChanges = configStateManager.isSubstantiveChange(config, updatedConfig);
      
      // If there are no substantive changes, skip state update
      if (!hasSubstantiveChanges) {
        return;
      }
    }
    
    // Normal update - set the config and mark as having unsaved changes
    setConfig(updatedConfig);
    setHasUnsavedChanges(true);
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

      // Make sure everything is in sync before saving
      configStateManager.forceSync(true);
      
      // Get the current config from ConfigStateManager
      const currentConfig = configStateManager.getConfig();

      // Platform mode - use callback
      if (platformMode && onPlatformSave) {
        const success = await onPlatformSave(currentConfig);
        if (success) {
          setHasUnsavedChanges(false);
          configStateManager.resetPendingChanges();
        }
        return success;
      }
      
      // Legacy mode - use direct API
      // If the configuration needs a name, prompt for it
      let configNameToSave = selectedConfig || config.name || '';
      if (!configNameToSave || configNameToSave.trim() === '') {
        const userInput = prompt('Please enter a name for this configuration:', 'my-config');
        if (!userInput || userInput.trim() === '') {
          return false; // User cancelled or provided empty name
        }
        configNameToSave = userInput.trim();
        
        // Update configuration with the new name
        const updatedConfig = { ...config, name: configNameToSave };
        setConfig(updatedConfig);
        setSelectedConfig(configNameToSave);
        configStateManager.updateConfig(updatedConfig);
      }
      
      // Use the API's saveConfig function with both name and config parameters
      // saveConfig returns Promise<void>, so if no exception is thrown, it succeeded
      await saveConfig(configNameToSave, currentConfig);
      
      // If we got here, the save was successful
      // Clear unsaved changes flag
      setHasUnsavedChanges(false);
      // Also clear the pending changes in configStateManager
      configStateManager.resetPendingChanges();
      showToast(`Configuration ${configNameToSave} saved successfully`, 'success');
      
      // Reload configs list to ensure it's up to date
      loadConfigs();
      
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      showToast('Failed to save configuration. Please try again.', 'error');
      return false;
    }
  };

  // Handle the reset functionality to restore the last saved configuration
  const handleReset = async () => {
    try {
      // Set the resetting flag to true to prevent changes during reset
      setIsResetting(true);
      
      // Get the current config name
      const configName = config.name;
      if (!configName) {
        console.error('Cannot reset without a config name');
        setIsResetting(false);
        return;
      }

      // Load the saved config from the server
      const savedConfig = await getConfig(configName);
      if (!savedConfig) {
        console.error('Failed to load saved config');
        setIsResetting(false);
        return;
      }

      // Make sure the name is set correctly
      if (!savedConfig.name) {
        savedConfig.name = configName;
      }

      // Force sync before changing anything - don't set pending changes
      configStateManager.forceSync(false);
      
      // Update the config state manager with the saved version
      configStateManager.loadConfig(savedConfig);
      
      // Explicitly reset the pendingChanges flag in ConfigStateManager
      configStateManager.resetPendingChanges();
      
      // Set the config in local state
      setConfig({...savedConfig});
      
      // Update the parent component with reset flag
      // The isReset parameter is crucial for the handleConfigUpdate function
      handleConfigUpdate(savedConfig, true);
      
      // Important: Explicitly set hasUnsavedChanges to false AFTER everything else
      setHasUnsavedChanges(false);
      
      // Close the reset dialog
      setShowResetDialog(false);
      
      // Use a timeout to keep reset protection for a short period
      // This allows any pending updates to be ignored before we disable reset protection
      setTimeout(() => {
        setIsResetting(false);
      }, 1000);
      
      showToast('Configuration has been reset to the last saved state', 'success');
    } catch (error) {
      console.error('Error resetting config:', error);
      showToast('Failed to reset configuration. Please try again.', 'error');
      setIsResetting(false);
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
      configStateManager.forceSync(true);
      
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
    reader.onload = (event: ProgressEvent<FileReader>) => {
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
        
        // Ensure all required fields exist with defaults
        const validatedConfig = sanitizeConfig(importedConfig);
        
        // Load the imported config
        configStateManager.loadConfig(validatedConfig);
        configStateManager.forceSync(true);
        
        // Update local state
        setConfig(validatedConfig);
        setSelectedConfig(validatedConfig.name || null);
        
        // Update hasUnsavedChanges
        setHasUnsavedChanges(true);
        
        // Reset the file input so the same file can be imported again if needed
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        
        showToast(`Configuration "${validatedConfig.name}" imported successfully`, 'success');
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

  // Handle new config creation
  const handleNewConfig = () => {
    // Clear selected config
    setSelectedConfig(null);
    
    if (platformMode) {
      // Platform mode: Start with default storage and AI plugins pre-configured
      const defaultConfig = createDefaultPlatformConfig();
      setConfig(defaultConfig);
      configStateManager.loadConfig(defaultConfig);
    } else {
      // Legacy mode: Empty config
      setConfig(createEmptyConfig());
    }
    setHasUnsavedChanges(false);
  };
  
  // Function to handle plugin drag from sidebar to NodeGraph
  const handleDragPlugin = (plugin: PluginInfo, clientX: number, clientY: number) => {
    // Pass the drag event to the NodeGraph component
    if (nodeGraphRef.current) {
      // Access the handleDragPlugin method from the NodeGraph ref
      nodeGraphRef.current.handleDragPlugin(plugin, clientX, clientY);
    }
  };

  // Handle view mode change
  const handleViewModeChange = (mode: 'graph' | 'json') => {
    // If switching to JSON view, ensure ConfigStateManager is synced
    if (mode === 'json' && viewMode === 'graph') {
      configStateManager.forceSync();
    }
    setViewMode(mode);
  };

  // Show the reset confirmation dialog
  const handleResetConfiguration = () => {
    setShowResetDialog(true);
  };

  // In platform mode, the parent handles positioning; in legacy mode, we're fixed fullscreen
  const containerClass = platformMode 
    ? "absolute inset-0 flex flex-col bg-stone-50 text-stone-800 overflow-hidden"
    : "fixed inset-0 flex flex-col bg-stone-50 text-stone-800 overflow-hidden";

  return (
    <div className="fixed inset-0 flex flex-col bg-stone-50 text-stone-800 overflow-hidden">
      {/* Full-width Toolbar */}
      <div className="h-12 bg-white border-b border-stone-200 shadow-sm flex items-center px-4 flex-shrink-0">
        <h1 className="text-xl font-semibold">Digital Gardener</h1>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        {/* Hidden file input for JSON import */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".json"
          className="hidden"
        />
        
        {/* Sidebar */}
        <Sidebar 
          configs={platformMode ? [] : configs}
          selectedConfig={platformMode ? (externalConfigName || null) : selectedConfig}
          onConfigSelect={platformMode ? () => {} : handleConfigSelect}
          onNewConfig={platformMode ? () => {} : handleNewConfig}
          onExportJSON={handleExportJSON}
          onImportJSON={platformMode ? () => {} : handleImportJSON}
          onOpenSecretsManager={platformMode ? undefined : () => setSecretsManagerOpen(true)}
          onOpenSecretSettings={platformMode ? undefined : () => setSecretSettingsOpen(true)}
          onUnlockDatabase={platformMode ? undefined : () => setUnlockDatabaseOpen(true)}
          fileInputRef={platformMode ? undefined : fileInputRef}
          hasUnsavedChanges={hasUnsavedChanges}
          onRunAggregation={platformMode ? undefined : handleRunAggregation}
          activeTab={platformMode ? 'plugins' : activeTab}
          setActiveTab={platformMode ? () => {} : setActiveTab}
          onDragPlugin={handleDragPlugin}
          config={config}
          onConfigNameSave={platformMode ? undefined : (name) => {
            // Update config name
            const updatedConfig = { ...config, name };
            setConfig(updatedConfig);
            setSelectedConfig(name);
            
            // Update in config state manager
            configStateManager.updateConfig(updatedConfig);
            
            // Mark as having unsaved changes
            setHasUnsavedChanges(true);
          }}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          saveConfiguration={saveConfiguration}
          resetConfiguration={platformMode ? undefined : handleResetConfiguration}
          platformMode={platformMode}
          isSaving={externalIsSaving}
        />

        {/* Main Content */}
        <div className="flex-1 overflow-hidden">
          <NodeGraph
            ref={nodeGraphRef}
            config={selectedConfig ? config : createEmptyConfig()}
            onConfigUpdate={handleConfigUpdate}
            saveConfiguration={saveConfiguration}
            runAggregation={selectedConfig ? handleRunAggregation : undefined}
            viewMode={viewMode}
            hasUnsavedChanges={hasUnsavedChanges}
            platformMode={platformMode}
            isPlatformPro={isPlatformPro}
            platformConfigId={platformConfigId}
          />
        </div>
      </div>
      
      {/* Secrets Manager Dialog */}
      <SecretsManagerDialog
        open={secretsManagerOpen}
        onClose={() => setSecretsManagerOpen(false)}
      />

      {/* Reset Dialog */}
      {showResetDialog && (
        <ResetDialog
          onClose={() => setShowResetDialog(false)}
          onConfirm={() => handleReset()}
        />
      )}

      <UnlockDatabaseDialog
        open={unlockDatabaseOpen}
        onClose={() => setUnlockDatabaseOpen(false)}
        onUnlocked={handleDatabaseUnlocked}
      />
    </div>
  );
}

export default App; 