// frontend/src/pages/DashboardPage.tsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthGuard } from '../components/auth/AuthGuard';
import { userApi, configApi, runsApi, PlatformConfig, UserLimits, RevenueStats } from '../services/api';
import { AppHeader } from '../components/AppHeader';
import { StatCard } from '../components/shared/StatCard';

/**
 * Config list item
 */
function ConfigCard({ config, onRun }: { config: PlatformConfig; onRun: (id: string) => void }) {
  const navigate = useNavigate();

  const statusColors = {
    idle: 'bg-stone-600',
    running: 'bg-amber-500 animate-pulse',
    error: 'bg-red-500',
    paused: 'bg-yellow-500',
  };

  return (
    <div className="bg-stone-800 rounded-lg border border-stone-700 p-4 hover:border-stone-600 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white truncate">{config.name}</h3>
            <span className={`w-2 h-2 rounded-full ${statusColors[config.status]}`} />
          </div>
          <p className="text-stone-400 text-sm mt-1 truncate">
            {config.description || `/${config.slug}`}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          {config.monetizationEnabled && (
            <span className="px-2 py-0.5 bg-amber-900/50 text-amber-400 text-xs rounded">
              ${config.pricePerQuery?.toFixed(4)}/query
            </span>
          )}
          <span className={`px-2 py-0.5 text-xs rounded ${
            config.visibility === 'public' ? 'bg-blue-900/50 text-blue-400' :
            config.visibility === 'private' ? 'bg-stone-700 text-stone-400' :
            'bg-purple-900/50 text-purple-400'
          }`}>
            {config.visibility}
          </span>
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-stone-700">
        <div className="flex items-center gap-4 text-sm text-stone-400">
          <span>{config.totalItems.toLocaleString()} items</span>
          <span>{config.totalQueries.toLocaleString()} queries</span>
          {config.totalRevenue !== undefined && config.totalRevenue > 0 && (
            <span className="text-amber-400">${config.totalRevenue.toFixed(2)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/configs/${config.id}`)}
            className="px-3 py-1 text-sm rounded transition-colors bg-stone-700 hover:bg-stone-600 text-white"
          >
            View
          </button>
          <button
            onClick={() => navigate(`/builder/${config.id}`)}
            className="px-3 py-1 text-sm rounded transition-colors bg-stone-700 hover:bg-stone-600 text-white"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRun(config.id);
            }}
            disabled={config.status === 'running'}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              config.status === 'running'
                ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {config.status === 'running' ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state when user has no configs
 */
function EmptyState({ canCreate, onCreateClick }: { canCreate: boolean; onCreateClick: () => void }) {
  return (
    <div className="text-center py-12">
      <svg 
        className="w-16 h-16 mx-auto text-stone-600 mb-4"
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1} 
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" 
        />
      </svg>
      <h3 className="text-lg font-medium text-white mb-2">No configs yet</h3>
      <p className="text-stone-400 mb-6 max-w-sm mx-auto">
        Create your first config to start aggregating context from your community.
      </p>
      {canCreate ? (
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
        >
          Create Your First Config
        </button>
      ) : (
        <div className="text-stone-500 text-sm">
          <p>You've reached the free tier limit.</p>
          <a href="/upgrade" className="text-amber-400 hover:underline">
            Upgrade to create more configs
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard page component
 */
function DashboardContent() {
  const { authToken, user } = useAuth();
  const navigate = useNavigate();
  
  const [configs, setConfigs] = useState<PlatformConfig[]>([]);
  const [limits, setLimits] = useState<UserLimits | null>(null);
  const [revenue, setRevenue] = useState<RevenueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track polling intervals for cleanup on unmount
  const pollIntervalsRef = React.useRef<Set<NodeJS.Timeout>>(new Set());
  
  React.useEffect(() => {
    return () => {
      // Clean up all polling intervals on unmount
      pollIntervalsRef.current.forEach(clearInterval);
      pollIntervalsRef.current.clear();
    };
  }, []);

  // Load dashboard data
  useEffect(() => {
    async function loadData() {
      if (!authToken) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const [configsRes, limitsRes, revenueRes] = await Promise.all([
          userApi.getMyConfigs(authToken),
          userApi.getMyLimits(authToken),
          userApi.getMyRevenue(authToken),
        ]);
        
        setConfigs(configsRes.configs);
        setLimits(limitsRes);
        setRevenue(revenueRes);
      } catch (err) {
        console.error('Error loading dashboard:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [authToken]);

  // Handle run aggregation
  const handleRunConfig = async (configId: string) => {
    if (!authToken) return;
    
    try {
      const result = await configApi.run(authToken, configId);
      // Update config status in UI
      setConfigs(prev => prev.map(c => 
        c.id === configId ? { ...c, status: 'running' as const } : c
      ));
      
      // Poll for job completion using platform API
      const pollInterval = setInterval(async () => {
        try {
          const job = await runsApi.get(authToken, configId, result.jobId);
          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            clearInterval(pollInterval);
            pollIntervalsRef.current.delete(pollInterval);
            setConfigs(prev => prev.map(c => 
              c.id === configId ? { 
                ...c, 
                status: job.status === 'completed' ? 'idle' as const : 'error' as const 
              } : c
            ));
          }
        } catch (err) {
          // Job might not exist anymore, stop polling
          clearInterval(pollInterval);
          pollIntervalsRef.current.delete(pollInterval);
          setConfigs(prev => prev.map(c => 
            c.id === configId ? { ...c, status: 'idle' as const } : c
          ));
        }
      }, 2000); // Poll every 2 seconds
      pollIntervalsRef.current.add(pollInterval);
      
      // Stop polling after 10 minutes max
      setTimeout(() => {
        clearInterval(pollInterval);
        pollIntervalsRef.current.delete(pollInterval);
      }, 600000);
    } catch (err) {
      console.error('Error running config:', err);
      // Show error toast
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-stone-400 mt-1">
            Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}
          </p>
        </div>
{/* New Config button is in the AppHeader */}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Configs"
          value={configs.length}
          subtitle={limits ? `${limits.limits.maxConfigs === -1 ? 'Unlimited' : `${limits.usage.configCount}/${limits.limits.maxConfigs}`}` : undefined}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          title="Total Items"
          value={configs.reduce((sum, c) => sum + c.totalItems, 0).toLocaleString()}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
        />
        <StatCard
          title="Total Queries"
          value={revenue?.totalTransactions.toLocaleString() || '0'}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          }
        />
        <StatCard
          title="Revenue"
          value={`$${revenue?.totalRevenue.toFixed(2) || '0.00'}`}
          subtitle={revenue && revenue.totalPlatformFees > 0 ? `Platform fees: $${revenue.totalPlatformFees.toFixed(2)}` : undefined}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Tier Info Banner */}
      {limits && limits.tier === 'free' && (
        <div className="bg-gradient-to-r from-amber-900/30 to-stone-900/30 border border-amber-800/50 rounded-lg p-4 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-white">Free Tier</h3>
              <p className="text-stone-400 text-sm mt-1">
                {limits.limits.maxConfigs - limits.usage.configCount} config(s) remaining
                {' '}&bull;{' '}
                {limits.limits.maxRunsPerDay - limits.usage.runsToday} run(s) remaining today
              </p>
            </div>
            <a
              href="/upgrade"
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Upgrade to Pro
            </a>
          </div>
        </div>
      )}

      {/* Configs Section */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Your Configs</h2>
        
        {configs.length === 0 ? (
          <EmptyState 
            canCreate={limits?.canCreateConfig || false}
            onCreateClick={() => navigate('/builder')}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {configs.map(config => (
              <ConfigCard 
                key={config.id} 
                config={config} 
                onRun={handleRunConfig}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Dashboard page with auth guard
 */
export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-stone-950">
      <AppHeader />

      {/* Main content with auth guard */}
      <AuthGuard>
        <DashboardContent />
      </AuthGuard>
    </div>
  );
}
