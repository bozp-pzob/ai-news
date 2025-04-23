import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, DiscordSummary, DiscordRawData } from "../../types";
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

  constructor(config: DiscordSummaryGeneratorConfig) {
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './';
  }

  // Main entry point called by scheduler
  public async generateContent() {
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);
      
      // Check if summary already exists for yesterday
      const checkStartTime = (yesterday.getTime() / 1000);
      const checkEndTime = (today.getTime() / 1000);
      const existingSummaries = await this.storage.getSummaryBetweenEpoch(
        checkStartTime, checkEndTime, this.summaryType
      );
      
      if (existingSummaries.length === 0) {
        logger.info(`Generating Discord summary for ${dateStr}`);
        await this.generateAndStoreSummary(dateStr);
      } else {
        logger.info(`Summary already exists for ${dateStr}, skipping generation`);
      }
    } catch (error) {
      logger.error(`Error in generateContent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Process summaries for a specific date
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      // Set up time range for the requested date
      const targetDate = new Date(dateStr);
      const startTimeEpoch = Math.floor(targetDate.setUTCHours(0, 0, 0, 0) / 1000);
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60);
      
      // Fetch raw content for this date
      logger.info(`Fetching Discord content for ${dateStr}`);
      const contentItems = await this.storage.getContentItemsBetweenEpoch(
        startTimeEpoch, endTimeEpoch, 'discord-raw'
      );
      
      if (contentItems.length === 0) {
        logger.warning(`No Discord content found for ${dateStr}`);
        return;
      }
      
      // Group by channel and process each channel
      const channelItemsMap = this.groupByChannel(contentItems);
      const allChannelSummaries: DiscordSummary[] = [];
      
      for (const [channelId, items] of Object.entries(channelItemsMap)) {
        try {
          logger.info(`Processing channel ${channelId} with ${items.length} messages`);
          const channelSummary = await this.processChannelData(items);
          
          if (channelSummary) {
            allChannelSummaries.push(channelSummary);
            
            // Save as content item
            await this.saveSummaryAsContentItem(channelSummary, channelId, startTimeEpoch, items[0]?.link);
          }
        } catch (error) {
          logger.error(`Error processing channel ${channelId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Generate combined summary file if we have channel summaries
      if (allChannelSummaries.length > 0) {
        await this.generateCombinedSummaryFiles(allChannelSummaries, dateStr, startTimeEpoch);
      }
      
    } catch (error) {
      logger.error(`Error generating summary for ${dateStr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Group content items by channel ID
  private groupByChannel(items: ContentItem[]): { [channelId: string]: ContentItem[] } {
    const channels: { [channelId: string]: ContentItem[] } = {};
    
    for (const item of items) {
      const channelId = item.metadata?.channelId;
      if (channelId) {
        if (!channels[channelId]) {
          channels[channelId] = [];
        }
        channels[channelId].push(item);
      }
    }
    
    return channels;
  }

  // Process raw data for a single channel
  private async processChannelData(items: ContentItem[]): Promise<DiscordSummary | null> {
    if (items.length === 0) return null;
    
    // Extract channel metadata
    const channelId = items[0]?.metadata?.channelId || 'unknown';
    const guildName = items[0]?.metadata?.guildName || 'Unknown Server';
    const channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
    
    // Parse and combine raw messages
    const { messages, users } = this.combineRawData(items);
    
    if (messages.length === 0) {
      logger.warning(`No messages found for channel ${channelName}`);
      return null;
    }
    
    // Get AI summary
    const structuredText = await this.getAISummary(messages, users, channelName);
    if (!structuredText) return null;
    
    // Parse the AI output
    return this.parseStructuredText(structuredText, channelName, guildName);
  }

  // Combine raw data from multiple content items
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

  // Get AI summary from messages
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
      
      // Get AI analysis
      const prompt = this.getChannelSummaryPrompt(transcript, channelName);
      return await this.provider.summarize(prompt);
    } catch (error) {
      logger.error(`Error getting AI summary: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // Format prompt for channel summary
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

  // Parse AI output into structured data
  private parseStructuredText(text: string, channelName: string, guildName: string): DiscordSummary {
    // Split into sections using numbered headings
    const sections = text.split(/\n(?:\d+\.\s*)/);
    
    // Extract content from each section
    const summary = sections.length > 1 ? this.extractSection(sections[1], 'Summary') : text;
    const faqs = sections.length > 2 ? this.parseFAQs(sections[2]) : [];
    const helpInteractions = sections.length > 3 ? this.parseHelpInteractions(sections[3]) : [];
    const actionItems = sections.length > 4 ? this.parseActionItems(sections[4]) : [];
    
    return {
      channelName,
      guildName,
      summary,
      faqs,
      helpInteractions,
      actionItems
    };
  }

  // Extract a section from text
  private extractSection(text: string | undefined, sectionName: string): string {
    if (!text) return '';
    return text.replace(new RegExp(`^\\s*${sectionName}:?\\s*\\n?`, 'i'), '').trim();
  }

  // Parse FAQ section with robust pattern matching
  private parseFAQs(text: string | undefined) {
    if (!text) return [];
    
    const faqs = [];
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

  // Parse Help Interactions section
  private parseHelpInteractions(text: string | undefined) {
    if (!text) return [];
    
    const interactions = [];
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

  // Parse Action Items section
  private parseActionItems(text: string | undefined) {
    if (!text) return [];
    
    const items = [];
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
      if (!line.trim().toLowerCase().startsWith('type:')) continue;
      
      const match = line.match(/Type:\s*(Technical|Documentation|Feature)\s*\|\s*Description:\s*(.*?)\s*\|\s*Mentioned By:\s*(.*)/i);
      
      if (match) {
        const type = match[1].trim();
        
        if (['Technical', 'Documentation', 'Feature'].includes(type)) {
          items.push({
            type: type as 'Technical' | 'Documentation' | 'Feature',
            description: match[2].trim(),
            mentionedBy: match[3].trim()
          });
        }
      }
    }
    
    return items;
  }

  // Save summary as ContentItem
  private async saveSummaryAsContentItem(
    summary: DiscordSummary, 
    channelId: string, 
    timestamp: number,
    linkBase?: string
  ) {
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
        generator: this.source
      }
    };
    
    try {
      await this.storage.saveContentItems([summaryItem]);
      logger.info(`Saved summary for channel ${summary.channelName}`);
    } catch (error) {
      logger.error(`Error saving summary for ${summary.channelName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Generate combined summary files (JSON and Markdown)
  private async generateCombinedSummaryFiles(
    summaries: DiscordSummary[], 
    dateStr: string,
    timestamp: number
  ) {
    try {
      const serverName = summaries[0]?.guildName || "Discord Server";
      const fileTitle = `${serverName} Discord - ${dateStr}`;
      
      // Generate context for AI summary
      const summaryContext = summaries
        .map(s => `### ${s.guildName} - ${s.channelName}\n${s.summary}`)
        .join('\n\n---\n');
      
      // Get AI-generated summary
      const markdownContent = await this.generateDailySummary(summaries, dateStr);
      
      // Prepare simplified JSON data
      const jsonData = {
        server: serverName,
        title: fileTitle,
        categories: summaries.map(s => ({
          channelName: s.channelName || '',
          summary: s.summary || ''
        })),
        date: timestamp
      };
      
      // Set title
      const finalMarkdown = `# ${fileTitle}\n\n${markdownContent.replace(/^#.*\n/, '')}`;
      
      // Write files
      await writeFile(this.outputPath, `${dateStr}-summary`, JSON.stringify(jsonData, null, 2), 'json');
      await writeFile(this.outputPath, `${dateStr}-summary`, finalMarkdown, 'md');
      
      logger.info(`Generated combined summary files for ${dateStr}`);
    } catch (error) {
      logger.error(`Error generating combined summary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get AI-generated daily summary
  private async generateDailySummary(
    summaries: DiscordSummary[], 
    dateStr: string
  ): Promise<string> {
    try {
      // Format context from channel summaries
      const promptContext = summaries
        .map(s => `### ${s.guildName} - ${s.channelName}\n${s.summary}`)
        .join('\n\n---\n');
      
      // Create prompt
      const prompt = `Create a comprehensive daily markdown summary of Discord discussions from ${dateStr}. Here are the channel summaries:

\`\`\`
${promptContext}
\`\`\`

Please structure the final output clearly, covering these points across all channels:
1. **Overall Discussion Highlights:** Key topics, technical decisions, announcements.
2. **Key Questions & Answers:** List significant questions that received answers.
3. **Community Help & Collaboration:** Showcase important instances of users helping each other.
4. **Action Items:** Consolidate all action items, grouped by type (Technical, Documentation, Feature). Ensure attribution (mentioned by) is included.

Use markdown formatting effectively (headings, lists, bold text).`;
      
      // Get AI summary
      const result = await this.provider.summarize(prompt);
      return result.trim();
    } catch (error) {
      logger.error(`Error generating daily summary: ${error instanceof Error ? error.message : String(error)}`);
      return `# Error Generating Summary\n\nUnable to generate summary: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}