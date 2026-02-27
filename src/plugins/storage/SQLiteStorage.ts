// src/plugins/storage/UnifiedStorage.ts

import { StoragePlugin } from "./StoragePlugin"; // a small interface if you like
import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { ContentItem, SiteParser, SummaryItem, StorageConfig } from "../../types";
import { logger } from "../../helpers/cliHelper";

/**
 * SQLiteStorage class implements the StoragePlugin interface for persistent storage
 * using SQLite database. This storage plugin handles both content items and summaries,
 * providing methods for saving, retrieving, and querying data.
 */
export class SQLiteStorage implements StoragePlugin {
  public name: string;
  private db: Database<sqlite3.Database, sqlite3.Statement> | null = null;
  private dbPath: string;

  /** Hidden from UI in platform mode - use PostgresStorage instead */
  static hidden = true;

  static constructorInterface = {
    parameters: [
      {
        name: 'dbPath',
        type: 'string',
        required: true,
        description: 'Path to the SQLite database file'
      }
    ]
  };

  /**
   * Creates a new instance of SQLiteStorage.
   * @param config - Configuration object containing storage name and database path
   */
  constructor(config: StorageConfig) {
    this.name = config.name;
    this.dbPath = config.dbPath;
  }

  /**
   * Initializes the SQLite database and creates necessary tables if they don't exist.
   * Creates tables for content items and summaries with appropriate schemas.
   * @returns Promise<void>
   */
  public async init(): Promise<void> {
    this.db = await open({ filename: this.dbPath, driver: sqlite3.Database });

    // Create the items table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cid TEXT,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        title TEXT,
        text TEXT,
        link TEXT,
        topics TEXT,
        date INTEGER,
        metadata TEXT  -- JSON-encoded metadata
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT,
        categories TEXT,
        markdown TEXT,
        date INTEGER,
        content_hash TEXT,
        start_date INTEGER,
        end_date INTEGER,
        granularity TEXT DEFAULT 'daily',
        metadata TEXT,
        tokens_used INTEGER,
        estimated_cost_usd REAL
      );
    `);

    // Migrations: add columns to existing databases
    const summaryMigrations = [
      'ALTER TABLE summary ADD COLUMN content_hash TEXT',
      'ALTER TABLE summary ADD COLUMN start_date INTEGER',
      'ALTER TABLE summary ADD COLUMN end_date INTEGER',
      "ALTER TABLE summary ADD COLUMN granularity TEXT DEFAULT 'daily'",
      'ALTER TABLE summary ADD COLUMN metadata TEXT',
      'ALTER TABLE summary ADD COLUMN tokens_used INTEGER',
      'ALTER TABLE summary ADD COLUMN estimated_cost_usd REAL',
    ];
    for (const migration of summaryMigrations) {
      try {
        await this.db.exec(migration);
      } catch {
        // Column already exists, ignore
      }
    }

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cid TEXT NOT NULL UNIQUE,
        message_id TEXT NOT NULL
      );
    `);

    // Site parsers table for cached LLM-generated HTML parsers
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_parsers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        path_pattern TEXT NOT NULL,
        parser_code TEXT NOT NULL,
        object_type_string TEXT,
        version INTEGER DEFAULT 1,
        consecutive_failures INTEGER DEFAULT 0,
        last_success_at INTEGER,
        last_failure_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sample_url TEXT,
        metadata TEXT,
        UNIQUE(domain, path_pattern, COALESCE(object_type_string, ''))
      );
    `);
  }

  /**
   * Closes the database connection.
   * Should be called when the storage is no longer needed.
   * @returns Promise<void>
   */
  public async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
    }
  }

  /**
   * Saves or updates multiple content items in the database.
   * Uses transactions to ensure data consistency and handles both new items
   * and updates to existing items.
   * @param items - Array of content items to save
   * @returns Promise<ContentItem[]> Array of saved content items with IDs
   * @throws Error if database is not initialized
   */
  public async saveContentItems(items: ContentItem[]): Promise<ContentItem[]> {
    const operation = "saveContentItems";
    if (!this.db) {
      throw new Error("Database not initialized. Call init() first.");
    }
    logger.debug(`[SQLiteStorage:${operation}] Starting transaction for ${items.length} items.`);

    const updateStmt = await this.db.prepare(
      `UPDATE items SET metadata = ? WHERE cid = ?`
    );
    const insertStmt = await this.db.prepare(
      `INSERT INTO items (type, source, cid, title, text, link, topics, date, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      await this.db.run("BEGIN TRANSACTION");
      logger.debug(`[SQLiteStorage:${operation}] Transaction started.`);

      for (const item of items) {
        if (!item) {
            logger.warning(`[SQLiteStorage:${operation}] Skipping null/undefined item.`);
            continue;
        }
        const itemDateISO = item.date ? new Date(item.date * 1000).toISOString() : 'Invalid Date';
        const itemLogInfo = `CID: ${item.cid || '(no CID)'}, Type: ${item.type}, DateEpoch: ${item.date}, DateISO: ${itemDateISO}`;
        logger.debug(`[SQLiteStorage:${operation}] Processing item ${itemLogInfo}`); 

        if (!item.cid) {
           // Log BEFORE run
           logger.debug(`[SQLiteStorage:${operation}] Preparing to INSERT item without CID: ${itemLogInfo}`);
           const result = await insertStmt.run(
                item.type,
                item.source,
                null,
                item.title,
                item.text,
                item.link,
                item.topics ? JSON.stringify(item.topics) : null,
                item.date, // Ensure date is valid number
                item.metadata ? JSON.stringify(item.metadata) : null
           );
           item.id = result.lastID || undefined;
           logger.debug(`[SQLiteStorage:${operation}] Inserted new item without CID, assigned ID: ${item.id}`);
           continue;
        }

        const existingRow = await this.db.get<{ id: number }>(
          `SELECT id FROM items WHERE cid = ?`,
          [item.cid]
        );

        if (existingRow) {
           // Log BEFORE run
           logger.debug(`[SQLiteStorage:${operation}] Preparing to UPDATE item: ${itemLogInfo}`);
           await updateStmt.run(
                item.metadata ? JSON.stringify(item.metadata) : null,
                // Potentially add item.topics update here if needed:
                // item.topics ? JSON.stringify(item.topics) : null,
                item.cid
           );
           item.id = existingRow.id;
           logger.debug(`[SQLiteStorage:${operation}] Updated existing item with CID: ${item.cid} (DB ID: ${item.id})`);
        } else {
           // Log BEFORE run
           logger.debug(`[SQLiteStorage:${operation}] Preparing to INSERT item: ${itemLogInfo}`);
           const metadataStr = item.metadata ? JSON.stringify(item.metadata) : null;
           const topicStr = item.topics ? JSON.stringify(item.topics) : null;
           const result = await insertStmt.run(
                 item.type,
                 item.source,
                 item.cid,
                 item.title,
                 item.text,
                 item.link,
                 topicStr,
                 item.date, // Ensure date is valid number
                 metadataStr
           );
           item.id = result.lastID || undefined;
           logger.debug(`[SQLiteStorage:${operation}] Inserted new item with CID: ${item.cid}, assigned ID: ${item.id}`);
        }
      }

      await this.db.run("COMMIT");
      logger.debug(`[SQLiteStorage:${operation}] Transaction committed successfully for ${items.length} items.`);
    } catch (error) {
      logger.error(`[SQLiteStorage:${operation}] Transaction failed: ${error instanceof Error ? error.message : String(error)}. Rolling back.`);
      await this.db.run("ROLLBACK");
      throw error;
    } finally {
      await updateStmt.finalize();
      await insertStmt.finalize();
    }
    return items;
  }

  /**
   * Retrieves a single content item by its content ID (cid).
   * @param cid - Content ID of the item to retrieve
   * @returns Promise<ContentItem | null> Retrieved content item or null if not found
   * @throws Error if database is not initialized
   */
  public async getContentItem(cid: string): Promise<ContentItem | null> {
    if (!this.db) {
      throw new Error("Database not initialized. Call init() first.");
    }
  
    const row = await this.db.get(`SELECT * FROM items WHERE cid = ?`, [cid]);
  
    if (!row) {
      return null;
    }
  
    const item: ContentItem = {
      id: row.id,
      type: row.type,
      source: row.source,
      cid: row.cid,
      title: row.title,
      text: row.text,
      link: row.link,
      topics: row.topics ? JSON.parse(row.topics) : null,
      date: row.date,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    };
  
    return item;
  }

  /**
   * Saves or updates a summary item in the database.
   * Handles both new summaries and updates to existing ones for the same type and date.
   * @param item - Summary item to save
   * @returns Promise<void>
   * @throws Error if database is not initialized or if item has no date
   */
  public async saveSummaryItem(item: SummaryItem): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized. Call init() first.");
    }

    if (!item.date) {
      throw new Error("Summary item must have a date");
    }

    const granularity = item.granularity || 'daily';
    const metadataStr = item.metadata ? JSON.stringify(item.metadata) : null;

    try {
      // Check if a summary already exists for this type, date, and granularity
      const existing = await this.db.get(
        `SELECT id FROM summary WHERE type = ? AND date = ? AND COALESCE(granularity, 'daily') = ?`,
        [item.type, item.date, granularity]
      );

      // Use epoch seconds * 1000 for correct Date object creation
      const dateStr = new Date(item.date * 1000).toISOString(); 

      if (existing) {
        // Update existing summary
        await this.db.run(
          `
          UPDATE summary 
          SET title = ?, categories = ?, markdown = ?, content_hash = ?,
              start_date = ?, end_date = ?, granularity = ?, metadata = ?,
              tokens_used = ?, estimated_cost_usd = ?
          WHERE type = ? AND date = ? AND COALESCE(granularity, 'daily') = ?
          `,
          [
            item.title || null,
            item.categories || null,
            item.markdown || null,
            item.contentHash || null,
            item.startDate || null,
            item.endDate || null,
            granularity,
            metadataStr,
            item.tokensUsed || null,
            item.estimatedCostUsd || null,
            item.type,
            item.date,
            granularity,
          ]
        );
        console.log(`Updated existing summary for ${item.type} (${granularity}) on date ${dateStr}`);
      } else {
        // Insert new summary
        await this.db.run(
          `
          INSERT INTO summary (type, title, categories, markdown, date, content_hash,
                               start_date, end_date, granularity, metadata, tokens_used, estimated_cost_usd)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            item.type,
            item.title || null,
            item.categories || null,
            item.markdown || null,
            item.date,
            item.contentHash || null,
            item.startDate || null,
            item.endDate || null,
            granularity,
            metadataStr,
            item.tokensUsed || null,
            item.estimatedCostUsd || null,
          ]
        );
        console.log(`Saved new summary for ${item.type} (${granularity}) on date ${dateStr}`);
      }
    } catch (error) {
      // Use epoch seconds * 1000 for correct Date object creation in error message
      console.error(`Error saving summary for ${item.type} on date ${new Date(item.date * 1000).toISOString()}:`, error); 
      throw error;
    }
  }

  /**
   * Retrieves all content items of a specific type.
   * @param type - Type of content items to retrieve
   * @returns Promise<ContentItem[]> Array of content items
   * @throws Error if database is not initialized
   */
  public async getItemsByType(type: string): Promise<ContentItem[]> {
    if (!this.db) {
      throw new Error("Database not initialized.");
    }

    const rows = await this.db.all(`
      SELECT * FROM items WHERE type = ?
    `, [type]);

    return rows.map(row => ({
      id: row.id,
      cid: row.cid,
      type: row.type,
      source: row.source,
      title: row.title,
      text: row.text,
      link: row.link,
      topics: row.topics ? JSON.parse(row.topics) : undefined,
      date: row.date,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  /**
   * Retrieves content items within a specific time range.
   * @param startEpoch - Start timestamp in epoch seconds
   * @param endEpoch - End timestamp in epoch seconds
   * @param includeType - Optional type to include in results
   * @returns Promise<ContentItem[]> Array of content items within the time range
   * @throws Error if database is not initialized
   */
  public async getContentItemsBetweenEpoch(
    startEpoch: number,
    endEpoch: number,
    includeType?: string 
  ): Promise<ContentItem[]> {
    const operation = "getContentItemsBetweenEpoch";
    if (!this.db) {
      throw new Error("Database not initialized.");
    }
    logger.debug(`[SQLiteStorage:${operation}] Called with startEpoch=${startEpoch}, endEpoch=${endEpoch}, includeType=${includeType}`);

    if (startEpoch > endEpoch) {
      // Log error before throwing
      logger.error(`[SQLiteStorage:${operation}] Invalid parameters: startEpoch (${startEpoch}) must be less than or equal to endEpoch (${endEpoch}).`);
      throw new Error("startEpoch must be less than or equal to endEpoch.");
    }

    // Note: Query uses date BETWEEN ? AND ?, which is inclusive.
    // The adjustment `startEpoch - 1` and `endEpoch + 1` might be overly broad.
    // Let's use the exact epoch range for clarity in logging and querying.
    let query = `SELECT * FROM items WHERE date >= ? AND date <= ?`; // Use >= and <= for inclusive range
    const params: any[] = [startEpoch, endEpoch]; 
    logger.debug(`[SQLiteStorage:${operation}] Initial query range: date >= ${startEpoch} AND date <= ${endEpoch}`);

    if (includeType) {
      query += ` AND type = ?`;    
      params.push(includeType);
      logger.debug(`[SQLiteStorage:${operation}] Adding filter: AND type = ${includeType}`);
    }

    try {
      logger.debug(`[SQLiteStorage:${operation}] Executing query: ${query} with params: ${JSON.stringify(params)}`);
      const rows = await this.db.all(query, params);
      logger.debug(`[SQLiteStorage:${operation}] Query returned ${rows.length} rows.`);

      // Map rows to ContentItem objects
      return rows.map(row => ({
        id: row.id,
        type: row.type,
        source: row.source,
        cid: row.cid,
        title: row.title || undefined,
        text: row.text || undefined,
        link: row.link || undefined,
        date: row.date,
        topics: row.topics ? JSON.parse(row.topics) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }));
    } catch (error) {
      logger.error(`[SQLiteStorage:${operation}] Error executing query: ${query} | Params: ${JSON.stringify(params)} | Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Retrieves summary items within a specific time range.
   * @param startEpoch - Start timestamp in epoch seconds
   * @param endEpoch - End timestamp in epoch seconds
   * @param excludeType - Optional type to exclude from results
   * @returns Promise<SummaryItem[]> Array of summary items within the time range
   * @throws Error if database is not initialized
   */
  public async getSummaryBetweenEpoch(
    startEpoch: number,
    endEpoch: number,
    excludeType?: string
  ): Promise<SummaryItem[]> {
    if (!this.db) {
      throw new Error("Database not initialized.");
    }

    if (startEpoch > endEpoch) {
      throw new Error("startEpoch must be less than or equal to endEpoch.");
    }

    let query = `SELECT * FROM summary WHERE date BETWEEN ? AND ?`;
    const params: any[] = [startEpoch, endEpoch];
    
    if (excludeType) {
      query += ` AND type != ?`;
      params.push(excludeType);
    }

    try {
      const rows = await this.db.all(query, params);

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title || undefined,
        categories: row.categories || undefined,
        markdown: row.markdown || undefined,
        date: row.date,
        contentHash: row.content_hash || undefined,
        startDate: row.start_date || undefined,
        endDate: row.end_date || undefined,
        granularity: row.granularity || undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        tokensUsed: row.tokens_used || undefined,
        estimatedCostUsd: row.estimated_cost_usd || undefined,
      }));
    } catch (error) {
      console.error("Error fetching summary between epochs:", error);
      throw error;
    }
  }

  /**
   * Gets the last fetched message ID for a given cursor id.
   */
  public async getCursor(cid: string): Promise<string | null> {
    if (!this.db) throw new Error("Database not initialized.");

    const row = await this.db.get(
      `SELECT message_id FROM cursor WHERE cid = ?`,
      [cid]
    );

    return row?.message_id || null;
  }

  /**
   * Sets or updates the cursor (last message ID) for a given cursor.
   */
  public async setCursor(cid: string, messageId: string): Promise<void> {
    if (!this.db) throw new Error("Database not initialized.");

    await this.db.run(`
      INSERT INTO cursor (cid, message_id)
      VALUES (?, ?)
      ON CONFLICT(cid) DO UPDATE SET message_id = excluded.message_id;
    `, [cid, messageId]);
  }

  // ============================================
  // SITE PARSER METHODS
  // ============================================

  /**
   * Finds a cached site parser matching domain, path pattern, and optional output schema.
   */
  public async getSiteParser(
    domain: string,
    pathPattern: string,
    objectTypeString?: string,
  ): Promise<SiteParser | null> {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");

    const row = await this.db.get(
      `SELECT * FROM site_parsers WHERE domain = ? AND path_pattern = ? AND COALESCE(object_type_string, '') = ?`,
      [domain, pathPattern, objectTypeString || ''],
    );

    if (!row) return null;

    return {
      id: row.id,
      domain: row.domain,
      pathPattern: row.path_pattern,
      parserCode: row.parser_code,
      objectTypeString: row.object_type_string || undefined,
      version: row.version,
      consecutiveFailures: row.consecutive_failures,
      lastSuccessAt: row.last_success_at || undefined,
      lastFailureAt: row.last_failure_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sampleUrl: row.sample_url || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Saves or updates a site parser. Upserts on (domain, pathPattern, objectTypeString).
   */
  public async saveSiteParser(parser: SiteParser): Promise<void> {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");

    const now = Math.floor(Date.now() / 1000);

    await this.db.run(
      `INSERT INTO site_parsers (domain, path_pattern, parser_code, object_type_string, version, consecutive_failures, last_success_at, last_failure_at, created_at, updated_at, sample_url, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, path_pattern, COALESCE(object_type_string, ''))
       DO UPDATE SET
         parser_code = excluded.parser_code,
         version = site_parsers.version + 1,
         consecutive_failures = 0,
         updated_at = excluded.updated_at,
         sample_url = COALESCE(excluded.sample_url, site_parsers.sample_url),
         metadata = COALESCE(excluded.metadata, site_parsers.metadata)`,
      [
        parser.domain,
        parser.pathPattern,
        parser.parserCode,
        parser.objectTypeString || null,
        parser.version || 1,
        parser.consecutiveFailures || 0,
        parser.lastSuccessAt || null,
        parser.lastFailureAt || null,
        parser.createdAt || now,
        now,
        parser.sampleUrl || null,
        parser.metadata ? JSON.stringify(parser.metadata) : null,
      ],
    );
  }

  /**
   * Records a success or failure for a site parser.
   */
  public async updateSiteParserStatus(id: number, success: boolean): Promise<void> {
    if (!this.db) throw new Error("Database not initialized. Call init() first.");

    const now = Math.floor(Date.now() / 1000);

    if (success) {
      await this.db.run(
        `UPDATE site_parsers SET consecutive_failures = 0, last_success_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id],
      );
    } else {
      await this.db.run(
        `UPDATE site_parsers SET consecutive_failures = consecutive_failures + 1, last_failure_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id],
      );
    }
  }

  /**
   * Returns the underlying database connection for direct access.
   * Used by registries (DiscordUserRegistry, DiscordChannelRegistry) that need
   * to manage their own tables within the same database.
   * @returns The database connection, or null if not initialized
   */
  public getDb(): Database<sqlite3.Database, sqlite3.Statement> | null {
    return this.db;
  }
}
