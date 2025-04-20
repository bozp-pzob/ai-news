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
        title: `Discord Daily Summary - ${dateStr}`,
        categories: JSON.stringify(allSummaries, null, 2),
        markdown: dailySummary,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);
      await this.writeSummaryToFile(dateStr, currentTime, allSummaries);
      await this.writeMDToFile(dateStr, dailySummary);

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
    return {
      channelName: metadata.channelName || 'Unknown Channel',
      guildName: metadata.guildName || 'Unknown Server',
      summary: this.combineSummaries(summaries.map(s => s?.summary || '')),
      faqs: this.combineFAQs(summaries.flatMap(s => s?.faqs || [])),
      helpInteractions: this.combineHelpInteractions(summaries.flatMap(s => s?.helpInteractions || [])),
      actionItems: this.combineActionItems(summaries.flatMap(s => s?.actionItems || []))
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
    const faqs: Array<{ question: string; askedBy: string; answeredBy: string }> = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const match = line.match(/^-?\s*(.+?)\s*\(asked by\s+(.+?),\s*answered by\s+(.+?)\)/i);
      if (match) {
        faqs.push({
          question: match[1].trim(),
          askedBy: match[2].trim(),
          answeredBy: match[3].trim()
        });
      }
    }
    
    return faqs;
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
    const items: Array<{ type: 'Technical' | 'Documentation' | 'Feature'; description: string; mentionedBy: string }> = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const match = line.match(/^-?\s*(Technical|Documentation|Feature):\s*(.+?)\s*\((.+?)\)/i);
      if (match) {
        items.push({
          type: match[1] as 'Technical' | 'Documentation' | 'Feature',
          description: match[2].trim(),
          mentionedBy: match[3].trim()
        });
      }
    }
    
    return items;
  }

  private combineSummaries(summaries: string[]): string {
    return summaries.join('\n\n');
  }

  private combineFAQs(faqs: Array<{ question: string; askedBy: string; answeredBy: string }>): Array<{ question: string; askedBy: string; answeredBy: string }> {
    // Remove duplicates and keep most informative versions
    const uniqueFAQs = new Map();
    for (const faq of faqs) {
      const key = faq.question.toLowerCase();
      if (!uniqueFAQs.has(key) || faq.question.length > uniqueFAQs.get(key).question.length) {
        uniqueFAQs.set(key, faq);
      }
    }
    return Array.from(uniqueFAQs.values());
  }

  private combineHelpInteractions(interactions: Array<{ helper: string; helpee: string; context: string; resolution: string }>): Array<{ helper: string; helpee: string; context: string; resolution: string }> {
    // Remove duplicates and keep most informative versions
    const uniqueInteractions = new Map();
    for (const interaction of interactions) {
      const key = `${interaction.helper}-${interaction.helpee}-${interaction.context}`;
      if (!uniqueInteractions.has(key) || interaction.resolution.length > uniqueInteractions.get(key).resolution.length) {
        uniqueInteractions.set(key, interaction);
      }
    }
    return Array.from(uniqueInteractions.values());
  }

  private combineActionItems(items: Array<{ type: 'Technical' | 'Documentation' | 'Feature'; description: string; mentionedBy: string }>): Array<{ type: 'Technical' | 'Documentation' | 'Feature'; description: string; mentionedBy: string }> {
    // Remove duplicates and keep most informative versions
    const uniqueItems = new Map();
    for (const item of items) {
      const key = `${item.type}-${item.description.toLowerCase()}`;
      if (!uniqueItems.has(key) || item.description.length > uniqueItems.get(key).description.length) {
        uniqueItems.set(key, item);
      }
    }
    return Array.from(uniqueItems.values());
  }

  private async writeSummaryToFile(dateStr: string, currentTime: number, allSummaries: DiscordSummary[]) {
    try {
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        type: this.summaryType,
        title: `Discord Daily Summary - ${dateStr}`,
        categories: allSummaries,
        date: currentTime,
      }, null, 2));
    } catch (error) {
      console.error(`Error saving Discord summary to json file ${dateStr}:`, error);
    }
  }

  private async writeMDToFile(dateStr: string, content: string) {
    try {
      const mdDir = path.join(this.outputPath, 'md');
      this.ensureDirectoryExists(mdDir);
      
      const filePath = path.join(mdDir, `${dateStr}.md`);
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving Discord summary to markdown file ${dateStr}:`, error);
    }
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