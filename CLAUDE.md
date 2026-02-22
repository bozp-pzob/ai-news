# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Digital Gardener is a modular TypeScript system that cultivates and curates content from multiple sources, enriching it with AI and organizing it through a plugin architecture.

## Common Commands

### Main Application
```bash
# Build and run production
npm run build && npm start

# Development mode
npm run dev

# Historical data collection
npm run historical

# Run with specific configuration
npm start -- --source=discord-raw.json --output=./custom-output

# Historical data for date range
npm run historical -- --source=elizaos.json --after=2024-01-10 --before=2024-01-16

# Channel discovery
npm run discover-channels

# Update configs from checklist
npm run update-configs

# User identity workflow (recommended order)
npm run build-user-index                                # 1. Build global user index
npm run fetch-avatars -- --update-index                 # 2. Generate avatar URLs and update index
npm run enrich-nicknames -- --all --use-index          # 3. Enrich all JSONs from index (fast!)

# Alternative: Enrich without building index first (slower, queries DB each time)
npm run enrich-nicknames -- --date=2026-01-12           # Single date from DB
npm run enrich-nicknames -- --from=2026-01-01 --to=2026-01-12  # Date range from DB
npm run enrich-nicknames -- --all                       # All JSON files from DB
npm run enrich-nicknames -- --all --dry-run            # Preview without writing

# Build/rebuild user index
npm run build-user-index                                # Generate data/discord/user-index.json
npm run build-user-index -- --output=./custom.json     # Custom output path
npm run build-user-index -- --dry-run                  # Preview without writing
```

### HTML Frontend (in html/ directory)
```bash
# Development server
npm run dev

# Build for production
npm run build

# Type checking
npm run check

# Database operations
npm run db:push
```

### AutoDoc (in autodoc/ directory)
```bash
# Generate documentation
npm run autodoc

# Development mode
npm run autodoc:dev

# Formatting
npm run lint && npm run format
```

## Architecture

### Plugin System
The system uses five plugin types:
- **Sources** (`src/plugins/sources/`) - Data collection (Discord, GitHub, APIs)
- **AI Providers** (`src/plugins/ai/`) - OpenAI/OpenRouter integration
- **Enrichers** (`src/plugins/enrichers/`) - Content enhancement (topics, images)
- **Generators** (`src/plugins/generators/`) - Summary generation
- **Storage** (`src/plugins/storage/`) - SQLite with encryption

### Core Components
- **ContentAggregator** (`src/aggregator/ContentAggregator.ts`) - Main orchestration engine
- **HistoricalAggregator** (`src/aggregator/HistoricalAggregator.ts`) - Historical data processing
- **Types** (`src/types.ts`) - Comprehensive type definitions including plugin interfaces

### Configuration
JSON configuration files in `config/` directory:
- `sources.json` - Default configuration
- `elizaos2.json` - Unified ElizaOS configuration (Discord + GitHub + Codex analytics)
- `hyperfy-discord.json` - Specialized configuration for Hyperfy Discord

Each config contains: `settings`, `sources`, `ai`, `enrichers`, `storage`, `generators` arrays.

