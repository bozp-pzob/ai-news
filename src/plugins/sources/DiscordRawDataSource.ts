/**
 * @fileoverview Implementation of a content source for fetching raw Discord data
 * Handles detailed message retrieval, user data caching, and media content processing
 */

import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits, ChannelType, GuildBasedChannel, Guild } from 'discord.js';
import { ContentSource } from './ContentSource';
import { ContentItem } from '../../types';

/**
 * Console color codes for formatted logging output
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

/**
 * Logger utility for consistent console output formatting
 */
const logger = {
  info: (message: string) => console.log(`${colors.cyan}[INFO]${colors.reset} ${message}`),
  success: (message: string) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`),
  warning: (message: string) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`),
  error: (message: string) => console.error(`${colors.red}[ERROR]${colors.reset} ${message}`),
  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.log(`${colors.dim}[DEBUG]${colors.reset} ${message}`);
    }
  },
  channel: (message: string) => console.log(`${colors.magenta}[CHANNEL]${colors.reset} ${message}`),
  progress: (message: string) => {
    process.stdout.write(`\r${colors.blue}[PROGRESS]${colors.reset} ${message}`);
  },
  clearLine: () => {
    process.stdout.write('\r\x1b[K');
  }
};

/**
 * Interface for Discord raw data structure
 * @interface DiscordRawData
 */
interface DiscordRawData {
  channel: {
    id: string;
    name: string;
    topic: string | null;
    category: string | null;
  };
  date: string;
  users: {
    [userId: string]: {
      name: string;
      nickname: string | null;
      roles?: string[];
      isBot?: boolean;
    };
  };
  messages: {
    id: string;
    ts: string;
    uid: string;
    content: string;
    type?: string;
    mentions?: string[];
    ref?: string;
    edited?: string;
    reactions?: {
      emoji: string;
      count: number;
    }[];
  }[];
}

/**
 * Configuration interface for DiscordRawDataSource
 * @interface DiscordRawDataSourceConfig
 * @property {string} name - The name identifier for this Discord source
 * @property {string} botToken - Discord bot token for authentication
 * @property {string[]} channelIds - Array of Discord channel IDs to monitor
 * @property {string} guildId - Discord guild/server ID
 */
interface DiscordRawDataSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
  guildId: string;
}

// Constants for data processing
const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const API_RATE_LIMIT_DELAY = 50;
const PARALLEL_USER_FETCHES = 10;
const BLOCK_SIZE = 1000;

/**
 * Interface for time-based message blocks
 * @interface TimeBlock
 */
interface TimeBlock {
  startTime: Date;
  endTime: Date;
  messages: DiscordRawData['messages'];
  users: DiscordRawData['users'];
}

/**
 * Formats a date for use in filenames
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatTimeForFilename(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).replace(/[/:]/g, '').replace(/,/g, '').replace(/\s/g, '');
}

/**
 * Creates a visual progress bar
 * @param {number} current - Current progress value
 * @param {number} total - Total progress value
 * @param {number} [width=30] - Width of the progress bar in characters
 * @returns {string} Formatted progress bar string
 */
function createProgressBar(current: number, total: number, width: number = 30): string {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  const filledWidth = Math.round((width * current) / total);
  const bar = '█'.repeat(filledWidth) + '░'.repeat(width - filledWidth);
  return `[${bar}] ${percentage.toFixed(1)}%`;
}

/**
 * Formats a number with thousands separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Creates time-based blocks of messages for efficient processing
 * @param {DiscordRawData['messages']} messages - Array of messages to group
 * @param {DiscordRawData['users']} users - User data for the messages
 * @param {Date} date - Target date for the blocks
 * @returns {TimeBlock[]} Array of time blocks containing messages and user data
 */
