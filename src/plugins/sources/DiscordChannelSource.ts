// src/plugins/sources/DiscordSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem, AiProvider, PlatformSourceConfig, isPlatformSourceConfig } from "../../types";
import { Client, GatewayIntentBits, TextChannel, ChannelType } from "discord.js";
import * as fs from 'fs';
import * as path from 'path';
import { StoragePlugin } from "../storage/StoragePlugin";
import { externalConnectionService, discordAdapter } from '../../services/externalConnections';
import { logger } from '../../helpers/cliHelper';
import { createDiscordAnalysisPrompt, SUMMARIZE_OPTIONS } from '../../helpers/promptHelper';

/**
 * Configuration interface for DiscordChannelSource.
 * Defines the required parameters for initializing a Discord channel source.
 */
interface DiscordChannelSourceConfig {
  name: string;           // Name identifier for this source
  botToken: string;       // Discord bot authentication token
  channelIds: string[];   // Array of Discord channel IDs to monitor
  storage: StoragePlugin; // Storage to store message fetching information
  provider: AiProvider | undefined;  // Optional AI provider for content processing
}

/**
 * Unified config type for both self-hosted and platform modes
 */
type UnifiedDiscordChannelConfig = DiscordChannelSourceConfig | (PlatformSourceConfig & { provider?: AiProvider });

/**
 * DiscordChannelSource class implements content fetching from Discord channels.
 * This source monitors specified Discord channels and generates summaries of conversations
 * using an AI provider. It maintains state to track processed messages and supports
 * both real-time and historical data fetching.
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly (for CLI usage)
 * 2. Platform mode: Uses shared bot via externalConnectionService (for multi-tenant platform)
 */
export class DiscordChannelSource implements ContentSource {
  public name: string;
  public provider: AiProvider | undefined;
  public storage: StoragePlugin;
  private botToken: string | null = null;
  private channelIds: string[];
  private client: Client | null = null;
  /** Whether running in platform mode (multi-tenant) */
  private isPlatformMode: boolean = false;
  /** Connection ID for platform mode */
  private connectionId: string | null = null;
  /** Guild ID (resolved at runtime for platform mode) */
  private guildId: string | null = null;

  /** Platform type required for this source (used by frontend to filter available plugins) */
  static requiresPlatform = 'discord';
  
  /** Hidden from UI - use unified DiscordSource with mode='summarized' instead */
  static hidden = true;
  
  static constructorInterface = {
    parameters: [
      {
        name: 'botToken',
        type: 'string',
        required: false,
        description: 'Discord bot token for authentication (self-hosted mode)',
        secret: true
      },
      {
        name: 'connectionId',
        type: 'string',
        required: false,
        description: 'External connection ID (platform mode)'
      },
      {
        name: 'channelIds',
        type: 'string[]',
        required: true,
        description: 'Array of Discord channel IDs to monitor'
      },
      {
        name: 'storage',
        type: 'StoragePlugin',
        required: true,
        description: 'Storage to store data fetching cursors'
      },
      {
        name: 'provider',
        type: 'AiProvider',
        required: false,
        description: 'Optional AI provider for content processing'
      }
    ]
  };

