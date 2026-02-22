// frontend/src/components/config/RunActions.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { 
  useFreeRunStatus, 
  useRunFree, 
  useRunPaid, 
  useRunContinuous 
} from '../../hooks/useRuns';
import { useLicense } from '../../hooks/useLicense';
import { useAuth } from '../../context/AuthContext';
import { AggregationRun, relayApi } from '../../services/api';
import { secretManager } from '../../services/SecretManager';
import { localServerSettings } from '../../services/localConfigStorage';
import { encryptConfig } from '../../services/configEncryption';

interface RunActionsProps {
  configId: string;
  configStatus: string;
  configJson?: any;
  isLocalExecution?: boolean;
  activeJob?: AggregationRun | null;
  onRunStarted?: (jobId: string, jobType: 'one-time' | 'continuous') => void;
  onRunStopped?: () => void;
}

/**
 * Interval options for continuous runs
 */
const INTERVAL_OPTIONS = [
  { value: 15 * 60 * 1000, label: '15 minutes' },
  { value: 30 * 60 * 1000, label: '30 minutes' },
  { value: 60 * 60 * 1000, label: '1 hour' },
  { value: 6 * 60 * 60 * 1000, label: '6 hours' },
  { value: 12 * 60 * 60 * 1000, label: '12 hours' },
  { value: 24 * 60 * 60 * 1000, label: '24 hours' },
];

/**
 * Format time until next free run
 */
function formatTimeUntilFreeRun(resetAt: string): string {
  const now = new Date();
  const reset = new Date(resetAt);
  const diffMs = reset.getTime() - now.getTime();
  
  if (diffMs <= 0) return 'Available now';
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }
  return `Resets in ${minutes}m`;
}

/**
 * Regex to match $SECRET:<id>$ references in config values
 */
const SECRET_REF_REGEX = /\$SECRET:([^$]+)\$/g;

/**
 * Deep-walk a config object and resolve all $SECRET:<id>$ references.
 * Returns a new object with secrets replaced by their actual values.
 */
async function resolveConfigSecrets(configJson: any): Promise<any> {
  if (configJson === null || configJson === undefined) {
    return configJson;
  }

  if (typeof configJson === 'string') {
    // Check if this string contains secret references
    const regex = new RegExp(SECRET_REF_REGEX.source, 'g');
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(configJson)) !== null) {
      matches.push(m);
    }
    if (matches.length === 0) return configJson;

    let resolved = configJson;
    for (const match of matches) {
      const secretId = match[1];
      const secretValue = await secretManager.getSecret(secretId);
      if (secretValue !== null) {
        // If the entire string is a single secret ref, replace with the value directly
        if (match[0] === configJson) {
          return secretValue;
        }
        // Otherwise replace inline
        resolved = resolved.replace(match[0], secretValue);
      }
      // If secret not found, leave the reference as-is (will fail at runtime, but that's user-visible)
    }
    return resolved;
  }

  if (Array.isArray(configJson)) {
    return Promise.all(configJson.map((item) => resolveConfigSecrets(item)));
  }

  if (typeof configJson === 'object') {
    const result: any = {};
    for (const key of Object.keys(configJson)) {
      result[key] = await resolveConfigSecrets(configJson[key]);
    }
    return result;
  }

  // Primitives (number, boolean) pass through
  return configJson;
}

/**
 * Check if a config has any $SECRET:xxx$ references
 */
function configHasSecretRefs(obj: any): boolean {
  if (typeof obj === 'string') {
    // Use a fresh regex to avoid lastIndex mutation issues
    return /\$SECRET:[^$]+\$/.test(obj);
  }
  if (Array.isArray(obj)) {
    return obj.some(configHasSecretRefs);
  }
  if (obj && typeof obj === 'object') {
    return Object.values(obj).some(configHasSecretRefs);
  }
  return false;
}

/**
 * Run Actions component - provides buttons for free run, paid run, and continuous runs.
 * Handles secret resolution and local execution branching.
 */
