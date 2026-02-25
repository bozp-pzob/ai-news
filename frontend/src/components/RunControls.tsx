import React from 'react';
import ReactDOM from 'react-dom';
import type { RunOptions } from '../hooks/useRunOptions';

export interface RunControlsProps {
  isAggregationRunning: boolean;
  onRunOnce: () => void;
  onToggleAggregation: () => void;
  runOptions: RunOptions;
  platformMode?: boolean;
}

/**
 * Run/Stop controls panel extracted from NodeGraph.
 * Renders the run button, stop button, settings dropdown, and historical date picker.
 */
export const RunControls: React.FC<RunControlsProps> = React.memo(({
  isAggregationRunning,
  onRunOnce,
  onToggleAggregation,
  runOptions,
  platformMode = false,
}) => {
  const {
    onlyFetch, onlyGenerate,
    selectedRunMode, setSelectedRunMode,
    showRunOptions, setShowRunOptions,
    settingsButtonPosition, setSettingsButtonPosition,
    useHistoricalDates, setUseHistoricalDates,
    dateRangeMode, setDateRangeMode,
    startDate, setStartDate,
    endDate, setEndDate,
    selectPipelineMode,
  } = runOptions;

  const handleRunClick = () => {
    if (useHistoricalDates || selectedRunMode === 'once') {
      onRunOnce();
    } else {
      onToggleAggregation();
    }
  };

  return (
    <div className="flex items-center space-x-1.5">
      <div className="relative">
        {isAggregationRunning ? (
          <button
            onClick={onToggleAggregation}
            className="h-10 px-4 rounded-md bg-white border border-red-300 text-stone-800 hover:bg-stone-50 hover:border-red-500 focus:outline-none flex items-center justify-center transition-colors duration-200 shadow-md"
            title="Stop aggregation"
          >
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <rect x="6" y="6" width="8" height="8" rx="1" />
              </svg>
              <span className="font-medium">Stop</span>
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {/* Run control panel with toggle switch */}
            <div className="flex items-center bg-white border-stone-200 rounded-md shadow-md overflow-hidden border">
              {/* Run button */}
              <button
                onClick={handleRunClick}
                className={`
                  h-10 px-4 focus:outline-none flex items-center justify-center transition-colors duration-200
                  ${useHistoricalDates 
                    ? "bg-white text-purple-600 hover:bg-stone-50 border-l border-purple-200" 
                    : selectedRunMode === "once" 
                      ? "bg-white text-emerald-600 hover:bg-stone-50" 
                      : "bg-white text-green-600 hover:bg-stone-50"}
                `}
                title={
                  useHistoricalDates 
                    ? `Run with historical data: ${dateRangeMode === "single" 
                        ? `Single date ${startDate}` 
                        : `Date range ${startDate} to ${endDate}`}` 
                    : (selectedRunMode === "once" ? "Run once and stop when complete" : "Run continuously until stopped")
                }
              >
                <span className="text-sm font-medium flex items-center">
                  {useHistoricalDates && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                  {selectedRunMode === "continuous" && !useHistoricalDates && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  Run
                </span>
              </button>
              {/* Settings button - temporarily hidden */}
              <div className="flex items-center hidden">
                <button
                  id="settings-button"
                  onClick={() => {
                    if (!showRunOptions) {
                      const buttonElement = document.getElementById('settings-button');
                      if (buttonElement) {
                        const rect = buttonElement.getBoundingClientRect();
                        setSettingsButtonPosition({
                          top: rect.top,
                          right: rect.right,
                          bottom: rect.bottom,
                          left: rect.left,
                        });
                      }
                    }
                    setShowRunOptions(!showRunOptions);
                  }}
                    className={`h-10 px-3 flex items-center justify-center transition-all duration-200 ${
                    showRunOptions 
                      ? 'text-emerald-600 bg-stone-100 shadow-inner' 
                      : 'text-stone-500 hover:text-emerald-600 hover:bg-stone-50'
                  }`}
                  title={
                    useHistoricalDates
                      ? `Historical data enabled: ${dateRangeMode === "single" 
                          ? `Single date ${startDate}` 
                          : `Date range ${startDate} to ${endDate}`}`
                      : "Process mode settings"
                  }
                  aria-expanded={showRunOptions}
                  aria-controls="process-mode-dropdown"
                >
                  <div className="relative">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <circle cx="10" cy="4" r="1.75" />
                      <circle cx="10" cy="10" r="1.75" />
                      <circle cx="10" cy="16" r="1.75" />
                    </svg>
                    {(showRunOptions || useHistoricalDates) && (
                      <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${
                        useHistoricalDates ? "bg-purple-500" : "bg-emerald-500"
                      }`}></span>
                    )}
                  </div>
                </button>
                
                {/* Collapsible Process Mode Panel */}
                {showRunOptions && ReactDOM.createPortal(
                  <div 
                    id="process-mode-dropdown"
                    className="fixed bg-white border border-stone-200 rounded-md shadow-xl z-[9999] transition-all duration-300 ease-in-out overflow-visible"
                    style={{
                      width: '220px',
                      top: settingsButtonPosition?.bottom ? `${settingsButtonPosition.bottom + 4}px` : 'auto',
                      left: settingsButtonPosition?.left ? `${settingsButtonPosition.left - 175}px` : 'auto',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(16, 185, 129, 0.1)',
                    }}
                  >
                    <div className="p-3">
                      <div className="flex flex-col">
                        <h3 className="text-xs text-stone-600 mb-2 font-medium">Run Mode</h3>
                        <div className="flex items-center mb-3 justify-between">
                          <div className="flex items-center gap-2 mr-2">
                            <button
                              onClick={() => {
                                if (!useHistoricalDates) {
                                  setSelectedRunMode("once");
                                }
                              }}
                              className={`text-xs px-3 py-1 rounded ${
                                selectedRunMode === "once"
                                  ? "bg-emerald-50 text-emerald-600 font-medium"
                                  : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                              }`}
                              disabled={useHistoricalDates && selectedRunMode === "once"}
                            >
                              <span className="flex items-center">
                                <span className={`w-2 h-2 rounded-full mr-1.5 ${selectedRunMode === "once" ? "bg-emerald-500" : "bg-stone-300"}`}></span>
                                Run Once
                              </span>
                            </button>
                            
                            <button
                              onClick={() => {
                                if (!useHistoricalDates) {
                                  setSelectedRunMode("continuous");
                                }
                              }}
                              className={`text-xs px-3 py-1 rounded ${
                                selectedRunMode === "continuous"
                                  ? "bg-green-50 text-green-600 font-medium"
                                  : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                              } ${useHistoricalDates ? "opacity-50 cursor-not-allowed" : ""}`}
                              disabled={useHistoricalDates}
                              title={useHistoricalDates ? "Historical data mode only works with 'Run Once'" : "Run continuously until stopped"}
                            >
                              <span className="flex items-center">
                                <span className={`w-2 h-2 rounded-full mr-1.5 ${selectedRunMode === "continuous" ? "bg-green-500" : "bg-stone-300"}`}></span>
                                Stream
                              </span>
                            </button>
                          </div>
                        </div>
                        
                        <div className="h-px bg-stone-200 mb-3 w-full"></div>
                        
                        <h3 className="text-xs text-stone-600 mb-2 font-medium">Process Mode</h3>
                        <div className="flex flex-col space-y-1.5">
                          <button
                            onClick={() => selectPipelineMode('full')}
                            className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                              !onlyFetch && !onlyGenerate
                                ? 'bg-emerald-50 text-emerald-600 font-medium'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                            title="Run complete pipeline with fetch and generate phases"
                          >
                            <span className={`w-3 h-3 rounded-full mr-2 ${!onlyFetch && !onlyGenerate ? 'bg-emerald-500' : 'bg-stone-300'}`}></span>
                            Complete Pipeline
                          </button>
                          <button
                            onClick={() => selectPipelineMode('fetchOnly')}
                            className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                              onlyFetch
                                ? 'bg-blue-50 text-blue-600 font-medium'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                            title="Only fetch data from sources - skip generation phase"
                          >
                            <span className={`w-3 h-3 rounded-full mr-2 ${onlyFetch ? 'bg-blue-500' : 'bg-stone-300'}`}></span>
                            Fetch Data Only
                          </button>
                          <button
                            onClick={() => selectPipelineMode('generateOnly')}
                            className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                              onlyGenerate
                                ? 'bg-purple-50 text-purple-600 font-medium'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                            }`}
                            title="Only generate content from existing data - skip fetch phase"
                          >
                            <span className={`w-3 h-3 rounded-full mr-2 ${onlyGenerate ? 'bg-purple-500' : 'bg-stone-300'}`}></span>
                            Generate Content Only
                          </button>
                        </div>
                        
                        {/* Historical date range selector */}
                        <div className="mt-3 border-t border-stone-200 pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs text-stone-600 font-medium">Historical Data</h3>
                            <button 
                              onClick={() => {
                                const newHistoricalState = !useHistoricalDates;
                                setUseHistoricalDates(newHistoricalState);
                                if (newHistoricalState) {
                                  setSelectedRunMode("once");
                                }
                              }}
                              className="relative inline-flex items-center h-4 rounded-full w-8 transition-colors focus:outline-none"
                              aria-pressed={useHistoricalDates}
                            >
                              <span 
                                className={`
                                  inline-block w-8 h-4 rounded-full transition-colors duration-200 ease-in-out
                                  ${useHistoricalDates ? "bg-purple-400" : "bg-stone-300"}
                                `}
                              />
                              <span 
                                className={`
                                  absolute inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out
                                  ${useHistoricalDates ? "translate-x-4" : "translate-x-1"}
                                `}
                              />
                            </button>
                          </div>
                          
                          {useHistoricalDates && (
                            <div className="mt-2 space-y-2">
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex space-x-3">
                                  <button
                                    onClick={() => setDateRangeMode("single")}
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      dateRangeMode === "single" 
                                        ? "bg-purple-50 text-purple-600 font-medium" 
                                        : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                                    }`}
                                  >
                                    Single Date
                                  </button>
                                  <button
                                    onClick={() => setDateRangeMode("range")}
                                    className={`text-xs px-2 py-0.5 rounded ${
                                      dateRangeMode === "range" 
                                        ? "bg-purple-50 text-purple-600 font-medium" 
                                        : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                                    }`}
                                  >
                                    Date Range
                                  </button>
                                </div>
                              </div>
                              
                              <div className="flex flex-col space-y-2">
                                <div className="flex items-center">
                                  <label className="text-xs text-stone-400 w-16">{dateRangeMode === "single" ? "Date:" : "Start:"}</label>
                                  <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="bg-white text-stone-700 text-xs p-1 rounded w-full border border-stone-300 focus:border-purple-500 focus:outline-none"
                                  />
                                </div>
                                
                                {dateRangeMode === "range" && (
                                  <div className="flex items-center">
                                    <label className="text-xs text-stone-400 w-16">End:</label>
                                    <input
                                      type="date"
                                      value={endDate}
                                      onChange={(e) => setEndDate(e.target.value)}
                                      className="bg-white text-stone-700 text-xs p-1 rounded w-full border border-stone-300 focus:border-purple-500 focus:outline-none"
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

RunControls.displayName = 'RunControls';
