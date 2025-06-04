---
id: data-flow
title: General Data Flow
sidebar_label: Data Flow
---

The AI News Aggregator processes data in a configurable pipeline. Here's a high-level overview of the typical data flow, primarily orchestrated by `src/index.ts` (for continuous operation) or `src/historical.ts` (for past data).

1.  **Initialization & Configuration:**
    *   The main script (`index.ts` or `historical.ts`) starts.
    *   Environment variables (from `.env` or system) are loaded.
    *   Command-line arguments are parsed (e.g., `--source` to specify a JSON config file, date parameters for `historical.ts`).
    *   The specified JSON configuration file from `config/` is read.
    *   Helper functions in `src/helpers/configHelper.ts` dynamically load all plugin classes from the `src/plugins/` subdirectories.
    *   Instances of all configured plugins (Sources, AI Providers, Enrichers, Generators, Storage) are created based on the JSON config. Dependencies (like an AI provider instance for a generator) are injected.

2.  **Aggregator Setup:**
    *   An aggregator instance is created (`ContentAggregator` for `index.ts`, `HistoricalAggregator` for `historical.ts`).
    *   Initialized Source, Enricher, and Storage plugins are registered with this aggregator.

3.  **Data Fetching (per Source, often scheduled):
    *   The aggregator is instructed to fetch data for a specific source (e.g., `aggregator.fetchAndStore(sourceName)`).
    *   The corresponding **Source Plugin** (e.g., `DiscordRawDataSource`, `TwitterSource`) executes its `fetchItems()` (or `fetchHistorical(date)` for the historical script) method.
    *   This involves:
        *   Connecting to the external API or service.
        *   Retrieving raw data.
        *   Transforming the raw data into an array of standardized `ContentItem` objects (defined in `src/types.ts`).

4.  **Data Processing & Enrichment (by Aggregator):
    *   The aggregator receives the `ContentItem`s from the source.
    *   **Deduplication:** It typically checks each `ContentItem`'s `cid` against the **Storage Plugin** to see if it has already been processed and stored, preventing duplicates.
    *   **Enrichment:** New, unique `ContentItem`s are then passed sequentially through all registered **Enricher Plugins** (e.g., `AiTopicsEnricher`, `AiImageEnricher`). Each enricher can modify the `ContentItem`s (e.g., add topics to `item.topics`, add image URLs to `item.metadata.photos`).

5.  **Data Storage (by Aggregator):
    *   The processed and enriched `ContentItem`s are passed to the registered **Storage Plugin** (e.g., `SQLiteStorage`).
    *   The storage plugin saves these items to the database (e.g., into the `items` table).

6.  **Content Generation (per Generator, often scheduled or triggered for historical dates):
    *   A **Generator Plugin** (e.g., `DailySummaryGenerator`, `DiscordSummaryGenerator`, `RawDataExporter`) executes its main generation method (e.g., `generateContent()` or `generateAndStoreSummary(date)`).
    *   The generator typically queries the **Storage Plugin** to retrieve relevant `ContentItem`s for a specific period or type.
    *   It may use an injected **AI Provider Plugin** (e.g., `OpenAIProvider`) to process the retrieved content (e.g., summarize text, identify themes).
    *   The generator formats the output (e.g., a daily summary in JSON and Markdown, or raw data files).
    *   Generated output might be written to the filesystem (e.g., into the `output/` directory) and/or saved back into the database via the **Storage Plugin** (e.g., as `SummaryItem`s in a `summary` table).

7.  **Looping/Scheduling (for `index.ts`):
    *   Steps 3-6 (or parts of them, like fetching and generation) are typically repeated on a schedule defined by `interval` parameters in the JSON configuration for each source and generator.

**Key Data Structures:**

*   `ContentItem`: The standardized format for all pieces of data fetched from sources.
*   `SummaryItem`: The standardized format for generated summaries.
*   Plugin-specific configuration objects (e.g., `DiscordRawDataSourceConfig`).

This flow allows for a highly modular and configurable system where different data sources, processing steps, and output formats can be easily combined and managed. 