### Environment Variables
Required in `.env`: `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `OPENAI_API_KEY`, `USE_OPENROUTER`, `CODEX_API_KEY`

For multi-tenant platform mode, also configure:
- Discord: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_OAUTH_REDIRECT_URI`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_URL` (or `TELEGRAM_USE_POLLING=true`)

## Data Sources
- Discord (raw messages, channels, announcements)
- Telegram (group/channel messages via webhook cache)
- GitHub (contributions tracking with direct API access)
- Crypto analytics (Codex, CoinGecko, Solana)
- Generic REST APIs

## GitHub Contributions Tracking

The `GitHubSource` plugin provides direct GitHub API access for tracking repository contributions.

### Features
- **Simple config**: Just provide repo URLs or `"owner/repo"` strings
- **Public repos**: Track public repos without authentication (60 requests/hour limit)
- **Private repos**: Use GitHub App connection for read-only access
- **Auto-fetch**: When using `connectionId` without `repos`, tracks all connected repos
- **File-level PR details**: See which files changed, with additions/deletions per file
- Tracks PRs, issues, commits, reviews, and comments
- Optional AI-powered summaries via AiProvider
- Two modes: `raw` (individual items) and `summarized` (default, single summary per repo)

### Configuration (Public Repos)
```json
{
  "type": "GitHubSource",
  "name": "public-oss",
  "params": {
    "repos": [
      "https://github.com/facebook/react",
      "microsoft/typescript",
      "elizaOS/eliza"
    ]
  }
}
```
Accepts full GitHub URLs or `"owner/repo"` shorthand. Uses unauthenticated API (60 req/hr limit).

### Configuration (Private Repos via GitHub App)
```json
{
  "type": "GitHubSource",
  "name": "my-private-repos",
  "params": {
    "connectionId": "uuid-of-github-connection",
    "repos": ["my-org/private-repo-1", "my-org/private-repo-2"]
  }
}
```

### Configuration (Auto-fetch from GitHub App Connection)
```json
{
  "type": "GitHubSource",
  "name": "all-connected-repos",
  "params": {
    "connectionId": "uuid-of-github-connection"
  }
}
```
When `repos` is omitted, automatically tracks all repositories from the GitHub App connection.

### Configuration Options
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `repos` | `string[]` | No* | - | Repository URLs or `"owner/repo"` strings |
| `connectionId` | `string` | No* | - | GitHub App connection ID for private repos |
| `mode` | `string` | No | `"summarized"` | `"raw"` or `"summarized"` |
| `interval` | `number` | No | - | Fetch interval in seconds (for period labeling) |
| `contributorsToExclude` | `string[]` | No | - | Usernames to exclude (bots, etc.) |
| `aiSummary` | `object` | No | - | `{ enabled: boolean, provider?: AiProvider }` |

*Either `repos` or `connectionId` must be provided.

### Output Modes
- **`summarized` (default)**: Single comprehensive ContentItem per repo with all activity aggregated
- **`raw`**: Individual ContentItems for each PR, issue, commit, review, plus summary and contributor stats

### Output Content Types
- `githubContributionsSummary` - Summary of all activity (both modes)
- `githubPullRequest` - Individual PR with file changes (raw mode only)
- `githubIssue` - Individual issue (raw mode only)
- `githubCommit` - Individual commit (raw mode only)
- `githubReview` - PR review (raw mode only)
- `githubContributorStats` - Per-contributor statistics (raw mode only)

### File-Level PR Details
PR metadata includes detailed file information:
```typescript
{
  files: [
    { path: "src/index.ts", additions: 50, deletions: 10, changeType: "modified" },
    { path: "src/new-file.ts", additions: 100, deletions: 0, changeType: "added" }
  ]
}
```

### Environment Variables (Platform Mode)
- `GITHUB_APP_ID` - GitHub App ID (from app settings)
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key (PEM format, can use `\n` for newlines)
- `GITHUB_APP_SLUG` - GitHub App URL slug (for installation link)

### GitHub App Setup (Platform Mode)

1. Create a GitHub App at https://github.com/settings/apps/new
2. Configure permissions (read-only):
   - Repository permissions: Contents (Read), Issues (Read), Pull requests (Read), Metadata (Read)
   - No webhooks needed (we poll)
3. Generate and download a private key
4. Set environment variables:
   ```bash
   GITHUB_APP_ID=123456
   GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   GITHUB_APP_SLUG=my-app-name
   ```
5. Users install the app via the connection flow, selecting which repos to grant access

## External Connections System

The platform supports multi-tenant connections to external services (Discord, Telegram, Slack, GitHub) via a unified adapter architecture.

### Architecture
```
src/services/externalConnections/
├── types.ts                    # Shared types (PlatformType, ExternalConnection, etc.)
├── ExternalConnectionService.ts # Main orchestrator
├── adapters/
│   ├── BaseAdapter.ts          # Abstract base class
│   ├── DiscordAdapter.ts       # Discord OAuth + bot implementation
│   ├── TelegramAdapter.ts      # Telegram webhook/deep-link implementation
│   ├── GitHubAdapter.ts        # GitHub App implementation
│   └── index.ts                # Adapter exports
└── index.ts                    # Module exports
```

### Connection Flows
- **Discord**: OAuth2 flow - user authorizes bot, bot joins server
- **Telegram**: Deep-link flow - user clicks link to add bot to group, bot receives `/start` with token
- **GitHub**: GitHub App installation flow - user installs app, selects repos to grant access
- **Slack**: OAuth2 flow (coming soon)

### Database Tables
- `external_connections` - Stores user connections to external platforms
- `external_channels` - Caches available channels/resources per connection
- `external_oauth_states` - CSRF protection for OAuth/webhook flows
- `telegram_message_cache` - Caches Telegram messages (since Telegram API doesn't support history)

### Source Plugin Modes
Discord/Telegram/GitHub sources support two modes:
1. **Self-hosted mode**: Uses `botToken` or `token` directly (for CLI usage)
2. **Platform mode**: Uses `connectionId` with shared bot/OAuth service (for multi-tenant platform)

```typescript
// Self-hosted mode config
{ name: "my-discord", botToken: "xxx", guildId: "123", channelIds: [...] }

// Platform mode config (auto-injected by platform)
{ name: "my-discord", connectionId: "uuid", channelIds: [...], _userId: "...", _externalId: "..." }
```

### API Routes
```
GET  /api/v1/connections/platforms          # List available platforms
GET  /api/v1/connections                    # List user's connections
GET  /api/v1/connections/:platform/auth     # Get auth URL
GET  /api/v1/connections/:platform/callback # OAuth callback
POST /api/v1/connections/:platform/webhook  # Webhook handler (Telegram)
GET  /api/v1/connections/:connectionId      # Get connection details
DELETE /api/v1/connections/:connectionId    # Remove connection
POST /api/v1/connections/:connectionId/verify # Verify connection
GET  /api/v1/connections/:connectionId/channels # Get channels
POST /api/v1/connections/:connectionId/sync # Sync channels
POST /api/v1/connections/validate-channels  # Validate channel access
```

## Development Structure
```
src/
├── aggregator/            # Core engines
├── plugins/
│   ├── sources/           # Data collection (Discord, Telegram, GitHub, APIs)
│   ├── ai/                # AI provider integrations
│   ├── enrichers/         # Content enhancement
│   ├── generators/        # Summary generation
│   └── storage/           # SQLite/PostgreSQL storage
├── services/
│   └── externalConnections/  # Multi-tenant platform connections
├── routes/v1/             # API routes
├── helpers/               # Utilities (cache, config, date, file, prompt)
└── types.ts               # Type definitions
```

### Frontend Structure
```
frontend/src/
├── components/
│   └── connections/       # Platform-agnostic connection UI
│       ├── PlatformIcon.tsx
│       ├── ConnectionCard.tsx
│       ├── ChannelPicker.tsx
│       └── ExternalConnectionManager.tsx
├── hooks/
│   └── useExternalConnections.ts  # Connection management hooks
└── services/
    └── api.ts             # connectionsApi for external connections
