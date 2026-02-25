// frontend/src/pages/ConfigPage.tsx

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { 
  configApi,
  runsApi,
  PlatformConfig, 
  ConfigStats,
  AggregationRun,
} from '../services/api';
import { Tabs } from '../components/config/Tabs';
import { OverviewTab } from '../components/config/OverviewTab';
import { TopicsTab } from '../components/config/TopicsTab';
import { ItemsTab } from '../components/config/ItemsTab';
import { ContentTab } from '../components/config/ContentTab';
import { SettingsTab } from '../components/config/SettingsTab';
import { RunsTab } from '../components/config/RunsTab';
import { RunActions } from '../components/config/RunActions';
import { useToast } from '../components/ToastProvider';

/**
 * Config page content — works for both owners and public viewers.
 * 
 * Access control is driven by the backend's `dataAccess` field:
 *   - 'full': owner/admin — all tabs, run actions, settings
 *   - 'open': public non-monetized — overview, topics, items (unless hidden), content
 *   - 'payment_required': public monetized — overview, topics, content preview (items hidden if config.hideItems)
 */
function ConfigPageContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authToken, isAuthenticated, isPrivyReady, isLoading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  
  // Auth is "ready" once Privy has initialized and finished loading user state.
  // We gate the initial data fetch on this to avoid the race condition where
  // a logged-in user's first fetch fires before the auth token is available,
  // causing the backend to return isOwner=false / dataAccess='open'.
  const authReady = isPrivyReady && !isAuthLoading;
  
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [stats, setStats] = useState<ConfigStats | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<AggregationRun | null>(null);
  
  // Track polling intervals for cleanup on unmount
  const pollIntervalsRef = React.useRef<Set<NodeJS.Timeout>>(new Set());
  
  React.useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(clearInterval);
      pollIntervalsRef.current.clear();
    };
  }, []);

  // Load config data — gated on authReady to prevent race condition
  useEffect(() => {
    async function loadConfig() {
      if (!id || !authReady) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const [configRes, statsRes] = await Promise.all([
          configApi.get(id, authToken || undefined),
          configApi.getStats(id, authToken || undefined),
        ]);
        
        setConfig(configRes);
        setStats(statsRes);
        
        // Load active job if config is running and user is owner
        if (authToken && configRes.isOwner && (configRes.status === 'running' || configRes.activeJobId)) {
          try {
            if (configRes.activeJobId) {
              const job = await runsApi.get(authToken, id, configRes.activeJobId);
              if (job && job.status === 'running') {
                setActiveJob(job);
              }
            } else {
              const runsResult = await runsApi.list(authToken, id, { limit: 1, offset: 0 });
              const runningJob = runsResult.runs.find(r => r.status === 'running' && r.jobType === 'one-time');
              if (runningJob) {
                setActiveJob(runningJob);
              }
            }
          } catch (err) {
            console.warn('Could not load active job:', err);
          }
        }
      } catch (err) {
        console.error('Error loading config:', err);
        setError(err instanceof Error ? err.message : 'Failed to load config');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadConfig();
  }, [id, authToken, authReady]);

  // Derived access state — driven by backend's dataAccess field
  const dataAccess = config?.dataAccess ?? 'open';
  const isOwner = dataAccess === 'full';

  // Handle update (owner only)
  const handleUpdate = async (updates: Partial<PlatformConfig>) => {
    if (!id || !authToken || !config) return;
    
    try {
      const updated = await configApi.update(authToken, id, updates as any);
      setConfig({ ...config, ...updated });
    } catch (err) {
      console.error('Error updating config:', err);
      throw err;
    }
  };

  // Handle delete (owner only)
  const handleDelete = async () => {
    if (!id || !authToken) return;
    
    try {
      await configApi.delete(authToken, id);
      navigate('/dashboard');
    } catch (err) {
      console.error('Error deleting config:', err);
      throw err;
    }
  };

  // Handle run started - poll for job completion (owner only)
  const handleRunStarted = async (jobId: string, jobType: 'one-time' | 'continuous' = 'one-time') => {
    if (!id || !authToken || !config) return;
    
    setConfig({ ...config, status: 'running' });
    
    setActiveJob({
      id: jobId,
      jobType: jobType,
      status: 'running',
      itemsFetched: 0,
      itemsProcessed: 0,
      runCount: 0,
      createdAt: new Date().toISOString(),
    });
    
    // Poll for job completion
    const pollInterval = setInterval(async () => {
      try {
        const job = await runsApi.get(authToken, id, jobId);
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(pollInterval);
          setActiveJob(null);
          setConfig(prev => prev ? { 
            ...prev, 
            status: job.status === 'completed' || job.status === 'cancelled' ? 'idle' : 'error' 
          } : prev);
          
          // Notify user if their continuous run was stopped due to license expiration
          if (job.status === 'cancelled' && jobType === 'continuous') {
            const hasLicenseLog = job.logs?.some(
              (log: any) => log.message?.includes('Pro license expired')
            );
            if (hasLicenseLog) {
              showToast('Your continuous run was stopped because your Pro subscription expired. Renew to restart.', 'warning');
            }
          }
        } else {
          setActiveJob({ ...job, jobType: jobType });
        }
      } catch (err) {
        clearInterval(pollInterval);
        pollIntervalsRef.current.delete(pollInterval);
        setActiveJob(null);
        setConfig(prev => prev ? { ...prev, status: 'idle' } : prev);
      }
    }, 3000);
    pollIntervalsRef.current.add(pollInterval);
    
    if (jobType === 'one-time') {
      setTimeout(() => {
        clearInterval(pollInterval);
        pollIntervalsRef.current.delete(pollInterval);
      }, 600000);
    }
  };

  // Handle continuous run stopped (owner only)
  const handleRunStopped = () => {
    setActiveJob(null);
    setConfig(prev => prev ? { ...prev, status: 'idle' } : prev);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error || 'Config not found'}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg"
        >
          Go Back
        </button>
      </div>
    );
  }

  // Build tabs based on backend-provided dataAccess level.
  // Items tab: hidden from non-owners when config.hideItems is true.
  // Content tab: always shown — the backend returns preview data for monetized configs.
  const showItemsTab = isOwner || !config.hideItems;

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'topics', label: 'Topics' },
    ...(showItemsTab ? [{ id: 'items', label: 'Items' }] : []),
    { id: 'content', label: 'Content' },
    // Runs and settings: owner only
    ...(isOwner ? [
      { id: 'runs', label: 'Runs' },
      { id: 'settings', label: 'Settings' },
    ] : []),
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => navigate(-1)}
              className="text-stone-400 hover:text-stone-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-stone-800">{config.name}</h1>
            {/* Public badge for non-owners */}
            {!isOwner && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                {config.visibility}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <p className="text-stone-500">/{config.slug}</p>
            {config.monetizationEnabled && (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs rounded font-medium">
                ${config.pricePerQuery?.toFixed(4)}/query
              </span>
            )}
          </div>
          {!isOwner && config.description && (
            <p className="text-stone-500 text-sm mt-2 max-w-xl">{config.description}</p>
          )}
        </div>

        {/* Run Actions — owner only */}
        {isOwner && (
          <RunActions
            configId={config.id}
            configStatus={config.status}
            configJson={config.configJson}
            isLocalExecution={config.isLocalExecution}
            activeJob={activeJob}
            onRunStarted={handleRunStarted}
            onRunStopped={handleRunStopped}
          />
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab config={config} stats={stats} />}

      {activeTab === 'topics' && (
        <TopicsTab configId={config.id} authToken={authToken} />
      )}

      {activeTab === 'items' && showItemsTab && (
        <ItemsTab configId={config.id} authToken={authToken} />
      )}

      {activeTab === 'content' && (
        <ContentTab configId={config.id} authToken={authToken} />
      )}

      {activeTab === 'runs' && isOwner && <RunsTab configId={config.id} />}

      {activeTab === 'settings' && isOwner && authToken && (
        <SettingsTab 
          config={config} 
          authToken={authToken}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

/**
 * Config page — accessible to all users (public view for non-owners)
 */
export default function ConfigPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader />
      <ConfigPageContent />
    </div>
  );
}
