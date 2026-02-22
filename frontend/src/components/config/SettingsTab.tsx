import React, { useState } from 'react';
import { PlatformConfig, ConfigVisibility } from '../../services/api';

interface SettingsTabProps {
  config: PlatformConfig;
  authToken: string;
  onUpdate: (updates: Partial<PlatformConfig>) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * Settings tab for editing config name, visibility, monetization, and deletion.
 */
export function SettingsTab({ config, authToken, onUpdate, onDelete }: SettingsTabProps) {
  const [name, setName] = useState(config.name);
  const [description, setDescription] = useState(config.description || '');
  const [visibility, setVisibility] = useState<ConfigVisibility>(config.visibility);
  const [hideItems, setHideItems] = useState(config.hideItems || false);
  const [monetizationEnabled, setMonetizationEnabled] = useState(config.monetizationEnabled);
  const [pricePerQuery, setPricePerQuery] = useState(config.pricePerQuery?.toString() || '0.001');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        name,
        description,
        visibility,
        hideItems,
        monetizationEnabled,
        pricePerQuery: parseFloat(pricePerQuery),
      } as any);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* General Settings */}
      <div className="bg-stone-800 rounded-lg p-6 border border-stone-700">
        <h3 className="font-medium text-white mb-4">General</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-300 mb-1">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as ConfigVisibility)}
              className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
            >
              <option value="private">Private - Only you can access</option>
              <option value="unlisted">Unlisted - Anyone with the link</option>
              <option value="public">Public - Discoverable by everyone</option>
            </select>
          </div>
        </div>
      </div>

      {/* Data Access */}
      <div className="bg-stone-800 rounded-lg p-6 border border-stone-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-white">Data Access</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-stone-300">Hide raw items from non-owners</p>
              <p className="text-xs text-stone-500 mt-0.5">
                When enabled, the Items tab and items API endpoint are not accessible to anyone
                except you. Content (generated reports) remains visible. Search is also blocked.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-4">
              <input
                type="checkbox"
                checked={hideItems}
                onChange={(e) => setHideItems(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-stone-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-stone-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white" />
            </label>
          </div>
        </div>
      </div>

      {/* Monetization */}
      <div className="bg-stone-800 rounded-lg p-6 border border-stone-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-white">Monetization</h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={monetizationEnabled}
              onChange={(e) => setMonetizationEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-stone-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-stone-400 after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white" />
          </label>
        </div>
        
        {monetizationEnabled && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-300 mb-1">
                Price per Query (USDC)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={pricePerQuery}
                  onChange={(e) => setPricePerQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
              <p className="text-stone-500 text-xs mt-1">
                Platform takes 10% fee. You receive ${(parseFloat(pricePerQuery || '0') * 0.9).toFixed(4)} per query.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
        
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="px-4 py-2 text-red-400 hover:text-red-300 transition-colors"
        >
          Delete Config
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-stone-800 rounded-lg p-6 max-w-md w-full mx-4 border border-stone-700">
            <h3 className="text-lg font-medium text-white mb-2">Delete Config</h3>
            <p className="text-stone-400 mb-6">
              Are you sure you want to delete "{config.name}"? This action cannot be undone and all data will be lost.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-stone-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-stone-700 text-white rounded-lg font-medium transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
