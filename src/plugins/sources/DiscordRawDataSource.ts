import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits, ChannelType, GuildBasedChannel } from 'discord.js';
import { ContentSource } from './ContentSource';
import { ContentItem } from '../../types';

// Add color coding for console output
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

// Logger utility
const logger = {
  info: (message: string) => console.log(`${colors.cyan}[INFO]${colors.reset} ${message}`),
  success: (message: string) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`),
  warning: (message: string) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`),
  error: (message: string) => console.error(`${colors.red}[ERROR]${colors.reset} ${message}`),
  debug: (message: string) => {
    // Only show debug messages if DEBUG environment variable is set
    if (process.env.DEBUG) {
      console.log(`${colors.dim}[DEBUG]${colors.reset} ${message}`);
    }
  },
  channel: (message: string) => console.log(`${colors.magenta}[CHANNEL]${colors.reset} ${message}`),
  progress: (message: string) => {
    // Clear the current line and write the progress message
    process.stdout.write(`\r${colors.blue}[PROGRESS]${colors.reset} ${message}`);
  },
  clearLine: () => {
    process.stdout.write('\r\x1b[K');
  }
};

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

interface DiscordRawDataSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
  guildId: string;
}

const BATCH_SIZE = 100; // Increased batch size
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const API_RATE_LIMIT_DELAY = 50; // Reduced to 50ms between API calls
const PARALLEL_USER_FETCHES = 10; // Number of user fetches to run in parallel

// Time block configuration
const BLOCK_SIZE = 1000; // Messages per time block

interface TimeBlock {
  startTime: Date;
  endTime: Date;
  messages: DiscordRawData['messages'];
  users: DiscordRawData['users'];
}

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

function createProgressBar(current: number, total: number, width: number = 30): string {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  const filledWidth = Math.round((width * current) / total);
  const bar = '█'.repeat(filledWidth) + '░'.repeat(width - filledWidth);
  return `[${bar}] ${percentage.toFixed(1)}%`;
}

function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function createTimeBlocks(messages: DiscordRawData['messages'], users: DiscordRawData['users'], date: Date): TimeBlock[] {
  if (messages.length === 0) return [];

  // Sort messages by timestamp
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
    
    // If adding this message would exceed block size, create a new block
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
    // Copy relevant user data
    if (message.uid in users) {
      currentBlock.users[message.uid] = users[message.uid];
    }
    message.mentions?.forEach(uid => {
      if (uid in users && !(uid in currentBlock.users)) {
        currentBlock.users[uid] = users[uid];
      }
    });
  }

  // Add the last block if it has messages
  if (currentBlock.messages.length > 0) {
    currentBlock.endTime = new Date(sortedMessages[sortedMessages.length - 1].ts);
    blocks.push(currentBlock);
  }

  return blocks;
}

export class DiscordRawDataSource implements ContentSource {
  public name: string;
  private client: Client;
  private channelIds: string[];
  private botToken: string;
  private guildId: string;