```

The system supports specialized modes: `--onlyFetch` (no AI processing), `--onlyGenerate` (process existing data), and configurable output directories.

## Channel Management System

Unified TypeScript CLI (`scripts/channels.ts`) for Discord channel discovery and management:

```bash
# Discovery & Analysis
npm run channels -- discover                # Fetch channels from Discord (or raw data if no token)
npm run channels -- analyze                 # Run LLM analysis on channels needing it
npm run channels -- analyze --all           # Re-analyze all channels
npm run channels -- analyze --channel=ID    # Analyze single channel
npm run channels -- propose                 # Generate PR markdown with config changes

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
npm run channels -- build-registry          # Backfill from discordRawData
```

### Workflow
```bash
npm run channels -- discover   # Fetch channels
npm run channels -- analyze    # Run LLM analysis (TRACK/MAYBE/SKIP)
npm run channels -- propose    # Generate PR markdown
```

### Data Storage
- **DiscordChannelRegistry** (`src/plugins/storage/DiscordChannelRegistry.ts`) - SQLite table for channel metadata
- Tracks: name/topic/category changes, activity history, AI recommendations, muted state
- GitHub Action runs monthly to analyze channels and create draft PRs

## User Identity Systems

### Nickname to Username Mapping
Enriches Discord summary JSON files with nickname-to-username mappings for data visualization and analytics:
- **Purpose**: Maps human-readable Discord nicknames (e.g., "Shaw", "jin") to Discord user IDs and usernames for programmatic analysis
- **Data Source**: Can use either raw Discord logs from SQLite (slower) or global user index (faster, recommended)
- **Temporal Correctness**: When using `--use-index`, maps the correct nickname for each specific date (e.g., "The Light" on 2025-12-15 vs "The Void" on 2026-01-11 for same user)
- **Deterministic Matching**: Uses raw log user dictionaries for fast, reliable mapping without LLM overhead
- **Conflict Resolution**: Handles duplicate nicknames using role hierarchy (God > Partner > Core Dev > Contributor > Verified) and message count
- **Adversarial Protection**: Validates nicknames for common words, special characters, and potential injection patterns
- **Output Format**: Adds top-level `nicknameMap` field to each JSON with structure: `{"nickname": {"id": "snowflake", "username": "user", "roles": [...]}}`
- **Safety Documentation**: See `scripts/NICKNAME-MAPPING-SAFETY.md` for adversarial risks and safe usage patterns
- **Validation Warnings**: Reports risky nicknames (short names, special chars, security risks) during enrichment

### Global User Index
Builds a comprehensive user index tracking Discord users, their nickname history, and activity patterns:
- **Purpose**: Single source of truth for all Discord users with complete nickname change history across time
- **Output**: `data/discord/user-index.json` containing all users keyed by Discord snowflake ID
- **Nickname History**: Tracks when users changed nicknames with exact date ranges for each nickname period
- **User Profile**: Each user includes username, current displayName, roles (union of all roles ever seen), first/last seen dates, total message count, and per-channel activity
- **Nickname Index**: Reverse lookup from nickname to user IDs - identifies conflicts where multiple users share the same nickname
- **Avatar URLs**: Populated with default Discord avatars calculated from user IDs (6 possible default avatars distributed evenly)
- **Statistics**: Reports total users (2844+), unique nicknames (2917+), conflicting nicknames (35+), and users who changed nicknames (94+)
- **Use Case**: Data visualization applications can use this as primary data source, querying by user ID for consistent identity across nickname changes

### Avatar URL Generation
Generates Discord avatar URLs for all users without requiring API calls:
- **Default Avatars**: Calculates which default avatar each user has based on their Discord user ID using formula `(user_id >> 22) % 6`
- **Output Files**:
  - `data/discord/avatars.json` - Full data with user info and avatar URLs (601KB)
  - `data/discord/avatars-urls.txt` - Plain text list of URLs, one per line (easy to copy)
- **Distribution**: Discord's 6 default avatars are evenly distributed (~16-17% each)
- **Update Index**: Use `--update-index` flag to populate `avatarUrl` field in user-index.json
- **Custom Avatars**: For actual custom avatars, would need to fetch from Discord API with bot token to get avatar hashes
