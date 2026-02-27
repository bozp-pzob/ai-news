/**
 * Push-based data source that receives external HTTP webhook payloads.
 * 
 * External systems POST data to a unique webhook URL. Payloads are buffered
 * in a database table and consumed during aggregation via fetchItems().
 * 
 * Multi-tenant isolation:
 * - Each source instance gets a unique webhookId + webhookSecret pair
 * - The webhook endpoint validates the secret before buffering
 * - fetchItems() only reads rows matching its own webhookId
 * 
 * Supports two modes:
 * - CLI mode (SQLite): buffer table created via storage.getDb()
 * - Platform mode (Postgres): buffer table created via migration
 * 
 * @module plugins/sources/WebhookSource
 */

import { ContentSource } from './ContentSource';
import { AiProvider, ContentItem } from '../../types';
import { StoragePlugin } from '../storage/StoragePlugin';
import { extractReadableContent, extractPageContent } from '../../helpers/htmlHelper';
import crypto from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

interface WebhookSourceConfig {
  name: string;
  /** Unique webhook endpoint ID (auto-generated UUID) */
  webhookId: string;
  /** Secret token for webhook authentication */
  webhookSecret: string;
  /** Expected payload format: json, html, or text (default: json) */
  payloadType?: 'json' | 'html' | 'text';
  /** JSON mapping for extracting ContentItem fields from payload */
  payloadMapping?: string;
  /** AI provider for structured extraction from HTML/text payloads */
  provider?: AiProvider | string;
  /** Days to keep processed webhook data (default: 30) */
  bufferTTLDays?: number;
  /** Storage plugin for buffer table access */
  storage?: StoragePlugin | string;
}

interface PayloadMapping {
  title?: string;
  text?: string;
  link?: string;
  date?: string;
  type?: string;
  [key: string]: string | undefined;
}

// ============================================
// SOURCE PLUGIN
// ============================================

export class WebhookSource implements ContentSource {
  public name: string;
  private webhookId: string;
  private webhookSecret: string;
  private payloadType: 'json' | 'html' | 'text';
  private payloadMapping: PayloadMapping | undefined;
  private provider: AiProvider | undefined;
  private bufferTTLDays: number;
  private storage: StoragePlugin | string | undefined;
  private initialized: boolean = false;

  static description = 'Receives data via webhook HTTP endpoint with buffered storage';

  static constructorInterface = {
    parameters: [
      {
        name: 'webhookId',
        type: 'string',
        required: true,
        description: 'Unique webhook endpoint ID (auto-generated UUID)',
      },
      {
        name: 'webhookSecret',
        type: 'string',
        required: true,
        description: 'Secret token for webhook authentication',
        secret: true,
      },
      {
        name: 'payloadType',
        type: 'string',
        required: false,
        description: 'Expected payload format: json, html, or text (default: json)',
      },
      {
        name: 'payloadMapping',
        type: 'string',
        required: false,
        description: 'JSON mapping: {"title":"$.headline","text":"$.body","link":"$.url"}',
      },
      {
        name: 'provider',
        type: 'object',
        required: false,
        description: 'AI provider for structured extraction from HTML/text payloads',
      },
      {
        name: 'bufferTTLDays',
        type: 'number',
        required: false,
        description: 'Days to keep processed webhook data (default: 30)',
      },
      {
        name: 'storage',
        type: 'object',
        required: true,
        description: 'Storage plugin for buffer table access',
      },
    ],
  };

  constructor(config: WebhookSourceConfig) {
    this.name = config.name;
    this.webhookId = config.webhookId;
    this.webhookSecret = config.webhookSecret;
    this.payloadType = config.payloadType || 'json';
    this.bufferTTLDays = config.bufferTTLDays ?? 30;
    this.storage = config.storage;

    // Parse payload mapping if provided as string
    if (config.payloadMapping) {
      try {
        this.payloadMapping = JSON.parse(config.payloadMapping) as PayloadMapping;
      } catch {
        console.warn(`[WebhookSource:${this.name}] Invalid payloadMapping JSON, ignoring`);
      }
    }

    // AI provider (may be injected as string name by configHelper, resolved later)
    if (config.provider && typeof config.provider !== 'string') {
      this.provider = config.provider;
    }
  }

