import { useState, useRef, useCallback } from 'react';
import { JobStatus } from '../types';

export interface JobStatusState {
  currentJobId: string | null;
  setCurrentJobId: (id: string | null) => void;
  jobStatus: JobStatus | null;
  setJobStatus: (status: JobStatus | null) => void;
  jobStatusDisplayClosed: boolean;
  setJobStatusDisplayClosed: (v: boolean) => void;
  isAggregationRunning: boolean;
  setIsAggregationRunning: (v: boolean) => void;
  isRunOnceJob: boolean;
  setIsRunOnceJob: (v: boolean) => void;

  // Refs (exposed for callers that need synchronous access)
  currentJobIdRef: React.MutableRefObject<string | null>;
  jobTypesRef: React.MutableRefObject<Map<string, boolean>>;
  completedJobsRef: React.MutableRefObject<Set<string>>;

  /** Reset all job state for a fresh run */
  resetForNewRun: () => void;
  /** Mark a job as started with the given jobId (updates state + refs) */
  startJob: (jobId: string, isRunOnce: boolean) => void;
  /** Mark the current job as completed */
  markCompleted: (jobId: string) => void;
}

/**
 * Encapsulates the 5 job-status state variables and 3 refs from NodeGraph.
 */
export function useJobStatus(): JobStatusState {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [jobStatusDisplayClosed, setJobStatusDisplayClosed] = useState(false);
  const [isAggregationRunning, setIsAggregationRunning] = useState(false);
  const [isRunOnceJob, setIsRunOnceJob] = useState(false);

  const currentJobIdRef = useRef<string | null>(null);
  const jobTypesRef = useRef<Map<string, boolean>>(new Map());
  const completedJobsRef = useRef<Set<string>>(new Set());

  const resetForNewRun = useCallback(() => {
    setJobStatusDisplayClosed(false);
    setJobStatus(null);
    currentJobIdRef.current = null;
    setCurrentJobId(null);
    completedJobsRef.current.clear();
  }, []);

  const startJob = useCallback((jobId: string, isRunOnce: boolean) => {
    currentJobIdRef.current = jobId;
    setCurrentJobId(jobId);
    setIsRunOnceJob(isRunOnce);
    jobTypesRef.current.set(jobId, isRunOnce);
    setIsAggregationRunning(true);
  }, []);

  const markCompleted = useCallback((jobId: string) => {
    completedJobsRef.current.add(jobId);
    setIsAggregationRunning(false);
  }, []);

  return {
    currentJobId, setCurrentJobId,
    jobStatus, setJobStatus,
    jobStatusDisplayClosed, setJobStatusDisplayClosed,
    isAggregationRunning, setIsAggregationRunning,
    isRunOnceJob, setIsRunOnceJob,
    currentJobIdRef,
    jobTypesRef,
    completedJobsRef,
    resetForNewRun,
    startJob,
    markCompleted,
  };
}
