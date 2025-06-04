# Generator Plugins (`src/plugins/generators/`)

Generator plugins are responsible for creating derived content, typically summaries or structured reports, from the data that has been fetched by source plugins, processed by enrichers, and stored by a storage plugin. They often use AI providers for tasks like summarization and text generation.

These plugins are usually scheduled to run at intervals (by `src/index.ts`) or are triggered for specific dates (by `src/historical.ts`).

## Key Files

### `DailySummaryGenerator.ts`

**Functionality:**

*   Generates daily summaries from various types of `ContentItem`s stored in the database.
*   It is configured with an `OpenAIProvider` (for summarization), an `SQLiteStorage` (to fetch content), a `summaryType` (e.g., "dailyReport"), an optional `source` (to filter content items by their original source type like "twitter", "github"), and an `outputPath` for saving files.
*   Can be configured with `maxGroupsToSummarize` and `groupBySourceType`.
*   The main method is `generateAndStoreSummary(dateStr: string)`, which processes data for a specific date.
*   `generateContent()` is a wrapper that typically calls `generateAndStoreSummary` for the previous day if a summary doesn't already exist for that period.

**Data Flow (`generateAndStoreSummary(dateStr)`):

1.  **Fetch Content:** Retrieves `ContentItem`s for the given `dateStr` (a 24-hour period) from the `SQLiteStorage`. It can filter by a specific `this.source` type or fetch all types.
2.  **Group Content:** Calls `groupObjects(contentItems)` to group the fetched items. This method has specific logic:
    *   GitHub items (`obj.source` contains "github") are grouped by their specific type (e.g., "pull_request", "issue", "commit").
    *   Crypto analytics items (`obj.cid` contains "analytics") are grouped under "crypto market".
    *   Twitter items (`obj.source` contains "twitter" or "tweet") are grouped under "twitter_activity".
    *   Other items are grouped by their `obj.topics` if available and `groupBySourceType` is false, otherwise by `obj.type`.
    *   Small groups (<=1 item) might be consolidated into a "Miscellaneous" group.
3.  **Summarize Groups (Loop):** For each significant group (up to `maxGroupsToSummarize`):
    *   Prepares custom instructions for the AI prompt based on the topic (e.g., specific titles or AI prompts for Twitter, repository names for GitHub).
    *   Calls `createJSONPromptForTopics(...)` (from `promptHelper.ts`) to create a detailed prompt for the AI, including the text and metadata of the items in the group.
    *   Sends this prompt to the injected `OpenAIProvider` via `this.provider.summarize(prompt)`.
    *   Parses the AI's JSON response (which should contain a title, content with themes/text, sources, images, videos for that topic group).
    *   Collects all these individual group summaries.
4.  **Generate Markdown Report:**
    *   If summaries were generated, calls `createMarkdownPromptForJSON(...)` with all the collected group summaries to create a prompt for an overarching Markdown report.
    *   Sends this prompt to the `OpenAIProvider` to get the Markdown content.
5.  **Store & Write Summary:**
    *   Creates a `SummaryItem` object containing the overall title, the collection of JSON group summaries (as a string in `categories`), the AI-generated Markdown report, and the date.
    *   Saves this `SummaryItem` to the `SQLiteStorage` using `this.storage.saveSummaryItem()`.
    *   Writes the JSON data (type, title, categories, date) to a file like `outputPath/json/YYYY-MM-DD.json`.
    *   Writes the final Markdown report (prepending a main H1 title) to `outputPath/md/YYYY-MM-DD.md`.

**Dependencies:**

*   `OpenAIProvider`, `SQLiteStorage`.
*   Helper functions from `promptHelper.ts`, `generalHelper.ts`, `fileHelper.ts`.
*   Interfaces from `src/types.ts` (`ContentItem`, `SummaryItem`).

### `DiscordSummaryGenerator.ts`

**Functionality:**

*   Generates detailed summaries specifically from Discord channel data (`discordRawData` source type).
*   Configured with an `OpenAIProvider`, `SQLiteStorage`, a `summaryType` (e.g., "discordChannelSummary"), the `source` type to fetch (e.g., "discordRawData"), and an `outputPath`.
*   `generateAndStoreSummary(dateStr: string)` processes data for a specific date.
*   `generateContent()` calls `generateAndStoreSummary` for yesterday if a recent summary of `this.summaryType` doesn't exist.

