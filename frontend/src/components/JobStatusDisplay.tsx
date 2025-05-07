import React, { useState, useEffect, useRef } from 'react';
import { JobStatus } from '../types';
import { LabelWithCount } from './LabelWithCount';

interface JobStatusDisplayProps {
  jobStatus: JobStatus | null;
  runMode?: "once" | "continuous";
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

export const JobStatusDisplay: React.FC<JobStatusDisplayProps> = ({ jobStatus, runMode, onClose }) => {
  // Add state to force re-render
  const [, setTick] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  
  // Add reference to track previous status to prevent invalid transitions
  const prevStatusRef = useRef<string | null>(null);
  const [stableJobStatus, setStableJobStatus] = useState<JobStatus | null>(null);
  // Add reference to track if job was initially continuous
  const wasContinuousRef = useRef<boolean>(false);
  // Add reference to track the last active source and when it became active
  const activeSourceRef = useRef<{source: string, timestamp: number} | null>(null);
  // How long a source should remain highlighted as active (in ms)
  const SOURCE_ACTIVE_DURATION = 5000; // 5 seconds
  
  // Add state for source activity updates
  const [sourceActivityTick, setSourceActivityTick] = useState(0);
  
  // Track the previous job ID to detect new jobs
  const prevJobIdRef = useRef<string | null>(null);
  
  // Once a job is flagged as continuous, it should ALWAYS stay continuous
  // This ensures that even if backend sends progress values later, we still treat it as continuous
  const isContinuousJob = wasContinuousRef.current || stableJobStatus?.progress === undefined || runMode === "continuous";
  
  // Detect job ID changes to reset display state
  useEffect(() => {
    if (jobStatus && prevJobIdRef.current !== jobStatus.jobId) {
      // Reset display state for a new job
      setIsMinimized(false);
      setStableJobStatus(null); // Explicitly clear the stable job status to force a clean state
      setFixedDuration(null);
      setTick(0);
      setIsStopping(false);
      prevStatusRef.current = null;
      wasContinuousRef.current = false;
      activeSourceRef.current = null;
      prevJobIdRef.current = jobStatus.jobId;
    }
  }, [jobStatus?.jobId]);
  
  // Update stable job status while respecting status transition rules
  useEffect(() => {
    if (!jobStatus) {
      setStableJobStatus(null);
      prevStatusRef.current = null;
      wasContinuousRef.current = false;
      return;
    }

    // IMPORTANT: First check if this is a new job
    if (stableJobStatus?.jobId !== jobStatus.jobId) {
      
      // New job detection: if progress is undefined or runMode is continuous, it's a continuous job
      const isContinuous = jobStatus.progress === undefined || runMode === "continuous";
      
      // Set the continuous flag permanently for this job
      wasContinuousRef.current = isContinuous;
      
      // For continuous jobs, always force status to running
      if (isContinuous) {
        setStableJobStatus({
          ...jobStatus,
          status: 'running', // FORCE running status for continuous jobs
          progress: undefined
        });
      } else {
        // For non-continuous jobs, use the actual status
        setStableJobStatus(jobStatus);
      }
      
      prevStatusRef.current = isContinuous ? 'running' : jobStatus.status;
      return;
    }
    
    // EXISTING JOB UPDATES:
    
    // For continuous jobs, ALWAYS override any status updates
    // This is the key fix - we never allow a continuous job to be marked as anything other than running
    if (wasContinuousRef.current) {
      
      setStableJobStatus(prev => ({
        ...jobStatus,
        // CRITICAL: Always override the status to 'running' for continuous jobs
        status: 'running',
        // CRITICAL: Always ensure progress remains undefined for continuous jobs
        progress: undefined
      }));
      
      // Keep the prev status ref as running to prevent any transitions
      prevStatusRef.current = 'running';
      return;
    }
    
    // For NON-continuous jobs, follow normal status transition rules
    setStableJobStatus(jobStatus);
    prevStatusRef.current = jobStatus.status;
  }, [jobStatus, runMode]);
  
  // Ensure displayStatus is always correct based on wasContinuousRef
  useEffect(() => {
    // This runs any time stableJobStatus changes
    // Double-check that continuous jobs remain forced to 'running' status
    if (stableJobStatus && wasContinuousRef.current && stableJobStatus.status !== 'running') {
      setStableJobStatus(prev => ({
        ...prev!,
        status: 'running',
        progress: undefined
      }));
    }
  }, [stableJobStatus]);
  
  // Move hooks before conditional return
  useEffect(() => {
    // Always run the interval for continuous jobs regardless of status
    // For non-continuous jobs, only run if the job is running
    if (!stableJobStatus) return;
    
    // For continuous jobs, always keep the timer running
    // For non-continuous jobs, only run the timer if the job is not completed/failed
    if (!wasContinuousRef.current && 
        (stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed')) {
      return;
    }
    
    const timerId = setInterval(() => {
      setTick(prev => prev + 1);
    }, 1000);
    
    return () => {
      clearInterval(timerId);
    };
  }, [stableJobStatus, wasContinuousRef.current]);
  
  // Add state to store the calculated duration for completed jobs
  const [fixedDuration, setFixedDuration] = useState<string | null>(null);

  // Calculate a fixed duration once when a job completes
  useEffect(() => {
    // For continuous jobs, never set a fixed duration
    if (wasContinuousRef.current) {
      setFixedDuration(null);
      return;
    }
    
    // Only for non-continuous jobs: set a fixed duration when completed
    if (stableJobStatus && (stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed')) {
      const completedAt = stableJobStatus.result?.completedAt;
      setFixedDuration(formatDuration(stableJobStatus.startTime, true, completedAt));
    } else {
      setFixedDuration(null);
    }
  }, [stableJobStatus?.status, stableJobStatus?.startTime, stableJobStatus?.result?.completedAt, wasContinuousRef.current]);
  
  // Reset state when jobId changes
  useEffect(() => {
    // Reset fixed duration when job changes
    setFixedDuration(null);
    setTick(0);
    setIsMinimized(false);
  }, [stableJobStatus?.jobId]);
  
  // Update activeSourceRef when currentSource changes
  useEffect(() => {
    if (stableJobStatus?.aggregationStatus?.currentSource) {
      const currentSource = stableJobStatus.aggregationStatus.currentSource;
      // Only update the active source ref if it's a different source
      if (activeSourceRef.current?.source !== currentSource) {
        activeSourceRef.current = {
          source: currentSource,
          timestamp: Date.now()
        };
      }
    }
  }, [stableJobStatus?.aggregationStatus?.currentSource]);
  
  // Add timer effect for updating source activity indicators
  useEffect(() => {
    // Only run this timer for continuous jobs
    if (!isContinuousJob) {
      return;
    }
    
    // Update more frequently than the job status timer to ensure source
    // activity indicators are updated promptly
    const timerId = setInterval(() => {
      setSourceActivityTick(prev => prev + 1);
    }, 1000); // Update every second
    
    return () => {
      clearInterval(timerId);
    };
  }, [isContinuousJob]);
  
  // Add a handler for stopping the job
  const handleStopJob = async () => {
    if (!stableJobStatus || !stableJobStatus.jobId) return;
    
    try {
      setIsStopping(true);
      
      // Show immediate feedback while waiting for server response
      // This is temporary and will be overwritten when WebSocket gets the actual update
      setStableJobStatus(prev => prev ? {
        ...prev,
        status: 'failed',
        error: 'Stopping job...'
      } : null);
      
      const response = await fetch(`http://localhost:3000/job/${stableJobStatus.jobId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to stop job');
      }
      
      // The WebSocket will receive the status update and update the UI with the actual server state
    } catch (error) {
      console.error('Error stopping job:', error);
      
      // If there was an error, revert to the original status
      if (jobStatus) {
        setStableJobStatus(jobStatus);
      }
    } finally {
      setIsStopping(false);
    }
  };

  if (!stableJobStatus) return null;

  // Modified to NEVER consider continuous jobs as completed under any circumstances
  const isCompleted = wasContinuousRef.current === false && 
                     (stableJobStatus.status === 'completed' || stableJobStatus.status === 'failed');
  const completedAt = stableJobStatus.result?.completedAt;
  
  // Helper function to check if a source has errors
  const sourceHasErrors = (source: string) => {
    if (!stableJobStatus.aggregationStatus?.errors) return false;
    return stableJobStatus.aggregationStatus.errors.some(error => error.source === source);
  };
  
  // Helper function to check if a source is currently active (processing)
  // For continuous jobs, a source is only active if it's currently being processed
  // or if it was recently active (within the SOURCE_ACTIVE_DURATION)
  const isSourceActive = (source: string) => {
    // Dependency on sourceActivityTick ensures this function is reevaluated on timer ticks
    const _ = sourceActivityTick; // Used to force reevaluation when sourceActivityTick changes
    
    const isCurrentlyActive = stableJobStatus.aggregationStatus?.currentSource === source && 
                            (stableJobStatus.status === 'running' || isContinuousJob);
    
    if (isCurrentlyActive) {
      return true;
    }
    
    // For continuous jobs, check if the source was recently active
    if (isContinuousJob && activeSourceRef.current?.source === source) {
      const timeSinceActive = Date.now() - activeSourceRef.current.timestamp;
      return timeSinceActive < SOURCE_ACTIVE_DURATION;
    }
    
    return false;
  };

  // Absolutely FORCE continuous jobs to always show as RUNNING
  // For non-continuous jobs, show the actual status
  const displayStatus = wasContinuousRef.current ? 'RUNNING' : stableJobStatus.status.toUpperCase();

  // Determine card background color based on status
  const cardBackgroundColor = isCompleted
    ? stableJobStatus.status === 'completed' ? 'bg-stone-900/95 border border-green-500/50' : 'bg-stone-900/95 border border-red-500/50'
    : 'bg-stone-900/95 border border-amber-500/30';

  // Show the stop button only for running jobs
  const showStopButton = stableJobStatus && 
    (stableJobStatus.status === 'running' || stableJobStatus.status === 'pending');

  // Render minimized view with circular progress
  if (isMinimized) {
    const progress = stableJobStatus.progress || 0;
    const progressRadius = 18;
    const progressCircumference = 2 * Math.PI * progressRadius;
    const strokeDashoffset = progressCircumference - (progress / 100) * progressCircumference;
    
    return (
      <div className={`${cardBackgroundColor}  border-stone-600/50 shadow-lg p-2 rounded-md flex items-center space-x-3`}
           style={{ backdropFilter: 'blur(8px)' }}>
        <div className="relative w-12 h-12 flex items-center justify-center">
          <svg className="w-full h-full" viewBox="0 0 50 50">
            {/* Background circle */}
            <circle 
              cx="25" 
              cy="25" 
              r={progressRadius} 
              fill="transparent" 
              stroke="rgba(255,255,255,0.1)" 
              strokeWidth="4"
            />
            
            {/* For continuous jobs, show rotating arc indicator */}
            {isContinuousJob ? (
              <circle 
                cx="25" 
                cy="25" 
                r={progressRadius} 
                fill="transparent" 
                stroke="url(#amber-gradient)" 
                strokeWidth="4"
                strokeDasharray={`${progressCircumference * 0.3} ${progressCircumference * 0.7}`}
                transform="rotate(-90 25 25)"
                strokeLinecap="round"
                className="animate-spin-slow"
                style={{ transformOrigin: 'center' }}
              />
            ) : (
              <circle 
                cx="25" 
                cy="25" 
                r={progressRadius} 
                fill="transparent" 
                stroke="url(#amber-gradient)" 
                strokeWidth="4"
                strokeDasharray={progressCircumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 25 25)"
                strokeLinecap="round"
              />
            )}
            
            <defs>
              <linearGradient id="amber-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
            
            {/* Text in the center */}
            <text 
              x="25" 
              y="25" 
              textAnchor="middle" 
              dominantBaseline="middle" 
              fill={isContinuousJob ? "#f59e0b" : "white"}
              style={{ fontSize: '10px', fontWeight: 500 }}
            >
              {isContinuousJob ? (
                <tspan className="animate-pulse"></tspan>
              ) : (
                `${progress}%`
              )}
            </text>
          </svg>
          <div className={`absolute top-0 right-0 h-3 w-3 rounded-full ${
            displayStatus === 'RUNNING' ? 'bg-amber-400' : 
            displayStatus === 'COMPLETED' ? 'bg-green-400' : 
            displayStatus === 'FAILED' ? 'bg-destructive' : 'bg-red-400'
          }`} />
        </div>
        
        <div className="flex-1 min-w-0 text-white">
          <div className="text-xs font-medium truncate">{stableJobStatus.configName}</div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {isCompleted && fixedDuration ? fixedDuration : formatDuration(stableJobStatus.startTime)}
            </span>
            <span className={`text-xs font-medium ${
              displayStatus === 'RUNNING' ? 'text-amber-400' : 
              displayStatus === 'COMPLETED' ? 'text-green-400' : 
              displayStatus === 'FAILED' ? 'text-destructive' : 'text-red-400'
            }`}>
              {displayStatus}
            </span>
          </div>
        </div>
        
        <div className="flex items-center space-x-1">
          <button 
            onClick={() => setIsMinimized(false)}
            className="text-amber-300 hover:text-amber-400 p-1"
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
          {onClose && ! isContinuousJob && (
            <button 
              onClick={onClose}
              className="text-amber-300 hover:text-amber-400 p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }
  
  return (
    <div 
      className={`${cardBackgroundColor}  border-stone-600/50 text-white p-4 rounded-lg shadow-lg transition-all duration-300 ease-in-out`}
      style={{ 
        backdropFilter: 'blur(8px)',
        maxHeight: isMinimized ? '44px' : '500px',
        overflow: 'hidden'
      }}
    >
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div>
            <h3 className="text-lg font-semibold flex items-center text-amber-300">
              Aggregation Status
            </h3>
          </div>
        </div>
        <div className="flex items-center space-x-1">
          
          <button 
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-amber-300 hover:text-amber-400 p-1"
          >
            {isMinimized ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          {onClose && ! isContinuousJob && (
            <button 
              onClick={onClose}
              className="text-amber-300 hover:text-amber-400 p-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>
      
      {/* Rest of content is only visible when not minimized */}
      <div className={`mt-2 ${isMinimized ? 'invisible h-0' : 'visible'}`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status:</span>
            <span className={`font-medium ${
              displayStatus === 'RUNNING' ? 'text-amber-400' : 
              displayStatus === 'COMPLETED' ? 'text-green-400' : 
              displayStatus === 'FAILED' ? 'text-destructive' : 'text-red-400'
            }`}>
              {displayStatus}
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
        
        {/* Show different progress indicators based on whether this is a continuous job or not */}
        {/* For continuous jobs, always show active indicators regardless of backend status */}
        {(wasContinuousRef.current || stableJobStatus.status === 'running') && (
          <div className="mb-2">
            {isContinuousJob ? (
              // For continuous jobs, show an active indicator instead of progress
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-amber-400 font-medium flex items-center">
                  <span className="font-bold">ACTIVE</span>
                  <span className="ml-1.5 h-2.5 w-2.5 bg-amber-400 rounded-full animate-pulse" 
                        style={{ boxShadow: '0 0 10px rgba(245, 158, 11, 0.7)' }}></span>
                </span>
              </div>
            ) : (
              // For run-once jobs, show progress percentage
              stableJobStatus.progress !== undefined && (
                <>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="text-muted-foreground">Progress:</span>
                    <span>{stableJobStatus.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full">
                    <div 
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full"
                      style={{ width: `${stableJobStatus.progress}%` }}
                    />
                  </div>
                </>
              )
            )}
            
            {/* For continuous jobs, show pulsing activity indicator */}
            {isContinuousJob && (
              <div className="w-full h-2.5 bg-stone-800 rounded-full overflow-hidden relative">
                <div 
                  className="h-full absolute bg-amber-300/40 rounded-full"
                  style={{ width: '100%' }}
                />
                <div 
                  className="h-full absolute bg-amber-400 rounded-full w-[30%] animate-progress-indeterminate"
                  style={{ boxShadow: '0 0 10px rgba(245, 158, 11, 0.5)' }}
                />
              </div>
            )}
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
                      <p className="text-muted-foreground">Sources</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1 pb-1">
                      {Object.entries(stableJobStatus.aggregationStatus.stats.itemsPerSource)
                        .sort((a, b) => Number(b[1]) - Number(a[1]))
                        .map(([source, count], index) => {
                          // Determine styling based on source status
                          const isActive = isSourceActive(source);
                          const hasErrors = sourceHasErrors(source);
                          
                          // Priority: errors > active > normal
                          const colorClass = hasErrors ? 'bg-red-400/90' : 
                                            isActive ? 'bg-green-500 animate-source-active-pulse' : 
                                            undefined;
                                              
                          const labelClassName = hasErrors ? 'text-white' : 
                                                isActive ? 'text-white font-bold' : 
                                                '';
                                              
                          const countClassName = hasErrors ? 'bg-red-800/90 text-white' : 
                                                 isActive ? 'bg-green-700 text-white' : 
                                                 'bg-stone-700 text-white';
                          
                          // Determine title text based on status
                          const title = hasErrors ? `Error in source: ${source}` :
                                       isActive ? `Currently processing: ${source}` :
                                       `Source: ${source}`;
                          
                          return (
                            <LabelWithCount 
                              key={source}
                              label={source}
                              count={Number(count)}
                              colorClass={colorClass}
                              labelClassName={labelClassName}
                              countClassName={countClassName}
                              title={title}
                            />
                          );
                        })}
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
    </div>
  );
}; 