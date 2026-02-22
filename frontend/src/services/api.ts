/**
 * Unified API Service
 * 
 * Handles all API calls for both local (self-hosted) and platform modes:
 * - Local mode: File-based config management, direct aggregation
 * - Platform mode: Database-backed configs, user management, auth
 */

import { Config, PluginInfo, AggregationStatus, JobStatus } from '../types';
import { deepCopy } from '../utils/deepCopy';

// API base URL - defaults to same origin, can be overridden for local development
export const API_BASE = process.env.REACT_APP_API_URL || '';

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
  globalInterval?: number;
  activeJobId?: string;
  isLocalExecution?: boolean;
  /** Whether the current user is the owner (or admin) of this config */
  isOwner?: boolean;
  /** Access type: 'owner' | 'admin' | 'public' | 'shared' | 'unlisted' */
  accessType?: string;
  /** Whether raw items are hidden from non-owners */
  hideItems?: boolean;
  /** Data access level: 'full' (owner) | 'open' (public, non-monetized) | 'payment_required' (monetized) */
  dataAccess?: 'full' | 'open' | 'payment_required';
  /** If user has an active access grant, when it expires */
  accessGrantExpiresAt?: string;
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

// ========================================================================
// Access Grant Types
// ========================================================================

export interface AccessStatus {
  hasAccess: boolean;
  reason?: 'owner' | 'open' | 'grant';
  expiresAt?: string;
  remainingHours?: number;
  pricePerQuery?: number;
  currency?: string;
  network?: string;
  durationHours?: number;
}

export interface AccessPurchasePaymentDetails {
  amount: number;
  currency: string;
  network: string;
  recipient: string;
  platformWallet: string;
  platformFee: number;
  facilitatorUrl: string;
  memo: string;
  expiresAt: string;
  sku: string;
  durationHours: number;
  description: string;
}

export interface AccessPurchaseResult {
  success: boolean;
  access: {
    expiresAt: string;
    durationHours: number;
    reason?: string;
    remainingHours?: number;
  };
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
 * Error thrown when access is already granted (existing grant or non-monetized)
 */
export class AccessAlreadyGrantedError extends Error {
  constructor(public access: { expiresAt?: string; remainingHours?: number; reason?: string }) {
    super('Access already granted');
    this.name = 'AccessAlreadyGrantedError';
  }
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
   * List public configs (for discovery) with ranking/sorting
   */
  async listPublic(options?: {
    search?: string;
    limit?: number;
    offset?: number;
    sort?: 'trending' | 'popular' | 'newest' | 'revenue';
  }): Promise<{ configs: PlatformConfig[]; total: number; sort: string }> {
    const params = new URLSearchParams();
    if (options?.search) params.set('search', options.search);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.sort) params.set('sort', options.sort);

    const query = params.toString();
    return apiRequest<{ configs: PlatformConfig[]; total: number; sort: string }>(
      `/api/v1/configs${query ? `?${query}` : ''}`
    );
  },

  /**
   * List featured configs (admin-curated)
   */
  async listFeatured(limit?: number): Promise<{ configs: PlatformConfig[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit.toString());

    const query = params.toString();
    return apiRequest<{ configs: PlatformConfig[]; total: number }>(
      `/api/v1/configs/featured${query ? `?${query}` : ''}`
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
      isLocalExecution?: boolean;
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
    authToken: string | null | undefined,
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
      authToken || undefined
    );
  },

  /**
   * Get content (generated summaries/reports) for a config
   */
  async getContent(
    authToken: string | null | undefined,
    id: string,
    options?: { limit?: number; offset?: number; type?: string }
  ): Promise<{
    content: SummaryItem[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.type) params.set('type', options.type);
    const query = params.toString();

    return apiRequest<{
      content: SummaryItem[];
      pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    }>(
      `/api/v1/configs/${id}/content${query ? `?${query}` : ''}`,
      {},
      authToken || undefined
    );
  },

