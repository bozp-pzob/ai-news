// frontend/src/hooks/useRuns.ts

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  runsApi, 
  AggregationRun, 
  FreeRunStatus,
  RunFreeResponse,
  RunPaidResponse,
  RunContinuousResponse,
  ApiError,
} from '../services/api';

/**
 * Hook for fetching and managing run history for a config
 */
export function useRuns(configId: string, autoFetch = true) {
  const { authToken } = useAuth();
  const [runs, setRuns] = useState<AggregationRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 20,
    offset: 0,
    hasMore: false,
  });

  const fetchRuns = useCallback(async (offset = 0) => {
    if (!authToken || !configId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await runsApi.list(authToken, configId, { limit: 20, offset });
      setRuns(result.runs);
      setPagination(result.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runs');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, configId]);

  const loadMore = useCallback(async () => {
    if (!pagination.hasMore || isLoading) return;
    await fetchRuns(pagination.offset + pagination.limit);
  }, [fetchRuns, pagination, isLoading]);

  const refresh = useCallback(() => {
    return fetchRuns(0);
  }, [fetchRuns]);

  useEffect(() => {
    if (autoFetch && authToken && configId) {
      fetchRuns(0);
    }
  }, [autoFetch, authToken, configId, fetchRuns]);

  return {
    runs,
    isLoading,
    error,
    pagination,
    fetchRuns,
    loadMore,
    refresh,
  };
}

/**
 * Hook for fetching a single run's details
 */
export function useRunDetails(configId: string, runId: string) {
  const { authToken } = useAuth();
  const [run, setRun] = useState<AggregationRun | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    if (!authToken || !configId || !runId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await runsApi.get(authToken, configId, runId);
      setRun(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch run details');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, configId, runId]);

  useEffect(() => {
    if (authToken && configId && runId) {
      fetchRun();
    }
  }, [authToken, configId, runId, fetchRun]);

  return {
    run,
    isLoading,
    error,
    refresh: fetchRun,
  };
}

/**
 * Hook for free run status
 */
export function useFreeRunStatus() {
  const { authToken } = useAuth();
  const [status, setStatus] = useState<FreeRunStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!authToken) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await runsApi.getFreeRunStatus(authToken);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch free run status');
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (authToken) {
      fetchStatus();
    }
  }, [authToken, fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refresh: fetchStatus,
  };
}

/**
 * Hook for triggering a free run
 * @param resolvedConfig - Optional: pass a fully-resolved config (secrets injected client-side)
 */
export function useRunFree(configId: string) {
  const { authToken } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunFreeResponse | null>(null);

  const run = useCallback(async (resolvedConfig?: any) => {
    if (!authToken || !configId) return null;
    
    setIsRunning(true);
    setError(null);
    
    try {
      const response = await runsApi.runFree(authToken, configId, resolvedConfig);
      setResult(response);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to run';
      setError(errorMessage);
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [authToken, configId]);

  return {
    run,
    isRunning,
    error,
    result,
  };
}

/**
 * Hook for triggering a paid run
 * @param resolvedConfig - Optional: pass a fully-resolved config (secrets injected client-side)
 */
export function useRunPaid(configId: string) {
  const { authToken } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunPaidResponse | null>(null);
  const [paymentRequired, setPaymentRequired] = useState(false);

  const run = useCallback(async (resolvedConfig?: any) => {
    if (!authToken || !configId) return null;
    
    setIsRunning(true);
    setError(null);
    setPaymentRequired(false);
    
    try {
      const response = await runsApi.runPaid(authToken, configId, resolvedConfig);
      setResult(response);
      return response;
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setPaymentRequired(true);
        setError('Payment required. Please upgrade to Pro or pay per run.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to run');
      }
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [authToken, configId]);

  return {
    run,
    isRunning,
    error,
    result,
    paymentRequired,
  };
}

/**
 * Hook for starting/stopping continuous runs
 */
export function useRunContinuous(configId: string) {
  const { authToken } = useAuth();
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunContinuousResponse | null>(null);

  const start = useCallback(async (globalInterval?: number, resolvedConfig?: any) => {
    if (!authToken || !configId) return null;
    
    setIsStarting(true);
    setError(null);
    
    try {
      const response = await runsApi.runContinuous(authToken, configId, globalInterval, resolvedConfig);
      setResult(response);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start continuous run';
      setError(errorMessage);
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [authToken, configId]);

  const stop = useCallback(async () => {
    if (!authToken || !configId) return null;
    
    setIsStopping(true);
    setError(null);
    
    try {
      const response = await runsApi.stopContinuous(authToken, configId);
      setResult(null);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop continuous run';
      setError(errorMessage);
      return null;
    } finally {
      setIsStopping(false);
    }
  }, [authToken, configId]);

  return {
    start,
    stop,
    isStarting,
    isStopping,
    error,
    result,
  };
}
