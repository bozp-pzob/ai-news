/**
 * @fileoverview Implementation of a content source for fetching raw Discord data
 * Handles detailed message retrieval, user data caching, and media content processing
 */

import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits, ChannelType, GuildBasedChannel, Guild } from 'discord.js';
import { ContentSource } from './ContentSource';
import { ContentItem, DiscordRawData, DiscordRawDataSourceConfig, TimeBlock } from '../../types';
import { logger } from '../../helpers/cliHelper';
import { delay, retryOperation } from '../../helpers/generalHelper';
import { isMediaFile } from '../../helpers/fileHelper';

const API_RATE_LIMIT_DELAY = 50; // Reduced to 50ms between API calls
const PARALLEL_USER_FETCHES = 10; // Number of user fetches to run in parallel

/**
 * DiscordRawDataSource class that implements ContentSource interface for detailed Discord data
 * Handles comprehensive message retrieval, user data management, and media content processing
 * @implements {ContentSource}
 */
export class DiscordRawDataSource implements ContentSource {
  /** Name identifier for this Discord source */
  public name: string;
  /** Discord.js client instance */
  private client: Client;
  /** List of Discord channel IDs to monitor */
  private channelIds: string[];
  /** Discord bot token for authentication */
  private botToken: string;
  /** Discord guild/server ID */
  private guildId: string;

