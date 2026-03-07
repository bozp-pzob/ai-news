/**
 * Local Server Endpoints
 *
 * These endpoints are used when the server is running as a standalone instance
 * that receives encrypted configs from the hosted platform UI via the relay.
 *
 * The encryption key is generated on startup (or set via LOCAL_SERVER_KEY env var)
 * and is used to decrypt incoming config payloads.
 *
 * No auth middleware on execution — the encryption IS the auth.
 * Data endpoints use an auto-exchanged data access token (hashed, stored in DB).
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { decryptPayload, encryptPayload, EncryptedPayload } from '../../helpers/localEncryption';
import { getLocalServerKey } from '../../api';
import { AggregatorService } from '../../services/aggregatorService';
import { Config } from '../../services/configService';
import { databaseService } from '../../services/databaseService';
import { logger } from '../../helpers/cliHelper';

const router = Router();
const aggregatorService = AggregatorService.getInstance();

// ─── Token Storage ─────────────────────────────────────────────────────────────

/** Ensure the platform_tokens table exists in the local database */
async function ensurePlatformTokensTable(): Promise<void> {
  try {
    await databaseService.query(`
      CREATE TABLE IF NOT EXISTS platform_tokens (
        id INTEGER PRIMARY KEY DEFAULT 1,
        token_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);
  } catch {
    // Table may already exist or DB not initialized — non-fatal
  }
}

/** Store a data access token hash (replaces any previous token) */
async function storeDataAccessTokenHash(tokenHash: string): Promise<void> {
  await ensurePlatformTokensTable();
  await databaseService.query(
    `INSERT INTO platform_tokens (id, token_hash, created_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET token_hash = $1, created_at = NOW()`,
    [tokenHash]
  );
}

/** Verify a data access token against the stored hash */
async function verifyDataAccessToken(token: string): Promise<boolean> {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const result = await databaseService.query(
      'SELECT 1 FROM platform_tokens WHERE token_hash = $1',
      [hash]
    );
    return result.rows?.length > 0;
  } catch {
    return false;
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Middleware: verify the X-Data-Access-Token header.
 * Token is hashed and compared against the stored hash.
 */
async function requireDataAccessToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-data-access-token'] as string;
  if (!token) {
    return res.status(401).json({
      error: 'missing_token',
      message: 'Missing X-Data-Access-Token header.',
    });
  }
  const valid = await verifyDataAccessToken(token);
  if (!valid) {
    return res.status(401).json({
      error: 'invalid_token',
      message: 'Invalid data access token.',
    });
  }
  next();
}

// ─── Health Check Endpoints ────────────────────────────────────────────────────

/**
 * GET /api/v1/local/health
 * Basic health check — confirms the local server is reachable.
 * Does NOT validate the encryption key (use POST /health with a challenge for that).
 */
router.get('/health', (_req: Request, res: Response) => {
  const key = getLocalServerKey();
  res.json({
    status: 'ok',
    version: '1.0',
    hasKey: !!key,
    mode: 'local',
  });
});

/**
 * POST /api/v1/local/health
 *
 * Crypto-challenge health check — proves the client holds the correct key.
 *
 * The client encrypts a random nonce with the shared key and sends it as an
 * EncryptedPayload ({ encrypted, iv, tag }). The server decrypts it and
 * returns the nonce in plaintext. If decryption fails the server returns 401,
 * proving the keys don't match.
 *
 * On success, also generates a data access token for future data proxy requests:
 * - Token is hashed (SHA-256) and stored in the local database
 * - The plaintext token is encrypted with the shared key and returned
 * - Only the key-holder can decrypt the encryptedToken to extract it
 *
 * If no challenge payload is provided, falls back to a basic health response.
 */
router.post('/health', async (req: Request, res: Response) => {
  const key = getLocalServerKey();

  if (!key) {
    return res.status(500).json({
      status: 'error',
      error: 'no_key',
      message: 'Local server key not configured.',
    });
  }

  const { encrypted, iv, tag } = req.body || {};

  // No challenge payload — basic health check
  if (!encrypted || !iv || !tag) {
    return res.json({
      status: 'ok',
      version: '1.0',
      hasKey: true,
      mode: 'local',
    });
  }

  // Attempt to decrypt the challenge nonce
  let nonce: string;
  try {
    nonce = decryptPayload({ encrypted, iv, tag }, key);
  } catch {
    return res.status(401).json({
      status: 'error',
      error: 'key_mismatch',
      message: 'Decryption failed — the encryption key does not match this server.',
    });
  }

  // Generate a data access token and store its hash
  const dataAccessToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(dataAccessToken).digest('hex');

  let encryptedToken: EncryptedPayload | undefined;
  try {
    await storeDataAccessTokenHash(tokenHash);
    // Encrypt the token so only the key-holder can read it
    encryptedToken = encryptPayload(dataAccessToken, key);
  } catch (err) {
    logger.warn('POST /local/health: Failed to store/encrypt data access token', err);
    // Non-fatal — health check still valid, token exchange failed
  }

  return res.json({
    status: 'ok',
    version: '1.0',
    hasKey: true,
    mode: 'local',
    nonce,
    ...(encryptedToken ? { encryptedToken } : {}),
  });
});

// ─── Execute Endpoint ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/local/execute
 * Accepts an encrypted config payload, decrypts it with the local server key,
 * and runs the aggregation.
 *
 * Request body: { encrypted: string, iv: string, tag: string }
 * Response: { jobId: string, status: 'started', message: string }
 */
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const key = getLocalServerKey();
    if (!key) {
      return res.status(500).json({
        error: 'server_not_configured',
        code: 'NO_KEY',
        message: 'Set LOCAL_SERVER_KEY env var or restart the server to generate one.',
      });
    }

    const { encrypted, iv, tag } = req.body as EncryptedPayload;

    if (!encrypted || !iv || !tag) {
      return res.status(400).json({
        error: 'invalid_payload',
        code: 'MISSING_FIELDS',
        message: 'Request must include encrypted, iv, and tag fields.',
      });
    }

    // Decrypt the config — separate decrypt and parse for distinct error codes
    let configJson: Config;
    try {
      const plaintext = decryptPayload({ encrypted, iv, tag }, key);
      try {
        configJson = JSON.parse(plaintext);
      } catch {
        return res.status(400).json({
          error: 'invalid_payload',
          code: 'PARSE_FAILED',
          message: 'Decrypted data is not valid JSON. The payload may be corrupted.',
        });
      }
    } catch {
      return res.status(401).json({
        error: 'decryption_failed',
        code: 'KEY_MISMATCH',
        message: 'Decryption failed — the encryption key does not match or the payload was tampered with.',
      });
    }

    // Validate basic config structure
    if (!configJson.sources || !Array.isArray(configJson.sources)) {
      return res.status(400).json({
        error: 'invalid_config',
        code: 'MISSING_SOURCES',
        message: 'Decrypted config must contain a "sources" array.',
      });
    }

    // Extract runtime settings
    const configName = (configJson as any).name || 'local-run';
    const runOnce = configJson.settings?.runOnce !== false; // Default to true for local runs

    const runtimeSettings = {
      runOnce,
      onlyGenerate: configJson.settings?.onlyGenerate === true,
      onlyFetch: configJson.settings?.onlyFetch === true,
    };

    // Run the aggregation
    // Secrets are already resolved (the UI injected them before encrypting)
    const secrets = {};
    const jobId = await aggregatorService.runAggregationOnce(
      configName,
      configJson,
      runtimeSettings,
      secrets
    );

    res.json({
      jobId,
      status: 'started',
      message: 'Aggregation started successfully on local server',
    });
  } catch (error: any) {
    // Never log config contents or decrypted data in errors
    logger.error('Local Execute: Error', error.message);
    res.status(500).json({
      error: 'execution_failed',
      code: 'INTERNAL_ERROR',
      message: error.message || 'Failed to execute aggregation',
    });
  }
});

// ─── Job Status Endpoint ───────────────────────────────────────────────────────

/**
 * GET /api/v1/local/status/:jobId
 * Get the status of a running or completed job.
 */
router.get('/status/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const jobStatus = aggregatorService.getJobStatus(jobId);

  if (!jobStatus) {
    return res.status(404).json({
      error: 'Job not found',
      message: `No job found with ID: ${jobId}`,
    });
  }

  res.json(jobStatus);
});

// ─── Data Proxy Endpoints ──────────────────────────────────────────────────────
//
// These endpoints are called by the hosted platform to fetch data from the
// standalone backend's local database. They are protected by the auto-exchanged
// data access token (X-Data-Access-Token header).

/**
 * Helper: get a PostgresStorage instance for the given configId.
 * Uses the platform database pool (which, on a standalone backend,
 * points to the user's own database).
 */
async function getStorageForLocalConfig(configId: string) {
  const storage = databaseService.getPlatformStorage(configId);
  await storage.init();
  return storage;
}

/**
 * GET /api/v1/local/data/:configId/items
 * Returns content items from local storage.
 * Query params: after (epoch), before (epoch), limit, offset, source, type
 */
router.get('/data/:configId/items', requireDataAccessToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const {
      after, before,
      limit: limitStr = '100',
      offset: offsetStr = '0',
      source,
      type,
    } = req.query;

    const storage = await getStorageForLocalConfig(configId);
    const startEpoch = after ? parseInt(after as string, 10) : 0;
    const endEpoch = before ? parseInt(before as string, 10) : Math.floor(Date.now() / 1000);

    const items = await storage.getContentItemsBetweenEpoch(startEpoch, endEpoch, type as string | undefined);

    // Apply source filter
    let filtered = items;
    if (source) {
      filtered = filtered.filter((i: any) => i.source === source);
    }

    const total = filtered.length;
    const limitNum = Math.min(parseInt(limitStr as string, 10) || 100, 500);
    const offsetNum = parseInt(offsetStr as string, 10) || 0;
    const paged = filtered.slice(offsetNum, offsetNum + limitNum);

    res.json({ items: paged, total, limit: limitNum, offset: offsetNum });
  } catch (error: any) {
    logger.error('Local Data: Failed to fetch items', error.message);
    res.status(500).json({ error: 'Failed to fetch items', message: error.message });
  }
});

/**
 * GET /api/v1/local/data/:configId/content
 * Returns summaries/content from local storage.
 * Query params: after (epoch), before (epoch), limit, offset
 */
router.get('/data/:configId/content', requireDataAccessToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const {
      after, before,
      limit: limitStr = '50',
      offset: offsetStr = '0',
    } = req.query;

    const storage = await getStorageForLocalConfig(configId);
    const startEpoch = after ? parseInt(after as string, 10) : 0;
    const endEpoch = before ? parseInt(before as string, 10) : Math.floor(Date.now() / 1000);

    const summaries = await storage.getSummaryBetweenEpoch(startEpoch, endEpoch);

    const total = summaries.length;
    const limitNum = Math.min(parseInt(limitStr as string, 10) || 50, 200);
    const offsetNum = parseInt(offsetStr as string, 10) || 0;
    const paged = summaries.slice(offsetNum, offsetNum + limitNum);

    res.json({ content: paged, total, limit: limitNum, offset: offsetNum });
  } catch (error: any) {
    logger.error('Local Data: Failed to fetch content', error.message);
    res.status(500).json({ error: 'Failed to fetch content', message: error.message });
  }
});

/**
 * GET /api/v1/local/data/:configId/summary
 * Returns the latest daily summary.
 */
router.get('/data/:configId/summary', requireDataAccessToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const storage = await getStorageForLocalConfig(configId);

    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const summaries = await storage.getSummaryBetweenEpoch(weekAgo, now);

    if (summaries.length === 0) {
      return res.json({ summary: null });
    }

    // Return the most recent summary
    const latest = summaries.sort((a: any, b: any) => (b.date || 0) - (a.date || 0))[0];
    res.json({ summary: latest });
  } catch (error: any) {
    logger.error('Local Data: Failed to fetch summary', error.message);
    res.status(500).json({ error: 'Failed to fetch summary', message: error.message });
  }
});

/**
 * GET /api/v1/local/data/:configId/topics
 * Returns topic distribution from recent items.
 */
router.get('/data/:configId/topics', requireDataAccessToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const storage = await getStorageForLocalConfig(configId);

    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const items = await storage.getContentItemsBetweenEpoch(weekAgo, now);

    // Aggregate topics
    const topicCounts: Record<string, number> = {};
    for (const item of items) {
      if ((item as any).topics) {
        for (const topic of (item as any).topics) {
          topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        }
      }
    }

    const topics = Object.entries(topicCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ topics });
  } catch (error: any) {
    logger.error('Local Data: Failed to fetch topics', error.message);
    res.status(500).json({ error: 'Failed to fetch topics', message: error.message });
  }
});

/**
 * GET /api/v1/local/data/:configId/stats
 * Returns basic stats for the config.
 */
router.get('/data/:configId/stats', requireDataAccessToken, async (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const storage = await getStorageForLocalConfig(configId);

    const now = Math.floor(Date.now() / 1000);
    const items = await storage.getContentItemsBetweenEpoch(0, now);
    const summaries = await storage.getSummaryBetweenEpoch(0, now);

    const sources = [...new Set(items.map((i: any) => i.source))];
    const dateRange = items.length > 0
      ? {
          earliest: Math.min(...items.map((i: any) => i.date || 0)),
          latest: Math.max(...items.map((i: any) => i.date || 0)),
        }
      : null;

    res.json({
      totalItems: items.length,
      totalSummaries: summaries.length,
      sources,
      dateRange,
    });
  } catch (error: any) {
    logger.error('Local Data: Failed to fetch stats', error.message);
    res.status(500).json({ error: 'Failed to fetch stats', message: error.message });
  }
});

export default router;
