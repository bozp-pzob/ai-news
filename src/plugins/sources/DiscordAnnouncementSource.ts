/**
 * @fileoverview Implementation of a content source for fetching announcements from Discord channels
 * Handles message retrieval from specified Discord channels using bot authentication
 */

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";

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
 * DiscordAnnouncementSource class that implements ContentSource interface for Discord messages
 * Fetches and processes messages from specified Discord channels using a bot account
 * @implements {ContentSource}
 */
export class DiscordAnnouncementSource implements ContentSource {
  /** Name identifier for this Discord source */
  public name: string;
  /** Discord bot token for authentication */
  private botToken: string = '';
  /** List of Discord channel IDs to monitor */
  private channelIds: string[];
  /** Discord.js client instance */
  private client: Client;

  static constructorInterface = {
    parameters: [
      {
        name: 'botToken',
        type: 'string',
        required: true,
        description: 'Discord bot token for authentication',
        secret: true
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
   * @param {DiscordAnnouncementSourceConfig} config - Configuration object for the Discord source
   */
  constructor(config: DiscordAnnouncementSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });
  }

  /**
   * Fetches recent messages from configured Discord channels
   * @returns {Promise<ContentItem[]>} Array of content items containing Discord messages
   */
  public async fetchItems(): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      await this.client.login(this.botToken);
    }

    let discordResponse : any[] = [];

    for (const channelId of this.channelIds) {
      const channel = await this.client.channels.fetch(channelId);
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
    if (!this.client.isReady()) {
      await this.client.login(this.botToken);
    }

    const cutoffTimestamp = new Date(date).getTime();
    let discordResponse: ContentItem[] = [];

    for (const channelId of this.channelIds) {
      const channel = await this.client.channels.fetch(channelId);
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