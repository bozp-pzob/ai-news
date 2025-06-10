// src/aggregator/ContentAggregator.ts

/**
 * Core content aggregation engine.
 * This class manages the collection, processing, and storage of content from multiple sources.
 * 
 * @module aggregator
 */

import { ContentSource } from "../plugins/sources/ContentSource";
import { StoragePlugin } from "../plugins/storage/StoragePlugin";
import { ContentItem, EnricherPlugin } from "../types";

/**
 * ContentAggregator class that orchestrates the collection and processing of content.
 * 
 * This class:
 * - Manages multiple content sources
 * - Applies content enrichers
 * - Handles storage of processed content
 * - Provides methods for fetching and processing content
 */
export class ContentAggregator {
  /** Registered content sources */
  private sources: ContentSource[] = [];
  /** Registered content enrichers */
  private enrichers: EnricherPlugin[] = [];
  /** Storage plugin for persisting content */
  private storage: StoragePlugin | undefined = undefined;

  /**
   * Registers a content source with the aggregator
   * 
   * @param source - The content source to register
   */
  public registerSource(source: ContentSource) {
    this.sources.push(source);
  }
  
  /**
   * Registers a content enricher with the aggregator
   * 
   * @param enricher - The enricher to register
   */
  public registerEnricher(enricher: EnricherPlugin): void {
    this.enrichers.push(enricher);
  }
  
  /**
   * Registers a storage plugin with the aggregator
   * 
   * @param storage - The storage plugin to register
   */
  public registerStorage(storage: StoragePlugin): void {
    this.storage = storage;
  }
  
  /**
   * Saves content items to storage
   * 
   * @param items - The content items to save
   * @param sourceName - The name of the source that provided the items
   */
  public async saveItems(items : ContentItem[], sourceName : string) {
    if (! this.storage) {
      console.error(`Error aggregator storage hasn't be set.`);
      return
    }

    try {
      if (items.length > 0) {
        await this.storage.saveContentItems(items);
        console.log(`Stored ${items.length} items from source: ${sourceName}`);
      } else {
        console.log(`No new items fetched from source: ${sourceName}`);
      }
    } catch (error) {
      console.error(`Error fetching/storing data from source ${sourceName}:`, error);
    }
  }

  /**
   * Fetches content from all registered sources
   * 
   * This method:
   * 1. Fetches content from each source
   * 2. Processes the content to remove duplicates
   * 3. Applies all registered enrichers
   * 
   * @returns A promise that resolves to an array of processed content items
   */
  public async fetchAll(): Promise<ContentItem[]> {
    let allItems: ContentItem[] = [];
    try {
      for (const source of this.sources) {
        const items = await source.fetchItems();
        allItems = allItems.concat(items);
      }

      allItems = await this.processItems(allItems);

      // Apply each enricher to the entire articles array
      for (const enricher of this.enrichers) {
        allItems = await enricher.enrich(allItems);
      }
    } catch (error) {
      console.error(`Error Fetch All: `, error);
    }

    return allItems;
  }

  /**
   * Fetches content from a specific source
   * 
   * This method:
   * 1. Fetches content from the specified source
   * 2. Processes the content to remove duplicates
   * 3. Applies all registered enrichers
   * 
   * @param sourceName - The name of the source to fetch from
   * @returns A promise that resolves to an array of processed content items
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

    allItems = await this.processItems(allItems);

    // Apply each enricher to the entire articles array
    for (const enricher of this.enrichers) {
        allItems = await enricher.enrich(allItems);
    }

    return allItems;
  }
  
  /**
   * Fetches content from a source and saves it to storage
   * 
   * @param sourceName - The name of the source to fetch from
   */
  public async fetchAndStore(sourceName: string) {
    try {
      console.log(`Fetching data from source: ${sourceName}`);
      const items = await this.fetchSource(sourceName);
      await this.saveItems(items, sourceName);
    } catch (error) {
      console.error(`Error fetching/storing data from source ${sourceName}:`, error);
    }
  };

  /**
   * Processes content items to remove duplicates
   * 
   * This method:
   * 1. Checks if each item already exists in storage
   * 2. Returns only items that don't exist yet
   * 
   * @param items - The content items to process
   * @returns A promise that resolves to an array of new content items
   * @throws Error if storage plugin is not set
   */
  public async processItems(items: ContentItem[]): Promise<ContentItem[]> {
    if (! this.storage) {
      throw("Storage Plugin is not set for Aggregator.")
    }

    let allItems: ContentItem[] = [];
    for (const item of items) {
      if ( item && item.cid ) {
        const exists = await this.storage.getContentItem(item.cid);
        if (! exists) {
          allItems.push(item)
        }
      }
    }
    
    return allItems;
  }
}