  /**
   * Creates a new DiscordRawDataSource instance
   * @param {DiscordRawDataSourceConfig} config - Configuration object for the Discord source
   */
  constructor(config: DiscordRawDataSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.guildId = config.guildId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    });

    this.client.on('error', (error) => {
      if (error.message.includes('disallowed intents')) {
        logger.error('Bot requires privileged intents. Please enable them in the Discord Developer Portal:\n1. Go to https://discord.com/developers/applications\n2. Select your bot application\n3. Go to "Bot" section\n4. Enable "Server Members Intent" under "Privileged Gateway Intents"');
        process.exit(1);
      }
    });
  }

  private async fetchUserData(member: GuildMember | null, user: User): Promise<DiscordRawData['users'][string]> {
    return await retryOperation(async () => {
      const baseData = {
        name: user.username,
        isBot: user.bot || undefined
      };

      if (member) {
        return {
          ...baseData,
          nickname: member.nickname || user.globalName || null,
          roles: member.roles.cache
            .filter(role => role.name !== '@everyone')
            .map(role => role.name)
        };
      }

      return {
        ...baseData,
        nickname: user.globalName || null
      };
    });
  }

  private async fetchUserDataBatch(members: Map<string, GuildMember | null>, users: Map<string, User>): Promise<Map<string, DiscordRawData['users'][string]>> {
    const userData = new Map<string, DiscordRawData['users'][string]>();
    const entries = Array.from(users.entries());
    
    for (let i = 0; i < entries.length; i += PARALLEL_USER_FETCHES) {
      const batch = entries.slice(i, i + PARALLEL_USER_FETCHES);
      const promises = batch.map(async ([id, user]) => {
        let member: GuildMember | null = members.get(id) || null;
        
        if (!member) {
          try {
            const guild = this.client.guilds.cache.get(this.guildId);
            if (guild) {
              member = await guild.members.fetch({ user, force: true, cache: true }).catch(() => null);
              
              if (member) {
                members.set(id, member);
              }
            }
          } catch (error) {
            if (error instanceof Error && !error.message.includes('disallowed intents')) {
              logger.warning(`Error fetching member ${user.username}: ${error.message}`);
            }
          }
        }
        
        return [id, await this.fetchUserData(member, user)] as [string, DiscordRawData['users'][string]];
      });
      
      const results = await Promise.all(promises);
      results.forEach(([id, data]) => userData.set(id, data));
      
      if (i + PARALLEL_USER_FETCHES < entries.length) {
        await delay(API_RATE_LIMIT_DELAY);
      }
    }
    
    return userData;
  }

  private async processMessageBatch(
    messages: Collection<string, Message<true>>,
    channel: TextChannel,
    users?: Map<string, DiscordRawData['users'][string]>
  ): Promise<DiscordRawData['messages'] | Message<true>[]> {
    if (!users) {
      const processedMessages: Message<true>[] = [];
      
      for (const message of messages.values()) {
        const mediaUrls = this.extractMediaUrls(message);
        if (mediaUrls.length > 0 || message.content.trim().length > 0) {
          processedMessages.push(message);
        }
      }
      
      return processedMessages;
    }

    const processedMessages: DiscordRawData['messages'] = [];
    const missingMembers = new Map<string, User>();
    const existingMembers = new Map<string, GuildMember | null>();

    for (const message of messages.values()) {
      const author = message.author;
      if (!users.has(author.id)) {
        missingMembers.set(author.id, author);
      }
      
      message.mentions.users.forEach(user => {
        if (!users.has(user.id)) {
          missingMembers.set(user.id, user);
        }
      });
    }

    if (missingMembers.size > 0) {
      const newUserData = await this.fetchUserDataBatch(existingMembers, missingMembers);
      newUserData.forEach((data, id) => users.set(id, data));
    }

    for (const message of messages.values()) {
      const reactions = message.reactions.cache.map(reaction => ({
        emoji: reaction.emoji.toString(),
        count: reaction.count || 0
      }));

      processedMessages.push({
        id: message.id,
        ts: message.createdAt.toISOString(),
        uid: message.author.id,
        content: message.content,
        type: message.type === MessageType.Reply ? 'Reply' : undefined,
        mentions: message.mentions.users.map(u => u.id),
        ref: message.reference?.messageId,
        edited: message.editedAt?.toISOString(),
        reactions: reactions.length > 0 ? reactions : undefined
      });
    }
    
    return processedMessages;
  }

  private async fetchChannelMessages(channel: TextChannel, targetDate: Date): Promise<DiscordRawData> {
    logger.channel(`Processing channel: ${channel.name} (${channel.id})`);
    const users = new Map<string, DiscordRawData['users'][string]>();
    const messages: DiscordRawData['messages'] = [];
    
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Get the most recent message ID as our starting point
      const recentMessages = await retryOperation(() => channel.messages.fetch({ limit: 1 }));
      const lastMessageId = recentMessages.first()?.id;

      if (!lastMessageId) {
        logger.info(`No messages found for ${channel.name} on ${targetDate.toISOString().split('T')[0]}`);
        return {
          channel: {
            id: channel.id,
            name: channel.name,
            topic: channel.topic,
            category: channel.parent?.name || null
          },
          date: targetDate.toISOString(),
          users: {},
          messages: []
        };
      }

      let currentMessageId = lastMessageId;
      let hasMoreMessages = true;

      while (hasMoreMessages) {
        const options = { 
          limit: 100,
          before: currentMessageId
        };

        try {
          const fetchedMessages : Collection<string, Message<true>> = await retryOperation(() => channel.messages.fetch(options));
          
          if (fetchedMessages.size === 0) {
            logger.info(`No more messages found in channel ${channel.name}`);
            hasMoreMessages = false;
            break;
          }

          // Filter messages to only include those from our target date
          const filteredMessages : Collection<string, Message<true>> = fetchedMessages.filter((msg:Message) => {
            const msgDate = msg.createdAt;
            return msgDate >= startOfDay && msgDate <= endOfDay;
          });

          if (filteredMessages.size > 0) {
            const processedBatch = await this.processMessageBatch(filteredMessages, channel, users) as DiscordRawData['messages'];
            messages.push(...processedBatch);
          }

          // Check if we've reached messages before our target date
          const oldestMessage : Message<true> | undefined = Array.from(fetchedMessages.values()).pop();
          if (oldestMessage && oldestMessage.createdAt < startOfDay) {
            hasMoreMessages = false;
            break;
          }

          currentMessageId = oldestMessage?.id || '';
          if (!currentMessageId) {
            hasMoreMessages = false;
            break;
          }

          // Add a small delay to avoid rate limits
          await delay(API_RATE_LIMIT_DELAY);
        } catch (error) {
          if (error instanceof Error && error.message.includes('Missing Access')) {
            logger.warning(`Missing permissions to access channel ${channel.name}`);
            break;
          }
          throw error;
        }
      }

      logger.info(`Found ${messages.length} messages for ${channel.name} on ${targetDate.toISOString().split('T')[0]}`);

    } catch (error) {
      logger.error(`Error fetching messages for channel ${channel.name}: ${error}`);
    }

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        category: channel.parent?.name || null
      },
      date: targetDate.toISOString(),
      users: Object.fromEntries(users),
      messages: messages.reverse()
    };
  }

  async fetchItems(): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      logger.info('Logging in to Discord...');
      await this.client.login(this.botToken);
      logger.success('Successfully logged in to Discord');
    }

    const items: ContentItem[] = [];
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 1);

    logger.info(`Processing ${this.channelIds.length} channels for the last hour...`);
    for (const channelId of this.channelIds) {
      try {
        logger.channel(`Fetching channel ${channelId}...`);
        const channel = await retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
        if (!channel || channel.type !== 0) {
          logger.warning(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        const rawData = await this.fetchChannelMessages(channel, cutoff);
        
        const timestamp = Date.now();
        const formattedDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
        
        const guildName = channel.guild.name;
        
        items.push({
          cid: `discord-raw-${channel.id}-${formattedDate}`,
          type: 'discord-raw',
          source: `${guildName} - ${channel.name}`,
          title: `Raw Discord Data: ${channel.name}`,
          text: JSON.stringify(rawData),
          link: `https://discord.com/channels/${channel.guild.id}/${channel.id}`,
          date: timestamp,
          metadata: {
            channelId: channel.id,
            guildId: channel.guild.id,
            guildName: guildName,
            channelName: channel.name,
            messageCount: rawData.messages.length,
            userCount: Object.keys(rawData.users).length,
            exportTimestamp: formattedDate
          }
        });
        logger.success(`Successfully processed channel ${channel.name}`);
      } catch (error) {
        logger.error(`Error processing channel ${channelId}: ${error}`);
      }
    }

    logger.success(`Finished processing all channels. Total items: ${items.length}`);
    return items;
  }

  async fetchHistorical(date: string): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      logger.info('Logging in to Discord...');
      await this.client.login(this.botToken);
      logger.success('Successfully logged in to Discord');
    }

    const items: ContentItem[] = [];
    const targetDate = new Date(date);
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);

    logger.info(`Processing ${this.channelIds.length} channels for date: ${date}`);
    
    for (const [channelIndex, channelId] of this.channelIds.entries()) {
      try {
        const channel = await retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
        if (!channel || channel.type !== 0) {
          logger.warning(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        const rawData = await this.fetchChannelMessages(channel, targetDate);
        
        const guildName = channel.guild.name;
        const channelName = channel.name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        const formattedDate = new Date().toISOString().replace(/[:.]/g, '-');
        
        items.push({
          cid: `discord-raw-${channel.id}-${date}`,
          type: 'discord-raw',
          source: `${guildName} - ${channel.name}`,
          title: `Raw Discord Data: ${channel.name} (${date})`,
          text: JSON.stringify(rawData),
          link: `https://discord.com/channels/${channel.guild.id}/${channel.id}`,
          date: targetTimestamp,
          metadata: {
            channelId: channel.id,
            guildId: channel.guild.id,
            guildName: guildName,
            channelName: channel.name,
            messageCount: rawData.messages.length,
            userCount: Object.keys(rawData.users).length,
            dateProcessed: date,
            exportTimestamp: formattedDate
          }
        });
        
        logger.success(`Processed ${rawData.messages.length} messages from ${channel.name}`);
      } catch (error) {
        logger.error(`Error processing channel ${channelId}: ${error}`);
      }
    }

    logger.success(`Finished processing all channels for date ${date}`);
    return items;
  }

  private extractMediaUrls(message: Message<true>): string[] {
    const mediaUrls: string[] = [];
    
    message.attachments.forEach(attachment => {
      if (isMediaFile(attachment.url, attachment.contentType)) {
        mediaUrls.push(attachment.url);
      }
    });
    
    message.embeds.forEach(embed => {
      if (embed.image) mediaUrls.push(embed.image.url);
      if (embed.thumbnail) mediaUrls.push(embed.thumbnail.url);
      if (embed.video) mediaUrls.push(embed.video.url);
    });
    
    const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    const contentUrls = message.content.match(urlRegex) || [];
    contentUrls.forEach(url => {
      if (isMediaFile(url)) {
        mediaUrls.push(url);
      }
    });
    
    return [...new Set(mediaUrls)];
  }
}