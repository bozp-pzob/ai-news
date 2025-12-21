/**
 * Historical data collection and processing entry point.
 * This script allows fetching historical data from sources and generating summaries
 * for specific dates or date ranges.
 * 
 * @module historical
 */

import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
import { MediaDownloader, generateManifestToFile } from "./download-media";
import { MediaDownloadCapable } from "./plugins/sources/DiscordRawDataSource";
import { logger } from "./helpers/cliHelper";
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
function hasMediaDownloadCapability(source: any): source is MediaDownloadCapable & { name: string } {
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
    
    if (args.includes('--help') || args.includes('-h')) {
      logger.info(`
Historical Data Fetcher & Summarizer

Usage:
  npm run historical -- --source=<config_file.json> [options]

Options:
  --source=<file>       JSON configuration file (default: sources.json)
  --date=<YYYY-MM-DD>   Specific date to fetch data for (default: today)
  --before=<YYYY-MM-DD> End date for a range.
  --after=<YYYY-MM-DD>  Start date for a range.
  --during=<YYYY-MM-DD> Alias for --date.
  --onlyFetch=<true|false>  Only fetch data, do not generate summaries.
  --onlyGenerate=<true|false> Only generate summaries from existing data, do not fetch.
  --download-media=<true|false> Download Discord media after data collection (default: false).
  --output=<path>       Output directory path (default: ./)
  -h, --help            Show this help message.

Examples:
  npm run historical -- --date=2024-01-15
  npm run historical -- --after=2024-01-10 --before=2024-01-15
  npm run historical -- --source=elizaos.json --download-media=true
      `);
      process.exit(0);
    }
    const today = new Date();
    let sourceFile = "sources.json";
    let dateStr = today.toISOString().slice(0, 10);
    let onlyFetch = false;
    let onlyGenerate = false;
    let downloadMedia = false;
    let generateManifest = false;
    let manifestOutput: string | undefined;
    let beforeDate;
    let afterDate;
    let duringDate;
    let outputPath = './'; // Default output path
    let downloadMedia = false;

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
  --generate-manifest=<true|false> Generate media manifest JSON for VPS downloads (default: false).
  --manifest-output=<path> Output path for manifest file (default: <output>/media-manifest.json).
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
      } else if (arg.startsWith('--generate-manifest=')) {
        generateManifest = arg.split('=')[1].toLowerCase() == 'true';
      } else if (arg.startsWith('--manifest-output=')) {
        manifestOutput = arg.split('=')[1];
      } else if (arg.startsWith('--before=')) {
        beforeDate = arg.split('=')[1];
      } else if (arg.startsWith('--after=')) {
        afterDate = arg.split('=')[1];
      } else if (arg.startsWith('--during=')) {
        duringDate = arg.split('=')[1];
      } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
        outputPath = arg.split('=')[1];
      } else if (arg.startsWith('--download-media=')) {
        downloadMedia = arg.split('=')[1].toLowerCase() === 'true';
      }
    });

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
     * Load and parse the JSON configuration file
     * This contains settings for all plugins and their parameters
     */
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);

    /**
     * Apply configuration overrides from the JSON file
     * These settings control the behavior of the historical aggregator
     */
    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON?.settings?.onlyFetch || onlyFetch;
    }
    if (typeof configJSON?.settings?.onlyGenerate === 'boolean') {
      onlyGenerate = configJSON?.settings?.onlyGenerate || onlyGenerate;
    }
    
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
     * Override media download settings if --download-media flag is provided
     */
    if (downloadMedia) {
      sourceConfigs.forEach(config => {
        if (config.instance && config.instance.mediaDownload !== undefined) {
          console.log(`[INFO] Enabling media download for source: ${config.instance.name} (overriding config)`);
          config.instance.mediaDownload.enabled = true;
        }
      });
    }
    
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
     * Download media files if --download-media flag is enabled
     * This runs after historical data fetching but before summary generation
     */
    if (downloadMedia && !onlyGenerate) {
      logger.info("Starting media downloads...");
      logger.info(`Found ${sourceConfigs.length} source configs to check`);
      
      // Find sources with media download capability
      const mediaCapableSources = sourceConfigs.filter(config => 
        hasMediaDownloadCapability(config.instance) && config.instance.hasMediaDownloadEnabled()
      );
      
      if (mediaCapableSources.length === 0) {
        logger.warning("No sources with media download enabled found.");
      } else {
        for (const sourceConfig of mediaCapableSources) {
          logger.debug(`Checking source: ${sourceConfig.instance.name}`);
          logger.info(`✓ Source ${sourceConfig.instance.name} supports media downloads`);
          const mediaConfig = sourceConfig.instance.mediaDownload;
          logger.debug(`Media config: ${JSON.stringify(mediaConfig)}`);
          if (mediaConfig?.enabled) {
            logger.info(`Downloading media for ${sourceConfig.instance.name}...`);
            
            try {
              const storage = (sourceConfig.instance as any).storage;
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
                stats = await downloader.downloadMediaForDate(new Date(filter.date));
              }
              
              downloader.printStats();
              await downloader.close();
              logger.info(`✅ Media download completed for source: ${sourceConfig.instance.name}`);
              
            } catch (error) {
              logger.error(`❌ Media download failed for source ${sourceConfig.instance.name}: ${error}`);
            }
          }
        }
      }
    }

    /**
     * Generate media manifest if requested
     * Creates a JSON file listing all media URLs for VPS download
     */
    if (generateManifest && !onlyGenerate) {
      logger.info("Generating media manifest...");

      for (const config of sourceConfigs) {
        if (hasMediaDownloadCapability(config.instance)) {
          try {
            const storage = (config.instance as any).storage;
            const dbPath = storage?.dbPath || './data/db.sqlite';

            // Determine source name from config
            const sourceName = sourceFile.replace('.json', '').replace('-discord', '');

            // Determine manifest output path
            const manifestPath = manifestOutput || path.join(outputPath, sourceName, 'media-manifest.json');

            // Ensure output directory exists
            const manifestDir = path.dirname(manifestPath);
            if (!fs.existsSync(manifestDir)) {
              fs.mkdirSync(manifestDir, { recursive: true });
            }

            // Generate manifest for date or date range
            if (filter.filterType || (filter.after && filter.before)) {
              // Date range - generate combined manifest
              const startDate = filter.after || filter.date;
              const endDate = filter.before || filter.date;
              logger.info(`Generating manifest for date range: ${startDate} to ${endDate}`);
              await generateManifestToFile(dbPath, startDate, sourceName, manifestPath, endDate);
            } else {
              // Single date
              logger.info(`Generating manifest for date: ${dateStr}`);
              await generateManifestToFile(dbPath, dateStr, sourceName, manifestPath);
            }

            logger.success(`Media manifest generated: ${manifestPath}`);
          } catch (error) {
            logger.error(`Manifest generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          break; // Only generate one manifest per run
        }
      }
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
