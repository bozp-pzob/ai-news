// frontend/src/services/platformApi.ts

/**
 * Platform API Service
 * 
 * Handles all API v1 calls for the multi-tenant platform including:
 * - User management
 * - Config CRUD
 * - Search and context
 * - Monetization
 */

const API_BASE = process.env.REACT_APP_API_URL || '';

/**
 * Types
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
  // Only for owners
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
  };
  usage: {
    configCount: number;
    runsToday: number;
  };
  canCreateConfig: boolean;
  canRunAggregation: boolean;
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
      errorMessage = errorData.error || errorData.message || errorMessage;
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
 * User API
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
 * Config API
 */
export const configApi = {
  /**
   * List public configs
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
   * Get context for a config
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
   * Run aggregation for a config
   */
  async run(authToken: string, id: string): Promise<{ message: string; queuedAt: string }> {
    return apiRequest<{ message: string; queuedAt: string }>(
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
};

/**
 * Search API
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

export default {
  user: userApi,
  config: configApi,
  search: searchApi,
  checkHealth,
};
