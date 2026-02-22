/**
 * MediaDownloadConfig - Intuitive UI for configuring media download settings
 * 
 * Used in PluginParamDialog for Discord sources that support media downloading.
 * Provides user-friendly controls for all media download options.
 */

import React, { useState, useEffect } from 'react';

/**
 * Media download configuration object
 */
export interface MediaDownloadSettings {
  enabled: boolean;
  outputPath?: string;
  maxFileSize?: number;
  allowedTypes?: string[];
  excludedTypes?: string[];
  rateLimit?: number;
  retryAttempts?: number;
  organizeBy?: 'flat' | 'server' | 'channel';
}

interface MediaDownloadConfigProps {
  /** Current settings value */
  value?: MediaDownloadSettings;
  /** Callback when settings change */
  onChange: (settings: MediaDownloadSettings | undefined) => void;
  /** Whether in platform mode (affects output path visibility) */
  platformMode?: boolean;
}

/**
 * Predefined file size options (in bytes)
 */
const FILE_SIZE_OPTIONS = [
  { label: '10 MB', value: 10 * 1024 * 1024 },
  { label: '25 MB', value: 25 * 1024 * 1024 },
  { label: '50 MB (default)', value: 50 * 1024 * 1024 },
  { label: '100 MB', value: 100 * 1024 * 1024 },
  { label: '250 MB', value: 250 * 1024 * 1024 },
  { label: 'No limit', value: 0 },
];

/**
 * Media type categories with their MIME types
 */
const MEDIA_CATEGORIES = [
  { 
    id: 'images', 
    label: 'Images', 
    description: 'PNG, JPG, GIF, WebP',
    types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],
    iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
  { 
    id: 'videos', 
    label: 'Videos', 
    description: 'MP4, WebM, MOV',
    types: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
    iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
  },
  { 
    id: 'audio', 
    label: 'Audio', 
    description: 'MP3, WAV, OGG',
    types: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'],
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
  },
  { 
    id: 'documents', 
    label: 'Documents', 
    description: 'PDF, Word, Text',
    types: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
    iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
  },
  { 
    id: 'archives', 
    label: 'Archives', 
    description: 'ZIP, RAR, 7z',
    types: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'],
    iconPath: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4'
  },
];

/**
 * Organization options
 */
const ORGANIZE_OPTIONS = [
  { value: 'flat', label: 'All in one folder', description: 'All files saved to a single folder' },
  { value: 'server', label: 'By server', description: 'Separate folders for each Discord server' },
  { value: 'channel', label: 'By channel', description: 'Separate folders for each channel' },
];

/**
 * MediaDownloadConfig component
 */
