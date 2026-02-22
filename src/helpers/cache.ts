/**
 * Caching utilities for Digital Gardener.
 * This module provides in-memory caching functionality for various components.
 * 
 * @module helpers
 */

/**
 * Represents a cache entry with an optional expiration time.
 * 
 * @template T - The type of the cached value
 */
interface CacheEntry<T> {
  /** The cached value */
  value: T;
  /** Timestamp when the entry expires (null if no expiration) */
  expiresAt: number | null;
}

/**
 * Generic in-memory cache implementation.
 * 
 * This class provides:
 * - Setting values with optional time-to-live
 * - Retrieving values (with automatic expiration)
 * - Deleting individual entries
 * - Clearing the entire cache
 */
export class Cache {
  /** The underlying cache store */
  private store: Record<string, CacheEntry<any>> = {};

  /**
   * Sets a value in the cache.
   * 
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttlSeconds - Optional time-to-live in seconds
   */
  public set<T>(key: string, value: T, ttlSeconds?: number): void {
    let expiresAt: number | null = null;
    if (ttlSeconds) {
      expiresAt = Date.now() + ttlSeconds * 1000;
    }
    this.store[key] = { value, expiresAt };
  }

  /**
   * Gets a value from the cache.
   * 
   * @param key - The cache key
   * @returns The cached value or undefined if not found or expired
   */
  public get<T>(key: string): T | undefined {
    const entry = this.store[key];
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      // The entry has expired.
      delete this.store[key];
      return undefined;
    }
    return entry.value;
  }

  /**
   * Deletes a value from the cache.
   * 
   * @param key - The cache key
   */
  public del(key: string): void {
    delete this.store[key];
  }

  /**
   * Clears the entire cache.
   */
  public clear(): void {
    this.store = {};
  }
}

/**
 * Specialized cache for Twitter data.
 * 
 * This class provides:
 * - Caching of Twitter data by account and date
 * - Caching of Twitter cursors for pagination
 * - Automatic expiration of cursor data
 */
export class TwitterCache {
  /** The underlying cache instance */
  private cache: Cache;

  /**
   * Creates a new TwitterCache instance.
   */
  constructor() {
    this.cache = new Cache();
  }

  /**
   * Generates a cache key for Twitter data.
   * 
   * @param account - The Twitter account
   * @param date - The date string
   * @returns A formatted cache key
   */
  private getCacheKey(account: string, date: string): string {
    return `twitter:${account}:${date}`;
  }
  
  /**
   * Generates a cache key for Twitter cursors.
   * 
   * @param account - The Twitter account
   * @returns A formatted cache key
   */
  private getCursorKey(account: string): string {
    return `twitter:${account}:cursor`;
  }

  /**
   * Sets Twitter data in the cache.
   * 
   * @param account - The Twitter account
   * @param date - The date string
   * @param data - The data to cache
   * @param ttlSeconds - Optional time-to-live in seconds
   */
  public set(account: string, date: string, data: any, ttlSeconds?: number): void {
    const key = this.getCacheKey(account, date);
    this.cache.set(key, data, ttlSeconds);
  }

  /**
   * Gets Twitter data from the cache.
   * 
   * @param account - The Twitter account
   * @param date - The date string
   * @returns The cached data or undefined if not found or expired
   */
  public get(account: string, date: string): any | undefined {
    const key = this.getCacheKey(account, date);
    return this.cache.get(key);
  }
  
  /**
   * Sets a Twitter cursor in the cache.
   * 
   * @param account - The Twitter account
   * @param cursor - The cursor value
   */
  public setCursor(account: string, cursor: string): void {
    const key = this.getCursorKey(account);
    this.cache.set(key, cursor, 300); // 5 minute TTL for cursors
  }
  
  /**
   * Gets a Twitter cursor from the cache.
   * 
   * @param account - The Twitter account
   * @returns The cached cursor or undefined if not found or expired
   */
  public getCursor(account: string): string | undefined {
    const key = this.getCursorKey(account);
    return this.cache.get(key);
  }

  /**
   * Clears the entire Twitter cache.
   */
  public clear(): void {
    this.cache.clear();
  }
}