import { Config } from '../Config';
import { Config as ConfigType, PluginConfig } from '../../types';

describe('Config', () => {
  let config: Config;

  beforeEach(() => {
    config = new Config();
  });

  describe('initialization', () => {
    it('should initialize with default empty config', () => {
      const defaultConfig = config.getData();
      expect(defaultConfig).toEqual({
        name: 'Default Config',
        sources: [],
        enrichers: [],
        generators: [],
        ai: [],
        storage: [],
        providers: [],
        settings: {
          runOnce: false,
          onlyFetch: false
        }
      });
    });
  });

  describe('loadConfig', () => {
    it('should load a valid configuration', () => {
      const testConfig: ConfigType = {
        name: 'Test Config',
        sources: [],
        enrichers: [],
        generators: [],
        ai: [],
        storage: [],
        providers: [],
        settings: {
          runOnce: true,
          onlyFetch: true
        }
      };

      config.loadConfig(testConfig);
      expect(config.getData()).toEqual(testConfig);
    });

    it('should handle missing arrays by initializing them as empty arrays', () => {
      const testConfig = {
        name: 'Test Config',
        settings: {
          runOnce: true,
          onlyFetch: true
        }
      } as ConfigType;

      config.loadConfig(testConfig);
      const loadedConfig = config.getData();
      
      expect(Array.isArray(loadedConfig.sources)).toBe(true);
      expect(Array.isArray(loadedConfig.enrichers)).toBe(true);
      expect(Array.isArray(loadedConfig.generators)).toBe(true);
      expect(Array.isArray(loadedConfig.ai)).toBe(true);
      expect(Array.isArray(loadedConfig.storage)).toBe(true);
      expect(Array.isArray(loadedConfig.providers)).toBe(true);
    });

    it('should handle null config gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      config.loadConfig(null as any);
      expect(consoleSpy).toHaveBeenCalledWith('Config.loadConfig received null or undefined config');
      consoleSpy.mockRestore();
    });
  });

  describe('updatePlugin', () => {
    it('should update a source plugin', () => {
      const sourcePlugin: PluginConfig = {
        id: 'source-0',
        name: 'Test Source',
        type: 'source',
        params: {
          url: 'http://test.com'
        }
      };

      // First load a config with the source
      const testConfig: ConfigType = {
        name: 'Test Config',
        sources: [sourcePlugin],
        enrichers: [],
        generators: [],
        ai: [],
        storage: [],
        providers: [],
        settings: {
          runOnce: false,
          onlyFetch: false
        }
      };
      config.loadConfig(testConfig);

      // Update the source plugin
      const updatedPlugin: PluginConfig = {
        id: 'source-0',
        name: 'Updated Source',
        type: 'source',
        params: {
          url: 'http://updated.com'
        }
      };

      const result = config.updatePlugin(updatedPlugin);
      expect(result).toBe(true);
      
      const updatedConfig = config.getData();
      expect(updatedConfig.sources[0].name).toBe('Updated Source');
      expect(updatedConfig.sources[0].params.url).toBe('http://updated.com');
    });

    it('should handle invalid plugin ID', () => {
      const invalidPlugin: PluginConfig = {
        id: '',
        name: 'Invalid Plugin',
        type: 'source',
        params: {}
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const result = config.updatePlugin(invalidPlugin);
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Plugin has no ID');
      consoleSpy.mockRestore();
    });

    it('should handle child plugins', () => {
      const parentPlugin: PluginConfig = {
        id: 'source-0',
        name: 'Parent Source',
        type: 'source',
        params: {
          children: []
        }
      };

      const childPlugin: PluginConfig = {
        id: 'source-0-child-0',
        parentId: 'source-0',
        name: 'Child Source',
        type: 'source',
        params: {
          url: 'http://child.com'
        },
        isChild: true
      };

      // Load config with parent
      const testConfig: ConfigType = {
        name: 'Test Config',
        sources: [parentPlugin],
        enrichers: [],
        generators: [],
        ai: [],
        storage: [],
        providers: [],
        settings: {
          runOnce: false,
          onlyFetch: false
        }
      };
      config.loadConfig(testConfig);

      // Update child plugin
      const result = config.updatePlugin(childPlugin);
      expect(result).toBe(true);

      const updatedConfig = config.getData();
      expect(updatedConfig.sources[0].params.children[0].url).toBe('http://child.com');
    });
  });

  describe('updateConfig', () => {
    it('should update the entire config', () => {
      const newConfig: ConfigType = {
        name: 'New Config',
        sources: [],
        enrichers: [],
        generators: [],
        ai: [],
        storage: [],
        providers: [],
        settings: {
          runOnce: true,
          onlyFetch: true
        }
      };

      config.updateConfig(newConfig);
      expect(config.getData()).toEqual(newConfig);
    });
  });
}); 