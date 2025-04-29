// src/plugins/storage/UnifiedStorage.ts

import { StoragePlugin } from "./StoragePlugin"; // a small interface if you like
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import { ContentItem, SummaryItem, StorageConfig } from "../../types";
import { logger } from "../../helpers/cliHelper";

// Define schema for Drizzle
const itemsTable = sqliteTable('items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cid: text('cid'),
  type: text('type').notNull(),
  source: text('source').notNull(),
  title: text('title'),
  text: text('text'),
  link: text('link'),
  topics: text('topics'),
  date: integer('date'),
  metadata: text('metadata')
});

const summaryTable = sqliteTable('summary', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  title: text('title'),
  categories: text('categories'),
  markdown: text('markdown'),
  date: integer('date')
});

const cursorTable = sqliteTable('cursor', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cid: text('cid').notNull().unique(),
  message_id: text('message_id').notNull()
});

/**
 * SQLiteStorage class implements the StoragePlugin interface for persistent storage
 * using SQLite database. This storage plugin handles both content items and summaries,
 * providing methods for saving, retrieving, and querying data.
 */
export class SQLiteStorage implements StoragePlugin {
  public name: string;
  private db: ReturnType<typeof drizzle> | null = null;
  private client: ReturnType<typeof createClient> | null = null;
  private dbPath: string;

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
    // Create LibSQL client
    this.client = createClient({
      url: `file:${this.dbPath}`
    });
    
    // Create Drizzle ORM instance
    this.db = drizzle(this.client);

