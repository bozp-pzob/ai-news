# Helper Utilities (`src/helpers/`)

This directory contains various utility modules that provide helper functions used across the AI News Aggregator application. These helpers encapsulate common tasks, promote code reusability, and simplify complex operations.

## Key Helper Modules

### `cache.ts`

**Functionality:**

*   Implements a generic in-memory caching mechanism.
*   Provides a `Cache` class with methods to `set` (with optional TTL), `get`, `del` (delete), and `clear` cache entries.
*   Includes a specialized `TwitterCache` class that extends the generic `Cache` for Twitter-specific data, such as caching tweet data by account and date, and managing cursors for pagination with a default TTL.

**Data Flow Impact:**

*   Used by plugins (e.g., `TwitterSource`) to temporarily store fetched data or API responses to reduce redundant calls and improve performance.
*   Cursors for pagination in `TwitterSource` are managed through `TwitterCache`.

### `cliHelper.ts`

**Functionality:**

*   Provides utilities for command-line interface interactions.
*   Includes a `logger` object with methods for colored console output (`info`, `success`, `warning`, `error`, `debug`, `channel`, `progress`, `clearLine`). Debug messages are conditional based on the `DEBUG` environment variable.
*   Offers functions like `createProgressBar` for visual progress indication during long operations and `formatTimeForFilename`, `formatNumber` for string formatting.

**Data Flow Impact:**

*   Used extensively by `src/index.ts` and `src/historical.ts` for providing user feedback and logging application status.
*   Plugins also utilize the `logger` for their specific logging needs.

### `configHelper.ts`

**Functionality:**

*   Central to the application's plugin and configuration management system.
*   `loadDirectoryModules(directory: string)`: Dynamically imports all TypeScript modules (plugin classes) from a specified subdirectory within `src/plugins/`.
*   `loadItems(items: ConfigItem[], mapping: Record<string, any>, category: string)`: Instantiates plugin classes based on their definitions in the main JSON configuration file. It maps the `type` from the config to a loaded class and passes `params` to its constructor.
*   `loadProviders(instances: InstanceConfig[], providers: InstanceConfig[])`: Injects an AI provider instance into other plugin instances (sources, enrichers, generators) if they are configured to require one (e.g., their `instance.provider` property is a string name of a provider).
*   `loadStorage(instances: InstanceConfig[], storages: InstanceConfig[])`: Injects a storage plugin instance into other plugin instances if they are configured to require one (e.g., their `instance.storage` property is a string name of a storage plugin).
*   `resolveParam(value: string)`: Resolves parameter values from the configuration, including substituting environment variable placeholders (e.g., `process.env.API_KEY`).
*   `validateConfiguration(configs)`: Performs validation checks on the loaded plugin configurations to ensure dependencies (like required providers or storage) are correctly specified and found.

**Data Flow Impact:**

*   Orchestrates the entire plugin loading and initialization phase in `src/index.ts` and `src/historical.ts`.
*   Reads the main JSON configuration file and transforms it into a live, interconnected set of plugin instances.
*   Ensures that plugins receive their necessary dependencies (like AI models or database connections) through injection.

### `dateHelper.ts`

**Functionality:**

*   Provides utility functions for date parsing, formatting, and manipulation.
*   `parseDate(dateStr: string)`: Converts a "YYYY-MM-DD" string to a JavaScript `Date` object.
*   `formatDate(dateObj: Date)`: Converts a `Date` object to a "YYYY-MM-DD" string.
*   `addOneDay(dateObj: Date)`: Increments a `Date` object by one day.
*   `callbackDateRangeLogic(filter: DateConfig, callback: Function)`: Iterates through a date range defined by a `DateConfig` object (supporting `after`, `before`, `during` filters) and executes a provided callback function for each date in the range. This is crucial for historical data processing.

**Data Flow Impact:**

*   Heavily used by `src/historical.ts` to determine the dates for which data needs to be fetched and summaries generated.
*   Plugins dealing with time-sensitive data or historical fetching (e.g., `DiscordRawDataSource.fetchHistorical`) may use these helpers for date calculations.

### `fileHelper.ts`

**Functionality:**

*   Provides utilities for file system operations.
*   `isMediaFile(url: string, contentType?: string | null)`: Checks if a URL or content type indicates a media file (image or video) based on extensions or MIME types.
*   `writeFile(outputPath: string, filename: string, content: any, format: 'json' | 'md' | 'txt' | 'log')`: Writes content to a file in a specified subdirectory (based on format) within the `outputPath`. Ensures the directory exists.
*   `ensureDirectoryExists(dirPath: string)`: Creates a directory (including parent directories if necessary) if it doesn't already exist.

**Data Flow Impact:**

*   Used by generator plugins (e.g., `DailySummaryGenerator`, `DiscordSummaryGenerator`, `RawDataExporter`) to save their output (summaries, exported data) to the file system.
*   `promptHelper.ts` uses it to log prompts if debugging is enabled.

### `generalHelper.ts`

**Functionality:**

*   Contains miscellaneous utility functions that don't fit into more specific categories.
*   `delay(ms: number)`: Creates a promise that resolves after a specified number of milliseconds, useful for rate limiting or pausing execution.
*   `retryOperation(operation: () => Promise<any>, retries?: number)`: A generic function to retry an asynchronous operation a specified number of times with delays, including exponential backoff for rate limit errors.
*   Defines constants like `MAX_RETRIES`, `RETRY_DELAY`, and a `time` object with common time conversions in seconds and milliseconds.

**Data Flow Impact:**

*   `delay` and `retryOperation` are used by source plugins (e.g., `DiscordRawDataSource`, `GitHubDataSource`, `TwitterSource`, `CodexAnalyticsSource`) when making external API calls to handle transient errors, rate limits, and to control request frequency.

### `promptHelper.ts`

**Functionality:**

*   Provides functions to construct detailed prompts for AI providers, ensuring consistency and structure in how AI models are queried.
*   `createMarkdownPromptForJSON(summaryData: any, dateStr: string)`: Generates a prompt to instruct an AI model to convert structured JSON summary data into a Markdown report. Includes specific formatting guidelines for headings, bullet points, and source attribution.
*   `createJSONPromptForTopics(topic: string, objects: any[], dateStr: string, customInstructions?: {...})`: Generates a prompt for creating a JSON summary based on a collection of `ContentItem`s related to a specific topic. It formats the input data (tweets, issues, etc.) clearly for the AI and specifies the desired JSON output structure, including handling for different types of content (e.g., Twitter themes, GitHub issues).
*   Includes a `logPromptToFile` helper (used internally if debugging is enabled) to save generated prompts to log files for inspection.

**Data Flow Impact:**

*   Used by generator plugins (e.g., `DailySummaryGenerator`, `DiscordSummaryGenerator`) that leverage AI providers for summarization.
*   Takes `ContentItem` data (retrieved from storage) and transforms it into structured text prompts for AI models.
*   The AI's response (summary text or structured JSON) is then further processed by the generator. 