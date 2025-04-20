import { Client, TextChannel, Message, GuildMember, User, MessageType, MessageReaction, Collection, GatewayIntentBits } from 'discord.js';
import { ContentSource } from './ContentSource';
import { ContentItem } from '../../types';

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

  constructor(config: DiscordRawDataSourceConfig) {
    this.name = config.name;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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
        console.warn(`Operation failed, retrying in ${RETRY_DELAY}ms...`, error);
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
      const promises = batch.map(([id, user]) => 
        this.fetchUserData(members.get(id) || null, user)
          .then(data => [id, data] as [string, DiscordRawData['users'][string]])
      );
      
      const results = await Promise.all(promises);
      results.forEach(([id, data]) => userData.set(id, data));
    }
    
    return userData;
  }

  private async processMessageBatch(messages: Collection<string, Message<true>>, users: Map<string, DiscordRawData['users'][string]>): Promise<DiscordRawData['messages']> {
    const processedMessages: DiscordRawData['messages'] = [];
    const members = new Map<string, GuildMember | null>();
    const newUsers = new Map<string, User>();
    
    // First pass: collect all users and members
    for (const message of messages.values()) {
      if (!message.content.trim() && !message.attachments.size) continue;
      
      if (!users.has(message.author.id)) {
        newUsers.set(message.author.id, message.author);
        members.set(message.author.id, message.member);
      }
      
      for (const [id, user] of message.mentions.users) {
        if (!users.has(id) && !newUsers.has(id)) {
          newUsers.set(id, user);
          members.set(id, message.guild?.members.cache.get(id) || null);
        }
      }
    }
    
    // Fetch user data in parallel if needed
    if (newUsers.size > 0) {
      const newUserData = await this.fetchUserDataBatch(members, newUsers);
      newUserData.forEach((data, id) => users.set(id, data));
    }
    
    // Second pass: process messages
    for (const message of messages.values()) {
      if (!message.content.trim() && !message.attachments.size) continue;
      
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
        mentions: message.mentions.users.map(user => user.id),
        ref: message.reference?.messageId,
        edited: message.editedAt?.toISOString(),
        reactions: reactions.length > 0 ? reactions : undefined
      });
    }
    
    return processedMessages;
  }

  private async fetchChannelMessages(channel: TextChannel, after?: Date): Promise<DiscordRawData> {
    console.log(`\nProcessing channel: ${channel.name} (${channel.id})`);
    const users = new Map<string, DiscordRawData['users'][string]>();
    const messages: DiscordRawData['messages'] = [];
    let hasMoreMessages = true;
    let lastMessageCount = 0;
    let noNewMessagesCount = 0;
    
    let lastMessageId: string | undefined;
    
    while (hasMoreMessages) {
      try {
        const options = { 
          limit: BATCH_SIZE,
          ...(lastMessageId && { before: lastMessageId })
        };

        const fetchedMessages = await this.retryOperation(() => channel.messages.fetch(options));
        
        if (fetchedMessages.size === 0) {
          console.log('\nNo more messages to fetch.');
          hasMoreMessages = false;
          break;
        }

        // Check if we've reached messages before our target date
        const oldestMessage = Array.from(fetchedMessages.values()).pop();
        if (oldestMessage && after && oldestMessage.createdAt < after) {
          console.log('\nReached messages before target date, stopping...');
          hasMoreMessages = false;
          break;
        }
        
        // Check if we're still getting new messages
        if (messages.length === lastMessageCount) {
          noNewMessagesCount++;
          if (noNewMessagesCount >= 3) {
            console.log('\nNo new messages found in last 3 batches, stopping...');
            hasMoreMessages = false;
            break;
          }
        } else {
          noNewMessagesCount = 0;
        }
        
        lastMessageCount = messages.length;

        await this.sleep(API_RATE_LIMIT_DELAY); // Rate limiting

        // Process messages in batches
        const processedBatch = await this.processMessageBatch(fetchedMessages, users);
        messages.push(...processedBatch);

        // Calculate progress based on message count and time
        const progress = Math.min(100, (messages.length / 20000) * 100); // Assume max ~20k messages per day
        const progressBar = createProgressBar(progress, 100);
        const timeElapsed = new Date().toLocaleTimeString();
        process.stdout.write(`\r${progressBar} | Messages: ${formatNumber(messages.length)} | Users: ${formatNumber(users.size)} | Time: ${timeElapsed}`);

        const lastMessage = Array.from(fetchedMessages.values()).pop();
        if (!lastMessage) break;
        lastMessageId = lastMessage.id;

      } catch (error) {
        console.error(`\nError fetching messages for channel ${channel.name}:`, error);
        break;
      }
    }

    // Clear the progress line and show final stats
    process.stdout.write('\n');
    console.log(`\nFinished processing channel ${channel.name}:`);
    console.log(`- Total messages processed: ${formatNumber(messages.length)}`);
    console.log(`- Total users processed: ${formatNumber(users.size)}`);

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        topic: channel.topic,
        category: channel.parent?.name || null
      },
      date: new Date().toISOString(),
      users: Object.fromEntries(users),
      messages: messages.reverse() // Return in chronological order
    };
  }

  async fetchItems(): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      console.log('Logging in to Discord...');
      await this.client.login(this.botToken);
      console.log('Successfully logged in to Discord');
    }

    const items: ContentItem[] = [];
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 1); // Last hour's data

    console.log(`\nProcessing ${this.channelIds.length} channels for the last hour...`);
    for (const channelId of this.channelIds) {
      try {
        console.log(`\nFetching channel ${channelId}...`);
        const channel = await this.retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
        if (!channel || channel.type !== 0) {
          console.log(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        const rawData = await this.fetchChannelMessages(channel, cutoff);
        
        items.push({
          cid: `discord-raw-${channel.id}-${Date.now()}`,
          type: 'discord-raw',
          source: 'discord',
          title: `Raw Discord Data: ${channel.name}`,
          text: JSON.stringify(rawData),
          link: `https://discord.com/channels/${channel.guild.id}/${channel.id}`,
          date: Date.now(),
          metadata: {
            channelId: channel.id,
            guildId: channel.guild.id,
            messageCount: rawData.messages.length,
            userCount: Object.keys(rawData.users).length
          }
        });
        console.log(`Successfully processed channel ${channel.name}`);
      } catch (error) {
        console.error(`Error processing channel ${channelId}:`, error);
        // Continue with next channel
      }
    }

    console.log(`\nFinished processing all channels. Total items: ${items.length}`);
    return items;
  }

  async fetchHistorical(date: string): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      console.log('Logging in to Discord...');
      await this.client.login(this.botToken);
      console.log('Successfully logged in to Discord');
    }

    const items: ContentItem[] = [];
    const targetDate = new Date(date);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    console.log(`\nProcessing ${this.channelIds.length} channels for date: ${date}`);
    
    for (const [channelIndex, channelId] of this.channelIds.entries()) {
      try {
        const progressBar = createProgressBar(channelIndex + 1, this.channelIds.length);
        console.log(`\n${progressBar} | Channel ${channelIndex + 1}/${this.channelIds.length}`);
        
        const channel = await this.retryOperation(() => this.client.channels.fetch(channelId)) as TextChannel;
        if (!channel || channel.type !== 0) {
          console.log(`Channel ${channelId} is not a text channel or does not exist.`);
          continue;
        }

        const rawData = await this.fetchChannelMessages(channel, targetDate);
        
        // Filter messages to only include those from the target date
        const originalCount = rawData.messages.length;
        rawData.messages = rawData.messages.filter(msg => {
          const msgDate = new Date(msg.ts);
          return msgDate >= targetDate && msgDate < nextDate;
        });
        console.log(`Filtered messages from ${formatNumber(originalCount)} to ${formatNumber(rawData.messages.length)} for date ${date}`);

        // Create time blocks based on message activity
        const timeBlocks = createTimeBlocks(rawData.messages, rawData.users, targetDate);
        console.log(`Created ${timeBlocks.length} time blocks based on message activity`);

        // Create a content item for each time block
        for (const [index, block] of timeBlocks.entries()) {
          const blockStart = formatTimeForFilename(block.startTime);
          const channelName = channel.name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
          
          items.push({
            cid: `${channel.id}_${date}`,
            type: 'discord-raw',
            source: 'discord',
            title: `Discord Data: ${channel.name} (${block.startTime.toLocaleString()} to ${block.endTime.toLocaleString()})`,
            text: JSON.stringify({
              ...rawData,
              messages: block.messages,
              users: block.users,
              timeBlock: {
                start: block.startTime.toISOString(),
                end: block.endTime.toISOString(),
                messageCount: block.messages.length,
                userCount: Object.keys(block.users).length
              }
            }),
            link: `https://discord.com/channels/${channel.guild.id}/${channel.id}`,
            date: block.startTime.getTime(),
            metadata: {
              channelId: channel.id,
              guildId: channel.guild.id,
              messageCount: block.messages.length,
              userCount: Object.keys(block.users).length,
              dateProcessed: date,
              timeBlock: {
                start: block.startTime.toISOString(),
                end: block.endTime.toISOString(),
                index
              }
            }
          });
        }
        
        console.log(`Successfully processed historical data for channel ${channel.name}`);
      } catch (error) {
        console.error(`Error processing historical data for channel ${channelId}:`, error);
        // Continue with next channel
      }
    }

    console.log(`\nFinished processing all channels for date ${date}:`);
    console.log(`- Total items processed: ${formatNumber(items.length)}`);
    return items;
  }
} 