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

Create three repository secrets in GitHub:

1. `ENV_SECRETS` â€" JSON object with credentials:
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

2. `SQLITE_ENCRYPTION_KEY` â€" strong password to encrypt the database.

### For Webhook Server Integration (deploy-media-collection.yml)

3. `COLLECT_WEBHOOK_URL` â€" Your webhook server endpoint:
```
https://your-server.com/run-collect
```

4. `COLLECT_WEBHOOK_SECRET` â€" HMAC signing secret (generate with `openssl rand -hex 32`):
```
a1b2c3d4e5f6...
```

## Running the Application

```bash
npm run build
npm start
npm start -- --source=elizaos.json
```

## Historical Data Fetching

```bash
npm run historical -- --source=elizaos.json --output=./output
npm run historical -- --source=hyperfy-discord.json --after=2024-01-10 --before=2024-01-16 --output=./output/hyperfy
npm run historical -- --source=elizaos.json --after=2024-01-15 --output=./output
npm run historical -- --source=elizaos.json --before=2024-01-10 --output=./output
```

## Channel Management

### Channel Discovery
Automatically discover and track Discord channels across all configured servers:

```bash
# Generate channel checklist (runs daily via GitHub Action)
npm run discover-channels

# Test mode (validate configs without Discord API)
npm run discover-channels -- --test-configs
```

📋 **Channel Checklist**: View and edit tracked channels at [scripts/CHANNELS.md](scripts/CHANNELS.md)

### Configuration Updates
Update configs based on checked channels in the checklist:

```bash
# Apply changes from checklist to config files
npm run update-configs

# Preview changes without applying
npm run update-configs -- --dry-run
```

### Workflow Options

**Option A: GitHub Web Interface (Automated)**
1. Open [scripts/CHANNELS.md](scripts/CHANNELS.md) on GitHub
2. Edit file and check/uncheck channel boxes
3. Commit changes
4. GitHub Action automatically runs `update-configs` and commits any config changes

**Option B: Local Development**
1. Run `npm run discover-channels` to update checklist
2. Edit `scripts/CHANNELS.md` locally to check/uncheck channels
3. Run `npm run update-configs` to update config files
4. Commit and push changes

**Option C: Manual GitHub Workflow**
1. Open [scripts/CHANNELS.md](scripts/CHANNELS.md) on GitHub and edit
2. Commit changes → Pull locally: `git pull`
3. Apply updates: `npm run update-configs`

## Server Deployment

For running data collection on a server instead of GitHub Actions (recommended for media downloads due to file size limits):

### Webhook Server Setup
1. Clone repository to server: `git clone <repo> ~/ai-news`
2. Install dependencies: `cd ~/ai-news && npm install && npm run build`
3. Copy `.env.example` to `.env` and configure with your API keys
4. Generate webhook secret: `openssl rand -hex 32`
5. Start webhook server:
   ```bash
   export COLLECT_WEBHOOK_SECRET="your-generated-secret"
   npm run webhook
   ```
6. Setup reverse proxy (Nginx/Caddy) with HTTPS for production

### Usage

**Webhook Server:**
```bash
# Start server (listens on localhost:3000)
export COLLECT_WEBHOOK_SECRET="your-secret"
npm run webhook

# Test webhook locally
./scripts/test-webhook.sh elizaos.json 2025-01-15
```

**Manual Collection (Alternative):**
```bash
# Direct script execution
./scripts/collect-daily.sh elizaos.json
./scripts/collect-daily.sh hyperfy-discord.json 2025-01-15
```

**GitHub Actions Integration:**
- Configure `COLLECT_WEBHOOK_URL` and `COLLECT_WEBHOOK_SECRET` in GitHub Secrets
- GitHub Actions sends HMAC-signed webhook requests daily at 6 AM UTC
- View/trigger manual runs at Actions > Daily Media Collection
- No SSH keys or server access needed

**Benefits of Webhook Approach:**
- No SSH complexity or key management
- Secure HMAC signature verification
- No GitHub file size limits for media downloads
- GitHub Actions provides scheduling and monitoring
- Simple HTTP-based integration

## Media Download

Discord media files (images, videos, attachments) can be downloaded to a VPS using a manifest-based approach.

### How It Works

1. **GitHub Actions** generates a `media-manifest.json` with URLs during daily runs
2. **Manifest** is deployed to gh-pages branch
3. **VPS script** fetches manifest and downloads files

### Generate Manifest Locally

```bash
npm run generate-manifest -- --db=data/elizaos.sqlite --date=2024-12-14 --source=elizaos --manifest-output=./output/manifest.json
```

### VPS Setup

```bash
# Clone and setup
git clone https://github.com/M3-org/ai-news.git ~/ai-news-media
python3 ~/ai-news-media/scripts/media-sync.py setup

# Download media
python3 ~/ai-news-media/scripts/media-sync.py sync --dry-run  # Preview
python3 ~/ai-news-media/scripts/media-sync.py sync            # Download

# Check status
python3 ~/ai-news-media/scripts/media-sync.py status
```

The `setup` command installs a systemd timer that runs daily at 01:30 UTC.

### Manifest Location

After GitHub Actions runs, manifests are available at:
- `https://raw.githubusercontent.com/M3-org/ai-news/gh-pages/elizaos/media-manifest.json`
- `https://raw.githubusercontent.com/M3-org/ai-news/gh-pages/hyperfy/media-manifest.json`

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
