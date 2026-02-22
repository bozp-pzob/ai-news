// src/routes/v1/templates.ts

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Config template definitions.
 * Each template has a platform variant (usePlatformStorage/usePlatformAI)
 * and a local variant (SQLite + env-based API keys).
 */

interface TemplateField {
  /** Unique field identifier */
  key: string;
  /** Display label */
  label: string;
  /** Input type: url-list (add one at a time with validation), string-list (comma-sep or one at a time), text (single value) */
  type: 'url-list' | 'string-list' | 'text';
  /** Placeholder text for the input */
  placeholder: string;
  /** Whether at least one value is required before creation */
  required: boolean;
  /** Optional helper text shown below the input */
  helpText?: string;
  /** Dot-path into configJson/localConfigJson where value gets injected, e.g. "sources[0].params.repos" */
  injectPath: string;
}

interface ConfigTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  tags: string[];
  fields: TemplateField[];
  configJson: any;
  localConfigJson: any;
}

// Shared enricher/generator fragments
const platformAi = {
  type: 'OpenAIProvider',
  name: 'OpenAIProvider',
  pluginName: 'OpenAIProvider',
  params: { usePlatformAI: true },
};

const localAi = {
  type: 'OpenAIProvider',
  name: 'OpenAIProvider',
  pluginName: 'OpenAIProvider',
  params: {
    apiKey: 'process.env.OPENAI_API_KEY',
    model: 'openai/gpt-4o-mini',
    temperature: 0,
    useOpenRouter: true,
  },
};

const platformStorage = {
  type: 'PostgresStorage',
  name: 'PostgresStorage',
  pluginName: 'PostgresStorage',
  params: { usePlatformStorage: true },
};

const localStorage = {
  type: 'SQLiteStorage',
  name: 'SQLiteStorage',
  pluginName: 'SQLiteStorage',
  params: { dbPath: 'data/config.sqlite' },
};

const topicEnricher = (providerName: string) => ({
  type: 'AiTopicsEnricher',
  name: 'topicEnricher',
  pluginName: 'AiTopicsEnricher',
  params: { provider: providerName, thresholdLength: 30 },
});

const dailySummary = (providerName: string, storageName: string) => ({
  type: 'DailySummaryGenerator',
  name: 'DailySummary',
  pluginName: 'DailySummaryGenerator',
  interval: 3600000,
  params: {
    provider: providerName,
    storage: storageName,
    summaryType: 'dailySummary',
    skipFileOutput: true,
  },
});

const discordSummaryGen = (providerName: string, storageName: string) => ({
  type: 'DiscordSummaryGenerator',
  name: 'DiscordSummaryGenerator',
  pluginName: 'DiscordSummaryGenerator',
  interval: 3600000,
  params: {
    provider: providerName,
    storage: storageName,
    summaryType: 'discordChannelSummary',
    source: 'discordRawData',
  },
});

