/**
 * Historical content aggregation engine.
 * This class manages the collection, processing, and storage of historical content from multiple sources.
 * 
 * @module aggregator
 */

import { addOneDay, callbackDateRangeLogic, formatDate, parseDate } from "../helpers/dateHelper";
import { ContentSource } from "../plugins/sources/ContentSource";
import { StoragePlugin } from "../plugins/storage/StoragePlugin";
import { ContentItem, EnricherPlugin, DateConfig } from "../types";

/**
 * HistoricalAggregator class that orchestrates the collection and processing of historical content.
 * 
 * This class:
 * - Manages multiple content sources with historical data capabilities
 * - Applies content enrichers to historical data
 * - Handles storage of processed historical content
 * - Provides methods for fetching and processing content for specific dates or date ranges
 */
export class HistoricalAggregator {
  /** Registered content sources with historical data capabilities */
  private sources: ContentSource[] = [];
  /** Registered content enrichers */
  private enrichers: EnricherPlugin[] = [];
  /** Storage plugin for persisting content */
  private storage: StoragePlugin | undefined = undefined;

  /**
   * Registers a content source with the historical aggregator
   * 
   * @param source - The content source to register
   */
  public registerSource(source: ContentSource) {
    this.sources.push(source);
  }
  
  /**
   * Registers a content enricher with the historical aggregator
   * 
   * @param enricher - The enricher to register
   */
  public registerEnricher(enricher: EnricherPlugin): void {
    this.enrichers.push(enricher);
  }
  
  /**
   * Registers a storage plugin with the historical aggregator
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
   * Fetches historical content from all registered sources for a specific date
   * 
   * This method:
   * 1. Fetches historical content from each source that supports it
   * 2. Processes the content to remove duplicates
   * 3. Applies all registered enrichers
   * 
   * @param date - The date to fetch historical content for (YYYY-MM-DD format)
   * @returns A promise that resolves to an array of processed content items
   */
  public async fetchAll(date: string): Promise<ContentItem[]> {
    let allItems: ContentItem[] = [];
    for (const source of this.sources) {
      try {
        if ( source.fetchHistorical ) {
          const items = await source.fetchHistorical(date);
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
   * Fetches historical content from a specific source for a specific date
   * 
   * This method:
   * 1. Fetches historical content from the specified source
   * 2. Processes the content to remove duplicates
   * 3. Applies all registered enrichers
   * 
   * @param sourceName - The name of the source to fetch from
   * @param date - The date to fetch historical content for (YYYY-MM-DD format)
   * @returns A promise that resolves to an array of processed content items
   */
  public async fetchSource(sourceName: string, date: string): Promise<ContentItem[]> {
    let allItems: ContentItem[] = [];
    for (const source of this.sources) {
      try {
        if ( source.name === sourceName ) {
          if ( source.fetchHistorical ) {
            const items = await source.fetchHistorical(date);
            allItems = allItems.concat(items);
          }
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
   * Fetches historical content from a source for a specific date and saves it to storage
   * 
   * @param sourceName - The name of the source to fetch from
   * @param date - The date to fetch historical content for (YYYY-MM-DD format)
   */
  public async fetchAndStore(sourceName: string, date : string) {
    try {
      console.log(`Fetching data from source: ${sourceName} for Date: ${date}`);
      const items = await this.fetchSource(sourceName, date);
      await this.saveItems(items, sourceName);
    } catch (error) {
      console.error(`Error fetching/storing data from source ${sourceName}:`, error);
    }
  };
  
  /**
   * Fetches historical content from a source for a date range and saves it to storage
   * 
   * This method:
   * 1. Determines the date range based on the filter
   * 2. Fetches and stores content for each date in the range
   * 
   * @param sourceName - The name of the source to fetch from
   * @param filter - The date filter configuration
   */
  public async fetchAndStoreRange(sourceName: string, filter: DateConfig) {
    try {
      await callbackDateRangeLogic(filter, (dayStr:string) => this.fetchAndStore(sourceName, dayStr))
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
  };
}