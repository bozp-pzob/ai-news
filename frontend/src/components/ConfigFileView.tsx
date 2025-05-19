import React from 'react';
import { Config } from '../types';

interface ConfigFileViewProps {
  config: Config;
  onConfigSelect: (config: Config) => void;
  onNewConfig: () => void;
}

export const ConfigFileView: React.FC<ConfigFileViewProps> = ({
  config,
  onConfigSelect,
  onNewConfig,
}) => {
  const renderPluginList = (plugins: any[], title: string) => {
    if (plugins.length === 0) return null;

    return (
      <div className="mb-4">
        <h3 className="text-sm font-medium text-amber-400/80 mb-2">{title}</h3>
        <ul className="space-y-1">
          {plugins.map((plugin, index) => (
            <li
              key={`${plugin.type}-${index}`}
              className="flex items-center justify-between px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 rounded-md cursor-pointer border border-gray-800 hover:border-amber-500/50"
              onClick={() => onConfigSelect({ ...config, activePlugin: plugin })}
            >
              <span>{plugin.name}</span>
              <span className="text-xs text-amber-500/70">{plugin.type}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-800 h-full flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-amber-300">Configurations</h2>
          <button
            onClick={onNewConfig}
            className="p-1 text-amber-400 hover:text-amber-300 rounded-full hover:bg-gray-800"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {renderPluginList(config.sources, 'Sources')}
        {renderPluginList(config.ai, 'AI')}
        {renderPluginList(config.enrichers, 'Enrichers')}
        {renderPluginList(config.generators, 'Generators')}
        {renderPluginList(config.storage, 'Storage')}
      </div>

      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Settings</span>
          <button
            onClick={() => onConfigSelect({ ...config, activePlugin: { type: 'settings', name: 'Settings' } })}
            className="text-sm text-amber-500 hover:text-amber-300"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}; 