/**
 * @fileoverview Implementation of a content source for fetching raw Discord data
 * Handles detailed message retrieval, user data caching, and media content processing
 */

import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits, ChannelType, GuildBasedChannel, Guild } from 'discord.js';
import { ContentSource } from './ContentSource';
import { ContentItem, DiscordRawData, DiscordRawDataSourceConfig, TimeBlock, DiscordAttachment, DiscordEmbed, DiscordSticker } from '../../types';
import { logger, createProgressBar } from '../../helpers/cliHelper';
import { delay, retryOperation } from '../../helpers/generalHelper';
import { isMediaFile } from '../../helpers/fileHelper';
import { StoragePlugin } from '../storage/StoragePlugin';

const API_RATE_LIMIT_DELAY = 50; // Reduced to 50ms between API calls
const PARALLEL_USER_FETCHES = 10; // Number of user fetches to run in parallel
const DISCORD_EPOCH = 1420070400000; // Discord epoch start timestamp

/**
 * Converts a Date object to a Discord snowflake ID.
 * Discord snowflakes embed a timestamp.
 * @param date - The Date object to convert.
 * @returns A string representing the Discord snowflake ID.
 */
function dateToSnowflake(date: Date): string {
  const timestamp = date.getTime();
  const discordTimestamp = timestamp - DISCORD_EPOCH;
  // Shift left by 22 bits to make space for worker and process IDs (we use 0 for those)
  const snowflake = (BigInt(discordTimestamp) << 22n).toString();
  return snowflake;
}

/**
 * Extracts the timestamp from a Discord snowflake ID.
 * @param snowflake - The snowflake ID string.
 * @returns A Date object representing the timestamp.
 */