  /**
   * Initialize the buffer table in SQLite (CLI mode).
   * In platform mode (Postgres), the table is created by the migration.
   */
  private async ensureBufferTable(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Only create table for SQLite storage (CLI mode)
    if (this.storage && typeof this.storage !== 'string') {
      try {
        const db = this.storage.getDb();
        if (db && db.exec) {
          // SQLite mode
          await db.exec(`
            CREATE TABLE IF NOT EXISTS webhook_buffer (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              webhook_id TEXT NOT NULL,
              payload TEXT NOT NULL,
              content_type TEXT,
              headers TEXT,
              source_ip TEXT,
              received_at INTEGER NOT NULL,
              processed INTEGER DEFAULT 0,
              processed_at INTEGER
            )
          `);
          await db.exec(`
            CREATE INDEX IF NOT EXISTS idx_webhook_buffer_pending 
            ON webhook_buffer(webhook_id, processed)
          `);

          // Also create webhook_configs for CLI mode
          await db.exec(`
            CREATE TABLE IF NOT EXISTS webhook_configs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              webhook_id TEXT NOT NULL UNIQUE,
              webhook_secret TEXT NOT NULL,
              config_id TEXT,
              source_name TEXT,
              created_at INTEGER DEFAULT (strftime('%s', 'now')),
              updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
          `);

          // Register this webhook config
          await db.run(
            `INSERT OR REPLACE INTO webhook_configs (webhook_id, webhook_secret, source_name) 
             VALUES (?, ?, ?)`,
            [this.webhookId, this.webhookSecret, this.name]
          );
        }
      } catch (err: any) {
        console.warn(`[WebhookSource:${this.name}] Failed to create buffer table:`, err.message);
      }
    }

    // Register webhook config in platform database if available
    try {
      const dbService = require('../../services/databaseService');
      if (dbService.query) {
        await dbService.query(
          `INSERT INTO webhook_configs (webhook_id, webhook_secret, source_name) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (webhook_id) DO UPDATE SET 
             webhook_secret = EXCLUDED.webhook_secret,
             source_name = EXCLUDED.source_name,
             updated_at = NOW()`,
          [this.webhookId, this.webhookSecret, this.name]
        );
      }
    } catch {
      // Platform DB not available (CLI mode with SQLite) -- that's fine
    }
  }

  /**
   * Fetch buffered webhook payloads and convert to ContentItems.
   * 
   * Reads all unprocessed rows for this webhookId, converts them based on
   * payloadType, and marks them as processed.
   */
  public async fetchItems(): Promise<ContentItem[]> {
    await this.ensureBufferTable();

    const results: ContentItem[] = [];
    let rows: any[] = [];

    // Try platform database first (Postgres)
    try {
      const dbService = require('../../services/databaseService');
      if (dbService.query) {
        const result = await dbService.query(
          `SELECT id, payload, content_type, received_at 
           FROM webhook_buffer 
           WHERE webhook_id = $1 AND processed = FALSE 
           ORDER BY received_at ASC`,
          [this.webhookId]
        );
        rows = result.rows || [];
      }
    } catch {
      // Platform DB not available -- try SQLite
    }

    // Fallback to SQLite storage
    if (rows.length === 0 && this.storage && typeof this.storage !== 'string') {
      try {
        const db = this.storage.getDb();
        if (db && db.all) {
          rows = await db.all(
            `SELECT id, payload, content_type, received_at 
             FROM webhook_buffer 
             WHERE webhook_id = ? AND processed = 0 
             ORDER BY received_at ASC`,
            [this.webhookId]
          );
        }
      } catch {
        // Table might not exist
      }
    }

    if (rows.length === 0) {
      return [];
    }

    console.log(`[WebhookSource:${this.name}] Processing ${rows.length} buffered webhook(s)`);

    const processedIds: string[] = [];

    for (const row of rows) {
      try {
        const item = await this.convertPayloadToContentItem(row);
        if (item) {
          results.push(item);
        }
        processedIds.push(row.id);
      } catch (err: any) {
        console.error(`[WebhookSource:${this.name}] Error processing webhook payload:`, err.message);
        processedIds.push(row.id); // Mark as processed even on error to prevent re-processing
      }
    }

    // Mark processed rows
    if (processedIds.length > 0) {
      await this.markProcessed(processedIds);
    }

    // Cleanup old processed records
    await this.cleanup();

    console.log(`[WebhookSource:${this.name}] Produced ${results.length} content item(s)`);
    return results;
  }

