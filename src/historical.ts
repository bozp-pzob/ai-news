/**
 * Historical data collection and processing entry point.
 * This script allows fetching historical data from sources and generating summaries
 * for specific dates or date ranges.
 * 
 * @module historical
 */

import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
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

dotenv.config();

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
     * --output/-o: Output directory path
     * --fetchMode: Twitter source fetch mode
     */
    const args = process.argv.slice(2);
    const today = new Date();
    let sourceFile = "sources.json";
    let dateStr = today.toISOString().slice(0, 10);
    let onlyFetch = false;
    let onlyGenerate = false;
    let beforeDate;
    let afterDate;
    let duringDate;
    let outputPath = './'; // Default output path
    let fetchMode: 'search' | 'timeline' = 'search'; // Default to 'search' for historical script

    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
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
  --output=<path>       Output directory path (default: ./)
  --fetchMode=<search|timeline> Twitter source fetch mode (default: search).
                          'search': Faster, uses Twitter search for the specified date. Good for original tweets.
                          'timeline': More comprehensive, scans user timelines. Better for retweets but slower.
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
      } else if (arg.startsWith('--before=')) {
        beforeDate = arg.split('=')[1];
      } else if (arg.startsWith('--after=')) {
        afterDate = arg.split('=')[1];
      } else if (arg.startsWith('--during=')) {
        duringDate = arg.split('=')[1];
      } else if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
        outputPath = arg.split('=')[1];
      } else if (arg.startsWith('--fetchMode=')) {
        const modeArg = arg.split('=')[1].toLowerCase();
        if (modeArg === 'search' || modeArg === 'timeline') {
          fetchMode = modeArg as 'search' | 'timeline';
        } else {
          console.warn(`Invalid --fetchMode value: "${modeArg}". Using default "${fetchMode}".`);
        }
      }
    });

    // Load and parse the JSON configuration file FIRST
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);

    // NOW, inject fetchMode into TwitterSource params within configJSON BEFORE loadItems
    if (configJSON.sources && Array.isArray(configJSON.sources)) {
      configJSON.sources.forEach((sourceConfig: any) => {
        if (sourceConfig.type === "TwitterSource") {
          if (!sourceConfig.params) {
            sourceConfig.params = {};
          }
          sourceConfig.params.fetchMode = fetchMode; // fetchMode is from arg parsing
          console.log(`[HistoricalConfig] Injecting fetchMode: '${fetchMode}' into TwitterSource config.`);
        }
      });
    }

    // Apply general configuration overrides from the JSON file for settings like onlyFetch, onlyGenerate
    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON.settings.onlyFetch; // If present in config, it overrides CLI or default
      if (onlyFetch) console.log(`[HistoricalConfig] Setting: onlyFetch is true (from config).`);
      else console.log(`[HistoricalConfig] Setting: onlyFetch is false (from config).`);
    }
    if (typeof configJSON?.settings?.onlyGenerate === 'boolean') {
      onlyGenerate = configJSON.settings.onlyGenerate; // If present in config, it overrides CLI or default
      if (onlyGenerate) console.log(`[HistoricalConfig] Setting: onlyGenerate is true (from config).`);
      else console.log(`[HistoricalConfig] Setting: onlyGenerate is false (from config).`);
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
      console.log("Content aggregator is finished fetching historical.");
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
        console.log(`Creating summary for date ${dateStr}`);
        for (const generator of generatorConfigs) {
          await generator.instance.storage.init();
          await generator.instance.generateAndStoreSummary(dateStr);
        }
      }
    }
    else {
      console.log("Historical Data successfully saved. Summary wasn't generated");
    }

    /**
     * Clean up resources and exit
     * This ensures all storage connections are properly closed
     */
    console.log("Shutting down...");
    storageConfigs.forEach(async (storage : any) => {
      await storage.close();
    });

    process.exit(0);
  } catch (error) {
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();
