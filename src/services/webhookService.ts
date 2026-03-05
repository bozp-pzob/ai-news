// src/services/webhookService.ts

/**
 * Webhook service for managing inbound webhook endpoints and outbound
 * webhook notification subscriptions.
 *
 * Inbound: CRUD for webhook_configs (used by WebhookSource ingestion)
 * Outbound: CRUD for outbound_webhooks + delivery engine (job events)
 *
 * @module services/webhookService
 */

import crypto from 'crypto';
import { databaseService } from './databaseService';
import { logger } from '../helpers/cliHelper';
import { validateUrl } from '../helpers/patchrightHelper';

// ============================================
// TYPES
// ============================================

/** Supported outbound webhook event types */
export type WebhookEventType =
  | 'job.completed'
  | 'job.failed'
  | 'job.started'
  | 'job.cancelled';

/** Inbound webhook config (for WebhookSource ingestion) */
export interface InboundWebhook {
  id: string;
  webhookId: string;
  webhookSecret: string;
  configId: string | null;
  sourceName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Outbound webhook subscription */
export interface OutboundWebhook {
  id: string;
  userId: string;
  configId: string | null;
  url: string;
  events: WebhookEventType[];
  signingSecret: string;
  isActive: boolean;
  description: string | null;
  lastTriggeredAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalDeliveries: number;
  totalSuccesses: number;
  totalFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Outbound webhook delivery log entry */
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, any>;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  deliveredAt: Date;
}

/** Payload sent with outbound webhook notifications */
export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: {
    jobId: string;
    configId: string;
    configName?: string;
    status: string;
    itemsFetched?: number;
    itemsProcessed?: number;
    durationMs?: number;
    error?: string;
    aiUsage?: {
      totalCalls: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
  };
}

// ============================================
// INBOUND WEBHOOK MANAGEMENT
// ============================================

/**
 * List inbound webhook endpoints for a user's configs.
 */
async function listInboundWebhooks(userId: string): Promise<InboundWebhook[]> {
  const result = await databaseService.query(
    `SELECT wc.id, wc.webhook_id, wc.webhook_secret, wc.config_id, wc.source_name,
            wc.created_at, wc.updated_at
     FROM webhook_configs wc
     JOIN configs c ON wc.config_id = c.id
     WHERE c.user_id = $1
     ORDER BY wc.created_at DESC`,
    [userId]
  );

  return result.rows.map(mapInboundRow);
}

/**
 * Get inbound webhook endpoints for a specific config.
 */
async function getInboundWebhooksForConfig(configId: string): Promise<InboundWebhook[]> {
  const result = await databaseService.query(
    `SELECT id, webhook_id, webhook_secret, config_id, source_name,
            created_at, updated_at
     FROM webhook_configs
     WHERE config_id = $1
     ORDER BY created_at DESC`,
    [configId]
  );

  return result.rows.map(mapInboundRow);
}

/**
 * Create a new inbound webhook endpoint for a config.
 */
async function createInboundWebhook(configId: string, sourceName?: string): Promise<InboundWebhook> {
  const webhookId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  const result = await databaseService.query(
    `INSERT INTO webhook_configs (webhook_id, webhook_secret, config_id, source_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, webhook_id, webhook_secret, config_id, source_name, created_at, updated_at`,
    [webhookId, webhookSecret, configId, sourceName || null]
  );

  return mapInboundRow(result.rows[0]);
}

/**
 * Delete an inbound webhook endpoint.
 * Returns true if deleted, false if not found.
 */
async function deleteInboundWebhook(webhookDbId: string, userId: string): Promise<boolean> {
  // Ensure the user owns the config this webhook belongs to
  const result = await databaseService.query(
    `DELETE FROM webhook_configs wc
     USING configs c
     WHERE wc.id = $1
       AND wc.config_id = c.id
       AND c.user_id = $2
     RETURNING wc.id`,
    [webhookDbId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Regenerate the secret for an inbound webhook.
 */
async function rotateInboundWebhookSecret(webhookDbId: string, userId: string): Promise<InboundWebhook | null> {
  const newSecret = crypto.randomBytes(32).toString('hex');

  const result = await databaseService.query(
    `UPDATE webhook_configs wc
     SET webhook_secret = $1, updated_at = NOW()
     FROM configs c
     WHERE wc.id = $2
       AND wc.config_id = c.id
       AND c.user_id = $3
     RETURNING wc.id, wc.webhook_id, wc.webhook_secret, wc.config_id, wc.source_name,
               wc.created_at, wc.updated_at`,
    [newSecret, webhookDbId, userId]
  );

  if (!result.rows.length) return null;
  return mapInboundRow(result.rows[0]);
}

function mapInboundRow(row: any): InboundWebhook {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    webhookSecret: row.webhook_secret,
    configId: row.config_id,
    sourceName: row.source_name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ============================================
// OUTBOUND WEBHOOK MANAGEMENT
// ============================================

/**
 * List outbound webhook subscriptions for a user.
 */
async function listOutboundWebhooks(userId: string): Promise<OutboundWebhook[]> {
  const result = await databaseService.query(
    `SELECT * FROM outbound_webhooks WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(mapOutboundRow);
}

/**
 * List outbound webhook subscriptions for a specific config.
 */
async function getOutboundWebhooksForConfig(configId: string): Promise<OutboundWebhook[]> {
  const result = await databaseService.query(
    `SELECT * FROM outbound_webhooks
     WHERE config_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [configId]
  );
  return result.rows.map(mapOutboundRow);
}

/**
 * Get a single outbound webhook by ID (with ownership check).
 */
async function getOutboundWebhook(webhookId: string, userId: string): Promise<OutboundWebhook | null> {
  const result = await databaseService.query(
    `SELECT * FROM outbound_webhooks WHERE id = $1 AND user_id = $2`,
    [webhookId, userId]
  );
  if (!result.rows.length) return null;
  return mapOutboundRow(result.rows[0]);
}

/**
 * Create an outbound webhook subscription.
 */
async function createOutboundWebhook(params: {
  userId: string;
  configId?: string;
  url: string;
  events?: WebhookEventType[];
  description?: string;
}): Promise<OutboundWebhook> {
  // SSRF protection: block private/internal URLs
  const urlCheck = validateUrl(params.url);
  if (!urlCheck.valid) {
    throw new Error(`Invalid webhook URL: ${urlCheck.error}`);
  }

  const signingSecret = crypto.randomBytes(32).toString('hex');
  const events = params.events || ['job.completed', 'job.failed'];

  const result = await databaseService.query(
    `INSERT INTO outbound_webhooks (user_id, config_id, url, events, signing_secret, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [params.userId, params.configId || null, params.url, events, signingSecret, params.description || null]
  );

  return mapOutboundRow(result.rows[0]);
}

/**
 * Update an outbound webhook subscription.
 */
async function updateOutboundWebhook(
  webhookId: string,
  userId: string,
  updates: { url?: string; events?: WebhookEventType[]; isActive?: boolean; description?: string },
): Promise<OutboundWebhook | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 3; // $1 = webhookId, $2 = userId

  if (updates.url !== undefined) {
    // SSRF protection: block private/internal URLs
    const urlCheck = validateUrl(updates.url);
    if (!urlCheck.valid) {
      throw new Error(`Invalid webhook URL: ${urlCheck.error}`);
    }
    setClauses.push(`url = $${paramIndex++}`);
    values.push(updates.url);
  }
  if (updates.events !== undefined) {
    setClauses.push(`events = $${paramIndex++}`);
    values.push(updates.events);
  }
  if (updates.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive);
    // Reset consecutive failures when re-enabling
    if (updates.isActive) {
      setClauses.push('consecutive_failures = 0');
    }
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }

  if (setClauses.length === 0) return getOutboundWebhook(webhookId, userId);

  // Always update the timestamp when modifying a webhook
  setClauses.push('updated_at = NOW()');

  const result = await databaseService.query(
    `UPDATE outbound_webhooks
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [webhookId, userId, ...values]
  );

  if (!result.rows.length) return null;
  return mapOutboundRow(result.rows[0]);
}

/**
 * Delete an outbound webhook subscription.
 */
async function deleteOutboundWebhook(webhookId: string, userId: string): Promise<boolean> {
  const result = await databaseService.query(
    `DELETE FROM outbound_webhooks WHERE id = $1 AND user_id = $2 RETURNING id`,
    [webhookId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Rotate the signing secret for an outbound webhook.
 */
async function rotateOutboundWebhookSecret(webhookId: string, userId: string): Promise<OutboundWebhook | null> {
  const newSecret = crypto.randomBytes(32).toString('hex');

  const result = await databaseService.query(
    `UPDATE outbound_webhooks
     SET signing_secret = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [newSecret, webhookId, userId]
  );

  if (!result.rows.length) return null;
  return mapOutboundRow(result.rows[0]);
}

/**
 * Get recent delivery logs for an outbound webhook.
 */
async function getDeliveryLogs(
  webhookId: string,
  userId: string,
  limit = 20,
): Promise<WebhookDelivery[]> {
  const result = await databaseService.query(
    `SELECT d.* FROM outbound_webhook_deliveries d
     JOIN outbound_webhooks w ON d.webhook_id = w.id
     WHERE d.webhook_id = $1 AND w.user_id = $2
     ORDER BY d.delivered_at DESC
     LIMIT $3`,
    [webhookId, userId, limit]
  );
  return result.rows.map(mapDeliveryRow);
}

function mapOutboundRow(row: any): OutboundWebhook {
  return {
    id: row.id,
    userId: row.user_id,
    configId: row.config_id,
    url: row.url,
    events: row.events || [],
    signingSecret: row.signing_secret,
    isActive: row.is_active,
    description: row.description,
    lastTriggeredAt: row.last_triggered_at ? new Date(row.last_triggered_at) : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
    lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at) : null,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures || 0,
    totalDeliveries: row.total_deliveries || 0,
    totalSuccesses: row.total_successes || 0,
    totalFailures: row.total_failures || 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapDeliveryRow(row: any): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    payload: row.payload,
    statusCode: row.status_code,
    responseBody: row.response_body,
    error: row.error,
    durationMs: row.duration_ms,
    deliveredAt: new Date(row.delivered_at),
  };
}

// ============================================
// OUTBOUND DELIVERY ENGINE
// ============================================

/** Max consecutive failures before auto-disabling a webhook */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Timeout for outbound HTTP requests (ms) */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Max response body to store in delivery log */
const MAX_RESPONSE_BODY_LENGTH = 2048;

/**
 * Sign a webhook payload using HMAC-SHA256.
 * The signature is sent in the X-Webhook-Signature header.
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver a single webhook notification to a URL.
 * Records the attempt in the delivery log.
 * Returns true if delivery was successful (2xx status).
 */
async function deliverWebhook(
  webhook: OutboundWebhook,
  event: WebhookEventType,
  payload: WebhookPayload,
): Promise<boolean> {
  // SSRF protection at delivery time (defense in depth — URLs validated at creation,
  // but re-validate in case of DNS rebinding or if old webhooks predate the check)
  const urlCheck = validateUrl(webhook.url);
  if (!urlCheck.valid) {
    logger.warn(`WebhookService: Blocked delivery to unsafe URL ${webhook.url}: ${urlCheck.error}`);
    return false;
  }

  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr, webhook.signingSecret);
  const startTime = Date.now();

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event,
        'X-Webhook-Id': webhook.id,
        'User-Agent': 'DigitalGardener-Webhooks/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    statusCode = response.status;
    success = response.ok; // 200-299

    try {
      responseBody = await response.text();
      if (responseBody.length > MAX_RESPONSE_BODY_LENGTH) {
        responseBody = responseBody.slice(0, MAX_RESPONSE_BODY_LENGTH) + '...(truncated)';
      }
    } catch {
      // Response body read failure is non-fatal
    }
  } catch (err: any) {
    error = err.name === 'AbortError'
      ? `Timeout after ${DELIVERY_TIMEOUT_MS}ms`
      : err.message || String(err);
  }

  const durationMs = Date.now() - startTime;

  // Record delivery in log (fire-and-forget; don't block on log insert failures)
  try {
    await databaseService.query(
      `INSERT INTO outbound_webhook_deliveries
         (webhook_id, event, payload, status_code, response_body, error, duration_ms)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [webhook.id, event, payloadStr, statusCode, responseBody, error, durationMs]
    );
  } catch (logErr) {
    logger.warn('WebhookService: Failed to log delivery attempt', logErr);
  }

  // Update webhook stats
  try {
    if (success) {
      await databaseService.query(
        `UPDATE outbound_webhooks
         SET last_triggered_at = NOW(),
             last_success_at = NOW(),
             consecutive_failures = 0,
             total_deliveries = total_deliveries + 1,
             total_successes = total_successes + 1,
             last_error = NULL
         WHERE id = $1`,
        [webhook.id]
      );
    } else {
      const newFailures = webhook.consecutiveFailures + 1;
      const shouldDisable = newFailures >= MAX_CONSECUTIVE_FAILURES;

      await databaseService.query(
        `UPDATE outbound_webhooks
         SET last_triggered_at = NOW(),
             last_failure_at = NOW(),
             consecutive_failures = $2,
             total_deliveries = total_deliveries + 1,
             total_failures = total_failures + 1,
             last_error = $3,
             is_active = CASE WHEN $4 THEN FALSE ELSE is_active END
         WHERE id = $1`,
        [webhook.id, newFailures, error || `HTTP ${statusCode}`, shouldDisable]
      );

      if (shouldDisable) {
        logger.warn(`WebhookService: Auto-disabled webhook ${webhook.id} after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
      }
    }
  } catch (statsErr) {
    logger.warn('WebhookService: Failed to update webhook stats', statsErr);
  }

  return success;
}

/**
 * Fire a webhook event for a config.
 *
 * Looks up all active outbound webhooks subscribed to this event for the
 * given config (and any global webhooks for the user), then delivers
 * notifications in parallel.
 *
 * This is fire-and-forget — delivery failures are logged but don't
 * propagate errors to callers.
 */
async function fireEvent(
  event: WebhookEventType,
  payload: WebhookPayload,
  configId: string,
): Promise<void> {
  try {
    // Find all active webhooks for this config OR global (config_id IS NULL) for the config's owner
    const result = await databaseService.query(
      `SELECT ow.* FROM outbound_webhooks ow
       JOIN configs c ON (ow.config_id = c.id OR (ow.config_id IS NULL AND ow.user_id = c.user_id))
       WHERE c.id = $1
         AND ow.is_active = TRUE
         AND $2 = ANY(ow.events)`,
      [configId, event]
    );

    const webhooks: OutboundWebhook[] = result.rows.map(mapOutboundRow);

    if (webhooks.length === 0) return;

    logger.info(`WebhookService: Firing ${event} to ${webhooks.length} webhook(s) for config ${configId}`);

    // Deliver in parallel, don't await — fire and forget
    const deliveries = webhooks.map((wh) =>
      deliverWebhook(wh, event, payload).catch((err) => {
        logger.warn(`WebhookService: Delivery error for webhook ${wh.id}`, err);
        return false;
      })
    );

    // We still await all so we can log results, but we don't throw
    const results = await Promise.allSettled(deliveries);
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.length - succeeded;

    if (failed > 0) {
      logger.warn(`WebhookService: ${failed}/${results.length} deliveries failed for ${event} on config ${configId}`);
    }
  } catch (err) {
    // Top-level catch — never let webhook delivery break the caller
    logger.error('WebhookService: Error firing event', err);
  }
}

/**
 * Send a test ping to an outbound webhook.
 */
async function testOutboundWebhook(webhookId: string, userId: string): Promise<{
  success: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}> {
  const webhook = await getOutboundWebhook(webhookId, userId);
  if (!webhook) {
    return { success: false, statusCode: null, error: 'Webhook not found', durationMs: 0 };
  }

  // SSRF protection (defense in depth — same check as deliverWebhook)
  const urlCheck = validateUrl(webhook.url);
  if (!urlCheck.valid) {
    return { success: false, statusCode: null, error: `Blocked unsafe URL: ${urlCheck.error}`, durationMs: 0 };
  }

  const testPayload: WebhookPayload = {
    event: 'job.completed',
    timestamp: new Date().toISOString(),
    data: {
      jobId: '00000000-0000-0000-0000-000000000000',
      configId: webhook.configId || '00000000-0000-0000-0000-000000000000',
      configName: 'test-ping',
      status: 'completed',
      itemsFetched: 0,
      itemsProcessed: 0,
      durationMs: 0,
    },
  };

  const payloadStr = JSON.stringify(testPayload);
  const signature = signPayload(payloadStr, webhook.signingSecret);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': 'test.ping',
        'X-Webhook-Id': webhook.id,
        'User-Agent': 'DigitalGardener-Webhooks/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return {
      success: response.ok,
      statusCode: response.status,
      error: response.ok ? null : `HTTP ${response.status} ${response.statusText}`,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      success: false,
      statusCode: null,
      error: err.name === 'AbortError' ? `Timeout after ${DELIVERY_TIMEOUT_MS}ms` : err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

// ============================================
// CLEANUP
// ============================================

/**
 * Clean up old delivery logs. Call periodically (e.g. daily cron).
 */
async function cleanupDeliveryLogs(retentionDays = 30): Promise<number> {
  const result = await databaseService.query(
    `DELETE FROM outbound_webhook_deliveries
     WHERE delivered_at < NOW() - ($1 || ' days')::INTERVAL`,
    [retentionDays]
  );
  return result.rowCount ?? 0;
}

// ============================================
// EXPORTS
// ============================================

export const webhookService = {
  // Inbound (WebhookSource ingestion)
  listInboundWebhooks,
  getInboundWebhooksForConfig,
  createInboundWebhook,
  deleteInboundWebhook,
  rotateInboundWebhookSecret,

  // Outbound (notifications)
  listOutboundWebhooks,
  getOutboundWebhooksForConfig,
  getOutboundWebhook,
  createOutboundWebhook,
  updateOutboundWebhook,
  deleteOutboundWebhook,
  rotateOutboundWebhookSecret,
  getDeliveryLogs,

  // Delivery engine
  fireEvent,
  testOutboundWebhook,

  // Maintenance
  cleanupDeliveryLogs,
};
