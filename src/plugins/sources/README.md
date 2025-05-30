# Content Source Plugins (`src/plugins/sources/`)

This directory contains plugins responsible for fetching data from various external APIs, feeds, or services. Each source plugin transforms the fetched data into a standardized `ContentItem` format (defined in `src/types.ts`).

## Base Interface: `ContentSource.ts`

All source plugins must implement the `ContentSource` interface defined in `ContentSource.ts`.

**`ContentSource` Interface:**

*   `name: string`: A unique identifier for the content source (e.g., "Twitter", "DiscordRaw", "GitHubStats"). This name is used in configuration and logging.
*   `fetchItems(): Promise<ContentItem[]>`: The primary method for fetching current or recent data. It must return a promise that resolves to an array of `ContentItem` objects.
*   `fetchHistorical?(date: string): Promise<ContentItem[]>`: An optional method for fetching data for a specific past date (provided as a "YYYY-MM-DD" string). If a source supports historical fetching, `src/historical.ts` will use this method.

## Available Source Plugins

### `ApiSource.ts`

*   **Functionality:** A generic source for fetching data from a simple REST API endpoint that returns a list of articles.
*   **Configuration (`ApiSourceConfig`):** Requires `name`, `endpoint` (API URL), and `apiKey`.
*   **Data Flow:**
    1.  Appends the `apiKey` to the `endpoint` URL.
    2.  Makes a GET request to the constructed URL.
    3.  Expects a JSON response with an `articles` array. Each article should have `title`, `url`, `publishedAt`, and optionally `content` or `description`.
    4.  Transforms these articles into `ContentItem` objects.
    *   *Note: The current implementation in `fetchItems` initializes an empty `articles: ContentItem[]` and returns it. The mapping logic is commented out.*
*   **Historical:** Does not implement `fetchHistorical`.

### `CodexAnalyticsSource.ts`

*   **Functionality:** Fetches token analytics data (price, volume, market cap) from the Codex API (graph.codex.io) using GraphQL.
*   **Configuration (`CodexAnalyticsSourceConfig`):** Requires `name`, `apiKey` for Codex API, and `tokenAddresses` (array of token contract addresses).
*   **Rate Limiting:** Implements a static rate limiter to ensure no more than 4 requests per second (`MIN_INTERVAL`).
*   **Data Flow (`fetchItems`):**
    1.  Calls `getTokenDetails()` (GraphQL query `filterTokens`) for the configured `tokenAddresses` to get current analytics (change24, volume24, marketCap, priceUSD, buy/sell counts, token info like symbol, cmcId, address, networkId).
    2.  For each token with a `cmcId`, creates a `ContentItem` of type "codexTokenAnalytics" with the fetched data.
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Converts the input `date` string to a Unix timestamp.
    2.  Calls `getTokenDetails()` to get basic token info.
    3.  Prepares a list of address-networkId-timestamp objects for tokens that have a `cmcId`.
    4.  Calls `getTokenPrices()` (GraphQL query `getTokenPrices`) with this list to get historical prices for the given `timestamp`.
    5.  For each token with a `cmcId` and a fetched historical price, creates a `ContentItem` of type "codexTokenAnalytics".
*   **Key Private Methods:**
    *   `getTokenPrices(addresses: any[]): Promise<any[]>`: GraphQL query for historical prices.
    *   `getTokenDetails(addresses: string[]): Promise<any[]>`: GraphQL query for current token details and analytics.
    *   `makeGraphQLQuery(query: string): Promise<any>`: Executes the GraphQL query with rate limiting.

### `CoinGeckoAnalyticsSource.ts`

*   **Functionality:** Fetches cryptocurrency market data (price, volume, market cap, 24h change) from the CoinGecko public API.
*   **Configuration (`CoinGeckoAnalyticsSourceConfig`):** Requires `name` and `tokenSymbols` (array of token symbols like "bitcoin", "ethereum").
*   **Rate Limiting:** Implements a hardcoded 2-second delay (`delay(2000)`) between API calls for each symbol.
*   **Data Flow (`fetchItems`):**
    1.  Iterates through each `symbol` in `tokenSymbols`.
    2.  Constructs the API URL: `https://api.coingecko.com/api/v3/coins/{symbol}`.
    3.  Fetches data from the API.
    4.  If successful, creates a `ContentItem` of type "coinGeckoMarketAnalytics" using data from `response.market_data` (current_price, total_volume, market_cap, price_change_24h, etc.).
*   **Historical:** Does not implement `fetchHistorical`.

### `DiscordAnnouncementSource.ts`

