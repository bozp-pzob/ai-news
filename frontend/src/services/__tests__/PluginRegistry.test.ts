import '@testing-library/jest-dom';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { pluginRegistry } from '../PluginRegistry';
import * as api from '../api';
import { PluginInfo } from '../../types';

// Enable mocks
const mockGetPlugins = jest.fn<Promise<Record<string, PluginInfo[]>>, []>();
jest.mock('../api', () => ({
  getPlugins: () => mockGetPlugins()
}));

describe('PluginRegistry', () => {
  let registry: typeof pluginRegistry;
  
  // Sample test data
  const mockPlugins: { [key: string]: PluginInfo[] } = {
    sources: [
      {
        name: 'RSS Source',
        pluginName: 'rss',
        type: 'source',
        description: 'Fetches data from RSS feeds',
        configSchema: {
          url: {
            type: 'string',
            description: 'URL of the RSS feed',
            required: true
          }
        }
      }
    ],
    enrichers: [
      {
        name: 'OpenAI Enricher',
        pluginName: 'openai',
        type: 'enricher',
        description: 'Enriches data using OpenAI',
        configSchema: {
          model: {
            type: 'string',
            description: 'OpenAI model to use',
            required: true
          }
        }
      }
    ]
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Reset the singleton instance for each test
    registry = pluginRegistry;
    registry.reset();
    
    // Setup mock getPlugins
    mockGetPlugins.mockResolvedValue(mockPlugins as any);
  });

  describe('loadPlugins', () => {
    it('should load plugins from the API', async () => {
      await registry.loadPlugins();
      
      expect(mockGetPlugins).toHaveBeenCalled();
      expect(registry.getPlugins()).toEqual(mockPlugins);
      expect(registry.isPluginsLoaded()).toBe(true);
    });

    it('should not load plugins if already loaded', async () => {
      // First load
      await registry.loadPlugins();
      
      // Reset mock to verify it's not called again
      mockGetPlugins.mockClear();
      
      // Try to load again
      await registry.loadPlugins();
      
      expect(mockGetPlugins).not.toHaveBeenCalled();
    });

    it('should not load plugins if already loading', async () => {
      // Start loading
      const loadPromise = registry.loadPlugins();
      
      // Try to load again while first load is in progress
      await registry.loadPlugins();
      
      // Wait for first load to complete
      await loadPromise;
      
      // Verify getPlugins was only called once
      expect(mockGetPlugins).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Mock API error
      mockGetPlugins.mockRejectedValueOnce(new Error('API Error'));
      
      await registry.loadPlugins();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '🔌 PluginRegistry: Error fetching plugins:',
        expect.any(Error)
      );
      expect(registry.isPluginsLoaded()).toBe(false);
      
      consoleSpy.mockRestore();
    });
  });

  describe('getPlugins', () => {
    it('should return all plugins', async () => {
      await registry.loadPlugins();
      
      const plugins = registry.getPlugins();
      
      expect(plugins).toEqual(mockPlugins);
      expect(plugins.sources).toHaveLength(1);
      expect(plugins.enrichers).toHaveLength(1);
    });
  });

  describe('findPlugin', () => {
    beforeEach(async () => {
      await registry.loadPlugins();
    });

    it('should find a plugin by name', () => {
      const plugin = registry.findPlugin('rss');
      
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('RSS Source');
      expect(plugin?.type).toBe('source');
    });

    it('should find a plugin by name and type', () => {
      const plugin = registry.findPlugin('openai', 'enricher');
      
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('OpenAI Enricher');
      expect(plugin?.type).toBe('enricher');
    });

    it('should not find a plugin with mismatched type', () => {
      const plugin = registry.findPlugin('openai', 'source');
      
      expect(plugin).toBeNull();
    });

    it('should not find a non-existent plugin', () => {
      const plugin = registry.findPlugin('non-existent');
      
      expect(plugin).toBeNull();
    });

    it('should be case-insensitive when searching by name', () => {
      const plugin = registry.findPlugin('RSS');
      
      expect(plugin).toBeDefined();
      expect(plugin?.name).toBe('RSS Source');
    });
  });

  describe('isPluginsLoaded', () => {
    it('should return false before plugins are loaded', () => {
      expect(registry.isPluginsLoaded()).toBe(false);
    });

    it('should return true after plugins are loaded', async () => {
      await registry.loadPlugins();
      
      expect(registry.isPluginsLoaded()).toBe(true);
    });
  });

  describe('subscribe', () => {
    it('should call listener when plugins are loaded', async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);
      
      await registry.loadPlugins();
      
      expect(listener).toHaveBeenCalled();
      
      // Cleanup
      unsubscribe();
    });

    it('should not call listener after unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);
      
      // Unsubscribe before loading
      unsubscribe();
      
      await registry.loadPlugins();
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const errorListener = () => {
        throw new Error('Listener error');
      };
      
      registry.subscribe(errorListener);
      
      await registry.loadPlugins();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        '🔌 PluginRegistry: Error notifying listener:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });
}); 