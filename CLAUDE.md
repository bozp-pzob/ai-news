# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI News Aggregator is a modular TypeScript system that collects, enriches, and analyzes AI-related content from multiple sources using a plugin architecture.

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

## Data Sources
- Discord (raw messages, channels, announcements)
- GitHub (stats, general data)
- Crypto analytics (Codex, CoinGecko, Solana)
- Generic REST APIs

## Development Structure
```
src/
├── aggregator/     # Core engines
├── plugins/        # All plugin implementations
├── helpers/        # Utilities (cache, config, date, file, prompt)
└── types.ts        # Type definitions
```

The system supports specialized modes: `--onlyFetch` (no AI processing), `--onlyGenerate` (process existing data), and configurable output directories.

## Channel Discovery System
Automated Discord channel discovery generates a daily checklist showing all visible channels and their tracking status:
- **Daily Updates**: GitHub Action runs at 6:00 AM UTC to update `scripts/CHANNELS.md`
- **Manual Discovery**: `npm run discover-channels` to run locally
- **Test Mode**: `npm run discover-channels -- --test-configs` to validate configurations without Discord API
- **Debug Mode**: `npm run discover-channels -- --test-configs --debug` to see detailed guild and channel information
- **Checklist Format**: Markdown checklist organized by guild with tracked/untracked channels clearly marked

### Config Updates from Checklist
Update configuration files based on checked channels in the checklist:
- **Update Configs**: `npm run update-configs` - adds checked channels to their respective config files
- **Dry Run**: `npm run update-configs -- --dry-run` - preview changes without applying them
- **Workflow**: Check boxes in `scripts/CHANNELS.md` → run update script → channels automatically added to configs

### Analytics Reminder System
Automated reminders to review Discord analytics for channel activity:
- **28-Day Cycle**: Countdown appears at top of `scripts/CHANNELS.md` every 28 days
- **Direct Link**: Analytics URL with proper date range automatically generated
- **Smart Reset**: Timer resets when you run `npm run update-configs` (implying you reviewed and acted on analytics)
- **Purpose**: Identify low-activity channels to reduce tracking noise and focus on active discussions

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
