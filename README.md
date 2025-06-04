# AI News Aggregator

A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content from multiple sources.

## Features

- **Modular Plugin System:** Easily extendable with plugins for data sources, AI processing, content enrichment, summary generation, and storage.
- **Diverse Data Sources:** Pre-built plugins for:
  - Discord (raw messages, user details, AI-summarized conversations)
  - GitHub (repository statistics, contributor activity)
  - Cryptocurrency Analytics (Solana via DexScreener, general tokens via Codex API, market data via CoinGecko)
  - Twitter (recent and historical tweets)
  - Generic APIs (configurable for various REST endpoints)
- **AI-Powered Processing:**
  - Automated content summarization (e.g., daily reports, Discord channel activity) using configurable AI providers (OpenAI, OpenRouter).
  - Optional content enrichment (e.g., topic extraction, image generation).
- **Flexible Storage & Output:**
  - SQLite for persistent storage of fetched content and generated summaries.
  - Customizable data export (e.g., raw daily Discord data as JSON).
  - Generation of summaries in JSON and Markdown formats.
- **Historical Data Processing:** Dedicated script (`historical.ts`) for fetching and processing data from past dates or ranges.
- **Configuration Driven:** Behavior controlled by JSON configuration files and environment variables.

## Prerequisites

- Node.js ≥ 18 (v23 recommended based on workflows)
- TypeScript
- SQLite3 (Command-line tool needed for integrity checks in workflows)
- npm

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-news.git

# Install dependencies
cd ai-news
npm install

# Create .env file and add your credentials for local runs
cp example.env .env
```

## Configuration

Configuration is managed through JSON files in the `config/` directory (e.g., `sources.json`, `discord-raw.json`) and environment variables for sensitive data.

### Local `.env` File

Create a `.env` file in the project root:

```env
# OpenAI / OpenRouter
OPENAI_API_KEY=           # Your OpenRouter API key (or OpenAI if not using OpenRouter)
# OPENAI_DIRECT_KEY=        # Optional: Direct OpenAI key if needed for specific features
USE_OPENROUTER=true      # Set to true to use OpenRouter
SITE_URL=your_site.com    # Your site URL for OpenRouter attribution
SITE_NAME=YourAppName     # Your app name for OpenRouter attribution

# Discord
DISCORD_TOKEN=            # Your Discord Bot Token
DISCORD_GUILD_ID=         # The ID of the Discord server you are monitoring
# DISCORD_APP_ID=          # Likely not needed unless using slash commands

# Crypto Analytics
CODEX_API_KEY=            # Your Codex API key

# Optional: Twitter (Requires careful cookie handling)
# TWITTER_USERNAME=         # Username for login fallback and cookie caching
# TWITTER_PASSWORD=         # Password for login fallback
# TWITTER_EMAIL=            # Email for login fallback
# TWITTER_COOKIES='[]'     # Optional: JSON string of cookies, preferred if available
```

### GitHub Actions Secrets (`ENV_SECRETS`)

For running via GitHub Actions, create a single repository secret named `ENV_SECRETS` containing a JSON object with your credentials. You also need a secret named `SQLITE_ENCRYPTION_KEY` for database encryption.

1.  Navigate to your GitHub repository.
2.  Go to "Settings" > "Secrets and variables" > "Actions".
3.  Click "New repository secret".
4.  Name: `ENV_SECRETS`. Value: Copy and paste the JSON below, filling in your values.
5.  Click "New repository secret" again.
6.  Name: `SQLITE_ENCRYPTION_KEY`. Value: Enter a strong password for encrypting the database.

**`ENV_SECRETS` JSON Structure:**

```json
{
  "OPENAI_API_KEY": "sk-or-....",
  "USE_OPENROUTER": "true",
  "SITE_URL": "your_site.com",
  "SITE_NAME": "YourAppName",
  "DISCORD_APP_ID": "YOUR_DISCORD_APP_ID",
  "DISCORD_TOKEN": "YOUR_DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID": "YOUR_DISCORD_SERVER_ID",
  "CODEX_API_KEY": "YOUR_CODEX_KEY",
  "TWITTER_USERNAME": "", # Username for login fallback and cookie caching
  "TWITTER_PASSWORD": "", # Password for login fallback
  "TWITTER_EMAIL": "",    # Email for login fallback
  "TWITTER_COOKIES": "[]"  # Optional: JSON string of cookies, preferred if available
}
```

## Running the Application

Configuration files (e.g., `discord-raw.json`, `elizaos-dev.json`) define which sources and generators run.

```bash
# Build the project
npm run build

# Run the main continuous process (using config/sources.json by default)
npm start

# Run using a specific config file
npm start -- --source=discord-raw.json

# --- Historical Data Fetching & Processing --- #

# Run historical script using a specific config (processes yesterday by default)
npm run historical -- --source=discord-raw.json --output=./output/discord

# Run historical for a specific date
npm run historical -- --source=elizaos-dev.json --date=2024-01-15 --output=./output/elizaos-dev

# Run historical for a date range
npm run historical -- --source=hyperfy-discord.json --after=2024-01-10 --before=2024-01-16 --output=./output/hyperfy

# Run historical for dates after a specific date
npm run historical -- --source=discord-raw.json --after=2024-01-15 --output=./output/discord

# Run historical for dates before a specific date
npm run historical -- --source=discord-raw.json --before=2024-01-10 --output=./output/discord

# Run historical with specific Twitter fetch mode
npm run historical -- --source=elizaos.json --date=2025-04-26 --fetchMode=timeline
# (--fetchMode can be 'search' or 'timeline'. 'search' is default for historical runs; 'timeline' is better for retweets but slower.)
```

## Project Structure

The project is organized as follows:

```
.github/
  workflows/          # GitHub Actions for automated tasks