  constructor(config: DiscordRawDataSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.guildId = config.guildId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    // Add error handler for privileged intents
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
        if (i === retries - 1) throw error;
        logger.warning(`Operation failed, retrying in ${RETRY_DELAY}ms... ${error}`);
        await this.sleep(RETRY_DELAY);
      }
    }
    throw new Error('Operation failed after max retries');
  }

  private async fetchUserData(member: GuildMember | null, user: User): Promise<DiscordRawData['users'][string]> {
    return await this.retryOperation(async () => ({
      name: user.username,
      nickname: member?.nickname || null,
      roles: member?.roles.cache.map(role => role.name) || undefined,
      isBot: user.bot || undefined
    }));
  }

  private async fetchUserDataBatch(members: Map<string, GuildMember | null>, users: Map<string, User>): Promise<Map<string, DiscordRawData['users'][string]>> {
    const userData = new Map<string, DiscordRawData['users'][string]>();
    const entries = Array.from(users.entries());
    
    // Process users in parallel batches
    for (let i = 0; i < entries.length; i += PARALLEL_USER_FETCHES) {
      const batch = entries.slice(i, i + PARALLEL_USER_FETCHES);
      const promises = batch.map(async ([id, user]) => {
        let member = members.get(id);
        
        // If member is not in cache, try to fetch it from available guilds
        if (!member) {
          for (const guild of this.client.guilds.cache.values()) {
            try {
              member = await guild.members.fetch(id).catch(() => null);
              if (member) {
                break;
              }
            } catch (error) {
              if (error instanceof Error && !error.message.includes('disallowed intents')) {
                logger.warning(`Error fetching member ${user.username}: ${error.message}`);
              }
            }
          }
        }
        
        // Only fetch member data if we have a valid member
        if (member) {
          return [id, await this.fetchUserData(member, user)] as [string, DiscordRawData['users'][string]];
        } else {
          // For users without member data, just return basic info
          return [id, {
            name: user.username,
            nickname: null,
            isBot: user.bot || undefined
          }] as [string, DiscordRawData['users'][string]];
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(([id, data]) => userData.set(id, data));
    }
    
    return userData;
  }

  private async processMessageBatch(
    messages: Collection<string, Message<true>>,
    channel: TextChannel,
    users?: Map<string, DiscordRawData['users'][string]>
  ): Promise<DiscordRawData['messages'] | Message<true>[]> {
    if (!users) {
      // Handle the simple case where we just need to filter media messages
      const processedMessages: Message<true>[] = [];
      
      for (const message of messages.values()) {
        const mediaUrls = this.extractMediaUrls(message);
        if (mediaUrls.length > 0 || message.content.trim().length > 0) {
          processedMessages.push(message);
        }
      }
      
      return processedMessages;
    }

    // Handle the full processing case with user data
    const processedMessages: DiscordRawData['messages'] = [];
    const missingMembers = new Map<string, User>();
    const existingMembers = new Map<string, GuildMember | null>();

    for (const message of messages.values()) {
      const author = message.author;
      if (!users.has(author.id)) {
        const member = await this.retryOperation(() => message.guild?.members.fetch(author.id).catch(() => null));
        existingMembers.set(author.id, member);
        missingMembers.set(author.id, author);
      }

      const reactions = message.reactions.cache.map(reaction => ({
        emoji: reaction.emoji.toString(),
        count: reaction.count || 0
      }));

      processedMessages.push({
        id: message.id,
        ts: message.createdAt.toISOString(),
        uid: author.id,
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
    
    // Calculate the time range for the target date
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Get the most recent message ID as our starting point
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

      // Fetch messages in batches until we reach messages before our target date
      let currentMessageId = lastMessageId;
      let hasMoreMessages = true;

      while (hasMoreMessages) {
        const options = { 
          limit: 100,
          before: currentMessageId
        };

        const fetchedMessages = await this.retryOperation(() => channel.messages.fetch(options));
        
        if (fetchedMessages.size === 0) {
          hasMoreMessages = false;
          break;
        }

        // Filter messages to only include those from our target date
        const filteredMessages = fetchedMessages.filter(msg => {
          const msgDate = msg.createdAt;
          return msgDate >= startOfDay && msgDate <= endOfDay;
        });

        if (filteredMessages.size > 0) {
          // Process messages and collect user data
          const processedBatch = await this.processMessageBatch(filteredMessages, channel, users) as DiscordRawData['messages'];
          messages.push(...processedBatch);
        }

        // Check if we've reached messages before our target date
        const oldestMessage = Array.from(fetchedMessages.values()).pop();
        if (oldestMessage && oldestMessage.createdAt < startOfDay) {
          hasMoreMessages = false;
          break;
        }

        // Update the current message ID for the next batch
        currentMessageId = oldestMessage?.id || '';
        if (!currentMessageId) {
          hasMoreMessages = false;
          break;
        }

        // Add a small delay to avoid rate limits
        await this.sleep(API_RATE_LIMIT_DELAY);
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
      messages: messages.reverse() // Return in chronological order
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
    cutoff.setHours(cutoff.getHours() - 1); // Last hour's data

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
        
        // Generate a unique timestamp for this export
        const timestamp = Date.now();
        const formattedDate = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
        
        // Get the guild name for the source
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
        // Continue with next channel
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
        
        // Get the guild name for the source
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

    // Fetch all channels from the specified guild
    const guild = await this.client.guilds.fetch(this.guildId);
    if (!guild) return [];
    
    const channels = await guild.channels.fetch();
    if (!channels) return [];

    // Filter text channels
    const textChannels = channels.filter((channel): channel is TextChannel => 
      channel?.type === ChannelType.GuildText
    );

    // Process each channel
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

    // Convert the data to ContentItems
    return this.convertToContentItems(data);
  }

  private async preWarmMemberCache(): Promise<void> {
    logger.info('Pre-warming member cache...');
    const guilds = this.client.guilds.cache;
    
    for (const [guildId, guild] of guilds) {
      try {
        logger.info(`Fetching members for guild: ${guild.name}`);
        // Try to fetch members without using privileged intents
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

    // Check content type if available
    if (contentType) {
      return contentType.startsWith('image/') || contentType.startsWith('video/');
    }

    // Check file extension
    return mediaExtensions.some(ext => url.toLowerCase().endsWith(ext));
  }

  private extractMediaUrls(message: Message<true>): string[] {
    const mediaUrls: string[] = [];
    
    // Process attachments
    message.attachments.forEach(attachment => {
      if (this.isMediaFile(attachment.url, attachment.contentType)) {
        mediaUrls.push(attachment.url);
      }
    });
    
    // Process embeds
    message.embeds.forEach(embed => {
      if (embed.image) mediaUrls.push(embed.image.url);
      if (embed.thumbnail) mediaUrls.push(embed.thumbnail.url);
      if (embed.video) mediaUrls.push(embed.video.url);
    });
    
    // Extract URLs from content
    const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
    const contentUrls = message.content.match(urlRegex) || [];
    contentUrls.forEach(url => {
      if (this.isMediaFile(url)) {
        mediaUrls.push(url);
      }
    });
    
    return [...new Set(mediaUrls)]; // Remove duplicates
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