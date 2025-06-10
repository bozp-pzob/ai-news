/**
 * Caching utilities for the AI News Aggregator.
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

