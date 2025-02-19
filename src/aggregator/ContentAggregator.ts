// src/aggregator/ContentAggregator.ts

import { ContentSource } from "../plugins/sources/ContentSource";
import { StoragePlugin } from "../plugins/storage/StoragePlugin";
import { ContentItem, EnricherPlugin } from "../types";

export class ContentAggregator {
  private sources: ContentSource[] = [];
  private enrichers: EnricherPlugin[] = [];
  private storage: StoragePlugin | undefined = undefined;

  public registerSource(source: ContentSource) {
    this.sources.push(source);
  }
  
  public registerEnricher(enricher: EnricherPlugin): void {
    this.enrichers.push(enricher);
  }
  
  public registerStorage(storage: StoragePlugin): void {
    this.storage = storage;
  }
  
  /**
   * Save items source
   */
  public async saveItems(items : ContentItem[], sourceName : string) {
    if (! this.storage) {
      console.error(`Error aggregator storage hasn't be set.`);
      return
    }

    try {
      if (items.length > 0) {
        await this.storage.save(items);
        console.log(`Stored ${items.length} items from source: ${sourceName}`);
      } else {
        console.log(`No new items fetched from source: ${sourceName}`);
      }
    } catch (error) {
      console.error(`Error fetching/storing data from source ${sourceName}:`, error);
    }
  }

  /**
   * Fetch items from all registered sources
   */
  public async fetchAll(): Promise<ContentItem[]> {
    let allItems: ContentItem[] = [];
    for (const source of this.sources) {
      try {
        const items = await source.fetchItems();
        allItems = allItems.concat(items);
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error);
      }
    }

    // Apply each enricher to the entire articles array
    for (const enricher of this.enrichers) {
        allItems = await enricher.enrich(allItems);
    }

    return allItems;
  }

  /**
   * Fetch items from all registered sources
   */
  public async fetchSource(sourceName: string): Promise<ContentItem[]> {
    let allItems: ContentItem[] = [];
    for (const source of this.sources) {
      try {
        if ( source.name === sourceName ) {
          const items = await source.fetchItems();
          allItems = allItems.concat(items);
        }
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error);
      }
    }

    // Apply each enricher to the entire articles array
    for (const enricher of this.enrichers) {
        allItems = await enricher.enrich(allItems);
    }

    return allItems;
  }
  
  public async fetchAndStore(sourceName: string) {
    try {
      console.log(`Fetching data from source: ${sourceName}`);
      const items = await this.fetchSource(sourceName);
      await this.saveItems(items, sourceName);
    } catch (error) {
      console.error(`Error fetching/storing data from source ${sourceName}:`, error);
    }
  };
}