# AI News Aggregator

A modular TypeScript-based news aggregator that collects, enriches, and analyzes AI-related content from multiple sources.

## Features

- **Modular Plugin System**  
  Easily extendable with plugins for data sources, AI processing, content enrichment, summary generation, and storage.

- **Diverse Data Sources**  
  Pre-built plugins for:
  - Discord (raw messages, user details, AI-summarized conversations, media download)
  - GitHub (repository statistics, contributor activity)
  - Cryptocurrency Analytics (Solana via DexScreener, general tokens via Codex API, market data via CoinGecko)
  - Generic APIs (configurable for various REST endpoints)

- **AI-Powered Processing**
  - Automated content summarization (e.g., daily reports, Discord channel activity) using configurable AI providers (OpenAI, OpenRouter).
  - Token limit resilience with automatic fallback models for large content processing.
  - Optional content enrichment (e.g., topic extraction, image generation, meme generation via Imgflip API).

- **Flexible Storage & Output**
  - SQLite for persistent storage of fetched content and generated summaries.
  - Customizable data export (e.g., raw daily Discord data as JSON).
  - Generation of summaries in JSON and Markdown formats.

- **Historical Data Processing**  
  Dedicated script (`historical.ts`) for fetching and processing data from past dates or ranges.

- **Configuration Driven**  
  Behavior controlled by JSON configuration files and environment variables.

## Prerequisites

- Node.js ≥ 18 (v23 recommended)
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
# OpenAI/OpenRouter Configuration
OPENAI_API_KEY=your_openai_or_openrouter_api_key
OPENAI_DIRECT_KEY=your_direct_openai_key_for_images
USE_OPENROUTER=true
SITE_URL=https://your-domain.com/ai-news/
SITE_NAME=AI_News

# Discord Bot Configuration
DISCORD_APP_ID=your_discord_app_id
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_main_discord_guild_id

# Optional: Additional Discord servers
HYPERFY_DISCORD_APP_ID=your_hyperfy_discord_app_id
HYPERFY_DISCORD_TOKEN=your_hyperfy_discord_token
HYPERFY_DISCORD_GUILD_ID=your_hyperfy_guild_id

# API Keys for Data Sources
CODEX_API_KEY=your_codex_api_key
BIRDEYE_API_KEY=your_birdeye_api_key

# CDN Configuration (optional)
BUNNY_STORAGE_ZONE=your_bunny_storage_zone
BUNNY_STORAGE_PASSWORD=your_bunny_api_password
BUNNY_CDN_URL=https://your-custom-cdn.com
```

See `.env.example` for all available options.

## GitHub Actions Secrets

Create these repository secrets in GitHub:

1. `ENV_SECRETS` — JSON object with credentials:
```json
{
  "OPENAI_API_KEY": "sk-...",
  "OPENAI_DIRECT_KEY": "sk-...",
  "USE_OPENROUTER": "true",
  "SITE_URL": "https://your-domain.com/ai-news/",
  "SITE_NAME": "AI_News",
  "DISCORD_APP_ID": "your_discord_app_id",
  "DISCORD_TOKEN": "your_discord_bot_token",
  "DISCORD_GUILD_ID": "your_discord_guild_id",
  "HYPERFY_DISCORD_APP_ID": "your_hyperfy_app_id",
  "HYPERFY_DISCORD_TOKEN": "your_hyperfy_token",
  "HYPERFY_DISCORD_GUILD_ID": "your_hyperfy_guild_id",
  "CODEX_API_KEY": "your_codex_key",
  "BIRDEYE_API_KEY": "your_birdeye_key",
  "IMGFLIP_USERNAME": "your_imgflip_username",
  "IMGFLIP_PASSWORD": "your_imgflip_password",
  "BUNNY_STORAGE_ZONE": "your_bunny_storage_zone",
  "BUNNY_STORAGE_PASSWORD": "your_bunny_api_password",
  "BUNNY_CDN_URL": "https://your-custom-cdn.com"
}
```

**Notes:** `OPENAI_DIRECT_KEY` is required for image generation when using OpenRouter. `IMGFLIP_*` credentials are required for meme generation (sign up at imgflip.com). `HYPERFY_*`, `BIRDEYE_*`, and `BUNNY_*` keys are optional depending on your configuration.

2. `SQLITE_ENCRYPTION_KEY` — strong password to encrypt the database.

### For Webhook Server Integration (deploy-media-collection.yml)

3. `COLLECT_WEBHOOK_URL` — Your webhook server endpoint:
```
https://your-server.com/run-collect
```

4. `COLLECT_WEBHOOK_SECRET` — HMAC signing secret (generate with `openssl rand -hex 32`):
```
a1b2c3d4e5f6...
```

### For CDN Media Upload (media-cdn-upload.yml)

5. `BUNNY_STORAGE_ZONE` — Storage zone name from Bunny.net dashboard (Storage → your zone name)

6. `BUNNY_STORAGE_PASSWORD` — FTP & API Access password from Bunny.net (Storage → FTP & API Access → Password)

**Optional:** Set `BUNNY_CDN_URL` in ENV_SECRETS if using a custom hostname (default: `https://{zone}.b-cdn.net`)

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
npm run historical -- --source=discord-raw.json --after=2024-01-15 --output=./output/discord
npm run historical -- --source=discord-raw.json --before=2024-01-10 --output=./output/discord
```

## Channel Management

Unified CLI for Discord channel discovery, tracking, and configuration:

```bash
# Discover all channels from Discord API → registry → CHANNELS.md
npm run channels -- discover --sample

