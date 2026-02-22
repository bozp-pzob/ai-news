import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Return type for useAsyncAction hook
 */
export interface AsyncActionState<T> {
  /** The result data from the last successful execution */
  data: T | null;
  /** Whether the action is currently executing */
  isLoading: boolean;
  /** Error message from the last failed execution */
  error: string | null;
  /** Execute the async action. Returns the result or null on error. */
  execute: (...args: unknown[]) => Promise<T | null>;
  /** Reset state (clear data, error, and loading) */
  reset: () => void;
}

/**
 * Generic hook to eliminate the repeated isLoading/error/try-catch-finally pattern.
 * 
 * Handles:
 * - Loading state management
 * - Error state management  
 * - Stale request prevention (won't set state after unmount)
 * 
 * @param asyncFn - The async function to wrap
 * @param errorPrefix - Optional prefix for error messages (e.g., "Failed to fetch runs")
 * 
 * @example
 * ```tsx
 * const { data: runs, isLoading, error, execute: fetchRuns } = useAsyncAction(
 *   (offset: number) => runsApi.list(authToken!, configId, { limit: 20, offset }),
 *   'Failed to fetch runs'
 * );
 * ```
 */
export function useAsyncAction<T>(
  asyncFn: (...args: any[]) => Promise<T>,
  errorPrefix?: string
): AsyncActionState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (...args: unknown[]): Promise<T | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await asyncFn(...args);
      if (mountedRef.current) {
        setData(result);
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'An error occurred';
        setError(errorPrefix ? `${errorPrefix}: ${message}` : message);
      }
      return null;
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [asyncFn, errorPrefix]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, isLoading, error, execute, reset };
}

/**
 * Simplified version that auto-fetches on mount and when deps change.
 * Built on top of useAsyncAction.
 * 
 * @param asyncFn - The async function to call (should be a stable reference via useCallback)
 * @param deps - When these values change, the query re-fetches
 * @param options - Configuration options
 * 
 * @example
 * ```tsx
 * const fetchFn = useCallback(() => runsApi.list(authToken!, configId), [authToken, configId]);
 * const { data: runs, isLoading, error, refetch } = useAsyncQuery(
 *   fetchFn,
 *   { enabled: !!authToken && !!configId }
 * );
 * ```
 */
export function useAsyncQuery<T>(
  asyncFn: () => Promise<T>,
  options: { enabled?: boolean } = {}
) {
  const { enabled = true } = options;
  const { data, isLoading, error, execute, reset } = useAsyncAction(asyncFn);

  useEffect(() => {
    if (enabled) {
      execute();
    }
  }, [enabled, execute]);

  return {
    data,
    isLoading,
    error,
    refetch: execute,
    reset,
  };
}
