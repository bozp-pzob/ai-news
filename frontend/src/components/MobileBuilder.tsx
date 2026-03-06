// frontend/src/components/MobileBuilder.tsx
//
// Card-based mobile pipeline editor. Replaces the canvas node-graph builder
// on screens < md. Reuses PluginParamDialog for plugin configuration.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { PluginInfo, PluginConfig } from '../types';
import { pluginRegistry } from '../services/PluginRegistry';
import { PluginParamDialog } from './PluginParamDialog';
import { ConnectPlatformDialog } from './ConnectPlatformDialog';
import { useConnections } from '../hooks/useExternalConnections';
import { PlatformType } from '../services/api';
import { deepCopy } from '../utils/deepCopy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MobileBuilderProps {
  configJson: any;
  onSave: (configJson: any) => Promise<boolean>;
  isSaving: boolean;
  configName: string;
  isPlatformPro?: boolean;
}

/** Pipeline section definition */
interface SectionDef {
  key: string;            // config JSON key (sources, ai, enrichers, generators, storage)
  title: string;          // display title
  registryKey: string;    // key used in PluginRegistry (source, ai, enricher, generator, storage)
  color: string;          // tailwind text color for the category dot
  bgColor: string;        // tailwind bg color for the category dot
}

const SECTIONS: SectionDef[] = [
  { key: 'sources',    title: 'Data Sources',     registryKey: 'source',    color: 'text-blue-600',    bgColor: 'bg-blue-500'    },
  { key: 'ai',         title: 'AI Providers',     registryKey: 'ai',        color: 'text-purple-600',  bgColor: 'bg-purple-500'  },
  { key: 'enrichers',  title: 'Data Processors',  registryKey: 'enricher',  color: 'text-amber-600',   bgColor: 'bg-amber-500'   },
  { key: 'generators', title: 'Content Creators', registryKey: 'generator', color: 'text-emerald-600', bgColor: 'bg-emerald-500' },
  { key: 'storage',    title: 'Data Storage',     registryKey: 'storage',   color: 'text-stone-600',   bgColor: 'bg-stone-500'   },
];

/** Category display names (same mapping as Sidebar.tsx) */
const CATEGORY_TITLES: Record<string, string> = {
  sources: 'Data Sources', source: 'Data Sources',
  ai: 'AI & ML Models',
  enrichers: 'Data Processors', enricher: 'Data Processors',
  generators: 'Content Creators', generator: 'Content Creators',
  storage: 'Data Storage',
};

// ---------------------------------------------------------------------------
// PluginPickerSheet — bottom sheet for choosing a plugin type to add
// ---------------------------------------------------------------------------

interface PluginPickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  sectionDef: SectionDef;
  onSelect: (plugin: PluginInfo) => void;
  connectedPlatforms?: Set<PlatformType>;
  onConnectPlatform: (platform: PlatformType) => void;
}

