/**
 * @fileoverview Implementation of a content source for fetching raw Discord data
 * Handles detailed message retrieval, user data caching, and media content processing
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly
 * 2. Platform mode: Uses shared bot via externalConnectionService with connectionId
 */

import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits, ChannelType, GuildBasedChannel, Guild, ForumChannel, ThreadChannel, AnyThreadChannel } from 'discord.js';
import { ContentSource } from './ContentSource';
import { 
  ContentItem, 
  DiscordRawData, 
  DiscordRawDataSourceConfig, 
  PlatformSourceConfig,
  UnifiedDiscordSourceConfig,
  isPlatformSourceConfig,
  TimeBlock, 
  DiscordAttachment, 
  DiscordEmbed, 
  DiscordSticker, 
  MediaDownloadConfig 
} from '../../types';
import { logger, createProgressBar } from '../../helpers/cliHelper';
import { delay, retryOperation } from '../../helpers/generalHelper';
import { isMediaFile } from '../../helpers/fileHelper';
import { processDiscordAttachment, processDiscordEmbed, processDiscordSticker } from '../../helpers/mediaHelper';
import { StoragePlugin } from '../storage/StoragePlugin';
import { DiscordChannelRegistry } from '../storage/DiscordChannelRegistry';
import { externalConnectionService, discordAdapter } from '../../services/externalConnections';

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
 * Interface for sources that support media downloading
 */
export interface MediaDownloadCapable {
  readonly mediaDownload?: MediaDownloadConfig;
  hasMediaDownloadEnabled(): boolean;
}

/**
 * DiscordRawDataSource class that implements ContentSource interface for detailed Discord data
 * Handles comprehensive message retrieval, user data management, and media content processing
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly (for CLI usage)
 * 2. Platform mode: Uses shared bot via discordAdapter (for multi-tenant platform)
 * 
 * @implements {ContentSource}
 */
export class DiscordRawDataSource implements ContentSource, MediaDownloadCapable {
  /** Name identifier for this Discord source */
  public name: string;
  /** Discord.js client instance (only used in self-hosted mode) */
  private client: Client | null = null;
  /** List of Discord channel IDs to monitor */
  private channelIds: string[];
  /** Discord bot token for authentication (self-hosted mode only) */
  private botToken: string | null = null;
  /** Discord guild/server ID */
  private guildId: string;
  /** Store to cursors for recently pulled discord channels*/
  private storage: StoragePlugin;
  /** Channel registry for tracking channel metadata and activity */
  private channelRegistry: DiscordChannelRegistry | null = null;
  /** Media download configuration */
  public mediaDownload?: MediaDownloadConfig;
  /** Whether running in platform mode (multi-tenant) */
  private isPlatformMode: boolean = false;
  /** Connection ID for platform mode */
  private connectionId: string | null = null;
  /** User ID for platform mode validation */
  private platformUserId: string | null = null;

  /** Platform type required for this source (used by frontend to filter available plugins) */
  static requiresPlatform = 'discord';
  
