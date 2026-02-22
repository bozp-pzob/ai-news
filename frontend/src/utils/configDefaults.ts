import { Config } from '../types';

/**
 * Default settings for a new config
 */
const DEFAULT_SETTINGS = {
  runOnce: false,
  onlyFetch: false,
};

/**
 * Creates an empty config with all required arrays initialized.
 * Use this whenever you need a blank config to avoid repeating the shape.
 */
export function createEmptyConfig(name: string = ''): Config {
  return {
    name,
    sources: [],
    ai: [],
    enrichers: [],
    generators: [],
    providers: [],
    storage: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Ensures a loaded/imported config has all required fields populated with defaults.
 * Fills in missing arrays and settings without overwriting existing values.
 */
export function sanitizeConfig(config: Partial<Config>, name?: string): Config {
  return {
    name: name || config.name || '',
    sources: config.sources || [],
    ai: config.ai || [],
    enrichers: config.enrichers || [],
    generators: config.generators || [],
    providers: config.providers || [],
    storage: config.storage || [],
    settings: config.settings || { ...DEFAULT_SETTINGS },
  };
}

/**
 * Creates a default platform config with pre-configured storage and AI plugins.
 */
export function createDefaultPlatformConfig(name: string = ''): Config {
  return {
    name,
    sources: [],
    ai: [{
      type: 'OpenAIProvider',
      name: 'OpenAIProvider',
      pluginName: 'OpenAIProvider',
      params: {
        usePlatformAI: true,
      }
    }],
    enrichers: [],
    generators: [],
    providers: [],
    storage: [{
      type: 'PostgresStorage',
      name: 'PostgresStorage',
      pluginName: 'PostgresStorage',
      params: {
        usePlatformStorage: true,
      }
    }],
    settings: {
      runOnce: false,
      onlyFetch: false,
    },
  };
}
