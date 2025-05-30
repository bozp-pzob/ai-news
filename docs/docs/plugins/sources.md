---
title: Source Plugins
sidebar_label: Sources
---

Source plugins are responsible for fetching data from various external platforms and services. They act as the entry point for content into the AI News Aggregator system.

## Key Responsibilities

-   **Data Acquisition:** Connect to APIs, scrape websites (though not a primary focus of current plugins), or parse feeds (e.g., RSS, though not explicitly implemented yet).
-   **Data Normalization:** Transform the raw data fetched from the external source into a standardized array of `ContentItem` objects, as defined in `src/types.ts`.
-   **Authentication:** Handle any necessary authentication mechanisms required by the external source (e.g., API keys, bot tokens, cookies).
-   **Historical Fetching (Optional):** Some sources implement a `fetchHistorical(date: string)` method to retrieve data for specific past dates.

## Interface

All source plugins implement the `ContentSource` interface (defined in `src/plugins/sources/ContentSource.ts`). Key methods include:

-   `fetchItems(): Promise<ContentItem[]>`: For fetching current/recent data.
-   `fetchHistorical?(date: string): Promise<ContentItem[]>`: For fetching data for a specific past date.

## Available Source Plugins

The following source plugins are currently available:

-   **`ApiSource`**: Generic source for simple REST APIs.
-   **`CodexAnalyticsSource`**: For token analytics from Codex API (GraphQL).
-   **`CoinGeckoAnalyticsSource`**: For crypto market data from CoinGecko API.
-   **`DiscordAnnouncementSource`**: For fetching messages from Discord channels (simpler version).
-   **`DiscordChannelSource`**: For fetching and generating AI summaries of Discord channel conversations.
-   **`DiscordRawDataSource`**: For comprehensive raw message and user data fetching from Discord.
-   **`GitHubDataSource`**: For GitHub activity (commits, PRs, issues) from JSON endpoints.
-   **`GitHubStatsDataSource`**: For detailed GitHub repository statistics from JSON endpoints.
-   **`SolanaAnalyticsSource`**: For Solana token market data from DexScreener API.
-   **`TwitterSource`**: For fetching tweets and retweets using `agent-twitter-client`.

Detailed information on each source plugin, including its specific configuration parameters and data flow, can be found by examining its source code and associated README in the `src/plugins/sources/` directory of the project repository.

*(In a more mature Docusaurus site, each plugin above might have its own dedicated documentation page within this section.)* 