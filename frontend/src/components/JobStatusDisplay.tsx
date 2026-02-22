import React, { useState, useEffect, useRef } from 'react';
import { JobStatus } from '../types';

interface JobStatusDisplayProps {
  jobStatus: JobStatus | null;
  runMode?: "once" | "continuous";
  onClose?: () => void;
}

const formatDuration = (startTime?: number, isCompleted = false, completedAt?: number) => {
  if (!startTime) return '0s';
  
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

const PhaseIcon: React.FC<{ phase: string; isActive: boolean }> = ({ phase, isActive }) => {
  const baseClass = `w-4 h-4 ${isActive ? 'text-amber-400' : 'text-stone-500'}`;
  
  switch (phase) {
    case 'connecting':
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
        </svg>
      );
    case 'fetching':
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      );
    case 'enriching':
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case 'generating':
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'waiting':
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return (
        <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
  }
};

const getPhaseLabel = (phase?: string): string => {
  switch (phase) {
    case 'connecting': return 'Connecting';
    case 'fetching': return 'Fetching Data';
    case 'enriching': return 'Enriching Content';
    case 'generating': return 'Generating Output';
    case 'waiting': return 'Waiting';
    case 'idle': return 'Idle';
    default: return 'Processing';
  }
};

export const JobStatusDisplay: React.FC<JobStatusDisplayProps> = ({ jobStatus, runMode, onClose }) => {
  const [, setTick] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const prevJobIdRef = useRef<string | null>(null);
  const wasContinuousRef = useRef<boolean>(false);
  const [fixedDuration, setFixedDuration] = useState<string | null>(null);
  
  // Detect job ID changes to reset display state
  useEffect(() => {
    if (jobStatus && prevJobIdRef.current !== jobStatus.jobId) {
      setIsCollapsed(false);
      setFixedDuration(null);
      wasContinuousRef.current = jobStatus.progress === undefined || runMode === "continuous";
      prevJobIdRef.current = jobStatus.jobId;
    }
  }, [jobStatus?.jobId, runMode]);
  
  // Timer for duration updates
  useEffect(() => {
    if (!jobStatus) return;
    
    const isCompleted = jobStatus.status === 'completed' || jobStatus.status === 'failed';
    if (isCompleted && !wasContinuousRef.current) return;
    
    const timerId = setInterval(() => setTick(prev => prev + 1), 1000);
    return () => clearInterval(timerId);
  }, [jobStatus]);
  
  // Set fixed duration when job completes
  useEffect(() => {
    if (!jobStatus) return;
    
    if (wasContinuousRef.current) {
      setFixedDuration(null);
      return;
    }
    
    if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
      setFixedDuration(formatDuration(jobStatus.startTime, true, jobStatus.result?.completedAt));
    } else {
      setFixedDuration(null);
    }
  }, [jobStatus?.status, jobStatus?.startTime]);

  if (!jobStatus) return null;

  const isContinuous = wasContinuousRef.current;
  const isCompleted = !isContinuous && (jobStatus.status === 'completed' || jobStatus.status === 'failed');
  const isRunning = jobStatus.status === 'running' || jobStatus.status === 'pending';
  const isFailed = jobStatus.status === 'failed';
  
  const progress = jobStatus.progress ?? 0;
  const duration = fixedDuration || formatDuration(jobStatus.startTime);
  const totalItems = jobStatus.aggregationStatus?.stats?.totalItemsFetched || 0;
  const currentPhase = jobStatus.aggregationStatus?.currentPhase;
  const currentSource = jobStatus.aggregationStatus?.currentSource;
  const itemsPerSource = jobStatus.aggregationStatus?.stats?.itemsPerSource || {};
  const errors = jobStatus.aggregationStatus?.errors || [];
  const aiStats = jobStatus.aggregationStatus?.stats;
  const totalTokens = (aiStats?.totalPromptTokens || 0) + (aiStats?.totalCompletionTokens || 0);
  const estimatedCost = aiStats?.estimatedCostUsd || 0;
  const totalAiCalls = aiStats?.totalAiCalls || 0;

  // Status colors and styles
  const headerBg = isCompleted 
    ? (isFailed ? 'bg-red-500/10' : 'bg-green-500/10')
    : 'bg-amber-500/10';
  
  const borderColor = isCompleted
    ? (isFailed ? 'border-red-500/30' : 'border-green-500/30')
    : 'border-amber-500/30';

  const statusDotColor = isCompleted 
    ? (isFailed ? 'bg-red-400' : 'bg-green-400')
    : 'bg-amber-400 animate-pulse';

  return (
    <div className={`bg-stone-900/95 backdrop-blur-sm border ${borderColor} rounded-lg shadow-xl overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-3 ${headerBg} border-b ${borderColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Animated status dot */}
            <div className={`w-2.5 h-2.5 rounded-full ${statusDotColor}`} />
            
            <div>
              <h3 className="text-sm font-semibold text-stone-100">
                {isCompleted ? (isFailed ? 'Aggregation Failed' : 'Aggregation Complete') : 'Aggregation Running'}
              </h3>
              <p className="text-xs text-stone-400">{jobStatus.configName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-700/50 rounded transition-colors"
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-stone-200 hover:bg-stone-700/50 rounded transition-colors"
                title="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Progress bar - always visible */}
      <div className="h-1 bg-stone-800">
        {isRunning ? (
          isContinuous ? (
            <div className="h-full bg-amber-500/60 w-full relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-shimmer" />
            </div>
          ) : (
            <div 
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          )
        ) : (
          <div 
            className={`h-full ${isFailed ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: '100%' }}
          />
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Current Activity - prominent display */}
          {isRunning && (currentPhase || currentSource) && (
            <div className="px-4 py-3 border-b border-stone-700/50 bg-stone-800/30">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <PhaseIcon phase={currentPhase || ''} isActive={true} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-400">{getPhaseLabel(currentPhase)}</p>
                  {currentSource && (
                    <p className="text-xs text-stone-400 truncate">
                      Source: <span className="text-stone-300">{currentSource}</span>
                    </p>
                  )}
                </div>
                {!isContinuous && (
                  <div className="text-right">
                    <p className="text-lg font-semibold text-stone-200">{progress}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stats row */}
          <div className="px-4 py-3 grid grid-cols-3 gap-4 border-b border-stone-700/50">
            <div>
              <p className="text-xs text-stone-500 uppercase tracking-wide">Duration</p>
              <p className="text-sm font-medium text-stone-200 mt-0.5">{duration}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500 uppercase tracking-wide">Items</p>
              <p className="text-sm font-medium text-stone-200 mt-0.5">{totalItems}</p>
            </div>
            <div>
              <p className="text-xs text-stone-500 uppercase tracking-wide">Mode</p>
              <p className="text-sm font-medium text-stone-200 mt-0.5">{isContinuous ? 'Continuous' : 'Run Once'}</p>
            </div>
          </div>

          {/* AI Usage stats row - only show if there are AI calls */}
          {totalAiCalls > 0 && (
            <div className="px-4 py-3 grid grid-cols-3 gap-4 border-b border-stone-700/50">
              <div>
                <p className="text-xs text-stone-500 uppercase tracking-wide">AI Calls</p>
                <p className="text-sm font-medium text-stone-200 mt-0.5">{totalAiCalls}</p>
              </div>
              <div>
                <p className="text-xs text-stone-500 uppercase tracking-wide">Tokens</p>
                <p className="text-sm font-medium text-stone-200 mt-0.5">
                  {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500 uppercase tracking-wide">Est. Cost</p>
                <p className="text-sm font-medium text-stone-200 mt-0.5">
                  {estimatedCost > 0 ? `$${estimatedCost.toFixed(4)}` : '-'}
                </p>
              </div>
            </div>
          )}

          {/* Sources breakdown */}
          {Object.keys(itemsPerSource).length > 0 && (
            <div className="px-4 py-3 border-b border-stone-700/50">
              <p className="text-xs text-stone-500 uppercase tracking-wide mb-2">Sources</p>
              <div className="space-y-1.5">
                {Object.entries(itemsPerSource)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .map(([source, count]) => {
                    const isCurrentSource = currentSource === source && isRunning;
                    return (
                      <div 
                        key={source}
                        className={`flex items-center justify-between py-1.5 px-2 rounded ${
                          isCurrentSource ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-stone-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isCurrentSource && (
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          )}
                          <span className={`text-sm truncate ${isCurrentSource ? 'text-amber-300' : 'text-stone-300'}`}>
                            {source}
                          </span>
                        </div>
                        <span className={`text-sm font-medium ml-2 ${isCurrentSource ? 'text-amber-400' : 'text-stone-400'}`}>
                          {String(count)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Errors section */}
          {(jobStatus.error || errors.length > 0) && (
            <div className="px-4 py-3 bg-red-500/5">
              <p className="text-xs text-red-400 uppercase tracking-wide mb-2">
                {errors.length > 0 ? `${errors.length} Error${errors.length > 1 ? 's' : ''}` : 'Error'}
              </p>
              
              {jobStatus.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded px-3 py-2 mb-2">
                  <p className="text-sm text-red-300">{jobStatus.error}</p>
                </div>
              )}
              
              {errors.length > 0 && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {errors.map((error, i) => (
                    <div key={i} className="bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                      {error.source && (
                        <p className="text-xs text-red-400 font-medium mb-0.5">{error.source}</p>
                      )}
                      <p className="text-sm text-red-300">{error.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer with job ID */}
          <div className="px-4 py-2 bg-stone-800/30">
            <p className="text-[10px] text-stone-500 font-mono">
              Job: {jobStatus.jobId}
            </p>
          </div>
        </>
      )}

      {/* Collapsed summary */}
      {isCollapsed && (
        <div className="px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className={`font-medium ${isCompleted ? (isFailed ? 'text-red-400' : 'text-green-400') : 'text-amber-400'}`}>
              {isCompleted ? (isFailed ? 'Failed' : 'Complete') : getPhaseLabel(currentPhase)}
            </span>
            <span className="text-stone-400">{duration}</span>
          </div>
          <div className="flex items-center gap-2 text-stone-400">
            {!isContinuous && isRunning && <span>{progress}%</span>}
            <span>{totalItems} items</span>
            {estimatedCost > 0 && <span>${estimatedCost.toFixed(4)}</span>}
          </div>
        </div>
      )}
    </div>
  );
};
