/**
 * useLocalExecution.ts
 *
 * Shared hook that encapsulates the encrypt-and-relay logic for running
 * a config on a standalone backend. Used by:
 *   - RunActions (ConfigPage)
 *   - DashboardPage
 *   - NodeGraph (BuilderPage)
 *
 * When a config has `isLocalExecution === true`, the run should be routed
 * through the relay to the user's standalone backend instead of running
 * on the platform.
 */

import { useState, useCallback } from 'react';
import { relayApi } from '../services/api';
import { localServerSettings } from '../services/localConfigStorage';
import { encryptConfig } from '../services/configEncryption';

export interface LocalExecutionResult {
  jobId: string;
  status: string;
  message: string;
}

export interface UseLocalExecutionReturn {
  /** Execute a config on the local standalone backend via the relay */
  executeLocal: (
    authToken: string,
    configId: string,
    configJson?: any,
  ) => Promise<LocalExecutionResult>;
  /** Whether a local execution is currently in progress */
  isLocalRunning: boolean;
  /** Error message from the last local execution attempt */
  localError: string | null;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Hook providing a reusable function to run a config on a standalone backend
 * by encrypting it and sending it through the platform relay.
 */
export function useLocalExecution(): UseLocalExecutionReturn {
  const [isLocalRunning, setIsLocalRunning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const clearError = useCallback(() => setLocalError(null), []);

  const executeLocal = useCallback(async (
    authToken: string,
    configId: string,
    configJson?: any,
  ): Promise<LocalExecutionResult> => {
    const settings = localServerSettings.get(configId);
    if (!settings?.url || !settings?.key) {
      const msg = 'Local server settings not configured. Set the server URL and encryption key in config settings.';
      setLocalError(msg);
      throw new Error(msg);
    }

    setIsLocalRunning(true);
    setLocalError(null);

    try {
      // If configJson is provided, encrypt it. Otherwise send a minimal
      // payload — the standalone backend can load the config itself when
      // it receives the execute request.
      const dataToEncrypt = configJson ?? { configId };
      const encrypted = await encryptConfig(dataToEncrypt, settings.key);

      const result = await relayApi.execute(authToken, {
        ...encrypted,
        targetUrl: settings.url,
      });

      return result;
    } catch (err: any) {
      const msg = err?.message || 'Local execution failed';
      console.error('[useLocalExecution] Local execution failed:', err);
      setLocalError(msg);
      throw err;
    } finally {
      setIsLocalRunning(false);
    }
  }, []);

  return { executeLocal, isLocalRunning, localError, clearError };
}
