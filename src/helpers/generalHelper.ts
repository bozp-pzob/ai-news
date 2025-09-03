import { logger } from "./cliHelper";

/**
 * General utility functions for the AI News Aggregator.
 * This module provides common helper functions used across the application.
 * 
 * @module helpers
 */

export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000; // 1 second

export const time = {
  seconds: {
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1
  },
  milliseconds: {
    day: 86400000,
    hour: 3600000,
    minute: 60000,
    second: 1000,
    millisecond: 1
  }
}

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

/**
 * Creates a generic Retry Operation that resolves until it is succesful.
 * Useful for hitting an outside API with exponential backing off.
 * 
 * @param operation - Function to call until succesful
 * @param retries - Number of times to retry Function call
 * @returns A promise that is the operation response sent in
 */
export const retryOperation = async (operation: () => Promise<any>, retries = MAX_RETRIES): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        const err = error as Error;
        // Check for rate limiting errors specifically
        if (err.message.includes('rate limit') || err.message.includes('429')) {
          logger.warning(`Rate limit hit, waiting longer before retry...`);
          await delay(RETRY_DELAY * Math.pow(2, i)); // Exponential backoff
        } else if (i === retries - 1) {
          throw error;
        } else {
          logger.warning(`Operation failed, retrying in ${RETRY_DELAY}ms... ${err.message}`);
          await delay(RETRY_DELAY);
        }
      }
    }
    throw new Error('Operation failed after max retries');
  }

/**
 * Ensures that a string is formatted as a hexadecimal string with a "0x" prefix.
 * If the input already starts with "0x", it is returned unchanged.
 * 
 * @param s - The string to format as a hex string
 * @returns A hex string starting with "0x"
 */
export const toHexString = (s: string | undefined): `0x${string}` | undefined => {
  if (!s) {
    return;
  }
  return (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`;
};
