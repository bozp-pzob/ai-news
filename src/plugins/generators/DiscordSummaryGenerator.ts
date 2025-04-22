import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem, DiscordSummary, ActionItems, HelpInteractions, SummaryFaqs, DiscordRawData } from "../../types";
import { time } from "../../helpers/generalHelper";
import fs from "fs";
import path from "path";
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
   * Generates and stores a daily summary for a specific date.
   * Processes all Discord content items for the given date and generates
   * both channel-specific and consolidated daily summaries.
   * @param dateStr - ISO date string for which to generate the summary
   * @returns Promise<void>
   */
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    const operation = `generateAndStoreSummary(${dateStr})`;
    logger.info(`[DiscordSummaryGenerator] Starting operation: ${operation}`);
    try {
      const targetDate = new Date(dateStr);
      targetDate.setUTCHours(0, 0, 0, 0); // Ensure start of day UTC
      const startTimeEpoch = targetDate.getTime() / 1000;
      const endTimeEpoch = startTimeEpoch + (24 * 60 * 60); // 24 hours later
      
      // Task 1: Fetch 'discord-raw' type instead of this.summaryType
      logger.info(`[DiscordSummaryGenerator:${operation}] Fetching raw content items between ${new Date(startTimeEpoch * 1000).toISOString()} and ${new Date(endTimeEpoch * 1000).toISOString()}`);
      const fetchType = 'discord-raw'; // Explicitly define type for logging
      logger.debug(`[DiscordSummaryGenerator:${operation}] Calling storage.getContentItemsBetweenEpoch(${startTimeEpoch}, ${endTimeEpoch}, '${fetchType}')`);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(startTimeEpoch, endTimeEpoch, fetchType); // Fetch raw items

      if (contentItems.length === 0) {
        logger.warning(`[DiscordSummaryGenerator:${operation}] No Discord raw content found for date ${dateStr}. Summary generation skipped.`);
        return;
      }
      logger.info(`[DiscordSummaryGenerator:${operation}] Found ${contentItems.length} raw content items.`);

      // Group by channel
      const channelItemsMap = this.groupByChannel(contentItems);
      const allSummaries: DiscordSummary[] = [];

      logger.info(`[DiscordSummaryGenerator:${operation}] Processing summaries for ${Object.keys(channelItemsMap).length} channels.`);
      // Process each channel's summaries
      for (const [channelId, items] of Object.entries(channelItemsMap)) {
        const channelOperation = `${operation} - Channel: ${channelId}`;
        logger.info(`[DiscordSummaryGenerator:${channelOperation}] Processing ${items.length} items.`);
        try {
          // This function needs significant changes (Task 1 / Task 5)
          const channelSummary = await this.processChannelSummaries(items);
          if (channelSummary) {
            allSummaries.push(channelSummary);
            logger.success(`[DiscordSummaryGenerator:${channelOperation}] Successfully processed channel.`);
          } else {
            logger.warning(`[DiscordSummaryGenerator:${channelOperation}] Processing returned no summary.`);
          }
        } catch (e: any) {
          // Task 4: Enhance error handling
          logger.error(`[DiscordSummaryGenerator:${channelOperation}] Error processing channel: ${e.message} | Error Object: ${JSON.stringify(e)}`);
        }
      }

      if (allSummaries.length === 0) {
        logger.warning(`[DiscordSummaryGenerator:${operation}] No channel summaries could be generated. Final summary skipped.`);
        return;
      }

      // Generate final summary
      logger.info(`[DiscordSummaryGenerator:${operation}] Generating final daily summary from ${allSummaries.length} channel summaries.`);
      const dailySummaryMarkdown = await this.generateDailySummary(allSummaries, dateStr);
      
      // Create a ContentItem instead of SummaryItem
      const summaryContentItem: ContentItem = {
        // type: this.summaryType, // Use the configured summaryType 
        type: 'discordChannelSummary', // Or hardcode if preferred? Using configured for now.
        cid: `${this.summaryType}-${dateStr}`, // Create a unique content ID
        source: this.source, // Identify the generator as the source
        title: `Daily Discord Summary - ${dateStr}`,
        text: dailySummaryMarkdown, // Store the markdown summary in the text field
        link: undefined, // No direct link for a generated summary
        date: startTimeEpoch, // Use start of day epoch
        topics: undefined, // Topics not generated here
        metadata: { 
            // Store the structured data used to generate the markdown
            channelSummaries: allSummaries, 
            generator: this.source,
            originalSourceType: this.source // Record the original source type used ('discord-raw')
        } 
      };

      // Save as ContentItem using saveContentItems
      logger.info(`[DiscordSummaryGenerator:${operation}] Attempting to save Summary ContentItem to storage (Type: ${summaryContentItem.type}, CID: ${summaryContentItem.cid})...`);
      try {
          // await this.storage.saveSummaryItem(summaryItem); // OLD CALL
          await this.storage.saveContentItems([summaryContentItem]); // NEW CALL
          logger.success(`[DiscordSummaryGenerator:${operation}] Successfully called saveContentItems.`);
      } catch (saveError: any) {
          logger.error(`[DiscordSummaryGenerator:${operation}] Error occurred during saveContentItems call: ${saveError.message} | Error: ${JSON.stringify(saveError)}`);
      }

      // Save raw JSON and Markdown files
      const cleanedContent = this.cleanCategories(allSummaries);
      const allSummariesJson = JSON.stringify({
        type: this.summaryType,
        title: `Daily Discord Summary - ${dateStr}`,
        // Save cleaned categories to file
        categories: cleanedContent, 
        date: startTimeEpoch,
      }, null, 2);
      
      logger.info(`[DiscordSummaryGenerator:${operation}] Writing output files to ${this.outputPath}`);
      await writeFile(this.outputPath, `${dateStr}-summary`, allSummariesJson, 'json');
      await writeFile(this.outputPath, `${dateStr}-summary`, dailySummaryMarkdown, 'md');

      logger.success(`[DiscordSummaryGenerator:${operation}] Discord daily summary generated and stored successfully.`);
    } catch (error: any) {
      // Task 4: Enhance error handling
      logger.error(`[DiscordSummaryGenerator:${operation}] Top-level error: ${error.message} | Error Object: ${JSON.stringify(error)}`);
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
   * Processes raw Discord data items for a single channel.
   * Uses a helper to get structured text via AI, then parses that text.
   * @param items - Array of content items (type 'discord-raw') for a single channel
   * @returns Promise<DiscordSummary | null> Processed channel summary or null if processing fails
   * @private
   */
  private async processChannelSummaries(items: ContentItem[]): Promise<DiscordSummary | null> {
    const channelId = items[0]?.metadata?.channelId || 'unknown-channel';
    const operation = `processChannelSummaries(Channel: ${channelId}, Items: ${items.length})`;
    logger.info(`[DiscordSummaryGenerator:${operation}] Starting processing.`);

    if (items.length === 0) {
        logger.warning(`[DiscordSummaryGenerator:${operation}] No items received.`);
        return null;
    }

    // --- Parse and Combine Raw Data --- 
    let allMessages: DiscordRawData['messages'] = [];
    let allUsers: DiscordRawData['users'] = {};
    let guildName = items[0]?.metadata?.guildName || 'Unknown Server';
    let channelName = items[0]?.metadata?.channelName || 'Unknown Channel';
    
    logger.info(`[DiscordSummaryGenerator:${operation}] Parsing and combining raw data...`);
    for (const item of items) {
        if (item.type !== 'discord-raw') {
             logger.warning(`[DiscordSummaryGenerator:${operation}] Skipping item with incorrect type: ${item.type}`);
             continue;
        }
        if (!item.text) {
             logger.warning(`[DiscordSummaryGenerator:${operation}] Skipping item with empty text content (ID: ${item.cid})`);
            continue;
        }
        try {
            const rawData: DiscordRawData = JSON.parse(item.text);
            if (rawData.messages && Array.isArray(rawData.messages)) {
                allMessages = allMessages.concat(rawData.messages);
            }
            if (rawData.users) {
                allUsers = { ...allUsers, ...rawData.users };
            }
            channelName = rawData.channel?.name || channelName;
        } catch (e: any) {
            logger.error(`[DiscordSummaryGenerator:${operation}] Failed to parse JSON from item ${item.cid}: ${e.message} | Text Start: ${item.text?.substring(0,100)}...`);
        }
    }
    const uniqueMessages = Array.from(new Map(allMessages.map(m => [m.id, m])).values());
    uniqueMessages.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    logger.info(`[DiscordSummaryGenerator:${operation}] Combined data: ${uniqueMessages.length} unique messages, ${Object.keys(allUsers).length} unique users.`);
    // --- End Parse and Combine --- 

    if (uniqueMessages.length === 0) {
      logger.warning(`[DiscordSummaryGenerator:${operation}] No messages found after parsing. Cannot generate summary.`);
      return null;
    }

    // --- Get Structured Text via AI Helper --- 
    let structuredText: string | null = null;
    try {
        logger.info(`[DiscordSummaryGenerator:${operation}] Calling helper to get structured text from AI...`);
        structuredText = await this._getStructuredTextFromMessages(uniqueMessages, allUsers, channelName);
        if (!structuredText) {
             logger.warning(`[DiscordSummaryGenerator:${operation}] AI helper returned null or empty text.`);
             return null;
        }
        logger.success(`[DiscordSummaryGenerator:${operation}] Received structured text from AI helper (Length: ${structuredText.length}).`);
        logger.debug(`[DiscordSummaryGenerator:${operation}] Structured Text Start: ${structuredText.substring(0, 300)}...`);
    } catch (extractionError: any) {
         logger.error(`[DiscordSummaryGenerator:${operation}] Error getting structured text from AI helper: ${extractionError.message} | Error: ${JSON.stringify(extractionError)}`);
         return null; // Cannot proceed if helper fails
    }
    // --- End AI Helper Call --- 

    // --- Parse Structured Text (Using Restored/Re-implemented Original Logic) ---
    logger.info(`[DiscordSummaryGenerator:${operation}] Parsing structured text...`);
    let parsedSummary = 'Parsing failed';
    let parsedFaqs: SummaryFaqs[] = [];
    let parsedHelp: HelpInteractions[] = [];
    let parsedActions: ActionItems[] = [];
    try {
        // Split the AI response into sections based on the numbered headings
        // Assuming format like "1. Summary", "2. FAQ", "3. Help Interactions", "4. Action Items"
        const sections = structuredText.split(/\n(?:\d+\.\s*)/); 
        // sections[0] might be empty or contain preamble before "1." 
        // sections[1] should be Summary
        // sections[2] should be FAQ
        // sections[3] should be Help Interactions
        // sections[4] should be Action Items

        if (sections.length > 1) {
            parsedSummary = this.extractSection(sections[1], 'Summary');
        } else {
             logger.warning(`[DiscordSummaryGenerator:${operation}] Could not split AI response into sections. Using full response as summary.`);
             parsedSummary = structuredText.trim(); // Fallback
        }
        if (sections.length > 2) {
            parsedFaqs = this.extractFAQs(sections[2]); 
        }
        if (sections.length > 3) {
             parsedHelp = this.extractHelpInteractions(sections[3]);
        }
        if (sections.length > 4) {
             parsedActions = this.extractActionItems(sections[4]);
        }
         logger.success(`[DiscordSummaryGenerator:${operation}] Parsed structured text. Summary: ${parsedSummary.length}, FAQs: ${parsedFaqs.length}, Help: ${parsedHelp.length}, Actions: ${parsedActions.length}`);

    } catch (parseError: any) {
         logger.error(`[DiscordSummaryGenerator:${operation}] Error parsing structured text from AI: ${parseError.message}`);
         // Use whatever was parsed, summary might indicate failure
         parsedSummary = parsedSummary || `Error parsing AI response: ${parseError.message}`;
    }
    // --- End Parsing --- 

    // Construct the final DiscordSummary object
    const result: DiscordSummary = {
      channelName: channelName,
      guildName: guildName,
      summary: parsedSummary,         // Use parsed summary
      faqs: parsedFaqs,               // Use parsed FAQs
      helpInteractions: parsedHelp,     // Use parsed Help
      actionItems: parsedActions        // Use parsed Actions
    };
    logger.success(`[DiscordSummaryGenerator:${operation}] Final DiscordSummary object created.`);

    return result;
  }

  /**
   * Helper: Calls AI provider with the structured prompt from DiscordChannelSource
   * to get a single text response containing all structured sections.
   * @private 
   */
  private async _getStructuredTextFromMessages(
      messages: DiscordRawData['messages'], 
      users: DiscordRawData['users'], 
      channelName: string
  ): Promise<string | null> {
      const operation = `_getStructuredTextFromMessages(Channel: ${channelName}, Messages: ${messages.length})`;
      logger.info(`[DiscordSummaryGenerator:${operation}] Starting AI call.`);

      // 1. Prepare Context 
      const messageContext = messages.map(msg => {
          const userObj = users[msg.uid];
          const userName = userObj?.nickname || userObj?.name || msg.uid;
          const timestamp = new Date(msg.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute:'2-digit', hour12: false });
          return `[${timestamp}] ${userName}: ${msg.content}`;
      }).join('\n');

      // 2. Use the structured prompt (copied from DiscordChannelSource)
      const structuredPrompt = this.formatStructuredPrompt(messageContext, channelName);
      
      // 3. Call AI Provider
      let aiResponseString: string | null = null;
      try {
          logger.info(`[DiscordSummaryGenerator:${operation}] Sending structured prompt request (Context length: ${messageContext.length})...`);
          aiResponseString = await this.provider.summarize(structuredPrompt);
          logger.success(`[DiscordSummaryGenerator:${operation}] Received response from AI provider.`);
          // logger.debug(`[DiscordSummaryGenerator:${operation}] AI Response: ${aiResponseString}`); 
      } catch (aiError: any) {
          logger.error(`[DiscordSummaryGenerator:${operation}] Error calling AI provider: ${aiError.message} | Error: ${JSON.stringify(aiError)}`);
          return null; // Failure
      }

      return aiResponseString;
  }

  /**
   * Formats a structured prompt for the AI provider (Adapted from DiscordChannelSource).
   * @private
   */
  private formatStructuredPrompt(transcript: string, channelName: string): string {
    // Added channelName parameter here
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

  // --- Restored/Re-implemented Original Parsing Functions --- 

  /**
   * Extracts a specific section from a text block (based on section heading).
   * @private
   */
  private extractSection(text: string | undefined, sectionName: string): string {
    if (!text) return '';
    // Find the start of the section (e.g., "Summary:") and remove it and preceding whitespace/newlines
    const sectionHeaderRegex = new RegExp(`^\s*${sectionName}:?\s*\n?`, 'i');
    return text.replace(sectionHeaderRegex, '').trim();
  }

  /**
   * Extracts FAQ entries from the FAQ section text.
   * @private
   */
  private extractFAQs(faqSectionText: string | undefined): SummaryFaqs[] {
      if (!faqSectionText) return [];
      const operation = `extractFAQs`;
      logger.info(`[DiscordSummaryGenerator:${operation}] Parsing FAQ section...`);
      const faqs: SummaryFaqs[] = [];
      const lines = faqSectionText.trim().split('\n');
      
      for (const line of lines) {
          if (!line.trim().startsWith('Q:')) continue; // Ensure line starts correctly
          // Regex: Q: question text (asked by asker) A: answer text (answered by answerer/Unanswered)
          const match = line.match(/^Q:\s*(.*?)\s*\(asked by\s*(.*?)\)\s*A:\s*(.*?)(?:\s*\(answered by\s*(.*?)\))?$/i);
          
          if (match) {
              faqs.push({
                  question: match[1].trim(),
                  askedBy: match[2].trim() || 'Unknown',
                  // If group 4 exists, use it; otherwise check if group 3 is 'Unanswered'
                  answeredBy: match[4]?.trim() || (match[3].trim().toLowerCase() === 'unanswered' ? 'Unanswered' : 'Unknown'), 
              });
          } else {
               logger.warning(`[DiscordSummaryGenerator:${operation}] Could not parse FAQ line: ${line}`);
          }
      }
      logger.info(`[DiscordSummaryGenerator:${operation}] Parsed ${faqs.length} FAQs.`);
      return faqs;
  }

   /**
    * Extracts help interaction entries from the Help Interactions section text.
    * @private
    */
   private extractHelpInteractions(helpSectionText: string | undefined): HelpInteractions[] {
       if (!helpSectionText) return [];
       const operation = `extractHelpInteractions`;
       logger.info(`[DiscordSummaryGenerator:${operation}] Parsing Help Interaction section...`);
       const interactions: HelpInteractions[] = [];
       const lines = helpSectionText.trim().split('\n');
       
       for (const line of lines) {
            if (!line.trim().toLowerCase().startsWith('helper:')) continue;
           // Regex: Helper: name | Helpee: name | Context: problem | Resolution: solution
           const match = line.match(/Helper:\s*(.*?)\s*\|\s*Helpee:\s*(.*?)\s*\|\s*Context:\s*(.*?)\s*\|\s*Resolution:\s*(.*)/i);
           if (match) {
               interactions.push({
                   helper: match[1].trim(),
                   helpee: match[2].trim(),
                   context: match[3].trim(),
                   resolution: match[4].trim(),
               });
           } else {
                logger.warning(`[DiscordSummaryGenerator:${operation}] Could not parse Help Interaction line: ${line}`);
           }
       }
       logger.info(`[DiscordSummaryGenerator:${operation}] Parsed ${interactions.length} Help Interactions.`);
       return interactions;
   }

   /**
    * Extracts action items from the Action Items section text.
    * @private
    */
   private extractActionItems(actionSectionText: string | undefined): ActionItems[] {
       if (!actionSectionText) return [];
       const operation = `extractActionItems`;
       logger.info(`[DiscordSummaryGenerator:${operation}] Parsing Action Item section...`);
       const items: ActionItems[] = [];
       const lines = actionSectionText.trim().split('\n');
       
       for (const line of lines) {
           if (!line.trim().toLowerCase().startsWith('type:')) continue;
           // Regex: Type: Technical | Description: desc text | Mentioned By: user
           const match = line.match(/Type:\s*(Technical|Documentation|Feature)\s*\|\s*Description:\s*(.*?)\s*\|\s*Mentioned By:\s*(.*)/i);
           if (match) {
               // Basic validation for type
               const type = match[1].trim() as any;
               if (['Technical', 'Documentation', 'Feature'].includes(type)) {
                    items.push({
                        type: type as 'Technical' | 'Documentation' | 'Feature',
                        description: match[2].trim(),
                        mentionedBy: match[3].trim(),
                    });
               } else {
                    logger.warning(`[DiscordSummaryGenerator:${operation}] Invalid action item type found: ${type} in line: ${line}`);
               }
           } else {
               logger.warning(`[DiscordSummaryGenerator:${operation}] Could not parse Action Item line: ${line}`);
           }
       }
       logger.info(`[DiscordSummaryGenerator:${operation}] Parsed ${items.length} Action Items.`);
       return items;
   }

  /**
   * Generates a consolidated daily summary from multiple channel summaries.
   * Creates a comprehensive markdown summary highlighting key discussions,
   * questions, help interactions, and action items across all channels.
   * @param summaries - Array of channel summaries to consolidate
   * @param dateStr - Date string for the summary
   * @returns Promise<string> Generated markdown summary
   * @private
   */
  private async generateDailySummary(summaries: DiscordSummary[], dateStr: string): Promise<string> {
    const operation = `generateDailySummary(${dateStr})`;
    logger.info(`[DiscordSummaryGenerator:${operation}] Starting generation from ${summaries.length} channel summaries.`);
    try {
      // Construct prompt for the final AI summarization
      const promptContext = summaries.map(s => {
        // Only include sections if they have content
        const faqsSection = s.faqs.length > 0 ? `\n\n## Key Questions & Answers\n${s.faqs.map(faq => `- Q: ${faq.question} (asked by ${faq.askedBy}, answered by ${faq.answeredBy})`).join('\n')}` : '';
        const helpSection = s.helpInteractions.length > 0 ? `\n\n## Notable Help Interactions\n${s.helpInteractions.map(help => `- ${help.helper} helped ${help.helpee}: ${help.context} - ${help.resolution}`).join('\n')}` : '';
        const actionsSection = s.actionItems.length > 0 ? `\n\n## Action Items\n${s.actionItems.map(item => `- [${item.type}] ${item.description} (mentioned by ${item.mentionedBy})`).join('\n')}` : '';
        
        return `\n# ${s.guildName} - ${s.channelName}\n\n${s.summary}${faqsSection}${helpSection}${actionsSection}`; // Use AI-generated channel summary
      }).join('\n\n---\n');
      
      const finalPrompt = `Create a comprehensive daily markdown summary of Discord discussions from ${dateStr}. Here are the channel summaries:
${promptContext}

Please structure the final output clearly, covering these points across all channels:
1.  **Overall Discussion Highlights:** Key topics, technical decisions, announcements.
2.  **Key Questions & Answers:** List significant questions that received answers.
3.  **Community Help & Collaboration:** Showcase important instances of users helping each other.
4.  **Action Items:** Consolidate all action items, grouped by type (Technical, Documentation, Feature). Ensure attribution (mentioned by) is included.

Use markdown formatting effectively (headings, lists, bold text).`;

      logger.info(`[DiscordSummaryGenerator:${operation}] Sending final prompt to AI provider (Context length: ${promptContext.length})`);
      const result = await this.provider.summarize(finalPrompt);
      logger.success(`[DiscordSummaryGenerator:${operation}] Received final summary from AI provider.`);
      return result;
    } catch (error: any) {
      logger.error(`[DiscordSummaryGenerator:${operation}] Error during final summary generation: ${error.message} | Error Object: ${JSON.stringify(error)}`);
      return `Error generating daily summary: ${error.message}`; // Return error message as summary
    }
  }

  /**
   * Main entry point for content generation.
   * Generates summaries for the current day's content.
   * @returns Promise<void>
   */
  public async generateContent() {
    const operation = `generateContent`;
    logger.info(`[DiscordSummaryGenerator:${operation}] Checking if summary needs generation.`);
    try {
      const today = new Date();
      // Check for summary created *within* the last 24 hours, using the correct summaryType
      const checkStartTimeEpoch = (today.getTime() - time.milliseconds.day) / 1000;
      const checkEndTimeEpoch = today.getTime() / 1000;
      
      logger.info(`[DiscordSummaryGenerator:${operation}] Checking for existing summary of type '${this.summaryType}' between ${new Date(checkStartTimeEpoch*1000).toISOString()} and ${new Date(checkEndTimeEpoch*1000).toISOString()}`);
      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch(
        checkStartTimeEpoch,
        checkEndTimeEpoch,
        this.summaryType // Use the configured summaryType for checking existence
      );
      
      if (!summary || summary.length === 0) {
        logger.info(`[DiscordSummaryGenerator:${operation}] No recent summary found. Generating for previous day.`);
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        const dateStr = summaryDate.toISOString().slice(0, 10);
        
        logger.info(`[DiscordSummaryGenerator:${operation}] Calling generateAndStoreSummary for ${dateStr}`);
        await this.generateAndStoreSummary(dateStr);
        logger.success(`[DiscordSummaryGenerator:${operation}] Summary generation process completed for ${dateStr}.`);
      } else {
         logger.info(`[DiscordSummaryGenerator:${operation}] Recent summary found (Count: ${summary.length}). Generation skipped.`);
      }
    } catch (error: any) {
      // Task 4: Enhance error handling
      logger.error(`[DiscordSummaryGenerator:${operation}] Error in generateContent: ${error.message} | Error Object: ${JSON.stringify(error)}`);
    }
  }

  private cleanCategories(content: any): any[] {
    if (!Array.isArray(content)) return [];
    
    return content.map(item => {
      // Create a simplified version with just the essential fields
      return {
        channelName: item.channelName || '',
        summary: item.summary || ''
      };
    });
  }
} 