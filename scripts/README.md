# Discord Channel Discovery & Management

Automated tools for discovering and managing Discord channels in your AI News Aggregator configurations.

## Overview

This system provides two main scripts:

1. **`discover-channels.js`** - Discovers all visible channels in your Discord servers and generates a markdown checklist
2. **`update-configs-from-checklist.js`** - Updates your configuration files based on the checklist selections

## Quick Start

### 1. Discover Channels

```bash
# Generate channel checklist
npm run discover-channels

# Test configurations without Discord API calls
npm run discover-channels -- --test-configs
```

This creates `scripts/CHANNELS.md` with a checklist of all discoverable channels.

### 2. Update Configurations

```bash
# Preview changes without applying them
npm run update-configs -- --dry-run

# Apply changes to configuration files
npm run update-configs
```

After checking/unchecking channels in `CHANNELS.md`, run this to automatically update your configuration files.

## Detailed Usage

### Channel Discovery

```bash
# Basic discovery (requires Discord bot token)
npm run discover-channels

# Validate configurations only (no Discord API)
npm run discover-channels -- --test-configs

# Help and options
node scripts/discover-channels.js --help
```

**Requirements:**
- Discord bot token in environment variables
- Properly configured Discord sources in your config files
- Bot must have access to the guilds you want to discover

### Configuration Updates

```bash
# Preview what will change
npm run update-configs -- --dry-run

# Apply changes and create backups
npm run update-configs

# Verbose output
npm run update-configs -- --verbose

# Dry run with verbose output
npm run update-configs -- --dry-run --verbose
```

**Features:**
- Automatic backup creation before changes
- Support for multiple configuration files
- Handles environment variable references
- Clear diff reporting

## Workflow

### Daily Channel Management

1. **Discover new channels**: `npm run discover-channels`
   - Updates `scripts/CHANNELS.md` with all visible channels
   - Shows current tracking status for each channel

2. **Review and select**: Edit `scripts/CHANNELS.md`
   - Check `[x]` boxes for channels you want to track  
   - Uncheck `[ ]` boxes for channels to stop tracking

3. **Update configurations**: `npm run update-configs`
   - Automatically updates all relevant config files
   - Creates backups before making changes
   - Shows summary of all changes made

4. **Test your setup**: Run your regular data collection to verify the new channel selections work correctly

### Configuration File Structure

The scripts work with any configuration file in the `config/` directory that contains Discord sources:

```json
{
  "sources": [
    {
      "type": "DiscordRawDataSource",
      "name": "discord-source-name", 
      "params": {
        "guildId": "process.env.DISCORD_GUILD_ID",
        "channelIds": [
          "123456789012345678",
          "234567890123456789"
        ],
        "botToken": "process.env.DISCORD_TOKEN"
      }
    }
  ]
}
```

## Generated Files

### `scripts/CHANNELS.md`

Markdown checklist organized by Discord server (guild):

```markdown
# Discord Channel Management

*Last updated: 2024-01-15 10:30:00 UTC*

## Overview
- **Total channels discovered**: 89
- **Currently tracked**: 12
- **Available to track**: 77

## Guilds and Channels

### Example Server

*Guild ID: `123456789012345678`*

#### General
- [x] **#general** (`123456789012345678`) - *Welcome and general discussion*
- [ ] **#random** (`234567890123456789`) - *Off-topic conversations*

#### Development  
- [x] **#dev-chat** (`345678901234567890`) - *Development discussions*
- [ ] **#code-review** (`456789012345678901`) - *Code review and feedback*
```

### `config/backup/`

Automatic backups of configuration files before updates:
- `config.json.2024-01-15T10-30-00-000Z.backup`
- `elizaos.json.2024-01-15T10-30-00-000Z.backup`

## Environment Variables

Required environment variables (referenced in your config files):

```bash
# Discord bot token - must have access to your guilds
DISCORD_TOKEN=your_discord_bot_token

# Guild IDs for each server you want to track
DISCORD_GUILD_ID=123456789012345678
ELIZAOS_GUILD_ID=234567890123456789
```

## Troubleshooting

### Common Issues

**"No valid Discord configurations found"**
- Ensure your config files have `sources` array with `DiscordRawDataSource` entries
- Check that `type: "DiscordRawDataSource"` is exact (case-sensitive)

**"No valid Discord bot token found"**  
- Set the Discord bot token in your environment variables
- Ensure the environment variable name matches what's in your config files
- Use `npm run discover-channels -- --test-configs` to validate without connecting

**"Failed to fetch guild"**
- Bot doesn't have access to the guild
- Guild ID is incorrect or refers to a deleted server
- Bot token has expired or been revoked

**"Checklist file not found"**
- Run `npm run discover-channels` first to generate the checklist
- Check that `scripts/CHANNELS.md` was created successfully

### Debug Steps

1. **Test configurations**: `npm run discover-channels -- --test-configs`
2. **Check environment variables**: Ensure all referenced env vars are set
3. **Verify bot permissions**: Bot needs "View Channels" permission in Discord
4. **Check config syntax**: Ensure JSON files are valid

## Advanced Usage

### Multiple Configuration Files

The system automatically processes all `.json` files in the `config/` directory that contain Discord sources. Each configuration can target different guilds or use different environment variables.

### Environment Variable Handling

Config files can reference environment variables like:
- `"guildId": "process.env.DISCORD_GUILD_ID"`  
- `"botToken": "process.env.DISCORD_TOKEN"`

The scripts automatically resolve these references during processing.

### Channel Categories

Channels are automatically organized by their Discord categories in the generated checklist, making it easier to review and select related channels together.

## Integration

This channel discovery system is designed to work seamlessly with the broader AI News Aggregator plugin architecture. Discovered channels are automatically compatible with:

- `DiscordRawDataSource` plugins
- Historical data collection
- Media download functionality  
- Content enrichment and AI processing

The generated channel IDs can be directly used in any Discord-related configuration throughout the system.