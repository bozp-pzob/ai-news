import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem, DiscordSummary, ActionItems, HelpInteractions, SummaryFaqs, DiscordRawData } from "../../types";
import { writeFile } from "../../helpers/fileHelper";
import { logger } from "../../helpers/cliHelper";

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
      const checkStartTimeEpoch = (today.getTime() - (24 * 60 * 60 * 1000)) / 1000;
      const checkEndTimeEpoch = today.getTime() / 1000;
      
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
        startTimeEpoch, endTimeEpoch, 'discord-raw'
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
            
            // Save as content item
            await this.saveSummaryAsContentItem(channelSummary, channelId, startTimeEpoch, items[0]?.link);
            logger.success(`Successfully saved summary for channel ${channelSummary.channelName || channelId}`);
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
        if (item.type !== 'discord-raw' || !item.text) continue;
        
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
      const prompt = this.getChannelSummaryPrompt(transcript, channelName);
      
      logger.info(`Calling AI provider for channel ${channelName} summary`);
      const response = await this.provider.summarize(prompt);
      logger.success(`Successfully received AI summary for channel ${channelName}`);
      
      return response;
    } catch (error) {
      logger.error(`Error getting AI summary: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Format prompt for channel summary.
   * @param transcript - Chat transcript
   * @param channelName - Name of the channel
   * @returns Formatted prompt string
   * @private
   */
  private getChannelSummaryPrompt(transcript: string, channelName: string): string {
    return `Analyze this Discord chat segment for channel "${channelName}" and provide a succinct analysis:
            
1. Summary (max 500 words):
- Focus ONLY on the most important technical discussions, decisions, and problem-solving
- Highlight concrete solutions and implementations
- Be specific and VERY concise

2. FAQ (max 20 questions):
- Only include the most significant questions that got meaningful responses
- Focus on unique questions, skip similar or rhetorical questions
- Include who asked the question and who answered
- Use the exact Discord username from the chat
- Format: Q: <Question> (asked by <User>) A: <Answer> (answered by <User>)
- If unanswered: Q: <Question> (asked by <User>) A: Unanswered
- List one FAQ per line.

3. Help Interactions (max 10):
- List the significant instances where community members helped each other.
- Be specific and concise about what kind of help was given
- Include context about the problem that was solved
- Mention if the help was successful
- Format: Helper: <User> | Helpee: <User> | Context: <Problem> | Resolution: <Solution>
- List one interaction per line.

4. Action Items (max 20 total):
- Technical Tasks: Critical development tasks only
- Documentation Needs: Essential doc updates only
- Feature Requests: Major feature suggestions only
- Format: Type: <Technical|Documentation|Feature> | Description: <Description> | Mentioned By: <User>
- List one action item per line.

Chat transcript:
---
${transcript}
---

Return the analysis in the specified structured format with numbered sections (1., 2., 3., 4.). Be specific about technical content and avoid duplicating information. Ensure each FAQ, Help Interaction, and Action Item is on its own line following the specified format exactly.`;
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
   * Save channel summary as a ContentItem in storage.
   * @param summary - Discord summary object
   * @param channelId - Channel ID
   * @param timestamp - Unix timestamp
   * @param linkBase - Base URL for the channel
   * @private
   */
  private async saveSummaryAsContentItem(
    summary: DiscordSummary, 
    channelId: string, 
    timestamp: number,
    linkBase?: string
  ): Promise<void> {
    const summaryItem: ContentItem = {
      type: 'discordChannelSummary',
      cid: `discordSummary-${channelId}-${new Date(timestamp * 1000).toISOString().slice(0, 10)}`,
      source: this.source,
      title: `Channel Summary: ${summary.channelName || channelId}`,
      text: summary.summary,
      link: linkBase?.split('/').slice(0, -1).join('/'),
      date: timestamp,
      metadata: {
        channelId,
        guildName: summary.guildName,
        channelName: summary.channelName,
        generator: this.source,
        faqCount: summary.faqs.length,
        helpCount: summary.helpInteractions.length,
        actionItemCount: summary.actionItems.length
      }
    };
    
    try {
      await this.storage.saveContentItems([summaryItem]);
    } catch (error) {
      logger.error(`Error saving summary for ${summary.channelName}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
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
        if (item.text && item.type === 'discord-raw') {
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
      await writeFile(this.outputPath, `${dateStr}-summary`, JSON.stringify(jsonData, null, 2), 'json');
      await writeFile(this.outputPath, `${dateStr}-summary`, finalMarkdown, 'md');
      
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
      // Format context from channel summaries
      const promptContext = summaries
        .map(s => `### ${s.guildName} - ${s.channelName}\n${s.summary}`)
        .join('\n\n---\n');
      
      // Create prompt without triple backticks to avoid artifacts
      const prompt = `Create a comprehensive daily markdown summary of Discord discussions from ${dateStr}. 
Here are the channel summaries:

${promptContext}

Please structure the final output clearly, covering these points across all channels:
1. **Overall Discussion Highlights:** Key topics, technical decisions, and announcements. Group by theme rather than by channel.
2. **Key Questions & Answers:** List significant questions that received answers.
3. **Community Help & Collaboration:** Showcase important instances of users helping each other.
4. **Action Items:** Consolidate all action items, grouped by type (Technical, Documentation, Feature). Ensure attribution (mentioned by) is included.

Use markdown formatting effectively (headings, lists, bold text). Start your response directly with the markdown content, not with explanations or preamble.
Please note that the final output should be in a single, coherent document without any markdown code block formatting.`;
      
      logger.info(`Sending daily summary prompt to AI provider`);
      const result = await this.provider.summarize(prompt);
      logger.success(`Received daily summary from AI provider`);
      
      // Clean up potential artifacts
      return result
        .trim()
        .replace(/```markdown\n?|```\n?/g, '') // Remove markdown code block markers
        .replace(/^# /m, '## '); // Convert top-level headings to level 2
    } catch (error) {
      logger.error(`Error generating daily summary: ${error instanceof Error ? error.message : String(error)}`);
      return `# Error Generating Summary\n\nUnable to generate summary: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}