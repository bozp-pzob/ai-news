# Scripts Directory

Utility scripts for the AI News aggregator.

## Discord Channel Management

Unified TypeScript CLI for discovering and managing Discord channels.

### Quick Start

```bash
# Discover all channels from Discord API
npm run channels -- discover

# Discover with activity sampling (recommended)
npm run channels -- discover --sample

# Test configurations without Discord API calls
npm run channels -- discover --test-configs

# Sync CHANNELS.md changes to registry and configs
npm run channels -- sync

# Preview sync changes without applying
npm run channels -- sync --dry-run
```

### All Commands

```bash
# Discovery & Sync
npm run channels -- discover [--sample] [--test-configs]
npm run channels -- sync [--dry-run]

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

1. Run `npm run channels -- discover --sample` to fetch all channels
2. Edit `scripts/CHANNELS.md` - check Track/Mute boxes as needed
3. Run `npm run channels -- sync` to apply changes to registry and configs

### Aliases

For convenience, these npm scripts are available:
- `npm run discover-channels` → `npm run channels -- discover --sample`
- `npm run update-configs` → `npm run channels -- sync`

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

## Dashboard & Monitoring

### `generate-dashboard.mjs`
Project dashboard with terminal and HTML output.

```bash
npm run dashboard    # Generate full dashboard
npm run status       # Status overview only
```

## Integration

This system is designed to work seamlessly with the broader AI News Aggregator plugin architecture. All discovered channels are automatically compatible with:

- `DiscordRawDataSource` plugins
- `DiscordChannelRegistry` for metadata storage
- Historical data collection
- Media download functionality
- Content enrichment and AI processing
