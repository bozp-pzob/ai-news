// src/plugins/storage/PostgresStorage.ts

import { Pool, PoolClient, QueryResult } from 'pg';
import { StoragePlugin } from './StoragePlugin';
import { ContentItem, SummaryItem } from '../../types';
import { logger } from '../../helpers/cliHelper';

/**
 * Configuration for PostgresStorage
 */
export interface PostgresStorageConfig {
  name: string;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  poolSize?: number;
  configId?: string;  // For multi-tenant isolation
}

/**
 * Options for vector similarity search
 */
export interface VectorSearchOptions {
  embedding: number[];
  limit?: number;
  threshold?: number;
  type?: string;
  source?: string;
  afterDate?: number;
  beforeDate?: number;
}

/**
 * Result from vector search including similarity score
 */
export interface VectorSearchResult extends ContentItem {
  similarity: number;
}

/**
 * PostgresStorage implements StoragePlugin with pgvector support for semantic search.
 * Supports multi-tenant data isolation via configId.
 */
export class PostgresStorage implements StoragePlugin {
  public name: string;
  private pool: Pool | null = null;
  private config: PostgresStorageConfig;
  private configId: string | null = null;

  static constructorInterface = {
    parameters: [
      {
        name: 'usePlatformStorage',
        type: 'boolean',
        required: false,
        description: 'Use platform-hosted PostgreSQL storage (Pro users only)',
        platformOnly: true
      },
      {
        name: 'connectionString',
        type: 'string',
        required: false,
        description: 'PostgreSQL connection string (alternative to individual params)',
        secret: true
      },
      {
        name: 'host',
        type: 'string',
        required: false,
        description: 'PostgreSQL host'
      },
      {
        name: 'port',
        type: 'number',
        required: false,
        description: 'PostgreSQL port (default: 5432)'
      },
      {
        name: 'database',
        type: 'string',
        required: false,
        description: 'Database name'
      },
      {
        name: 'user',
        type: 'string',
        required: false,
        description: 'Database user'
      },
      {
        name: 'password',
        type: 'string',
        required: false,
        description: 'Database password',
        secret: true
      },
      {
        name: 'skipValidation',
        type: 'boolean',
        required: false,
        description: 'Skip database connection validation (for testing only)'
      }
    ]
  };

  constructor(config: PostgresStorageConfig) {
    this.name = config.name;
    this.config = config;
    this.configId = config.configId || null;
  }

  /**
   * Creates a new PostgresStorage instance scoped to a specific config
   */
  forConfig(configId: string): PostgresStorage {
    const scopedStorage = new PostgresStorage({
      ...this.config,
      configId
    });
    scopedStorage.pool = this.pool;
    return scopedStorage;
  }

