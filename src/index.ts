/**
 * Main entry point for the AI News Aggregator application.
 * This file initializes the content aggregator, loads configurations,
 * and sets up the data collection and processing pipeline.
 * 
 * @module index
 */

import { ContentAggregator } from "./aggregator/ContentAggregator";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
  loadStorage,
  validateConfiguration
} from "./helpers/configHelper";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

(async () => {
  try {
    /**
     * Parse command line arguments for configuration overrides
     * --source: JSON configuration file path
     * --onlyFetch: Only fetch data without generating summaries
     * --output/-o: Output directory path
     */
    const args = process.argv.slice(2);
    let sourceFile = "sources.json";
    let runOnce = false;
    let onlyFetch = false;
    let onlyGenerate = false;
    let outputPath = './'; // Default output path
    
    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      }
      if (arg.startsWith('--onlyGenerate=')) {
        onlyGenerate = arg.split('=')[1].toLowerCase() == 'true';
      }
      if (arg.startsWith('--onlyFetch=')) {
        onlyFetch = arg.split('=')[1].toLowerCase() == 'true';
      }
      if (arg.startsWith('--output=') || arg.startsWith('-o=')) {
        outputPath = arg.split('=')[1];
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
     * These settings control the behavior of the aggregator
     */
    if (typeof configJSON?.settings?.runOnce === 'boolean') {
      runOnce = configJSON?.settings?.runOnce || runOnce;
    }
    if (typeof configJSON?.settings?.onlyGenerate === 'boolean') {
      onlyGenerate = configJSON?.settings?.onlyGenerate || onlyGenerate;
    }
    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON?.settings?.onlyFetch || onlyFetch;
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
     * Initialize the content aggregator and register all plugins
     * This sets up the data collection and processing pipeline
     */
    const aggregator = new ContentAggregator();
    sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
    
    /**
     * Initialize storage plugins and register them with the aggregator
     * Currently only one storage plugin is supported
     */
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

    /**
     * Set up data collection schedules for each source
     * Each source runs at its configured interval
     */
    if (!onlyGenerate) {
      for (const config of sourceConfigs) {
        await aggregator.fetchAndStore(config.instance.name);
  
        setInterval(() => {
          aggregator.fetchAndStore(config.instance.name);
        }, config.interval);
      }
    }
    
    /**
     * Set up summary generation if not in fetch-only mode
     * Each generator runs at its configured interval
     */
    if (!onlyFetch) {
      for (const generator of generatorConfigs) {
        await generator.instance.generateContent();

        setInterval(() => {
          generator.instance.generateContent();
        }, generator.interval);
      }
    }
    else {
      console.log("Summary will not be generated.");
    }

    console.log("Content aggregator is running and scheduled.");
    
    /**
     * Set up graceful shutdown handlers
     * This ensures resources are properly released when the application exits
     */
    const shutdown = async () => {
      console.log("Shutting down...");
      storageConfigs.forEach(async (storage : any) => {
        await storage.close();
      });
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    /**
     * Handle run-once mode
     * If enabled, the application will exit after a single run
     */
    if (runOnce) {
      await shutdown();
      console.log("Content aggregator is complete.");
    }
  } catch (error) {
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();
