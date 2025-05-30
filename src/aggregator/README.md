# Aggregator (`src/aggregator/`)

This directory houses the core aggregation engines responsible for orchestrating the flow of data from sources, through enrichers, and into storage. Different aggregators are used for continuous operation versus historical data fetching.

## Key Files

### `ContentAggregator.ts`

**Functionality:**

*   This is the primary aggregator used by the main `src/index.ts` script for continuous, real-time (or near real-time) data aggregation.
*   Manages collections of registered plugin instances:
    *   `ContentSource[]`: Array of active data source plugins.
    *   `EnricherPlugin[]`: Array of active enricher plugins.
    *   `StoragePlugin`: The active storage plugin (typically one).
*   Provides methods to register these plugins (`registerSource`, `registerEnricher`, `registerStorage`).
*   Orchestrates the fetching and processing pipeline for individual sources when triggered by `src/index.ts`.

**Data Flow (`fetchAndStore(sourceName: string)`):

1.  **Fetch**: Calls `fetchSource(sourceName)` to get new `ContentItem`s.
    *   This, in turn, iterates through registered sources, finds the one matching `sourceName`, and calls its `fetchItems()` method.
2.  **Process**: The fetched items are passed to `processItems(items: ContentItem[])`:
    *   This method checks each `ContentItem` against the `StoragePlugin` (using `storage.getContentItem(item.cid)`) to filter out items that have already been stored (deduplication).
    *   The new, unique items are then passed through all registered `EnricherPlugin`s by calling `enricher.enrich(newItems)` for each enricher in sequence.
3.  **Store**: The final, enriched, and unique `ContentItem`s are saved using `saveItems(processedItems, sourceName)`, which calls `storage.saveContentItems(items)`.

**Key Methods:**

*   `registerSource(source: ContentSource)`: Adds a source plugin.
*   `registerEnricher(enricher: EnricherPlugin)`: Adds an enricher plugin.
*   `registerStorage(storage: StoragePlugin)`: Sets the storage plugin.
*   `fetchSource(sourceName: string): Promise<ContentItem[]>`: Fetches, processes (deduplicates and enriches) items from a specific source.
*   `fetchAndStore(sourceName: string)`: Fetches, processes, and stores items from a specific source.
*   `saveItems(items: ContentItem[], sourceName: string)`: Saves items to storage.
*   `processItems(items: ContentItem[]): Promise<ContentItem[]>`: Deduplicates and enriches items.
*   `fetchAll(): Promise<ContentItem[]>`: Fetches and processes items from all registered sources (though `fetchAndStore` per source is more commonly used by `index.ts`).

### `HistoricalAggregator.ts`

**Functionality:**

*   This aggregator is specifically designed for fetching and processing data for past dates or date ranges. It is primarily used by the `src/historical.ts` script.
*   Similar to `ContentAggregator` in managing registered sources, enrichers, and storage, but its fetching methods are geared towards historical data retrieval.
*   Only works with `ContentSource` plugins that implement the `fetchHistorical(date: string): Promise<ContentItem[]>` method.

**Data Flow (`fetchAndStore(sourceName: string, date: string)` or `fetchAndStoreRange(sourceName: string, filter: DateConfig)`):**

1.  **Date Iteration (for ranges)**: If `fetchAndStoreRange` is called, it uses `callbackDateRangeLogic` (from `dateHelper.ts`) to iterate through each date in the specified `DateConfig` filter, calling `fetchAndStore(sourceName, dayStr)` for each day.
2.  **Historical Fetch (for a specific date)**: Calls `fetchSource(sourceName, date)`.
    *   This finds the matching source and invokes its `source.fetchHistorical(date)` method.
3.  **Process**: The fetched items are passed to `processItems(items: ContentItem[])`, which performs deduplication against storage and applies enrichers, identical to `ContentAggregator`.
4.  **Store**: The processed historical `ContentItem`s are saved using `saveItems(processedItems, sourceName)`.

**Key Methods:**

*   `registerSource(source: ContentSource)`: Adds a source plugin (expects it to have `fetchHistorical`).
*   `registerEnricher(enricher: EnricherPlugin)`
*   `registerStorage(storage: StoragePlugin)`
*   `fetchSource(sourceName: string, date: string): Promise<ContentItem[]>`: Fetches, processes historical items for a specific source and date.
*   `fetchAndStore(sourceName: string, date: string)`: Fetches, processes, and stores historical items for a specific source and date.
*   `fetchAndStoreRange(sourceName: string, filter: DateConfig)`: Orchestrates fetching for a date range.
*   `fetchAll(date: string): Promise<ContentItem[]>`: Fetches and processes items from all registered historical sources for a specific date.
*   `saveItems` and `processItems` are similar to those in `ContentAggregator`. 