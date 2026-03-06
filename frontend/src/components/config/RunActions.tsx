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
import { AggregationRun, relayApi, scheduleApi, ScheduleInfo } from '../../services/api';
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
  const { stop: stopContinuous, isStopping } = useRunContinuous(configId);
  
  const [localError, setLocalError] = useState<string | null>(null);
  const [isLocalRunning, setIsLocalRunning] = useState(false);

  // Schedule state
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null);
  const [selectedCron, setSelectedCron] = useState<string>('');
  const [customAmount, setCustomAmount] = useState<number>(6);
  const [customUnit, setCustomUnit] = useState<'hours' | 'days'>('hours');
  const [isScheduleSaving, setIsScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [countdownText, setCountdownText] = useState<string>('');

  const isRunning = configStatus === 'running';
  const hasContinuousJob = activeJob?.jobType === 'continuous' && activeJob?.status === 'running';
  const isAnyOperationInProgress = isRunningFree || isRunningPaid || isStopping || isLocalRunning;

  // Refresh free run status after a run completes
  useEffect(() => {
    if (!isRunningFree && !isRunningPaid) {
      refreshFreeStatus();
    }
  }, [isRunningFree, isRunningPaid, refreshFreeStatus]);

  // Fetch schedule info on mount and when the picker opens
  useEffect(() => {
    if (authToken && configId && isPro && !scheduleInfo) {
      scheduleApi.get(authToken, configId)
        .then(setScheduleInfo)
        .catch(() => {}); // Silently fail on initial load
    }
  }, [authToken, configId, isPro]);

  // Refresh schedule info when the picker opens
  useEffect(() => {
    if (showSchedulePicker && authToken && configId) {
      scheduleApi.get(authToken, configId)
        .then((info) => {
          setScheduleInfo(info);
          setSelectedCron(info.cronExpression || '');
        })
        .catch((err) => {
          setScheduleError(err?.message || 'Failed to load schedule');
        });
    }
  }, [showSchedulePicker, authToken, configId]);

  // Countdown timer for next scheduled run
  useEffect(() => {
    if (!scheduleInfo?.nextRun) {
      setCountdownText('');
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const next = new Date(scheduleInfo.nextRun!).getTime();
      const diff = next - now;

      if (diff <= 0) {
        setCountdownText('running soon');
        return;
      }

      const totalMinutes = Math.floor(diff / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;

      if (days > 0) {
        setCountdownText(`in ${days}d ${remainingHours}h`);
      } else if (hours > 0) {
        setCountdownText(`in ${hours}h ${minutes}m`);
      } else {
        setCountdownText(`in ${minutes}m`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [scheduleInfo?.nextRun]);

  const buildCustomCron = (): string => {
    if (customUnit === 'hours') {
      return `0 */${customAmount} * * *`;
    }
    // days
    return `0 0 */${customAmount} * *`;
  };

  const handleSetSchedule = async () => {
    if (!authToken) return;
    const cron = selectedCron === 'custom' ? buildCustomCron() : selectedCron;
    if (!cron) return;

    setIsScheduleSaving(true);
    setScheduleError(null);
    try {
      await scheduleApi.set(authToken, configId, cron);
      setShowSchedulePicker(false);
      // Refresh schedule info
      const info = await scheduleApi.get(authToken, configId);
      setScheduleInfo(info);
    } catch (err: any) {
      setScheduleError(err?.message || 'Failed to set schedule');
    } finally {
      setIsScheduleSaving(false);
    }
  };

  const handleRemoveSchedule = async () => {
    if (!authToken) return;
    setIsScheduleSaving(true);
    setScheduleError(null);
    try {
      await scheduleApi.remove(authToken, configId);
      setScheduleInfo((prev) => prev ? { ...prev, cronExpression: null, label: null, nextRun: null } : null);
      setSelectedCron('');
      setCountdownText('');
      setShowSchedulePicker(false);
    } catch (err: any) {
      setScheduleError(err?.message || 'Failed to remove schedule');
    } finally {
      setIsScheduleSaving(false);
    }
  };

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

  const handleStopContinuous = async () => {
    const result = await stopContinuous();
    if (result) {
      onRunStopped?.();
    }
  };

  // Combine all error sources
  const displayError = localError || freeError || paidError;

  // If there's an active continuous job, show stop button
  if (hasContinuousJob) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-purple-700 text-sm">
            Continuous run active
          </span>
        </div>
        <button
          onClick={handleStopContinuous}
          disabled={isStopping}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-stone-200 text-white rounded-lg font-medium transition-colors"
        >
          {isStopping ? 'Stopping...' : 'Stop'}
        </button>
      </div>
    );
  }

  // Show running state
  if (isRunning && !hasContinuousJob) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
        <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-emerald-700 text-sm">Running...</span>
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
                : 'bg-stone-200 text-stone-400 cursor-not-allowed'
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

  const hasActiveSchedule = !!scheduleInfo?.cronExpression;

  // Shared dropdown content — used by both the "Schedule" button and the active schedule pill
  const scheduleDropdown = showSchedulePicker && isPro && (
    <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-stone-200 rounded-xl shadow-xl z-10">
      <div className="p-3 border-b border-stone-100">
        <p className="text-sm font-medium text-stone-800">
          {hasActiveSchedule ? 'Change Schedule' : 'Schedule Runs'}
        </p>
        <p className="text-xs text-stone-400">
          {scheduleInfo?.queueAvailable !== false
            ? 'How often should this run?'
            : 'Scheduling unavailable'}
        </p>
      </div>

      {scheduleInfo?.queueAvailable === false ? (
        <div className="p-3 text-sm text-stone-500">
          Redis is required for scheduled runs. Ask your admin to set <code className="bg-stone-100 px-1 rounded">REDIS_URL</code>.
        </div>
      ) : (
        <>
          <div className="p-1.5">
            {(scheduleInfo?.presets || []).map((preset) => (
              <button
                key={preset.cron}
                onClick={() => setSelectedCron(preset.cron)}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg transition-colors ${
                  selectedCron === preset.cron
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
              >
                {preset.label}
              </button>
            ))}

            <button
              onClick={() => setSelectedCron('custom')}
              className={`w-full px-3 py-2 text-left text-sm rounded-lg transition-colors ${
                selectedCron === 'custom'
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-stone-600 hover:bg-stone-50'
              }`}
            >
              Custom frequency
            </button>
          </div>

          {selectedCron === 'custom' && (
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 text-sm text-stone-700">
                <span className="text-stone-400">Every</span>
                <select
                  value={customAmount}
                  onChange={(e) => setCustomAmount(parseInt(e.target.value))}
                  className="px-2 py-1.5 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  {customUnit === 'hours'
                    ? [1, 2, 3, 4, 6, 8, 12].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))
                    : [1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))
                  }
                </select>
                <select
                  value={customUnit}
                  onChange={(e) => {
                    const unit = e.target.value as 'hours' | 'days';
                    setCustomUnit(unit);
                    setCustomAmount(unit === 'hours' ? 6 : 1);
                  }}
                  className="px-2 py-1.5 border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
            </div>
          )}

          {scheduleError && (
            <p className="px-3 pb-2 text-xs text-red-500">{scheduleError}</p>
          )}

          <div className="p-2 border-t border-stone-100 flex gap-2">
            {hasActiveSchedule && (
              <button
                onClick={handleRemoveSchedule}
                disabled={isScheduleSaving}
                className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
              >
                {isScheduleSaving ? 'Stopping...' : 'Stop'}
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={() => {
                setShowSchedulePicker(false);
                setScheduleError(null);
              }}
              className="px-3 py-2 text-stone-500 hover:text-stone-700 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSetSchedule}
              disabled={isScheduleSaving || !selectedCron}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-stone-200 disabled:text-stone-400 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isScheduleSaving ? 'Saving...' : hasActiveSchedule ? 'Update' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* Run Button */}
        <div className="relative">
          {canUseFreeRun ? (
            <button
              onClick={handleFreeRun}
              disabled={isAnyOperationInProgress}
              className="px-4 py-2 rounded-lg font-medium transition-colors bg-green-600 hover:bg-green-700 text-white"
              title="Run once for free (1 per day)"
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
          ) : (
            <div className="flex flex-col items-start gap-1">
              <button
                onClick={handlePaidRun}
                disabled={isAnyOperationInProgress}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-200 text-white rounded-lg font-medium transition-colors"
                title="Run once ($0.10 or included with Pro)"
              >
                {isRunningPaid ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Running...
                  </span>
                ) : (
                  <>
                    Run <span className="text-emerald-200 text-sm ml-1">$0.10</span>
                  </>
                )}
              </button>
              {freeRunStatus?.resetAt && (
                <p className="text-xs text-stone-400 whitespace-nowrap">
                  Free run {formatTimeUntilFreeRun(freeRunStatus.resetAt).toLowerCase()}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Schedule / Scheduled button */}
        <div className="relative">
          <button
            onClick={() => {
              if (isPro || hasActiveSchedule) {
                setShowSchedulePicker(!showSchedulePicker);
              }
            }}
            disabled={!hasActiveSchedule && isAnyOperationInProgress}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              hasActiveSchedule
                ? scheduleInfo?.lastError
                  ? 'border border-red-200 text-red-600 bg-red-50 hover:bg-red-100'
                  : 'border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                : isPro && !isAnyOperationInProgress
                  ? 'border border-stone-300 text-stone-700 bg-white hover:bg-stone-50'
                  : 'bg-stone-100 text-stone-400 border border-stone-200'
            }`}
            title={
              hasActiveSchedule
                ? scheduleInfo?.lastError
                  ? `Schedule error: ${scheduleInfo.lastError}`
                  : `${scheduleInfo?.label || ''} — click to manage`
                : isPro
                  ? 'Set up automatic scheduled runs'
                  : 'Pro subscription required'
            }
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {hasActiveSchedule ? (
                <>
                  Scheduled
                  {countdownText && <span className="font-normal text-blue-400">{countdownText}</span>}
                  {scheduleInfo?.lastError && <span className="font-normal text-red-400">error</span>}
                </>
              ) : (
                <>
                  Schedule
                  {!isPro && <span className="text-xs text-emerald-600 font-semibold ml-0.5">PRO</span>}
                </>
              )}
            </span>
          </button>

          {/* Dropdown — anchored to the button */}
          {scheduleDropdown}
        </div>
      </div>

      {/* Error Messages */}
      {displayError && (
        <p className="mt-2 text-sm text-red-400">{displayError}</p>
      )}

      {/* Payment Required Message */}
      {paymentRequired && (
        <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <p className="text-sm text-emerald-700">
            Payment required.{' '}
            <a href="/upgrade" className="text-emerald-600 hover:text-emerald-700 underline">
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