function PluginPickerSheet({
  isOpen,
  onClose,
  sectionDef,
  onSelect,
  connectedPlatforms,
  onConnectPlatform,
}: PluginPickerSheetProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  useEffect(() => {
    if (!isOpen) return;

    const allPlugins = pluginRegistry.getPluginsFiltered({
      platformMode: true,
      connectedPlatforms,
    });

    // Collect plugins matching this section's registry key (try both singular and plural)
    const matched: PluginInfo[] = [];
    for (const [cat, list] of Object.entries(allPlugins)) {
      const catTitle = CATEGORY_TITLES[cat] || cat;
      if (catTitle === sectionDef.title) {
        matched.push(...list.filter(p =>
          p.constructorInterface && p.constructorInterface.parameters.length > 0
        ));
      }
    }
    setPlugins(matched);
  }, [isOpen, sectionDef, connectedPlatforms]);

  // Discover unconnected platforms that have source plugins
  const unconnectedPlatforms = useMemo(() => {
    if (sectionDef.key !== 'sources') return [];
    const allPlugins = pluginRegistry.getPlugins();
    const platforms: PlatformType[] = [];
    for (const list of Object.values(allPlugins)) {
      for (const p of list) {
        if (p.requiresPlatform && !p.hidden && !platforms.includes(p.requiresPlatform)) {
          if (!connectedPlatforms || !connectedPlatforms.has(p.requiresPlatform)) {
            platforms.push(p.requiresPlatform);
          }
        }
      }
    }
    return platforms;
  }, [sectionDef, connectedPlatforms]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-h-[70vh] bg-white rounded-t-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-stone-100">
          <h3 className="text-lg font-semibold text-stone-800">Add {sectionDef.title.replace(/s$/, '')}</h3>
          <p className="text-sm text-stone-500 mt-0.5">Choose a plugin to add to your pipeline</p>
        </div>

        {/* Plugin list */}
        <div className="overflow-y-auto max-h-[55vh] pb-safe-area-bottom">
          {plugins.length === 0 && unconnectedPlatforms.length === 0 && (
            <div className="px-4 py-8 text-center text-stone-400 text-sm">
              No plugins available for this section
            </div>
          )}

          {/* Connect platform prompts */}
          {unconnectedPlatforms.map(platform => (
            <button
              key={platform}
              onClick={() => { onClose(); onConnectPlatform(platform); }}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-stone-100 hover:bg-stone-50 active:bg-stone-100 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div className="text-left">
                <span className="text-sm font-medium text-indigo-600 capitalize">Connect {platform}</span>
                <p className="text-xs text-stone-400">Connect to unlock {platform} sources</p>
              </div>
            </button>
          ))}

          {/* Available plugins */}
          {plugins.map(plugin => (
            <button
              key={plugin.pluginName}
              onClick={() => onSelect(plugin)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-stone-100 hover:bg-stone-50 active:bg-stone-100 transition-colors"
            >
              <div className={`w-8 h-8 rounded-lg ${sectionDef.bgColor} bg-opacity-15 flex items-center justify-center flex-shrink-0`}>
                <div className={`w-2.5 h-2.5 rounded-full ${sectionDef.bgColor}`} />
              </div>
              <div className="text-left min-w-0">
                <span className="text-sm font-medium text-stone-800 block truncate">{plugin.name}</span>
                {plugin.description && (
                  <p className="text-xs text-stone-400 truncate">{plugin.description}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineSection — collapsible section card
// ---------------------------------------------------------------------------

interface PipelineSectionProps {
  sectionDef: SectionDef;
  plugins: any[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

function PipelineSection({
  sectionDef,
  plugins,
  expanded,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: PipelineSectionProps) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50 active:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${sectionDef.bgColor}`} />
          <span className="font-medium text-stone-800 text-sm">{sectionDef.title}</span>
          {plugins.length > 0 && (
            <span className="text-xs text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
              {plugins.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Add button */}
          <div
            onClick={e => { e.stopPropagation(); onAdd(); }}
            className="w-7 h-7 rounded-lg bg-stone-100 hover:bg-stone-200 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          {/* Chevron */}
          <svg
            className={`w-4 h-4 text-stone-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Plugin list */}
      {expanded && (
        <div className="border-t border-stone-100">
          {plugins.length === 0 ? (
            <div className="px-4 py-4 text-center">
              <p className="text-xs text-stone-400">No plugins yet</p>
              <button
                onClick={onAdd}
                className={`text-xs font-medium mt-1 ${sectionDef.color} hover:underline`}
              >
                Tap + to add
              </button>
            </div>
          ) : (
            plugins.map((plugin, i) => (
              <div key={`${plugin.type || plugin.pluginName}-${i}`}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-50 last:border-0">
                  {/* Plugin info — tap to edit */}
                  <button
                    onClick={() => onEdit(i)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className={`w-1.5 h-6 rounded-full ${sectionDef.bgColor} opacity-40 flex-shrink-0`} />
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-stone-700 block truncate">
                        {plugin.name || plugin.pluginName || plugin.type}
                      </span>
                      <span className="text-xs text-stone-400 block truncate">
                        {plugin.pluginName || plugin.type}
                      </span>
                    </div>
                  </button>

                  {/* Delete */}
                  {confirmDelete === i ? (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => { onDelete(i); setConfirmDelete(null); }}
                        className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 text-xs text-stone-500 hover:text-stone-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(i)}
                      className="p-1.5 text-stone-300 hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileBuilder — main component
// ---------------------------------------------------------------------------

export function MobileBuilder({
  configJson,
  onSave,
  isSaving,
  configName,
  isPlatformPro = false,
}: MobileBuilderProps) {
  // Local mutable config state
  const [config, setConfig] = useState<any>(() => deepCopy(configJson));
  const [hasChanges, setHasChanges] = useState(false);

  // Section expand/collapse
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SECTIONS.map(s => [s.key, true]))
  );

  // Plugin picker sheet
  const [pickerSection, setPickerSection] = useState<SectionDef | null>(null);

  // Plugin param dialog
  const [editingPlugin, setEditingPlugin] = useState<{
    section: string;
    index: number;
    plugin: any;
    isNew: boolean;
  } | null>(null);

  // Platform connection dialog
  const [connectPlatform, setConnectPlatform] = useState<PlatformType | null>(null);

  // Fetch connections for filtering platform-specific plugins
  const { connections, refetch: refetchConnections } = useConnections();

  const connectedPlatforms = useMemo(() => {
    if (!connections || connections.length === 0) return undefined;
    const platforms = new Set<PlatformType>();
    for (const conn of connections) {
      if (conn.isActive) platforms.add(conn.platform);
    }
    return platforms.size > 0 ? platforms : undefined;
  }, [connections]);

  // Load plugins on mount
  useEffect(() => {
    if (!pluginRegistry.isPluginsLoaded()) {
      pluginRegistry.loadPlugins();
    }
  }, []);

  // Sync when configJson prop changes externally
  useEffect(() => {
    setConfig(deepCopy(configJson));
    setHasChanges(false);
  }, [configJson]);

  // ---- Handlers ----

  const toggleSection = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAddClick = (sectionDef: SectionDef) => {
    setPickerSection(sectionDef);
  };

  const handlePluginPicked = (sectionDef: SectionDef, pluginInfo: PluginInfo) => {
    // Create skeleton plugin config
    const newPlugin: any = {
      type: pluginInfo.pluginName,
      name: pluginInfo.pluginName,
      pluginName: pluginInfo.pluginName,
      params: {},
    };

    // Close picker, open param dialog for the new plugin
    setPickerSection(null);
    setEditingPlugin({
      section: sectionDef.key,
      index: -1, // -1 = new
      plugin: newPlugin,
      isNew: true,
    });
  };

  const handleEditPlugin = (sectionKey: string, index: number) => {
    const plugins = config[sectionKey] || [];
    const plugin = deepCopy(plugins[index]);
    setEditingPlugin({
      section: sectionKey,
      index,
      plugin,
      isNew: false,
    });
  };

  const handleDeletePlugin = (sectionKey: string, index: number) => {
    setConfig((prev: any) => {
      const updated = deepCopy(prev);
      const arr = updated[sectionKey] || [];
      arr.splice(index, 1);
      updated[sectionKey] = arr;
      return updated;
    });
    setHasChanges(true);
  };

  const handlePluginDialogSave = (updatedPlugin: any) => {
    if (!editingPlugin) return;

    setConfig((prev: any) => {
      const updated = deepCopy(prev);
      const arr = updated[editingPlugin.section] || [];

      if (editingPlugin.isNew) {
        // Append new plugin
        arr.push(updatedPlugin);
      } else {
        // Update existing
        arr[editingPlugin.index] = updatedPlugin;
      }

      updated[editingPlugin.section] = arr;
      return updated;
    });

    setHasChanges(true);
    setEditingPlugin(null);
  };

  const handlePluginDialogClose = () => {
    setEditingPlugin(null);
  };

  const handleSave = async () => {
    const success = await onSave(config);
    if (success) {
      setHasChanges(false);
    }
  };

  const handleConnectionSuccess = () => {
    setConnectPlatform(null);
    refetchConnections();
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
        {/* Pipeline flow */}
        <div className="space-y-3">
          {SECTIONS.map((section, i) => (
            <React.Fragment key={section.key}>
              {/* Section card */}
              <PipelineSection
                sectionDef={section}
                plugins={config[section.key] || []}
                expanded={expanded[section.key] ?? true}
                onToggle={() => toggleSection(section.key)}
                onAdd={() => handleAddClick(section)}
                onEdit={(idx) => handleEditPlugin(section.key, idx)}
                onDelete={(idx) => handleDeletePlugin(section.key, idx)}
              />

              {/* Flow arrow between sections */}
              {i < SECTIONS.length - 1 && (
                <div className="flex justify-center">
                  <svg className="w-4 h-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-stone-200 px-4 py-3 safe-area-bottom">
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
            hasChanges && !isSaving
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 active:scale-[0.98]'
              : 'bg-stone-100 text-stone-400 cursor-not-allowed'
          }`}
        >
          {isSaving ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </span>
          ) : hasChanges ? (
            'Save Config'
          ) : (
            'No changes'
          )}
        </button>
      </div>

      {/* Plugin picker bottom sheet */}
      <PluginPickerSheet
        isOpen={!!pickerSection}
        onClose={() => setPickerSection(null)}
        sectionDef={pickerSection || SECTIONS[0]}
        onSelect={(plugin) => pickerSection && handlePluginPicked(pickerSection, plugin)}
        connectedPlatforms={connectedPlatforms}
        onConnectPlatform={(platform) => {
          setPickerSection(null);
          setConnectPlatform(platform);
        }}
      />

      {/* Plugin param dialog (reuse existing) */}
      {editingPlugin && (
        <PluginParamDialog
          plugin={editingPlugin.plugin}
          isOpen={true}
          onClose={handlePluginDialogClose}
          onAdd={handlePluginDialogSave}
          platformMode={true}
          isPlatformPro={isPlatformPro}
        />
      )}

      {/* Connect platform dialog */}
      <ConnectPlatformDialog
        isOpen={!!connectPlatform}
        onClose={() => setConnectPlatform(null)}
        platform={connectPlatform || undefined}
        onConnected={handleConnectionSuccess}
      />
    </div>
  );
}

export default MobileBuilder;
