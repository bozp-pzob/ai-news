export interface PluginInfo {
  name: string;
  type: PluginType;
  description: string;
  configSchema: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'string[]';
      description: string;
      required?: boolean;
    };
  };
  constructorInterface?: {
    parameters: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'string[]';
      required: boolean;
      description: string;
    }>;
  };
}

export interface PluginConfig {
  type: PluginType;
  name: string;
  params: Record<string, any>;
  interval?: number;
  id?: string;
  isChild?: boolean;
  parentId?: string;
}

export interface Config {
  name?: string;
  sources: PluginConfig[];
  ai: PluginConfig[];
  enrichers: PluginConfig[];
  generators: PluginConfig[];
  providers: PluginConfig[];
  storage: PluginConfig[];
  settings: {
    runOnce: boolean;
    onlyFetch: boolean;
  };
  activePlugin?: PluginConfig | { type: 'settings'; name: 'Settings' };
}

export type PluginType = 'source' | 'sources' | 'ai' | 'enricher' | 'enrichers' | 'generator' | 'generators' | 'storage' | 'settings';

export interface AggregationStatus {
  status: 'running' | 'stopped';
} 