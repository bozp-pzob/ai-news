// frontend/src/pages/BuilderPage.tsx

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import App from '../App';
import { ConfigInfoPanel, ConfigInfo } from '../components/ConfigInfoPanel';
import { CreateConfigDialog } from '../components/CreateConfigDialog';
import { SecretsPanel } from '../components/SecretsPanel';
import { useAuth } from '../context/AuthContext';
import { configApi, localConfigApi, userApi, UserLimits, PlatformConfig } from '../services/api';
import { localConfigStorage, LocalConfig } from '../services/localConfigStorage';
import { useToast } from '../components/ToastProvider';

/**
 * BuilderPage - Integrated config creation and editing interface
 * 
 * Routes:
 * - /builder?local=<id>  - Edit local (anonymous) config from localStorage
 * - /builder/:id         - Edit existing platform config (auth required)
 * - /builder             - No config specified: show create dialog
 */
const BuilderPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
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

  // Determine mode from URL
  const localId = searchParams.get('local');
  const isLocalMode = !!localId;
  const isPlatformEdit = !!id;
  const hasNoTarget = !id && !localId; // No config specified at all

  // State
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [limits, setLimits] = useState<UserLimits | null>(null);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<LocalConfig | null>(null);
  const [configInfo, setConfigInfo] = useState<ConfigInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPlatformChanges, setHasUnsavedPlatformChanges] = useState(false);
  const [showSecretsPanel, setShowSecretsPanel] = useState(false);

  // Show create dialog when no target config is specified
  useEffect(() => {
    if (hasNoTarget && !showCreateDialog) {
      setShowCreateDialog(true);
      setIsLoading(false);
    }
  }, [hasNoTarget]);

  // Load user limits (platform mode only)
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

  // Load local config from localStorage
  useEffect(() => {
    if (!isLocalMode) return;
    
    const config = localConfigStorage.get(localId!);
    if (config) {
      setLocalConfig(config);
      setConfigInfo({
        name: config.name,
        description: config.description || '',
        visibility: 'public',
      });
    } else {
      setError('Local config not found. It may have been cleared from browser storage.');
    }
    setIsLoading(false);
  }, [isLocalMode, localId]);

  // Load existing platform config
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

    if (isPlatformEdit) {
      loadConfig();
    }
  }, [id, authToken, isPlatformEdit]);

  // Handle saving config info (settings panel - update only, not create)
  const handleSaveConfigInfo = useCallback(async (info: ConfigInfo) => {
    setIsSaving(true);
    
    try {
      if (isLocalMode && localConfig) {
        // Update local config metadata
        localConfigStorage.update(localConfig.id, {
          name: info.name,
          description: info.description,
        });
        setConfigInfo(info);
        setShowConfigPanel(false);
        showToast('Config settings saved', 'success');
      } else if (isPlatformEdit && platformConfig && authToken) {
        // Update existing platform config (include isLocalExecution if changed)
        const updateData: any = {
          name: info.name,
          description: info.description,
          visibility: info.visibility,
        };
        if (info.isLocalExecution !== undefined) {
          updateData.isLocalExecution = info.isLocalExecution;
        }
        const updated = await configApi.update(authToken, platformConfig.id, updateData);
        setPlatformConfig(updated);
        setConfigInfo(info);
        setShowConfigPanel(false);
        showToast('Config settings saved', 'success');
      }
    } catch (err) {
      console.error('Error saving config info:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save config', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [authToken, isPlatformEdit, isLocalMode, platformConfig, localConfig, showToast]);

  // Extract storage configuration from configJson
  const extractStorageConfig = (configJson: any): { 
    storageType: 'platform' | 'external', 
    externalDbUrl?: string,
    skipValidation?: boolean 
  } => {
    const storage = configJson?.storage || [];
    
    const postgresStorage = storage.find((s: any) => {
      const isPostgres = 
        s.pluginName === 'PostgresStorage' ||
        s.type === 'PostgresStorage' ||
        s.type?.toLowerCase() === 'postgresstorage' ||
        s.name?.toLowerCase().includes('postgres');
      return isPostgres;
    });

    if (postgresStorage?.params) {
      const skipValidation = !!postgresStorage.params.skipValidation;
      
      if (postgresStorage.params.usePlatformStorage) {
        return { storageType: 'platform', skipValidation };
      }
      
      if (postgresStorage.params.connectionString) {
        return { 
          storageType: 'external', 
          externalDbUrl: postgresStorage.params.connectionString,
          skipValidation
        };
      }
      
      const { host, port, database, user, password } = postgresStorage.params;
      if (host && database) {
        const connStr = `postgresql://${user || ''}${password ? ':' + password : ''}${user ? '@' : ''}${host}${port ? ':' + port : ''}/${database}`;
        return { storageType: 'external', externalDbUrl: connStr, skipValidation };
      }
    }

    return { storageType: 'external' };
  };

  // Handle save from the visual builder (platform mode)
  const handleBuilderSave = useCallback(async (configJson: any) => {
    if (!authToken || !configInfo) {
      setShowConfigPanel(true);
      return false;
    }

    setIsSaving(true);

    try {
      const { storageType, externalDbUrl, skipValidation } = extractStorageConfig(configJson);
      const isPro = limits?.tier !== 'free';
      
      if (isPro && storageType === 'external' && !externalDbUrl) {
        showToast('Please add a PostgresStorage plugin with your database connection details.', 'error');
        setIsSaving(false);
        return false;
      }

      if (isPlatformEdit && platformConfig) {
        await configApi.update(authToken, platformConfig.id, {
          configJson,
          storageType,
          externalDbUrl,
          skipValidation,
        });
        showToast('Config saved successfully', 'success');
        setHasUnsavedPlatformChanges(false);
        return true;
      }

      return false;
    } catch (err) {
      console.error('Error saving config:', err);
      showToast(err instanceof Error ? err.message : 'Failed to save config', 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [authToken, configInfo, isPlatformEdit, platformConfig, showToast, limits]);

  // Handle save for local mode
  const handleLocalSave = useCallback(async (configJson: any) => {
    if (!localConfig) return false;

    try {
      // Save to localStorage
      localConfigStorage.update(localConfig.id, { configJson });
      
      // Also save to local filesystem API so the backend can run it
      try {
        await localConfigApi.save(localConfig.name, configJson);
      } catch {
        // Filesystem save is optional - may not have a running backend
      }

      showToast('Config saved', 'success');
      return true;
    } catch (err) {
      console.error('Error saving local config:', err);
      showToast('Failed to save config', 'error');
      return false;
    }
  }, [localConfig, showToast]);

  // Handle create dialog success
  const handleCreateSuccess = (configId: string, isLocal: boolean) => {
    setShowCreateDialog(false);
    if (isLocal) {
      navigate(`/builder?local=${configId}`, { replace: true });
    } else {
      navigate(`/builder/${configId}`, { replace: true });
    }
  };

  // Handle create dialog close - go back to dashboard if no config loaded
  const handleCreateDialogClose = () => {
    setShowCreateDialog(false);
    if (hasNoTarget) {
      navigate('/dashboard');
    }
  };

  // --- LOCAL MODE RENDERING ---
  if (isLocalMode) {
    if (isLoading) {
      return (
        <Layout showNavbar={false}>
          <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-stone-500">Loading...</p>
            </div>
          </div>
        </Layout>
      );
    }

    if (error || !localConfig) {
      return (
        <Layout showNavbar={false}>
          <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
            <div className="text-center max-w-md px-6">
              <h2 className="text-2xl font-bold text-stone-800 mb-2">Config Not Found</h2>
              <p className="text-stone-500 mb-6">{error || 'This local config could not be loaded.'}</p>
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Go Home
              </button>
            </div>
          </div>
        </Layout>
      );
    }

    return (
      <Layout showNavbar={false}>
        {/* Header for local mode */}
        <div className="fixed top-0 left-0 right-0 h-12 bg-white border-b border-stone-200 flex items-center justify-between px-4 z-40">
          <div className="flex items-center gap-4">
            <a href="/" className="text-xl font-semibold text-stone-800 hover:text-emerald-600 transition-colors">
              {localConfig.name}
            </a>
            <span className="text-stone-400 text-xs px-2 py-0.5 bg-stone-100 rounded">Local</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfigPanel(true)}
              className="px-3 py-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors text-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
            <a
              href="/"
              className="px-3 py-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors text-sm"
            >
              Home
            </a>
          </div>
        </div>

        {/* Visual Builder for local mode - use platformMode=true for clean UI (Plugins tab, no config selector) */}
        <div className="fixed left-0 right-0 bottom-0 bg-stone-50" style={{ top: '48px' }}>
          <App 
            platformMode={true}
            platformConfigJson={localConfig.configJson}
            onPlatformSave={handleLocalSave}
            onOpenConfigSettings={() => setShowConfigPanel(true)}
            isSaving={isSaving}
            configName={localConfig.name}
          />
        </div>

        {/* Config Info Panel for local mode */}
        <ConfigInfoPanel
          open={showConfigPanel}
          onClose={() => setShowConfigPanel(false)}
          onSave={handleSaveConfigInfo}
          initialValues={configInfo || undefined}
          limits={null}
          isEditing={true}
          isSaving={isSaving}
          configId={localConfig?.id}
        />
      </Layout>
    );
  }

  // --- NO TARGET: SHOW CREATE DIALOG ---
  if (hasNoTarget) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 bg-stone-50" />
        <CreateConfigDialog
          open={showCreateDialog}
          onClose={handleCreateDialogClose}
          onSuccess={handleCreateSuccess}
          limits={limits}
        />
      </Layout>
    );
  }

  // --- PLATFORM MODE RENDERING ---

  // Render login prompt if not authenticated
  if (isPrivyReady && !isAuthenticated && !authLoading) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
          <div className="text-center max-w-md px-6">
            <svg 
              className="w-16 h-16 mx-auto text-emerald-500 mb-6"
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
            <h2 className="text-2xl font-bold text-stone-800 mb-2">Sign in to continue</h2>
            <p className="text-stone-500 mb-6">
              Create and manage your context aggregation pipelines
            </p>
            <button
              onClick={login}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
            >
              Sign In
            </button>
            <p className="mt-4 text-stone-400 text-sm">
              <a href="/" className="text-emerald-600 hover:underline">Back to home</a>
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
        <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-500">Loading...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Render error state
  if (error) {
    return (
      <Layout showNavbar={false}>
        <div className="fixed inset-0 flex items-center justify-center bg-stone-50">
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
            <h2 className="text-2xl font-bold text-stone-800 mb-2">Error</h2>
            <p className="text-stone-500 mb-6">{error}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="px-4 py-2 text-stone-500 hover:text-stone-800 transition-colors"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showNavbar={false}>
      {/* Fixed Header for Platform Mode */}
      <div className="fixed top-0 left-0 right-0 h-12 bg-white border-b border-stone-200 flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="text-xl font-semibold text-stone-800 hover:text-emerald-600 transition-colors">
            {configInfo?.name || platformConfig?.name || 'Config'}
          </a>
          {hasUnsavedPlatformChanges && (
            <span className="text-emerald-600 text-sm">(unsaved)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSecretsPanel(true)}
            className="px-3 py-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Secrets
          </button>
          <button
            onClick={() => setShowConfigPanel(true)}
            className="px-3 py-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
          <a
            href="/dashboard"
            className="px-3 py-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded transition-colors text-sm"
          >
            Dashboard
          </a>
        </div>
      </div>

      {/* Visual Builder - positioned below header */}
      <div 
        className="fixed left-0 right-0 bottom-0 bg-stone-50"
        style={{ top: '48px' }}
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
        initialValues={configInfo ? { ...configInfo, isLocalExecution: platformConfig?.isLocalExecution } : undefined}
        limits={limits}
        isEditing={true}
        isSaving={isSaving}
        configId={platformConfig?.id}
      />

      {/* Secrets Panel */}
      <SecretsPanel
        open={showSecretsPanel}
        onClose={() => setShowSecretsPanel(false)}
      />
    </Layout>
  );
};

export default BuilderPage;
