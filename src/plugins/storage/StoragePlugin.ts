// src/plugins/storage/StoragePlugin.ts

import { ContentItem, SiteParser, SummaryItem } from "../../types";

/**
 * StoragePlugin interface defines the contract for storage implementations.
 * This interface provides methods for managing content items and summaries
 * in a persistent storage system.
 */
export interface StoragePlugin {
  /**
   * Initializes the storage system.
   * Should be called before using any other methods.
   * @returns Promise<void>
   */
  init(): Promise<void>;

  /**
   * Closes the storage system and releases any resources.
   * Should be called when the storage is no longer needed.
   * @returns Promise<void>
   */
  close(): Promise<void>;

  /**
   * Saves or updates multiple content items in the storage.
   * @param items - Array of content items to save
   * @returns Promise<ContentItem[]> Array of saved content items with IDs
   */
  saveContentItems(items: ContentItem[]): Promise<ContentItem[]>;

  /**
   * Retrieves a single content item by its content ID.
   * @param cid - Content ID of the item to retrieve
   * @returns Promise<ContentItem | null> Retrieved content item or null if not found
   */
  getContentItem(cid: string): Promise<ContentItem | null>;

  /**
   * Saves or updates a summary item in the storage.
   * @param item - Summary item to save
   * @returns Promise<void>
   */
  saveSummaryItem(item: SummaryItem): Promise<void>;

  /**
   * Retrieves summary items within a specific time range.
   * @param startEpoch - Start timestamp in epoch seconds
   * @param endEpoch - End timestamp in epoch seconds
   * @param excludeType - Optional type to exclude from results
   * @returns Promise<SummaryItem[]> Array of summary items within the time range
   */
  getSummaryBetweenEpoch(startEpoch: number, endEpoch: number, excludeType?: string): Promise<SummaryItem[]>;

  /**
   * Retrieves message ids based on cursor id.
   * @param cid - Unique Cursor ID to fetch the cursor by.
   * @returns Promise<string | null> Either a message id or null
   */
  getCursor(cid: string): Promise<string | null>;

  /**
   * Stores message id for a unique cursor id.
   * @param cid - Unique Cursor ID to fetch the cursor by.
   * @param messageId - message id that was last fetched.
   */
  setCursor(cid: string, messageId: string): Promise<void>;

  /**
   * Returns the underlying database connection for direct access.
   * Used by registries (DiscordUserRegistry, DiscordChannelRegistry) that need
   * to manage their own tables within the same database.
   * @returns The database connection, or null if not initialized
   */
  getDb(): any;

  // ============================================
  // SITE PARSER METHODS (for cached HTML parsers)
  // ============================================

  /**
   * Finds a cached site parser matching a domain, path pattern, and optional output schema.
   * @param domain - The domain to match (e.g. "example.com")
   * @param pathPattern - The path pattern to match (e.g. "/blog/*")
   * @param objectTypeString - Optional TypeScript interface string the parser was generated for
   * @returns The matching SiteParser, or null if not found
   */
  getSiteParser(domain: string, pathPattern: string, objectTypeString?: string): Promise<SiteParser | null>;

  /**
   * Saves or updates a site parser. Upserts on (domain, pathPattern, objectTypeString).
   * @param parser - The SiteParser to save
   */
  saveSiteParser(parser: SiteParser): Promise<void>;

  /**
   * Records a success or failure for a site parser.
   * On success: resets consecutiveFailures to 0 and updates lastSuccessAt.
   * On failure: increments consecutiveFailures and updates lastFailureAt.
   * @param id - The parser ID
   * @param success - Whether the parse was successful
   */
  updateSiteParserStatus(id: number, success: boolean): Promise<void>;
}