export const MediaDownloadConfig: React.FC<MediaDownloadConfigProps> = ({
  value,
  onChange,
  platformMode = false,
}) => {
  // Local state for the settings
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [outputPath, setOutputPath] = useState(value?.outputPath ?? './media');
  const [maxFileSize, setMaxFileSize] = useState(value?.maxFileSize ?? 50 * 1024 * 1024);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => {
    // If no allowedTypes specified, all categories are enabled
    if (!value?.allowedTypes || value.allowedTypes.length === 0) {
      return MEDIA_CATEGORIES.map(c => c.id);
    }
    // Otherwise, find which categories match the allowed types
    return MEDIA_CATEGORIES.filter(cat => 
      cat.types.some(type => value.allowedTypes?.includes(type))
    ).map(c => c.id);
  });
  const [organizeBy, setOrganizeBy] = useState<'flat' | 'server' | 'channel'>(value?.organizeBy ?? 'channel');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rateLimit, setRateLimit] = useState(value?.rateLimit ?? 100);
  const [retryAttempts, setRetryAttempts] = useState(value?.retryAttempts ?? 3);

  // Update parent when settings change
  useEffect(() => {
    if (!enabled) {
      onChange(undefined);
      return;
    }

    // Build allowed types from selected categories
    const allowedTypes = MEDIA_CATEGORIES
      .filter(cat => selectedCategories.includes(cat.id))
      .flatMap(cat => cat.types);

    const settings: MediaDownloadSettings = {
      enabled: true,
      outputPath: platformMode ? undefined : outputPath,
      maxFileSize: maxFileSize === 0 ? undefined : maxFileSize,
      allowedTypes: selectedCategories.length === MEDIA_CATEGORIES.length ? undefined : allowedTypes,
      organizeBy,
      rateLimit,
      retryAttempts,
    };

    onChange(settings);
  }, [enabled, outputPath, maxFileSize, selectedCategories, organizeBy, rateLimit, retryAttempts, platformMode]);

  // Toggle a media category
  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev => 
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  // Select all categories
  const selectAllCategories = () => {
    setSelectedCategories(MEDIA_CATEGORIES.map(c => c.id));
  };

  // Deselect all categories
  const deselectAllCategories = () => {
    setSelectedCategories([]);
  };

  return (
    <div className="border border-stone-600 rounded-lg overflow-hidden">
      {/* Header with toggle */}
      <div 
        className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
          enabled ? 'bg-amber-500/10 border-b border-stone-600' : 'bg-stone-800 hover:bg-stone-750'
        }`}
        onClick={() => setEnabled(!enabled)}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-6 rounded-full transition-colors relative ${
            enabled ? 'bg-amber-500' : 'bg-stone-600'
          }`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-1'
            }`} />
          </div>
          <div>
            <div className="font-medium text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Media
            </div>
            <p className="text-xs text-gray-400">
              {enabled ? 'Media files will be downloaded from messages' : 'Click to enable media downloading'}
            </p>
          </div>
        </div>
        {enabled && (
          <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-1 rounded">
            Enabled
          </span>
        )}
      </div>

      {/* Settings panel - only show when enabled */}
      {enabled && (
        <div className="p-4 bg-stone-800/50 space-y-5">
          
          {/* Media Types */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                What to download
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllCategories}
                  className="text-xs text-amber-400 hover:text-amber-300"
                >
                  All
                </button>
                <span className="text-gray-600">|</span>
                <button
                  type="button"
                  onClick={deselectAllCategories}
                  className="text-xs text-gray-400 hover:text-gray-300"
                >
                  None
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MEDIA_CATEGORIES.map(category => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected 
                        ? 'border-amber-500 bg-amber-500/10 text-white' 
                        : 'border-stone-600 bg-stone-700/50 text-gray-400 hover:border-stone-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <svg className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={category.iconPath} />
                      </svg>
                      <span className="font-medium text-sm">{category.label}</span>
                      {isSelected && (
                        <svg className="w-4 h-4 text-amber-400 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{category.description}</p>
                  </button>
                );
              })}
            </div>
            {selectedCategories.length === 0 && (
              <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Select at least one media type to download
              </p>
            )}
          </div>

          {/* Max File Size */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Maximum file size
            </label>
            <select
              value={maxFileSize}
              onChange={(e) => setMaxFileSize(Number(e.target.value))}
              className="w-full py-2 px-3 rounded-md border-gray-600 bg-stone-700 text-gray-200 focus:border-amber-500 focus:ring-amber-500"
            >
              {FILE_SIZE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Files larger than this will be skipped
            </p>
          </div>

          {/* Organization */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Organize files
            </label>
            <div className="space-y-2">
              {ORGANIZE_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    organizeBy === option.value
                      ? 'border-amber-500 bg-amber-500/10'
                      : 'border-stone-600 bg-stone-700/50 hover:border-stone-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="organizeBy"
                    value={option.value}
                    checked={organizeBy === option.value}
                    onChange={(e) => setOrganizeBy(e.target.value as 'flat' | 'server' | 'channel')}
                    className="mt-0.5 h-4 w-4 border-gray-600 bg-stone-600 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <div className="font-medium text-white text-sm">{option.label}</div>
                    <p className="text-xs text-gray-500">{option.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Output Path - only show in non-platform mode */}
          {!platformMode && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Save location
              </label>
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="./media"
                className="w-full py-2 px-3 rounded-md border-gray-600 bg-stone-700 text-gray-200 focus:border-amber-500 focus:ring-amber-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Folder path where media files will be saved
              </p>
            </div>
          )}

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300"
          >
            <svg 
              className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Advanced settings
          </button>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="pl-4 border-l-2 border-stone-600 space-y-4">
              {/* Rate Limit */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Download speed
                </label>
                <select
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full py-2 px-3 rounded-md border-gray-600 bg-stone-700 text-gray-200 focus:border-amber-500 focus:ring-amber-500"
                >
                  <option value={50}>Fast (50ms delay)</option>
                  <option value={100}>Normal (100ms delay)</option>
                  <option value={250}>Slow (250ms delay)</option>
                  <option value={500}>Very slow (500ms delay)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Slower speeds are gentler on Discord's rate limits
                </p>
              </div>

              {/* Retry Attempts */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Retry failed downloads
                </label>
                <select
                  value={retryAttempts}
                  onChange={(e) => setRetryAttempts(Number(e.target.value))}
                  className="w-full py-2 px-3 rounded-md border-gray-600 bg-stone-700 text-gray-200 focus:border-amber-500 focus:ring-amber-500"
                >
                  <option value={0}>Don't retry</option>
                  <option value={1}>1 retry</option>
                  <option value={2}>2 retries</option>
                  <option value={3}>3 retries (default)</option>
                  <option value={5}>5 retries</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MediaDownloadConfig;
