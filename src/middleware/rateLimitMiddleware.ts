/**
 * Rate limiting middleware for public data and API endpoints.
 * 
 * Rate limits are applied per-IP. Monetized data is additionally gated
 * by pop402 x402 payment. These limits prevent abuse of public/free endpoints.
 */

import rateLimit from 'express-rate-limit';

/**
 * Data endpoints (context, summary, items, content, topics, stats)
 * 30 requests per minute per IP
 */
export const dataRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests to data endpoints. Please try again later.',
    retryAfterSeconds: 60,
  },
});

/**
 * Search endpoints (semantic search)
 * 10 requests per minute per IP
 */
export const searchRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many search requests. Please try again later.',
    retryAfterSeconds: 60,
  },
});

/**
 * Run/generate endpoints (trigger aggregation or generation)
 * 5 requests per minute per IP
 */
export const runRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many run requests. Please try again later.',
    retryAfterSeconds: 60,
  },
});
