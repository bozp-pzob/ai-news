/**
 * Relay Endpoints
 *
 * The hosted API acts as a zero-knowledge relay between the browser UI
 * and a user's local server. The hosted API never sees the decryption key
 * or the plaintext config — it only forwards opaque encrypted blobs.
 *
 * IMPORTANT: The target URL (local server address) is transient and MUST NOT
 * be logged, stored, or persisted anywhere.
 */

import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../../middleware/authMiddleware';

const router = Router();

// Rate limiting: simple in-memory tracker per user
const relayRateLimit = new Map<string, { count: number; resetAt: number }>();
const MAX_RELAYS_PER_HOUR = 30;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = relayRateLimit.get(userId);

  if (!entry || now > entry.resetAt) {
    relayRateLimit.set(userId, { count: 1, resetAt: now + 3600000 });
    return true;
  }

  if (entry.count >= MAX_RELAYS_PER_HOUR) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Validate that a URL is safe to relay to.
 * Blocks file://, data://, javascript:, and other non-http schemes.
 */
function isValidRelayTarget(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * POST /api/v1/relay/execute
 *
 * Forwards an encrypted config payload to a user's local server.
 * The hosted API never decrypts — it's a passthrough.
 *
 * Request body: {
 *   encrypted: string,  // base64 encrypted config
 *   iv: string,         // base64 IV
 *   tag: string,        // base64 auth tag
 *   targetUrl: string   // local server URL (NOT logged or stored)
 * }
 */
router.post('/execute', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Rate limit
    if (!checkRateLimit(req.user.id)) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Maximum ${MAX_RELAYS_PER_HOUR} relay requests per hour.`,
      });
    }

    const { encrypted, iv, tag, targetUrl } = req.body;

    // Validate payload
    if (!encrypted || !iv || !tag || !targetUrl) {
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Request must include encrypted, iv, tag, and targetUrl fields.',
      });
    }

    // Validate target URL
    if (!isValidRelayTarget(targetUrl)) {
      return res.status(400).json({
        error: 'Invalid target URL',
        message: 'Target URL must use http:// or https:// protocol.',
      });
    }

    // Forward the encrypted payload to the local server
    // DO NOT follow redirects (SSRF mitigation)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

    try {
      const response = await fetch(`${targetUrl}/api/v1/local/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted, iv, tag }),
        signal: controller.signal,
        redirect: 'error', // Do not follow redirects
      });

      clearTimeout(timeout);

      const responseData = await response.json();

      // Forward the status code and response from the local server
      return res.status(response.status).json(responseData);
    } catch (fetchError: any) {
      clearTimeout(timeout);

      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          error: 'Timeout',
          message: 'Local server did not respond within 2 minutes.',
        });
      }

      return res.status(502).json({
        error: 'Connection failed',
        message: 'Could not connect to the local server. Ensure it is running and reachable.',
      });
    }
  } catch (error: any) {
    // Generic error — never log target URL
    res.status(500).json({
      error: 'Relay failed',
      message: error.message || 'An unexpected error occurred.',
    });
  }
});

/**
 * POST /api/v1/relay/health
 *
 * Forwards a health check to the local server to verify connectivity.
 *
 * Request body: { targetUrl: string }
 */
router.post('/health', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { targetUrl } = req.body;

    if (!targetUrl || !isValidRelayTarget(targetUrl)) {
      return res.status(400).json({
        error: 'Invalid target URL',
        message: 'Target URL must use http:// or https:// protocol.',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout for health check

    try {
      const response = await fetch(`${targetUrl}/api/v1/local/health`, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
      });

      clearTimeout(timeout);

      const responseData = await response.json();
      return res.status(response.status).json(responseData);
    } catch (fetchError: any) {
      clearTimeout(timeout);

      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          error: 'Timeout',
          message: 'Local server did not respond within 10 seconds.',
        });
      }

      return res.status(502).json({
        error: 'Connection failed',
        message: 'Could not connect to the local server.',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Health check failed',
      message: error.message || 'An unexpected error occurred.',
    });
  }
});

/**
 * POST /api/v1/relay/status
 *
 * Forwards a job status request to the local server.
 *
 * Request body: { targetUrl: string, jobId: string }
 */
router.post('/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { targetUrl, jobId } = req.body;

    if (!targetUrl || !isValidRelayTarget(targetUrl)) {
      return res.status(400).json({ error: 'Invalid target URL' });
    }

    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${targetUrl}/api/v1/local/status/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
      });

      clearTimeout(timeout);

      const responseData = await response.json();
      return res.status(response.status).json(responseData);
    } catch (fetchError: any) {
      clearTimeout(timeout);

      return res.status(502).json({
        error: 'Connection failed',
        message: 'Could not connect to the local server.',
      });
    }
  } catch (error: any) {
    res.status(500).json({
      error: 'Status check failed',
      message: error.message || 'An unexpected error occurred.',
    });
  }
});

export default router;
