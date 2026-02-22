/**
 * Rate limiting utilities for API integrations.
 * Includes Discord-compliant rate limiter and token bucket algorithm for GitHub API.
 *
 * @module helpers/rateLimiter
 */

import { logger } from "./cliHelper";
import { delay } from "./generalHelper";

// Discord rate limit constants
const DISCORD_GLOBAL_RATE_LIMIT = 50;  // requests per second
const DISCORD_RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_CONCURRENT_DOWNLOADS = 5;

/**
 * Discord-compliant rate limiter that respects API headers and implements proper backoff
 */
export class DiscordRateLimiter {
  private requestQueue: Array<() => void> = [];
  private globalRateLimit: { resetAt: number; remaining: number } = { resetAt: 0, remaining: DISCORD_GLOBAL_RATE_LIMIT };
  private bucketLimits: Map<string, { resetAt: number; remaining: number; limit: number }> = new Map();
  private processing = false;
  private activeRequests = 0;

  /**
   * Add a request to the rate-limited queue
   */
  async enqueue<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  /**
   * Process the request queue respecting rate limits
   */
  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0 || this.activeRequests >= MAX_CONCURRENT_DOWNLOADS) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0 && this.activeRequests < MAX_CONCURRENT_DOWNLOADS) {
      const now = Date.now();

      // Check global rate limit
      if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
        const waitTime = this.globalRateLimit.resetAt - now;
        logger.debug(`Global rate limit hit, waiting ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }

      // Reset global rate limit if window passed
      if (now >= this.globalRateLimit.resetAt) {
        this.globalRateLimit = { resetAt: now + DISCORD_RATE_LIMIT_WINDOW, remaining: DISCORD_GLOBAL_RATE_LIMIT };
      }

      const request = this.requestQueue.shift()!;
      this.activeRequests++;
      this.globalRateLimit.remaining--;

      // Execute request without blocking the queue
      setImmediate(async () => {
        try {
          await request();
        } catch (error) {
          logger.debug(`Request failed: ${error}`);
        } finally {
          this.activeRequests--;
          // Continue processing queue
          setImmediate(() => this.processQueue());
        }
      });

      // Small delay between requests to prevent overwhelming
      await delay(50);
    }

    this.processing = false;
  }

  /**
   * Update rate limits based on Discord response headers
   */
  updateRateLimits(headers: any, bucket?: string) {
    const now = Date.now();

    // Update global rate limit from headers
    if (headers['x-ratelimit-global']) {
      const retryAfter = parseFloat(headers['retry-after']) * 1000;
      this.globalRateLimit = { resetAt: now + retryAfter, remaining: 0 };
      logger.warning(`Global rate limit hit, reset in ${retryAfter}ms`);
    }

    // Update bucket-specific rate limit
    if (bucket && headers['x-ratelimit-limit']) {
      const limit = parseInt(headers['x-ratelimit-limit']);
      const remaining = parseInt(headers['x-ratelimit-remaining'] || '0');
      const resetAfter = parseFloat(headers['x-ratelimit-reset-after'] || '1') * 1000;

      this.bucketLimits.set(bucket, {
        resetAt: now + resetAfter,
        remaining,
        limit
      });

      if (remaining <= 0) {
        logger.debug(`Bucket ${bucket} rate limit hit, reset in ${resetAfter}ms`);
      }
    }
  }

  /**
   * Check if a request to a specific bucket should be delayed
   */
  shouldDelay(bucket?: string): number {
    const now = Date.now();
    let delayMs = 0;

    // Check global rate limit
    if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
      delayMs = Math.max(delayMs, this.globalRateLimit.resetAt - now);
    }

    // Check bucket rate limit
    if (bucket && this.bucketLimits.has(bucket)) {
      const bucketLimit = this.bucketLimits.get(bucket)!;
      if (now < bucketLimit.resetAt && bucketLimit.remaining <= 0) {
        delayMs = Math.max(delayMs, bucketLimit.resetAt - now);
      }
    }

    return delayMs;
  }
}

// ============================================
// GITHUB RATE LIMITING (Token Bucket Algorithm)
// ============================================

/**
 * Token bucket for rate limiting
 * Used for both points-based (GraphQL) and concurrent request limiting
 */
export interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per millisecond
}

/**
 * Rate limit information parsed from GitHub API headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: Date;
  cost?: number;
}

/**
 * Rate limit type detection result
 */
export interface RateLimitType {
  type: 'primary' | 'secondary';
  waitTime: number;
  strategy: 'wait' | 'backoff' | 'reduce_load';
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  minTimeout: number;
  maxTimeout: number;
  factor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  minTimeout: 1000,
  maxTimeout: 120000,
  factor: 2,
};

/**
 * Custom error for primary rate limit exceeded
 */
export class RateLimitExceededError extends Error {
  constructor(
    message: string,
    public resetAt: Date,
  ) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

/**
 * Custom error for secondary rate limit exceeded
 */
export class SecondaryRateLimitError extends Error {
  constructor(
    message: string,
    public waitTime: number,
  ) {
    super(message);
    this.name = 'SecondaryRateLimitError';
  }
}

/**
 * Concurrency manager interface
 */
export interface ConcurrencyManager {
  currentLevel: number;
  maxLevel: number;
  minLevel: number;
  lastSuccessTime: number;
  lastRateLimitTime: number;
  
  reduceOnSecondaryLimit(): number;
  increaseOnSuccess(): number;
  getCurrentLevel(): number;
  shouldReduceLoad(): boolean;
}

/**
 * Adaptive concurrency manager implementation
 * Adjusts concurrency level based on rate limit feedback
 */
export class AdaptiveConcurrencyManager implements ConcurrencyManager {
  currentLevel: number;
  maxLevel: number;
  minLevel: number;
  lastSuccessTime: number;
  lastRateLimitTime: number;

  constructor(
    initialLevel: number = 5,
    maxLevel: number = 8,
    minLevel: number = 3,
  ) {
    this.currentLevel = initialLevel;
    this.maxLevel = maxLevel;
    this.minLevel = minLevel;
    this.lastSuccessTime = Date.now();
    this.lastRateLimitTime = 0;
  }

  /**
   * Reduce concurrency when secondary rate limit is hit
   */
  reduceOnSecondaryLimit(): number {
    this.lastRateLimitTime = Date.now();
    // Reduce concurrency by half on secondary rate limit
    this.currentLevel = Math.max(
      this.minLevel,
      Math.floor(this.currentLevel / 2),
    );
    return this.currentLevel;
  }

  /**
   * Potentially increase concurrency after successful requests
   */
  increaseOnSuccess(): number {
    this.lastSuccessTime = Date.now();
    // Only increase if we haven't been rate limited recently (last 2 minutes)
    const timeSinceRateLimit = Date.now() - this.lastRateLimitTime;
    if (timeSinceRateLimit > 120000 && this.currentLevel < this.maxLevel) {
      this.currentLevel = Math.min(this.maxLevel, this.currentLevel + 1);
    }
    return this.currentLevel;
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  /**
   * Check if we should reduce load based on recent rate limit hits
   */
  shouldReduceLoad(): boolean {
    // If we've been rate limited within the last 5 minutes, reduce load
    return Date.now() - this.lastRateLimitTime < 300000;
  }
}

/**
 * Create a new token bucket
 */
export function createTokenBucket(capacity: number, refillRatePerMinute: number): TokenBucket {
  return {
    tokens: capacity,
    lastRefill: Date.now(),
    capacity,
    refillRate: refillRatePerMinute / 60000, // Convert to per millisecond
  };
}

/**
 * Create token bucket for GitHub GraphQL API (900 points per minute)
 */
export function createGraphQLPointsBucket(): TokenBucket {
  return createTokenBucket(900, 900);
}

/**
 * Create token bucket for concurrent requests (conservative 50 max)
 */
export function createConcurrentBucket(): TokenBucket {
  return createTokenBucket(50, 50);
}

/**
 * Refill tokens in a bucket based on elapsed time
 */
export function refillTokenBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const timePassed = now - bucket.lastRefill;
  const newTokens = timePassed * bucket.refillRate;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + newTokens);
  bucket.lastRefill = now;
}

/**
 * Consume tokens from a bucket, waiting if necessary
 */
export async function consumeTokens(bucket: TokenBucket, tokens: number): Promise<void> {
  refillTokenBucket(bucket);

  while (bucket.tokens < tokens) {
    // Wait for enough tokens to be available
    const tokensNeeded = tokens - bucket.tokens;
    const waitTime = Math.ceil(tokensNeeded / bucket.refillRate);
    await delay(Math.min(waitTime, 1000)); // Wait at most 1 second at a time
    refillTokenBucket(bucket);
  }

  bucket.tokens -= tokens;
}

/**
 * Parse rate limit error to determine type and strategy
 */
export function parseRateLimitError(error: unknown): RateLimitType {
  const axiosError = error as {
    response?: {
      data?: { message?: string };
      status?: number;
      headers?: Record<string, string>;
    };
    message?: string;
  };
  
  const message = axiosError?.response?.data?.message || axiosError?.message || '';
  const status = axiosError?.response?.status || 0;

  if (status === 403 && message.toLowerCase().includes('secondary rate limit')) {
    // Secondary rate limit - shorter wait time, reduce load strategy
    const retryAfter = axiosError?.response?.headers?.['retry-after'];
    const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 900000; // Default 15 minutes

    return {
      type: 'secondary',
      waitTime: Math.min(waitTime, 900000), // Cap at 15 minutes
      strategy: 'reduce_load',
    };
  } else if (status === 403 || message.toLowerCase().includes('rate limit')) {
    // Primary rate limit - longer wait time, wait strategy
    const rateLimitReset = axiosError?.response?.headers?.['x-ratelimit-reset'];
    let waitTime = 3600000; // Default 1 hour

    if (rateLimitReset) {
      const resetTime = parseInt(rateLimitReset, 10) * 1000;
      waitTime = Math.max(0, resetTime - Date.now()) + 60000; // Add 1 minute buffer
    }

    return {
      type: 'primary',
      waitTime,
      strategy: 'wait',
    };
  }

  // Default to secondary rate limit handling for unknown errors
  return {
    type: 'secondary',
    waitTime: 60000, // 1 minute default
    strategy: 'backoff',
  };
}

/**
 * Parse rate limit headers from GitHub API response
 */
export function parseRateLimitHeaders(headers: Record<string, string | undefined>): RateLimitInfo {
  const resetAt = headers['x-ratelimit-reset']
    ? new Date(parseInt(headers['x-ratelimit-reset'] as string, 10) * 1000)
    : new Date(Date.now() + 60000); // Default 1 minute fallback

  return {
    limit: parseInt((headers['x-ratelimit-limit'] as string) || '5000', 10),
    remaining: parseInt((headers['x-ratelimit-remaining'] as string) || '5000', 10),
    resetAt,
    cost: headers['x-github-request-cost']
      ? parseInt(headers['x-github-request-cost'] as string, 10)
      : undefined,
  };
}
