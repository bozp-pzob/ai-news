# Plugins (`src/plugins/`)

This directory is the heart of the AI News Aggregator's extensible architecture. It contains all the modular components (plugins) that handle specific tasks like data acquisition, AI processing, content enrichment, summary generation, and data storage.

## Plugin System Overview

The application employs a configuration-driven plugin system. Plugins are dynamically loaded and initialized at runtime based on a central JSON configuration file (e.g., `config/sources.json`). Helper functions in `src/helpers/configHelper.ts` manage this loading and the injection of dependencies (like AI providers or storage instances) into other plugins that require them.

Each plugin type adheres to a specific interface defined in `src/types.ts` (or within its own subdirectory, like `StoragePlugin.ts`).

## Plugin Categories

Plugins are organized into the following subdirectories, each corresponding to a distinct category of functionality:

*   **[`ai/`](./ai/README.md):** AI Provider plugins that wrap external AI model APIs (e.g., OpenAI, OpenRouter).
*   **[`enrichers/`](./enrichers/README.md):** Enricher plugins that process and augment `ContentItem`s after they are fetched (e.g., adding topics, sentiment).
*   **[`generators/`](./generators/README.md):** Generator plugins responsible for creating derived content, such as daily summaries, from the aggregated and stored data.
*   **[`sources/`](./sources/README.md):** Content Source plugins that fetch raw data from external APIs, feeds, or services (e.g., Twitter, Discord, GitHub).
*   **[`storage/`](./storage/README.md):** Storage plugins that handle the persistence of `ContentItem`s and `SummaryItem`s (e.g., SQLite).

Each subdirectory contains its own `README.md` file detailing the specific plugins within it.

## Data Flow

1.  **Configuration:** `src/index.ts` or `src/historical.ts` reads a JSON configuration file.
2.  **Loading:** `configHelper.ts` loads all plugin classes from these subdirectories.
3.  **Instantiation:** `configHelper.ts` creates instances of the plugins specified in the configuration, along with their parameters.
4.  **Dependency Injection:** `configHelper.ts` injects required dependencies (e.g., an `AiProvider` instance into a `DiscordSummaryGenerator`).
5.  **Registration:**
    *   Source, Enricher, and Storage plugins are registered with an `Aggregator` (`ContentAggregator` or `HistoricalAggregator`).
    *   Generator plugins are managed directly by `index.ts` or `historical.ts` for scheduling their `generateContent()` or `generateAndStoreSummary()` methods.
6.  **Execution:**
    *   **Sources** fetch data, which is then passed to **Enrichers** by the Aggregator.
    *   The Aggregator then passes the enriched data to the **Storage** plugin.
    *   **Generators** retrieve data from the **Storage** plugin, use **AI Providers** to process it, and then output summaries (often back to **Storage** or the filesystem). 