config/                 # JSON configuration files for different pipelines
data/                   # SQLite databases (encrypted in repo)
docs/                   # Docusaurus documentation files
src/                    # Core source code
├── README.md           # Overview of the src directory (links to sub-READMEs)
├── aggregator/         # Core aggregation engines (ContentAggregator, HistoricalAggregator)
├── plugins/            # Modular plugins (AI, Enrichers, Generators, Sources, Storage)
├── helpers/            # Utility functions (config loading, date handling, etc.)
├── types.ts            # Core TypeScript type definitions and interfaces
├── index.ts            # Main entry point for continuous operation
└── historical.ts       # Entry point for historical data processing
example.env             # Example environment variable file
package.json            # Project dependencies and scripts
README.md               # This file
# ... other project files
```
For more detailed information on the `src` subdirectories and their contents, please refer to the `README.md` files located within each respective subdirectory (e.g., `src/plugins/README.md`, `src/helpers/README.md`).

## Twitter Data Fetching Notes

When fetching historical Twitter data using `npm run historical`, you can specify a fetch mode using the `--fetchMode` flag:

-   `--fetchMode=search` (Default for `historical` script):
    -   Uses Twitter's search API for the specified date(s).
    -   Generally faster and more efficient for fetching tweets from a precise date or range.
    -   May be less reliable for comprehensively capturing all retweets or all activities for some accounts.
    -   Recommended if your primary goal is original tweets from specific dates and speed is a priority.

-   `--fetchMode=timeline`:
    -   Scans user timelines by fetching recent tweets and then filters by date.
    -   More comprehensive for capturing all tweet types, including retweets.
    -   Can be slower as it might process more tweets than strictly necessary for the target date, especially for very active users.
    -   Recommended for initial large historical data fetches where completeness of retweets is important, or if the `search` mode is not yielding desired results for specific accounts/dates.

For continuous operation (`npm start`), `TwitterSource` defaults to the `timeline` mode to ensure better capture of all tweet types, including retweets, over time.

## Adding New Sources

1.  Create a new class in `src/plugins/sources/` that implements the `ContentSource` interface (defined in `src/plugins/sources/ContentSource.ts`).
2.  Implement the required `name: string` property and `fetchItems(): Promise<ContentItem[]>` method.
3.  Optionally, implement `fetchHistorical?(date: string): Promise<ContentItem[]>` if the source supports fetching past data.
4.  Define any necessary configuration parameters for your source and how they will be passed in (typically via the `params` object in the JSON configuration, which might reference environment variables).
5.  Add a configuration block for your new source in the relevant JSON config file(s) (e.g., `config/sources.json`) under the `sources` array, specifying its `type` (matching the class name), a unique `name`, `interval` (for `index.ts`), and `params`.

Example `ContentSource` Interface (`src/plugins/sources/ContentSource.ts`):
```typescript
import { ContentItem } from "../../types";

export interface ContentSource {
  name: string;
  fetchItems(): Promise<ContentItem[]>;
  fetchHistorical?(date: string): Promise<ContentItem[]>;
}
```

## Contributing

1.  Fork the repository
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## License

MIT License

## Core Data Structures

Key data structures are defined in `src/types.ts`. Refer to `src/README.md` for more details on these.

### `ContentItem`
The central data structure for fetched content. It standardizes data from various sources before storage and processing.
Key fields:
- `cid: string`: Unique ID from the original source.
- `type: string`: Nature of the content (e.g., "tweet", "discordRawData").
- `source: string`: Name of the source plugin instance.
- `text?: string`: Main content body (can be JSON for raw data types).
- `date?: number`: Timestamp of creation/publication (epoch seconds).
- `metadata?: { [key: string]: any; }`: Source-specific additional data.

(Full interface in `src/types.ts`)

### `SummaryItem`
Represents a generated summary, potentially combining multiple `ContentItem`s.
Key fields:
- `type: string`: Type of summary (e.g., "dailyReport", "discordChannelSummary").
- `title?: string`: Summary title.
- `categories?: string`: JSON string for structured summary content (e.g., themed sections, lists of items).
- `markdown?: string`: Full summary content in Markdown format.
- `date?: number`: Timestamp for the summary period (epoch seconds).

(Full interface in `src/types.ts`)

## Supported Source Types (Examples)

This application supports a variety of source types through its plugin architecture. Refer to `src/plugins/sources/README.md` for a detailed list and functionality of each source plugin. Examples include:

*   **Discord:** `DiscordRawDataSource`, `DiscordChannelSource`, `DiscordAnnouncementSource`
*   **GitHub:** `GitHubStatsDataSource`, `GitHubDataSource`
*   **Crypto Analytics:** `CodexAnalyticsSource`, `CoinGeckoAnalyticsSource`, `SolanaAnalyticsSource`
*   **Twitter:** `TwitterSource`
*   **Generic API:** `ApiSource`

## Scheduled Tasks (GitHub Actions)

The application uses GitHub Actions workflows (`.github/workflows/`) for scheduled data fetching and processing. Examples:
- `discord-raw.yml`: Fetches raw Discord data, generates summaries, exports raw data, deploys encrypted DB and outputs to GitHub Pages.
- `elizaos-dev.yml`: Similar process for ElizaOS Dev Discord data.
- `hyperfy.yml`: Similar process for Hyperfy Discord data.
- Schedules typically run daily.

## Storage

The application uses SQLite for persistent storage, managed by the `SQLiteStorage` plugin. Key tables include:

- **`items`**: Stores `ContentItem` data from all sources.
- **`summary`**: Stores generated `SummaryItem` data.
- **`cursor`**: Stores pagination cursors for sources to keep track of fetched data.

Refer to `src/plugins/storage/README.md` for detailed schemas and implementation.
