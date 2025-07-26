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

# Generate pipeline dashboard
npm run dashboard

# View pipeline status (terminal output)
npm run status

# Run data collection (new portable script)
npm run collect -- --config=elizaos.json --mode=daily
npm run collect -- --config=elizaos.json --mode=historical --date=2024-01-15

# Workflow Status
# Updated workflows: elizaos.yml, discord-raw.yml, channel-discovery.yml
# Remaining to update: elizaos-dev.yml, hyperfy.yml (same pattern as above)
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
- `hyperfy-discord.json`, `ai16zdao.json` - Specialized configurations

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
