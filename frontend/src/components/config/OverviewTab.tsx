import React from 'react';
import { PlatformConfig, ConfigStats } from '../../services/api';

interface OverviewTabProps {
  config: PlatformConfig;
  stats: ConfigStats | null;
}

/**
 * Overview tab content showing stats grid, data range, sources, and last error.
 */
export function OverviewTab({ config, stats }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <p className="text-stone-500 text-sm">Total Items</p>
          <p className="text-2xl font-bold text-stone-800 mt-1">
            {config.totalItems.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <p className="text-stone-500 text-sm">Total Queries</p>
          <p className="text-2xl font-bold text-stone-800 mt-1">
            {config.totalQueries.toLocaleString()}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <p className="text-stone-500 text-sm">Total Cost</p>
          <p className="text-2xl font-bold text-stone-800 mt-1">
            {stats?.totalCost != null && stats.totalCost > 0
              ? `$${stats.totalCost.toFixed(4)}`
              : '$0.00'}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <p className="text-stone-500 text-sm">Revenue</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            ${(config.totalRevenue || 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <p className="text-stone-500 text-sm">Status</p>
          <p className={`text-2xl font-bold mt-1 ${
            config.status === 'running' ? 'text-emerald-600' :
            config.status === 'error' ? 'text-red-600' :
            'text-stone-500'
          }`}>
            {config.status.charAt(0).toUpperCase() + config.status.slice(1)}
          </p>
        </div>
      </div>

      {/* Date Range */}
      {stats?.dateRange && (
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <h3 className="font-medium text-stone-800 mb-2">Data Range</h3>
          <p className="text-stone-500">
            {new Date(stats.dateRange.from).toLocaleDateString()} - {new Date(stats.dateRange.to).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Sources */}
      {stats?.sources && stats.sources.length > 0 && (
        <div className="bg-white rounded-lg p-4 border border-stone-200">
          <h3 className="font-medium text-stone-800 mb-4">Sources</h3>
          <div className="space-y-2">
            {stats.sources.map((source, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-stone-200 last:border-0">
                <span className="text-stone-600">{source.source}</span>
                <div className="flex items-center gap-4">
                  <span className="text-stone-500 text-sm">{source.count.toLocaleString()} items</span>
                  <span className="text-stone-500 text-xs">
                    Last: {new Date(source.latestDate).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Error */}
      {config.lastError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="font-medium text-red-600 mb-2">Last Error</h3>
          <p className="text-red-500 text-sm font-mono">{config.lastError}</p>
        </div>
      )}
    </div>
  );
}