  /**
   * Get a specific content entry (summary) by ID
   */
  async getContentById(
    authToken: string | null | undefined,
    configId: string,
    contentId: string
  ): Promise<SummaryItem> {
    return apiRequest<SummaryItem>(
      `/api/v1/configs/${configId}/content/${contentId}`,
      {},
      authToken || undefined
    );
  },

  // ========================================================================
  // ACCESS GRANTS — 24-hour purchasable data access
  // ========================================================================

  /**
   * Check current user's access status for a config
   */
  async getAccessStatus(
    configId: string,
    authToken?: string | null
  ): Promise<AccessStatus> {
    return apiRequest<AccessStatus>(
      `/api/v1/configs/${configId}/access`,
      {},
      authToken || undefined
    );
  },

  /**
   * Initiate access purchase — first call returns 402 with payment details
   */
  async purchaseAccess(
    configId: string,
    authToken?: string | null,
    walletAddress?: string
  ): Promise<AccessPurchasePaymentDetails> {
    const response = await fetch(`${API_BASE}/api/v1/configs/${configId}/access/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ walletAddress }),
    });

    if (response.status === 402) {
      const data = await response.json();
      return data.payment as AccessPurchasePaymentDetails;
    }

    // Already has access (existing grant or non-monetized)
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        throw new AccessAlreadyGrantedError(data.access);
      }
    }

    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error || error.message || `HTTP ${response.status}`, response.status);
  },

  /**
   * Complete access purchase with payment proof
   */
  async purchaseAccessWithProof(
    configId: string,
    signature: string,
    memo: string,
    authToken?: string | null,
    walletAddress?: string
  ): Promise<AccessPurchaseResult> {
    return apiRequest<AccessPurchaseResult>(
      `/api/v1/configs/${configId}/access/purchase`,
      {
        method: 'POST',
        headers: {
          'X-Payment-Proof': JSON.stringify({ signature, memo }),
        },
        body: JSON.stringify({ walletAddress }),
      },
      authToken || undefined
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
 * Config Template Types
 */
export interface TemplateField {
  key: string;
  label: string;
  type: 'url-list' | 'string-list' | 'text';
  placeholder: string;
  required: boolean;
  helpText?: string;
  injectPath: string;
}

export interface ConfigTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  fields: TemplateField[];
  configJson: any;
  localConfigJson: any;
}

/**
 * Config Templates API - public, no auth required
 */
export const templatesApi = {
  async list(): Promise<ConfigTemplate[]> {
    const data = await apiRequest<{ templates: ConfigTemplate[] }>('/api/v1/templates');
    return data.templates;
  },
};

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

// ============================================================================
// ADMIN API
// ============================================================================

/**
 * Admin Types
 */
export type TimeRange = 'today' | '7d' | '30d' | '90d' | 'all';

export interface AdminUser {
  id: string;
  privyId: string;
  email?: string;
  walletAddress?: string;
  tier: UserTier;
  isBanned: boolean;
  bannedAt?: string;
  bannedReason?: string;
  aiCallsToday: number;
  createdAt: string;
  updatedAt: string;
  configCount?: number;
}

export interface AdminConfig {
  id: string;
  userId: string;
  ownerEmail?: string;
  ownerWalletAddress?: string;
  name: string;
  slug: string;
  description?: string;
  visibility: string;
  storageType: string;
  monetizationEnabled: boolean;
  pricePerQuery?: number;
  status: string;
  lastRunAt?: string;
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  isFeatured: boolean;
  featuredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStats {
  users: {
    total: number;
    free: number;
    paid: number;
    admin: number;
    banned: number;
    newInRange: number;
  };
  configs: {
    total: number;
    public: number;
    private: number;
    unlisted: number;
    shared: number;
    featured: number;
  };
  usage: {
    totalRuns: number;
    totalAiCalls: number;
    totalApiRequests: number;
  };
  revenue: {
    totalPayments: number;
    totalAmount: number;
    platformFees: number;
  };
}

export interface UsageDataPoint {
  date: string;
  runs: number;
  apiRequests: number;
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminUsersResponse extends PaginatedResponse<AdminUser> {
  users: AdminUser[];
}

export interface AdminConfigsResponse extends PaginatedResponse<AdminConfig> {
  configs: AdminConfig[];
}

/**
 * Admin API - System administration
 */
export const adminApi = {
  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get system-wide statistics
   */
  async getStats(authToken: string, range: TimeRange = 'all'): Promise<SystemStats> {
    return apiRequest<SystemStats>(
      `/api/v1/admin/stats?range=${range}`,
      {},
      authToken
    );
  },

  /**
   * Get usage statistics over time
   */
  async getUsageOverTime(
    authToken: string,
    range: TimeRange = '30d'
  ): Promise<{ data: UsageDataPoint[] }> {
    return apiRequest<{ data: UsageDataPoint[] }>(
      `/api/v1/admin/stats/usage?range=${range}`,
      {},
      authToken
    );
  },

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================

  /**
   * Get all users with pagination and filters
   */
  async getUsers(
    authToken: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      tier?: UserTier;
      isBanned?: boolean;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<AdminUsersResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.search) params.set('search', options.search);
    if (options?.tier) params.set('tier', options.tier);
    if (options?.isBanned !== undefined) params.set('isBanned', options.isBanned.toString());
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.sortOrder) params.set('sortOrder', options.sortOrder);
    const query = params.toString();

    return apiRequest<AdminUsersResponse>(
      `/api/v1/admin/users${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get a single user by ID
   */
  async getUser(authToken: string, userId: string): Promise<AdminUser> {
    return apiRequest<AdminUser>(`/api/v1/admin/users/${userId}`, {}, authToken);
  },

  /**
   * Update user tier
   */
  async updateUserTier(
    authToken: string,
    userId: string,
    tier: UserTier
  ): Promise<{ success: boolean; user: AdminUser; message: string }> {
    return apiRequest<{ success: boolean; user: AdminUser; message: string }>(
      `/api/v1/admin/users/${userId}/tier`,
      {
        method: 'PATCH',
        body: JSON.stringify({ tier }),
      },
      authToken
    );
  },

  /**
   * Ban a user
   */
  async banUser(
    authToken: string,
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; user: AdminUser; message: string }> {
    return apiRequest<{ success: boolean; user: AdminUser; message: string }>(
      `/api/v1/admin/users/${userId}/ban`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      },
      authToken
    );
  },

  /**
   * Unban a user
   */
  async unbanUser(
    authToken: string,
    userId: string
  ): Promise<{ success: boolean; user: AdminUser; message: string }> {
    return apiRequest<{ success: boolean; user: AdminUser; message: string }>(
      `/api/v1/admin/users/${userId}/unban`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Create an impersonation token
   */
  async impersonateUser(
    authToken: string,
    userId: string
  ): Promise<{ success: boolean; token: string; expiresAt: string }> {
    return apiRequest<{ success: boolean; token: string; expiresAt: string }>(
      `/api/v1/admin/users/${userId}/impersonate`,
      { method: 'POST' },
      authToken
    );
  },

  // ============================================================================
  // CONFIG MANAGEMENT
  // ============================================================================

  /**
   * Get all configs with pagination and filters
   */
  async getConfigs(
    authToken: string,
    options?: {
      page?: number;
      limit?: number;
      search?: string;
      visibility?: string;
      isFeatured?: boolean;
      userId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ): Promise<AdminConfigsResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.search) params.set('search', options.search);
    if (options?.visibility) params.set('visibility', options.visibility);
    if (options?.isFeatured !== undefined) params.set('isFeatured', options.isFeatured.toString());
    if (options?.userId) params.set('userId', options.userId);
    if (options?.sortBy) params.set('sortBy', options.sortBy);
    if (options?.sortOrder) params.set('sortOrder', options.sortOrder);
    const query = params.toString();

    return apiRequest<AdminConfigsResponse>(
      `/api/v1/admin/configs${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Set config featured status
   */
  async setConfigFeatured(
    authToken: string,
    configId: string,
    featured: boolean
  ): Promise<{ success: boolean; config: AdminConfig; message: string }> {
    return apiRequest<{ success: boolean; config: AdminConfig; message: string }>(
      `/api/v1/admin/configs/${configId}/featured`,
      {
        method: 'PATCH',
        body: JSON.stringify({ featured }),
      },
      authToken
    );
  },
};

// ============================================================================
// EXTERNAL CONNECTIONS API - Multi-tenant platform connections (Discord, Telegram, etc.)
// ============================================================================

/**
 * Platform Types
 */
export type PlatformType = 'discord' | 'telegram' | 'slack' | 'github';
export type AuthType = 'oauth' | 'webhook' | 'token';

/**
 * Platform info for display
 */
export interface PlatformInfo {
  platform: PlatformType;
  displayName: string;
  icon: string;
  description: string;
  authType: AuthType;
  resourceTypes: string[];
  isEnabled: boolean;
  connectionInstructions?: string;
}

/**
 * External connection (generic across platforms)
 */
export interface ExternalConnection {
  id: string;
  platform: PlatformType;
  externalId: string;
  externalName: string;
  externalIcon?: string;
  isActive: boolean;
  addedAt: string;
  channelCount: number;
  lastVerifiedAt?: string;
  metadata?: Record<string, any>;
  // Legacy Discord field aliases (deprecated - use externalId/externalName/externalIcon instead)
  /** @deprecated Use externalId instead */
  guildId?: string;
  /** @deprecated Use externalName instead */
  guildName?: string;
  /** @deprecated Use externalIcon instead */
  guildIcon?: string;
}

/**
 * External channel (generic across platforms)
 */
export interface ExternalChannel {
  id: string;
  connectionId: string;
  externalId: string;
  externalName: string;
  resourceType: number | string;
  parentId?: string;
  parentName?: string;
  position: number;
  isAccessible: boolean;
  lastSyncedAt?: string;
  metadata?: Record<string, any>;
  // Legacy Discord field aliases (deprecated - use externalId/externalName instead)
  /** @deprecated Use connectionId instead */
  guildConnectionId?: string;
  /** @deprecated Use externalId instead */
  channelId?: string;
  /** @deprecated Use externalName instead */
  channelName?: string;
  /** @deprecated Use resourceType instead */
  channelType?: number | string;
  /** @deprecated Use parentId instead */
  categoryId?: string;
  /** @deprecated Use parentName instead */
  categoryName?: string;
}

/**
 * Auth URL result (includes instructions for webhook-based platforms)
 */
export interface AuthUrlResult {
  url: string;
  state: string;
  platform: PlatformType;
  authType: AuthType;
  instructions?: string;
}

// Legacy Discord types for backward compatibility
export type DiscordGuildConnection = ExternalConnection;
export type DiscordChannel = ExternalChannel;
export type DiscordGuildDetails = ExternalConnection;

/**
 * Connections API - External platform connections (Discord, Telegram, Slack, etc.)
 */
export const connectionsApi = {
  /**
   * Get available platforms
   */
  async getPlatforms(authToken: string): Promise<{ platforms: PlatformInfo[] }> {
    return apiRequest<{ platforms: PlatformInfo[] }>(
      '/api/v1/connections/platforms',
      {},
      authToken
    );
  },

  /**
   * Get all connections for the authenticated user
   */
  async getConnections(authToken: string): Promise<{ connections: ExternalConnection[] }> {
    return apiRequest<{ connections: ExternalConnection[] }>(
      '/api/v1/connections',
      {},
      authToken
    );
  },

  /**
   * Get connections filtered by platform
   */
  async getConnectionsByPlatform(
    authToken: string,
    platform: PlatformType
  ): Promise<{ connections: ExternalConnection[] }> {
    const all = await connectionsApi.getConnections(authToken);
    return {
      connections: all.connections.filter(c => c.platform === platform),
    };
  },

  /**
   * Get auth URL for a platform (OAuth or deep link)
   * @param authToken - User's auth token
   * @param platform - Platform type (discord, telegram, slack)
   * @param redirectUrl - Optional URL to redirect to after auth completes
   * @param popup - If true, the callback will return HTML for popup mode instead of redirecting
   */
  async getAuthUrl(
    authToken: string,
    platform: PlatformType,
    redirectUrl?: string,
    popup?: boolean
  ): Promise<AuthUrlResult> {
    const params = new URLSearchParams();
    if (redirectUrl) params.set('redirect', redirectUrl);
    if (popup) params.set('popup', 'true');
    const query = params.toString();

    return apiRequest<AuthUrlResult>(
      `/api/v1/connections/${platform}/auth${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get details of a specific connection
   */
  async getConnection(authToken: string, connectionId: string): Promise<ExternalConnection> {
    return apiRequest<ExternalConnection>(
      `/api/v1/connections/${connectionId}`,
      {},
      authToken
    );
  },

  /**
   * Remove a connection (marks as inactive)
   */
  async removeConnection(authToken: string, connectionId: string): Promise<void> {
    return apiRequest<void>(
      `/api/v1/connections/${connectionId}`,
      { method: 'DELETE' },
      authToken
    );
  },

  /**
   * Verify a connection is still active
   */
  async verifyConnection(authToken: string, connectionId: string): Promise<{ valid: boolean }> {
    return apiRequest<{ valid: boolean }>(
      `/api/v1/connections/${connectionId}/verify`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Get channels for a connection
   */
  async getChannels(
    authToken: string,
    connectionId: string
  ): Promise<{
    channels: ExternalChannel[];
    grouped: Record<string, ExternalChannel[]>;
    connectionId: string;
    connectionName: string;
  }> {
    return apiRequest<{
      channels: ExternalChannel[];
      grouped: Record<string, ExternalChannel[]>;
      connectionId: string;
      connectionName: string;
    }>(
      `/api/v1/connections/${connectionId}/channels`,
      {},
      authToken
    );
  },

  /**
   * Sync/refresh channels for a connection
   */
  async syncChannels(
    authToken: string,
    connectionId: string
  ): Promise<{
    channels: ExternalChannel[];
    synced: boolean;
    syncedAt: string;
  }> {
    return apiRequest<{
      channels: ExternalChannel[];
      synced: boolean;
      syncedAt: string;
    }>(
      `/api/v1/connections/${connectionId}/sync`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Validate that channels are accessible in a connection
   */
  async validateChannels(
    authToken: string,
    connectionId: string,
    channelIds: string[]
  ): Promise<{
    valid: boolean;
    invalidChannels: string[];
  }> {
    return apiRequest<{
      valid: boolean;
      invalidChannels: string[];
    }>(
      '/api/v1/connections/validate-channels',
      {
        method: 'POST',
        body: JSON.stringify({ connectionId, channelIds }),
      },
      authToken
    );
  },
};

// Legacy Discord API - maps to connectionsApi for backward compatibility
export const discordApi = {
  async getAuthUrl(authToken: string, redirectUrl?: string) {
    return connectionsApi.getAuthUrl(authToken, 'discord', redirectUrl);
  },
  async getGuilds(authToken: string) {
    const result = await connectionsApi.getConnectionsByPlatform(authToken, 'discord');
    // Map to legacy format
    return {
      guilds: result.connections.map(c => ({
        ...c,
        guildId: c.externalId,
        guildName: c.externalName,
        guildIcon: c.externalIcon,
      })),
    };
  },
  async getGuild(authToken: string, connectionId: string) {
    const conn = await connectionsApi.getConnection(authToken, connectionId);
    return { ...conn, guildId: conn.externalId, guildName: conn.externalName, guildIcon: conn.externalIcon };
  },
  async removeGuild(authToken: string, connectionId: string) {
    return connectionsApi.removeConnection(authToken, connectionId);
  },
  async getChannels(authToken: string, connectionId: string) {
    const result = await connectionsApi.getChannels(authToken, connectionId);
    return {
      channels: result.channels.map(c => ({
        ...c,
        guildConnectionId: c.connectionId,
        channelId: c.externalId,
        channelName: c.externalName,
        channelType: c.resourceType,
        categoryId: c.parentId,
        categoryName: c.parentName,
      })),
      grouped: Object.fromEntries(
        Object.entries(result.grouped).map(([k, v]) => [
          k,
          v.map(c => ({
            ...c,
            guildConnectionId: c.connectionId,
            channelId: c.externalId,
            channelName: c.externalName,
            channelType: c.resourceType,
            categoryId: c.parentId,
            categoryName: c.parentName,
          })),
        ])
      ),
      guildId: result.connectionId,
      guildName: result.connectionName,
    };
  },
  async syncChannels(authToken: string, connectionId: string) {
    const result = await connectionsApi.syncChannels(authToken, connectionId);
    return {
      channels: result.channels.map(c => ({
        ...c,
        guildConnectionId: c.connectionId,
        channelId: c.externalId,
        channelName: c.externalName,
        channelType: c.resourceType,
        categoryId: c.parentId,
        categoryName: c.parentName,
      })),
      synced: result.synced,
      syncedAt: result.syncedAt,
    };
  },
  async validateChannels(authToken: string, connectionId: string, channelIds: string[]) {
    return connectionsApi.validateChannels(authToken, connectionId, channelIds);
  },
  async getStatus(authToken: string) {
    // Status endpoint is platform-specific, keep as-is for now
    return apiRequest<{
      ready: boolean;
      guildCount?: number;
      guilds?: Array<{ id: string; name: string; memberCount: number }>;
    }>(
      '/api/v1/connections/discord/status',
      {},
      authToken
    );
  },
};

// ============================================================================
// RUNS API - Job/Run management for config aggregations
// ============================================================================

/**
 * Run Types
 */
export type RunJobType = 'one-time' | 'continuous';
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AggregationRun {
  id: string;
  configId?: string;
  userId?: string;
  jobType: RunJobType;
  status: RunStatus;
  globalInterval?: number;
  startedAt?: string;
  completedAt?: string;
  itemsFetched: number;
  itemsProcessed: number;
  runCount: number;
  lastFetchAt?: string;
  errorMessage?: string;
  logs?: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    source?: string;
  }>;
  createdAt: string;
}

export interface FreeRunStatus {
  available: boolean;
  usedAt: string | null;
  resetAt: string;
}

export interface RunsListResponse {
  runs: AggregationRun[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface RunFreeResponse {
  message: string;
  configId: string;
  jobId: string;
  freeRunReset: string;
  queuedAt: string;
}

export interface RunPaidResponse {
  message: string;
  configId: string;
  jobId: string;
  queuedAt: string;
  aiSkipped?: boolean;
}

export interface RunContinuousResponse {
  message: string;
  configId: string;
  jobId: string;
  globalInterval: number;
  queuedAt: string;
}

export interface PaymentRequired {
  error: string;
  code: string;
  message: string;
  payment: {
    amount: number;
    amountDisplay: string;
    currency: string;
    network: string;
    recipient: string;
    facilitatorUrl: string;
    description: string;
  };
  alternative?: {
    message: string;
    upgradeUrl: string;
  };
}

/**
 * Runs API - Manages run history and run actions for configs
 */
export const runsApi = {
  /**
   * Get run history for a config
   */
  async list(
    authToken: string,
    configId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<RunsListResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    const query = params.toString();

    return apiRequest<RunsListResponse>(
      `/api/v1/configs/${configId}/runs${query ? `?${query}` : ''}`,
      {},
      authToken
    );
  },

  /**
   * Get details of a specific run
   */
  async get(authToken: string, configId: string, runId: string): Promise<AggregationRun> {
    return apiRequest<AggregationRun>(
      `/api/v1/configs/${configId}/runs/${runId}`,
      {},
      authToken
    );
  },

  /**
   * Trigger a free one-time run (1 per day per user)
   * @param resolvedConfig - Optional fully-resolved config (secrets already injected client-side)
   */
  async runFree(authToken: string, configId: string, resolvedConfig?: any): Promise<RunFreeResponse> {
    return apiRequest<RunFreeResponse>(
      `/api/v1/configs/${configId}/run/free`,
      { 
        method: 'POST',
        body: JSON.stringify(resolvedConfig ? { resolvedConfig } : {}),
      },
      authToken
    );
  },

  /**
   * Trigger a paid one-time run
   * Requires pro license or payment
   * @param resolvedConfig - Optional fully-resolved config (secrets already injected client-side)
   */
  async runPaid(authToken: string, configId: string, resolvedConfig?: any): Promise<RunPaidResponse> {
    const response = await fetch(`${API_BASE}/api/v1/configs/${configId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(resolvedConfig ? { resolvedConfig } : {}),
    });

    if (response.status === 402) {
      const paymentRequired = await response.json() as PaymentRequired;
      throw new ApiError(
        paymentRequired.message || 'Payment required',
        402,
        'PAYMENT_REQUIRED'
      );
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(error.message || error.error || 'Failed to run', response.status);
    }

    return response.json();
  },

  /**
   * Start a continuous run (pro only)
   */
  async runContinuous(
    authToken: string,
    configId: string,
    globalInterval?: number,
    resolvedConfig?: any
  ): Promise<RunContinuousResponse> {
    return apiRequest<RunContinuousResponse>(
      `/api/v1/configs/${configId}/run/continuous`,
      {
        method: 'POST',
        body: JSON.stringify({ globalInterval, ...(resolvedConfig ? { resolvedConfig } : {}) }),
      },
      authToken
    );
  },

  /**
   * Stop a running continuous job
   */
  async stopContinuous(authToken: string, configId: string): Promise<{ message: string; configId: string; jobId: string }> {
    return apiRequest<{ message: string; configId: string; jobId: string }>(
      `/api/v1/configs/${configId}/run/stop`,
      { method: 'POST' },
      authToken
    );
  },

  /**
   * Get user's free run status
   */
  async getFreeRunStatus(authToken: string): Promise<FreeRunStatus> {
    return apiRequest<FreeRunStatus>('/api/v1/me/free-run-status', {}, authToken);
  },
};

/**
 * Relay API - Forwards encrypted payloads to local servers via the hosted API
 */
export const relayApi = {
  /**
   * Relay an encrypted config to a local server for execution
   */
  async execute(
    authToken: string,
    payload: { encrypted: string; iv: string; tag: string; targetUrl: string }
  ): Promise<{ jobId: string; status: string; message: string }> {
    return apiRequest<{ jobId: string; status: string; message: string }>(
      '/api/v1/relay/execute',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      authToken
    );
  },

  /**
   * Check health of a local server via the relay
   */
  async health(
    authToken: string,
    targetUrl: string
  ): Promise<{ status: string; version: string; hasKey: boolean; mode: string }> {
    return apiRequest<{ status: string; version: string; hasKey: boolean; mode: string }>(
      '/api/v1/relay/health',
      {
        method: 'POST',
        body: JSON.stringify({ targetUrl }),
      },
      authToken
    );
  },

  /**
   * Get job status from a local server via the relay
   */
  async status(
    authToken: string,
    targetUrl: string,
    jobId: string
  ): Promise<any> {
    return apiRequest<any>(
      '/api/v1/relay/status',
      {
        method: 'POST',
        body: JSON.stringify({ targetUrl, jobId }),
      },
      authToken
    );
  },
};

export default {
  plugin: pluginApi,
  localConfig: localConfigApi,
  config: configApi,
  run: runApi,
  runs: runsApi,
  user: userApi,
  license: licenseApi,
  search: searchApi,
  admin: adminApi,
  connections: connectionsApi,
  discord: discordApi, // Legacy - use connectionsApi instead
  relay: relayApi,
  checkHealth,
};
