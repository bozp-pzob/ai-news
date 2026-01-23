// frontend/src/components/ConfigInfoPanel.tsx

import React, { useState, useEffect } from 'react';
import { ConfigVisibility, UserLimits } from '../services/api';

export interface ConfigInfo {
  name: string;
  description: string;
  visibility: ConfigVisibility;
}

interface ConfigInfoPanelProps {
  open: boolean;
  onClose: () => void;
  onSave: (info: ConfigInfo) => void;
  initialValues?: Partial<ConfigInfo>;
  limits: UserLimits | null;
  isEditing?: boolean;
  isSaving?: boolean;
}

export function ConfigInfoPanel({
  open,
  onClose,
  onSave,
  initialValues,
  limits,
  isEditing = false,
  isSaving = false,
}: ConfigInfoPanelProps) {
  const [name, setName] = useState(initialValues?.name || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [visibility, setVisibility] = useState<ConfigVisibility>(initialValues?.visibility || 'public');
  const [validationError, setValidationError] = useState<string | null>(null);

  const canBePrivate = limits?.limits.canCreatePrivate;

  // Update form when initial values change
  useEffect(() => {
    if (initialValues) {
      setName(initialValues.name || '');
      setDescription(initialValues.description || '');
      setVisibility(initialValues.visibility || 'public');
    }
  }, [initialValues]);

  const handleSave = () => {
    // Validate
    if (!name.trim()) {
      setValidationError('Config name is required');
      return;
    }

    setValidationError(null);
    onSave({
      name: name.trim(),
      description: description.trim(),
      visibility,
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-stone-900 border-l border-stone-700 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-700">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Config Settings' : 'New Config'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-stone-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">
              Config Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Community Context"
              className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none"
            />
            <p className="text-stone-500 text-xs mt-1">
              This will be the display name for your config
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what context this config aggregates..."
              rows={3}
              className="w-full px-3 py-2 bg-stone-800 border border-stone-600 rounded-lg text-white placeholder-stone-500 focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-2">
              Visibility
            </label>
            <div className="space-y-2">
              {(['public', 'unlisted', 'private'] as ConfigVisibility[]).map((v) => (
                <label
                  key={v}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    visibility === v
                      ? 'border-amber-500 bg-amber-900/20'
                      : 'border-stone-600 hover:border-stone-500'
                  } ${v === 'private' && !canBePrivate ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => canBePrivate || v !== 'private' ? setVisibility(v) : null}
                    disabled={v === 'private' && !canBePrivate}
                    className="mt-0.5 accent-amber-500"
                  />
                  <div>
                    <div className="font-medium text-white capitalize text-sm">{v}</div>
                    <div className="text-stone-400 text-xs">
                      {v === 'public' && 'Anyone can discover and query this config'}
                      {v === 'unlisted' && 'Only people with the link can access'}
                      {v === 'private' && (canBePrivate ? 'Only you can access this config' : 'Upgrade to Pro for private configs')}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Storage info */}
          <div className="p-3 bg-stone-800 rounded-lg border border-stone-700">
            <p className="text-stone-400 text-sm">
              <span className="text-amber-400 font-medium">Storage:</span> Configure storage by adding a PostgresStorage plugin in the builder. Pro users can use platform-hosted storage.
            </p>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
              <p className="text-red-400 text-sm">{validationError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 disabled:text-stone-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              isEditing ? 'Save Settings' : 'Create Config'
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export default ConfigInfoPanel;
