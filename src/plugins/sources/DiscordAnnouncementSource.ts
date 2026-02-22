/**
 * @fileoverview Implementation of a content source for fetching announcements from Discord channels
 * Handles message retrieval from specified Discord channels using bot authentication
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly (for CLI usage)
 * 2. Platform mode: Uses shared bot via externalConnectionService (for multi-tenant platform)
 */

import { ContentSource } from "./ContentSource";
import { ContentItem, PlatformSourceConfig, isPlatformSourceConfig } from "../../types";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { externalConnectionService, discordAdapter } from '../../services/externalConnections';
import { logger } from '../../helpers/cliHelper';
import { StoragePlugin } from "../storage/StoragePlugin";

/**
 * Configuration interface for DiscordAnnouncementSource
 * @interface DiscordAnnouncementSourceConfig
 * @property {string} name - The name identifier for this Discord source
 * @property {string} botToken - Discord bot token for authentication
 * @property {string[]} channelIds - Array of Discord channel IDs to monitor
 */
interface DiscordAnnouncementSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
}

/**
 * Platform mode config (extends base platform config)
 */
type PlatformAnnouncementConfig = Omit<PlatformSourceConfig, 'storage'> & { storage?: StoragePlugin };

/**
 * Unified config type for both self-hosted and platform modes
 */
type UnifiedAnnouncementConfig = DiscordAnnouncementSourceConfig | PlatformAnnouncementConfig;

/**
 * DiscordAnnouncementSource class that implements ContentSource interface for Discord messages
 * Fetches and processes messages from specified Discord channels using a bot account
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly (for CLI usage)
 * 2. Platform mode: Uses shared bot via discordAdapter (for multi-tenant platform)
 * 
 * @implements {ContentSource}
 */
export class DiscordAnnouncementSource implements ContentSource {
  /** Name identifier for this Discord source */
  public name: string;
  /** Discord bot token for authentication (self-hosted mode only) */
  private botToken: string | null = null;
  /** List of Discord channel IDs to monitor */
  private channelIds: string[];
  /** Discord.js client instance (self-hosted mode only) */
  private client: Client | null = null;
  /** Whether running in platform mode (multi-tenant) */
  private isPlatformMode: boolean = false;
  /** Connection ID for platform mode */
  private connectionId: string | null = null;
  /** Guild ID (resolved at runtime for platform mode) */
  private guildId: string | null = null;

  /** Platform type required for this source (used by frontend to filter available plugins) */
  static requiresPlatform = 'discord';
  
  /** Hidden from UI - use unified DiscordSource with mode='simple' instead */
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
        description: 'Array of Discord channel IDs to monitor for announcements'
      }
    ]
  };

  /**
   * Creates a new DiscordAnnouncementSource instance
   * Supports both self-hosted and platform modes.
   * @param {UnifiedAnnouncementConfig} config - Configuration object for the Discord source
   */
  constructor(config: UnifiedAnnouncementConfig) {
    this.name = config.name;
    this.channelIds = config.channelIds;

    // Check for platform mode by looking for connectionId
    if (isPlatformSourceConfig(config)) {
      // Platform mode - use shared bot service
      this.isPlatformMode = true;
      this.connectionId = config.connectionId;
      this.guildId = config._externalId || null;
      logger.info(`[DiscordAnnouncementSource] Initialized in platform mode with connection ${config.connectionId}`);
    } else if ('botToken' in config) {
      // Self-hosted mode - use provided bot token
      this.isPlatformMode = false;
      this.botToken = config.botToken;
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
      });
    } else {
      throw new Error('DiscordAnnouncementSource requires either botToken (self-hosted) or connectionId (platform mode)');
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
   * Fetches recent messages from configured Discord channels
   * @returns {Promise<ContentItem[]>} Array of content items containing Discord messages
   */
  public async fetchItems(): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    // Get the client (handles login for self-hosted mode)
    const client = await this.getClient();

    let discordResponse : any[] = [];

    for (const channelId of this.channelIds) {
      const channel = await client.channels.fetch(channelId);
      let out: any[] = []
      if (!channel || channel.type !== 0) {
        continue
      }

      const textChannel = channel as TextChannel;
      const messages : any = await textChannel.messages.fetch({ limit: 10 });
      
      messages.forEach((msg: any) => {
        discordResponse.push({
          type: "discordMessage",
          cid: msg.id,
          source: this.name,
          text: msg.content,
          link: `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`,
          date: msg.createdTimestamp,
          metadata: {
            channelId: msg.channelId,
            guildId: msg.guildId,
            cid: msg.id,
            author: msg.author.username,
            messageId: msg.id
          }
        });
      });
    }
    return discordResponse
  }

  /**
   * Fetches historical messages from Discord channels for a specific date
   * @param {string} date - ISO date string to fetch historical messages from
   * @returns {Promise<ContentItem[]>} Array of content items containing historical Discord messages
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
      if (!channel || channel.type !== 0) {
        continue;
      }

      const textChannel = channel as TextChannel;
      let lastMessageId: string | undefined = undefined;

      while (true) {
        const fetchOptions: { limit: number; before?: string } = { limit: 100 };
        if (lastMessageId) {
          fetchOptions.before = lastMessageId;
        }
        const messages = await textChannel.messages.fetch(fetchOptions);

        if (messages.size === 0) break;

        for (const msg of messages.values()) {
          if (msg.createdTimestamp >= cutoffTimestamp) {
            discordResponse.push({
              type: "discordMessage",
              cid: msg.id,
              source: this.name,
              text: msg.content,
              link: `https://discord.com/channels/${msg.guildId}/${msg.channelId}/${msg.id}`,
              date: msg.createdTimestamp,
              metadata: {
                channelId: msg.channelId,
                guildId: msg.guildId,
                cid: msg.id,
                author: msg.author.username,
                messageId: msg.id,
              },
            });
          }
        }

        const oldestMessage = messages.last();
        if (!oldestMessage || oldestMessage.createdTimestamp < cutoffTimestamp) {
          break;
        }

        lastMessageId = oldestMessage.id;
      }
    }
    return discordResponse;
  }
}