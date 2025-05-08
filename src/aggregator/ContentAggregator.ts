// src/aggregator/ContentAggregator.ts

/**
 * Core content aggregation engine.
 * This class manages the collection, processing, and storage of content from multiple sources.
 * 
 * @module aggregator
 */

import { ContentSource } from "../plugins/sources/ContentSource";
import { StoragePlugin } from "../plugins/storage/StoragePlugin";
import { ContentItem, EnricherPlugin, AggregationStatus } from "../types";

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
  private _status: AggregationStatus = {
    status: 'running',
    currentPhase: 'idle',
    lastUpdated: Date.now(),
    errors: [],
    stats: {
      totalItemsFetched: 0,
      itemsPerSource: {},
      lastFetchTimes: {}
    }
  };

  /**
   * Registers a content source with the aggregator
   * 
   * @param source - The content source to register
   */
  public registerSource(source: ContentSource) {
    this.sources.push(source);
    // Initialize stats for this source
    if (this._status.stats?.itemsPerSource) {
      this._status.stats.itemsPerSource[source.name] = 0;
    }
    if (this._status.stats?.lastFetchTimes) {
      this._status.stats.lastFetchTimes[source.name] = 0;
    }
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

  public getStatus(): AggregationStatus {
    return { ...this._status };
  }
  
  /**
   * Saves content items to storage
   * 
   * @param items - The content items to save
   * @param sourceName - The name of the source that provided the items
   */
  public async saveItems(items : ContentItem[], sourceName : string) {
    if (! this.storage) {
      const error = `Error aggregator storage hasn't be set.`;
      console.error(error);
      this._status.errors?.push({
        message: error,
        source: sourceName,
        timestamp: Date.now()
      });
      return;
    }

    try {
      if (items.length > 0) {
        await this.storage.saveContentItems(items);
        console.log(`Stored ${items.length} items from source: ${sourceName}`);
        
        // Update stats
        if (this._status.stats) {
          this._status.stats.totalItemsFetched = (this._status.stats.totalItemsFetched || 0) + items.length;
          if (this._status.stats.itemsPerSource) {
            this._status.stats.itemsPerSource[sourceName] = (this._status.stats.itemsPerSource[sourceName] || 0) + items.length;
          }
        }
      } else {
        console.log(`No new items fetched from source: ${sourceName}`);
      }
      
      // Update status
      this._status.currentPhase = 'idle';
      this._status.lastUpdated = Date.now();
    } catch (error) {
      const errorMsg = `Error fetching/storing data from source ${sourceName}: ${error}`;
      console.error(errorMsg);
      this._status.errors?.push({
        message: errorMsg,
        source: sourceName,
        timestamp: Date.now()
      });
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
        this._status.currentSource = source.name;
        this._status.currentPhase = 'fetching';
        this._status.lastUpdated = Date.now();
        
        const items = await source.fetchItems();
        allItems = allItems.concat(items);
        
        if (this._status.stats?.lastFetchTimes) {
          this._status.stats.lastFetchTimes[source.name] = Date.now();
        }
      }

      this._status.currentPhase = 'enriching';
      this._status.currentSource = undefined;
      this._status.lastUpdated = Date.now();
      
      allItems = await this.processItems(allItems);

      // Apply each enricher to the entire articles array
      for (const enricher of this.enrichers) {
        allItems = await enricher.enrich(allItems);
      }
      
      this._status.currentPhase = 'idle';
      this._status.lastUpdated = Date.now();
    } catch (error) {
      const errorMsg = `Error Fetch All: ${error}`;
      console.error(errorMsg);
      this._status.errors?.push({
        message: errorMsg,
        timestamp: Date.now()
      });
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
    let sourceFound = false;
    
    for (const source of this.sources) {
      try {
        if (source.name === sourceName) {
          sourceFound = true;
          this._status.currentSource = source.name;
          this._status.currentPhase = 'fetching';
          this._status.lastUpdated = Date.now();
          
          const items = await source.fetchItems();
          allItems = allItems.concat(items);
          
          if (this._status.stats?.lastFetchTimes) {
            this._status.stats.lastFetchTimes[source.name] = Date.now();
          }
        }
      } catch (error) {
        const errorMsg = `Error fetching from ${source.name}: ${error}`;
        console.error(errorMsg);
        this._status.errors?.push({
          message: errorMsg,
          source: source.name,
          timestamp: Date.now()
        });
      }
    }
    
    if (!sourceFound) {
      const errorMsg = `Source not found: ${sourceName}`;
      console.error(errorMsg);
      this._status.errors?.push({
        message: errorMsg,
        source: sourceName,
        timestamp: Date.now()
      });
      return allItems;
    }

    this._status.currentPhase = 'enriching';
    this._status.currentSource = undefined;
    this._status.lastUpdated = Date.now();
    
    allItems = await this.processItems(allItems);

    // Apply each enricher to the entire articles array
    for (const enricher of this.enrichers) {
      allItems = await enricher.enrich(allItems);
    }
    
    this._status.currentPhase = 'idle';
    this._status.lastUpdated = Date.now();

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
      const errorMsg = `Error fetching/storing data from source ${sourceName}: ${error}`;
      console.error(errorMsg);
      this._status.errors?.push({
        message: errorMsg,
        source: sourceName,
        timestamp: Date.now()
      });
    }
  }

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
    if (!this.storage) {
      const errorMsg = "Storage Plugin is not set for Aggregator.";
      this._status.errors?.push({
        message: errorMsg,
        timestamp: Date.now()
      });
      throw(errorMsg);
    }

    let allItems: ContentItem[] = [];
    for (const item of items) {
      if (item && item.cid) {
        const exists = await this.storage.getContentItem(item.cid);
        if (!exists) {
          allItems.push(item);
        }
      }
    }
    
    return allItems;
  }
}