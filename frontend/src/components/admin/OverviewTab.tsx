import React, { useState, useEffect } from 'react';
import { adminApi, SystemStats, TimeRange } from '../../services/api';
import { StatCard } from '../shared/StatCard';
import { TimeRangeSelector } from './TimeRangeSelector';

interface OverviewTabProps {
  authToken: string;
}

/**
 * Admin overview tab showing system-wide statistics.
 */
export function OverviewTab({ authToken }: OverviewTabProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      setIsLoading(true);
      try {
        const data = await adminApi.getStats(authToken, timeRange);
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        setIsLoading(false);
      }
    }
    loadStats();
  }, [authToken, timeRange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error || 'Failed to load statistics'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex justify-end">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {/* User stats */}
      <div>
        <h3 className="text-sm font-medium text-stone-400 mb-3">Users</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard title="Total" value={stats.users.total} color="blue" />
          <StatCard title="Free" value={stats.users.free} color="muted" />
          <StatCard title="Pro" value={stats.users.paid} color="amber" />
          <StatCard title="Admin" value={stats.users.admin} color="purple" />
          <StatCard title="Banned" value={stats.users.banned} color="red" />
          <StatCard 
            title="New" 
            value={stats.users.newInRange} 
            subtitle={`in ${timeRange === 'all' ? 'total' : timeRange}`}
            color="green"
          />
        </div>
      </div>

      {/* Config stats */}
      <div>
        <h3 className="text-sm font-medium text-stone-400 mb-3">Configs</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard title="Total" value={stats.configs.total} color="blue" />
          <StatCard title="Public" value={stats.configs.public} color="green" />
          <StatCard title="Private" value={stats.configs.private} color="muted" />
          <StatCard title="Unlisted" value={stats.configs.unlisted} color="muted" />
          <StatCard title="Shared" value={stats.configs.shared} color="muted" />
          <StatCard title="Featured" value={stats.configs.featured} color="amber" />
        </div>
      </div>

      {/* Usage stats */}
      <div>
        <h3 className="text-sm font-medium text-stone-400 mb-3">Usage</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard 
            title="Total Runs" 
            value={stats.usage.totalRuns.toLocaleString()} 
            color="muted"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
          />
          <StatCard 
            title="AI Calls Today" 
            value={stats.usage.totalAiCalls.toLocaleString()} 
            color="muted"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
          />
          <StatCard 
            title="API Requests" 
            value={stats.usage.totalApiRequests.toLocaleString()} 
            color="muted"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Revenue stats */}
      <div>
        <h3 className="text-sm font-medium text-stone-400 mb-3">Revenue</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard 
            title="Total Payments" 
            value={stats.revenue.totalPayments.toLocaleString()} 
            color="amber"
          />
          <StatCard 
            title="Total Amount" 
            value={`$${stats.revenue.totalAmount.toFixed(2)}`} 
            color="green"
          />
          <StatCard 
            title="Platform Fees" 
            value={`$${stats.revenue.platformFees.toFixed(2)}`} 
            color="amber"
          />
        </div>
      </div>
    </div>
  );
}
