// src/plugins/sources/DiscordSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";

interface DiscordAnnouncementSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
}

export class DiscordAnnouncementSource implements ContentSource {
  public name: string;
  private botToken: string = '';
  private channelIds: string[];
  private client: Client;

  static constructorInterface = {
    parameters: [
      {
        name: 'botToken',
        type: 'string',
        required: true,
        description: 'Discord bot token for authentication'
      },
      {
        name: 'channelIds',
        type: 'string[]',
        required: true,
        description: 'Array of Discord channel IDs to monitor for announcements'
      }
    ]
  };

  constructor(config: DiscordAnnouncementSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });
  }

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