*   **Functionality:** Fetches messages from specified Discord channels, intended for simpler announcement-style channels.
*   **Configuration (`DiscordAnnouncementSourceConfig`):** Requires `name`, `botToken`, and `channelIds`.
*   **Uses `discord.js` library.**
*   **Data Flow (`fetchItems`):**
    1.  Logs in the Discord client if not already ready.
    2.  For each `channelId`:
        *   Fetches the channel.
        *   Fetches the last 10 messages from the channel (`textChannel.messages.fetch({ limit: 10 })`).
        *   Transforms each message into a `ContentItem` of type "discordMessage", including `cid` (message ID), `source` (plugin name), `text` (message content), `link`, `date` (timestamp), and metadata (channelId, guildId, author username, messageId).
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Logs in the Discord client.
    2.  Converts input `date` to a `cutoffTimestamp`.
    3.  For each `channelId`:
        *   Fetches messages in batches of 100, paginating backwards using `before: lastMessageId`.
        *   Collects all messages with `createdTimestamp >= cutoffTimestamp`.
        *   Stops pagination if a batch is empty or the oldest message in a batch is older than `cutoffTimestamp`.
        *   Transforms collected messages into `ContentItem`s.

### `DiscordChannelSource.ts`

*   **Functionality:** Monitors specified Discord channels and generates AI-powered summaries of conversations.
*   **Configuration (`DiscordChannelSourceConfig`):** Requires `name`, `botToken`, `channelIds`, a `storage` plugin instance (for cursors), and an optional `provider` (AiProvider instance).
*   **Uses `discord.js` library.**
*   **Data Flow (`fetchItems`):**
    1.  Logs in the Discord client.
    2.  For each `channelId`:
        *   Retrieves `lastProcessedId` for the channel from `storage.getCursor()` (cursor key: `${this.name}-${channelId}`).
        *   Fetches up to 100 messages after `lastProcessedId` (`fetchOptions.after`).
        *   If messages are found, creates a transcript.
        *   Calls `formatStructuredPrompt()` to create a detailed prompt for the AI.
        *   If an `AiProvider` is configured, sends the prompt to `this.provider.summarize(prompt)`.
        *   Creates a `ContentItem` of type "discordChannelSummary" with the AI summary, link, date, and metadata.
        *   Updates the cursor in storage with the ID of the latest message processed (`this.storage.setCursor(cursorKey, lastFetchedMessageId)`).
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Logs in the Discord client.
    2.  Converts input `date` to `cutoffTimestamp`.
    3.  For each `channelId`:
        *   Paginates backwards (fetching 100 messages at a time using `before: lastMessageId`) until messages are older than `cutoffTimestamp`.
        *   Collects all messages on or after `cutoffTimestamp`.
        *   Creates a transcript and sends it to the `AiProvider` for summarization (similar to `fetchItems`).
        *   Creates a `ContentItem` of type "discordChannelHistoricalSummary".
*   **Key Private Methods:**
    *   `formatStructuredPrompt(transcript: string)`: Creates a detailed prompt asking the AI for a summary, FAQs, help interactions, and action items from the transcript.

### `DiscordRawDataSource.ts`

*   **Functionality:** Fetches comprehensive raw message data, user details, and reaction data from specified Discord channels. This is more detailed than `DiscordAnnouncementSource` or `DiscordChannelSource`.
*   **Configuration (`DiscordRawDataSourceConfig`):** Requires `name`, `botToken`, `channelIds`, `guildId`, and a `storage` plugin instance (for cursors in `fetchItems`).
*   **Uses `discord.js` library.** Employs helper functions for rate limiting (`API_RATE_LIMIT_DELAY`, `retryOperation`, `delay`) and user data fetching (`PARALLEL_USER_FETCHES`).
*   **Data Flow (`fetchItems` - for recent items, typically last hour):
    1.  Logs in the Discord client.
    2.  For each `channelId`:
        *   Gets `lastFetchedMessageId` from storage (cursor: `${this.name}-${channel.id}`).
        *   Fetches messages using `options.after = lastFetchedMessageId`.
        *   Filters messages within the last hour (`cutoff.getTime()`).
        *   If recent messages exist, calls `processMessageBatch()` to gather user data and format messages.
        *   Updates the cursor in storage.
        *   Creates a single `ContentItem` of type "discordRawData". The `text` field of this `ContentItem` is a JSON string representing a `DiscordRawData` object (containing channel info, date, combined users object, and an array of processed messages for that fetch operation).
