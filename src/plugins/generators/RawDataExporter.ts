import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, DiscordRawData } from "../../types";
import fs from "fs";
import path from "path";
import { logger } from "../../helpers/cliHelper";

/**
 * Configuration interface for RawDataExporter
 */
export interface RawDataExporterConfig {
  storage: SQLiteStorage;
  source: string; // e.g., 'discordRaw'
  outputPath: string;
}

/**
 * RawDataExporter class fetches raw data items from storage and 
 * exports them as individual JSON files per source entity (e.g., Discord channel).
 */
export class RawDataExporter {
  private storage: SQLiteStorage;
  private source: string;
  private outputPath: string;

  constructor(config: RawDataExporterConfig) {
    this.storage = config.storage;
    this.source = config.source;
    // Ensure base output path exists
    this.outputPath = config.outputPath;
    this.ensureDirectoryExists(this.outputPath); 
  }

  /**
   * Main entry point called by the aggregator or scheduler.
   * Exports data for the specified date.
   * @param dateStr - ISO date string (YYYY-MM-DD)
   */
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    // Keep method name for compatibility with how historical.ts calls generators
    await this.exportRawDataForDate(dateStr);
  }

  /**
   * Fetches and exports raw data for a specific date.
   * @param dateStr - ISO date string (YYYY-MM-DD)
   */
  private async exportRawDataForDate(dateStr: string): Promise<void> {
    const operation = `exportRawDataForDate(Source: ${this.source}, Date: ${dateStr})`;
    logger.info(`[RawDataExporter:${operation}] Starting export...`);
    let processedCount = 0;
    let fetchedCount = 0; // Track fetched items
    try {
      const startTimeEpoch = new Date(dateStr).setUTCHours(0, 0, 0, 0) / 1000;
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60); // Exactly 24 hours later

      // Fetch items of the specified source type for the given day
      logger.info(`[RawDataExporter:${operation}] Fetching items between ${new Date(startTimeEpoch * 1000).toISOString()} and ${new Date(endTimeEpoch * 1000).toISOString()} for type '${this.source}'`);
      logger.debug(`[RawDataExporter:${operation}] Calling storage.getContentItemsBetweenEpoch(${startTimeEpoch}, ${endTimeEpoch}, '${this.source}')`);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(
        startTimeEpoch,
        endTimeEpoch,
        this.source // Use the corrected includeType logic
      );
      fetchedCount = contentItems.length;
      logger.info(`[RawDataExporter:${operation}] Found ${fetchedCount} items in storage.`);

      if (contentItems.length === 0) {
        logger.info(`No raw data found for source '${this.source}' on date ${dateStr}.`);
        return;
      }

      // Process each raw data item individually
      logger.info(`[RawDataExporter:${operation}] Processing ${fetchedCount} fetched items...`);
      for (const item of contentItems) {
        logger.debug(`[RawDataExporter:${operation}] Processing item cid: ${item.cid}, type: ${item.type}`);
        // Check type explicitly again just in case fetch logic changes
        if (item.type !== this.source) {
            logger.warning(`[RawDataExporter:${operation}] Skipping item cid ${item.cid} - type mismatch (Expected: '${this.source}', Got: '${item.type}')`);
            continue;
        }
        
        if (!item.text) {
          logger.warning(`[RawDataExporter:${operation}] Skipping item cid ${item.cid} - missing text field.`);
          continue;
        }

        let parsedData: any;
        try {
          logger.debug(`[RawDataExporter:${operation}] Parsing JSON for item cid ${item.cid}...`);
          parsedData = JSON.parse(item.text);
          logger.debug(`[RawDataExporter:${operation}] Successfully parsed JSON for item cid ${item.cid}.`);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          logger.error(`[RawDataExporter:${operation}] Error parsing JSON for item cid ${item.cid}: ${error}`);
          continue; // Skip this item if parsing fails
        }

        // --- Determine Subfolder Structure (Example for Discord) --- 
        let subFolders: string[] = [];
        let baseFilename = `${dateStr}.json`; // Default filename
        logger.debug(`[RawDataExporter:${operation}] Determining path for item cid ${item.cid}, type ${item.type}...`);

        if (item.type === 'discordRawData') {
             const guildName = item.metadata?.guildName || 'UnknownGuild'; 
             const channelName = item.metadata?.channelName || (parsedData as DiscordRawData)?.channel?.name || 'UnknownChannel';
             const sanitizedGuild = this.sanitizeName(guildName);
             const sanitizedChannel = this.sanitizeName(channelName);
             subFolders = [sanitizedGuild, sanitizedChannel];
             logger.debug(`[RawDataExporter:${operation}] Path components: Guild=${sanitizedGuild}, Channel=${sanitizedChannel}`);
        }
         else {
             logger.warning(`[RawDataExporter:${operation}] Unhandled raw data type '${item.type}' for cid ${item.cid}. Saving to base path.`);
             baseFilename = `${this.sanitizeName(item.cid || `item_${item.id}`)}.json`;
         }

        // --- Construct path and ensure directory --- 
        const targetDir = path.join(this.outputPath, ...subFolders);
        const targetFilePath = path.join(targetDir, baseFilename);
        logger.debug(`[RawDataExporter:${operation}] Ensuring directory exists: ${targetDir}`);
        this.ensureDirectoryExists(targetDir); // ensureDirectoryExists already has debug logging

        // --- Write individual file --- 
        try {
          const exportJsonContent = JSON.stringify(parsedData, null, 2);
          logger.debug(`[RawDataExporter:${operation}] Writing file: ${targetFilePath} (Content length: ${exportJsonContent.length})`);
          fs.writeFileSync(targetFilePath, exportJsonContent);
          processedCount++;
          // logger.debug(`Exported raw data item cid ${item.cid} to ${targetFilePath}`); // Redundant log
          logger.success(`[RawDataExporter:${operation}] Successfully exported item cid ${item.cid} to ${targetFilePath}`);
        } catch (writeError) {
          const error = writeError instanceof Error ? writeError.message : String(writeError);
          logger.error(`[RawDataExporter:${operation}] Error writing file ${targetFilePath}: ${error}`);
        }
      }

      logger.success(`[RawDataExporter:${operation}] Raw data export complete. Processed ${processedCount}/${fetchedCount} items.`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[RawDataExporter:${operation}] Top-level error: ${errorMessage}`);
    }
  }

  /**
   * Sanitizes a string for use as a directory or file name.
   * Replaces spaces with underscores and removes most non-alphanumeric characters.
   * @param name The original string.
   * @returns The sanitized string.
   * @private
   */
  private sanitizeName(name: string): string {
    if (!name) return 'unknown';
    // Replace spaces/tabs with underscore, remove invalid chars, collapse multiple underscores
    return name
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-]/g, '') // Allow underscore and hyphen
      .replace(/__+/g, '_')
      .toLowerCase(); // Convert to lowercase for consistency
  }

  /**
   * Ensures a directory exists, creating it if necessary
   * @private
   * @param {string} dirPath - Path to the directory
   */
  private ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      try {
          fs.mkdirSync(dirPath, { recursive: true });
          logger.debug(`Created directory: ${dirPath}`);
      } catch (mkdirError) {
          const error = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
          logger.error(`Failed to create directory ${dirPath}: ${error}`);
      }
    }
  }

  // Optional: Add generateContent if needed as entry point, similar to DailySummaryGenerator
  public async generateContent() {
     logger.warning("generateContent method in RawDataExporter might need review/removal based on trigger.");
    try {
      const today = new Date();
      const exportDate = new Date(today);
      exportDate.setDate(exportDate.getDate() - 1); // Export yesterday's data by default
      const dateStr = exportDate.toISOString().slice(0, 10);
      await this.exportRawDataForDate(dateStr);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in RawDataExporter generateContent: ${errorMessage}`);
    }
  }
} 