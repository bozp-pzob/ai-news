import React, { useEffect, useState } from 'react';
import { PluginInfo } from '../types';
import { pluginRegistry } from '../services/PluginRegistry';

interface PluginPaletteProps {
  onDragPlugin: (plugin: PluginInfo, clientX: number, clientY: number) => void;
}

export const PluginPalette: React.FC<PluginPaletteProps> = ({ onDragPlugin }) => {
  // This component displays available plugins in categories
  // Plugins without constructorInterface.parameters are filtered out
  const [plugins, setPlugins] = useState<Record<string, PluginInfo[]>>({});
  const [isLoading, setIsLoading] = useState(!pluginRegistry.isPluginsLoaded());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    sources: true,
    ai: true,
    enrichers: true,
    generators: true,
    storage: true
  });
  const [searchTerm, setSearchTerm] = useState('');

  // Load plugins from registry
  useEffect(() => {
    if (pluginRegistry.isPluginsLoaded()) {
      setPlugins(pluginRegistry.getPlugins());
      setIsLoading(false);
    } else {
      // Subscribe to plugin registry updates
      const unsubscribe = pluginRegistry.subscribe(() => {
        setPlugins(pluginRegistry.getPlugins());
        setIsLoading(false);
      });

      // Trigger plugin loading if needed
      pluginRegistry.loadPlugins();

      return () => {
        unsubscribe();
      };
    }
  }, []);

  // Log plugins on load for debugging
  useEffect(() => {
    if (!isLoading) {
      console.log("Loaded plugins:", plugins);
      
      // Log how many plugins were filtered out due to missing constructor parameters
      let total = 0;
      let filtered = 0;
      
      Object.values(plugins).forEach(pluginList => {
        total += pluginList.length;
        filtered += pluginList.filter(p => !p.constructorInterface || 
                                        !p.constructorInterface.parameters || 
                                        p.constructorInterface.parameters.length === 0).length;
      });
      
      if (filtered > 0) {
        console.log(`Filtered out ${filtered} of ${total} plugins that had no constructor parameters`);
      }
    }
  }, [isLoading, plugins]);

  // Handler for starting drag
  const handleDragStart = (plugin: PluginInfo, e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/json', JSON.stringify(plugin));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Set a drag image with yellow amber styling
    const dragImg = document.createElement('div');
    // dragImg.className = 'bg-amber-500 max-w-64 text-gray-900 rounded-md px-3 py-2 text-sm shadow-lg';
    // dragImg.textContent = plugin.name;
    dragImg.textContent = "_";
    document.body.appendChild(dragImg);
    e.dataTransfer.setDragImage(dragImg, 0, 0);
    
    // Pass the plugin and position to parent
    onDragPlugin(plugin, e.clientX, e.clientY);
    
    // Clean up drag image after a short delay
    setTimeout(() => {
      document.body.removeChild(dragImg);
    }, 100);
  };

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpanded(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Filter plugins based on search term
  const filterPlugins = (plugin: PluginInfo) => {
    // First check if the plugin has constructorInterface.parameters
    if (!plugin.constructorInterface || !plugin.constructorInterface.parameters || 
        plugin.constructorInterface.parameters.length === 0) {
      return false;
    }
    
    // Then apply search term filter if there is one
    if (!searchTerm) return true;
    return plugin.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
           plugin.description.toLowerCase().includes(searchTerm.toLowerCase());
  };

  // Render a single plugin item with a modern card design
  const renderPluginItem = (plugin: PluginInfo) => (
    <div
      key={`${plugin.type}-${plugin.name}`}
      draggable
      onDragStart={(e) => handleDragStart(plugin, e)}
      className="group relative bg-stone-700 p-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 mb-3 cursor-move border border-gray-800 hover:border-amber-400"
      title={plugin.description}
    >
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-300 group-hover:text-amber-200 transition-colors truncate">{plugin.name}</div>
          <div className="text-xs text-gray-400 mt-1 line-clamp-2">{plugin.description}</div>
        </div>
      </div>
      <div className="absolute inset-0 border-2 border-transparent group-hover:border-amber-400 rounded-xl pointer-events-none transition-colors duration-200 opacity-0 group-hover:opacity-30"></div>
    </div>
  );

  // Category info with names only
  const categories = [
    {
      id: 'sources',
      name: 'Data Sources'
    },
    {
      id: 'ai',
      name: 'AI & ML Models'
    },
    {
      id: 'enrichers',
      name: 'Data Processors'
    },
    {
      id: 'generators',
      name: 'Content Creators'
    },
    {
      id: 'storage',
      name: 'Data Storage'
    }
  ];

  return (
    <div className="bg-stone-950 w-80 h-full overflow-hidden flex flex-col border-r border-amber-200">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-xl font-bold text-gray-300">
          Modules
        </h2>
        <div className="mt-3 relative">
          <input
            type="text"
            placeholder="Search modules..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 bg-stone-900 rounded-lg border border-amber-100/50 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm placeholder-gray-500 text-gray-200"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col justify-center items-center h-64">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-400"></div>
            <span className="mt-4 text-gray-400">Loading modules...</span>
          </div>
        ) : (
          <div className="p-4">
            {Object.entries(plugins).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <p>No modules available</p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(plugins).map(([categoryKey, categoryPlugins]) => {
                  // Find the matching category from our display categories
                  const category = categories.find(c => c.id === categoryKey) || {
                    id: categoryKey,
                    name: categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1)
                  };
                  
                  const filteredPlugins = categoryPlugins.filter(filterPlugins);
                  
                  // Hide categories with no matching plugins when searching
                  if (searchTerm && filteredPlugins.length === 0) return null;
                  
                  return (
                    <div key={category.id} className="bg-stone-900 rounded-xl shadow-sm overflow-hidden">
                      <div 
                        className={`flex justify-between items-center px-4 py-3 cursor-pointer transition ${
                          expanded[category.id] 
                            ? 'bg-amber-800/20 text-gray-300' 
                            : 'hover:bg-stone-800 text-gray-300'
                        }`}
                        onClick={() => toggleCategory(category.id)}
                      >
                        <div className="flex items-center space-x-3 min-w-0 flex-1 pr-2">
                          <h3 className="font-medium truncate">{category.name}</h3>
                          {filteredPlugins.length > 0 && 
                            <span className="flex-shrink-0 text-xs px-2 py-0.5 text-gray-900 bg-amber-500 rounded-full">
                              {filteredPlugins.length}
                            </span>
                          }
                        </div>
                        <span className="text-xs font-medium">
                          {expanded[category.id] ? '▼' : '▶'}
                        </span>
                      </div>
                      
                      {expanded[category.id] && filteredPlugins.length > 0 && (
                        <div className="p-3 pb-0 border-t border-stone-800">
                          {filteredPlugins.map(renderPluginItem)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="flex-shrink-0 p-3 text-xs text-center text-grey-400/70 border-t border-gray-800">
        Drag modules onto the canvas to create your workflow
      </div>
    </div>
  );
}; 