const templates: ConfigTemplate[] = [
  {
    id: 'discord-summary',
    name: 'Discord Summary',
    description: 'Track Discord channels and generate daily summaries with topic analysis',
    icon: 'discord',
    tags: ['discord', 'community'],
    fields: [],
    configJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'DiscordSource',
          name: 'discord',
          pluginName: 'DiscordSource',
          params: { mode: 'detailed', channelIds: [], storage: 'PostgresStorage' },
        },
      ],
      ai: [platformAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [platformStorage],
      generators: [
        discordSummaryGen('OpenAIProvider', 'PostgresStorage'),
        dailySummary('OpenAIProvider', 'PostgresStorage'),
      ],
    },
    localConfigJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'DiscordSource',
          name: 'discord',
          pluginName: 'DiscordSource',
          params: {
            mode: 'detailed',
            botToken: 'process.env.DISCORD_TOKEN',
            guildId: 'process.env.DISCORD_GUILD_ID',
            channelIds: [],
            storage: 'SQLiteStorage',
          },
        },
      ],
      ai: [localAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [localStorage],
      generators: [
        discordSummaryGen('OpenAIProvider', 'SQLiteStorage'),
        { ...dailySummary('OpenAIProvider', 'SQLiteStorage'), params: { ...dailySummary('OpenAIProvider', 'SQLiteStorage').params, skipFileOutput: false, outputPath: './output' } },
      ],
    },
  },
  {
    id: 'telegram-summary',
    name: 'Telegram Summary',
    description: 'Track Telegram groups and channels with daily summaries',
    icon: 'telegram',
    tags: ['telegram', 'community'],
    fields: [],
    configJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'TelegramSource',
          name: 'telegram',
          pluginName: 'TelegramSource',
          params: { chatIds: [], storage: 'PostgresStorage' },
        },
      ],
      ai: [platformAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [platformStorage],
      generators: [dailySummary('OpenAIProvider', 'PostgresStorage')],
    },
    localConfigJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'TelegramSource',
          name: 'telegram',
          pluginName: 'TelegramSource',
          params: {
            botToken: 'process.env.TELEGRAM_BOT_TOKEN',
            chatIds: [],
            storage: 'SQLiteStorage',
          },
        },
      ],
      ai: [localAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [localStorage],
      generators: [{ ...dailySummary('OpenAIProvider', 'SQLiteStorage'), params: { ...dailySummary('OpenAIProvider', 'SQLiteStorage').params, skipFileOutput: false, outputPath: './output' } }],
    },
  },
  {
    id: 'github-summary',
    name: 'GitHub Summary',
    description: 'Track GitHub repositories with contribution and activity summaries',
    icon: 'github',
    tags: ['github', 'development'],
    fields: [
      {
        key: 'repos',
        label: 'GitHub Repositories',
        type: 'url-list' as const,
        placeholder: 'https://github.com/owner/repo',
        required: true,
        helpText: 'Enter GitHub repo URLs or owner/repo shorthand. Public repos only (no auth needed).',
        injectPath: 'sources[0].params.repos',
      },
    ],
    configJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'GitHubSource',
          name: 'github',
          pluginName: 'GitHubSource',
          params: { repos: [], mode: 'summarized' },
        },
      ],
      ai: [platformAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [platformStorage],
      generators: [dailySummary('OpenAIProvider', 'PostgresStorage')],
    },
    localConfigJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'GitHubSource',
          name: 'github',
          pluginName: 'GitHubSource',
          params: { repos: [], mode: 'summarized' },
        },
      ],
      ai: [localAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [localStorage],
      generators: [{ ...dailySummary('OpenAIProvider', 'SQLiteStorage'), params: { ...dailySummary('OpenAIProvider', 'SQLiteStorage').params, skipFileOutput: false, outputPath: './output' } }],
    },
  },
  {
    id: 'market-summary',
    name: 'Market Summary',
    description: 'Track token prices and market data with daily analysis',
    icon: 'market',
    tags: ['crypto', 'market', 'analytics'],
    fields: [
      {
        key: 'tokens',
        label: 'Token Symbols',
        type: 'string-list' as const,
        placeholder: 'bitcoin, ethereum, solana',
        required: true,
        helpText: 'Enter CoinGecko token IDs (e.g. bitcoin, ethereum, solana). Add one at a time or comma-separated.',
        injectPath: 'sources[0].params.tokenSymbols',
      },
    ],
    configJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'CoinGeckoAnalyticsSource',
          name: 'coinGecko',
          pluginName: 'CoinGeckoAnalyticsSource',
          params: { tokenSymbols: [] },
        },
      ],
      ai: [platformAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [platformStorage],
      generators: [dailySummary('OpenAIProvider', 'PostgresStorage')],
    },
    localConfigJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'CoinGeckoAnalyticsSource',
          name: 'coinGecko',
          pluginName: 'CoinGeckoAnalyticsSource',
          params: { tokenSymbols: [] },
        },
      ],
      ai: [localAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [localStorage],
      generators: [{ ...dailySummary('OpenAIProvider', 'SQLiteStorage'), params: { ...dailySummary('OpenAIProvider', 'SQLiteStorage').params, skipFileOutput: false, outputPath: './output' } }],
    },
  },
  {
    id: 'multi-source',
    name: 'Multi-Source',
    description: 'Combined Discord, GitHub, and Telegram tracking with unified daily summaries',
    icon: 'multi',
    tags: ['discord', 'github', 'telegram', 'community'],
    fields: [],
    configJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'DiscordSource',
          name: 'discord',
          pluginName: 'DiscordSource',
          params: { mode: 'detailed', channelIds: [], storage: 'PostgresStorage' },
        },
        {
          type: 'GitHubSource',
          name: 'github',
          pluginName: 'GitHubSource',
          params: { repos: [], mode: 'summarized' },
        },
        {
          type: 'TelegramSource',
          name: 'telegram',
          pluginName: 'TelegramSource',
          params: { chatIds: [], storage: 'PostgresStorage' },
        },
      ],
      ai: [platformAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [platformStorage],
      generators: [
        discordSummaryGen('OpenAIProvider', 'PostgresStorage'),
        dailySummary('OpenAIProvider', 'PostgresStorage'),
      ],
    },
    localConfigJson: {
      settings: { runOnce: true },
      sources: [
        {
          type: 'DiscordSource',
          name: 'discord',
          pluginName: 'DiscordSource',
          params: {
            mode: 'detailed',
            botToken: 'process.env.DISCORD_TOKEN',
            guildId: 'process.env.DISCORD_GUILD_ID',
            channelIds: [],
            storage: 'SQLiteStorage',
          },
        },
        {
          type: 'GitHubSource',
          name: 'github',
          pluginName: 'GitHubSource',
          params: { repos: [], mode: 'summarized' },
        },
        {
          type: 'TelegramSource',
          name: 'telegram',
          pluginName: 'TelegramSource',
          params: {
            botToken: 'process.env.TELEGRAM_BOT_TOKEN',
            chatIds: [],
            storage: 'SQLiteStorage',
          },
        },
      ],
      ai: [localAi],
      enrichers: [topicEnricher('OpenAIProvider')],
      storage: [localStorage],
      generators: [
        discordSummaryGen('OpenAIProvider', 'SQLiteStorage'),
        { ...dailySummary('OpenAIProvider', 'SQLiteStorage'), params: { ...dailySummary('OpenAIProvider', 'SQLiteStorage').params, skipFileOutput: false, outputPath: './output' } },
      ],
    },
  },
];

/**
 * GET /api/v1/templates
 * Public endpoint - no auth required
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({ templates });
});

export default router;
