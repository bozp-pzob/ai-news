import { useState } from 'react';

export interface HistoricalDateSettings {
  enabled: boolean;
  mode?: 'single' | 'range';
  startDate?: string;
  endDate?: string;
}

export interface RunOptions {
  // Pipeline-step toggles
  onlyFetch: boolean;
  setOnlyFetch: (v: boolean) => void;
  onlyGenerate: boolean;
  setOnlyGenerate: (v: boolean) => void;

  // Run mode
  selectedRunMode: 'once' | 'continuous';
  setSelectedRunMode: (v: 'once' | 'continuous') => void;

  // UI toggles
  showRunOptions: boolean;
  setShowRunOptions: (v: boolean) => void;
  showRunOptionsDropdown: boolean;
  setShowRunOptionsDropdown: (v: boolean) => void;
  settingsButtonPosition: { top: number; right: number; bottom: number; left: number } | null;
  setSettingsButtonPosition: (v: { top: number; right: number; bottom: number; left: number } | null) => void;

  // Historical date options
  useHistoricalDates: boolean;
  setUseHistoricalDates: (v: boolean) => void;
  dateRangeMode: 'single' | 'range';
  setDateRangeMode: (v: 'single' | 'range') => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;

  /** Build the HistoricalDateSettings payload to merge into config.settings */
  getHistoricalDateSettings: () => HistoricalDateSettings;

  /** Select a pipeline mode (fetch-only / generate-only / full) and close the dropdown */
  selectPipelineMode: (mode: 'full' | 'fetchOnly' | 'generateOnly') => void;
}

/**
 * Extracts the 10 run-option state variables from NodeGraph into a reusable hook.
 */
export function useRunOptions(): RunOptions {
  const [onlyFetch, setOnlyFetch] = useState(false);
  const [onlyGenerate, setOnlyGenerate] = useState(false);
  const [selectedRunMode, setSelectedRunMode] = useState<'once' | 'continuous'>('once');
  const [showRunOptions, setShowRunOptions] = useState(false);
  const [showRunOptionsDropdown, setShowRunOptionsDropdown] = useState(false);
  const [settingsButtonPosition, setSettingsButtonPosition] = useState<{
    top: number; right: number; bottom: number; left: number;
  } | null>(null);
  const [useHistoricalDates, setUseHistoricalDates] = useState(false);
  const [dateRangeMode, setDateRangeMode] = useState<'single' | 'range'>('single');
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const getHistoricalDateSettings = (): HistoricalDateSettings => {
    if (!useHistoricalDates) return { enabled: false };
    return {
      enabled: true,
      mode: dateRangeMode,
      startDate,
      endDate: dateRangeMode === 'range' ? endDate : startDate,
    };
  };

  const selectPipelineMode = (mode: 'full' | 'fetchOnly' | 'generateOnly') => {
    switch (mode) {
      case 'full':
        setOnlyFetch(false);
        setOnlyGenerate(false);
        break;
      case 'fetchOnly':
        setOnlyFetch(true);
        setOnlyGenerate(false);
        break;
      case 'generateOnly':
        setOnlyFetch(false);
        setOnlyGenerate(true);
        break;
    }
    setShowRunOptions(false);
  };

  return {
    onlyFetch, setOnlyFetch,
    onlyGenerate, setOnlyGenerate,
    selectedRunMode, setSelectedRunMode,
    showRunOptions, setShowRunOptions,
    showRunOptionsDropdown, setShowRunOptionsDropdown,
    settingsButtonPosition, setSettingsButtonPosition,
    useHistoricalDates, setUseHistoricalDates,
    dateRangeMode, setDateRangeMode,
    startDate, setStartDate,
    endDate, setEndDate,
    getHistoricalDateSettings,
    selectPipelineMode,
  };
}
