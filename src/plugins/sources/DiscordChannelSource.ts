// src/plugins/sources/DiscordSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem, AiProvider } from "../../types";
import { Client, GatewayIntentBits, TextChannel, ChannelType } from "discord.js";
import * as fs from 'fs';
import * as path from 'path';

interface DiscordChannelSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
  provider: AiProvider | undefined;
}

interface LastProcessedState {
  [channelId: string]: string;
}

export class DiscordChannelSource implements ContentSource {
  public name: string;
  public provider: AiProvider | undefined;
  private botToken: string = '';
  private channelIds: string[];
  private client: Client;
  private stateFilePath: string;
  private lastProcessed: LastProcessedState;

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
        description: 'Array of Discord channel IDs to monitor'
      },
      {
        name: 'provider',
        type: 'AiProvider',
        required: false,
        description: 'Optional AI provider for content processing'
      }
    ]
  };

  constructor(config: DiscordChannelSourceConfig) {
    this.name = config.name;
    this.provider = config.provider;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });
    
    this.stateFilePath = path.resolve(__dirname, '../../../data/lastProcessed.json');

    this.lastProcessed = this.loadState();
  }

  public async fetchItems(): Promise<ContentItem[]> {
    if (!this.client.isReady()) {
      await this.client.login(this.botToken);
    }

    let discordResponse : any[] = [];

    for (const channelId of this.channelIds) {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`Channel ID ${channelId} is not a text channel or does not exist.`);
        continue;
      }

      const textChannel = channel as TextChannel;

      const fetchOptions: { limit: number; after?: string } = { limit: 100 };
      const lastProcessedId = this.lastProcessed[channelId];

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

      const prompt = this.formatStructuredPrompt(transcript);

      if ( this.provider ) {
        const summary = await this.provider.summarize(prompt);
  
        discordResponse.push({
          type: "discordChannelSummary",
          cid: `${channelId}-${lastProcessedId}`,
          source: this.name,
          text: summary,
          link: `https://discord.com/channels/${(channel as TextChannel).guild.id}/${channelId}`,
          date: Math.floor(new Date().getTime() / 1000),
          metadata: {
            channelId: channelId,
            guildId: (channel as TextChannel).guild.id,
            summaryDate: Math.floor(new Date().getTime() / 1000),
          },
        });
  
        const lastMessage = sortedMessages.first();
        if (lastMessage) {
          this.lastProcessed[channelId] = lastMessage.id;
          this.saveState();
        }
      }
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

      const prompt = this.formatStructuredPrompt(transcript);

      if (this.provider) {
        const summary = await this.provider.summarize(prompt);
        discordResponse.push({
          type: "discordChannelHistoricalSummary",
          cid: `${channelId}-historical-${date}`,
          source: this.name,
          text: summary,
          link: `https://discord.com/channels/${textChannel.guild.id}/${channelId}`,
          date: Math.floor(cutoffTimestamp / 1000),
          metadata: {
            channelId: channelId,
            guildId: textChannel.guild.id,
            summaryDate: Math.floor(cutoffTimestamp / 1000),
            historicalSince: date,
          },
        });
      }
    }
    return discordResponse;
  }

  // Load the last processed message IDs from the JSON file
  private loadState(): LastProcessedState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8');
        return JSON.parse(data);
      } else {
        return {};
      }
    } catch (error) {
      console.error('Error loading state file:', error);
      return {};
    }
  }

  // Save the last processed message IDs to the JSON file
  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.lastProcessed, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving state file:', error);
    }
  }

  private formatStructuredPrompt(transcript: string): string {
    return `Analyze this Discord chat segment and provide a succinct analysis:
            
1. Summary (max 500 words):
- Focus ONLY on the most important technical discussions, decisions, and problem-solving
- Highlight concrete solutions and implementations
- Be specific and VERY concise

2. FAQ (max 20 questions):
- Only include the most significant questions that got meaningful responses
- Focus on unique questions, skip similar or rhetorical questions
- Include who asked the question and who answered
- Use the exact Discord username from the chat

3. Help Interactions (max 10):
- List the significant instances where community members helped each other.
- Be specific and concise about what kind of help was given
- Include context about the problem that was solved
- Mention if the help was successful

4. Action Items (max 20 total):
- Technical Tasks: Critical development tasks only
- Documentation Needs: Essential doc updates only
- Feature Requests: Major feature suggestions only

For each action item, include:
- Clear description
- Who mentioned it

Chat transcript:
${transcript}

Return the analysis in the specified structured format. Be specific about technical content and avoid duplicating information.`;
  }
}