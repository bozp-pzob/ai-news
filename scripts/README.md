# Scripts Directory

Utility scripts for the AI News aggregator.

## Discord Channel Management

Unified TypeScript CLI for discovering and managing Discord channels.

### Quick Start

```bash
# Discover channels (Discord API, or raw data if no token)
npm run channels -- discover

# Analyze channels with LLM (TRACK/MAYBE/SKIP)
npm run channels -- analyze

# Generate PR markdown with config changes
npm run channels -- propose
```

### All Commands

```bash
# Discovery & Analysis
npm run channels -- discover                # Fetch channels from Discord (or raw data fallback)
npm run channels -- analyze                 # Analyze channels needing it (30+ days old)
npm run channels -- analyze --all           # Re-analyze all channels
npm run channels -- analyze --channel=ID    # Analyze single channel
npm run channels -- propose [--dry-run]     # Generate PR markdown

# Query Commands
npm run channels -- list [--tracked|--active|--muted|--quiet]
npm run channels -- show <channelId>
npm run channels -- stats

# Management Commands
npm run channels -- track <channelId>
npm run channels -- untrack <channelId>
npm run channels -- mute <channelId>
npm run channels -- unmute <channelId>

# Registry Commands
npm run channels -- build-registry [--dry-run]
```

### Workflow

```bash
npm run channels -- discover   # Fetch channels
npm run channels -- analyze    # Run LLM analysis
npm run channels -- propose    # Generate PR markdown
```

**GitHub Actions**: Monthly workflow analyzes channels and creates draft PRs.

### Aliases

For convenience, these npm scripts are available:
- `npm run discover-channels` → `npm run channels -- discover`
- `npm run analyze-channels` → `npm run channels -- analyze`

## Discord User Management

TypeScript CLI for managing Discord user data and avatars.

```bash
# Build user index from raw Discord logs
npm run users -- index

# Fetch avatar URLs from Discord API
npm run users -- fetch-avatars [--rate-limit=<ms>] [--skip-existing]

# Download avatar images locally
npm run users -- download-avatars [--rate-limit=<ms>] [--skip-existing]

# Build discord_users table from discordRawData
npm run users -- build-registry [--dry-run]

# Enrich JSON files with nickname maps
npm run users -- enrich [--date=YYYY-MM-DD] [--from/--to] [--all] [--dry-run]
```

## Collection Scripts

### `collect-daily.sh`
Runs daily data collection for specified configurations.

```bash
./collect-daily.sh elizaos.json                    # Yesterday's ElizaOS data
./collect-daily.sh hyperfy-discord.json 2025-01-15 # Specific date
```

## Webhook Server

### `server.js`
HTTP webhook server for triggering collection via GitHub Actions.

**Features:**
- HMAC signature verification
- File locking (prevents concurrent runs)
- Zero external dependencies

**Usage:**
```bash
export COLLECT_WEBHOOK_SECRET=$(openssl rand -hex 32)
npm run webhook
```

**Endpoints:**
- `POST /run-collect` - Trigger collection (HMAC auth required)
- `GET /healthz` - Health check

### `test-webhook.sh`
Test utility for webhook development.

```bash
export COLLECT_WEBHOOK_SECRET="your-secret"
./scripts/test-webhook.sh elizaos.json 2025-01-15
```

## Integration

This system is designed to work seamlessly with the broader AI News Aggregator plugin architecture. All discovered channels are automatically compatible with:

- `DiscordRawDataSource` plugins
- `DiscordChannelRegistry` for metadata storage
- Historical data collection
- Media download functionality
- Content enrichment and AI processing
