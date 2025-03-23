import { ContentAggregator } from "../aggregator/ContentAggregator";
import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from "../helpers/configHelper";
import { Config } from "./configService";

export class AggregatorService {
  private activeAggregators: { [key: string]: ContentAggregator } = {};

  async startAggregation(configName: string, config: Config): Promise<void> {
    // Load all necessary modules
    const sourceClasses = await loadDirectoryModules("sources");
    const aiClasses = await loadDirectoryModules("ai");
    const enricherClasses = await loadDirectoryModules("enrichers");
    const generatorClasses = await loadDirectoryModules("generators");
    const storageClasses = await loadDirectoryModules("storage");

    // Load configurations
    let aiConfigs = await loadItems(config.ai, aiClasses, "ai");
    let sourceConfigs = await loadItems(config.sources, sourceClasses, "source");
    let enricherConfigs = await loadItems(config.enrichers, enricherClasses, "enrichers");
    let generatorConfigs = await loadItems(config.generators, generatorClasses, "generators");
    let storageConfigs = await loadItems(config.storage, storageClasses, "storage");

    // Set up dependencies
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);

    // Create and initialize aggregator
    const aggregator = new ContentAggregator();
    sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));
    enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
    
    for (const storage of storageConfigs) {
      await storage.instance.init();
      aggregator.registerStorage(storage.instance);
    }

    // Store the aggregator instance
    this.activeAggregators[configName] = aggregator;

    // Start fetching and generating content
    for (const config of sourceConfigs) {
      await aggregator.fetchAndStore(config.instance.name);
      setInterval(() => {
        aggregator.fetchAndStore(config.instance.name);
      }, config.interval);
    }

    if (!config.settings?.onlyFetch) {
      for (const generator of generatorConfigs) {
        await generator.instance.generateContent();
        setInterval(() => {
          generator.instance.generateContent();
        }, generator.interval);
      }
    }
  }

  stopAggregation(configName: string): void {
    if (this.activeAggregators[configName]) {
      delete this.activeAggregators[configName];
    }
  }

  getAggregationStatus(configName: string): 'running' | 'stopped' {
    return this.activeAggregators[configName] ? 'running' : 'stopped';
  }
} 