*   **Data Flow (`fetchHistorical(date: string)` - for a specific full day):
    1.  Logs in the Discord client.
    2.  For each `channelId`:
        *   Calls `fetchChannelMessages(channel, targetDate)`:
            *   Calculates `startOfDay` and `endOfDay` snowflakes for the `targetDate`.
            *   **Phase 1 (Around):** Fetches initial messages around `startSnowflake`.
            *   **Phase 2 (Before):** Paginates backwards from the earliest message found, collecting messages within the target day.
            *   **Phase 3 (After):** Paginates forwards from the latest message found, collecting messages within the target day.
            *   **Phase 4 (Process):** Calls `processMessageBatch()` on all collected messages for the day to gather user details (using `fetchUserDataBatch` which fetches member details in parallel) and format messages (including reactions, mentions, reply info).
        *   The `fetchChannelMessages` returns a `DiscordRawData` object for the entire day for that channel.
        *   This `DiscordRawData` object is stringified and put into the `text` field of a single `ContentItem` of type "discordRawData" for that channel and date.
*   **Key Private Methods:**
    *   `fetchUserDataBatch(...)`, `fetchUserData(...)`: Efficiently fetches Discord member/user details.
    *   `processMessageBatch(...)`: Enriches raw Discord messages with user data and formats them.
    *   `fetchChannelMessages(channel, targetDate)`: Core logic for fetching all messages for a specific channel on a specific day using snowflake pagination.
    *   `dateToSnowflake()`, `snowflakeToDate()`: Utilities for Discord ID and timestamp conversions.
    *   `extractMediaUrls()`: Extracts media URLs from message attachments and embeds.

### `GitHubDataSource.ts`

*   **Functionality:** Fetches GitHub activity data (commits, PRs, issues) and repository summaries from pre-generated JSON endpoints.
*   **Configuration (`GithubDataSourceConfig`):** Requires `name`, `contributorsUrl` (for current contributor activity), `summaryUrl` (for current repo summary), `historicalSummaryUrl` (template for past summaries, e.g., `.../<year>/<month>/<day>/summary.json`), `historicalContributorUrl` (template for past contributor data), `githubCompany`, and `githubRepo`.
*   **Data Flow (`fetchItems` - current data):
    1.  Fetches JSON from `contributorsUrl` and `summaryUrl`.
    2.  Calls `processGithubData()` with the fetched data and current date.
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Constructs URLs for historical summary and contributor data using the `date` and URL templates.
    2.  Fetches JSON from these historical URLs.
    3.  Calls `processGithubData()`.
*   **Data Flow (`processGithubData(contributorsData, summaryData, date)`):
    1.  **Contributor Activities:** Iterates through `contributorsData` (if an array).
        *   For each commit in `c.activity.code.commits`, creates a `ContentItem` of type "githubCommitContributor".
        *   For each PR in `c.activity.code.pull_requests`, creates a `ContentItem` of type "githubPullRequestContributor".
        *   For each issue in `c.activity.issues.opened`, creates a `ContentItem` of type "githubIssueContributor".
        *   Metadata includes details like SHA, PR/issue number, state, additions/deletions, and a photos link using `baseGithubImageUrl`.
    2.  **Repository Summary:** Creates a single `ContentItem` of type "githubSummary" from `summaryData`, including overview, metrics, changes, etc., in its metadata.
    3.  Returns an array of all these created `ContentItem`s.

### `GitHubStatsDataSource.ts`

*   **Functionality:** Fetches detailed GitHub repository statistics, including issue/PR activity, code changes, and contributor metrics from pre-generated JSON endpoints.
*   **Configuration (`GitHubStatsDataSourceConfig`):** Requires `name`, `statsUrl` (for current stats), `historicalStatsUrl` (template for past stats), `githubCompany`, and `githubRepo`.
*   **Data Flow (`fetchItems` - current stats):
    1.  Fetches JSON from `statsUrl`.
    2.  Calls `processStatsData()` with the fetched data and current date.
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Constructs the URL for historical stats using the `date` and `historicalStatsUrl` template.
    2.  Fetches JSON from this URL.
    3.  Calls `processStatsData()`.
*   **Data Flow (`processStatsData(statsData, date, historicalUrl?)`):
    1.  **Overall Summary:** Creates a `ContentItem` of type "githubStatsSummary". `text` is `statsData.overview`. Metadata includes `interval`, `repository`, `codeChanges`, counts for new/merged PRs, new/closed issues, active contributors.
    2.  **Top Issues:** For each issue in `statsData.topIssues`, creates a `ContentItem` of type "githubIssue".
    3.  **Top PRs:** For each PR in `statsData.topPRs`, creates a `ContentItem` of type "githubPullRequest".
    4.  **Completed Items:** For each item in `statsData.completedItems`, creates a `ContentItem` of type "githubCompletedItem".
    5.  **Top Contributors:** If `statsData.topContributors` exists, creates a single `ContentItem` of type "githubTopContributors" with the list of contributors in metadata.
    6.  Returns an array of all created `ContentItem`s.

