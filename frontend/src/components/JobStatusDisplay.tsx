import React, { useState, useEffect, useRef } from 'react';
import { JobStatus } from '../types';
import { LabelWithCount } from './LabelWithCount';

interface JobStatusDisplayProps {
  jobStatus: JobStatus | null;
  onClose?: () => void;
}

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return 'Unknown';
  return new Date(timestamp).toLocaleString();
};

const formatDuration = (startTime?: number, isCompleted = false, completedAt?: number) => {
  if (!startTime) return 'Unknown';
  
  // For completed jobs, use a fixed end time rather than continuous calculation
  const durationMs = isCompleted 
    ? (completedAt || Date.now()) - startTime
    : Date.now() - startTime;
    
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

export const JobStatusDisplay: React.FC<JobStatusDisplayProps> = ({ jobStatus, onClose }) => {
  // Add state to force re-render
  const [, setTick] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  
  // Add reference to track previous status to prevent invalid transitions
  const prevStatusRef = useRef<string | null>(null);
  const [stableJobStatus, setStableJobStatus] = useState<JobStatus | null>(null);
  
  // Update stable job status while respecting status transition rules
  useEffect(() => {
    if (!jobStatus) {
      setStableJobStatus(null);
      prevStatusRef.current = null;
      return;
    }

    // If this is a new job, always update
    if (stableJobStatus?.jobId !== jobStatus.jobId) {
      setStableJobStatus(jobStatus);
      prevStatusRef.current = jobStatus.status;
      return;
    }

    // Prevent transitions from completed/failed back to running
    if ((prevStatusRef.current === 'completed' || prevStatusRef.current === 'failed') && 
        jobStatus.status === 'running') {
      console.warn('Invalid status transition detected:', prevStatusRef.current, 'to', jobStatus.status);
      
      // Keep completed/failed status but update other fields
      setStableJobStatus(prev => prev ? {
        ...jobStatus,
        status: prevStatusRef.current as 'completed' | 'failed'
      } : jobStatus);
      return;
    }

    // Normal update for valid transitions
    setStableJobStatus(jobStatus);
    prevStatusRef.current = jobStatus.status;
  }, [jobStatus]);
  
  // Move hooks before conditional return
  useEffect(() => {
    // Only run the interval if job is running
    if (!stableJobStatus || stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed') {
      return;
    }
    
    const timerId = setInterval(() => {
      setTick(prev => prev + 1);
    }, 1000);
    
    return () => {
      clearInterval(timerId);
    };
  }, [stableJobStatus]);
  
  // Add state to store the calculated duration for completed jobs
  const [fixedDuration, setFixedDuration] = useState<string | null>(null);

  // Calculate a fixed duration once when a job completes
  useEffect(() => {
    if (stableJobStatus && (stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed')) {
      const completedAt = stableJobStatus.result?.completedAt;
      setFixedDuration(formatDuration(stableJobStatus.startTime, true, completedAt));
    } else {
      setFixedDuration(null);
    }
  }, [stableJobStatus?.status, stableJobStatus?.startTime, stableJobStatus?.result?.completedAt]);
  
  // Reset state when jobId changes
  useEffect(() => {
    // Reset fixed duration when job changes
    setFixedDuration(null);
    setTick(0);
    setIsMinimized(false);
  }, [stableJobStatus?.jobId]);
  
  if (!stableJobStatus) return null;

  const isCompleted = stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed';
  const completedAt = stableJobStatus.result?.completedAt;
  
  // Helper function to check if a source has errors
  const sourceHasErrors = (source: string) => {
    if (!stableJobStatus.aggregationStatus?.errors) return false;
    return stableJobStatus.aggregationStatus.errors.some(error => error.source === source);
  };

  // Render minimized view with circular progress
  if (isMinimized) {
    const progress = stableJobStatus.progress || 0;
    const progressRadius = 18;
    const progressCircumference = 2 * Math.PI * progressRadius;
    const strokeDashoffset = progressCircumference - (progress / 100) * progressCircumference;
    
    return (
      <div className="bg-stone-700 border border-amber-400/30 shadow-sm p-2 rounded-md flex items-center space-x-3">
        <div className="relative w-12 h-12 flex items-center justify-center">
          <svg className="w-full h-full" viewBox="0 0 50 50">
            <circle 
              cx="25" 
              cy="25" 
              r={progressRadius} 
              fill="transparent" 
              stroke="rgba(255,255,255,0.1)" 
              strokeWidth="4"
            />
            <circle 
              cx="25" 
              cy="25" 
              r={progressRadius} 
              fill="transparent" 
              stroke="url(#blue-gradient)" 
              strokeWidth="4"
              strokeDasharray={progressCircumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 25 25)"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="blue-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <text 
              x="25" 
              y="25" 
              textAnchor="middle" 
              dominantBaseline="middle" 
              className="fill-current" 
              style={{ fontSize: '10px', fontWeight: 500 }}
            >
              {`${progress}%`}
            </text>
          </svg>
          <div className={`absolute top-0 right-0 h-3 w-3 rounded-full ${
            stableJobStatus.status === 'running' ? 'bg-amber-400' : 
            stableJobStatus.status === 'completed' ? 'bg-green-400' : 
            stableJobStatus.status === 'failed' ? 'bg-destructive' : 'bg-red-400'
          }`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{stableJobStatus.configName}</div>
          <div className="text-xs text-muted-foreground">
            {isCompleted && fixedDuration ? fixedDuration : formatDuration(stableJobStatus.startTime)}
          </div>
        </div>
        
        <button 
          onClick={() => setIsMinimized(false)}
          className="text-muted-foreground hover:text-foreground transition-colors pr-2"
          aria-label="Expand"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
    );
  }
  
  return (
    <div className="bg-stone-700 border border-amber-400/30 shadow-sm p-3 rounded-md">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-base font-medium">Job Status</h3>
        <div className="flex space-x-1">
          <button 
            onClick={() => setIsMinimized(true)}
            className="text-muted-foreground hover:text-foreground transition-colors h-6 w-6 flex items-center justify-center"
            aria-label="Minimize"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          {isCompleted && (
            <button 
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors h-6 w-6 flex items-center justify-center"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Status:</span>
          <span className={`font-medium ${
            stableJobStatus.status === 'running' ? 'text-amber-400' : 
            stableJobStatus.status === 'completed' ? 'text-green-400' : 
            stableJobStatus.status === 'failed' ? 'text-destructive' : 'text-red-400'
          }`}>
            {stableJobStatus.status.toUpperCase()}
          </span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">ID:</span>
          <span className="font-mono truncate max-w-28" title={stableJobStatus.jobId}>{stableJobStatus.jobId}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Config:</span>
          <span className="truncate max-w-28" title={stableJobStatus.configName}>{stableJobStatus.configName}</span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">{isCompleted ? 'Duration:' : 'Time:'}</span>
          <span>{isCompleted && fixedDuration ? fixedDuration : formatDuration(stableJobStatus.startTime)}</span>
        </div>
      </div>
      
      {stableJobStatus.progress !== undefined && (
        <div className="mb-2">
          <div className="flex justify-between items-center text-xs mb-1">
            <span className="text-muted-foreground">Progress:</span>
            <span>{stableJobStatus.progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-amber-500 rounded-full"
              style={{ width: `${stableJobStatus.progress}%` }}
            />
          </div>
        </div>
      )}
      
      {stableJobStatus.error && (
        <div className="mt-2">
          <p className="text-xs font-medium text-destructive mb-1">Error</p>
          <div className="bg-destructive/10 p-2 rounded">
            <p className="text-xs text-destructive">{stableJobStatus.error}</p>
          </div>
        </div>
      )}
      
      {/* Display aggregation status details - condensed version */}
      {stableJobStatus.aggregationStatus && (
        <>
          
          {/* Stats - condensed */}
          {stableJobStatus.aggregationStatus.stats && (
            <div className="mt-2 text-xs">
              <p className="font-medium mb-1.5">Statistics</p>
              <div className="bg-muted/10 px-2 py-1.5 rounded mb-2 flex items-center justify-between">
                <span className="text-muted-foreground">Total Items Processed:</span>
                <span className="font-mono font-medium">{stableJobStatus.aggregationStatus.stats.totalItemsFetched || 0}</span>
              </div>
              
              {stableJobStatus.aggregationStatus.stats.itemsPerSource && 
               Object.keys(stableJobStatus.aggregationStatus.stats.itemsPerSource).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-muted-foreground">Items Per Source</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1 pb-1">
                    {Object.entries(stableJobStatus.aggregationStatus.stats.itemsPerSource)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .map(([source, count], index) => (
                        <LabelWithCount 
                          key={source}
                          label={source}
                          count={Number(count)}
                          colorClass={sourceHasErrors(source) ? 'bg-red-400/90' : undefined}
                          labelClassName={sourceHasErrors(source) ? 'text-white' : ''}
                          countClassName={sourceHasErrors(source) ? 'bg-red-800/90 text-white' : 'bg-stone-900 text-white'}
                        />
                      ))}
                  </div>
                </div>
              )}
              
              {stableJobStatus.aggregationStatus.stats.lastFetchTimes && 
               Object.keys(stableJobStatus.aggregationStatus.stats.lastFetchTimes).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Last Fetch Times</summary>
                  <ul className="pl-2 mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                    {Object.entries(stableJobStatus.aggregationStatus.stats.lastFetchTimes).map(([source, time]) => (
                      <li key={source} className="flex justify-between text-xs">
                        <span className="truncate max-w-[60%]" title={source}>{source}:</span> 
                        <span className="text-muted-foreground">{formatTimestamp(time)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          
          {/* Errors - condensed */}
          {stableJobStatus.aggregationStatus.errors && stableJobStatus.aggregationStatus.errors.length > 0 && (
            <div className="mt-2 text-xs">
              <p className="font-medium text-destructive mb-1">Source Errors</p>
              <details>
                <summary className="cursor-pointer text-destructive">Show {stableJobStatus.aggregationStatus.errors.length} Error(s)</summary>
                <div className="max-h-28 overflow-y-auto mt-1">
                  {stableJobStatus.aggregationStatus.errors.map((error, index) => (
                    <div key={index} className="bg-destructive/10 p-1.5 rounded mb-1">
                      <p className="font-medium">
                        {error.source ? `${error.source}:` : 'Error:'}
                      </p>
                      <p className="text-destructive text-xs">{error.message}</p>
                      <p className="text-xs text-muted-foreground">{formatTimestamp(error.timestamp)}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}; 