/**
 * Webhook routes.
 * 
 * Two sections:
 * 1. MANAGEMENT ROUTES (authenticated) — CRUD for inbound + outbound webhooks
 * 2. INGESTION ROUTES (unauthenticated) — receives external payloads for WebhookSource
 * 
 * Multi-tenant isolation:
 * - Management routes require Privy auth, scoped to user's own webhooks
 * - Ingestion route validates X-Webhook-Secret header per webhook endpoint
 * 
 * @module routes/v1/webhooks
 */

import { Router, Request, Response } from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { logger } from '../../helpers/cliHelper';
import { requireAuth, AuthenticatedRequest } from '../../middleware/authMiddleware';
import { webhookService, WebhookEventType } from '../../services/webhookService';
import { webhookIngestionRateLimiter } from '../../middleware/rateLimitMiddleware';

const router = Router();

/**
 * Payload size limit for webhook ingestion (1 MB).
 * The global body parser allows 10 MB, but webhook payloads should be smaller.
 */
const WEBHOOK_PAYLOAD_LIMIT = '1mb';
const webhookBodyParser = bodyParser.json({ limit: WEBHOOK_PAYLOAD_LIMIT });

// ============================================
// HELPERS
// ============================================

/**
 * Attempt to get the database service.
 * Returns null if platform database is not initialized (CLI mode).
 */
function getDatabaseService(): any {
  try {
    const dbService = require('../../services/databaseService');
    return dbService.databaseService || dbService;
  } catch {
    return null;
  }
}

/** Valid outbound event types */
const VALID_EVENTS: WebhookEventType[] = ['job.completed', 'job.failed', 'job.started', 'job.cancelled'];

// ============================================
// MANAGEMENT ROUTES (Authenticated)
// ============================================

/**
 * GET /api/v1/webhooks/manage/inbound
 * 
 * List all inbound webhook endpoints for the authenticated user's configs.
 */
