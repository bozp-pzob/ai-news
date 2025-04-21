/**
 * General utility functions for the AI News Aggregator.
 * This module provides common helper functions used across the application.
 * 
 * @module helpers
 */

/**
 * Creates a promise that resolves after a specified delay.
 * Useful for implementing rate limiting or adding delays between operations.
 * 
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the specified delay
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}