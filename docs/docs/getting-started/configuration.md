---
id: configuration
title: Configuration
sidebar_label: Configuration
---

Configuration for the AI News Aggregator is primarily managed through two mechanisms:

1.  **JSON Configuration Files:** Located in the `config/` directory (e.g., `sources.json`, `discord-raw.json`, `elizaos.json`). These files define which plugins (sources, AI providers, enrichers, generators, storage) are active for a given pipeline, their specific parameters, and scheduling intervals.
2.  **Environment Variables:** Used for sensitive data like API keys, bot tokens, and other credentials. These are typically stored in an `.env` file for local development and as repository secrets for GitHub Actions.

## JSON Configuration Files

These files dictate the behavior and composition of an aggregation pipeline. You can have multiple configuration files, each tailored for different data sources or output targets. For example, `config/discord-raw.json` might configure the system to fetch data from specific Discord channels, while `config/elizaos.json` might set up a pipeline for Twitter and GitHub data related to the ElizaOS project.

The main scripts (`index.ts` for continuous operation and `historical.ts` for past data) are usually pointed to one of these configuration files using the `--source` command-line argument (e.g., `npm start -- --source=discord-raw.json`). If no `--source` is provided to `npm start`, it defaults to `config/sources.json`.

**Structure Example (Conceptual):**

```json
{
  "settings": {
    "runOnce": false // For index.ts: true to run once and exit, false for continuous
    // ... other global settings
  },
  "sources": [
    {
      "type": "DiscordRawDataSource", // Matches the class name of the plugin
      "name": "myDiscordServerRaw",   // A unique name for this instance
      "interval": 3600000,         // For index.ts: run every 1 hour (in ms)
      "params": {
        "botToken": "process.env.DISCORD_TOKEN",
        "guildId": "process.env.DISCORD_GUILD_ID",
        "channelIds": ["123...", "456..."],
        "storage": "SQLiteStorage" // Name of the configured storage plugin instance
      }
    }
    // ... other source plugin configurations
  ],
  "ai": [
    {
      "type": "OpenAIProvider",
      "name": "myOpenAI",
      "params": {
        "apiKey": "process.env.OPENAI_API_KEY",
        "model": "gpt-4o-mini"
        // ... other OpenAIProvider params
      }
    }
    // ... other AI provider configurations
  ],
  "enrichers": [ /* ... enricher configurations ... */ ],
  "generators": [
    {
      "type": "DiscordSummaryGenerator",
      "name": "myDiscordSummaries",
      "interval": 7200000, // For index.ts: run every 2 hours
      "params": {
        "provider": "myOpenAI", // Name of the configured AI provider instance
        "storage": "SQLiteStorage",
        "summaryType": "myServerChannelSummary",
        "source": "myDiscordServerRaw", // Name of the source instance providing data for this generator
        "outputPath": "./output/myServer/summaries"
      }
    }
    // ... other generator configurations
  ],
  "storage": [
    {
      "type": "SQLiteStorage",
      "name": "SQLiteStorage", // Often a single, shared storage instance
      "params": {
        "dbPath": "data/main_database.sqlite"
      }
    }
  ]
}
```

Key points about JSON configuration:

-   `type`: Must match the class name of the plugin in the `src/plugins/...` directories.
-   `name`: A unique identifier you assign to this specific instance of the plugin. This is used for dependency injection (e.g., a generator's `params.provider` refers to the `name` of an AI provider instance).
-   `params`: An object containing parameters specific to that plugin class. These are passed to the plugin's constructor.
-   `interval`: (For sources and generators when used with `index.ts`) Specifies how often, in milliseconds, the plugin's main task should be executed.
-   **Environment Variable Referencing:** Plugin parameters can reference environment variables using the syntax `"process.env.YOUR_ENV_VARIABLE_NAME"`. The application will substitute these with actual values from your `.env` file or GitHub secrets at runtime.

## Environment Variables (`.env` File)

For local development, create a `.env` file in the project root by copying `example.env`. This file is ignored by Git and should contain your secret keys and tokens.

**Example `.env` content:**

```env
# Discord Configuration
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
DISCORD_GUILD_ID=YOUR_DISCORD_SERVER_ID_HERE

# OpenAI/OpenRouter Configuration
OPENAI_API_KEY=sk-or-YOUR_OPENAI_OR_OPENROUTER_KEY_HERE
USE_OPENROUTER=false
SITE_URL=https://your-project-url.com
SITE_NAME=YourProjectName

# Crypto Analytics
CODEX_API_KEY=YOUR_CODEX_API_KEY_HERE

# Twitter Configuration (Optional)
# TWITTER_USERNAME=your_twitter_username
# TWITTER_PASSWORD=your_twitter_password
# TWITTER_EMAIL=your_twitter_email
# TWITTER_COOKIES='[{"key":"auth_token","value":"<value>"...}]'
```

**Important considerations:**

-   Ensure the variable names in your `.env` file exactly match those referenced in your JSON configurations (e.g., if JSON says `process.env.OPENAI_API_KEY`, your `.env` must have `OPENAI_API_KEY=...`).
-   Refer to the documentation for individual plugins (see `src/plugins/.../README.md` files) for specific environment variables they might require.

## GitHub Actions Secrets

For running the application via GitHub Actions (e.g., for scheduled daily runs), environment variables are typically managed as GitHub repository secrets.

-   A common practice in this project is to store a JSON blob of multiple environment variables under a single secret named `ENV_SECRETS`.
-   Another secret, `SQLITE_ENCRYPTION_KEY`, is used for encrypting/decrypting the SQLite database when it's stored in the repository or deployed via GitHub Pages.

Consult the main `README.md` at the root of the project and the `.github/workflows/` files for specifics on how these secrets are structured and used in automated workflows. 