router.get('/manage/inbound', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const webhooks = await webhookService.listInboundWebhooks(req.user.id);
    res.json({ webhooks });
  } catch (error: any) {
    logger.error('Webhooks: Error listing inbound webhooks', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/v1/webhooks/manage/inbound/:configId
 * 
 * List inbound webhook endpoints for a specific config.
 */
router.get('/manage/inbound/:configId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Verify ownership
    const db = getDatabaseService();
    if (!db) return res.status(503).json({ error: 'Service unavailable' });

    const configCheck = await db.query(
      'SELECT id FROM configs WHERE id = $1 AND user_id = $2',
      [req.params.configId, req.user.id]
    );
    if (!configCheck.rows.length) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const webhooks = await webhookService.getInboundWebhooksForConfig(req.params.configId);
    res.json({ webhooks });
  } catch (error: any) {
    logger.error('Webhooks: Error listing inbound webhooks for config', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/v1/webhooks/manage/inbound
 * 
 * Create a new inbound webhook endpoint for a config.
 * Body: { configId: string, sourceName?: string }
 */
router.post('/manage/inbound', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { configId, sourceName } = req.body;
    if (!configId) return res.status(400).json({ error: 'configId is required' });

    // Verify ownership
    const db = getDatabaseService();
    if (!db) return res.status(503).json({ error: 'Service unavailable' });

    const configCheck = await db.query(
      'SELECT id FROM configs WHERE id = $1 AND user_id = $2',
      [configId, req.user.id]
    );
    if (!configCheck.rows.length) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const webhook = await webhookService.createInboundWebhook(configId, sourceName);
    res.status(201).json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error creating inbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * DELETE /api/v1/webhooks/manage/inbound/:id
 * 
 * Delete an inbound webhook endpoint.
 */
router.delete('/manage/inbound/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const deleted = await webhookService.deleteInboundWebhook(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Webhooks: Error deleting inbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/v1/webhooks/manage/inbound/:id/rotate
 * 
 * Rotate the secret for an inbound webhook.
 */
router.post('/manage/inbound/:id/rotate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const webhook = await webhookService.rotateInboundWebhookSecret(req.params.id, req.user.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error rotating inbound webhook secret', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// --- OUTBOUND WEBHOOK MANAGEMENT ---

/**
 * GET /api/v1/webhooks/manage/outbound
 * 
 * List all outbound webhook subscriptions for the authenticated user.
 */
router.get('/manage/outbound', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const webhooks = await webhookService.listOutboundWebhooks(req.user.id);

    // Strip signing secrets from response
    const sanitized = webhooks.map((wh) => ({
      ...wh,
      signingSecret: undefined,
      signingSecretPreview: wh.signingSecret.slice(0, 8) + '...',
    }));

    res.json({ webhooks: sanitized });
  } catch (error: any) {
    logger.error('Webhooks: Error listing outbound webhooks', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/v1/webhooks/manage/outbound/:id
 * 
 * Get a single outbound webhook (with full signing secret).
 */
router.get('/manage/outbound/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const webhook = await webhookService.getOutboundWebhook(req.params.id, req.user.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error getting outbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/v1/webhooks/manage/outbound
 * 
 * Create an outbound webhook subscription.
 * Body: { url: string, configId?: string, events?: string[], description?: string }
 */
router.post('/manage/outbound', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { url, configId, events, description } = req.body;

    // Validate URL
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'url must be http or https' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Validate events
    if (events) {
      if (!Array.isArray(events) || events.some((e: string) => !VALID_EVENTS.includes(e as WebhookEventType))) {
        return res.status(400).json({
          error: `Invalid events. Valid events: ${VALID_EVENTS.join(', ')}`,
        });
      }
    }

    // If configId is provided, verify ownership
    if (configId) {
      const db = getDatabaseService();
      if (!db) return res.status(503).json({ error: 'Service unavailable' });

      const configCheck = await db.query(
        'SELECT id FROM configs WHERE id = $1 AND user_id = $2',
        [configId, req.user.id]
      );
      if (!configCheck.rows.length) {
        return res.status(404).json({ error: 'Config not found' });
      }
    }

    // Limit: max 10 outbound webhooks per user
    const existing = await webhookService.listOutboundWebhooks(req.user.id);
    if (existing.length >= 10) {
      return res.status(400).json({ error: 'Maximum of 10 outbound webhooks per user' });
    }

    const webhook = await webhookService.createOutboundWebhook({
      userId: req.user.id,
      configId,
      url,
      events: events as WebhookEventType[],
      description,
    });

    res.status(201).json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error creating outbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * PATCH /api/v1/webhooks/manage/outbound/:id
 * 
 * Update an outbound webhook.
 * Body: { url?, events?, isActive?, description? }
 */
router.patch('/manage/outbound/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { url, events, isActive, description } = req.body;

    // Validate URL if provided
    if (url !== undefined) {
      if (typeof url !== 'string') return res.status(400).json({ error: 'url must be a string' });
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'url must be http or https' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
    }

    // Validate events if provided
    if (events !== undefined) {
      if (!Array.isArray(events) || events.some((e: string) => !VALID_EVENTS.includes(e as WebhookEventType))) {
        return res.status(400).json({
          error: `Invalid events. Valid events: ${VALID_EVENTS.join(', ')}`,
        });
      }
    }

    const webhook = await webhookService.updateOutboundWebhook(req.params.id, req.user.id, {
      url,
      events: events as WebhookEventType[],
      isActive,
      description,
    });

    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error updating outbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * DELETE /api/v1/webhooks/manage/outbound/:id
 * 
 * Delete an outbound webhook subscription.
 */
router.delete('/manage/outbound/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const deleted = await webhookService.deleteOutboundWebhook(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Webhooks: Error deleting outbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/v1/webhooks/manage/outbound/:id/rotate
 * 
 * Rotate the signing secret for an outbound webhook.
 */
router.post('/manage/outbound/:id/rotate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const webhook = await webhookService.rotateOutboundWebhookSecret(req.params.id, req.user.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    res.json({ webhook });
  } catch (error: any) {
    logger.error('Webhooks: Error rotating outbound webhook secret', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /api/v1/webhooks/manage/outbound/:id/test
 * 
 * Send a test ping to an outbound webhook endpoint.
 */
router.post('/manage/outbound/:id/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const result = await webhookService.testOutboundWebhook(req.params.id, req.user.id);
    res.json(result);
  } catch (error: any) {
    logger.error('Webhooks: Error testing outbound webhook', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * GET /api/v1/webhooks/manage/outbound/:id/deliveries
 * 
 * Get recent delivery logs for an outbound webhook.
 */
router.get('/manage/outbound/:id/deliveries', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const deliveries = await webhookService.getDeliveryLogs(req.params.id, req.user.id, limit);

    res.json({ deliveries });
  } catch (error: any) {
    logger.error('Webhooks: Error getting delivery logs', error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================
// INGESTION ROUTES (Unauthenticated — external webhook senders)
// ============================================

/**
 * POST /api/v1/webhooks/:webhookId
 * 
 * Receive and buffer a webhook payload.
 * No auth middleware (webhooks come from external systems).
 * Validates X-Webhook-Secret header against stored config.
 * Always returns 200 to prevent retry storms from webhook senders.
 */
router.post('/:webhookId', webhookIngestionRateLimiter, webhookBodyParser, async (req: Request, res: Response) => {
  const { webhookId } = req.params;

  // Skip ingestion if this matches a management route prefix
  if (webhookId === 'manage') return;

  const secret = req.headers['x-webhook-secret'] as string;
  const contentType = req.headers['content-type'] || 'application/json';

  try {
    const db = getDatabaseService();
    if (!db) {
      logger.error('Webhooks: Database service not available');
      return res.status(503).json({ error: 'Service unavailable' });
    }

    // Validate webhook secret
    let configResult;
    try {
      configResult = await db.query(
        'SELECT webhook_secret FROM webhook_configs WHERE webhook_id = $1',
        [webhookId]
      );
    } catch (dbErr: any) {
      // Table might not exist yet (migration not run)
      logger.error('Webhooks: Database query failed (webhook_configs table may not exist)', dbErr.message);
      return res.status(503).json({ error: 'Webhook system not initialized' });
    }

    if (!configResult.rows || configResult.rows.length === 0) {
      logger.warn(`Webhooks: Unknown webhook ID: ${webhookId}`);
      // Still return 200 to not leak information about valid webhook IDs
      return res.sendStatus(200);
    }

    const storedSecret = configResult.rows[0].webhook_secret;
    if (!secret || !storedSecret ||
        secret.length !== storedSecret.length ||
        !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(storedSecret))) {
      logger.warn(`Webhooks: Invalid secret for webhook: ${webhookId}`);
      // Return 200 to prevent retry storms, but log the attempt
      return res.sendStatus(200);
    }

    // Buffer the payload
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const sourceIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const headers = JSON.stringify({
      'content-type': contentType,
      'user-agent': req.headers['user-agent'],
    });

    await db.query(
      `INSERT INTO webhook_buffer (webhook_id, payload, content_type, headers, source_ip, received_at)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, NOW())`,
      [webhookId, payload, contentType, headers, sourceIp]
    );

    logger.info(`Webhooks: Buffered payload for webhook: ${webhookId}`);
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error(`Webhooks: Error processing webhook ${webhookId}`, error.message);
    // Always return 200 to prevent retry storms
    res.sendStatus(200);
  }
});

/**
 * GET /api/v1/webhooks/:webhookId/status
 * 
 * Get webhook buffer status (pending count, last received).
 * Requires the webhook secret for authentication.
 */
router.get('/:webhookId/status', async (req: Request, res: Response) => {
  const { webhookId } = req.params;
  const secret = req.headers['x-webhook-secret'] as string;

  try {
    const db = getDatabaseService();
    if (!db) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    // Validate secret
    const configResult = await db.query(
      'SELECT webhook_secret FROM webhook_configs WHERE webhook_id = $1',
      [webhookId]
    );

    const storedSecretStatus = configResult.rows?.[0]?.webhook_secret;
    if (!configResult.rows?.length || !secret || !storedSecretStatus ||
        secret.length !== storedSecretStatus.length ||
        !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(storedSecretStatus))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get buffer stats
    const stats = await db.query(
      `SELECT 
        COUNT(*) FILTER (WHERE processed = FALSE) as pending_count,
        COUNT(*) FILTER (WHERE processed = TRUE) as processed_count,
        MAX(received_at) as last_received,
        MAX(processed_at) as last_processed
       FROM webhook_buffer 
       WHERE webhook_id = $1`,
      [webhookId]
    );

    const row = stats.rows[0];
    res.json({
      webhookId,
      pendingCount: parseInt(row.pending_count || '0'),
      processedCount: parseInt(row.processed_count || '0'),
      lastReceived: row.last_received,
      lastProcessed: row.last_processed,
    });
  } catch (error: any) {
    logger.error(`Webhooks: Error getting status for ${webhookId}`, error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
