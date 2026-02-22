import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem, DiscordSummary, ActionItems, HelpInteractions, SummaryFaqs, DiscordRawData } from "../../types";
import { writeFile } from "../../helpers/fileHelper";
import { logger } from "../../helpers/cliHelper";
import { createDiscordAnalysisPrompt, createDiscordDailySummaryPrompt, SUMMARIZE_OPTIONS } from "../../helpers/promptHelper";

export interface DiscordSummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source: string;
  outputPath?: string;
}

export class DiscordSummaryGenerator {
  private provider: OpenAIProvider;
  private storage: SQLiteStorage;
  private summaryType: string;
  private source: string;
  private outputPath: string;


  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AIProvider',
        required: true,
        description: 'AI Provider plugin for the generator to use to create the Daily Summary.'
      },
      {
        name: 'storage',
        type: 'StoragePlugin',
        required: true,
        description: 'Storage Plugin to store the generated Daily Summary.'
      },
      {
        name: 'summaryType',
        type: 'string',
        required: true,
        description: 'Type for summary to store in the database.'
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Specific source to generate the summary off.'
      },
      {
        name: 'outputPath',
        type: 'string',
        required: false,
        description: 'Location to store summary for md and json generation'
      }
    ]
  };

  /**
   * Creates a new instance of DiscordSummaryGenerator.
   * @param config - Configuration object containing provider, storage, and output settings
   */
  constructor(config: DiscordSummaryGeneratorConfig) {
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './';
  }

  /**
   * Main entry point for content generation.
   * Generates summaries for the current day's content.
   * @returns Promise<void>
   */
  public async generateContent() {
    try {
      const today = new Date();
      // Check for summary created *within* the last 24 hours, using the correct summaryType
      const checkStartTimeEpoch = Math.floor((today.getTime() - (24 * 60 * 60 * 1000)) / 1000);
      const checkEndTimeEpoch = Math.floor(today.getTime() / 1000);
      
      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch(
        checkStartTimeEpoch,
        checkEndTimeEpoch,
        this.summaryType
      );
      
      if (!summary || summary.length === 0) {
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        const dateStr = summaryDate.toISOString().slice(0, 10);
        
        logger.info(`Generating discord summary for ${dateStr}`);
        await this.generateAndStoreSummary(dateStr);
        logger.success(`Discord summary generation completed for ${dateStr}`);
      } else {
        logger.info(`Recent summary found (Count: ${summary.length}). Generation skipped.`);
      }
    } catch (error) {
      logger.error(`Error in generateContent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generates and stores a daily summary for a specific date.
   * Processes all Discord content items for the given date and generates
   * both channel-specific and consolidated daily summaries.
   * @param dateStr - ISO date string for which to generate the summary
   * @returns Promise<void>
   */
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      // Set up time range for the requested date
      const targetDate = new Date(dateStr);
      const startTimeEpoch = Math.floor(targetDate.setUTCHours(0, 0, 0, 0) / 1000);
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60);
      
      // Fetch raw content for this date
      logger.info(`Fetching Discord content for ${dateStr} between ${new Date(startTimeEpoch * 1000).toISOString()} and ${new Date(endTimeEpoch * 1000).toISOString()}`);
      const contentItems = await this.storage.getContentItemsBetweenEpoch(
        startTimeEpoch, endTimeEpoch, this.source
      );
      
      if (contentItems.length === 0) {
        logger.warning(`No Discord content found for ${dateStr}`);
        return;
      }
      
      logger.info(`Found ${contentItems.length} raw content items`);
      
      // Group by channel and process each channel
      const channelItemsMap = this.groupByChannel(contentItems);
      const allChannelSummaries: DiscordSummary[] = [];
      
      logger.info(`Processing ${Object.keys(channelItemsMap).length} channels`);
      for (const [channelId, items] of Object.entries(channelItemsMap)) {
        try {
          logger.info(`Processing channel ${channelId} with ${items.length} items`);
          const channelSummary = await this.processChannelData(items);
          
          if (channelSummary) {
            // Add channel ID to the summary for linking with stats
            allChannelSummaries.push({
              ...channelSummary,
              channelId
            });
          }
        } catch (error) {
          logger.error(`Error processing channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Generate combined summary file if we have channel summaries
      if (allChannelSummaries.length > 0) {
        await this.generateCombinedSummaryFiles(
          allChannelSummaries, 
          dateStr, 
          startTimeEpoch,
          contentItems // Pass content items for statistics
        );
      }
      
    } catch (error) {
      logger.error(`Error generating summary for ${dateStr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Groups content items by their Discord channel ID.
   * @param items - Array of content items to group
   * @returns Object mapping channel IDs to arrays of content items
   * @private
   */
  private groupByChannel(items: ContentItem[]): { [channelId: string]: ContentItem[] } {
    const channels: { [channelId: string]: ContentItem[] } = {};
    
    for (const item of items) {
      if (item.metadata?.channelId) {
        const channelId = item.metadata.channelId;
        if (!channels[channelId]) {
          channels[channelId] = [];
        }
        channels[channelId].push(item);
      }
    }

    return channels;
  }

  /**
   * Process raw data for a single channel.
   * @param items - Content items for a single channel
   * @returns Promise<DiscordSummary | null> - Channel summary or null if processing fails
   * @private
   */
  private async processChannelData(items: ContentItem[]): Promise<DiscordSummary | null> {
    if (items.length === 0) {
      logger.warning("No items received");
      return null;
    }

    // Extract channel metadata
    const channelId = items[0]?.metadata?.channelId || 'unknown-channel';
    const guildName = items[0]?.metadata?.guildName || 'Unknown Server';
    const channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
    
    // Parse and combine raw data
    const { messages, users } = this.combineRawData(items);
    
    if (messages.length === 0) {
      logger.warning(`No messages found for channel ${channelName} (${channelId})`);
      return null;
    }
    
    logger.info(`Combined data for ${channelName}: ${messages.length} messages, ${Object.keys(users).length} users`);
    
    // Get AI summary
    const structuredText = await this.getAISummary(messages, users, channelName);
    if (!structuredText) {
      logger.warning(`Failed to get AI summary for channel ${channelName}`);
      return null;
    }
    
    // Parse the structured text into sections
    return this.parseStructuredText(structuredText, channelName, guildName);
  }

  /**
   * Combine raw data from multiple content items.
   * @param items - Array of content items to process
   * @returns Object with combined messages and users
   * @private
   */
  private combineRawData(items: ContentItem[]): { 
    messages: DiscordRawData['messages'], 
    users: Record<string, DiscordRawData['users'][string]> 
  } {
    let allMessages: DiscordRawData['messages'] = [];
    let allUsers: Record<string, DiscordRawData['users'][string]> = {};
    
    for (const item of items) {
      try {
        if (item.type !== 'discordRawData' || !item.text) continue;
        
        const rawData: DiscordRawData = JSON.parse(item.text);
        
        if (rawData.messages && Array.isArray(rawData.messages)) {
          allMessages = allMessages.concat(rawData.messages);
        }
        
        if (rawData.users) {
          allUsers = { ...allUsers, ...rawData.users };
        }
      } catch (error) {
        logger.error(`Failed to parse item ${item.cid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Ensure messages are unique and sorted chronologically
    const uniqueMessages = Array.from(
      new Map(allMessages.map(m => [m.id, m])).values()
    ).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    
    return { messages: uniqueMessages, users: allUsers };
  }

  /**
   * Get AI summary for channel messages.
   * @param messages - Array of Discord messages
   * @param users - Map of user IDs to user data
   * @param channelName - Name of the channel
   * @returns Promise<string | null> - AI-generated summary or null if generation fails
   * @private
   */
  private async getAISummary(
    messages: DiscordRawData['messages'], 
    users: Record<string, DiscordRawData['users'][string]>,
    channelName: string
  ): Promise<string | null> {
    try {
      // Format messages into a transcript
      const transcript = messages.map(msg => {
        const user = users[msg.uid];
        const username = user?.nickname || user?.name || msg.uid;
        const time = new Date(msg.ts).toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
        return `[${time}] ${username}: ${msg.content}`;
      }).join('\n');
      
      logger.info(`Creating structured AI prompt for channel ${channelName} with ${messages.length} messages`);
      const prompt = createDiscordAnalysisPrompt(transcript, channelName);
      
      logger.info(`Calling AI provider for channel ${channelName} summary`);
      const response = await this.provider.summarize(prompt, SUMMARIZE_OPTIONS.discordAnalysis);
      logger.success(`Successfully received AI summary for channel ${channelName}`);
      
      return response;
    } catch (error) {
      logger.error(`Error getting AI summary: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Format prompt for channel summary.
   * Now delegates to the centralized createDiscordAnalysisPrompt in promptHelper.ts.
   * @param transcript - Chat transcript
   * @param channelName - Name of the channel
   * @returns Formatted prompt string
   * @private
   */
  private getChannelSummaryPrompt(transcript: string, channelName: string): string {
    return createDiscordAnalysisPrompt(transcript, channelName);
  }

  /**
   * Parse AI output into structured DiscordSummary object.
   * @param text - AI-generated structured text
   * @param channelName - Name of the channel
   * @param guildName - Name of the guild/server
   * @returns DiscordSummary object
   * @private
   */
  private parseStructuredText(text: string, channelName: string, guildName: string): DiscordSummary {
    // Split into sections using numbered headings
    const sections = text.split(/\n(?:\d+\.\s*)/);
    
    // Extract content from each section
    const summary = sections.length > 1 ? this.extractSection(sections[1], 'Summary') : text;
    const faqs = sections.length > 2 ? this.parseFAQs(sections[2]) : [];
    const helpInteractions = sections.length > 3 ? this.parseHelpInteractions(sections[3]) : [];
    const actionItems = sections.length > 4 ? this.parseActionItems(sections[4]) : [];
    
    logger.info(`Parsed structured text for ${channelName}. Summary: ${summary.length} chars, FAQs: ${faqs.length}, Help interactions: ${helpInteractions.length}, Action items: ${actionItems.length}`);
    
    return {
      channelName,
      guildName,
      summary,
      faqs,
      helpInteractions,
      actionItems
    };
  }

  /**
   * Extract a section from text.
   * @param text - Text to extract from
   * @param sectionName - Name of the section to extract
   * @returns Extracted section text
   * @private
   */
  private extractSection(text: string | undefined, sectionName: string): string {
    if (!text) return '';
    return text.replace(new RegExp(`^\\s*${sectionName}:?\\s*\\n?`, 'i'), '').trim();
  }

  /**
   * Parse FAQ section into structured objects.
   * @param text - FAQ section text
   * @returns Array of SummaryFaqs objects
   * @private
   */
  private parseFAQs(text: string | undefined): SummaryFaqs[] {
    if (!text) return [];
    
    const faqs: SummaryFaqs[] = [];
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim().startsWith('Q:')) continue;
      
      const match = line.match(/^Q:\s*(.*?)\s*\(asked by\s*(.*?)\)\s*A:\s*(.*?)(?:\s*\(answered by\s*(.*?)\))?$/i);
      
      if (match) {
        faqs.push({
          question: match[1].trim(),
          askedBy: match[2].trim() || 'Unknown',
          answeredBy: match[4]?.trim() || (match[3].trim().toLowerCase() === 'unanswered' ? 'Unanswered' : 'Unknown')
        });
      }
    }
    
    return faqs;
  }

  /**
   * Parse Help Interactions section into structured objects.
   * @param text - Help Interactions section text
   * @returns Array of HelpInteractions objects
   * @private
   */
  private parseHelpInteractions(text: string | undefined): HelpInteractions[] {
    if (!text) return [];
    
    const interactions: HelpInteractions[] = [];
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim().toLowerCase().startsWith('helper:')) continue;
      
      const match = line.match(/Helper:\s*(.*?)\s*\|\s*Helpee:\s*(.*?)\s*\|\s*Context:\s*(.*?)\s*\|\s*Resolution:\s*(.*)/i);
      
      if (match) {
        interactions.push({
          helper: match[1].trim(),
          helpee: match[2].trim(),
          context: match[3].trim(),
          resolution: match[4].trim()
        });
      }
    }
    
    return interactions;
  }

  /**
   * Parse Action Items section into structured objects.
   * @param text - Action Items section text
   * @returns Array of ActionItems objects
   * @private
   */
  private parseActionItems(text: string | undefined): ActionItems[] {
    if (!text) return [];
    
    const items: ActionItems[] = [];
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim().toLowerCase().startsWith('type:')) continue;
      
      const match = line.match(/Type:\s*(Technical|Documentation|Feature)\s*\|\s*Description:\s*(.*?)\s*\|\s*Mentioned By:\s*(.*)/i);
      
      if (match) {
        const type = match[1].trim() as 'Technical' | 'Documentation' | 'Feature';
        
        if (['Technical', 'Documentation', 'Feature'].includes(type)) {
          items.push({
            type,
            description: match[2].trim(),
            mentionedBy: match[3].trim()
          });
        }
      }
    }
    
    return items;
  }

  /**
   * Calculate message and user statistics from content items.
   * @param contentItems - Array of content items
   * @returns Statistics object
   * @private
   */
  private calculateDiscordStats(contentItems: ContentItem[]): {
    totalMessages: number;
    totalUsers: number;
    channelStats: {
      channelId: string;
      channelName: string;
      messageCount: number;
      uniqueUsers: string[];
    }[];
  } {
    // Initialize stats
    const stats = {
      totalMessages: 0,
      totalUsers: 0,
      channelStats: [] as Array<{
        channelId: string;
        channelName: string;
        messageCount: number;
        uniqueUsers: string[];
      }>,
      allUniqueUsers: new Set<string>()
    };
    
    // Group by channel
    const channelMap = this.groupByChannel(contentItems);
    
    // Process each channel
    for (const [channelId, items] of Object.entries(channelMap)) {
      let channelMessageCount = 0;
      const channelUsers = new Set<string>();
      
      // Count messages and collect users
      items.forEach(item => {
        if (item.text && item.type === "discordRawData") {
          try {
            const data: DiscordRawData = JSON.parse(item.text);
            
            if (data.messages && Array.isArray(data.messages)) {
              channelMessageCount += data.messages.length;
              
              data.messages.forEach(msg => {
                if (msg.uid) {
                  channelUsers.add(msg.uid);
                  stats.allUniqueUsers.add(msg.uid);
                }
              });
            }
          } catch (e) {
            // Skip parsing errors
          }
        }
      });
      
      const channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
      
      stats.channelStats.push({
        channelId,
        channelName,
        messageCount: channelMessageCount,
        uniqueUsers: Array.from(channelUsers)
      });
      
      stats.totalMessages += channelMessageCount;
    }
    
    stats.totalUsers = stats.allUniqueUsers.size;
    
    // Create a clean copy without the Set
    const { allUniqueUsers, ...cleanStats } = stats;
    return cleanStats;
  }

  /**
   * Generate combined summary files (JSON and Markdown)
   * @param summaries - Array of channel summaries
   * @param dateStr - Date string
   * @param timestamp - Unix timestamp
   * @param contentItems - Original content items for stats
   * @private
   */
  private async generateCombinedSummaryFiles(
    summaries: DiscordSummary[], 
    dateStr: string,
    timestamp: number,
    contentItems: ContentItem[]
  ): Promise<void> {
    try {
      const serverName = summaries[0]?.guildName || "Discord Server";
      const fileTitle = `${serverName} Discord - ${dateStr}`;
      
      // Calculate statistics
      const stats = this.calculateDiscordStats(contentItems);
      
      // Generate AI summary
      const markdownContent = await this.generateDailySummary(summaries, dateStr);
      
      // Create enhanced JSON data
      const jsonData = {
        server: serverName,
        title: fileTitle,
        date: timestamp,
        stats: {
          totalMessages: stats.totalMessages,
          totalUsers: stats.totalUsers
        },
        categories: summaries.map(s => {
          const channelStats = stats.channelStats.find(c => c.channelId === s.channelId);
          return {
            channelId: s.channelId || '',
            channelName: s.channelName || '',
            summary: s.summary || '',
            messageCount: channelStats?.messageCount || 0,
            userCount: channelStats?.uniqueUsers.length || 0
          };
        })
      };
      
      // Prepare final markdown with title
      const finalMarkdown = `# ${fileTitle}\n\n${markdownContent.replace(/^#\s+[^\n]*\n/, '')}`;
      
      // Write files
      logger.info(`Writing combined summary files to ${this.outputPath}`);
      await writeFile(this.outputPath, `${dateStr}`, JSON.stringify(jsonData, null, 2), 'json');
      await writeFile(this.outputPath, `${dateStr}`, finalMarkdown, 'md');
      
      // Save to database summary table
      logger.info(`Saving combined summary to database`);
      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: fileTitle,
        categories: JSON.stringify(jsonData),  // Store the JSON data
        markdown: finalMarkdown,               // Store the markdown content
        date: timestamp
      };
      
      await this.storage.saveSummaryItem(summaryItem);
      logger.success(`Saved combined summary to database for ${dateStr}`);
      
      logger.success(`Generated combined summary files for ${dateStr}`);
    } catch (error) {
      logger.error(`Error generating combined summary files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a daily summary of all channel summaries using AI.
   * @param summaries - Array of channel summaries
   * @param dateStr - Date string
   * @returns AI-generated markdown summary
   * @private
   */
  private async generateDailySummary(
    summaries: DiscordSummary[], 
    dateStr: string
  ): Promise<string> {
    try {
      // Create prompt using centralized prompt builder with XML-tagged channel summaries
      const channelSummaryData = summaries.map(s => ({
        guildName: s.guildName,
        channelName: s.channelName,
        summary: s.summary
      }));
      const prompt = createDiscordDailySummaryPrompt(channelSummaryData, dateStr);
      
      logger.info(`Sending daily summary prompt to AI provider`);
      const result = await this.provider.summarize(prompt, SUMMARIZE_OPTIONS.discordDailySummary);
      logger.success(`Received daily summary from AI provider`);
      
      // Clean up potential artifacts
      return result
        .trim()
        .replace(/```markdown\n?|```\n?/g, '') // Remove markdown code block markers
        .replace(/^#+ .*\n{1,2}/m, '') // Remove any top-level heading line
    } catch (error) {
      logger.error(`Error generating daily summary: ${error instanceof Error ? error.message : String(error)}`);
      return `# Error Generating Summary\n\nUnable to generate summary: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