# Test mode (validate configs without Discord API)
npm run channels -- discover --test-configs

# Sync CHANNELS.md changes to registry and configs
npm run channels -- sync [--dry-run]

# Query and manage channels
npm run channels -- list [--tracked|--active|--muted]
npm run channels -- show <channelId>
npm run channels -- stats
npm run channels -- track|untrack|mute|unmute <channelId>

# With media download
npm run historical -- --source=elizaos.json --download-media --date=2024-01-15
```

## Media Download

```bash
npm run download-media                                    # Today's media
npm run download-media -- --date=2024-01-15             # Specific date
npm run download-media -- --start=2024-01-10 --end=2024-01-15  # Date range
```

## CDN Upload

Upload media files to Bunny CDN for permanent hosting (Discord URLs expire after 24h):

```bash
# Upload single file
npm run upload-cdn -- --file ./media/image.png --remote elizaos-media/

# Upload directory
npm run upload-cdn -- --dir ./media/ --remote elizaos-media/

# Upload and update manifest with CDN URLs
npm run upload-cdn -- --manifest ./media/manifest.json --update-manifest

# Swap Discord URLs for CDN URLs in summary JSON
npm run upload-cdn -- --swap-urls ./output/elizaos/json/2024-01-15.json \
  --manifest ./media/manifest.json \
  --output ./output/elizaos/json-cdn/2024-01-15.json

# Preview without uploading
npm run upload-cdn -- --dir ./media/ --remote elizaos-media/ --dry-run
```

**Automated:** The `media-cdn-upload.yml` workflow runs daily at 7:30 AM UTC to upload media and create CDN-enriched JSON files.

📋 **Channel Checklist**: View and edit tracked channels at [scripts/CHANNELS.md](scripts/CHANNELS.md)

### Workflow

1. Run `npm run channels -- discover --sample` to fetch all channels and generate checklist
2. Edit `scripts/CHANNELS.md` - check Track/Mute boxes as needed
3. Run `npm run channels -- sync` to apply changes to registry and config files
4. Commit and push changes

**GitHub Actions**: Channel discovery runs weekly and commits updated checklist automatically.

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

No API calls - reads directly from existing database:

```bash
# Single date
npm run generate-manifest -- --db data/elizaos.sqlite --date 2024-12-14 --source elizaos

# Date range (for backfill)
npm run generate-manifest -- --db data/elizaos.sqlite --start 2024-12-01 --end 2024-12-14 --source elizaos

# Custom output path
npm run generate-manifest -- --db data/elizaos.sqlite --date 2024-12-14 --source elizaos --manifest-output ./my-manifest.json

# View manifest contents
cat ./output/elizaos/media-manifest.json | jq '.stats'
```

### Manifest Contents

Each manifest entry includes full Discord metadata for querying:

```bash
# Filter by user
cat manifest.json | jq '.files[] | select(.user_id == "123456789")'

# Only direct attachments (no embeds)
cat manifest.json | jq '.files[] | select(.media_type == "attachment")'

# Files with reactions
cat manifest.json | jq '.files[] | select(.reactions != null)'

# Count per user
cat manifest.json | jq '[.files[].user_id] | group_by(.) | map({user: .[0], count: length}) | sort_by(-.count)'
```

Fields: `url`, `filename`, `user_id`, `guild_id`, `channel_id`, `message_id`, `message_content`, `reactions`, `media_type`, `content_type`, `width`, `height`, `size`, `proxy_url`

### VPS Setup

```bash
# Clone and setup
git clone https://github.com/M3-org/ai-news.git ~/ai-news-media
python3 ~/ai-news-media/scripts/media-sync.py setup

# Download media (from gh-pages manifests)
python3 ~/ai-news-media/scripts/media-sync.py sync --dry-run  # Preview
python3 ~/ai-news-media/scripts/media-sync.py sync            # Download
python3 ~/ai-news-media/scripts/media-sync.py sync --min-free 1000  # Stop if <1GB free

# Check status (disk usage and media sizes)
python3 ~/ai-news-media/scripts/media-sync.py status
```

The `setup` command installs a systemd timer that runs daily at 01:30 UTC.

### Download with Fresh URLs

Discord CDN URLs expire after ~24 hours. Use `refresh` to fetch fresh URLs and download:

```bash
export DISCORD_TOKEN  # Bot token required

# Download all files for a specific user
python3 scripts/media-sync.py refresh manifest.json --user USER_ID -o ./user_media

# Only attachments (no embeds/thumbnails)
python3 scripts/media-sync.py refresh manifest.json --user USER_ID --type attachment

# Preview without downloading
python3 scripts/media-sync.py refresh manifest.json --user USER_ID --dry-run
```

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
