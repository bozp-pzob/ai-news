# AI News Aggregator

A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content from multiple sources.

## Features

- **Modular Plugin System**  
  Easily extendable with plugins for data sources, AI processing, content enrichment, summary generation, and storage.

- **Diverse Data Sources**  
  Pre-built plugins for:
  - Discord (raw messages, user details, AI-summarized conversations)
  - GitHub (repository statistics, contributor activity)
  - Cryptocurrency Analytics (Solana via DexScreener, general tokens via Codex API, market data via CoinGecko)
  - Generic APIs (configurable for various REST endpoints)

- **AI-Powered Processing**
  - Automated content summarization (e.g., daily reports, Discord channel activity) using configurable AI providers (OpenAI, OpenRouter).
  - Optional content enrichment (e.g., topic extraction, image generation).

- **Flexible Storage & Output**
  - SQLite for persistent storage of fetched content and generated summaries.
  - Customizable data export (e.g., raw daily Discord data as JSON).
  - Generation of summaries in JSON and Markdown formats.

- **Historical Data Processing**  
  Dedicated script (`historical.ts`) for fetching and processing data from past dates or ranges.

- **Configuration Driven**  
  Behavior controlled by JSON configuration files and environment variables.

## Prerequisites

- Node.js â‰¥ 18 (v23 recommended)
- TypeScript
- SQLite3 (command-line tool required for integrity checks)
- npm

## Installation

```bash
git clone https://github.com/yourusername/ai-news.git
cd ai-news
npm install
cp example.env .env
```

## Configuration

Use JSON files in the `config/` directory and a `.env` file for secrets.

### Example `.env` File

```env
OPENAI_API_KEY=
USE_OPENROUTER=true
SITE_URL=your_site.com
SITE_NAME=YourAppName

DISCORD_TOKEN=
DISCORD_GUILD_ID=

CODEX_API_KEY=
```

## GitHub Actions Secrets

Create two repository secrets in GitHub:

1. `ENV_SECRETS` â€“ JSON object with credentials:
```json
{
  "OPENAI_API_KEY": "sk-...",
  "USE_OPENROUTER": "true",
  "SITE_URL": "your_site.com",
  "SITE_NAME": "YourAppName",
  "DISCORD_APP_ID": "your_discord_app_id",
  "DISCORD_TOKEN": "your_discord_bot_token",
  "DISCORD_GUILD_ID": "your_discord_guild_id",
  "CODEX_API_KEY": "your_codex_key"
}
```

2. `SQLITE_ENCRYPTION_KEY` â€“ strong password to encrypt the database.

## Running the Application

```bash
npm run build
npm start
npm start -- --source=discord-raw.json
```

## Historical Data Fetching

```bash
npm run historical -- --source=discord-raw.json --output=./output/discord
npm run historical -- --source=elizaos-dev.json --date=2024-01-15 --output=./output/elizaos-dev
npm run historical -- --source=hyperfy-discord.json --after=2024-01-10 --before=2024-01-16 --output=./output/hyperfy
npm run historical -- --source=discord-raw.json --after=2024-01-15 --output=./output/discord
npm run historical -- --source=discord-raw.json --before=2024-01-10 --output=./output/discord
```

## Project Structure

```
.github/              GitHub Actions workflows
config/               Configuration files
data/                 Encrypted SQLite databases
docs/                 Docusaurus documentation
src/                  Source code
  aggregator/         Aggregators (ContentAggregator, HistoricalAggregator)
  plugins/            Plugins (sources, enrichers, generators, storage)
  helpers/            Utility functions
  types.ts            Type definitions
  index.ts            Main entry point
  historical.ts       Historical data runner
example.env           Template .env
README.md             This file
```

## Adding New Sources

1. Create a new class in `src/plugins/sources/` implementing `ContentSource`:
```ts
import { ContentItem } from "../../types";

export interface ContentSource {
  name: string;
  fetchItems(): Promise<ContentItem[]>;
  fetchHistorical?(date: string): Promise<ContentItem[]>;
}
```

2. Add the new source to the desired config file:
```json
{
  "type": "YourNewSource",
  "name": "descriptive-name",
  "interval": 300,
  "params": {}
}
```

## Contributing

```bash
git checkout -b feature/YourFeature
git commit -m "Add YourFeature"
git push origin feature/YourFeature
```

## License

MIT

## Core Data Structures

### `ContentItem`

```ts
{
  cid: string;
  type: string;
  source: string;
  text?: string;
  date?: number;
  metadata?: { [key: string]: any };
}
```

### `SummaryItem`

```ts
{
  type: string;
  title?: string;
  categories?: string;
  markdown?: string;
  date?: number;
}
```

## Supported Source Types

- Discord: `DiscordRawDataSource`, `DiscordChannelSource`, `DiscordAnnouncementSource`
- GitHub: `GitHubStatsDataSource`, `GitHubDataSource`
- Crypto: `CodexAnalyticsSource`, `CoinGeckoAnalyticsSource`, `SolanaAnalyticsSource`
- Generic: `ApiSource`

## Scheduled Tasks

GitHub Actions workflows in `.github/workflows/` automate scheduled processing for data sources and summary generation.