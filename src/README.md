# Source Code (`src/`)

This directory contains the core source code for the AI News Aggregator application.

## Key Files

### `index.ts`

**Functionality:**

*   Serves as the main entry point for the continuous operation of the AI News Aggregator.
*   Loads environment variables using `dotenv`.
*   Parses command-line arguments for configuration overrides such as:
    *   `--source`: Specifies the JSON configuration file to use (default: `sources.json`).
    *   `--onlyFetch`: If `true`, only fetches data from sources without generating summaries.
    *   `--onlyGenerate`: If `true`, only generates summaries from existing data without fetching new data.
    *   `--output` or `-o`: Specifies the base directory for output files.
*   Dynamically loads all plugin modules (Sources, AI Providers, Enrichers, Generators, Storage) from their respective subdirectories within `src/plugins/` using helper functions from `src/helpers/configHelper.ts`.
*   Reads and parses the main JSON configuration file (e.g., `config/sources.json`) to get settings for all plugins and their parameters.
*   Initializes instances of each configured plugin, injecting dependencies such as AI providers and storage plugins as defined in the configuration.
*   Validates the loaded plugin configuration.
*   Instantiates the `ContentAggregator` from `src/aggregator/ContentAggregator.ts`.
*   Registers the initialized source, enricher, and storage plugins with the `ContentAggregator`.
*   Sets up periodic data fetching for each registered source plugin using `setInterval` based on its configured `interval`. The `aggregator.fetchAndStore()` method is called for each source.
*   If not in `onlyFetch` mode, sets up periodic summary generation for each registered generator plugin using `setInterval` based on its `interval`. The `generator.instance.generateContent()` method is called.
*   Handles graceful shutdown on `SIGINT` and `SIGTERM` signals, ensuring storage connections are closed.
*   Supports a `runOnce` mode (configured in the JSON settings) where the application performs a single fetch and generate cycle and then exits.

**Data Flow:**

1.  Command-line arguments and environment variables are processed.
2.  Plugin modules are loaded.
3.  The main JSON configuration is loaded and parsed.
4.  Plugin instances are created and dependencies (AI providers, storage) are injected.
5.  The `ContentAggregator` is initialized.
6.  Sources, Enrichers, and Storage plugins are registered with the `ContentAggregator`.
7.  **Fetching Loop (for each source, per interval):**
    *   `ContentAggregator.fetchAndStore(sourceName)` is called.
    *   The specified `ContentSource` plugin fetches data (`fetchItems()`).
    *   Fetched `ContentItem`s are processed by any registered `EnricherPlugin`s via `aggregator.processItems()` and `enricher.enrich()`.
    *   The resulting `ContentItem`s are saved to the configured `StoragePlugin` via `aggregator.saveItems()`.
8.  **Generation Loop (for each generator, per interval, unless `onlyFetch`):**
    *   `generator.instance.generateContent()` is called.
    *   The generator retrieves necessary `ContentItem`s from the `StoragePlugin`.
    *   It uses an `AiProvider` to process the data and create summaries.
    *   The generated summaries (`SummaryItem`s) are typically written to files in the `outputPath` and/or saved back to storage.
9.  The application continues these loops until `runOnce` is completed or it's manually stopped (triggering shutdown).

### `historical.ts`

**Functionality:**

*   Provides a mechanism to fetch and process data from past dates or date ranges, operating independently of the continuous `index.ts` script.
*   Useful for backfilling data, generating summaries for historical periods, and testing historical fetching capabilities of source plugins.
*   Parses command-line arguments for:
    *   `--source`: Specifies the JSON configuration file.
    *   `--date`, `--before`, `--after`, `--during`: Define the specific date or range for historical data processing.
    *   `--onlyFetch`, `--onlyGenerate`: Control whether to only fetch data or only generate summaries.
    *   `--output` or `-o`: Specifies the output directory.
    *   `--fetchMode`: Allows specifying a fetch mode (e.g., 'search' or 'timeline') for specific sources like `TwitterSource` when fetching historical data.
*   Loads plugins and configurations similarly to `index.ts`, but with a focus on historical data.
*   Injects `fetchMode` into `TwitterSource` plugin parameters if specified via CLI.
*   Uses the `HistoricalAggregator` from `src/aggregator/HistoricalAggregator.ts`.
*   Only registers source plugins that implement the `fetchHistorical(date: string)` method.
*   Uses date helper functions from `src/helpers/dateHelper.ts` (e.g., `parseDate`, `callbackDateRangeLogic`) for managing date filters and iterating over date ranges.
*   Operates in a run-once mode: it fetches/generates data for the specified period and then exits.
*   If not in `onlyFetch` mode, it calls `generator.instance.generateAndStoreSummary(dateStr)` for each relevant generator and date in the specified range.

