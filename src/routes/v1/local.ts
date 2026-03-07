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

// ─── In-Memory Job Tracking ────────────────────────────────────────────────────
// runAggregationOnce creates short (non-UUID) job IDs and uses event emitters,
// but getJobStatus only handles UUID-length IDs. We track short-ID jobs here
// so the /status/:jobId endpoint can return their status to the platform.

interface LocalJobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

const localJobs = new Map<string, LocalJobStatus>();

// Clean up old jobs after 1 hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [id, job] of localJobs) {
    if (new Date(job.startedAt).getTime() < oneHourAgo) {
      localJobs.delete(id);
    }
  }
}, 600000); // Clean every 10 minutes

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
    const decrypted = decryptPayload({ encrypted, iv, tag }, key);
    // The client encrypts JSON.stringify({ nonce }), so we need to parse it
    try {
      const parsed = JSON.parse(decrypted);
      nonce = parsed.nonce ?? decrypted;
    } catch {
      // If parsing fails, the client may have sent the raw nonce string
      nonce = decrypted;
    }
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
    // Encrypt the token as JSON so the key-holder can parse it
    encryptedToken = encryptPayload(JSON.stringify({ token: dataAccessToken }), key);
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

    // Resolve platform AI references against local environment.
    // On the platform, configs with usePlatformAI get the platform's OPENAI_API_KEY
    // injected before execution. On a standalone backend, we inject the local
    // server's own key from process.env instead.
    if (configJson.ai && Array.isArray(configJson.ai)) {
      const localApiKey = process.env.OPENAI_API_KEY;
      const useOpenRouter = process.env.USE_OPENROUTER === 'true';

      configJson.ai = configJson.ai.map((ai: any) => {
        if (ai.params?.usePlatformAI || ai.params?.apiKey === 'platform-injected') {
          if (!localApiKey) {
            logger.warn('Local Execute: Config uses platform AI but OPENAI_API_KEY is not set in local .env');
          }
          return {
            ...ai,
            params: {
              ...ai.params,
              apiKey: localApiKey,
              usePlatformAI: false,
              useOpenRouter: useOpenRouter || ai.params?.useOpenRouter,
            },
          };
        }
        return ai;
      });
    }

    // Resolve platform storage references against local environment.
    // On the platform, configs with usePlatformStorage get the platform's DATABASE_URL
    // injected along with a configId for multi-tenant isolation.
    // On a standalone backend, we inject the local DATABASE_URL and use the
    // platform configId sent by the frontend (_configId) for consistent storage partitioning.
    if (configJson.storage && Array.isArray(configJson.storage)) {
      const localDbUrl = process.env.DATABASE_URL;

      // Use the platform configId sent by the frontend, or fall back to a
      // deterministic hash of the config name for backward compatibility.
      const platformConfigId = (configJson as any)._configId;
      const fallbackConfigId = (() => {
        const name = (configJson as any).name || 'local-config';
        const hash = crypto.createHash('sha256').update(name).digest('hex');
        return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16),
                hash.slice(16, 20), hash.slice(20, 32)].join('-');
      })();
      const storageConfigId = platformConfigId || fallbackConfigId;

      configJson.storage = configJson.storage.map((storage: any) => {
        // Convert SQLiteStorage to PostgresStorage if we have a DATABASE_URL
        if (storage.type === 'SQLiteStorage' && localDbUrl) {
          return {
            ...storage,
            type: 'PostgresStorage',
            params: {
              ...storage.params,
              configId: storage.params?.configId || storageConfigId,
              connectionString: localDbUrl,
              usePlatformStorage: false,
            },
          };
        }
        if (storage.params?.usePlatformStorage || !storage.params?.configId) {
          if (!localDbUrl) {
            logger.warn('Local Execute: Config uses platform storage but DATABASE_URL is not set in local .env');
          }
          return {
            ...storage,
            params: {
              ...storage.params,
              configId: storage.params?.configId || storageConfigId,
              connectionString: localDbUrl || storage.params?.connectionString,
              usePlatformStorage: false,
            },
          };
        }
        return storage;
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

    // Track the job in memory so /status/:jobId can report on it
    localJobs.set(jobId, {
      jobId,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    // Listen for job completion/failure events from the aggregator
    const onJobUpdate = (jobStatus: any) => {
      const tracked = localJobs.get(jobId);
      if (!tracked) return;

      if (jobStatus.status === 'completed' || jobStatus.status === 'complete') {
        tracked.status = 'completed';
        tracked.completedAt = new Date().toISOString();
        tracked.progress = 100;
      } else if (jobStatus.status === 'failed' || jobStatus.status === 'error') {
        tracked.status = 'failed';
        tracked.completedAt = new Date().toISOString();
        tracked.error = jobStatus.error || jobStatus.errorMessage;
      } else {
        tracked.status = 'running';
        tracked.progress = jobStatus.progress;
      }
    };
    aggregatorService.on(`job:${jobId}`, onJobUpdate);

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
 * Checks the in-memory localJobs map first (for short-ID jobs from runAggregationOnce),
 * then falls back to the aggregator service (for UUID-based DB jobs).
 */
router.get('/status/:jobId', async (req: Request, res: Response) => {
  const jobId = req.params.jobId;

  // Check in-memory tracking first (short-ID jobs)
  const localJob = localJobs.get(jobId);
  if (localJob) {
    return res.json(localJob);
  }

  // Fall back to aggregator service (UUID-based DB jobs)
  const jobStatus = await aggregatorService.getJobStatus(jobId);

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
