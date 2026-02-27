/**
 * Webhook endpoint routes.
 * 
 * Provides a generic webhook ingestion endpoint that receives external
 * HTTP payloads and buffers them for consumption by WebhookSource.
 * 
 * Multi-tenant isolation:
 * - Each WebhookSource config gets a unique webhookId + webhookSecret pair
 * - POST /webhooks/:webhookId validates the secret via X-Webhook-Secret header
 * - Payloads are stored in webhook_buffer table, scoped by webhook_id
 * - WebhookSource.fetchItems() only reads its own webhook_id's data
 * 
 * @module routes/v1/webhooks
 */

import { Router, Request, Response } from 'express';

const router = Router();

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

/**
 * POST /api/v1/webhooks/:webhookId
 * 
 * Receive and buffer a webhook payload.
 * No auth middleware (webhooks come from external systems).
 * Validates X-Webhook-Secret header against stored config.
 * Always returns 200 to prevent retry storms from webhook senders.
 */
router.post('/:webhookId', async (req: Request, res: Response) => {
  const { webhookId } = req.params;
  const secret = req.headers['x-webhook-secret'] as string;
  const contentType = req.headers['content-type'] || 'application/json';

  try {
    const db = getDatabaseService();
    if (!db) {
      console.error('[Webhooks] Database service not available');
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
      console.error('[Webhooks] Database query failed (webhook_configs table may not exist):', dbErr.message);
      return res.status(503).json({ error: 'Webhook system not initialized' });
    }

    if (!configResult.rows || configResult.rows.length === 0) {
      console.warn(`[Webhooks] Unknown webhook ID: ${webhookId}`);
      // Still return 200 to not leak information about valid webhook IDs
      return res.sendStatus(200);
    }

    const storedSecret = configResult.rows[0].webhook_secret;
    if (!secret || secret !== storedSecret) {
      console.warn(`[Webhooks] Invalid secret for webhook: ${webhookId}`);
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

    console.log(`[Webhooks] Buffered payload for webhook: ${webhookId}`);
    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error(`[Webhooks] Error processing webhook ${webhookId}:`, error.message);
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

    if (!configResult.rows?.length || configResult.rows[0].webhook_secret !== secret) {
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
    console.error(`[Webhooks] Error getting status for ${webhookId}:`, error.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
