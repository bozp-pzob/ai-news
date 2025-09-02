/**
 * Historical data collection and processing entry point.
 * This script allows fetching historical data from sources and generating summaries
 * for specific dates or date ranges.
 * 
 * @module historical
 */

import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
import { MediaDownloader } from "./download-media";
import { MediaDownloadCapable } from "./plugins/sources/DiscordRawDataSource";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
  loadStorage,
  validateConfiguration
} from "./helpers/configHelper";
import { addOneDay, parseDate, formatDate, callbackDateRangeLogic } from "./helpers/dateHelper";
import { logger } from "./helpers/cliHelper";

dotenv.config();

/**
 * Type guard to check if a source supports media downloading
 */
function hasMediaDownloadCapability(source: any): source is MediaDownloadCapable {
  return source && typeof source.hasMediaDownloadEnabled === 'function';
}

(async () => {
  try {
    /**
     * Parse command line arguments for historical data collection
     * --source: JSON configuration file path
     * --date: Specific date to fetch data for
     * --before: End date for range fetching
     * --after: Start date for range fetching
     * --during: Date to fetch data during
     * --onlyFetch: Only fetch data without generating summaries
     * --download-media: Enable media downloads after data collection
     * --output/-o: Output directory path
     */
    const args = process.argv.slice(2);
    const today = new Date();
    let sourceFile = "sources.json";
    let dateStr = today.toISOString().slice(0, 10);
    let onlyFetch = false;
    let onlyGenerate = false;
    let downloadMedia = false;
    let beforeDate;
    let afterDate;
    let duringDate;
    let outputPath = './'; // Default output path

    if (args.includes('--help') || args.includes('-h')) {
      logger.info(`
Historical Data Fetcher & Summarizer

Usage:
  npm run historical -- --source=<config_file.json> [options]
  ts-node src/historical.ts --source=<config_file.json> [options]

Options:
  --source=<file>       JSON configuration file path (default: sources.json)
  --date=<YYYY-MM-DD>   Specific date to process.
  --before=<YYYY-MM-DD> End date for a range.
  --after=<YYYY-MM-DD>  Start date for a range.
  --during=<YYYY-MM-DD> Alias for --date.
  --onlyFetch=<true|false>  Only fetch data, do not generate summaries.
  --onlyGenerate=<true|false> Only generate summaries from existing data, do not fetch.
  --download-media=<true|false> Download Discord media after data collection (default: false).
  --output=<path>       Output directory path (default: ./)
  -h, --help            Show this help message.
      `);
      process.exit(0);
    }

    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      } else if (arg.startsWith('--date=')) {
        dateStr = arg.split('=')[1];
      } else if (arg.startsWith('--onlyGenerate=')) {
        onlyGenerate = arg.split('=')[1].toLowerCase() == 'true';
      } else if (arg.startsWith('--onlyFetch=')) {
        onlyFetch = arg.split('=')[1].toLowerCase() == 'true';
      } else if (arg.startsWith('--download-media=')) {
        downloadMedia = arg.split('=')[1].toLowerCase() == 'true';
      } else if (arg.startsWith('--before=')) {
        beforeDate = arg.split('=')[1];
      } else if (arg.startsWith('--after=')) {
        afterDate = arg.split('=')[1];
      } else if (arg.startsWith('--during=')) {
        duringDate = arg.split('=')[1];
      } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
        outputPath = arg.split('=')[1];
      }
    });

    // Load and parse the JSON configuration file FIRST
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);


    // Apply general configuration overrides from the JSON file for settings like onlyFetch, onlyGenerate
    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON.settings.onlyFetch; // If present in config, it overrides CLI or default
      if (onlyFetch) logger.debug(`[HistoricalConfig] Setting: onlyFetch is true (from config).`);
      else logger.debug(`[HistoricalConfig] Setting: onlyFetch is false (from config).`);
    }
    if (typeof configJSON?.settings?.onlyGenerate === 'boolean') {
      onlyGenerate = configJSON.settings.onlyGenerate; // If present in config, it overrides CLI or default
      if (onlyGenerate) logger.debug(`[HistoricalConfig] Setting: onlyGenerate is true (from config).`);
      else logger.debug(`[HistoricalConfig] Setting: onlyGenerate is false (from config).`);
    }
    // Note: CLI flags for onlyFetch/onlyGenerate already set the initial values. 
    // The logic above means config file settings for these take precedence if they exist.

    /**
     * Load all plugin modules from their respective directories
     * This includes sources, AI providers, enrichers, generators, and storage plugins
     */
    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const generatorClasses = await loadDirectoryModules("generators");
    const storageClasses = await loadDirectoryModules("storage");
    
    /**
     * Initialize all plugin configurations
     * This creates instances of each plugin with their respective parameters
     */
    let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
    let generatorConfigs = await loadItems(configJSON.generators, generatorClasses, "generators");
    let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

    /**
     * Set up dependencies between plugins
     * AI providers are injected into sources, enrichers, and generators
     * Storage is injected into generators, sources
     */
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    sourceConfigs = await loadStorage(sourceConfigs, storageConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
    
    /**
     * Call the validation function
     */
    validateConfiguration({ 
        sources: sourceConfigs,
        ai: aiConfigs,
        enrichers: enricherConfigs,
        generators: generatorConfigs,
        storage: storageConfigs
    });

    /**
     * Configure output paths for all generators
     * This ensures summaries are saved to the specified location
     */
    generatorConfigs.forEach(config => {
      if (config.instance && typeof config.instance.outputPath === 'undefined') {
        config.instance.outputPath = outputPath;
      }
    });

    /**
     * Initialize the historical aggregator and register all plugins
     * This sets up the historical data collection and processing pipeline
     */
    const aggregator = new HistoricalAggregator();
  
    /**
     * Register sources that support historical data fetching
     * Only sources with fetchHistorical method are registered
     */
    sourceConfigs.forEach((config) => {
      if (config.instance?.fetchHistorical) {
        aggregator.registerSource(config.instance);
      }
    });

    /**
     * Register enrichers and storage plugins
     * These will process the historical data as it's collected
     */
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

    /**
     * Set up date filtering based on command line arguments
     * This determines whether to fetch data for a specific date or date range
     */
    let filter: any = {};
    if (beforeDate || afterDate || duringDate) {
      if (beforeDate && afterDate) {
        filter = { after: afterDate, before: beforeDate };
      } else if (duringDate) {
        filter = { filterType: 'during', date: duringDate };
      } else if (beforeDate) {
        filter = { filterType: 'before', date: beforeDate };
      } else if (afterDate) {
        filter = { filterType: 'after', date: afterDate };
      }
    }
      
    /**
     * Fetch historical data based on the date filter
     * If a date range is specified, fetch data for the entire range
     * Otherwise, fetch data for the specific date
     */
    if (!onlyGenerate) {
      if (filter.filterType || (filter.after && filter.before)) {
        for (const config of sourceConfigs) {
          await aggregator.fetchAndStoreRange(config.instance.name, filter);
        }
      } else {
        for (const config of sourceConfigs) {
          await aggregator.fetchAndStore(config.instance.name, dateStr);
        }
      }
      logger.info("Content aggregator is finished fetching historical.");
    }
    
    /**
     * Download Discord media if requested and enabled in source configs
     * Runs after data collection but before summary generation
     */
    if (downloadMedia && !onlyGenerate) {
      logger.info("Starting media downloads...");
      logger.info(`Found ${sourceConfigs.length} source configs to check`);
      
      for (const config of sourceConfigs) {
        logger.debug(`Checking source: ${config.instance.name}`);
        if (hasMediaDownloadCapability(config.instance) && config.instance.hasMediaDownloadEnabled()) {
          logger.info(`✓ Source ${config.instance.name} supports media downloads`);
          const mediaConfig = config.instance.mediaDownload;
          logger.debug(`Media config:`, mediaConfig);
          if (mediaConfig?.enabled) {
            logger.info(`Downloading media for ${config.instance.name}...`);
            
            try {
              const storage = (config.instance as any).storage;
              const dbPath = storage.dbPath || './data/db.sqlite';
              const outputPath = mediaConfig.outputPath || './media';
              
              const downloader = new MediaDownloader(dbPath, outputPath, mediaConfig);
              await downloader.init();
              
              let stats;
              if (filter.filterType || (filter.after && filter.before)) {
                // Date range download
                const startDate = new Date(filter.after || filter.date);
                const endDate = new Date(filter.before || filter.date);
                stats = await downloader.downloadMediaInDateRange(startDate, endDate);
              } else {
                // Single date download
                const date = new Date(dateStr);
                stats = await downloader.downloadMediaForDate(date);
              }
              
              downloader.printStats();
              await downloader.close();
              logger.success(`Media download completed successfully for ${config.instance.name}`);
            } catch (error) {
              logger.error(`Media download failed for ${config.instance.name}: ${error instanceof Error ? error.message : String(error)}`);
              // Continue processing other sources rather than failing completely
            }
          }
        }
      }
      
      logger.info("Media downloads completed.");
    }


    /**
     * Generate summaries if not in fetch-only mode
     * For date ranges, generate summaries for each date in the range
     * For specific dates, generate a summary for that date
     */
    if (!onlyFetch) {
      if (filter.filterType || (filter.after && filter.before)) {
        for (const generator of generatorConfigs) {
          await generator.instance.storage.init();
          await callbackDateRangeLogic(filter, (dateStr:string) => generator.instance.generateAndStoreSummary(dateStr));
        }
      } else {
        logger.info(`Creating summary for date ${dateStr}`);
        for (const generator of generatorConfigs) {
          await generator.instance.storage.init();
          await generator.instance.generateAndStoreSummary(dateStr);
        }
      }
    }
    else {
      logger.info("Historical Data successfully saved. Summary wasn't generated");
    }

    /**
     * Clean up resources and exit
     * This ensures all storage connections are properly closed
     */
    logger.info("Shutting down...");
    storageConfigs.forEach(async (storage : any) => {
      await storage.close();
    });

    process.exit(0);
  } catch (error) {
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();
