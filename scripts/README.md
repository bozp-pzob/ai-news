# Scripts Directory

Utility scripts for the AI News aggregator.

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

## Other Scripts

- `discover-channels.js` - Discord channel discovery
- `update-configs-from-checklist.js` - Config management  
- `generate-dashboard.js` - Project dashboard
- `autodoc/` - Documentation generation