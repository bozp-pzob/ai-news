import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem } from "../../types";
import fs from "fs";
import path from "path";

const hour = 60 * 60 * 1000;

interface DiscordSummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source: string;
  outputPath?: string;
}

interface DiscordSummary {
  channelName: string;
  guildName: string;
  summary: string;
  faqs: Array<{
    question: string;
    askedBy: string;
    answeredBy: string;
  }>;
  helpInteractions: Array<{
    helper: string;
    helpee: string;
    context: string;
    resolution: string;
  }>;
  actionItems: Array<{
    type: 'Technical' | 'Documentation' | 'Feature';
    description: string;
    mentionedBy: string;
  }>;
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

  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      const currentTime = new Date(dateStr).getTime() / 1000;
      const targetTime = currentTime + (60 * 60 * 24);
      const contentItems: ContentItem[] = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.summaryType);

      if (contentItems.length === 0) {
        console.warn(`No Discord content found for date ${dateStr} to generate summary.`);
        return;
      }

      // Group by channel
      const channelSummaries = this.groupByChannel(contentItems);
      const allSummaries: DiscordSummary[] = [];

      // Process each channel's summaries
      for (const [channelId, items] of Object.entries(channelSummaries)) {
        try {
          const channelSummary = await this.processChannelSummaries(items);
          if (channelSummary) {
            allSummaries.push(channelSummary);
          }
        } catch (e) {
          console.error(`Error processing channel ${channelId}:`, e);
        }
      }

      // Generate final summary
      const dailySummary = await this.generateDailySummary(allSummaries, dateStr);
      
      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: `Daily Report - ${dateStr}`,
        categories: JSON.stringify(allSummaries, null, 2),
        markdown: dailySummary,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);
      await this.writeFile(dateStr, currentTime, allSummaries, 'json');
      await this.writeFile(dateStr, currentTime, dailySummary, 'md');

      console.log(`Discord daily summary for ${dateStr} generated and stored successfully.`);
    } catch (error) {
      console.error(`Error generating Discord daily summary for ${dateStr}:`, error);
    }
  }

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

  private async processChannelSummaries(items: ContentItem[]): Promise<DiscordSummary | null> {
    if (items.length === 0) return null;

    // Parse the structured summaries from the channel source
    const summaries = items.map(item => {
      try {
        const text = item.text || '';
        const sections = text.split(/\d+\./);
        return {
          summary: this.extractSection(sections[1] || '', 'Summary'),
          faqs: this.extractFAQs(sections[2] || ''),
          helpInteractions: this.extractHelpInteractions(sections[3] || ''),
          actionItems: this.extractActionItems(sections[4] || '')
        };
      } catch (e) {
        console.error('Error parsing summary:', e);
        return null;
      }
    }).filter(Boolean);

    if (summaries.length === 0) return null;

    // Combine all summaries for the channel
    const metadata = items[0].metadata || {};
    
    // Clean up the summary to remove any JSON data that might be mixed in
    const rawSummary = this.combineSummaries(summaries.map(s => s?.summary || ''));
    const cleanSummary = this.cleanSummaryText(rawSummary);
    
    return {
      channelName: metadata.channelName || 'Unknown Channel',
      guildName: metadata.guildName || 'Unknown Server',
      summary: cleanSummary,
      faqs: this.combineItems(summaries.flatMap(s => s?.faqs || []), 'question'),
      helpInteractions: this.combineItems(summaries.flatMap(s => s?.helpInteractions || []), 'helper-helpee-context'),
      actionItems: this.combineItems(summaries.flatMap(s => s?.actionItems || []), 'type-description')
    };
  }

  private async generateDailySummary(summaries: DiscordSummary[], dateStr: string): Promise<string> {
    const prompt = `Create a comprehensive daily summary of Discord discussions from ${dateStr}. Here are the channel summaries:

${summaries.map(s => `
# ${s.guildName} - ${s.channelName}

${s.summary}

## Key Questions & Answers
${s.faqs.map(faq => `- Q: ${faq.question} (asked by ${faq.askedBy}, answered by ${faq.answeredBy})`).join('\n')}

## Notable Help Interactions
${s.helpInteractions.map(help => `- ${help.helper} helped ${help.helpee}: ${help.context} - ${help.resolution}`).join('\n')}

## Action Items
${s.actionItems.map(item => `- [${item.type}] ${item.description} (mentioned by ${item.mentionedBy})`).join('\n')}
`).join('\n---\n')}

Please create a markdown summary that:
1. Highlights the most important technical discussions and decisions across all channels
2. Lists key questions that were answered
3. Showcases notable community help interactions
4. Compiles all action items by type (Technical, Documentation, Feature Requests)
5. Maintains attribution for questions, answers, and action items`;

    return await this.provider.summarize(prompt);
  }

  private extractSection(text: string, sectionName: string): string {
    return text.trim();
  }

  private extractFAQs(text: string): Array<{ question: string; askedBy: string; answeredBy: string }> {
    return this.extractItems(text, /^-?\s*(.+?)\s*\(asked by\s+(.+?),\s*answered by\s+(.+?)\)/i, 
      (match) => ({
        question: match[1].trim(),
        askedBy: match[2].trim(),
        answeredBy: match[3].trim()
      })
    );
  }

  private extractHelpInteractions(text: string): Array<{ helper: string; helpee: string; context: string; resolution: string }> {
    const interactions: Array<{ helper: string; helpee: string; context: string; resolution: string }> = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      if (line.includes('helped')) {
        const parts = line.split(':');
        if (parts.length >= 2) {
          const helpParts = parts[0].split('helped');
          if (helpParts.length === 2) {
            const [context, resolution] = parts[1].split('-').map(s => s.trim());
            interactions.push({
              helper: helpParts[0].trim().replace('-', ''),
              helpee: helpParts[1].trim(),
              context: context || '',
              resolution: resolution || ''
            });
          }
        }
      }
    }
    
    return interactions;
  }

  private extractActionItems(text: string): Array<{ type: 'Technical' | 'Documentation' | 'Feature'; description: string; mentionedBy: string }> {
    return this.extractItems(text, /^-?\s*(Technical|Documentation|Feature):\s*(.+?)\s*\((.+?)\)/i,
      (match) => ({
        type: match[1] as 'Technical' | 'Documentation' | 'Feature',
        description: match[2].trim(),
        mentionedBy: match[3].trim()
      })
    );
  }

  private extractItems<T>(text: string, regex: RegExp, mapper: (match: RegExpMatchArray) => T): T[] {
    const items: T[] = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        items.push(mapper(match));
      }
    }
    
    return items;
  }

  private combineSummaries(summaries: string[]): string {
    return summaries.join('\n\n');
  }

  private combineItems<T>(items: T[], keyType: string): T[] {
    // Remove duplicates and keep most informative versions
    const uniqueItems = new Map<string, T>();
    
    for (const item of items) {
      let key: string;
      
      if (keyType === 'question') {
        // For FAQs
        key = (item as any).question.toLowerCase();
        if (!uniqueItems.has(key) || (item as any).question.length > (uniqueItems.get(key) as any).question.length) {
          uniqueItems.set(key, item);
        }
      } else if (keyType === 'helper-helpee-context') {
        // For help interactions
        key = `${(item as any).helper}-${(item as any).helpee}-${(item as any).context}`;
        if (!uniqueItems.has(key) || (item as any).resolution.length > (uniqueItems.get(key) as any).resolution.length) {
          uniqueItems.set(key, item);
        }
      } else if (keyType === 'type-description') {
        // For action items
        key = `${(item as any).type}-${(item as any).description.toLowerCase()}`;
        if (!uniqueItems.has(key) || (item as any).description.length > (uniqueItems.get(key) as any).description.length) {
          uniqueItems.set(key, item);
        }
      }
    }
    
    return Array.from(uniqueItems.values());
  }

  private cleanSummaryText(text: string): string {
    // Remove any JSON-like content that might be mixed in with the summary
    // This regex looks for patterns like {"key": "value"} or {"key": value}
    const jsonPattern = /\{[^{]*"[\w\d]+"[^{]*\}/g;
    return text.replace(jsonPattern, '').trim();
  }

  private async writeFile(dateStr: string, currentTime: number, content: any, format: 'json' | 'md'): Promise<void> {
    try {
      const dir = path.join(this.outputPath, format);
      this.ensureDirectoryExists(dir);
      
      const filePath = path.join(dir, `${dateStr}.${format}`);
      
      if (format === 'json') {
        // Clean up the categories to ensure they have the correct format
        const cleanedContent = this.cleanCategories(content);
        
        fs.writeFileSync(filePath, JSON.stringify({
          type: this.summaryType,
          title: `Daily Report - ${dateStr}`,
          categories: cleanedContent,
          date: currentTime,
        }, null, 2));
      } else {
        fs.writeFileSync(filePath, content);
      }
    } catch (error) {
      console.error(`Error saving Discord summary to ${format} file ${dateStr}:`, error);
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

  private ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  public async generateContent() {
    try {
      const today = new Date();
      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch(
        (today.getTime() - (hour * 24)) / 1000,
        today.getTime() / 1000
      );
      
      if (!summary || summary.length === 0) {
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        const dateStr = summaryDate.toISOString().slice(0, 10);
        
        console.log(`Generating Discord summary for ${dateStr}`);
        await this.generateAndStoreSummary(dateStr);
        console.log(`Discord summary complete for ${dateStr}`);
      }
    } catch (error) {
      console.error(`Error generating Discord summary:`, error);
    }
  }
} 