  /** Hidden from UI - use unified DiscordSource with mode='detailed' instead */
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
        type: 'array',
        required: true,
        description: 'List of Discord channel IDs to monitor'
      },
      {
        name: 'guildId',
        type: 'string',
        required: false,
        description: 'Discord guild/server ID (self-hosted mode)'
      },
      {
        name: 'storage',
        type: 'object',
        required: true,
        description: 'Storage plugin for cursor management'
      },
      {
        name: 'mediaDownload',
        type: 'object',
        required: false,
        description: 'Media download configuration'
      }
    ]
  };

  /**
   * Creates a new DiscordRawDataSource instance
   * Supports both self-hosted and platform modes
   * @param {UnifiedDiscordSourceConfig} config - Configuration object for the Discord source
   */
  constructor(config: UnifiedDiscordSourceConfig) {
    this.name = config.name;
    this.channelIds = config.channelIds;
    this.storage = config.storage;
    this.mediaDownload = config.mediaDownload;

    if (isPlatformSourceConfig(config)) {
      // Platform mode - use shared bot service
      this.isPlatformMode = true;
      this.connectionId = config.connectionId;
      this.platformUserId = config._userId || null;
      this.guildId = config._externalId || ''; // Will be resolved at runtime
      logger.info(`[DiscordRawDataSource] Initialized in platform mode with connection ${config.connectionId}`);
    } else {
      // Self-hosted mode - use provided bot token
      this.isPlatformMode = false;
      this.botToken = config.botToken;
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
  }

  /**
   * Check if media download is enabled for this source
   */
  hasMediaDownloadEnabled(): boolean {
    return this.mediaDownload?.enabled === true;
  }

  /**
   * Get the Discord client, initializing if needed
   * Handles both self-hosted and platform modes
   */
  private async getClient(): Promise<Client> {
    if (this.isPlatformMode) {
      // Platform mode - use shared bot service via adapter
      return discordAdapter.getClient();
    } else {
      // Self-hosted mode - use own client
      if (!this.client) {
        throw new Error('Discord client not initialized');
      }
      if (!this.client.isReady() && this.botToken) {
        logger.info('Logging in to Discord...');
        await this.client.login(this.botToken);
        logger.success('Successfully logged in to Discord');
      }
      return this.client;
    }
  }

  /**
   * Validate platform mode connection before fetching
   * Ensures user still has access to the guild
   */
  private async validatePlatformConnection(): Promise<void> {
    if (!this.isPlatformMode || !this.connectionId) {
      return;
    }

    // Get connection details
    const connection = await externalConnectionService.getConnectionById(this.connectionId);
    if (!connection) {
      throw new Error(`Connection ${this.connectionId} not found`);
    }

    if (!connection.isActive) {
      throw new Error(`Connection ${this.connectionId} is no longer active`);
    }

    // Set guildId from connection
    this.guildId = connection.externalId;

    // Validate channels are accessible
    const validation = await externalConnectionService.validateChannels(
      this.connectionId,
      this.channelIds
    );

    if (!validation.valid) {
      throw new Error(
        `Some channels are not accessible: ${validation.invalidChannels.join(', ')}`
      );
    }
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
    const client = await this.getClient();
    
    for (let i = 0; i < entries.length; i += PARALLEL_USER_FETCHES) {
      const batch = entries.slice(i, i + PARALLEL_USER_FETCHES);
      const promises = batch.map(async ([id, user]) => {
        let member: GuildMember | null = members.get(id) || null;
        
        if (!member) {
          try {
            const guild = client.guilds.cache.get(this.guildId);
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

  /**
   * Fetches messages from a forum channel by iterating through its threads
   * @param channel - Forum channel to fetch from
   * @param targetDate - Target date to fetch messages for
   * @returns Promise with aggregated raw data from all threads
   */
  private async fetchForumMessages(channel: ForumChannel, targetDate: Date): Promise<DiscordRawData> {
    logger.channel(`Processing forum: ${channel.name} (${channel.id}) for date ${targetDate.toISOString().split('T')[0]}`);

    const users = new Map<string, DiscordRawData['users'][string]>();
    let allMessages: DiscordRawData['messages'] = [];
    const threadNames: string[] = [];

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    try {
      // Fetch active threads
      logger.progress(`Fetching ${channel.name}: Getting active threads...`);
      const activeThreads = await retryOperation(() => channel.threads.fetchActive());

      // Fetch archived threads (may contain messages from target date)
      logger.progress(`Fetching ${channel.name}: Getting archived threads...`);
      const archivedThreads = await retryOperation(() => channel.threads.fetchArchived({ limit: 100 }));

      // Combine all threads
      const allThreads = new Map<string, AnyThreadChannel>();
      activeThreads.threads.forEach((thread: AnyThreadChannel, id: string) => allThreads.set(id, thread));
      archivedThreads.threads.forEach((thread: AnyThreadChannel, id: string) => allThreads.set(id, thread));

      logger.info(`Found ${allThreads.size} threads in forum ${channel.name}`);

      let threadIndex = 0;
      for (const [threadId, thread] of allThreads) {
        threadIndex++;
        logger.progress(`Fetching ${channel.name}: Thread ${threadIndex}/${allThreads.size} - ${thread.name}`);

        try {
          // Fetch messages from this thread for the target date
          const threadMessages = await this.fetchThreadMessages(thread, targetDate, users);

          if (threadMessages.length > 0) {
            threadNames.push(thread.name);
            allMessages = allMessages.concat(threadMessages);
            logger.debug(`  Thread "${thread.name}": ${threadMessages.length} messages`);
          }

          await delay(API_RATE_LIMIT_DELAY);
        } catch (threadError) {
          if (threadError instanceof Error && threadError.message.includes('Missing Access')) {
            logger.debug(`  Skipping thread ${thread.name}: Missing access`);
          } else {
            logger.warning(`  Error fetching thread ${thread.name}: ${threadError}`);
          }
        }
      }

      logger.clearLine();
      logger.info(`Finished ${channel.name}. Collected ${allMessages.length} messages from ${threadNames.length} threads.`);

    } catch (error) {
      logger.clearLine();
      if (error instanceof Error && error.message.includes('Missing Access')) {
        logger.warning(`Missing permissions to access forum ${channel.name}`);
      } else {
        logger.error(`Error fetching forum ${channel.name}: ${error instanceof Error ? error.message : error}`);
      }
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
      messages: allMessages.sort((a, b) => new Date(a.ts!).getTime() - new Date(b.ts!).getTime())
    };
  }

  /**
   * Fetches messages from a single thread for a target date
   */
  private async fetchThreadMessages(
    thread: AnyThreadChannel,
    targetDate: Date,
    users: Map<string, DiscordRawData['users'][string]>
  ): Promise<DiscordRawData['messages']> {
    const messages: DiscordRawData['messages'] = [];
    const collectedMessageIds = new Set<string>();

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const startSnowflake = dateToSnowflake(startOfDay);

    try {
      // Fetch messages around the target date
      let fetchedMessages = await retryOperation(() => thread.messages.fetch({ limit: 100, around: startSnowflake }));

      // Filter to target date and process
      const targetMessages = fetchedMessages.filter(
        (msg: Message) => msg.createdTimestamp >= startOfDay.getTime() && msg.createdTimestamp <= endOfDay.getTime()
      );

      if (targetMessages.size === 0) {
        return messages;
      }

      // Fetch user data for message authors
      const missingUsers = new Map<string, User>();
      targetMessages.forEach((msg: Message) => {
        if (!users.has(msg.author.id)) {
          missingUsers.set(msg.author.id, msg.author);
        }
      });

      if (missingUsers.size > 0) {
        const existingMembers = new Map<string, GuildMember | null>();
        const newUserData = await this.fetchUserDataBatch(existingMembers, missingUsers);
        newUserData.forEach((data, id) => users.set(id, data));
      }

      // Process messages
      for (const msg of targetMessages.values()) {
        if (collectedMessageIds.has(msg.id)) continue;
        collectedMessageIds.add(msg.id);

        const reactions = msg.reactions.cache.map((reaction: MessageReaction) => ({
          emoji: reaction.emoji.toString(),
          count: reaction.count || 0
        }));

        // Process attachments
        const attachments: DiscordAttachment[] = [];
        for (const attachment of msg.attachments.values()) {
          attachments.push(processDiscordAttachment(attachment));
        }

        const embeds: DiscordEmbed[] = [];
        for (const embed of msg.embeds) {
          embeds.push(processDiscordEmbed(embed));
        }

        const stickers: DiscordSticker[] = [];
        for (const sticker of msg.stickers.values()) {
          stickers.push(processDiscordSticker(sticker));
        }

        messages.push({
          id: msg.id,
          ts: msg.createdAt.toISOString(),
          uid: msg.author.id,
          content: msg.content,
          type: msg.type === MessageType.Reply ? 'Reply' : undefined,
          mentions: msg.mentions.users.map((u: User) => u.id),
          ref: msg.reference?.messageId,
          edited: msg.editedAt?.toISOString(),
          reactions: reactions.length > 0 ? reactions : undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          embeds: embeds.length > 0 ? embeds : undefined,
          sticker_items: stickers.length > 0 ? stickers : undefined,
          threadName: thread.name // Add thread context
        });
      }

    } catch (error) {
      // Silently skip threads we can't access
      if (!(error instanceof Error && error.message.includes('Missing Access'))) {
        throw error;
      }
    }

    return messages;
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
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    // Get the client (handles login for self-hosted mode)
    const client = await this.getClient();

    const items: ContentItem[] = [];
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 1);

    logger.info(`Processing ${this.channelIds.length} channels for the last hour...`);
    for (const channelId of this.channelIds) {
      try {
        logger.channel(`Fetching channel ${channelId}...`);
        const channel = await retryOperation(() => client.channels.fetch(channelId));
        if (!channel) {
          logger.warning(`Channel ${channelId} does not exist.`);
          continue;
        }

        // Skip unsupported channel types
        if (channel.type !== ChannelType.GuildText &&
            channel.type !== ChannelType.GuildForum &&
            channel.type !== ChannelType.GuildAnnouncement) {
          logger.warning(`Channel ${channelId} is type ${channel.type} (not text/forum/announcement).`);
          continue;
        }

        // For forums, use historical fetch with current date (fetchItems is for recent messages)
        if (channel.type === ChannelType.GuildForum) {
          const today = new Date();
          const rawData = await this.fetchForumMessages(channel as ForumChannel, today);
          if (rawData.messages.length > 0) {
            const forumChannel = channel as ForumChannel;
            const timestamp = Date.now();
            const formattedDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
            const guildName = forumChannel.guild.name;

            items.push({
              cid: `discord-raw-${forumChannel.id}-${formattedDate}`,
              type: 'discordRawData',
              source: `${guildName} - ${forumChannel.name}`,
              title: `Raw Discord Data: ${forumChannel.name}`,
              text: JSON.stringify(rawData),
              link: `https://discord.com/channels/${forumChannel.guild.id}/${forumChannel.id}`,
              date: timestamp,
              metadata: {
                channelId: forumChannel.id,
                guildId: forumChannel.guild.id,
                guildName: guildName,
                channelName: forumChannel.name,
                channelType: 'forum',
                messageCount: rawData.messages.length,
                userCount: Object.keys(rawData.users).length,
                exportTimestamp: formattedDate
              }
            });
            logger.success(`Successfully processed ${rawData.messages.length} messages from forum ${forumChannel.name}`);
          }
          continue;
        }

        // Handle text and announcement channels
        const textChannel = channel as TextChannel;

        // *** Simplified fetchItems logic - less efficient but uses cursor ***
        // This part still uses the old `after` logic, as it's for fetching recent items, not historical.
        const cursorKey = `${this.name}-${textChannel.id}`;
        let lastFetchedMessageId = await this.storage.getCursor(cursorKey);
        const options: any = { limit: 100 };
        if (lastFetchedMessageId) options.after = lastFetchedMessageId;

        const fetchedMessages: Collection<string, Message<true>> = await retryOperation(() => textChannel.messages.fetch(options));

        const recentMessages = fetchedMessages.filter(msg => msg.createdTimestamp >= cutoff.getTime());

        if (recentMessages.size > 0) {
             const users = new Map<string, DiscordRawData['users'][string]>();
             const processedMessages = await this.processMessageBatch(recentMessages, textChannel, users) as DiscordRawData['messages'];

             const newestMessage = Array.from(recentMessages.values()).sort((a: Message<true>, b: Message<true>) => b.createdTimestamp - a.createdTimestamp)[0];
             lastFetchedMessageId = newestMessage.id;
             this.storage.setCursor(cursorKey, lastFetchedMessageId); // Update cursor

             const rawData: DiscordRawData = {
                 channel: {
                     id: textChannel.id,
                     name: textChannel.name,
                     topic: textChannel.topic,
                     category: textChannel.parent?.name || null
                 },
                 date: new Date().toISOString(), // Use current time for fetchItems export
                 users: Object.fromEntries(users),
                 messages: processedMessages.reverse() // Keep chronological order
             };

             const timestamp = Date.now();
             const formattedDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
             const guildName = textChannel.guild.name;

             items.push({
                cid: `discord-raw-${textChannel.id}-${formattedDate}`,
                type: 'discordRawData',
                source: `${guildName} - ${textChannel.name}`,
                title: `Raw Discord Data: ${textChannel.name}`,
                text: JSON.stringify(rawData),
                link: `https://discord.com/channels/${textChannel.guild.id}/${textChannel.id}`,
                date: timestamp,
                metadata: {
                  channelId: textChannel.id,
                  guildId: textChannel.guild.id,
                  guildName: guildName,
                  channelName: textChannel.name,
                  messageCount: rawData.messages.length,
                  userCount: Object.keys(rawData.users).length,
                  exportTimestamp: formattedDate
                }
             });
             logger.success(`Successfully processed ${processedMessages.length} new messages from ${textChannel.name}`);
        } else {
             logger.info(`No new messages found for channel ${textChannel.name} in the last hour.`);
        }
      } catch (error) {
        logger.error(`Error processing channel ${channelId} for recent items: ${error}`);
      }
    }

    logger.success(`Finished processing all channels. Total items: ${items.length}`);
    return items;
  }

  async fetchHistorical(date: string): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    // Get the client (handles login for self-hosted mode)
    const client = await this.getClient();

    // Initialize channel registry if storage supports direct db access
    if (!this.channelRegistry) {
      const db = this.storage.getDb();
      if (db) {
        this.channelRegistry = new DiscordChannelRegistry(db);
        await this.channelRegistry.initialize();
        logger.debug('Initialized DiscordChannelRegistry');
      }
    }

    const items: ContentItem[] = [];
    const targetDate = new Date(date);
    // Ensure targetDate is interpreted as UTC start of day for consistency
    targetDate.setUTCHours(0, 0, 0, 0);
    const targetTimestamp = Math.floor(targetDate.getTime() / 1000); // Keep as seconds for ContentItem

    // Pre-check which channels already have data for this date
    const channelsToFetch: string[] = [];
    const skippedChannels: string[] = [];

    for (const channelId of this.channelIds) {
      const cid = `discord-raw-${channelId}-${date}`;
      const exists = await this.storage.getContentItem(cid);
      if (exists) {
        skippedChannels.push(channelId);
      } else {
        channelsToFetch.push(channelId);
      }
    }

    if (skippedChannels.length > 0) {
      logger.info(`Skipping ${skippedChannels.length} channels with existing data for ${date}`);
    }

    if (channelsToFetch.length === 0) {
      logger.info(`All ${this.channelIds.length} channels already have data for ${date}`);
      return items;
    }

    logger.info(`Processing ${channelsToFetch.length} channels for date: ${date}`);

    for (const [channelIndex, channelId] of channelsToFetch.entries()) {
      try {
        const channel = await retryOperation(() => client.channels.fetch(channelId));
        if (!channel) {
          logger.warning(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        let rawData: DiscordRawData;

        // Handle different channel types
        if (channel.type === ChannelType.GuildText) {
          // Regular text channel
          rawData = await this.fetchChannelMessages(channel as TextChannel, targetDate);
        } else if (channel.type === ChannelType.GuildForum) {
          // Forum channel - fetch from threads
          rawData = await this.fetchForumMessages(channel as ForumChannel, targetDate);
        } else if (channel.type === ChannelType.GuildAnnouncement) {
          // Announcement channels work like text channels
          rawData = await this.fetchChannelMessages(channel as TextChannel, targetDate);
        } else {
          logger.warning(`Channel ${channelId} is type ${channel.type} (not text/forum/announcement).`);
          continue;
        }
        
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

        // Update channel registry with channel metadata and activity
        if (this.channelRegistry) {
          try {
            // Get channel properties safely (forums have different properties)
            const textChannel = channel as TextChannel;
            const forumChannel = channel as ForumChannel;

            await this.channelRegistry.upsertChannel({
              id: channel.id,
              guildId: channel.type === ChannelType.GuildForum ? forumChannel.guild.id : textChannel.guild.id,
              guildName: guildName,
              name: channel.type === ChannelType.GuildForum ? forumChannel.name : textChannel.name,
              topic: channel.type === ChannelType.GuildForum ? forumChannel.topic : textChannel.topic,
              categoryId: channel.type === ChannelType.GuildForum ? forumChannel.parentId : textChannel.parentId,
              categoryName: channel.type === ChannelType.GuildForum ? forumChannel.parent?.name || null : textChannel.parent?.name || null,
              type: channel.type,
              position: channel.type === ChannelType.GuildForum ? forumChannel.position : textChannel.position,
              nsfw: channel.type === ChannelType.GuildForum ? forumChannel.nsfw : textChannel.nsfw,
              rateLimitPerUser: channel.type === ChannelType.GuildText ? textChannel.rateLimitPerUser : 0,
              createdAt: Math.floor((channel.createdTimestamp || Date.now()) / 1000),
              observedAt: date,
              isTracked: true
            });

            // Record daily activity
            await this.channelRegistry.recordActivity(
              channel.id,
              date,
              rawData.messages.length
            );
          } catch (regError) {
            logger.warning(`Failed to update channel registry for ${channel.name}: ${regError}`);
          }
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
    
    // Process attachments using shared utility
    for (const attachment of message.attachments.values()) {
      result.attachments.push(processDiscordAttachment(attachment));
    }

    // Process embeds using shared utility
    for (const embed of message.embeds) {
      result.embeds.push(processDiscordEmbed(embed));
    }

    // Process stickers using shared utility
    for (const sticker of message.stickers.values()) {
      result.stickers.push(processDiscordSticker(sticker));
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