  /**
   * Initializes the PostgreSQL connection pool
   */
  public async init(): Promise<void> {
    const operation = 'init';
    
    try {
      const poolConfig: any = {
        max: this.config.poolSize || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

      if (this.config.connectionString) {
        poolConfig.connectionString = this.config.connectionString;
      } else {
        poolConfig.host = this.config.host || 'localhost';
        poolConfig.port = this.config.port || 5432;
        poolConfig.database = this.config.database || 'ainews';
        poolConfig.user = this.config.user || 'ainews';
        poolConfig.password = this.config.password || 'ainews';
      }

      if (this.config.ssl) {
        poolConfig.ssl = this.config.ssl === true 
          ? { rejectUnauthorized: false }
          : this.config.ssl;
      }

      this.pool = new Pool(poolConfig);

      // Test the connection
      const client = await this.pool.connect();
      
      // Verify pgvector extension exists
      const extResult = await client.query(
        "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
      );
      
      if (extResult.rows.length === 0) {
        logger.warning(`[PostgresStorage:${operation}] pgvector extension not found. Vector search will not be available.`);
      }

      client.release();
      logger.debug(`[PostgresStorage:${operation}] Connection pool initialized successfully`);
    } catch (error) {
      logger.error(`[PostgresStorage:${operation}] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Closes the connection pool
   */
  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.debug('[PostgresStorage:close] Connection pool closed');
    }
  }

  /**
   * Returns the underlying database pool for direct access.
   */
  public getDb(): any {
    return this.pool;
  }

  /**
   * Get a client from the pool
   */
  private async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.pool.connect();
  }

  /**
   * Execute a query with automatic client release
   */
  private async query(text: string, params?: any[]): Promise<QueryResult<any>> {
    const client = await this.getClient();
    try {
      return await client.query(text, params);
    } finally {
      client.release();
    }
  }

  /**
   * Saves or updates multiple content items
   */
  public async saveContentItems(items: ContentItem[]): Promise<ContentItem[]> {
    const operation = 'saveContentItems';
    
    if (!this.pool) {
      throw new Error('Database not initialized. Call init() first.');
    }

    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    logger.debug(`[PostgresStorage:${operation}] Saving ${items.length} items for config ${this.configId}`);

    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');

      for (const item of items) {
        if (!item) {
          logger.warning(`[PostgresStorage:${operation}] Skipping null/undefined item`);
          continue;
        }

        const topicsArray = item.topics ? `{${item.topics.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',')}}` : null;
        const metadataJson = item.metadata ? JSON.stringify(item.metadata) : null;
        const embeddingStr = (item as any).embedding 
          ? `[${(item as any).embedding.join(',')}]`
          : null;

        if (item.cid) {
          // Try to update existing item
          const existingResult = await client.query(
            'SELECT id FROM items WHERE config_id = $1 AND cid = $2',
            [this.configId, item.cid]
          );

          if (existingResult.rows.length > 0) {
            // Update existing
            await client.query(`
              UPDATE items SET
                metadata = COALESCE($1::jsonb, metadata),
                topics = COALESCE($2::text[], topics),
                embedding = COALESCE($3::vector, embedding)
              WHERE config_id = $4 AND cid = $5
            `, [metadataJson, topicsArray, embeddingStr, this.configId, item.cid]);
            
            item.id = existingResult.rows[0].id;
            logger.debug(`[PostgresStorage:${operation}] Updated item cid=${item.cid}`);
          } else {
            // Insert new
            const insertResult = await client.query(`
              INSERT INTO items (config_id, cid, type, source, title, text, link, topics, date, metadata, embedding)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10::jsonb, $11::vector)
              RETURNING id
            `, [
              this.configId,
              item.cid,
              item.type,
              item.source,
              item.title || null,
              item.text || null,
              item.link || null,
              topicsArray,
              item.date || null,
              metadataJson,
              embeddingStr
            ]);
            
            item.id = insertResult.rows[0].id;
            logger.debug(`[PostgresStorage:${operation}] Inserted item cid=${item.cid}, id=${item.id}`);
          }
        } else {
          // No cid, just insert
          const insertResult = await client.query(`
            INSERT INTO items (config_id, type, source, title, text, link, topics, date, metadata, embedding)
            VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9::jsonb, $10::vector)
            RETURNING id
          `, [
            this.configId,
            item.type,
            item.source,
            item.title || null,
            item.text || null,
            item.link || null,
            topicsArray,
            item.date || null,
            metadataJson,
            embeddingStr
          ]);
          
          item.id = insertResult.rows[0].id;
          logger.debug(`[PostgresStorage:${operation}] Inserted item without cid, id=${item.id}`);
        }
      }

      await client.query('COMMIT');
      logger.debug(`[PostgresStorage:${operation}] Successfully saved ${items.length} items`);
      
      return items;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`[PostgresStorage:${operation}] Transaction failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves a content item by its content ID
   */
  public async getContentItem(cid: string): Promise<ContentItem | null> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(
      'SELECT * FROM items WHERE config_id = $1 AND cid = $2',
      [this.configId, cid]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.rowToContentItem(row);
  }

  /**
   * Retrieves content items within a time range
   */
  public async getContentItemsBetweenEpoch(
    startEpoch: number,
    endEpoch: number,
    includeType?: string
  ): Promise<ContentItem[]> {
    const operation = 'getContentItemsBetweenEpoch';
    
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    if (startEpoch > endEpoch) {
      throw new Error('startEpoch must be less than or equal to endEpoch');
    }

    let query = 'SELECT * FROM items WHERE config_id = $1 AND date >= $2 AND date <= $3';
    const params: any[] = [this.configId, startEpoch, endEpoch];

    if (includeType) {
      query += ' AND type = $4';
      params.push(includeType);
    }

    query += ' ORDER BY date DESC';

    logger.debug(`[PostgresStorage:${operation}] Query: ${query}, Params: ${JSON.stringify(params)}`);

    const result = await this.query(query, params);
    return result.rows.map((row: any) => this.rowToContentItem(row));
  }

  /**
   * Saves or updates a summary item
   */
  public async saveSummaryItem(item: SummaryItem): Promise<void> {
    const operation = 'saveSummaryItem';
    
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    if (!item.date) {
      throw new Error('Summary item must have a date');
    }

    const categoriesJson = item.categories || null;
    const embeddingStr = (item as any).embedding
      ? `[${(item as any).embedding.join(',')}]`
      : null;

    // Use upsert (INSERT ... ON CONFLICT)
    await this.query(`
      INSERT INTO summaries (config_id, type, title, categories, markdown, date, embedding)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::vector)
      ON CONFLICT (config_id, type, date)
      DO UPDATE SET
        title = EXCLUDED.title,
        categories = EXCLUDED.categories,
        markdown = EXCLUDED.markdown,
        embedding = COALESCE(EXCLUDED.embedding, summaries.embedding)
    `, [
      this.configId,
      item.type,
      item.title || null,
      categoriesJson,
      item.markdown || null,
      item.date,
      embeddingStr
    ]);

    logger.debug(`[PostgresStorage:${operation}] Saved summary type=${item.type}, date=${item.date}`);
  }

  /**
   * Retrieves summaries within a time range
   */
  public async getSummaryBetweenEpoch(
    startEpoch: number,
    endEpoch: number,
    excludeType?: string
  ): Promise<SummaryItem[]> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    if (startEpoch > endEpoch) {
      throw new Error('startEpoch must be less than or equal to endEpoch');
    }

    let query = 'SELECT * FROM summaries WHERE config_id = $1 AND date >= $2 AND date <= $3';
    const params: any[] = [this.configId, startEpoch, endEpoch];

    if (excludeType) {
      query += ' AND type != $4';
      params.push(excludeType);
    }

    query += ' ORDER BY date DESC';

    const result = await this.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      type: row.type,
      title: row.title || undefined,
      categories: row.categories || undefined,
      markdown: row.markdown || undefined,
      date: row.date
    }));
  }

  /**
   * Gets cursor (last fetched message ID) for a source
   */
  public async getCursor(cid: string): Promise<string | null> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(
      'SELECT message_id FROM cursors WHERE config_id = $1 AND cid = $2',
      [this.configId, cid]
    );

    return result.rows[0]?.message_id || null;
  }

  /**
   * Sets cursor (last fetched message ID) for a source
   */
  public async setCursor(cid: string, messageId: string): Promise<void> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    await this.query(`
      INSERT INTO cursors (config_id, cid, message_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (config_id, cid)
      DO UPDATE SET message_id = EXCLUDED.message_id
    `, [this.configId, cid, messageId]);
  }

  // ============================================
  // VECTOR SEARCH METHODS
  // ============================================

  /**
   * Performs semantic similarity search using vector embeddings
   */
  public async searchByEmbedding(options: VectorSearchOptions): Promise<VectorSearchResult[]> {
    const operation = 'searchByEmbedding';
    
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const {
      embedding,
      limit = 20,
      threshold = 0.7,
      type,
      source,
      afterDate,
      beforeDate
    } = options;

    const embeddingStr = `[${embedding.join(',')}]`;
    
    let query = `
      SELECT *,
        1 - (embedding <=> $1::vector) as similarity
      FROM items
      WHERE config_id = $2
        AND embedding IS NOT NULL
    `;
    
    const params: any[] = [embeddingStr, this.configId];
    let paramIndex = 3;

    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (source) {
      query += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (afterDate) {
      query += ` AND date >= $${paramIndex}`;
      params.push(afterDate);
      paramIndex++;
    }

    if (beforeDate) {
      query += ` AND date <= $${paramIndex}`;
      params.push(beforeDate);
      paramIndex++;
    }

    query += `
      ORDER BY embedding <=> $1::vector
      LIMIT $${paramIndex}
    `;
    params.push(limit);

    logger.debug(`[PostgresStorage:${operation}] Executing vector search with limit=${limit}`);

    const result = await this.query(query, params);

    return result.rows
      .filter((row: any) => row.similarity >= threshold)
      .map((row: any) => ({
        ...this.rowToContentItem(row),
        similarity: parseFloat(row.similarity)
      }));
  }

  /**
   * Searches summaries by embedding
   */
  public async searchSummariesByEmbedding(
    embedding: number[],
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<(SummaryItem & { similarity: number })[]> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const embeddingStr = `[${embedding.join(',')}]`;

    const result = await this.query(`
      SELECT *,
        1 - (embedding <=> $1::vector) as similarity
      FROM summaries
      WHERE config_id = $2
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `, [embeddingStr, this.configId, limit]);

    return result.rows
      .filter((row: any) => parseFloat(row.similarity) >= threshold)
      .map((row: any) => ({
        id: row.id,
        type: row.type,
        title: row.title || undefined,
        categories: row.categories || undefined,
        markdown: row.markdown || undefined,
        date: row.date,
        similarity: parseFloat(row.similarity)
      }));
  }

  // ============================================
  // STATISTICS & ANALYTICS METHODS
  // ============================================

  /**
   * Gets topic frequency counts
   */
  public async getTopicCounts(limit: number = 50): Promise<{ topic: string; count: number }[]> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(`
      SELECT unnest(topics) as topic, COUNT(*) as count
      FROM items
      WHERE config_id = $1 AND topics IS NOT NULL
      GROUP BY topic
      ORDER BY count DESC
      LIMIT $2
    `, [this.configId, limit]);

    return result.rows.map((row: any) => ({
      topic: row.topic,
      count: parseInt(row.count)
    }));
  }

  /**
   * Gets source statistics
   */
  public async getSourceStats(): Promise<{ source: string; count: number; latestDate: number }[]> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(`
      SELECT source, COUNT(*) as count, MAX(date) as latest_date
      FROM items
      WHERE config_id = $1
      GROUP BY source
      ORDER BY count DESC
    `, [this.configId]);

    return result.rows.map((row: any) => ({
      source: row.source,
      count: parseInt(row.count),
      latestDate: parseInt(row.latest_date)
    }));
  }

  /**
   * Gets item count for a config
   */
  public async getItemCount(): Promise<number> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(
      'SELECT COUNT(*) as count FROM items WHERE config_id = $1',
      [this.configId]
    );

    return parseInt(result.rows[0].count);
  }

  /**
   * Gets date range of items
   */
  public async getDateRange(): Promise<{ minDate: number; maxDate: number } | null> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(`
      SELECT MIN(date) as min_date, MAX(date) as max_date
      FROM items
      WHERE config_id = $1
    `, [this.configId]);

    if (!result.rows[0].min_date) {
      return null;
    }

    return {
      minDate: parseInt(result.rows[0].min_date),
      maxDate: parseInt(result.rows[0].max_date)
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Converts a database row to ContentItem
   */
  private rowToContentItem(row: any): ContentItem {
    return {
      id: row.id,
      cid: row.cid,
      type: row.type,
      source: row.source,
      title: row.title || undefined,
      text: row.text || undefined,
      link: row.link || undefined,
      topics: row.topics || undefined,
      date: row.date ? parseInt(row.date) : undefined,
      metadata: row.metadata || undefined
    };
  }

  /**
   * Updates embedding for an existing item
   */
  public async updateItemEmbedding(itemId: number, embedding: number[]): Promise<void> {
    const embeddingStr = `[${embedding.join(',')}]`;
    
    await this.query(
      'UPDATE items SET embedding = $1::vector WHERE id = $2',
      [embeddingStr, itemId]
    );
  }

  /**
   * Updates embedding for an existing summary
   */
  public async updateSummaryEmbedding(summaryId: number, embedding: number[]): Promise<void> {
    const embeddingStr = `[${embedding.join(',')}]`;
    
    await this.query(
      'UPDATE summaries SET embedding = $1::vector WHERE id = $2',
      [embeddingStr, summaryId]
    );
  }

  /**
   * Gets items without embeddings (for backfill)
   */
  public async getItemsWithoutEmbeddings(limit: number = 100): Promise<ContentItem[]> {
    if (!this.configId) {
      throw new Error('configId is required for multi-tenant storage');
    }

    const result = await this.query(`
      SELECT * FROM items
      WHERE config_id = $1 AND embedding IS NULL
      LIMIT $2
    `, [this.configId, limit]);

    return result.rows.map((row: any) => this.rowToContentItem(row));
  }

  /**
   * Bulk update embeddings
   */
  public async bulkUpdateEmbeddings(
    updates: { id: number; embedding: number[] }[]
  ): Promise<void> {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');

      for (const { id, embedding } of updates) {
        const embeddingStr = `[${embedding.join(',')}]`;
        await client.query(
          'UPDATE items SET embedding = $1::vector WHERE id = $2',
          [embeddingStr, id]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
