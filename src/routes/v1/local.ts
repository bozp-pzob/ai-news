/**
 * Local Server Endpoints
 *
 * These endpoints are used when the server is running as a local instance
 * that receives encrypted configs from the hosted platform UI via the relay.
 *
 * The encryption key is generated on startup (or set via LOCAL_SERVER_KEY env var)
 * and is used to decrypt incoming config payloads.
 *
 * No auth middleware — the encryption IS the auth. Only someone with the key
 * can create a valid encrypted payload.
 */

import { Router, Request, Response } from 'express';
import { decryptPayload, EncryptedPayload } from '../../helpers/localEncryption';
import { getLocalServerKey } from '../../api';
import { AggregatorService } from '../../services/aggregatorService';
import { Config } from '../../services/configService';

const router = Router();
const aggregatorService = AggregatorService.getInstance();

/**
 * GET /api/v1/local/health
 * Public health check — confirms the local server is reachable and has a key.
 * Does not expose the key or any sensitive information.
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
        error: 'Local server key not configured',
        message: 'Set LOCAL_SERVER_KEY env var or restart the server to generate one.',
      });
    }

    const { encrypted, iv, tag } = req.body as EncryptedPayload;

    if (!encrypted || !iv || !tag) {
      return res.status(400).json({
        error: 'Invalid payload',
        message: 'Request must include encrypted, iv, and tag fields.',
      });
    }

    // Decrypt the config
    let configJson: Config;
    try {
      const plaintext = decryptPayload({ encrypted, iv, tag }, key);
      configJson = JSON.parse(plaintext);
    } catch (decryptError) {
      return res.status(401).json({
        error: 'Decryption failed',
        message: 'Invalid encryption key or tampered payload.',
      });
    }

    // Validate basic config structure
    if (!configJson.sources || !Array.isArray(configJson.sources)) {
      return res.status(400).json({
        error: 'Invalid config',
        message: 'Decrypted config must have a sources array.',
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
    console.error('[Local Execute] Error:', error.message);
    res.status(500).json({
      error: 'Execution failed',
      message: error.message || 'Failed to execute aggregation',
    });
  }
});

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

export default router;