  /**
   * Convert a buffered webhook payload to a ContentItem.
   */
  private async convertPayloadToContentItem(row: any): Promise<ContentItem | undefined> {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const receivedAt = row.received_at instanceof Date
      ? Math.floor(row.received_at.getTime() / 1000)
      : (typeof row.received_at === 'number' ? row.received_at : Math.floor(Date.now() / 1000));

    const payloadHash = crypto.createHash('md5')
      .update(JSON.stringify(payload))
      .digest('hex')
      .slice(0, 12);

    switch (this.payloadType) {
      case 'json':
        return this.convertJsonPayload(payload, receivedAt, payloadHash);

      case 'html':
        return this.convertHtmlPayload(payload, receivedAt, payloadHash);

      case 'text':
        return this.convertTextPayload(payload, receivedAt, payloadHash);

      default:
        return this.convertJsonPayload(payload, receivedAt, payloadHash);
    }
  }

  /**
   * Convert a JSON webhook payload to ContentItem using optional payloadMapping.
   */
  private convertJsonPayload(
    payload: any,
    receivedAt: number,
    payloadHash: string,
  ): ContentItem {
    if (this.payloadMapping) {
      // Apply JSON path mapping
      return {
        cid: `webhook-${this.webhookId}-${payloadHash}`,
        type: this.resolveJsonPath(payload, this.payloadMapping.type) || 'webhookData',
        source: this.name,
        title: this.resolveJsonPath(payload, this.payloadMapping.title) || '',
        text: this.resolveJsonPath(payload, this.payloadMapping.text) || JSON.stringify(payload),
        link: this.resolveJsonPath(payload, this.payloadMapping.link) || '',
        date: this.parseDate(this.resolveJsonPath(payload, this.payloadMapping.date)) || receivedAt,
        metadata: {
          webhookId: this.webhookId,
          rawPayload: payload,
          receivedAt,
        },
      };
    }

    // No mapping -- try to intelligently extract ContentItem fields
    return {
      cid: `webhook-${this.webhookId}-${payloadHash}`,
      type: payload.type || 'webhookData',
      source: this.name,
      title: payload.title || payload.subject || payload.headline || '',
      text: payload.text || payload.body || payload.content || payload.message || JSON.stringify(payload),
      link: payload.link || payload.url || payload.href || '',
      date: this.parseDate(payload.date || payload.timestamp || payload.created_at) || receivedAt,
      metadata: {
        webhookId: this.webhookId,
        rawPayload: payload,
        receivedAt,
      },
    };
  }

  /**
   * Convert an HTML webhook payload to ContentItem.
   */
  private async convertHtmlPayload(
    payload: any,
    receivedAt: number,
    payloadHash: string,
  ): Promise<ContentItem> {
    const html = typeof payload === 'string' ? payload : (payload.html || payload.body || payload.content || '');

    const itemUrl = payload.url || `webhook://${this.webhookId}`;

    // Use extractPageContent with pre-fetched HTML (no URL fetch needed for webhooks)
    if (html) {
      const resolvedStorage = (this.storage && typeof this.storage !== 'string') ? this.storage : undefined;
      const parsed = await extractPageContent(itemUrl, {
        sourceId: this.name,
        sourceName: this.name,
        type: 'webhookData',
        title: payload.title || '',
        provider: this.provider,
        html, // Pass payload HTML directly, don't fetch the URL
        storage: resolvedStorage,
      });

      if (parsed) {
        parsed.cid = `webhook-${this.webhookId}-${payloadHash}`;
        parsed.metadata = {
          ...parsed.metadata,
          webhookId: this.webhookId,
          receivedAt,
        };
        return parsed;
      }
    }

    // Fallback: minimal item if extractPageContent failed
    return {
      cid: `webhook-${this.webhookId}-${payloadHash}`,
      type: 'webhookData',
      source: this.name,
      title: payload.title || '',
      text: '',
      link: itemUrl,
      date: receivedAt,
      metadata: {
        webhookId: this.webhookId,
        receivedAt,
      },
    };
  }

