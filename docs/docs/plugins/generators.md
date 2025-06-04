---
title: Generator Plugins
sidebar_label: Generators
---

Generator plugins are responsible for creating derived content, such as summaries, reports, or data exports, based on the `ContentItem`s that have been fetched, processed, and stored by other parts of the system.

## Key Responsibilities

-   **Data Retrieval:** Query a `StoragePlugin` (e.g., `SQLiteStorage`) to fetch `ContentItem`s relevant to the desired output (e.g., data for a specific date, type, or source).
-   **Content Processing & AI Interaction:** Often use an `AiProvider` plugin to perform complex processing tasks like summarizing text, identifying themes across multiple content items, or structuring information.
-   **Output Formatting:** Format the generated content into desired output structures, typically JSON for detailed data and Markdown for human-readable reports.
-   **Output Persistence:** Save the generated output, which can involve:
    *   Writing files to the filesystem (e.g., to the `output/` directory).
    *   Saving structured summary data back to the `StoragePlugin` as `SummaryItem`s.

## Interface

While there isn't a single, strictly enforced interface for all generators in `src/types.ts` in the same way as for sources or AI providers, they typically have a main public method that triggers their operation, such as:

-   `generateContent()`: Often used by `src/index.ts` for scheduled, ongoing generation (e.g., generating a summary for "yesterday" if it doesn't exist).
-   `generateAndStoreSummary(dateStr: string)`: Often used by `src/historical.ts` and also internally by `generateContent()` to process data for a specific date.

## Available Generator Plugins

-   **`DailySummaryGenerator.ts`**:
    *   Creates daily summaries from a variety of `ContentItem` types.
    *   Groups content by topics (with special handling for GitHub, crypto, and Twitter data).
    *   Uses an AI provider to summarize these groups and then to create an overarching Markdown report.
    *   Saves summaries as `SummaryItem`s in storage and also writes JSON and Markdown files to a configured `outputPath`.

-   **`DiscordSummaryGenerator.ts`**:
    *   Specializes in generating detailed summaries from Discord channel data (specifically from `discordRawData` type `ContentItem`s).
    *   Processes data per channel, uses an AI provider to generate structured summaries (including general summary, FAQs, help interactions, action items) for each.
    *   Then, it creates a combined daily summary (JSON and Markdown) across all processed channels, also using an AI provider for the overall text summary.
    *   Saves to storage and `outputPath`.

-   **`RawDataExporter.ts`**:
    *   Exports raw `ContentItem` data from storage into individual JSON files.
    *   Primarily designed to take `ContentItem`s of a specific `source` type (e.g., "discordRawData") where the `item.text` field is already a JSON string, and save this inner JSON to a file.
    *   Creates a directory structure for output, often based on metadata (e.g., `outputPath/guildName/channelName/YYYY-MM-DD.json` for Discord data).

For detailed information on each generator, please examine its source code and associated README in the `src/plugins/generators/` directory of the project repository. 