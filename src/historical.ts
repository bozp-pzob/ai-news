import { HistoricalAggregator } from "./aggregator/HistoricalAggregator";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from "./helpers/configHelper";
import { addOneDay, parseDate, formatDate, callbackDateRangeLogic } from "./helpers/dateHelper";

dotenv.config();

(async () => {
  try {
    // Fetch override args to get run specific source config
    const args = process.argv.slice(2);
    const today = new Date();
    let sourceFile = "sources.json";
    let dateStr = today.toISOString().slice(0, 10);
    let onlyFetch = false;
    let beforeDate;
    let afterDate;
    let duringDate;
    let outputPath = './'; // Default output path

    args.forEach(arg => {
      if (arg.startsWith('--source=')) {
        sourceFile = arg.split('=')[1];
      } else if (arg.startsWith('--date=')) {
        dateStr = arg.split('=')[1];
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
      }
    });

    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const generatorClasses = await loadDirectoryModules("generators");
    const storageClasses = await loadDirectoryModules("storage");
    
    // Load the JSON configuration file
    const configPath = path.join(__dirname, "../config", sourceFile);
    const configFile = fs.readFileSync(configPath, "utf8");
    const configJSON = JSON.parse(configFile);

    if (typeof configJSON?.settings?.onlyFetch === 'boolean') {
      onlyFetch = configJSON?.settings?.onlyFetch || onlyFetch;
    }
    
    let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(configJSON.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
    let generatorConfigs = await loadItems(configJSON.generators, generatorClasses, "generators");
    let storageConfigs = await loadItems(configJSON.storage, storageClasses, "storage");

    // If any configs depends on the AI provider, set it here
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);

    // If any configs depends on the storage, set it here
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
    
    // Set output path for generators
    generatorConfigs.forEach(config => {
      if (config.instance && typeof config.instance.outputPath === 'undefined') {
        config.instance.outputPath = outputPath;
      }
    });

    const aggregator = new HistoricalAggregator();
  
    // Register Sources under Aggregator
    sourceConfigs.forEach((config) => {
      if (config.instance?.fetchHistorical) {
        aggregator.registerSource(config.instance);
      }
    });

    // Register Enrichers under Aggregator
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
  
    // Initialize and Register Storage, Should just be one Storage Plugin for now.
    storageConfigs.forEach(async (storage : any) => {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    });

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
