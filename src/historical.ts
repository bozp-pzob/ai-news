import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { loadDirectoryModules, loadItems, loadProviders } from "./helpers/configHelper";

dotenv.config();

let hour = 60 * 60 * 1000;
let day = 24 * hour;

let dailySummaryInterval;

(async () => {
  try {
    // Fetch overide args to get run specific source config
    const args = process.argv.slice(2);
    let sourceFile = "sources.json"
    let days = 60;
    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      }
      if (arg.startsWith('--days=')) {
        days = parseInt(arg.split('=')[1] || "60");
      }
    });

    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const storageClasses = await loadDirectoryModules("storage");
    
    // Load the JSON configuration file
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);
    
    let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
    let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

    // If any configs depends on the AI provider, set it here
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
  
    const aggregator = new HistoricalAggregator();
  
    // Register Sources under Aggregator
    sourceConfigs.forEach((config) => {
      if ( config.instance?.fetchHistorical) {
        aggregator.registerSource(config.instance)
      }
    });

    // Register Enrichers under Aggregator
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
  
    // Initialize and Register Storage, Should just be one Storage Plugin for now.
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

    for ( const config of sourceConfigs ) {
      await aggregator.fetchAndStore(config.instance.name, days);
    };

    console.log("Content aggregator is finished fetching historical.");

  } catch (error) {
    clearInterval(dailySummaryInterval);
    console.error("Error initializing the content aggregator:", error);
    process.exit(1);
  }
})();