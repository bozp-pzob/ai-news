---
id: overview
title: Plugin System & Overview
sidebar_label: Overview & Architecture
---

The AI News Aggregator is built around a highly modular and extensible plugin system. This architecture allows developers to easily add new functionalities or modify existing ones without altering the core application logic.

## Plugin System Fundamentals

Plugins are TypeScript classes that handle specific tasks within the data aggregation and processing pipeline. They are dynamically loaded and configured at runtime based on JSON configuration files located in the `config/` directory.

The system relies on several key components:

-   **Plugin Interfaces:** Defined in `src/types.ts` (and sometimes within plugin-type specific files like `src/plugins/storage/StoragePlugin.ts`). These interfaces establish a contract that each plugin of a certain type must adhere to (e.g., all source plugins implement `ContentSource`).
-   **JSON Configuration:** Files in `config/` specify which plugins to use, their unique instance names, and their parameters. Parameters can also reference environment variables.
-   **`configHelper.ts` (`src/helpers/configHelper.ts`):** This utility module is responsible for:
    *   Dynamically loading plugin classes from their respective directories within `src/plugins/`.
    *   Instantiating plugins based on the JSON configuration.
    *   Injecting dependencies (e.g., an AI provider instance into a generator plugin that requires it, or a storage plugin into a source that needs to manage cursors).
-   **Aggregators (`src/aggregator/`):** `ContentAggregator` and `HistoricalAggregator` orchestrate the interaction between sources, enrichers, and storage plugins.
-   **Main Scripts (`src/index.ts`, `src/historical.ts`):** Initialize the system, load configurations, and manage the lifecycle of plugins (especially scheduling for generators in `index.ts`).

## Plugin Categories

Plugins are organized by their functionality into subdirectories within `src/plugins/` and documented in their respective sections:

1.  **[Source Plugins](./sources.md):**
    *   **Purpose:** Fetch raw data from external APIs, feeds, or services.
    *   **Interface:** `ContentSource` (requires `name`, `fetchItems()`, optional `fetchHistorical()`).
    *   **Output:** Transform raw data into an array of `ContentItem` objects.

2.  **[AI Provider Plugins](./ai.md):**
    *   **Purpose:** Wrap external AI model APIs (e.g., OpenAI, OpenRouter via Claude).
    *   **Interface:** `AiProvider` (requires `summarize()`, `topics()`, `image()`).
    *   **Usage:** Injected as dependencies into other plugins that need AI capabilities.

3.  **[Enricher Plugins](./enrichers.md):**
    *   **Purpose:** Process and augment `ContentItem`s after fetching but before storage.
    *   **Interface:** `EnricherPlugin` (requires `enrich()`).
    *   **Example:** Adding AI-generated topics or image URLs to `ContentItem`s.

4.  **[Generator Plugins](./generators.md):**
    *   **Purpose:** Create derived content, typically summaries or structured reports, from stored `ContentItem` data.
    *   **Interface:** No single explicit interface, but generally have a main method like `generateContent()` or `generateAndStoreSummary(date)`.
    *   **Usage:** Often retrieve data from a `StoragePlugin` and use an `AiProvider`.

5.  **[Storage Plugins](./storage.md):**
    *   **Purpose:** Handle the persistence and retrieval of `ContentItem`s, `SummaryItem`s, and cursor data.
    *   **Interface:** `StoragePlugin` (requires `init()`, `close()`, `saveContentItems()`, `getContentItem()`, `saveSummaryItem()`, `getCursor()`, `setCursor()`, etc.).

## How Plugins are Loaded and Used (Simplified Flow)

1.  **Definition in JSON (e.g., `config/my_pipeline.json`):**
    ```json
    {
      "sources": [
        { "type": "MySource", "name": "mySourceInstance", "params": { "apiKey": "process.env.MY_KEY" } }
      ],
      "ai": [
        { "type": "MyAiProvider", "name": "myAiInstance", "params": { /*...*/ } }
      ],
      "generators": [
        { "type": "MyGenerator", "name": "myGeneratorInstance", "params": { "provider": "myAiInstance" } }
      ]
      // ... etc. for storage, enrichers
    }
    ```

2.  **Loading by `configHelper.ts`:**
    *   `loadDirectoryModules("sources")` finds and imports the `MySource` class from `src/plugins/sources/MySource.ts`.
    *   `loadItems(...)` creates an instance: `new MySource({ name: "mySourceInstance", apiKey: process.env.MY_KEY })`.
    *   This process is repeated for `MyAiProvider` and `MyGenerator`.
    *   `loadProviders(...)` (a function in `configHelper.ts`) inspects `myGeneratorInstance`. If `myGeneratorInstance.provider` is the string "myAiInstance", it replaces this string with the actual `myAiInstance` object, thereby injecting the dependency.

3.  **Registration & Execution:**
    *   The `mySourceInstance` is registered with an aggregator (like `ContentAggregator`).
    *   The aggregator can then call `mySourceInstance.fetchItems()`.
    *   The main script (`index.ts` or `historical.ts`) might directly call `myGeneratorInstance.generateContent()`.

This system allows for clear separation of concerns and makes it straightforward to add, remove, or swap out functionalities by primarily modifying JSON configuration files and ensuring new plugin classes adhere to the defined TypeScript interfaces.

Explore each plugin category linked above for more details on available plugins and their specific functionalities. 