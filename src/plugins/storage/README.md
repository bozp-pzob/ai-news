# Storage Plugins (`src/plugins/storage/`)

This directory contains plugins responsible for persisting and retrieving data, such as `ContentItem`s and `SummaryItem`s. Storage plugins provide an abstraction layer over different database systems or storage mechanisms.

## Base Interface: `StoragePlugin.ts`

All storage plugins must implement the `StoragePlugin` interface defined in `StoragePlugin.ts`.

**`StoragePlugin` Interface:**

*   `init(): Promise<void>`: Initializes the storage system. This can include setting up database connections, creating tables if they don't exist, etc. Must be called before other methods.
*   `close(): Promise<void>`: Closes the storage system and releases any resources (e.g., database connections).
*   `saveContentItems(items: ContentItem[]): Promise<ContentItem[]>`: Saves or updates an array of `ContentItem`s. It should handle both inserting new items and updating existing ones (based on `cid`). Returns the saved items, potentially with database-assigned IDs.
*   `getContentItem(cid: string): Promise<ContentItem | null>`: Retrieves a single `ContentItem` by its unique content ID (`cid`). Returns the item or `null` if not found.
*   `saveSummaryItem(item: SummaryItem): Promise<void>`: Saves or updates a `SummaryItem`. Should handle new insertions and updates for summaries of the same type and date.
*   `getSummaryBetweenEpoch(startEpoch: number, endEpoch: number, excludeType?: string): Promise<SummaryItem[]>`: Retrieves `SummaryItem`s within a specified time range (inclusive, using epoch seconds). Can optionally exclude a specific summary `type`.
*   `getCursor(cid: string): Promise<string | null>`: Retrieves a cursor value (typically a last fetched message ID or similar pagination token) associated with a unique cursor ID (`cid`).
*   `setCursor(cid: string, messageId: string): Promise<void>`: Sets or updates the cursor value for a given cursor ID.

## Available Storage Plugins

### `SQLiteStorage.ts`

**Functionality:**

*   Implements the `StoragePlugin` interface using an SQLite database for persistence.
*   Uses the `sqlite` and `sqlite3` NPM packages.
*   Configured with a `StorageConfig` object containing `name` and `dbPath` (path to the SQLite database file).

**Initialization (`init()`):**

1.  Opens (or creates) the SQLite database file specified by `dbPath`.
2.  Executes SQL `CREATE TABLE IF NOT EXISTS` commands to ensure three tables are present:
    *   `items`: Stores `ContentItem` data.
        *   Columns: `id` (INTEGER PK AUTOINCREMENT), `cid` (TEXT), `type` (TEXT), `source` (TEXT), `title` (TEXT), `text` (TEXT), `link` (TEXT), `topics` (TEXT, JSON-encoded array), `date` (INTEGER, epoch seconds), `metadata` (TEXT, JSON-encoded object).
    *   `summary`: Stores `SummaryItem` data.
        *   Columns: `id` (INTEGER PK AUTOINCREMENT), `type` (TEXT), `title` (TEXT), `categories` (TEXT, JSON-encoded string), `markdown` (TEXT), `date` (INTEGER, epoch seconds).
    *   `cursor`: Stores cursor data for pagination.
        *   Columns: `id` (INTEGER PK AUTOINCREMENT), `cid` (TEXT UNIQUE), `message_id` (TEXT).

**Data Flow & Key Methods:**

*   **`saveContentItems(items: ContentItem[])`:**
    1.  Begins an SQLite transaction.
    2.  For each `ContentItem`:
        *   If `item.cid` is provided, checks if an item with that `cid` exists in the `items` table.
        *   If it exists, an `UPDATE` statement is used to update its `metadata` (and potentially other fields like `topics` if logic is added).
        *   If it does not exist (or if `item.cid` is null/undefined), an `INSERT` statement is used to add the new item. `item.topics` and `item.metadata` are JSON stringified before insertion.
        *   The database-generated `id` is assigned back to `item.id`.
    3.  Commits the transaction. Rolls back on error.
*   **`getContentItem(cid: string)`:**
    *   Selects an item from the `items` table where `cid` matches.
    *   Parses JSON string fields (`topics`, `metadata`) back into objects/arrays before returning the `ContentItem`.
*   **`saveSummaryItem(item: SummaryItem)`:**
    *   Checks if a summary with the same `type` and `date` (epoch seconds) already exists in the `summary` table.
    *   If it exists, an `UPDATE` statement is used to modify its `title`, `categories` (JSON stringified), and `markdown`.
    *   If not, an `INSERT` statement adds the new summary.
*   **`getContentItemsBetweenEpoch(startEpoch, endEpoch, includeType?)`:**
    *   Selects items from the `items` table where `date` is between `startEpoch` and `endEpoch` (inclusive).
    *   If `includeType` is provided, adds an `AND type = ?` condition to the query.
    *   Parses JSON fields for each retrieved item.
*   **`getSummaryBetweenEpoch(startEpoch, endEpoch, excludeType?)`:**
    *   Selects items from the `summary` table where `date` is between `startEpoch` and `endEpoch`.
    *   If `excludeType` is provided, adds an `AND type != ?` condition.
*   **`getCursor(cid: string)`:**
    *   Selects `message_id` from the `cursor` table where `cid` matches.
*   **`setCursor(cid: string, messageId: string)`:**
    *   Uses an `INSERT ... ON CONFLICT(cid) DO UPDATE SET message_id = excluded.message_id` statement (upsert) to store the `messageId` for the given `cid` in the `cursor` table.
*   **`close()`:** Closes the SQLite database connection.

**Dependencies:**

*   NPM packages: `sqlite`, `sqlite3`.
*   Interfaces from `src/types.ts` (`ContentItem`, `SummaryItem`, `StorageConfig`).
*   Helper functions from `src/helpers/cliHelper.ts` (`logger`). 