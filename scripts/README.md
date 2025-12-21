# Scripts Directory

Utility scripts for the AI News aggregator.

## Discord Channel Discovery & Management

Automated tools for discovering and managing Discord channels in your AI News Aggregator configurations.

### Overview

This system provides two main scripts:

1. **`discover-channels.mjs`** - Discovers all visible channels in your Discord servers and generates a markdown checklist
2. **`update-configs-from-checklist.mjs`** - Updates your configuration files based on the checklist selections

### Quick Start

#### 1. Discover Channels

```bash
# Generate channel checklist
npm run discover-channels

# Test configurations without Discord API calls
npm run discover-channels -- --test-configs
```

This creates `scripts/CHANNELS.md` with a checklist of all discoverable channels.

#### 2. Update Configurations

```bash
# Preview changes without applying them
npm run update-configs -- --dry-run

# Apply changes to configuration files
npm run update-configs
```

After checking/unchecking channels in `CHANNELS.md`, run this to automatically update your configuration files.

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

**Payload:**
```json
{"config": "elizaos.json", "date": "2025-01-15"}
```

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
# Generate full dashboard
npm run dashboard

# Status overview only
npm run status
```

## Integration

This system is designed to work seamlessly with the broader AI News Aggregator plugin architecture. All discovered channels are automatically compatible with:

- `DiscordRawDataSource` plugins
- Historical data collection
- Media download functionality  
- Content enrichment and AI processing