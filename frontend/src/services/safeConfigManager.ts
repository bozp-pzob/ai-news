import { configStateManager } from './ConfigStateManager';
import { ConfigStateEvent } from './ConfigStateManager';
import { Node, Connection } from '../types/nodeTypes';

/**
 * Helper module to safely access ConfigStateManager functionality
 * even if the singleton wasn't properly initialized
 */

export const getNodes = (): Node[] => {
  if (!configStateManager) {
    console.warn('ConfigStateManager not initialized, returning empty nodes array');
    return [];
  }
  return configStateManager.getNodes();
};

export const getConnections = (): Connection[] => {
  if (!configStateManager) {
    console.warn('ConfigStateManager not initialized, returning empty connections array');
    return [];
  }
  return configStateManager.getConnections();
};

export const getSelectedNode = (): string | null => {
  if (!configStateManager) {
    console.warn('ConfigStateManager not initialized, returning null for selected node');
    return null;
  }
  return configStateManager.getSelectedNode();
};

export const safeConfigManager = {
  getNodes,
  getConnections,
  getSelectedNode,
  
  // Pass-through methods with safety checks
  loadConfig: (config: any) => configStateManager?.loadConfig(config),
  forceSync: () => configStateManager?.forceSync(),
  updateConfig: (config: any) => configStateManager?.updateConfig(config),
  setNodes: (nodes: Node[]) => configStateManager?.setNodes(nodes),
  setConnections: (connections: Connection[]) => configStateManager?.setConnections(connections),
  setSelectedNode: (nodeId: string | null) => configStateManager?.setSelectedNode(nodeId),
  findNodeById: (id: string) => configStateManager?.findNodeById(id),
  subscribe: (event: ConfigStateEvent, callback: (data: any) => void) => {
    if (!configStateManager) {
      console.warn('ConfigStateManager not initialized, returning empty unsubscribe function');
      return () => {};
    }
    return configStateManager.subscribe(event, callback);
  },
  getConfig: () => {
    if (!configStateManager) {
      console.warn('ConfigStateManager not initialized, returning empty config');
      return { 
        name: 'default',
        sources: [], 
        enrichers: [], 
        generators: [], 
        ai: [],
        providers: [], 
        storage: [], 
        settings: { 
          runOnce: false,
          onlyFetch: false
        }
      };
    }
    return configStateManager.getConfig();
  },
  updatePlugin: (plugin: any) => {
    if (!configStateManager) {
      console.warn('ConfigStateManager not initialized, plugin update failed');
      return false;
    }
    return configStateManager.updatePlugin(plugin);
  },
  removeNode: (nodeId: string) => {
    if (!configStateManager) {
      console.warn('ConfigStateManager not initialized, node removal failed');
      return false;
    }
    return configStateManager.removeNode(nodeId);
  },
  saveToServer: () => {
    if (!configStateManager) {
      console.warn('ConfigStateManager not initialized, save to server failed');
      return Promise.resolve(false);
    }
    return configStateManager.saveToServer();
  },
};

export default safeConfigManager; 