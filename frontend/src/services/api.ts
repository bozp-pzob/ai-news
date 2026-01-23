/**
 * Unified API Service
 * 
 * Handles all API calls for both local (self-hosted) and platform modes:
 * - Local mode: File-based config management, direct aggregation
 * - Platform mode: Database-backed configs, user management, auth
 */

import { Config, PluginInfo, AggregationStatus, JobStatus } from '../types';

// API base URL - defaults to same origin, can be overridden for local development
const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * Platform Types
 */
export type UserTier = 'free' | 'paid' | 'admin';
export type ConfigVisibility = 'public' | 'private' | 'shared' | 'unlisted';
export type ConfigStatus = 'idle' | 'running' | 'error' | 'paused';
export type StorageType = 'platform' | 'external';

export interface PlatformUser {
  id: string;
  privyId: string;
  email?: string;
  walletAddress?: string;
  tier: UserTier;
  stats: {
    configCount: number;
    totalRevenue: number;
    totalQueries: number;
  };
  createdAt: string;
}

export interface PlatformConfig {
  id: string;
  name: string;
  slug: string;
  description?: string;
  visibility: ConfigVisibility;
  storageType: StorageType;
  status: ConfigStatus;
  monetizationEnabled: boolean;
  pricePerQuery?: number;
  totalItems: number;
  totalQueries: number;
  totalRevenue?: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt?: string;
  externalDbValid?: boolean;
  externalDbError?: string;
  runsToday?: number;
  lastError?: string;
  configJson?: any;
}

export interface UserLimits {
  tier: UserTier;
  limits: {
    maxConfigs: number;
    maxRunsPerDay: number;
    canMonetize: boolean;
    canCreatePrivate: boolean;
    storageType: StorageType;
    dailyAiCalls?: number;  // Pro/admin tier only
    aiModel?: string;       // Model available for this tier
  };
  usage: {
    configCount: number;
    runsToday: number;
    aiCallsToday?: number;  // Pro/admin tier only
  };
  canCreateConfig: boolean;
  canRunAggregation: boolean;
  // AI usage (pro/admin tier only)
  aiCallsLimit?: number;
  aiResetAt?: string;
  canUsePlatformAI?: boolean;
}

export interface RevenueStats {
  totalVolume: number;
  totalRevenue: number;
  totalPlatformFees: number;
  totalTransactions: number;
  uniquePayers: number;
}

export interface SearchResult {
  id: number;
  type: string;
  source: string;
  title?: string;
  text?: string;
  link?: string;
  topics?: string[];
  date: string;
  similarity: number;
}

export interface ContextResponse {
  config: string;
  date: string;
  summary?: string;
  highlights: string[];
  stats: {
    totalItems: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
  };
  sources: Array<{
    type: string;
    source: string;
    itemCount: number;
  }>;
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface ConfigStats {
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  dateRange: { from: string; to: string } | null;
  lastUpdated: string | null;
  sources: Array<{
    source: string;
    count: number;
    latestDate: string;
  }>;
}

export interface ContentItem {
  id: number;
  config_id: string;
  cid?: string;
  type: string;
  source: string;
  title?: string;
  text?: string;
  link?: string;
  topics?: string[];
  date: number;
  metadata?: any;
  created_at: string;
}

export interface SummaryItem {
  id: number;
  config_id: string;
  type: string;
  title?: string;
  categories?: string;
  markdown?: string;
  date: number;
  created_at: string;
}

/**
 * API Error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Deep copy utility for config objects
 */
function deepCopy<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepCopy(item)) as T;
  }
  
  if (typeof obj === 'object') {
    const copy: any = {};
    for (const key in obj) {
      copy[key] = deepCopy((obj as any)[key]);
    }
    return copy;
  }
  
  return obj;
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  authToken?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `API error: ${response.statusText}`;
    let errorCode: string | undefined;

    try {
      const errorData = await response.json();
      if (errorData.error && errorData.message) {
        errorMessage = `${errorData.error}: ${errorData.message}`;
      } else {
        errorMessage = errorData.message || errorData.error || errorMessage;
      }
      errorCode = errorData.code;
    } catch {
      // Use default error message
    }

    throw new ApiError(errorMessage, response.status, errorCode);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * Plugin API - for loading available plugins
 */
