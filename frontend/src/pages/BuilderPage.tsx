// frontend/src/pages/BuilderPage.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import App from '../App';
import { ConfigInfoPanel, ConfigInfo } from '../components/ConfigInfoPanel';
import { useAuth } from '../context/AuthContext';
import { configApi, userApi, UserLimits, PlatformConfig } from '../services/api';
import { useToast } from '../components/ToastProvider';

/**
 * BuilderPage - Integrated config creation and editing interface
 * 
 * Routes:
 * - /builder - Create new config
 * - /builder/:id - Edit existing config
 */
const BuilderPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { 
    isAuthenticated, 
    isPrivyReady, 
    authToken, 
    login, 
    user,
    isLoading: authLoading 
  } = useAuth();

  // State
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [limits, setLimits] = useState<UserLimits | null>(null);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null);
  const [configInfo, setConfigInfo] = useState<ConfigInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPlatformChanges, setHasUnsavedPlatformChanges] = useState(false);

  const isEditMode = !!id;
  const isNewConfig = !id;

  // Load user limits
  useEffect(() => {
    async function loadLimits() {
      if (!authToken) return;
      try {
        const limitsRes = await userApi.getMyLimits(authToken);
        setLimits(limitsRes);
      } catch (err) {
        console.error('Error loading limits:', err);
      }
    }
    if (isAuthenticated && authToken) {
      loadLimits();
    }
  }, [isAuthenticated, authToken]);

  // Load existing config if in edit mode
  useEffect(() => {
    async function loadConfig() {
      if (!id || !authToken) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const config = await configApi.get(id, authToken);
        setPlatformConfig(config);
        setConfigInfo({
          name: config.name,
          description: config.description || '',
          visibility: config.visibility,
        });
      } catch (err) {
        console.error('Error loading config:', err);
        setError(err instanceof Error ? err.message : 'Failed to load config');
      } finally {
        setIsLoading(false);
      }
    }

    if (isEditMode) {
      loadConfig();
    } else {
      setIsLoading(false);
      // For new configs, show the config panel automatically
      if (isAuthenticated && !configInfo) {
        setShowConfigPanel(true);
      }
    }
  }, [id, authToken, isEditMode, isAuthenticated]);

  // Show config panel when authenticated and creating new config
  useEffect(() => {
    if (isNewConfig && isAuthenticated && !configInfo && !showConfigPanel && !isLoading) {
      setShowConfigPanel(true);
    }
  }, [isNewConfig, isAuthenticated, configInfo, showConfigPanel, isLoading]);

  // Handle saving config info (create or update)
  const handleSaveConfigInfo = useCallback(async (info: ConfigInfo) => {
    if (!authToken) return;
    
    setIsSaving(true);
    
    try {
      if (isEditMode && platformConfig) {
        // Update existing config
        const updated = await configApi.update(authToken, platformConfig.id, {
          name: info.name,
          description: info.description,
          visibility: info.visibility,
        });
        setPlatformConfig(updated);
        setConfigInfo(info);
        setShowConfigPanel(false);
        showToast('Config settings saved', 'success');
      } else {
        // Create new config - save the info and close panel
        // The actual creation will happen when user saves the visual config
        setConfigInfo(info);
        setShowConfigPanel(false);
        setHasUnsavedPlatformChanges(true);
        showToast('Config info saved. Add your sources and save to create the config.', 'info');
      }
    } catch (err) {
      console.error('Error saving config info:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save config', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [authToken, isEditMode, platformConfig, showToast]);

  // Extract storage configuration from configJson
  const extractStorageConfig = (configJson: any): { 
    storageType: 'platform' | 'external', 
    externalDbUrl?: string,
    skipValidation?: boolean 
  } => {
    // Look for PostgresStorage in the storage array
    const storage = configJson?.storage || [];
    
    const postgresStorage = storage.find((s: any) => {
      // Check various properties that might identify PostgresStorage
      // Note: type might be the plugin class name ("PostgresStorage") or just "storage"
      const isPostgres = 
        s.pluginName === 'PostgresStorage' ||
        s.type === 'PostgresStorage' ||
        s.type?.toLowerCase() === 'postgresstorage' ||
        s.name?.toLowerCase().includes('postgres');
      return isPostgres;
    });

    if (postgresStorage?.params) {
      const skipValidation = !!postgresStorage.params.skipValidation;
      
      // Check if using platform storage
      if (postgresStorage.params.usePlatformStorage) {
        return { storageType: 'platform', skipValidation };
      }
      
      // Extract connection string or build from individual params
      if (postgresStorage.params.connectionString) {
        return { 
          storageType: 'external', 
          externalDbUrl: postgresStorage.params.connectionString,
          skipValidation
        };
      }
      
      // Build connection string from individual params
      const { host, port, database, user, password } = postgresStorage.params;
      if (host && database) {
        const connStr = `postgresql://${user || ''}${password ? ':' + password : ''}${user ? '@' : ''}${host}${port ? ':' + port : ''}/${database}`;
        return { storageType: 'external', externalDbUrl: connStr, skipValidation };
      }
    }

    // Default to external with no URL (will trigger validation error)
    return { storageType: 'external' };
  };

  // Handle save from the visual builder
  const handleBuilderSave = useCallback(async (configJson: any) => {
    if (!authToken || !configInfo) {
      // If no config info, show the panel first
      setShowConfigPanel(true);
      return false;
    }

    setIsSaving(true);

    try {
      // Extract storage configuration from the configJson
      const { storageType, externalDbUrl, skipValidation } = extractStorageConfig(configJson);
      
      // Determine final storage type based on tier
      const isPro = limits?.tier !== 'free';
      
      // Free tier: Always uses platform storage (backend enforces this)
      // Pro tier: Can choose external storage, but needs a valid DB URL
      if (isPro && storageType === 'external' && !externalDbUrl) {
        showToast('Please add a PostgresStorage plugin with your database connection details.', 'error');
        setIsSaving(false);
        return false;
      }

      if (isEditMode && platformConfig) {
        // Update existing config's JSON
        await configApi.update(authToken, platformConfig.id, {
          configJson,
          storageType,
          externalDbUrl,
          skipValidation,
        });
        showToast('Config saved successfully', 'success');
        setHasUnsavedPlatformChanges(false);
        return true;
      } else {
        // Create new config with JSON
        const created = await configApi.create(authToken, {
          name: configInfo.name,
          description: configInfo.description,
          visibility: configInfo.visibility,
          storageType,
          externalDbUrl,
          skipValidation,
          configJson,
        });
        setPlatformConfig(created);
        setHasUnsavedPlatformChanges(false);
        showToast('Config created successfully!', 'success');
        
        // Navigate to the edit URL for the new config
        navigate(`/builder/${created.id}`, { replace: true });
        return true;
      }
    } catch (err) {
      console.error('Error saving config:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save config', 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [authToken, configInfo, isEditMode, platformConfig, showToast, navigate, limits]);

  // Render login prompt if not authenticated
  if (isPrivyReady && !isAuthenticated && !authLoading) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-950">
          <div className="text-center max-w-md px-6">
            <svg 
              className="w-16 h-16 mx-auto text-amber-500 mb-6"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
              />
            </svg>
            <h2 className="text-2xl font-bold text-white mb-2">Sign in to continue</h2>
            <p className="text-stone-400 mb-6">
              Create and manage your context aggregation pipelines
            </p>
            <button
              onClick={login}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
            >
              Sign In
            </button>
            <p className="mt-4 text-stone-500 text-sm">
              <a href="/" className="text-amber-400 hover:underline">Back to home</a>
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  // Render loading state
  if (!isPrivyReady || authLoading || isLoading) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-950">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-400">Loading...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Render error state
  if (error) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-950">
          <div className="text-center max-w-md px-6">
            <svg 
              className="w-16 h-16 mx-auto text-red-500 mb-6"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1.5} 
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
              />
            </svg>
            <h2 className="text-2xl font-bold text-white mb-2">Error</h2>
            <p className="text-stone-400 mb-6">{error}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Check config creation limits
  if (isNewConfig && limits && !limits.canCreateConfig) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-950">
          <div className="text-center max-w-md px-6">
            <svg 
              className="w-16 h-16 mx-auto text-stone-600 mb-6"
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={1} 
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
              />
            </svg>
            <h2 className="text-xl font-bold text-white mb-2">Config Limit Reached</h2>
            <p className="text-stone-400 mb-6">
              You've reached the maximum number of configs for the free tier.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
              >
                Back to Dashboard
              </button>
              <a
                href="/upgrade"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
              >
                Upgrade to Pro
              </a>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showNavbar={false}>
      {/* Fixed Header for Platform Mode */}
      <div className="fixed top-0 left-0 right-0 h-12 bg-stone-900 border-b border-stone-700 flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-xl font-semibold text-white hover:text-amber-400 transition-colors">
            {configInfo?.name || platformConfig?.name || 'New Config'}
          </a>
          {(hasUnsavedPlatformChanges || (configInfo && !platformConfig)) && (
            <span className="text-amber-400 text-sm">(unsaved)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfigPanel(true)}
            className="px-3 py-1.5 text-stone-400 hover:text-white hover:bg-stone-800 rounded transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
          <a
            href="/dashboard"
            className="px-3 py-1.5 text-stone-400 hover:text-white hover:bg-stone-800 rounded transition-colors text-sm"
          >
            Dashboard
          </a>
        </div>
      </div>

      {/* Config setup reminder for new configs */}
      {isNewConfig && !configInfo && (
        <div className="fixed top-12 left-0 right-0 bg-amber-900/50 border-b border-amber-700 px-4 py-2 z-30 flex items-center justify-between">
          <span className="text-amber-200 text-sm">
            Set up your config details before building
          </span>
          <button
            onClick={() => setShowConfigPanel(true)}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded transition-colors"
          >
            Configure
          </button>
        </div>
      )}

      {/* Visual Builder - positioned below header */}
      <div 
        className="fixed left-0 right-0 bottom-0 bg-stone-950"
        style={{ top: isNewConfig && !configInfo ? '88px' : '48px' }}
      >
        <App 
          platformMode={true}
          platformConfigId={platformConfig?.id}
          platformConfigJson={platformConfig?.configJson}
          onPlatformSave={handleBuilderSave}
          onOpenConfigSettings={() => setShowConfigPanel(true)}
          isSaving={isSaving}
          configName={configInfo?.name || platformConfig?.name}
          isPlatformPro={limits?.tier !== 'free'}
        />
      </div>

      {/* Config Info Panel */}
      <ConfigInfoPanel
        open={showConfigPanel}
        onClose={() => setShowConfigPanel(false)}
        onSave={handleSaveConfigInfo}
        initialValues={configInfo || undefined}
        limits={limits}
        isEditing={isEditMode}
        isSaving={isSaving}
      />
    </Layout>
  );
};

export default BuilderPage;