  /**
   * Creates a new instance of DiscordChannelSource.
   * Supports both self-hosted and platform modes.
   * @param config - Configuration object containing bot token, channel IDs, and AI provider
   */
  constructor(config: UnifiedDiscordChannelConfig) {
    this.name = config.name;
    this.storage = config.storage;
    this.channelIds = config.channelIds;
    this.provider = 'provider' in config ? config.provider : undefined;

    // Check for platform mode by looking for connectionId
    if (isPlatformSourceConfig(config)) {
      // Platform mode - use shared bot service
      this.isPlatformMode = true;
      this.connectionId = config.connectionId;
      this.guildId = config._externalId || null;
      logger.info(`[DiscordChannelSource] Initialized in platform mode with connection ${config.connectionId}`);
    } else if ('botToken' in config) {
      // Self-hosted mode - use provided bot token
      this.isPlatformMode = false;
      this.botToken = config.botToken;
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
      });
    } else {
      throw new Error('DiscordChannelSource requires either botToken (self-hosted) or connectionId (platform mode)');
    }
  }

  /**
   * Get the Discord client, initializing if needed
   */
  private async getClient(): Promise<Client> {
    if (this.isPlatformMode) {
      return discordAdapter.getClient();
    } else {
      if (!this.client) {
        throw new Error('Discord client not initialized');
      }
      if (!this.client.isReady() && this.botToken) {
        await this.client.login(this.botToken);
      }
      return this.client;
    }
  }

  /**
   * Validate platform mode connection before fetching
   */
  private async validatePlatformConnection(): Promise<void> {
    if (!this.isPlatformMode || !this.connectionId) {
      return;
    }

    const connection = await externalConnectionService.getConnectionById(this.connectionId);
    if (!connection) {
      throw new Error(`Connection ${this.connectionId} not found`);
    }

    if (!connection.isActive) {
      throw new Error(`Connection ${this.connectionId} is no longer active`);
    }

    this.guildId = connection.externalId;

    const validation = await externalConnectionService.validateChannels(
      this.connectionId,
      this.channelIds
    );

    if (!validation.valid) {
      throw new Error(`Some channels are not accessible: ${validation.invalidChannels.join(', ')}`);
    }
  }

  /**
   * Fetches and processes new messages from configured Discord channels.
   * Retrieves messages after the last processed message ID and generates summaries
   * using the configured AI provider.
   * @returns Promise<ContentItem[]> Array of processed content items
   */
  public async fetchItems(): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    // Get the client (handles login for self-hosted mode)
    const client = await this.getClient();

    let discordResponse : any[] = [];

    for (const channelId of this.channelIds) {
      const channel = await client.channels.fetch(channelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`Channel ID ${channelId} is not a text channel or does not exist.`);
        continue;
      }

      const textChannel = channel as TextChannel;

      const fetchOptions: { limit: number; after?: string } = { limit: 100 };
      const cursorKey = `${this.name}-${channelId}`;
      const lastProcessedId = await this.storage.getCursor(cursorKey);

      if (lastProcessedId) {
        fetchOptions.after = lastProcessedId;
      }

      // Fetch the latest 100 messages to create a meaningful summary
      const messages = await textChannel.messages.fetch(fetchOptions);

      if (messages.size === 0) {
        console.log(`No new messages found for channel ${channelId}.`);
        continue;
      }

      const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      let transcript = '';
      sortedMessages.forEach((msg) => {
        transcript += `[${msg.author.username}]: ${msg.content}\n`;
      });

      const prompt = createDiscordAnalysisPrompt(transcript);

      if ( this.provider ) {
        const summary = await this.provider.summarize(prompt, SUMMARIZE_OPTIONS.discordAnalysis);
  
        discordResponse.push({
          type: "discordChannelSummary",
          cid: `${channelId}-${lastProcessedId}`,
          source: `${(channel as TextChannel).guild.name} - ${textChannel.name}`,
          text: summary,
          link: `https://discord.com/channels/${(channel as TextChannel).guild.id}/${channelId}`,
          date: Math.floor(new Date().getTime() / 1000),
          metadata: {
            channelId: channelId,
            guildId: (channel as TextChannel).guild.id,
            guildName: (channel as TextChannel).guild.name,
            channelName: textChannel.name,
            summaryDate: Math.floor(new Date().getTime() / 1000),
          },
        });
  
        const lastMessage = sortedMessages.last();
        if (lastMessage) {
          const lastFetchedMessageId = lastMessage.id;
          this.storage.setCursor(cursorKey, lastFetchedMessageId);
        }
      }
    }
    
    return discordResponse
  }

  /**
   * Fetches historical messages from configured Discord channels up to a specified date.
   * Useful for backfilling data or generating historical summaries.
   * @param date - ISO date string indicating the cutoff date for historical data
   * @returns Promise<ContentItem[]> Array of processed historical content items
   */
  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    // Get the client (handles login for self-hosted mode)
    const client = await this.getClient();

    const cutoffTimestamp = new Date(date).getTime();
    let discordResponse: ContentItem[] = [];

    for (const channelId of this.channelIds) {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`Channel ID ${channelId} is not a text channel or does not exist.`);
        continue;
      }

      const textChannel = channel as TextChannel;
      let allMessages: any[] = [];
      let lastMessageId: string | undefined = undefined;

      // Paginate backwards until messages are older than the cutoff date.
      while (true) {
        const fetchOptions: { limit: number; before?: string } = { limit: 100 };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }

        const messages = await textChannel.messages.fetch(fetchOptions);

        if (messages.size === 0) break;

        // Filter the batch for messages on/after the cutoff timestamp.
        messages.forEach((msg) => {
          if (msg.createdTimestamp >= cutoffTimestamp) {
            allMessages.push(msg);
          }
        });

        // If the oldest message in this batch is older than the cutoff, stop fetching.
        const oldestMessage = messages.last();
        if (!oldestMessage || oldestMessage.createdTimestamp < cutoffTimestamp) {
          break;
        }
        lastMessageId = oldestMessage.id;
      }

      if (allMessages.length === 0) {
        console.log(`No messages found for channel ${channelId} since ${date}.`);
        continue;
      }

      // Sort messages in ascending order so the transcript is chronological.
      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      let transcript = '';
      allMessages.forEach((msg) => {
        transcript += `[${msg.author.username}]: ${msg.content}\n`;
      });

      const prompt = createDiscordAnalysisPrompt(transcript);

      if (this.provider) {
        const summary = await this.provider.summarize(prompt, SUMMARIZE_OPTIONS.discordAnalysis);
        discordResponse.push({
          type: "discordChannelHistoricalSummary",
          cid: `${channelId}-historical-${date}`,
          source: `${textChannel.guild.name} - ${textChannel.name}`,
          text: summary,
          link: `https://discord.com/channels/${textChannel.guild.id}/${channelId}`,
          date: Math.floor(cutoffTimestamp / 1000),
          metadata: {
            channelId: channelId,
            guildId: textChannel.guild.id,
            guildName: textChannel.guild.name,
            channelName: textChannel.name,
            summaryDate: Math.floor(cutoffTimestamp / 1000),
            historicalSince: date,
          },
        });
      }
    }
    return discordResponse;
  }

  /**
   * Formats a structured prompt for the AI provider based on the chat transcript.
   * Creates a detailed prompt that guides the AI in generating comprehensive summaries.
   * @param transcript - Raw chat transcript to be analyzed
   * @returns string Formatted prompt for AI processing
   * @private
   */
  /**
   * Format prompt for Discord channel analysis.
   * Now delegates to the centralized createDiscordAnalysisPrompt in promptHelper.ts.
   * @deprecated Use createDiscordAnalysisPrompt directly instead
   */
  private formatStructuredPrompt(transcript: string): string {
    return createDiscordAnalysisPrompt(transcript);
  }
}