# AI News Aggregator

A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content from multiple sources.

## Features

- **Multiple Data Sources**
  - Discord channel raw message data (including users, reactions)
  - GitHub repository statistics
  - Solana token analytics (Codex)
  - CoinGecko market data
  - (Twitter support may require maintenance due to API changes)

- **Processing & Analysis**
  - AI-powered structured summaries of Discord channel activity (using OpenAI/OpenRouter)
  - Raw data export
  - Topic extraction (optional, configurable)

- **Storage & Deployment**
  - SQLite database for persistent storage (with optional encryption via GitHub Actions)
  - Daily summary generation (JSON & Markdown)
  - Deployment to GitHub Pages

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

Local runs use an `.env` file. GitHub Actions workflows use repository secrets.

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
# TWITTER_USERNAME=
# TWITTER_PASSWORD=
# TWITTER_EMAIL=
# TWITTER_COOKIES='[]' # JSON string of cookies
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
  "TWITTER_USERNAME": "",
  "TWITTER_PASSWORD": "",
  "TWITTER_EMAIL": "",
  "TWITTER_COOKIES": "[]"
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
```

## Project Structure

```
config/                 # JSON configuration files for different pipelines
data/                   # SQLite databases (encrypted in repo, decrypted by Actions)
output/                 # Generated raw data exports and summaries
src/
├── aggregator/         # Core aggregation logic (ContentAggregator, HistoricalAggregator)
├── plugins/
│   ├── ai/             # AI provider implementations (OpenAIProvider)
│   ├── enrichers/      # Content enrichment plugins (e.g., AiTopicsEnricher - optional)
│   ├── generators/     # Output generation (RawDataExporter, DiscordSummaryGenerator)
│   ├── sources/        # Data source implementations (DiscordRawDataSource, etc.)
│   └── storage/        # Database storage handlers (SQLiteStorage)
├── helpers/            # Utility functions (config, date, files, etc.)
├── types.ts            # TypeScript type definitions
├── index.ts            # Main application entry point (continuous)
└── historical.ts       # Entry point for historical data processing
# ... other config and project files
```

## Adding New Sources

1.  Create a new class in `src/plugins/sources/` that implements `ContentSource` (and potentially `fetchHistorical`).
2.  Define necessary parameters and logic within the class.
3.  Add a configuration block for your new source in the relevant JSON config file(s) under the `sources` array.

Example `ContentSource` Interface:
```typescript
import { ContentItem } from "../../types";

