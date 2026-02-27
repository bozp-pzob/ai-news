/**
 * @fileoverview Raw data exporter that reads content items from storage and writes
 * them as individual JSON files organized by guild/channel.
 *
 * Implements ExporterPlugin: reads from storage, writes to filesystem.
 * Unlike generators, exporters handle their own file I/O and don't produce SummaryItems.
 */

import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, DiscordRawData, ExporterPlugin, ExporterResult } from "../../types";
import fs from "fs";
import path from "path";
import { logger } from "../../helpers/cliHelper";

/**
 * Configuration interface for RawDataExporter
 */
export interface RawDataExporterConfig {
  storage: SQLiteStorage;
  source: string; // e.g., 'discordRawData'
  outputPath: string;
}

/**
 * RawDataExporter fetches raw data items from storage and exports them as
 * individual JSON files per source entity (e.g., Discord channel).
 *
 * Implements ExporterPlugin:
 * - Reads ContentItems from storage for the target date
 * - Writes individual JSON files organized by guild/channel
 * - Returns ExporterResult with file count and status
 */
export class RawDataExporter implements ExporterPlugin {
  public readonly name: string;

  private storage: SQLiteStorage;
  private source: string;
  private outputPath: string;

  static constructorInterface = {
    parameters: [
      {
        name: 'storage',
        type: 'StoragePlugin',
        required: true,
        description: 'Storage Plugin to read content items from.'
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Specific content type to export (e.g., "discordRawData").'
      },
      {
        name: 'outputPath',
        type: 'string',
        required: false,
        description: 'Base directory for exported files.'
      }
    ]
  };

  constructor(config: RawDataExporterConfig) {
    this.name = (config as any).name || 'RawDataExporter';
    this.storage = config.storage;
    this.source = config.source;
    this.outputPath = config.outputPath;
    this.ensureDirectoryExists(this.outputPath);
  }

  // ============================================
  // ExporterPlugin interface
  // ============================================

  /**
   * Export raw data for a single date.
   * Reads content items from storage and writes them as individual JSON files.
   *
   * @param dateStr - ISO date string (YYYY-MM-DD)
   * @returns ExporterResult with file count and status
   */
  public async export(dateStr: string): Promise<ExporterResult> {
    const operation = `export(Source: ${this.source}, Date: ${dateStr})`;
    logger.info(`[RawDataExporter:${operation}] Starting export...`);
    let processedCount = 0;

    try {
      const startTimeEpoch = new Date(dateStr).setUTCHours(0, 0, 0, 0) / 1000;
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60);

      // Fetch items of the specified source type for the given day
      logger.info(`[RawDataExporter:${operation}] Fetching items between ${new Date(startTimeEpoch * 1000).toISOString()} and ${new Date(endTimeEpoch * 1000).toISOString()} for type '${this.source}'`);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(
        startTimeEpoch,
        endTimeEpoch,
        this.source
      );
      const fetchedCount = contentItems.length;
      logger.info(`[RawDataExporter:${operation}] Found ${fetchedCount} items in storage.`);

      if (contentItems.length === 0) {
        logger.info(`No raw data found for source '${this.source}' on date ${dateStr}.`);
        return { success: true, filesWritten: 0 };
      }

      // Process each raw data item individually
      logger.info(`[RawDataExporter:${operation}] Processing ${fetchedCount} fetched items...`);
      for (const item of contentItems) {
        // Check type explicitly
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
          parsedData = JSON.parse(item.text);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          logger.error(`[RawDataExporter:${operation}] Error parsing JSON for item cid ${item.cid}: ${error}`);
          continue;
        }

        // Determine subfolder structure (e.g., for Discord: guild/channel)
        let subFolders: string[] = [];
        let baseFilename = `${dateStr}.json`;

        if (item.type === 'discordRawData') {
          const guildName = item.metadata?.guildName || 'UnknownGuild';
          const channelName = item.metadata?.channelName || (parsedData as DiscordRawData)?.channel?.name || 'UnknownChannel';
          const sanitizedGuild = this.sanitizeName(guildName);
          const sanitizedChannel = this.sanitizeName(channelName);
          subFolders = [sanitizedGuild, sanitizedChannel];
        } else {
          logger.warning(`[RawDataExporter:${operation}] Unhandled raw data type '${item.type}' for cid ${item.cid}. Saving to base path.`);
          baseFilename = `${this.sanitizeName(item.cid || `item_${item.id}`)}.json`;
        }

        // Construct path and ensure directory
        const targetDir = path.join(this.outputPath, ...subFolders);
        const targetFilePath = path.join(targetDir, baseFilename);
        this.ensureDirectoryExists(targetDir);

        // Write individual file
        try {
          const exportJsonContent = JSON.stringify(parsedData, null, 2);
          fs.writeFileSync(targetFilePath, exportJsonContent);
          processedCount++;
          logger.success(`[RawDataExporter:${operation}] Exported item cid ${item.cid} to ${targetFilePath}`);
        } catch (writeError) {
          const error = writeError instanceof Error ? writeError.message : String(writeError);
          logger.error(`[RawDataExporter:${operation}] Error writing file ${targetFilePath}: ${error}`);
        }
      }

      logger.success(`[RawDataExporter:${operation}] Export complete. Processed ${processedCount}/${fetchedCount} items.`);
      return { success: true, filesWritten: processedCount };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[RawDataExporter:${operation}] Top-level error: ${errorMessage}`);
      return { success: false, filesWritten: processedCount, error: errorMessage };
    }
  }

  /**
   * Export raw data for a date range.
   * Iterates over each date in the range and exports individually.
   *
   * @param startDate - ISO date string (YYYY-MM-DD)
   * @param endDate - ISO date string (YYYY-MM-DD)
   * @returns ExporterResult with total file count and status
   */
  public async exportRange(startDate: string, endDate: string): Promise<ExporterResult> {
    let totalFilesWritten = 0;
    const errors: string[] = [];

    const start = new Date(startDate);
    const end = new Date(endDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      const result = await this.export(dateStr);
      totalFilesWritten += result.filesWritten;
      if (!result.success && result.error) {
        errors.push(`${dateStr}: ${result.error}`);
      }
      current.setDate(current.getDate() + 1);
    }

    return {
      success: errors.length === 0,
      filesWritten: totalFilesWritten,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  // ============================================
  // Internal helpers
  // ============================================

  /**
   * Sanitizes a string for use as a directory or file name.
   */
  private sanitizeName(name: string): string {
    if (!name) return 'unknown';
    return name
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .replace(/__+/g, '_')
      .toLowerCase();
  }

  /**
   * Ensures a directory exists, creating it if necessary.
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
}