export function RunActions({ 
  configId, 
  configStatus,
  configJson,
  isLocalExecution,
  activeJob,
  onRunStarted,
  onRunStopped,
}: RunActionsProps) {
  const { authToken } = useAuth();
  const { status: freeRunStatus, refresh: refreshFreeStatus } = useFreeRunStatus();
  const { isActive: isPro } = useLicense();
  const { run: runFree, isRunning: isRunningFree, error: freeError } = useRunFree(configId);
  const { run: runPaid, isRunning: isRunningPaid, error: paidError, paymentRequired } = useRunPaid(configId);
  const { start: startContinuous, stop: stopContinuous, isStarting, isStopping, error: continuousError } = useRunContinuous(configId);
  
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState(INTERVAL_OPTIONS[2].value); // Default 1 hour
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isLocalRunning, setIsLocalRunning] = useState(false);

  const isRunning = configStatus === 'running';
  const hasContinuousJob = activeJob?.jobType === 'continuous' && activeJob?.status === 'running';
  const isAnyOperationInProgress = isRunningFree || isRunningPaid || isStarting || isStopping || isLocalRunning;

  // Refresh free run status after a run completes
  useEffect(() => {
    if (!isRunningFree && !isRunningPaid) {
      refreshFreeStatus();
    }
  }, [isRunningFree, isRunningPaid, refreshFreeStatus]);

  /**
   * Resolve secrets from the config, if any $SECRET:xxx$ refs exist.
   * Returns the resolved config or null if resolution fails.
   */
  const getResolvedConfig = useCallback(async (): Promise<any | null> => {
    if (!configJson) return null;

    // Only resolve if the config has secret references
    if (!configHasSecretRefs(configJson)) {
      return configJson;
    }

    try {
      // Reset the regex lastIndex since we use it with .test() 
      SECRET_REF_REGEX.lastIndex = 0;
      return await resolveConfigSecrets(configJson);
    } catch (err) {
      console.error('[RunActions] Failed to resolve secrets:', err);
      setLocalError('Failed to resolve secrets. Make sure your secret values are still available.');
      return null;
    }
  }, [configJson]);

  /**
   * Execute via local server relay (encrypted)
   */
  const handleLocalExecution = useCallback(async () => {
    if (!authToken || !configId) return;

    const settings = localServerSettings.get(configId);
    if (!settings?.url || !settings?.key) {
      setLocalError('Local server settings not configured. Set the server URL and encryption key in config settings.');
      return;
    }

    setIsLocalRunning(true);
    setLocalError(null);

    try {
      // Resolve secrets first
      const resolved = await getResolvedConfig();
      if (!resolved) {
        setIsLocalRunning(false);
        return;
      }

      // Encrypt the resolved config with the local server's key
      const encrypted = await encryptConfig(resolved, settings.key);

      // Send via relay
      const result = await relayApi.execute(authToken, {
        ...encrypted,
        targetUrl: settings.url,
      });

      onRunStarted?.(result.jobId, 'one-time');
    } catch (err: any) {
      console.error('[RunActions] Local execution failed:', err);
      setLocalError(err?.message || 'Local execution failed');
    } finally {
      setIsLocalRunning(false);
    }
  }, [authToken, configId, getResolvedConfig, onRunStarted]);

  /**
   * Handle free run — resolves secrets, then calls the API with resolvedConfig
   */
  const handleFreeRun = async () => {
    setLocalError(null);

    if (isLocalExecution) {
      return handleLocalExecution();
    }

    // Resolve secrets for platform execution
    const resolved = await getResolvedConfig();
    // Pass resolvedConfig only if we actually have configJson with secrets
    const result = await runFree(resolved && configJson ? resolved : undefined);
    if (result?.jobId) {
      onRunStarted?.(result.jobId, 'one-time');
      refreshFreeStatus();
    }
  };

  /**
   * Handle paid run — resolves secrets, then calls the API with resolvedConfig
   */
  const handlePaidRun = async () => {
    setLocalError(null);

    if (isLocalExecution) {
      return handleLocalExecution();
    }

    // Resolve secrets for platform execution
    const resolved = await getResolvedConfig();
    const result = await runPaid(resolved && configJson ? resolved : undefined);
    if (result?.jobId) {
      onRunStarted?.(result.jobId, 'one-time');
    }
  };

  const handleStartContinuous = async () => {
    setLocalError(null);

    // Resolve secrets for continuous execution (same as free/paid runs)
    const resolved = await getResolvedConfig();
    const resolvedConfig = resolved && configJson ? resolved : undefined;
    const result = await startContinuous(selectedInterval, resolvedConfig);
    if (result?.jobId) {
      onRunStarted?.(result.jobId, 'continuous');
      setShowIntervalPicker(false);
    }
  };

  const handleStopContinuous = async () => {
    const result = await stopContinuous();
    if (result) {
      onRunStopped?.();
    }
  };

  // Combine all error sources
  const displayError = localError || freeError || paidError || continuousError;

  // If there's an active continuous job, show stop button
  if (hasContinuousJob) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-900/30 border border-purple-700 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-purple-300 text-sm">
            Continuous run active
          </span>
        </div>
        <button
          onClick={handleStopContinuous}
          disabled={isStopping}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
        >
          {isStopping ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    );
  }

  // Show running state
  if (isRunning && !hasContinuousJob) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 border border-amber-700 rounded-lg">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-amber-300 text-sm">Running...</span>
      </div>
    );
  }

  const canUseFreeRun = freeRunStatus?.available ?? false;

  // Local execution mode: show simplified run button
  if (isLocalExecution) {
    return (
      <div className="relative">
        <div className="flex items-center gap-2">
          <button
            onClick={handleLocalExecution}
            disabled={isAnyOperationInProgress}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              !isAnyOperationInProgress
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-stone-700 text-stone-400 cursor-not-allowed'
            }`}
            title="Run on your local server"
          >
            {isLocalRunning ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Sending...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-7-7l7 7-7 7" />
                </svg>
                Run Local
              </span>
            )}
          </button>
        </div>

        {/* Error Messages */}
        {displayError && (
          <p className="mt-2 text-sm text-red-400">{displayError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {/* Free Run Button */}
        <div className="relative">
          <button
            onClick={handleFreeRun}
            disabled={!canUseFreeRun || isAnyOperationInProgress}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              canUseFreeRun && !isAnyOperationInProgress
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-stone-700 text-stone-400 cursor-not-allowed'
            }`}
            title={canUseFreeRun ? 'Run once for free (1 per day)' : freeRunStatus?.resetAt ? formatTimeUntilFreeRun(freeRunStatus.resetAt) : 'Free run not available'}
          >
            {isRunningFree ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running...
              </span>
            ) : (
              'Run Free'
            )}
          </button>
          {!canUseFreeRun && freeRunStatus?.resetAt && (
            <p className="absolute top-full left-0 mt-1 text-xs text-stone-500 whitespace-nowrap">
              {formatTimeUntilFreeRun(freeRunStatus.resetAt)}
            </p>
          )}
        </div>

        {/* Paid Run Button */}
        <button
          onClick={handlePaidRun}
          disabled={isAnyOperationInProgress}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
          title="Run once ($0.10 or included with Pro)"
        >
          {isRunningPaid ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Running...
            </span>
          ) : (
            <>
              Run <span className="text-amber-200 text-sm ml-1">$0.10</span>
            </>
          )}
        </button>

        {/* Continuous Run Button (Pro only) */}
        <div className="relative">
          <button
            onClick={() => {
              if (isPro) {
                setShowIntervalPicker(!showIntervalPicker);
              } else {
                setShowUpgradeHint(true);
                setTimeout(() => setShowUpgradeHint(false), 3000);
              }
            }}
            disabled={isAnyOperationInProgress}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isPro && !isAnyOperationInProgress
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-stone-700 text-stone-400 hover:bg-stone-600'
            }`}
            title={isPro ? 'Start continuous aggregation' : 'Pro subscription required'}
          >
            Continuous
            {!isPro && <span className="ml-1 text-xs text-amber-400">PRO</span>}
          </button>
          
          {/* Upgrade hint tooltip */}
          {showUpgradeHint && !isPro && (
            <div className="absolute top-full left-0 mt-2 px-3 py-2 bg-stone-800 border border-stone-700 rounded-lg shadow-lg z-10 whitespace-nowrap">
              <p className="text-sm text-stone-300">
                Continuous runs require{' '}
                <a href="/upgrade" className="text-amber-400 hover:text-amber-300">
                  Pro subscription
                </a>
              </p>
            </div>
          )}

          {/* Interval Picker Dropdown */}
          {showIntervalPicker && isPro && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-stone-800 border border-stone-700 rounded-lg shadow-lg z-10">
              <div className="p-3 border-b border-stone-700">
                <p className="text-sm font-medium text-white">Select Interval</p>
                <p className="text-xs text-stone-400">How often to fetch new data</p>
              </div>
              <div className="p-2">
                {INTERVAL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSelectedInterval(option.value)}
                    className={`w-full px-3 py-2 text-left text-sm rounded-md transition-colors ${
                      selectedInterval === option.value
                        ? 'bg-purple-600 text-white'
                        : 'text-stone-300 hover:bg-stone-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-stone-700 flex gap-2">
                <button
                  onClick={() => setShowIntervalPicker(false)}
                  className="flex-1 px-3 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-md text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartContinuous}
                  disabled={isStarting}
                  className="flex-1 px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-stone-700 text-white rounded-md text-sm font-medium transition-colors"
                >
                  {isStarting ? 'Starting...' : 'Start'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Messages */}
      {displayError && (
        <p className="mt-2 text-sm text-red-400">{displayError}</p>
      )}

      {/* Payment Required Message */}
      {paymentRequired && (
        <div className="mt-2 p-3 bg-amber-900/20 border border-amber-700 rounded-lg">
          <p className="text-sm text-amber-300">
            Payment required.{' '}
            <a href="/upgrade" className="text-amber-400 hover:text-amber-300 underline">
              Upgrade to Pro
            </a>
            {' '}for unlimited runs or pay $0.10 per run.
          </p>
        </div>
      )}
    </div>
  );
}

export default RunActions;
