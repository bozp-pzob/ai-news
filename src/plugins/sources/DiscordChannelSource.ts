// src/plugins/sources/DiscordSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem, AiProvider } from "../../types";
import { Client, GatewayIntentBits, TextChannel, ChannelType } from "discord.js";
import * as fs from 'fs';
import * as path from 'path';
import { StoragePlugin } from "../storage/StoragePlugin";

/**
 * Configuration interface for DiscordChannelSource.
 * Defines the required parameters for initializing a Discord channel source.
 */
interface DiscordChannelSourceConfig {
  name: string;           // Name identifier for this source
  botToken: string;       // Discord bot authentication token
  channelIds: string[];   // Array of Discord channel IDs to monitor
  storage: StoragePlugin; // Storage to store message fetching information
  provider: AiProvider | undefined;  // Optional AI provider for content processing
}

/**
 * DiscordChannelSource class implements content fetching from Discord channels.
 * This source monitors specified Discord channels and generates summaries of conversations
 * using an AI provider. It maintains state to track processed messages and supports
 * both real-time and historical data fetching.
 */
export class DiscordChannelSource implements ContentSource {
  public name: string;
  public provider: AiProvider | undefined;
  public storage: StoragePlugin;
  private botToken: string = '';
  private channelIds: string[];
  private client: Client;

  /**
   * Creates a new instance of DiscordChannelSource.
   * @param config - Configuration object containing bot token, channel IDs, and AI provider
   */
  constructor(config: DiscordChannelSourceConfig) {
    this.name = config.name;
    this.provider = config.provider;
    this.storage = config.storage;
    this.botToken = config.botToken;
    this.channelIds = config.channelIds;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });
  }

  /**
   * Fetches and processes new messages from configured Discord channels.
   * Retrieves messages after the last processed message ID and generates summaries
   * using the configured AI provider.
   * @returns Promise<ContentItem[]> Array of processed content items
   */
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
      const cursorKey = `${this.name}-${channelId}`;
      const lastProcessedId = await this.storage.getCursor(cursorKey);

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
          source: `${(channel as TextChannel).guild.name} - ${textChannel.name}`,
          text: summary,
          link: `https://discord.com/channels/${(channel as TextChannel).guild.id}/${channelId}`,
          date: Math.floor(new Date().getTime() / 1000),
          metadata: {
            channelId: channelId,
            guildId: (channel as TextChannel).guild.id,
            guildName: (channel as TextChannel).guild.name,
            channelName: textChannel.name,
            summaryDate: Math.floor(new Date().getTime() / 1000),
          },
        });
  
        const lastMessage = sortedMessages.last();
        if (lastMessage) {
          const lastFetchedMessageId = lastMessage.id;
          this.storage.setCursor(cursorKey, lastFetchedMessageId);
        }
      }
    }
    
    return discordResponse
  }

  /**
   * Fetches historical messages from configured Discord channels up to a specified date.
   * Useful for backfilling data or generating historical summaries.
   * @param date - ISO date string indicating the cutoff date for historical data
   * @returns Promise<ContentItem[]> Array of processed historical content items
   */
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
          source: `${textChannel.guild.name} - ${textChannel.name}`,
          text: summary,
          link: `https://discord.com/channels/${textChannel.guild.id}/${channelId}`,
          date: Math.floor(cutoffTimestamp / 1000),
          metadata: {
            channelId: channelId,
            guildId: textChannel.guild.id,
            guildName: textChannel.guild.name,
            channelName: textChannel.name,
            summaryDate: Math.floor(cutoffTimestamp / 1000),
            historicalSince: date,
          },
        });
      }
    }
    return discordResponse;
  }

  /**
   * Formats a structured prompt for the AI provider based on the chat transcript.
   * Creates a detailed prompt that guides the AI in generating comprehensive summaries.
   * @param transcript - Raw chat transcript to be analyzed
   * @returns string Formatted prompt for AI processing
   * @private
   */
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