**Data Flow:**

1.  Command-line arguments and environment variables are processed.
2.  Plugin modules are loaded.
3.  The main JSON configuration is loaded and parsed. `fetchMode` is injected if applicable.
4.  Plugin instances are created, and dependencies are injected.
5.  The `HistoricalAggregator` is initialized.
6.  Sources (with `fetchHistorical`), Enrichers, and Storage plugins are registered.
7.  A `DateConfig` object is created based on date-related CLI arguments.
8.  **Historical Fetching (if not `onlyGenerate`):**
    *   For each source, `aggregator.fetchAndStore(sourceName, date)` or `aggregator.fetchAndStoreRange(sourceName, filter)` is called.
    *   The `ContentSource` plugin's `fetchHistorical(date)` method is invoked for each relevant date.
    *   Fetched `ContentItem`s are processed by enrichers and saved to storage via the `HistoricalAggregator`.
9.  **Historical Generation (if not `onlyFetch`):**
    *   For each generator and for each date in the specified range (using `callbackDateRangeLogic` if it's a range):
        *   `generator.instance.generateAndStoreSummary(dateStr)` is called.
        *   The generator retrieves data for that specific date from storage.
        *   It uses an AI provider to create summaries.
        *   Summaries are saved to the `outputPath` and/or storage.
10. Storage connections are closed, and the script exits.

### `types.ts`

**Functionality:**

*   Defines the core TypeScript interfaces and type aliases used throughout the application.
*   Ensures data consistency and provides a clear contract for how different modules and plugins interact.

**Key Interfaces Defined:**

*   `ContentItem`: The central normalized data structure for individual pieces of content fetched from sources (e.g., a tweet, a news article, a Discord message).
    *   Includes fields like `cid` (source-specific content ID), `type`, `source` (plugin name), `title`, `text`, `link`, `date`, and `metadata` (for source-specific details).
*   `QuoteTweet`: Structure for a quoted tweet within a `ContentItem`'s metadata.
*   `SummaryItem`: Represents a generated summary, which might be derived from multiple `ContentItem`s.
    *   Includes fields like `type`, `title`, `categories` (often a JSON string of structured summary content), `markdown` (Markdown version), and `date`.
*   **Plugin Interfaces:**
    *   `SourcePlugin`: Base interface for content sources (`name`, `fetchArticles()`). Extended by specific sources, often to include `fetchHistorical()`.
    *   `EnricherPlugin`: Interface for content enrichers (`enrich()`).
    *   `AiProvider`: Interface for AI service providers (`summarize()`, `topics()`, `image()`).
    *   `StoragePlugin` (imported from `./plugins/storage/StoragePlugin.ts`): Interface for storage solutions.
*   **Configuration Interfaces:**
    *   `ConfigItem`: Structure for defining plugins in the JSON configuration (`type`, `name`, `params`, `interval`).
    *   `InstanceConfig`: Represents an initialized plugin instance at runtime.
    *   `AiEnricherConfig`, `StorageConfig`, `DateConfig`, `OutputConfig`: Specific configuration structures for different components or features.
*   **Discord-Specific Types:**
    *   `DiscordRawData`: Detailed structure for raw data fetched by `DiscordRawDataSource.ts`.
    *   `DiscordRawDataSourceConfig`: Configuration specific to `DiscordRawDataSource.ts`.
    *   `TimeBlock`: Used for grouping Discord messages by time.
    *   `DiscordSummary`, `SummaryFaqs`, `HelpInteractions`, `ActionItems`: Structures related to summaries generated from Discord data.

**Data Flow Impact:**

*   `types.ts` does not have a direct data flow itself but is fundamental to the data flow of all other scripts.
*   Source plugins transform raw external data into `ContentItem`s.
*   Enricher plugins take `ContentItem`s and return modified `ContentItem`s.
*   Storage plugins persist and retrieve `ContentItem`s and `SummaryItem`s.
*   Generator plugins consume `ContentItem`s (from storage) and produce `SummaryItem`s.
*   Configuration helpers use `ConfigItem` and `InstanceConfig` to manage plugins. 