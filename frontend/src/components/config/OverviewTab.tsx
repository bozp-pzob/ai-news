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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Total Items</p>
          <p className="text-2xl font-bold text-white mt-1">
            {config.totalItems.toLocaleString()}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Total Queries</p>
          <p className="text-2xl font-bold text-white mt-1">
            {config.totalQueries.toLocaleString()}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Revenue</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">
            ${(config.totalRevenue || 0).toFixed(2)}
          </p>
        </div>
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <p className="text-stone-400 text-sm">Status</p>
          <p className={`text-2xl font-bold mt-1 ${
            config.status === 'running' ? 'text-amber-400' :
            config.status === 'error' ? 'text-red-400' :
            'text-stone-300'
          }`}>
            {config.status.charAt(0).toUpperCase() + config.status.slice(1)}
          </p>
        </div>
      </div>

      {/* Date Range */}
      {stats?.dateRange && (
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <h3 className="font-medium text-white mb-2">Data Range</h3>
          <p className="text-stone-400">
            {new Date(stats.dateRange.from).toLocaleDateString()} - {new Date(stats.dateRange.to).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Sources */}
      {stats?.sources && stats.sources.length > 0 && (
        <div className="bg-stone-800 rounded-lg p-4 border border-stone-700">
          <h3 className="font-medium text-white mb-4">Sources</h3>
          <div className="space-y-2">
            {stats.sources.map((source, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-stone-700 last:border-0">
                <span className="text-stone-300">{source.source}</span>
                <div className="flex items-center gap-4">
                  <span className="text-stone-400 text-sm">{source.count.toLocaleString()} items</span>
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
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <h3 className="font-medium text-red-400 mb-2">Last Error</h3>
          <p className="text-red-300 text-sm font-mono">{config.lastError}</p>
        </div>
      )}
    </div>
  );
}
