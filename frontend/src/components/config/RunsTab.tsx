// frontend/src/components/config/RunsTab.tsx

import React, { useState } from 'react';
import { useRuns, useRunDetails } from '../../hooks/useRuns';
import { AggregationRun } from '../../services/api';

interface RunsTabProps {
  configId: string;
}

/**
 * Status badge component
 */
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-900/50 text-yellow-400',
    running: 'bg-blue-900/50 text-blue-400',
    completed: 'bg-green-900/50 text-green-400',
    failed: 'bg-red-900/50 text-red-400',
    cancelled: 'bg-stone-700 text-stone-400',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-stone-700 text-stone-400'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/**
 * Job type badge component
 */
function JobTypeBadge({ jobType }: { jobType: string }) {
  const isContinuous = jobType === 'continuous';
  
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${
      isContinuous 
        ? 'bg-purple-900/50 text-purple-400' 
        : 'bg-stone-700 text-stone-300'
    }`}>
      {isContinuous ? 'Continuous' : 'One-time'}
    </span>
  );
}

/**
 * Format duration from milliseconds
 */
function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '-';
  
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = end - start;
  
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
  if (durationMs < 3600000) return `${Math.round(durationMs / 60000)}m`;
  return `${Math.round(durationMs / 3600000)}h`;
}

/**
 * Format interval to human readable
 */
function formatInterval(intervalMs?: number): string {
  if (!intervalMs) return '-';
  
  if (intervalMs < 60000) return `${Math.round(intervalMs / 1000)}s`;
  if (intervalMs < 3600000) return `${Math.round(intervalMs / 60000)}m`;
  return `${Math.round(intervalMs / 3600000)}h`;
}

/**
 * Run details modal
 */
function RunDetailsModal({ 
  configId, 
  runId, 
  onClose 
}: { 
  configId: string; 
  runId: string; 
  onClose: () => void;
}) {
  const { run, isLoading, error } = useRunDetails(configId, runId);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-stone-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-stone-800 rounded-lg p-6 max-w-2xl w-full mx-4">
          <div className="text-center py-8 text-red-400">
            {error || 'Run not found'}
          </div>
          <button
            onClick={onClose}
            className="w-full mt-4 px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-stone-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-stone-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white">Run Details</h3>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Status and Type */}
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <JobTypeBadge jobType={run.jobType} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-stone-900 rounded-lg p-3">
              <p className="text-stone-400 text-xs">Items Fetched</p>
              <p className="text-white text-lg font-medium">{run.itemsFetched.toLocaleString()}</p>
            </div>
            <div className="bg-stone-900 rounded-lg p-3">
              <p className="text-stone-400 text-xs">Items Processed</p>
              <p className="text-white text-lg font-medium">{run.itemsProcessed.toLocaleString()}</p>
            </div>
            <div className="bg-stone-900 rounded-lg p-3">
              <p className="text-stone-400 text-xs">Run Count</p>
              <p className="text-white text-lg font-medium">{run.runCount}</p>
            </div>
            <div className="bg-stone-900 rounded-lg p-3">
              <p className="text-stone-400 text-xs">Duration</p>
              <p className="text-white text-lg font-medium">{formatDuration(run.startedAt, run.completedAt)}</p>
            </div>
          </div>

          {/* Timestamps */}
          <div className="bg-stone-900 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-stone-400">Created</span>
              <span className="text-stone-300">{new Date(run.createdAt).toLocaleString()}</span>
            </div>
            {run.startedAt && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Started</span>
                <span className="text-stone-300">{new Date(run.startedAt).toLocaleString()}</span>
              </div>
            )}
            {run.completedAt && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Completed</span>
                <span className="text-stone-300">{new Date(run.completedAt).toLocaleString()}</span>
              </div>
            )}
            {run.lastFetchAt && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Last Fetch</span>
                <span className="text-stone-300">{new Date(run.lastFetchAt).toLocaleString()}</span>
              </div>
            )}
            {run.globalInterval && (
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Interval</span>
                <span className="text-stone-300">{formatInterval(run.globalInterval)}</span>
              </div>
            )}
          </div>

          {/* Error */}
          {run.errorMessage && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
              <p className="text-red-400 text-xs mb-1">Error</p>
              <p className="text-red-300 text-sm font-mono">{run.errorMessage}</p>
            </div>
          )}

          {/* Logs */}
          {run.logs && run.logs.length > 0 && (
            <div className="bg-stone-900 rounded-lg p-4">
              <p className="text-stone-400 text-xs mb-2">Logs</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {run.logs.map((log, i) => (
                  <div key={i} className={`text-xs font-mono ${
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-yellow-400' :
                    'text-stone-400'
                  }`}>
                    <span className="text-stone-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    {' '}
                    <span className="uppercase">[{log.level}]</span>
                    {log.source && <span className="text-stone-500"> ({log.source})</span>}
                    {' '}
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Runs tab content component
 */
export function RunsTab({ configId }: RunsTabProps) {
  const { runs, isLoading, error, pagination, loadMore, refresh } = useRuns(configId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  if (isLoading && runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={refresh}
          className="px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-stone-400">
        <p className="mb-2">No runs yet</p>
        <p className="text-sm">Run an aggregation to see the history here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-stone-400 text-sm">
          {pagination.total.toLocaleString()} total runs
        </p>
        <button
          onClick={refresh}
          className="text-sm text-amber-400 hover:text-amber-300"
        >
          Refresh
        </button>
      </div>

      {/* Runs List */}
      <div className="bg-stone-800 rounded-lg border border-stone-700 overflow-hidden">
        <div className="divide-y divide-stone-700">
          {runs.map((run) => (
            <div 
              key={run.id} 
              className="p-4 hover:bg-stone-750 cursor-pointer transition-colors"
              onClick={() => setSelectedRunId(run.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={run.status} />
                  <JobTypeBadge jobType={run.jobType} />
                </div>
                <span className="text-stone-500 text-xs">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
              
              <div className="mt-2 flex items-center gap-4 text-sm">
                <span className="text-stone-400">
                  <span className="text-white">{run.itemsFetched.toLocaleString()}</span> items
                </span>
                {run.jobType === 'continuous' && (
                  <span className="text-stone-400">
                    <span className="text-white">{run.runCount}</span> ticks
                  </span>
                )}
                <span className="text-stone-400">
                  {formatDuration(run.startedAt, run.completedAt)}
                </span>
              </div>

              {run.errorMessage && (
                <p className="mt-2 text-red-400 text-xs truncate">
                  {run.errorMessage}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Load More */}
      {pagination.hasMore && (
        <button
          onClick={loadMore}
          disabled={isLoading}
          className="w-full py-2 text-sm text-amber-400 hover:text-amber-300 disabled:text-stone-500"
        >
          {isLoading ? 'Loading...' : 'Load more'}
        </button>
      )}

      {/* Details Modal */}
      {selectedRunId && (
        <RunDetailsModal
          configId={configId}
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
        />
      )}
    </div>
  );
}

export default RunsTab;