### `SolanaAnalyticsSource.ts`

*   **Functionality:** Fetches market data for Solana tokens from the DexScreener API.
*   **Configuration (`SolanaTokenAnalyticsSourceConfig`):** Requires `name`, `apiKey` (for DexScreener), and `tokenAddresses` (array of Solana token addresses).
*   **Data Flow (`fetchItems`):
    1.  For each `tokenAddress`:
        *   Constructs API URL: `https://api.dexscreener.com/token-pairs/v1/solana/{tokenAddress}`.
        *   Makes a GET request with `Authorization: Bearer {this.apiKey}` header.
        *   Finds the pair in the response where `quoteToken.address` is the SOL address (`So1111...`).
        *   From this pair data, creates a `ContentItem` of type "solanaTokenAnalytics".
        *   Metadata includes price, 24h volume, market cap, 24h price change, and buy/sell transaction counts for 24h.
*   **Historical:** Does not implement `fetchHistorical`.

### `TwitterSource.ts`

*   **Functionality:** Fetches tweets and retweets for specified Twitter accounts using the `agent-twitter-client` library.
*   **Configuration (`TwitterSourceConfig`):** Requires `name`, `accounts` (array of Twitter screen names to monitor). Authentication can be via `username`, `password`, `email`, or pre-existing `cookies` (JSON string). `fetchMode` ('timeline' or 'search') can be specified, defaulting to 'timeline' for constructor, but `fetchHistorical` defaults to 'search' unless overridden by CLI/config in `historical.ts`.
*   **Caching:** Uses `TwitterCache` (from `src/helpers/cache.ts`) to cache fetched tweets for historical calls and to store/retrieve login cookies.
*   **Authentication:** `init()` method handles login using credentials or cookies. Cookies are cached per username.
*   **Data Flow (`fetchItems` - recent tweets, typically last 10 per account for continuous mode):
    1.  Ensures client is logged in (calls `init()` if not).
    2.  For each `account`:
        *   Uses `this.client.getTweets(account, 10)` (fetches a small number of recent tweets).
        *   Calls `processTweets()` for each fetched raw tweet.
*   **Data Flow (`fetchHistorical(date: string)`):
    1.  Ensures client is logged in.
    2.  Determines `targetDateEpoch` (start of day) and `untilDateEpoch` (end of day).
    3.  **If `this.fetchMode === 'search'`:**
        *   For each `account`, checks cache for `(account, date)`.
        *   Constructs a search query: `(from:{account}) since:{date} until:{untilDateStr} include:nativeretweets`.
        *   Uses `this.client.fetchSearchTweets()` in a loop (up to `MAX_SEARCH_PAGES`), processing results with `processTweets()`.
        *   Filters processed tweets to be strictly within the target day's epoch range.
        *   Caches results per account and date.
    4.  **Else (default 'timeline' mode):**
        *   For each `account`, checks cache.
        *   Gets `userId` using `this.client.getUserIdByScreenName(account)`.
        *   Uses `this.client.getUserTweetsIterator(userId, MAX_TWEETS_TO_SCAN_PER_USER)` to iterate through the user's timeline (up to a limit).
        *   Collects raw tweets whose `timestamp` falls within the target day.
        *   Calls `processTweets()` on the collected tweets.
        *   Caches results and adds to the final list.
*   **Data Flow (`processTweets(rawTweets: any[])` - complex private method):
    1.  Iterates through each `rawTweet`.
    2.  Determines if it's a retweet (`rawTweet.isRetweet`).
        *   If retweet: sets `contentItem.type = "retweet"`. Metadata includes retweeter info. Tries to fetch/use the original tweet (`rawTweet.retweetedStatus` or fetches via `this.client.getTweet(rawTweet.retweetedStatusId)` with a timeout). `tweetToProcessForContent` becomes the original tweet.
        *   If not retweet: `contentItem.type = "tweet"`. `tweetToProcessForContent` is the `rawTweet` itself.
    3.  Populates `contentItem.text`, `link`, and common metadata (author user/name, photos, videos, likes, replies, etc.) from `tweetToProcessForContent`.
    4.  Attempts to fetch `authorProfileImageUrl` using `this.client.getProfile(tweetToProcessForContent.username)`.
    5.  Handles quoted tweets (`tweetToProcessForContent.isQuoted`):
        *   Fetches quoted tweet details (`this.client.getTweet(tweetToProcessForContent.quotedStatusId)`) with a timeout.
        *   Populates `metadata.quotedTweet` with details (ID, text, link, author, date) and attempts to fetch the quoted tweet author's profile image.
    6.  Returns an array of fully processed `ContentItem`s. 