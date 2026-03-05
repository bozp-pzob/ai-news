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

/**
 * Config creation/mutation endpoints
 * 10 requests per hour per IP
 */
export const configMutationRateLimiter = rateLimit({
  windowMs: 3_600_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many config creation requests. Please try again later.',
    retryAfterSeconds: 3600,
  },
});

/**
 * Admin endpoints
 * 60 requests per minute per IP
 */
export const adminRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many admin requests. Please try again later.',
    retryAfterSeconds: 60,
  },
});

/**
 * Webhook ingestion endpoints
 * 120 requests per minute per IP (webhooks can be bursty)
 */
export const webhookIngestionRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Always return 200 to prevent retry storms from external webhook senders
  handler: (_req, res) => {
    res.status(200).json({ received: true, throttled: true });
  },
});
