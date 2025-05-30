---
title: Storage Plugins
sidebar_label: Storage
---

Storage plugins are crucial components that provide an abstraction layer for persisting and retrieving data within the AI News Aggregator. They handle all database interactions, allowing other parts of the system (like aggregators, sources, and generators) to work with data without being tied to a specific database technology.

## Key Responsibilities

-   **Data Persistence:** Save `ContentItem`s (fetched data) and `SummaryItem`s (generated summaries) to a database or other persistent store.
-   **Data Retrieval:** Provide methods to query and retrieve stored items based on various criteria (e.g., by content ID, by date range, by type).
-   **Cursor Management:** Store and retrieve pagination cursors (e.g., the ID of the last fetched message for a particular source/channel) to enable efficient incremental data fetching.
-   **Database Operations:** Manage database connections, schema creation/migration (e.g., creating tables if they don't exist during initialization), and transactions.

## Interface

All storage plugins must implement the `StoragePlugin` interface defined in `src/plugins/storage/StoragePlugin.ts`. Key methods include:

-   `init(): Promise<void>`: Initializes the storage system (e.g., connect to DB, create tables).
-   `close(): Promise<void>`: Closes connections and releases resources.
-   `saveContentItems(items: ContentItem[]): Promise<ContentItem[]>`: Saves/updates an array of content items.
-   `getContentItem(cid: string): Promise<ContentItem | null>`: Retrieves a content item by its unique ID.
-   `saveSummaryItem(item: SummaryItem): Promise<void>`: Saves/updates a summary item.
-   `getSummaryBetweenEpoch(startEpoch: number, endEpoch: number, excludeType?: string): Promise<SummaryItem[]>`: Retrieves summaries within a date range.
-   `getContentItemsBetweenEpoch(startEpoch: number, endEpoch: number, includeType?: string): Promise<ContentItem[]>`: Retrieves content items within a date range, optionally filtered by type.
-   `getCursor(cid: string): Promise<string | null>`: Gets a pagination cursor.
-   `setCursor(cid: string, messageId: string): Promise<void>`: Sets/updates a pagination cursor.

## Available Storage Plugins

-   **`SQLiteStorage.ts`**:
    *   Implements the `StoragePlugin` interface using an SQLite database.
    *   Manages `items` (for `ContentItem`s), `summary` (for `SummaryItem`s), and `cursor` tables.
    *   Handles JSON serialization/deserialization for complex fields like `metadata` and `topics`.
    *   Configured via `dbPath` parameter specifying the SQLite file location.

For detailed information on the `SQLiteStorage` plugin, please examine its source code and associated README in the `src/plugins/storage/` directory of the project repository.

*(Other storage plugins could be developed in the future, e.g., for PostgreSQL, MongoDB, or cloud-based storage solutions, by implementing the `StoragePlugin` interface.)* 