export interface ContentSource {
  name: string;
  fetchItems(): Promise<ContentItem[]>;
  fetchHistorical?(date: string): Promise<ContentItem[]>;
  // Other methods like init() if needed
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

### ContentItem
Represents a unit of data stored in the `items` table. The exact content varies by type.
```typescript
interface ContentItem {
  id?: number;          // Assigned by storage
  cid: string;          // Unique Content ID from source, or generated
  type: string;         // e.g., "discordRawData", "codexAnalyticsData", etc.
  source: string;       // Name of the source plugin instance (e.g., "hyperfyDiscordRaw")
  title?: string;       // Optional title
  text?: string;        // Main content (e.g., JSON string for discordRawData)
  link?: string;        // URL to original content (if applicable)
  topics?: string[];    // AI-generated topics (if enricher is used)
  date?: number;        // Creation/publication timestamp (epoch seconds)
  metadata?: Record<string, any>; // Additional source-specific data (e.g., channelId, guildName)
}
```

### DiscordRawData (Stored as JSON string in `ContentItem.text` for `type: 'discordRawData'`)
```typescript
interface DiscordRawData {
  channel: {
    id: string;
    name: string;
    topic: string | null;
    category: string | null;
  };
  date: string; // ISO date string for the day fetched
  users: { [userId: string]: { name: string; nickname: string | null; roles?: string[]; isBot?: boolean; } };
  messages: { /* ... message details ... */ }[];
}
```

### SummaryItem (Stored in `summary` table)
Represents a generated summary.
```typescript
interface SummaryItem {
  id?: number;          // Assigned by storage
  type: string;         // e.g., "hyperfyDiscordSummary", "elizaosDevSummary"
  title?: string;       // e.g., "Hyperfy Discord - 2024-01-15"
  categories?: string;  // JSON string containing detailed stats and channel summaries
  markdown?: string;    // Full Markdown content of the summary
  date?: number;        // Timestamp for the summary period (epoch seconds)
}
```

### Example Summary JSON Output (`YYYY-MM-DD.json`)
This structure is derived from the `SummaryItem.categories` field.
```json
{
  "server": "Server Name",
  "title": "Server Name Discord - YYYY-MM-DD",
  "date": 1705363200, // Example epoch timestamp
  "stats": {
    "totalMessages": 150,
    "totalUsers": 25
  },
  "categories": [
    {
      "channelId": "12345",
      "channelName": "general",
      "summary": "Brief AI summary of the general channel...",
      "messageCount": 100,
      "userCount": 20
    },
    {
      "channelId": "67890",
      "channelName": "development",
      "summary": "Brief AI summary of the development channel...",
      "messageCount": 50,
      "userCount": 15
    }
    // ... more channels
  ]
}
```

## Supported Source Types (Examples)

### Discord (`DiscordRawDataSource`)
- Fetches raw messages, user details, reactions, edits, replies for specified channels daily.
- Data is stored as `discordRawData` items.
- Subsequent generators (`DiscordSummaryGenerator`, `RawDataExporter`) process these items.

### GitHub Stats (`GitHubStatsSource`)
- Fetches repository statistics (issues, PRs, commits, contributors).
- Stores data as specific `ContentItem` types.

### Cryptocurrency Analytics (`CodexAnalyticsSource`)
- Fetches token data (price, volume, etc.) from Codex.so.
- Stores data as `codexAnalyticsData` items.

## Scheduled Tasks (GitHub Actions)

The application uses GitHub Actions workflows (`.github/workflows/`) for scheduled data fetching and processing. Examples:
- `discord-raw.yml`: Fetches raw Discord data, generates summaries, exports raw data, deploys encrypted DB and outputs to GitHub Pages.
- `elizaos-dev.yml`: Similar process for ElizaOS Dev Discord data.
- `hyperfy.yml`: Similar process for Hyperfy Discord data.
- Schedules typically run daily.

## Storage

The application uses SQLite. Databases are encrypted in the `data/` directory when stored in the repository / gh-pages branch and decrypted during workflow runs.

### `items` Table
Stores fetched content from various sources.
```sql
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cid TEXT UNIQUE,          -- Content ID (can be null initially)
  type TEXT NOT NULL,     -- Type of content (e.g., discordRawData)
  source TEXT NOT NULL,   -- Name of the source instance
  title TEXT,
  text TEXT,              -- Main content (often JSON for raw data)
  link TEXT,
  topics TEXT,            -- JSON array of strings
  date INTEGER,           -- Epoch timestamp (seconds)
  metadata TEXT           -- JSON object for extra info
);
```

### `summary` Table
Stores generated summaries.
```sql
CREATE TABLE IF NOT EXISTS summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,     -- Type of summary (e.g., elizaosDevSummary)
  title TEXT,
  categories TEXT,        -- JSON object with detailed structure
  markdown TEXT,          -- Full markdown content
  date INTEGER            -- Epoch timestamp (seconds) for the summary period
);
```

### `cursor` Table
Stores the last processed message ID for certain sources.
```sql
CREATE TABLE IF NOT EXISTS cursor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cid TEXT NOT NULL UNIQUE, -- Key identifying the source/channel (e.g., "discordRaw-12345")
  message_id TEXT NOT NULL  -- Last fetched Discord message snowflake ID
);
```