  /**
   * Convert a plain text webhook payload to ContentItem.
   */
  private convertTextPayload(
    payload: any,
    receivedAt: number,
    payloadHash: string,
  ): ContentItem {
    const text = typeof payload === 'string' ? payload : (payload.text || payload.body || payload.message || JSON.stringify(payload));

    return {
      cid: `webhook-${this.webhookId}-${payloadHash}`,
      type: 'webhookData',
      source: this.name,
      title: payload.title || payload.subject || '',
      text,
      link: payload.url || '',
      date: receivedAt,
      metadata: {
        webhookId: this.webhookId,
        receivedAt,
      },
    };
  }

  /**
   * Resolve a simple JSON path ($.field.nested) against an object.
   */
  private resolveJsonPath(obj: any, path?: string): any {
    if (!path || !obj) return undefined;

    // Strip leading "$." if present
    const cleanPath = path.startsWith('$.') ? path.slice(2) : path;
    const parts = cleanPath.split('.');

    let current = obj;
    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * Parse various date formats into epoch seconds.
   */
  private parseDate(dateValue: any): number | undefined {
    if (!dateValue) return undefined;
    if (typeof dateValue === 'number') return dateValue;

    try {
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        return Math.floor(parsed.getTime() / 1000);
      }
    } catch {
      // Fall through
    }

    return undefined;
  }

  /**
   * Mark webhook buffer rows as processed.
   */
  private async markProcessed(ids: string[]): Promise<void> {
    // Try platform database first
    try {
      const dbService = require('../../services/databaseService');
      if (dbService.query) {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        await dbService.query(
          `UPDATE webhook_buffer SET processed = TRUE, processed_at = NOW() 
           WHERE id IN (${placeholders})`,
          ids
        );
        return;
      }
    } catch {
      // Fall through to SQLite
    }

    // SQLite fallback
    if (this.storage && typeof this.storage !== 'string') {
      try {
        const db = this.storage.getDb();
        if (db && db.run) {
          const placeholders = ids.map(() => '?').join(', ');
          await db.run(
            `UPDATE webhook_buffer SET processed = 1, processed_at = ${Math.floor(Date.now() / 1000)} 
             WHERE id IN (${placeholders})`,
            ids
          );
        }
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Clean up old processed records beyond the TTL.
   */
  private async cleanup(): Promise<void> {
    // Try platform database
    try {
      const dbService = require('../../services/databaseService');
      if (dbService.query) {
        await dbService.query(
          `DELETE FROM webhook_buffer 
           WHERE webhook_id = $1 AND processed = TRUE 
           AND processed_at < NOW() - INTERVAL '${this.bufferTTLDays} days'`,
          [this.webhookId]
        );
        return;
      }
    } catch {
      // Fall through
    }

    // SQLite fallback
    if (this.storage && typeof this.storage !== 'string') {
      try {
        const db = this.storage.getDb();
        if (db && db.run) {
          const cutoff = Math.floor(Date.now() / 1000) - (this.bufferTTLDays * 86400);
          await db.run(
            `DELETE FROM webhook_buffer 
             WHERE webhook_id = ? AND processed = 1 AND processed_at < ?`,
            [this.webhookId, cutoff]
          );
        }
      } catch {
        // Ignore
      }
    }
  }
}