**Data Flow (`generateAndStoreSummary(dateStr)`):

1.  **Fetch Content:** Retrieves `ContentItem`s of `this.source` type (e.g., "discordRawData") for the given `dateStr` from `SQLiteStorage`.
2.  **Group by Channel:** Calls `groupByChannel(contentItems)` to organize items by their `metadata.channelId`.
3.  **Process Each Channel (Loop):** For each channel's items:
    *   Calls `processChannelData(items)`:
        *   `combineRawData(items)`: Parses the `text` field (which is a JSON string of `DiscordRawData`) from each `ContentItem` and consolidates all messages and user details for that channel on that day. Ensures messages are unique and sorted.
        *   `getAISummary(messages, users, channelName)`: Formats the channel's messages into a transcript. Calls `getChannelSummaryPrompt()` to create a detailed prompt asking the AI for a summary, FAQs, help interactions, and action items. Sends this to the `OpenAIProvider`.
        *   `parseStructuredText(aiResponse, channelName, guildName)`: Parses the AI's structured text response into a `DiscordSummary` object (containing summary, faqs, helpInteractions, actionItems).
    *   Collects all generated `DiscordSummary` objects (one per channel).
4.  **Generate Combined Files:** If channel summaries were generated, calls `generateCombinedSummaryFiles(...)`:
    *   `calculateDiscordStats(contentItems)`: Calculates total messages, users, and per-channel stats from the original `ContentItem`s.
    *   `generateDailySummary(channelSummaries, dateStr)`: Creates a prompt for the `OpenAIProvider` by combining the individual channel text summaries, asking for an overall daily summary of Discord discussions across all processed channels. The AI response is cleaned.
    *   Prepares a JSON object (`jsonData`) containing server name, title, date, overall stats, and an array of categories (derived from channel summaries including their individual stats).
    *   Writes `jsonData` to `outputPath/json/YYYY-MM-DD.json`.
    *   Writes the AI-generated overall Markdown summary to `outputPath/md/YYYY-MM-DD.md`.
    *   Saves a `SummaryItem` to `SQLiteStorage` containing the `fileTitle`, the `jsonData` (stringified in `categories`), the final Markdown, and the date.

**Dependencies:**

*   `OpenAIProvider`, `SQLiteStorage`.
*   Helper functions from `fileHelper.ts`, `cliHelper.ts`.
*   Interfaces from `src/types.ts` (`ContentItem`, `SummaryItem`, `DiscordSummary`, etc.).

### `RawDataExporter.ts`

**Functionality:**

*   Exports raw `ContentItem` data from storage into individual JSON files.
*   Primarily designed to take data of a specific `source` type (e.g., "discordRawData") and save the `text` content (which is itself expected to be JSON) into separate files.
*   Configured with `SQLiteStorage`, a `source` type to export, and an `outputPath`.
*   The method `generateAndStoreSummary(dateStr: string)` is the entry point for compatibility but internally calls `exportRawDataForDate(dateStr)`.
*   `generateContent()` calls `exportRawDataForDate` for the previous day.

**Data Flow (`exportRawDataForDate(dateStr)`):

1.  **Fetch Content:** Retrieves all `ContentItem`s for the given `dateStr` that match `this.source` type from `SQLiteStorage`.
2.  **Process Each Item (Loop):** For each fetched `ContentItem`:
    *   Verifies the item's `type` matches `this.source` and that `item.text` exists.
    *   Parses `item.text` (expected to be a JSON string).
    *   **Determine Output Path:**
        *   If `item.type` is "discordRawData", it creates a subfolder structure like `outputPath/guildName/channelName/` using sanitized names from `item.metadata` or the parsed data.
        *   For other types, it defaults to saving in `this.outputPath` with a filename derived from `item.cid`.
    *   The filename is typically `YYYY-MM-DD.json` within the determined channel/guild subfolder for Discord data.
    *   Ensures the target directory exists using `ensureDirectoryExists()`.
    *   Writes the parsed JSON content (from `item.text`) to the target file path (e.g., `outputPath/guildName/channelName/YYYY-MM-DD.json`).

**Dependencies:**

*   `SQLiteStorage`.
*   Helper functions from `cliHelper.ts`.
*   Interfaces from `src/types.ts` (`ContentItem`, `DiscordRawData`).
*   Uses `fs` and `path` for file system operations. 