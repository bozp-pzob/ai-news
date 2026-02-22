export interface PluginInfo {
  name: string;
  pluginName: string;
  type: PluginType;
  description: string;
  /**
   * Platform type that this plugin requires a connection for (e.g., 'discord', 'telegram').
   * If set, the plugin will only be shown when the user has an active connection
   * for this platform. Only applies in platform mode.
   */
  requiresPlatform?: 'discord' | 'telegram' | 'slack';
  /**
   * If true, this plugin is hidden from the UI but still functional.
   * Used for deprecated plugins or plugins replaced by unified alternatives.
   */
  hidden?: boolean;
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
      /**
       * When true, this parameter will be treated as sensitive data and will
       * use the SecretInputSelectField component, allowing users to select
       * from predefined secrets or enter environment variable references.
       */
      secret?: boolean;
    }>;
  };
}

export interface PluginConfig {
  type: PluginType;
  name: string;
  pluginName?: string;
  params: Record<string, any>;
  interval?: number;
  id?: string;
  isChild?: boolean;
  parentId?: string;
  childIndex?: number;
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
    onlyGenerate?: boolean;
    historicalDate?: {
      enabled: boolean;
      mode?: "single" | "range";
      startDate?: string;
      endDate?: string;
    };
  };
  activePlugin?: PluginConfig | { type: 'settings'; name: 'Settings' };
  runOnce?: boolean;
}

export type PluginType = 'source' | 'sources' | 'ai' | 'enricher' | 'enrichers' | 'generator' | 'generators' | 'storage' | 'settings' | string;

export interface AggregationStatus {
  status: 'running' | 'stopped';
  currentSource?: string;
  currentPhase?: 'fetching' | 'enriching' | 'generating' | 'idle' | 'connecting' | 'waiting';
  lastUpdated?: number;
  errors?: Array<{
    message: string;
    source?: string;
    timestamp: number;
  }>;
  stats?: {
    totalItemsFetched?: number;
    itemsPerSource?: Record<string, number>;
    lastFetchTimes?: Record<string, number>;
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalAiCalls?: number;
    estimatedCostUsd?: number;
  };
}

/**
 * Represents an aggregation job with a unique ID
 */
export interface JobStatus {
  jobId: string;
  configName: string;
  startTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number; // 0-100
  error?: string;
  result?: any;
  aggregationStatus?: {
    currentSource?: string;
    currentPhase?: 'fetching' | 'enriching' | 'generating' | 'idle' | 'connecting' | 'waiting';
    mode?: 'standard' | 'historical';
    config?: any;
    filter?: any;
    errors?: Array<{
      message: string;
      source?: string;
      timestamp: number;
    }>;
    stats?: {
      totalItemsFetched?: number;
      itemsPerSource?: Record<string, number>;
      lastFetchTimes?: Record<string, number>;
      totalPromptTokens?: number;
      totalCompletionTokens?: number;
      totalAiCalls?: number;
      estimatedCostUsd?: number;
    };
  };
}

// WebSocket Message Types
export type WebSocketMessageType = 'status' | 'error' | 'configChanged' | 'jobStatus' | 'jobStarted';

export interface WebSocketMessage {
  type: WebSocketMessageType;
}

export interface WebSocketStatusMessage extends WebSocketMessage {
  type: 'status';
  status: AggregationStatus;
}

export interface WebSocketErrorMessage extends WebSocketMessage {
  type: 'error';
  error: string;
}

export interface WebSocketConfigChangedMessage extends WebSocketMessage {
  type: 'configChanged';
}

export interface WebSocketJobStatusMessage extends WebSocketMessage {
  type: 'jobStatus';
  jobStatus: JobStatus;
}

export interface WebSocketJobStartedMessage extends WebSocketMessage {
  type: 'jobStarted';
  jobId: string;
}

// WebSocket Action Types
export type WebSocketActionType = 'start' | 'run' | 'stop' | 'getStatus';

export interface WebSocketAction {
  action: WebSocketActionType;
}

export interface WebSocketStartAction extends WebSocketAction {
  action: 'start';
  config: Config;
}

export interface WebSocketRunAction extends WebSocketAction {
  action: 'run';
  config: Config;
}

export interface WebSocketStopAction extends WebSocketAction {
  action: 'stop';
}

export interface WebSocketGetStatusAction extends WebSocketAction {
  action: 'getStatus';
} 