    // Create the items table if it doesn't exist
    await this.client.execute(`
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

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT,
        categories TEXT,
        markdown TEXT,
        date INTEGER
      );
    `);

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS cursor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cid TEXT NOT NULL UNIQUE,
        message_id TEXT NOT NULL
      );
    `);
  }

  /**
   * Closes the database connection.
   * Should be called when the storage is no longer needed.
   * @returns Promise<void>
   */
  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
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
    if (!this.db || !this.client) {
      throw new Error("Database not initialized. Call init() first.");
    }
    logger.debug(`[SQLiteStorage:${operation}] Starting transaction for ${items.length} items.`);

    try {
      await this.client.execute({ sql: "BEGIN TRANSACTION", args: [] });
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
           
           const result = await this.client.execute({
             sql: `INSERT INTO items (type, source, cid, title, text, link, topics, date, metadata) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
             args: [
               item.type,
               item.source,
               null,
               item.title,
               item.text,
               item.link,
               item.topics ? JSON.stringify(item.topics) : null,
               item.date, // Ensure date is valid number
               item.metadata ? JSON.stringify(item.metadata) : null
             ]
           });
           
           item.id = Number(result.lastInsertRowid) || undefined;
           logger.debug(`[SQLiteStorage:${operation}] Inserted new item without CID, assigned ID: ${item.id}`);
           continue;
        }

        const existingRow = await this.client.execute({
          sql: `SELECT id FROM items WHERE cid = ?`,
          args: [item.cid]
        });

        if (existingRow.rows.length > 0) {
           // Log BEFORE run
           logger.debug(`[SQLiteStorage:${operation}] Preparing to UPDATE item: ${itemLogInfo}`);
           
           await this.client.execute({
             sql: `UPDATE items SET metadata = ? WHERE cid = ?`,
             args: [
               item.metadata ? JSON.stringify(item.metadata) : null,
               item.cid
             ]
           });
           
           item.id = Number(existingRow.rows[0].id);
           logger.debug(`[SQLiteStorage:${operation}] Updated existing item with CID: ${item.cid} (DB ID: ${item.id})`);
        } else {
           // Log BEFORE run
           logger.debug(`[SQLiteStorage:${operation}] Preparing to INSERT item: ${itemLogInfo}`);
           
           const metadataStr = item.metadata ? JSON.stringify(item.metadata) : null;
           const topicStr = item.topics ? JSON.stringify(item.topics) : null;
           
           const result = await this.client.execute({
             sql: `INSERT INTO items (type, source, cid, title, text, link, topics, date, metadata) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
             args: [
               item.type,
               item.source,
               item.cid,
               item.title,
               item.text,
               item.link,
               topicStr,
               item.date, // Ensure date is valid number
               metadataStr
             ]
           });
           
           item.id = Number(result.lastInsertRowid) || undefined;
           logger.debug(`[SQLiteStorage:${operation}] Inserted new item with CID: ${item.cid}, assigned ID: ${item.id}`);
        }
      }

      await this.client.execute({ sql: "COMMIT", args: [] });
      logger.debug(`[SQLiteStorage:${operation}] Transaction committed successfully for ${items.length} items.`);
    } catch (error) {
      logger.error(`[SQLiteStorage:${operation}] Transaction failed: ${error instanceof Error ? error.message : String(error)}. Rolling back.`);
      await this.client.execute({ sql: "ROLLBACK", args: [] });
      throw error;
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
  
    const result = await this.client!.execute({
      sql: `SELECT * FROM items WHERE cid = ?`,
      args: [cid]
    });
  
    if (result.rows.length === 0) {
      return null;
    }
  
    const row = result.rows[0];
    const item: ContentItem = {
      id: Number(row.id),
      type: String(row.type),
      source: String(row.source),
      cid: String(row.cid),
      title: row.title ? String(row.title) : undefined,
      text: row.text ? String(row.text) : undefined,
      link: row.link ? String(row.link) : undefined,
      topics: row.topics ? JSON.parse(String(row.topics)) : null,
      date: row.date ? Number(row.date) : undefined,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : null
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
    if (!this.db || !this.client) {
      throw new Error("Database not initialized. Call init() first.");
    }

    if (!item.date) {
      throw new Error("Summary item must have a date");
    }

    try {
      // Check if a summary already exists for this type and date
      const existingResult = await this.client.execute({
        sql: `SELECT id FROM summary WHERE type = ? AND date = ?`,
        args: [item.type, item.date]
      });

      const dateStr = new Date(item.date).toISOString();

      if (existingResult.rows.length > 0) {
        // Update existing summary
        await this.client.execute({
          sql: `UPDATE summary 
                SET title = ?, categories = ?, markdown = ?
                WHERE type = ? AND date = ?`,
          args: [
            item.title || null,
            item.categories || null,
            item.markdown || null,
            item.type,
            item.date
          ]
        });
        console.log(`Updated existing summary for ${item.type} on date ${dateStr}`);
      } else {
        // Insert new summary
        await this.client.execute({
          sql: `INSERT INTO summary (type, title, categories, markdown, date)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            item.type,
            item.title || null,
            item.categories || null,
            item.markdown || null,
            item.date,
          ]
        });
        console.log(`Saved new summary for ${item.type} on date ${dateStr}`);
      }
    } catch (error) {
      console.error(`Error saving summary for ${item.type} on date ${new Date(item.date).toISOString()}:`, error);
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
    if (!this.db || !this.client) {
      throw new Error("Database not initialized.");
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM items WHERE type = ?`,
      args: [type]
    });

    return result.rows.map((row:any) => ({
      id: Number(row.id),
      cid: row.cid ? String(row.cid) : undefined,
      type: String(row.type),
      source: String(row.source),
      title: row.title ? String(row.title) : undefined,
      text: row.text ? String(row.text) : undefined,
      link: row.link ? String(row.link) : undefined,
      topics: row.topics ? JSON.parse(String(row.topics)) : undefined,
      date: row.date ? Number(row.date) : undefined,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined
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
    if (!this.db || !this.client) {
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
      const result = await this.client.execute({
        sql: query,
        args: params
      });
      
      logger.debug(`[SQLiteStorage:${operation}] Query returned ${result.rows.length} rows.`);

      // Map rows to ContentItem objects
      return result.rows.map((row:any) => ({
        id: Number(row.id),
        type: String(row.type),
        source: String(row.source),
        cid: row.cid ? String(row.cid) : undefined,
        title: row.title ? String(row.title) : undefined,
        text: row.text ? String(row.text) : undefined,
        link: row.link ? String(row.link) : undefined,
        date: row.date ? Number(row.date) : undefined,
        topics: row.topics ? JSON.parse(String(row.topics)) : undefined,
        metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
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
    if (!this.db || !this.client) {
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
      const result = await this.client.execute({
        sql: query,
        args: params
      });

      return result.rows.map((row:any) => ({
        id: Number(row.id),
        type: String(row.type),
        title: row.title ? String(row.title) : undefined,
        categories: row.categories ? String(row.categories) : undefined,
        date: row.date ? Number(row.date) : undefined,
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
    if (!this.db || !this.client) throw new Error("Database not initialized.");

    const result = await this.client.execute({
      sql: `SELECT message_id FROM cursor WHERE cid = ?`,
      args: [cid]
    });

    return result.rows.length > 0 ? String(result.rows[0].message_id) : null;
  }

  /**
   * Sets or updates the cursor (last message ID) for a given cursor.
   */
  public async setCursor(cid: string, messageId: string): Promise<void> {
    if (!this.db || !this.client) throw new Error("Database not initialized.");
  
    await this.client.execute({
      sql: `
        INSERT INTO cursor (cid, message_id)
        VALUES (?, ?)
        ON CONFLICT(cid) DO UPDATE SET message_id = excluded.message_id;
      `,
      args: [cid, messageId]
    });
  }
}