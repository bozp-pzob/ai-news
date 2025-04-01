import React, { useState } from 'react';
import { PluginInfo } from '../types';
import { PluginParamDialog } from './PluginParamDialog';

interface PluginSelectorProps {
  plugin: PluginInfo;
  onAdd: (plugin: PluginInfo, config: Record<string, any>, interval?: number) => void;
}

export const PluginSelector: React.FC<PluginSelectorProps> = ({ plugin, onAdd }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleAdd = (params: Record<string, any>, interval?: number) => {
    onAdd(plugin, params, interval);
  };

  return (
    <>
      <div className="bg-gray-900 rounded-lg shadow border border-gray-800">
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="w-full px-4 py-3 flex justify-between items-center hover:bg-gray-800 rounded-lg"
        >
          <div className="text-left">
            <h4 className="text-lg font-medium text-amber-300">{plugin.name}</h4>
            <p className="text-sm text-gray-400">{plugin.description}</p>
          </div>
          <span className="text-amber-500">▶</span>
        </button>
      </div>

      <PluginParamDialog
        plugin={plugin}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onAdd={handleAdd}
      />
    </>
  );
}; 