function createTimeBlocks(messages: DiscordRawData['messages'], users: DiscordRawData['users'], date: Date): TimeBlock[] {
  if (messages.length === 0) return [];

  const sortedMessages = [...messages].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const blocks: TimeBlock[] = [];
  let currentBlock: TimeBlock = {
    startTime: new Date(sortedMessages[0].ts),
    endTime: new Date(sortedMessages[0].ts),
    messages: [],
    users: {}
  };

  for (const message of sortedMessages) {
    const messageTime = new Date(message.ts);
    
    if (currentBlock.messages.length >= BLOCK_SIZE) {
      currentBlock.endTime = new Date(message.ts);
      blocks.push(currentBlock);
      currentBlock = {
        startTime: new Date(message.ts),
        endTime: new Date(message.ts),
        messages: [],
        users: {}
      };
    }

    currentBlock.messages.push(message);
    if (message.uid in users) {
      currentBlock.users[message.uid] = users[message.uid];
    }
    message.mentions?.forEach(uid => {
      if (uid in users && !(uid in currentBlock.users)) {
        currentBlock.users[uid] = users[uid];
      }
    });
  }

  if (currentBlock.messages.length > 0) {
    currentBlock.endTime = new Date(sortedMessages[sortedMessages.length - 1].ts);
    blocks.push(currentBlock);
  }

  return blocks;
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
        logger.error('Bot requires privileged intents. Please enable them in the Discord Developer Portal:');
        logger.error('1. Go to https://discord.com/developers/applications');
        logger.error('2. Select your bot application');
        logger.error('3. Go to "Bot" section');
        logger.error('4. Enable "Server Members Intent" under "Privileged Gateway Intents"');
        process.exit(1);
      }
    });
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async retryOperation<T>(operation: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        const err = error as Error;
        if (err.message.includes('rate limit') || err.message.includes('429')) {
          logger.warning(`Rate limit hit, waiting longer before retry...`);
          await this.sleep(RETRY_DELAY * Math.pow(2, i));
        } else if (i === retries - 1) {
          throw error;
        } else {
          logger.warning(`Operation failed, retrying in ${RETRY_DELAY}ms... ${err.message}`);
          await this.sleep(RETRY_DELAY);
        }
      }
    }
    throw new Error('Operation failed after max retries');
  }

  private async fetchMembers(guild: Guild): Promise<Map<string, GuildMember>> {
    logger.info(`Fetching members for guild: ${guild.name}`);
    const members = new Map<string, GuildMember>();
    
    try {
      const fetchedMembers = await guild.members.fetch({ limit: 1000 });
      fetchedMembers.forEach(member => {
        members.set(member.id, member);
      });
      logger.success(`Cached ${members.size} members for guild: ${guild.name}`);
    } catch (error) {
      logger.error(`Failed to fetch members for guild ${guild.name}: ${error}`);
    }
    
    return members;
  }

  private async fetchUserData(member: GuildMember | null, user: User): Promise<DiscordRawData['users'][string]> {
    return await this.retryOperation(async () => {
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
        await this.sleep(API_RATE_LIMIT_DELAY);
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
      const recentMessages = await this.retryOperation(() => channel.messages.fetch({ limit: 1 }));
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
          const fetchedMessages = await this.retryOperation(() => channel.messages.fetch(options));
          
          if (fetchedMessages.size === 0) {
            logger.info(`No more messages found in channel ${channel.name}`);
            hasMoreMessages = false;
            break;
          }

          const filteredMessages = fetchedMessages.filter(msg => {
            const msgDate = msg.createdAt;
            return msgDate >= startOfDay && msgDate <= endOfDay;
          });

          if (filteredMessages.size > 0) {
            const processedBatch = await this.processMessageBatch(filteredMessages, channel, users) as DiscordRawData['messages'];
            messages.push(...processedBatch);
          }

          const oldestMessage = Array.from(fetchedMessages.values()).pop();
          if (oldestMessage && oldestMessage.createdAt < startOfDay) {
            hasMoreMessages = false;
            break;
          }

          currentMessageId = oldestMessage?.id || '';
          if (!currentMessageId) {
            hasMoreMessages = false;
            break;
          }

          await this.sleep(API_RATE_LIMIT_DELAY);
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
        const channel = await this.retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
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
        const channel = await this.retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
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

  private async fetchData(startTime: number, endTime: number): Promise<ContentItem[]> {
    const data: {
      channel: {
        id: string;
        name: string;
        guildId: string;
        guildName: string;
      };
      messages: Message<true>[];
    }[] = [];

    if (!this.client.isReady()) {
      await this.client.login(this.botToken);
    }

    const guild = await this.client.guilds.fetch(this.guildId);
    if (!guild) return [];
    
    const channels = await guild.channels.fetch();
    if (!channels) return [];

    const textChannels = channels.filter((channel): channel is TextChannel => 
      channel?.type === ChannelType.GuildText
    );

    for (const channel of textChannels.values()) {
      try {
        const messages = await this.fetchMessagesInTimeRange(channel, startTime, endTime);
        if (messages.size > 0) {
          data.push({
            channel: {
              id: channel.id,
              name: channel.name,
              guildId: channel.guildId,
              guildName: channel.guild.name
            },
            messages: Array.from(messages.values())
          });
        }
      } catch (error) {
        console.error(`Error fetching messages from channel ${channel.name}:`, error);
      }
    }

    return this.convertToContentItems(data);
  }

  private async preWarmMemberCache(): Promise<void> {
    logger.info('Pre-warming member cache...');
    const guilds = this.client.guilds.cache;
    
    for (const [guildId, guild] of guilds) {
      try {
        logger.info(`Fetching members for guild: ${guild.name}`);
        try {
          await guild.members.fetch();
          logger.success(`Successfully cached members for guild: ${guild.name}`);
        } catch (error) {
          if (error instanceof Error && error.message.includes('disallowed intents')) {
            logger.warning(`Cannot fetch members for guild ${guild.name} - privileged intents not enabled`);
          } else {
            throw error;
          }
        }
        await this.sleep(API_RATE_LIMIT_DELAY);
      } catch (error) {
        logger.error(`Failed to fetch members for guild ${guild.name}: ${error}`);
      }
    }
  }

  private async fetchMessagesInTimeRange(channel: TextChannel, startTime: number, endTime: number): Promise<Collection<string, Message<true>>> {
    const messages = new Collection<string, Message<true>>();
    let lastId: string | undefined;

    while (true) {
      const options: { limit: number; before?: string } = { limit: 100 };
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options);
      if (batch.size === 0) break;

      for (const message of batch.values()) {
        const messageTime = message.createdTimestamp;
        if (messageTime < startTime) return messages;
        if (messageTime <= endTime) {
          messages.set(message.id, message);
        }
      }

      lastId = batch.last()?.id;
    }

    return messages;
  }

  private isMediaFile(url: string, contentType?: string | null): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExtensions = ['.mp4', '.webm', '.mov'];
    const mediaExtensions = [...imageExtensions, ...videoExtensions];

    if (contentType) {
      return contentType.startsWith('image/') || contentType.startsWith('video/');
    }

    return mediaExtensions.some(ext => url.toLowerCase().endsWith(ext));
  }

  private extractMediaUrls(message: Message<true>): string[] {
    const mediaUrls: string[] = [];
    
    message.attachments.forEach(attachment => {
      if (this.isMediaFile(attachment.url, attachment.contentType)) {
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
      if (this.isMediaFile(url)) {
        mediaUrls.push(url);
      }
    });
    
    return [...new Set(mediaUrls)];
  }

  private convertToContentItems(data: {
    channel: {
      id: string;
      name: string;
      guildId: string;
      guildName: string;
    };
    messages: Message<true>[];
  }[]): ContentItem[] {
    return data.flatMap(channelData => 
      channelData.messages.map(message => ({
        cid: message.id,
        type: 'discord-message',
        source: `${channelData.channel.guildName} - ${channelData.channel.name}`,
        text: message.content,
        link: `https://discord.com/channels/${channelData.channel.guildId}/${channelData.channel.id}/${message.id}`,
        date: message.createdTimestamp,
        metadata: {
          attachments: Array.from(message.attachments.values()).map(att => ({
            url: att.url,
            type: att.contentType || 'unknown'
          })),
          embeds: message.embeds.map(embed => ({
            type: embed.data.type || 'rich',
            url: embed.url || null,
            title: embed.title || null,
            description: embed.description || null
          }))
        }
      }))
    );
  }
}