import '@testing-library/jest-dom';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { configStateManager } from '../ConfigStateManager';
import { Config, PluginConfig, AggregationStatus } from '../../types';
import { Node, Connection } from '../../types/nodeTypes';
import { createEventEmitter } from '../../utils/eventEmitter';
import { saveConfig } from '../api';

// Enable mocks
jest.mock('../../utils/eventEmitter');
jest.mock('../api');

// Mock event emitter type
type MockEventEmitter = {
  on: jest.Mock;
  emit: jest.Mock;
};

describe('ConfigStateManager', () => {
  let manager: typeof configStateManager;
  let mockEmitter: MockEventEmitter;
  
  // Sample test data
  const mockConfig: Config = {
    name: 'test-config',
    sources: [
      {
        name: 'test-source',
        type: 'source',
        params: {
          url: 'http://test.com/feed',
          provider: 'openai',
          storage: 'mongodb'
        },
        interval: 60000
      }
    ],
    enrichers: [
      {
        name: 'test-enricher',
        type: 'enricher',
        params: {
          provider: 'openai',
          storage: 'mongodb'
        }
      }
    ],
    generators: [
      {
        name: 'test-generator',
        type: 'generator',
        params: {
          provider: 'openai',
          storage: 'mongodb'
        },
        interval: 300000
      }
    ],
    ai: [
      {
        name: 'openai',
        type: 'ai',
        params: {
          apiKey: 'test-key'
        }
      }
    ],
    storage: [
      {
        name: 'mongodb',
        type: 'storage',
        params: {
          uri: 'mongodb://localhost:27017'
        }
      }
    ],
    providers: [],
    settings: {
      runOnce: false,
      onlyFetch: false
    }
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock event emitter
    mockEmitter = {
      on: jest.fn().mockReturnThis() as jest.Mock<any, any>,
      emit: jest.fn().mockReturnThis() as jest.Mock<any, any>
    };
    (createEventEmitter as jest.Mock).mockReturnValue(mockEmitter);
    
    // Setup mock saveConfig with proper type
    (saveConfig as jest.Mock).mockImplementation((...args: unknown[]) => {
      const [name, config] = args as [string, Config];
      return Promise.resolve(true);
    });
    
    // Reset the singleton instance for each test
    manager = configStateManager;
    
    // Force the event emitter to be recreated
    manager.loadConfig(mockConfig);
  });

  describe('loadConfig', () => {
    it('should load a valid config and rebuild nodes and connections', () => {
      manager.loadConfig(mockConfig);
      
      const nodes = manager.getNodes();
      const connections = manager.getConnections();
      
      // Check if nodes were created
      expect(nodes.length).toBeGreaterThan(0);
      
      // Check if connections were created
      expect(connections.length).toBeGreaterThan(0);
      
      // Find source node in the nodes array or its children
      const findSourceNode = (nodes: Node[]): Node | undefined => {
        for (const node of nodes) {
          if (node.type === 'source') {
            return node;
          }
          if (node.isParent && node.children) {
            const found = findSourceNode(node.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const sourceNode = findSourceNode(nodes);
      expect(sourceNode).toBeDefined();
      expect(sourceNode?.name).toBe('test-source');
      expect(sourceNode?.params).toEqual(mockConfig.sources[0].params);
    });

    it('should handle null or undefined config', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      manager.loadConfig(null as any);
      
      expect(consoleSpy).toHaveBeenCalledWith('🔄 loadConfig received null or undefined config');
      consoleSpy.mockRestore();
    });
  });

  describe('updatePlugin', () => {
    it('should update a plugin\'s parameters', () => {
      // First load the config
      manager.loadConfig(mockConfig);
      
      // Create updated plugin config
      const updatedPlugin: PluginConfig = {
        id: 'source-0',
        name: 'updated-source',
        type: 'source',
        params: {
          url: 'http://updated.com/feed',
          provider: 'openai',
          storage: 'mongodb'
        },
        interval: 120000
      };
      
      const result = manager.updatePlugin(updatedPlugin);
      expect(result).toBe(true);
      
      // Find source node in the nodes array or its children
      const findSourceNode = (nodes: Node[]): Node | undefined => {
        for (const node of nodes) {
          if (node.id === 'source-0') {
            return node;
          }
          if (node.isParent && node.children) {
            const found = findSourceNode(node.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const nodes = manager.getNodes();
      const updatedNode = findSourceNode(nodes);
      
      expect(updatedNode?.name).toBe('updated-source');
      expect(updatedNode?.params).toEqual(updatedPlugin.params);
      expect(updatedNode?.interval).toBe(120000);
    });

    it('should handle invalid plugin updates', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = manager.updatePlugin({} as PluginConfig);
      
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('removeNode', () => {
    it('should remove a node and its connections', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // First load the config
      manager.loadConfig(mockConfig);
      
      const initialNodes = manager.getNodes();
      const initialConnections = manager.getConnections();
      
      // Remove a node
      const result = manager.removeNode('source-0');
      
      expect(result).toBe(true);
      
      // Verify node was removed
      const nodes = manager.getNodes();
      expect(nodes.length).toBeLessThan(initialNodes.length);
      
      // Verify connections were removed
      const connections = manager.getConnections();
      expect(connections.length).toBeLessThan(initialConnections.length);
      
      consoleSpy.mockRestore();
    });

    it('should handle removal of non-existent node', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = manager.removeNode('non-existent');
      
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('saveToServer', () => {
    it('should save config to server', async () => {
      // First load the config
      manager.loadConfig(mockConfig);
      
      const result = await manager.saveToServer();
      
      expect(result).toBe(true);
      expect(saveConfig).toHaveBeenCalledWith(mockConfig.name, expect.objectContaining({
        name: mockConfig.name,
        sources: mockConfig.sources,
        enrichers: mockConfig.enrichers,
        generators: mockConfig.generators,
        ai: mockConfig.ai,
        storage: mockConfig.storage,
        settings: mockConfig.settings
      }));
    });

    it('should handle save errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock saveConfig to reject
      (saveConfig as jest.Mock).mockImplementation(() => Promise.reject(new Error('Save failed')));
      
      const result = await manager.saveToServer();
      
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('updateNodeStatus', () => {
    it('should update node status based on aggregation status', () => {
      // First load the config
      manager.loadConfig(mockConfig);
      
      const status: AggregationStatus = {
        status: 'running',
        currentPhase: 'fetching',
        currentSource: 'test-source',
        stats: {
          itemsPerSource: {
            'test-source': 10
          }
        }
      };
      
      manager.updateNodeStatus(status);
      
      // Find source node in the nodes array or its children
      const findSourceNode = (nodes: Node[]): Node | undefined => {
        for (const node of nodes) {
          if (node.type === 'source') {
            return node;
          }
          if (node.isParent && node.children) {
            const found = findSourceNode(node.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const nodes = manager.getNodes();
      const sourceNode = findSourceNode(nodes);
      
      expect(sourceNode?.status).toBe('running');
      expect(sourceNode?.statusMessage).toBe('Fetching data...');
    });
  });

  describe('getConfig', () => {
    it('should return a deep copy of the config', () => {
      manager.loadConfig(mockConfig);
      
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      
      // Verify they are different objects
      expect(config1).not.toBe(config2);
      
      // Verify they have the same content
      expect(config1).toEqual(config2);
    });
  });

  describe('getNodes and getConnections', () => {
    it('should return current nodes and connections', () => {
      manager.loadConfig(mockConfig);
      
      const nodes = manager.getNodes();
      const connections = manager.getConnections();
      
      expect(Array.isArray(nodes)).toBe(true);
      expect(Array.isArray(connections)).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
    });
  });

  describe('setSelectedNode', () => {
    it('should update selected node and emit event', () => {
      // First load the config to ensure event emitter is initialized
      manager.loadConfig(mockConfig);
      
      // Force the event emitter to be recreated with our mock
      const eventEmitter = createEventEmitter();
      (manager as any).eventEmitter = eventEmitter;
      
      // Set the selected node
      manager.setSelectedNode('test-node');
      
      // Verify the event was emitted
      expect(eventEmitter.emit).toHaveBeenCalledWith('node-selected', 'test-node');
    });
  });
}); 