function snowflakeToDate(snowflake: string): Date {
    const timestamp = (BigInt(snowflake) >> 22n) + BigInt(DISCORD_EPOCH);
    return new Date(Number(timestamp));
}

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
  /** Store to cursors for recently pulled discord channels*/
  private storage: StoragePlugin;

  /**
   * Creates a new DiscordRawDataSource instance
   * @param {DiscordRawDataSourceConfig} config - Configuration object for the Discord source
   */
  constructor(config: DiscordRawDataSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.guildId = config.guildId;
    this.storage = config.storage;
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

      // Process and store media data
      const attachments = await this.processMessageMedia(message, channel);

      processedMessages.push({
        id: message.id,
        ts: message.createdAt.toISOString(),
        uid: message.author.id,
        content: message.content,
        type: message.type === MessageType.Reply ? 'Reply' : undefined,
        mentions: message.mentions.users.map(u => u.id),
        ref: message.reference?.messageId,
        edited: message.editedAt?.toISOString(),
        reactions: reactions.length > 0 ? reactions : undefined,
        attachments: attachments.attachments.length > 0 ? attachments.attachments : undefined,
        embeds: attachments.embeds.length > 0 ? attachments.embeds : undefined,
        sticker_items: attachments.stickers.length > 0 ? attachments.stickers : undefined
      });
    }
    
    return processedMessages;
  }

  private async fetchChannelMessages(channel: TextChannel, targetDate: Date): Promise<DiscordRawData> {
    logger.channel(`Processing channel: ${channel.name} (${channel.id}) for date ${targetDate.toISOString().split('T')[0]}`);
    const users = new Map<string, DiscordRawData['users'][string]>();
    let messages: DiscordRawData['messages'] = [];
    const collectedMessageIds = new Set<string>(); // To avoid duplicates

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const startSnowflake = dateToSnowflake(startOfDay);
    const endSnowflake = dateToSnowflake(endOfDay);

    logger.debug(`Target date range: ${startOfDay.toISOString()} (ID: ${startSnowflake}) to ${endOfDay.toISOString()} (ID: ${endSnowflake})`);

    let messagesInTargetDateRange: Message<true>[] = [];
    let totalScanned = 0;
    let batchCount = 0;

    try {
        // --- Phase 1: Fetch messages around the start of the day ---
        logger.progress(`Fetching ${channel.name}: Phase 1 - Finding start point around ${targetDate.toISOString().split('T')[0]}`);
        let initialMessages = await retryOperation(() => channel.messages.fetch({ limit: 100, around: startSnowflake }));
        totalScanned += initialMessages.size;
        batchCount++;

        // Filter messages within the target date
        initialMessages.forEach((msg: Message<true>) => {
            if (msg.createdTimestamp >= startOfDay.getTime() && msg.createdTimestamp <= endOfDay.getTime()) {
                if (!collectedMessageIds.has(msg.id)) {
                    messagesInTargetDateRange.push(msg);
                    collectedMessageIds.add(msg.id);
                }
            }
        });
        logger.progress(`Fetching ${channel.name}: Phase 1 - Scanned ${totalScanned}, Found ${messagesInTargetDateRange.length} initial`);
        await delay(API_RATE_LIMIT_DELAY);

        // --- Phase 2: Fetch messages before the earliest found message ---
        let earliestMessageId = messagesInTargetDateRange.length > 0
            ? messagesInTargetDateRange.sort((a: Message<true>, b: Message<true>) => a.createdTimestamp - b.createdTimestamp)[0].id
            : initialMessages.size > 0 ? initialMessages.sort((a: Message<true>, b: Message<true>) => a.createdTimestamp - b.createdTimestamp).first()?.id : undefined;

        let hasMoreBefore = !!earliestMessageId;
        logger.progress(`Fetching ${channel.name}: Phase 2 - Fetching backwards from ${earliestMessageId ? snowflakeToDate(earliestMessageId).toISOString() : 'start'}`);

        while (hasMoreBefore) {
            const options: any = { limit: 100, before: earliestMessageId };
            const fetchedMessages = await retryOperation(() => channel.messages.fetch(options));
            totalScanned += fetchedMessages.size;
            batchCount++;

            if (fetchedMessages.size === 0) {
                hasMoreBefore = false;
                break;
            }

            let batchAddedCount = 0;
            fetchedMessages.forEach((msg: Message<true>) => {
                if (msg.createdTimestamp >= startOfDay.getTime() && msg.createdTimestamp <= endOfDay.getTime()) {
                    if (!collectedMessageIds.has(msg.id)) {
                        messagesInTargetDateRange.push(msg);
                        collectedMessageIds.add(msg.id);
                        batchAddedCount++;
                    }
                } else if (msg.createdTimestamp < startOfDay.getTime()) {
                     // We've gone past the start date for this batch
                     hasMoreBefore = false;
                }
            });

            earliestMessageId = fetchedMessages.sort((a: Message<true>, b: Message<true>) => a.createdTimestamp - b.createdTimestamp).first()?.id;
            if (!earliestMessageId) hasMoreBefore = false; // Safety break

            logger.progress(`Fetching ${channel.name}: Phase 2 (Backwards) - Scanned ${totalScanned}, Added ${batchAddedCount}, Total ${collectedMessageIds.size}, Oldest: ${earliestMessageId ? snowflakeToDate(earliestMessageId).toISOString().split('T')[0] : 'N/A'} (Batch ${batchCount})`);

            // Stop if the oldest message is clearly before our target start date
            if (earliestMessageId && BigInt(earliestMessageId) < BigInt(startSnowflake)) {
                 hasMoreBefore = false;
            }

            if (!hasMoreBefore) break; // Exit if flag is set by inner loop or condition
            await delay(API_RATE_LIMIT_DELAY);
        }

        // --- Phase 3: Fetch messages after the latest found message ---
         let latestMessageId = messagesInTargetDateRange.length > 0
            ? messagesInTargetDateRange.sort((a: Message<true>, b: Message<true>) => b.createdTimestamp - a.createdTimestamp)[0].id
            : initialMessages.size > 0 ? initialMessages.sort((a: Message<true>, b: Message<true>) => b.createdTimestamp - a.createdTimestamp).first()?.id : undefined;

        let hasMoreAfter = !!latestMessageId;
        logger.progress(`Fetching ${channel.name}: Phase 3 - Fetching forwards from ${latestMessageId ? snowflakeToDate(latestMessageId).toISOString() : 'start'}`);

        while (hasMoreAfter) {
            const options: any = { limit: 100, after: latestMessageId };
            const fetchedMessages = await retryOperation(() => channel.messages.fetch(options));
            totalScanned += fetchedMessages.size;
            batchCount++;

            if (fetchedMessages.size === 0) {
                hasMoreAfter = false;
                break;
            }

            let batchAddedCount = 0;
            fetchedMessages.forEach((msg: Message<true>) => {
                if (msg.createdTimestamp >= startOfDay.getTime() && msg.createdTimestamp <= endOfDay.getTime()) {
                    if (!collectedMessageIds.has(msg.id)) {
                        messagesInTargetDateRange.push(msg);
                        collectedMessageIds.add(msg.id);
                        batchAddedCount++;
                    }
                } else if (msg.createdTimestamp > endOfDay.getTime()) {
                    // We've gone past the end date for this batch
                    hasMoreAfter = false;
                }
            });

            latestMessageId = fetchedMessages.sort((a: Message<true>, b: Message<true>) => b.createdTimestamp - a.createdTimestamp).first()?.id;
             if (!latestMessageId) hasMoreAfter = false; // Safety break

            logger.progress(`Fetching ${channel.name}: Phase 3 (Forwards) - Scanned ${totalScanned}, Added ${batchAddedCount}, Total ${collectedMessageIds.size}, Newest: ${latestMessageId ? snowflakeToDate(latestMessageId).toISOString().split('T')[0] : 'N/A'} (Batch ${batchCount})`);

            // Stop if the newest message is clearly after our target end date
            if (latestMessageId && BigInt(latestMessageId) > BigInt(endSnowflake)) {
                hasMoreAfter = false;
            }
            if (!hasMoreAfter) break; // Exit if flag is set by inner loop or condition
            await delay(API_RATE_LIMIT_DELAY);
        }

        // --- Phase 4: Process collected messages ---
        logger.clearLine();
        if (messagesInTargetDateRange.length > 0) {
            logger.info(`Processing ${messagesInTargetDateRange.length} messages collected for ${channel.name} on ${targetDate.toISOString().split('T')[0]}`);
            // Need to create a Collection to pass to processMessageBatch
            const messagesCollection = new Collection<string, Message<true>>();
            messagesInTargetDateRange.forEach(msg => messagesCollection.set(msg.id, msg));

            messages = await this.processMessageBatch(messagesCollection, channel, users) as DiscordRawData['messages'];
        } else {
            logger.info(`No messages found for ${channel.name} on ${targetDate.toISOString().split('T')[0]}`);
        }

    } catch (error) {
        logger.clearLine();
        if (error instanceof Error && error.message.includes('Missing Access')) {
            logger.warning(`Missing permissions to access channel ${channel.name}`);
        } else if (error instanceof Error && error.message.includes('Unknown Message')) {
             logger.warning(`Could not find message around snowflake ${startSnowflake} for ${channel.name}. Channel might be empty or date too old.`);
        } else {
            logger.error(`Error fetching messages for ${channel.name}: ${error instanceof Error ? error.message : error}`);
        }
        // Return empty data structure on error to avoid breaking the main loop
        return {
            channel: { id: channel.id, name: channel.name, topic: channel.topic, category: channel.parent?.name || null },
            date: targetDate.toISOString(),
            users: {},
            messages: []
        };
    }

    // Clear progress line and log final result
    logger.clearLine();
    logger.info(`Finished ${channel.name}. Collected ${messages.length} messages after scanning ${totalScanned} total messages.`);

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
        if (!channel || channel.type !== ChannelType.GuildText) {
          logger.warning(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        // *** Simplified fetchItems logic - less efficient but uses cursor ***
        // This part still uses the old `after` logic, as it's for fetching recent items, not historical.
        const cursorKey = `${this.name}-${channel.id}`;
        let lastFetchedMessageId = await this.storage.getCursor(cursorKey);
        const options: any = { limit: 100 };
        if (lastFetchedMessageId) options.after = lastFetchedMessageId;

        const fetchedMessages: Collection<string, Message<true>> = await retryOperation(() => channel.messages.fetch(options));

        const recentMessages = fetchedMessages.filter(msg => msg.createdTimestamp >= cutoff.getTime());

        if (recentMessages.size > 0) {
             const users = new Map<string, DiscordRawData['users'][string]>();
             const processedMessages = await this.processMessageBatch(recentMessages, channel, users) as DiscordRawData['messages'];

             const newestMessage = Array.from(recentMessages.values()).sort((a: Message<true>, b: Message<true>) => b.createdTimestamp - a.createdTimestamp)[0];
             lastFetchedMessageId = newestMessage.id;
             this.storage.setCursor(cursorKey, lastFetchedMessageId); // Update cursor

             const rawData: DiscordRawData = {
                 channel: {
                     id: channel.id,
                     name: channel.name,
                     topic: channel.topic,
                     category: channel.parent?.name || null
                 },
                 date: new Date().toISOString(), // Use current time for fetchItems export
                 users: Object.fromEntries(users),
                 messages: processedMessages.reverse() // Keep chronological order
             };

             const timestamp = Date.now();
             const formattedDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
             const guildName = channel.guild.name;

             items.push({
                cid: `discord-raw-${channel.id}-${formattedDate}`,
                type: 'discordRawData',
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
             logger.success(`Successfully processed ${processedMessages.length} new messages from ${channel.name}`);
        } else {
             logger.info(`No new messages found for channel ${channel.name} in the last hour.`);
        }
      } catch (error) {
        logger.error(`Error processing channel ${channelId} for recent items: ${error}`);
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
    // Ensure targetDate is interpreted as UTC start of day for consistency
    targetDate.setUTCHours(0, 0, 0, 0);
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000); // Keep as seconds for ContentItem

    logger.info(`Processing ${this.channelIds.length} channels for date: ${date}`);
    
    for (const [channelIndex, channelId] of this.channelIds.entries()) {
      try {
        const channel = await retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
        if (!channel || channel.type !== ChannelType.GuildText) { // Use ChannelType enum
          logger.warning(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }
        // Pass the UTC-aligned date object
        const rawData = await this.fetchChannelMessages(channel, targetDate);
        
        const guildName = channel.guild.name;
        const channelName = channel.name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        const formattedDate = new Date().toISOString().replace(/[:.]/g, '-');
        
        if (rawData.messages.length > 0) {
          items.push({
            cid: `discord-raw-${channel.id}-${date}`,
            type: 'discordRawData',
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
        }
        
        logger.success(`Processed ${rawData.messages.length} messages from ${channel.name}`);
      } catch (error) {
        logger.error(`Error processing channel ${channelId}: ${error}`);
      }
    }

    logger.success(`Finished processing all channels for date ${date}`);
    return items;
  }

  /**
   * Process all media from a Discord message and store it in the database.
   * Returns processed media data for inclusion in the message object.
   * @param message - Discord message to process
   * @param channel - Text channel the message came from
   * @returns Promise with processed attachments, embeds, and stickers
   */
  private async processMessageMedia(message: Message<true>, channel: TextChannel): Promise<{
    attachments: DiscordAttachment[];
    embeds: DiscordEmbed[];
    stickers: DiscordSticker[];
  }> {
    const result = {
      attachments: [] as DiscordAttachment[],
      embeds: [] as DiscordEmbed[],
      stickers: [] as DiscordSticker[]
    };

    // Process attachments
    for (const attachment of message.attachments.values()) {
      const discordAttachment: DiscordAttachment = {
        id: attachment.id,
        filename: attachment.name || 'unknown',
        title: attachment.title || undefined,
        description: attachment.description || undefined,
        content_type: attachment.contentType || undefined,
        size: attachment.size,
        url: attachment.url,
        proxy_url: attachment.proxyURL,
        height: attachment.height || undefined,
        width: attachment.width || undefined,
        duration_secs: attachment.duration || undefined,
        waveform: attachment.waveform || undefined,
        ephemeral: attachment.ephemeral || undefined,
        flags: attachment.flags?.bitfield || undefined
      };

      result.attachments.push(discordAttachment);
    }

    // Process embeds
    for (const embed of message.embeds) {
      const discordEmbed: DiscordEmbed = {
        title: embed.title || undefined,
        description: embed.description || undefined,
        url: embed.url || undefined,
        color: embed.color || undefined,
        image: embed.image ? {
          url: embed.image.url,
          proxy_url: embed.image.proxyURL || undefined,
          height: embed.image.height || undefined,
          width: embed.image.width || undefined
        } : undefined,
        thumbnail: embed.thumbnail ? {
          url: embed.thumbnail.url,
          proxy_url: embed.thumbnail.proxyURL || undefined,
          height: embed.thumbnail.height || undefined,
          width: embed.thumbnail.width || undefined
        } : undefined,
        video: embed.video ? {
          url: embed.video.url || undefined,
          proxy_url: embed.video.proxyURL || undefined,
          height: embed.video.height || undefined,
          width: embed.video.width || undefined
        } : undefined
      };

      result.embeds.push(discordEmbed);
    }

    // Process stickers
    for (const sticker of message.stickers.values()) {
      const discordSticker: DiscordSticker = {
        id: sticker.id,
        name: sticker.name,
        format_type: sticker.format,
        description: sticker.description || undefined
      };

      result.stickers.push(discordSticker);
    }

    return result;
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