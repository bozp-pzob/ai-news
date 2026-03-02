// src/middleware/apiUsageMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { databaseService } from '../services/databaseService';

/**
 * Paths to exclude from API usage tracking.
 * These are high-frequency polling endpoints or internal health checks
 * that would generate noise rather than useful analytics.
 */
const EXCLUDED_PATHS = [
  '/health',
  '/admin/stats',
  '/admin/stats/usage',
];

/**
 * Extract a config ID from the request path if present.
 * Matches patterns like /configs/:uuid/... where uuid is a valid UUID v4.
 */
const CONFIG_ID_REGEX = /\/configs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function extractConfigId(path: string): string | null {
  const match = path.match(CONFIG_ID_REGEX);
  return match ? match[1] : null;
}

/**
 * Express middleware that tracks API requests by inserting into the api_usage table.
 * 
 * Designed to be non-blocking: the INSERT is fire-and-forget so it never
 * slows down the actual request. Errors are silently logged.
 * 
 * Should be mounted on the /api/v1 router before route handlers.
 */
export function apiUsageMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip excluded paths
  const path = req.path;
  if (EXCLUDED_PATHS.some(excluded => path === excluded || path.startsWith(excluded))) {
    return next();
  }

  // Skip non-API methods (OPTIONS preflight, etc.)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const startTime = Date.now();

  // Hook into the response finish event to capture status code and timing
  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Extract data from request
    const userId = (req as any).user?.id || null;
    const configId = extractConfigId(path);
    const walletAddress = (req as any).user?.walletAddress || null;
    const method = req.method;
    const endpoint = path;
    const ipAddress = req.ip || req.socket?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    // Build query params (only if present, to save storage)
    const queryParams = Object.keys(req.query).length > 0 
      ? JSON.stringify(req.query) 
      : null;

    // Fire-and-forget insert — don't await, don't block the response
    databaseService.query(
      `INSERT INTO api_usage (
        config_id, user_id, wallet_address, endpoint, method,
        query_params, status_code, response_time_ms, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        configId,
        userId,
        walletAddress,
        endpoint,
        method,
        queryParams,
        statusCode,
        responseTimeMs,
        ipAddress,
        userAgent,
      ]
    ).catch(err => {
      // Silent fail — API usage tracking should never break the app
      if (process.env.NODE_ENV === 'development') {
        console.warn('[API Usage] Failed to track request:', err.message);
      }
    });
  });

  next();
}