export const pluginApi = {
  /**
   * Get all available plugins
   */
  async getAll(): Promise<{ [key: string]: PluginInfo[] }> {
    return apiRequest<{ [key: string]: PluginInfo[] }>('/plugins');
  },
};

/**
 * Local Config API - file-based config management for self-hosted mode
 */
export const localConfigApi = {
  /**
   * List all local config files
   */
  async list(): Promise<string[]> {
    return apiRequest<string[]>('/configs');
  },

  /**
   * Get a specific local config by name
   */
  async get(name: string): Promise<Config> {
    if (!name) {
      throw new Error('Config name is required');
    }

    const maxRetries = 2;
    let retryCount = 0;
    let lastError: any;

    while (retryCount <= maxRetries) {
      try {
        const data = await apiRequest<Config>(`/config/${encodeURIComponent(name)}`);
        
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid config data received');
        }
        
        data.name = name;
        return data;
      } catch (error) {
        lastError = error;
        
        if (retryCount === maxRetries) {
          break;
        }
        
        const waitTime = 1000 * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        retryCount++;
      }
    }

    throw lastError || new Error(`Failed to fetch config after ${maxRetries + 1} attempts`);
  },

  /**
   * Save a local config
   */
  async save(name: string, config: Config): Promise<void> {
    const cleanConfig = deepCopy(config);
    
    await apiRequest<void>(`/config/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(cleanConfig),
    });
  },

  /**
   * Delete a local config
   */
  async delete(name: string): Promise<void> {
    await apiRequest<void>(`/config/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Platform Config API - database-backed config management
 */
export const configApi = {
  /**
   * List public configs (for discovery)
   */
  async listPublic(options?: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ configs: PlatformConfig[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());

    const query = params.toString();
    return apiRequest<{ configs: PlatformConfig[]; total: number }>(
      `/api/v1/configs${query ? `?${query}` : ''}`
    );
  },

  /**
   * Get a config by ID or slug
   */
  async get(id: string, authToken?: string): Promise<PlatformConfig> {
    return apiRequest<PlatformConfig>(`/api/v1/configs/${id}`, {}, authToken);
  },

  /**
   * Create a new config
   */
  async create(
    authToken: string,
    data: {
      name: string;
      description?: string;
      visibility?: ConfigVisibility;
      storageType?: StorageType;
      externalDbUrl?: string;
      skipValidation?: boolean;
      configJson: any;
      secrets?: Record<string, string>;
    }
  ): Promise<PlatformConfig> {
    return apiRequest<PlatformConfig>(
      '/api/v1/configs',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      authToken
    );
  },

  /**
   * Update a config
   */
  async update(
    authToken: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      visibility?: ConfigVisibility;
      storageType?: StorageType;
      externalDbUrl?: string;
      skipValidation?: boolean;
      monetizationEnabled?: boolean;
      pricePerQuery?: number;
      ownerWallet?: string;
      configJson?: any;
      secrets?: Record<string, string>;
    }
  ): Promise<PlatformConfig> {
    return apiRequest<PlatformConfig>(
      `/api/v1/configs/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      authToken
    );
  },

  /**
   * Delete a config
   */
  async delete(authToken: string, id: string): Promise<void> {
    return apiRequest<void>(
      `/api/v1/configs/${id}`,
      { method: 'DELETE' },
      authToken
    );
  },

  /**
   * Get context for a config (for LLM consumption)
   */
  async getContext(id: string, date?: string, authToken?: string): Promise<ContextResponse> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const query = params.toString();

    return apiRequest<ContextResponse>(
      `/api/v1/configs/${id}/context${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get summary for a config
   */
  async getSummary(
    id: string,
    options?: { date?: string; type?: string },
    authToken?: string
  ): Promise<{ markdown?: string; categories?: any }> {
    const params = new URLSearchParams();
    if (options?.date) params.set('date', options.date);
    if (options?.type) params.set('type', options.type);
    const query = params.toString();

    return apiRequest<{ markdown?: string; categories?: any }>(
      `/api/v1/configs/${id}/summary${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get topics for a config
   */
  async getTopics(
    id: string,
    options?: { limit?: number; afterDate?: string; beforeDate?: string },
    authToken?: string
  ): Promise<{ topics: TopicCount[] }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.afterDate) params.set('afterDate', options.afterDate);
    if (options?.beforeDate) params.set('beforeDate', options.beforeDate);
    const query = params.toString();

    return apiRequest<{ topics: TopicCount[] }>(
      `/api/v1/configs/${id}/topics${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get stats for a config
   */
  async getStats(id: string, authToken?: string): Promise<ConfigStats> {
    return apiRequest<ConfigStats>(`/api/v1/configs/${id}/stats`, {}, authToken);
  },

  /**
   * Run aggregation for a platform config
   */
  async run(authToken: string, id: string): Promise<{ message: string; jobId: string; queuedAt: string; aiSkipped?: boolean }> {
    return apiRequest<{ message: string; jobId: string; queuedAt: string; aiSkipped?: boolean }>(
      `/api/v1/configs/${id}/run`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Validate external database connection
   */
  async validateDb(authToken: string, id: string): Promise<{
    valid: boolean;
    error?: string;
    hasVectorExtension?: boolean;
    hasTables?: boolean;
  }> {
    return apiRequest<{
      valid: boolean;
      error?: string;
      hasVectorExtension?: boolean;
      hasTables?: boolean;
    }>(
      `/api/v1/configs/${id}/validate-db`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Get content items for a config
   */
  async getItems(
    authToken: string,
    id: string,
    options?: { limit?: number; offset?: number; source?: string; type?: string }
  ): Promise<{
    items: ContentItem[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.source) params.set('source', options.source);
    if (options?.type) params.set('type', options.type);
    const query = params.toString();

    return apiRequest<{
      items: ContentItem[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(
      `/api/v1/configs/${id}/items${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get summaries for a config
   */
  async getSummaries(
    authToken: string,
    id: string,
    options?: { limit?: number; offset?: number; type?: string }
  ): Promise<{
    summaries: SummaryItem[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.type) params.set('type', options.type);
    const query = params.toString();

    return apiRequest<{
      summaries: SummaryItem[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(
      `/api/v1/configs/${id}/summaries${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get a specific summary by ID
   */
  async getSummaryById(
    authToken: string,
    configId: string,
    summaryId: string
  ): Promise<SummaryItem> {
    return apiRequest<SummaryItem>(
      `/api/v1/configs/${configId}/summaries/${summaryId}`,
      {},
      authToken
    );
  },
};

/**
 * Run API - unified interface for running aggregation
 */
export const runApi = {
  /**
   * Run aggregation for a local config (self-hosted mode)
   * Uses POST /aggregate endpoint
   */
  async runLocal(
    config: Config,
    secrets: Record<string, string> = {}
  ): Promise<{ jobId: string; message: string }> {
    return apiRequest<{ jobId: string; message: string }>('/aggregate', {
      method: 'POST',
      body: JSON.stringify({
        config: {
          ...config,
          settings: { ...config.settings, runOnce: true },
        },
        secrets,
      }),
    });
  },

  /**
   * Run aggregation for a platform config (requires auth)
   */
  async runPlatform(
    authToken: string,
    configId: string
  ): Promise<{ message: string; jobId: string; queuedAt: string; aiSkipped?: boolean }> {
    return configApi.run(authToken, configId);
  },

  /**
   * Stop aggregation for a config
   */
  async stop(configName: string): Promise<void> {
    return apiRequest<void>(`/aggregate/${encodeURIComponent(configName)}/stop`, {
      method: 'POST',
    });
  },

  /**
   * Get status of a specific job
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    return apiRequest<JobStatus>(`/job/${jobId}`);
  },

  /**
   * Get all jobs
   */
  async getAllJobs(): Promise<JobStatus[]> {
    return apiRequest<JobStatus[]>('/jobs');
  },

  /**
   * Get jobs for a specific config
   */
  async getJobsByConfig(configName: string): Promise<JobStatus[]> {
    return apiRequest<JobStatus[]>(`/jobs/${encodeURIComponent(configName)}`);
  },

  /**
   * Stop a specific job
   */
  async stopJob(jobId: string): Promise<void> {
    return apiRequest<void>(`/job/${jobId}/stop`, { method: 'POST' });
  },

  /**
   * Get aggregation status for a config (REST fallback)
   */
  async getStatus(configName: string): Promise<AggregationStatus> {
    return apiRequest<AggregationStatus>(`/status/${encodeURIComponent(configName)}`);
  },
};

/**
 * User API - platform user management
 */
export const userApi = {
  /**
   * Get current user profile
   */
  async getMe(authToken: string): Promise<PlatformUser> {
    return apiRequest<PlatformUser>('/api/v1/me', {}, authToken);
  },

  /**
   * Update current user profile
   */
  async updateMe(
    authToken: string,
    updates: { walletAddress?: string; settings?: Record<string, any> }
  ): Promise<PlatformUser> {
    return apiRequest<PlatformUser>(
      '/api/v1/me',
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      },
      authToken
    );
  },

  /**
   * Get user's configs
   */
  async getMyConfigs(authToken: string): Promise<{ configs: PlatformConfig[]; total: number }> {
    return apiRequest<{ configs: PlatformConfig[]; total: number }>(
      '/api/v1/me/configs',
      {},
      authToken
    );
  },

  /**
   * Get user's revenue stats
   */
  async getMyRevenue(authToken: string): Promise<RevenueStats> {
    return apiRequest<RevenueStats>('/api/v1/me/revenue', {}, authToken);
  },

  /**
   * Get user's tier limits and usage
   */
  async getMyLimits(authToken: string): Promise<UserLimits> {
    return apiRequest<UserLimits>('/api/v1/me/limits', {}, authToken);
  },
};

/**
 * License Types
 */
export interface LicenseStatus {
  isActive: boolean;
  tier: 'free' | 'paid' | 'admin';
  expiresAt?: string;
  walletAddress?: string;
  sku?: string;
  message?: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  days: number;
  pricePerDay: string;
}

export interface PlansResponse {
  plans: Plan[];
  sku: string;
  network: string;
  platformWallet: string; // Solana wallet address to receive payments
  mockMode?: boolean; // If true, use mock purchase endpoint instead of pop402 flow
}

export interface Challenge {
  id: string;
  message: string;
  expiresAt: number;
  expiresIn: number;
}

export interface PurchaseParams {
  planId: string;
  walletAddress: string;
  x402Payload: {
    x402Version: number;
    scheme: string;
    network: string;
    payload: {
      transaction: string;  // Base64 encoded signed Solana transaction
    };
  };
  paymentMeta: {
    sku: string;
    payerPubkey: string;
    signature: string;      // Message signature (from signing challenge message)
    challengeId: string;
    expirationDate: number; // Unix timestamp for license expiration
  };
}

export interface PurchaseResult {
  success: boolean;
  license?: {
    expiresAt: string;
    txSignature?: string;
  };
  error?: string;
}

/**
 * License API - Pro subscription management
 */
export const licenseApi = {
  /**
   * Get current user's license status
   */
  async getStatus(authToken: string): Promise<LicenseStatus> {
    return apiRequest<LicenseStatus>('/api/v1/me/license', {}, authToken);
  },

  /**
   * Get available subscription plans
   */
  async getPlans(): Promise<PlansResponse> {
    return apiRequest<PlansResponse>('/api/v1/me/plans');
  },

  /**
   * Get a challenge for license purchase authentication
   */
  async getChallenge(authToken: string, walletAddress: string, ttl?: number): Promise<{ challenge: Challenge }> {
    return apiRequest<{ challenge: Challenge }>(
      '/api/v1/me/license/challenge',
      {
        method: 'POST',
        body: JSON.stringify({ walletAddress, ttl }),
      },
      authToken
    );
  },

  /**
   * Process a license purchase via pop402 payment flow
   * Sends payment via X-PAYMENT and X-PAYMENT-META headers
   */
  async purchase(authToken: string, params: PurchaseParams): Promise<PurchaseResult> {
    const { planId, walletAddress, x402Payload, paymentMeta } = params;
    
    // Encode payment headers as base64
    const xPaymentHeader = btoa(JSON.stringify(x402Payload));
    const xPaymentMetaHeader = btoa(JSON.stringify(paymentMeta));
    
    const response = await fetch(`${API_BASE}/api/v1/me/license/purchase/${planId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-PAYMENT': xPaymentHeader,
        'X-PAYMENT-META': xPaymentMetaHeader,
      },
      body: JSON.stringify({ walletAddress }),
    });

    if (!response.ok) {
      // Check if it's a 402 Payment Required response
      if (response.status === 402) {
        const paymentInfo = await response.json();
        console.log('[licenseApi] Payment required:', paymentInfo);
        throw new Error('Payment required - transaction may not have been signed correctly');
      }
      
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }

    return response.json();
  },

  /**
   * Mock purchase for testing (only works when backend has POP402_MOCK_MODE=true)
   * This bypasses the pop402 payment flow and grants the license directly
   */
  async purchaseMock(authToken: string, planId: string, walletAddress: string): Promise<PurchaseResult> {
    return apiRequest<PurchaseResult>(
      '/api/v1/me/license/purchase-mock',
      {
        method: 'POST',
        body: JSON.stringify({ planId, walletAddress }),
      },
      authToken
    );
  },
};

/**
 * Search API - semantic search functionality
 */
export const searchApi = {
  /**
   * Semantic search across a config
   */
  async search(
    configId: string,
    query: string,
    options?: {
      limit?: number;
      threshold?: number;
      type?: string;
      source?: string;
      afterDate?: string;
      beforeDate?: string;
    },
    authToken?: string
  ): Promise<{
    query: string;
    configId: string;
    results: SearchResult[];
    totalFound: number;
    searchTimeMs: number;
  }> {
    return apiRequest<{
      query: string;
      configId: string;
      results: SearchResult[];
      totalFound: number;
      searchTimeMs: number;
    }>(
      '/api/v1/search',
      {
        method: 'POST',
        body: JSON.stringify({
          configId,
          query,
          ...options,
        }),
      },
      authToken
    );
  },

  /**
   * Search across multiple configs
   */
  async searchMulti(
    configIds: string[],
    query: string,
    options?: {
      limit?: number;
      threshold?: number;
    },
    authToken?: string
  ): Promise<{
    query: string;
    results: Array<{
      configId: string;
      results: SearchResult[];
      totalFound: number;
      searchTimeMs: number;
    }>;
    totalResults: number;
    searchTimeMs: number;
  }> {
    return apiRequest<{
      query: string;
      results: Array<{
        configId: string;
        results: SearchResult[];
        totalFound: number;
        searchTimeMs: number;
      }>;
      totalResults: number;
      searchTimeMs: number;
    }>(
      '/api/v1/search/multi',
      {
        method: 'POST',
        body: JSON.stringify({
          configIds,
          query,
          ...options,
        }),
      },
      authToken
    );
  },
};

/**
 * Health check
 */
export async function checkHealth(): Promise<{
  status: string;
  version: string;
  timestamp: string;
}> {
  return apiRequest<{ status: string; version: string; timestamp: string }>(
    '/api/v1/health'
  );
}

/**
 * Legacy exports for backward compatibility
 * These map to the new API structure
 */
export const getPlugins = pluginApi.getAll;
export const getConfigs = localConfigApi.list;
export const getConfig = localConfigApi.get;
export const saveConfig = localConfigApi.save;
export const deleteConfig = localConfigApi.delete;
export const getJobStatus = runApi.getJobStatus;
export const stopAggregation = runApi.stop;
export const getAggregationStatus = runApi.getStatus;

/**
 * Start continuous aggregation - fixed to use correct endpoint
 */
export const startAggregation = async (
  configName: string,
  config: Config,
  secrets: Record<string, string> = {}
): Promise<string> => {
  const response = await apiRequest<{ jobId: string; message: string }>('/aggregate', {
    method: 'POST',
    body: JSON.stringify({
      config: {
        ...config,
        settings: { ...config.settings, runOnce: false },
      },
      secrets,
    }),
  });
  return response.jobId;
};

/**
 * Run aggregation once - fixed to use correct endpoint
 */
export const runAggregation = async (
  configName: string,
  config: Config,
  secrets: Record<string, string> = {}
): Promise<string> => {
  const result = await runApi.runLocal(config, secrets);
  return result.jobId;
};

export default {
  plugin: pluginApi,
  localConfig: localConfigApi,
  config: configApi,
  run: runApi,
  user: userApi,
  license: licenseApi,
  search: searchApi,
  checkHealth,
};
