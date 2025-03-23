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
        <h3 className="text-sm font-medium text-gray-500 mb-2">{title}</h3>
        <ul className="space-y-1">
          {plugins.map((plugin, index) => (
            <li
              key={`${plugin.type}-${index}`}
              className="flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md cursor-pointer"
              onClick={() => onConfigSelect({ ...config, activePlugin: plugin })}
            >
              <span>{plugin.name}</span>
              <span className="text-xs text-gray-500">{plugin.type}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-full flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Configurations</h2>
          <button
            onClick={onNewConfig}
            className="p-1 text-gray-400 hover:text-gray-500 rounded-full hover:bg-gray-100"
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

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Settings</span>
          <button
            onClick={() => onConfigSelect({ ...config, activePlugin: { type: 'settings', name: 'Settings' } })}
            className="text-sm text-indigo-600 hover:text-indigo-900"
          >
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}; 