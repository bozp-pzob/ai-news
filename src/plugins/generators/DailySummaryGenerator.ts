/**
 * @fileoverview Implementation of a daily summary generator for content aggregation
 * Handles generation of daily summaries from various content sources using AI-powered summarization
 */

import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem } from "../../types";
import { createJSONPromptForTopics, createMarkdownPromptForJSON } from "../../helpers/promptHelper";
import { retryOperation } from "../../helpers/generalHelper";
import fs from "fs";
import path from "path";

const hour = 60 * 60 * 1000;

/**
 * Configuration interface for DailySummaryGenerator
 * @interface DailySummaryGeneratorConfig
 * @property {OpenAIProvider} provider - OpenAI provider instance for text generation
 * @property {SQLiteStorage} storage - SQLite storage instance for data persistence
 * @property {string} summaryType - Type of summary to generate
 * @property {string} source - Source identifier for the summaries
 * @property {string} [outputPath] - Optional path for output files
 */
interface DailySummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source?: string;
  outputPath?: string;
  maxGroupsToSummarize?: number;
  groupBySourceType?: boolean;
}

/**
 * DailySummaryGenerator class that generates daily summaries of content
 * Uses AI to summarize content items and organizes them by topics
 */
export class DailySummaryGenerator {
  /** OpenAI provider for text generation */
  private provider: OpenAIProvider;
  /** SQLite storage for data persistence */
  private storage: SQLiteStorage;
  /** Type of summary being generated */
  private summaryType: string;
  /** Source identifier for the summaries (optional) */
  private source: string | undefined;
  /** List of topics to exclude from summaries */
  private blockedTopics: string[] = ['open source'];
  /** Path for output files */
  private outputPath: string;
  /** Max number of groups to summarize */
  private maxGroupsToSummarize: number;
  /** Force Content grouping to be by Source types */
  private groupBySourceType: boolean;

  /**
   * Creates a new DailySummaryGenerator instance
   * @param {DailySummaryGeneratorConfig} config - Configuration object for the generator
   */
  constructor(config: DailySummaryGeneratorConfig) {
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './';
    this.maxGroupsToSummarize = config.maxGroupsToSummarize || 10;
    this.groupBySourceType = config.groupBySourceType || false
  }

  /**
   * Generates and stores a daily summary for a specific date
   * @param {string} dateStr - ISO date string to generate summary for
   * @returns {Promise<void>}
   */
  public async generateAndStoreSummary(dateStr: string): Promise<void> {
    try {
      const currentTime = new Date(dateStr).getTime() / 1000;
      const targetTime = currentTime + (60 * 60 * 24);
      
      let contentItems: ContentItem[];
      if (this.source) {
        console.log(`Fetching content for type: ${this.source}`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.source);
      } else {
        console.log(`Fetching all content types for summary generation.`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime);
      }

      if (contentItems.length === 0) {
        console.warn(`No content found for date ${dateStr} to generate summary.`);
        return;
      }

      const groupedContent = this.groupObjects(contentItems); 
      const allSummariesFromAI: any[] = []; 
      let groupsToSummarize = 0;
      let overallGitHubSummaryText: string | null = null;
      const GITHUB_SUMMARY_TOPIC_ID = 'github_summary';
      const PULL_REQUEST_TOPIC_ID = 'pull_request';

      for (const group of groupedContent) {
        try {
          if (!group) continue;
          const { topic, objects: itemsForThisTopic } = group; 
          
          if (!topic || !itemsForThisTopic || itemsForThisTopic.length <= 0 || groupsToSummarize >= this.maxGroupsToSummarize) {
            if (topic !== GITHUB_SUMMARY_TOPIC_ID) {
                continue;
            }
            if (!topic || !itemsForThisTopic || itemsForThisTopic.length <= 0 ) continue;
          }

          let promptCustomInstructions: { title?: string, aiPrompt?: string, repositoryName?: string, dataProviderName?: string } = {};
          let topicForPrompt = topic;
          console.log(`[DailySummaryGenerator] Preparing to summarize topic: '${topicForPrompt}'. Number of items: ${itemsForThisTopic.length}`);

          if (topic === PULL_REQUEST_TOPIC_ID || topic === "issue") {
            const repoCompany = itemsForThisTopic[0]?.metadata?.githubCompany;
            const repoName = itemsForThisTopic[0]?.metadata?.githubRepo;
            if (repoCompany && repoName) promptCustomInstructions.repositoryName = `${repoCompany}/${repoName}`;
            else console.warn(`[DailySummaryGenerator] Repository details missing for GitHub topic: ${topic}`);
            
            let itemType = topic === "issue" ? "issue" : "pull request";
            promptCustomInstructions.aiPrompt = 
              String.raw`
"""
Please respond ONLY with a valid JSON object. Do not include any additional text, markdown, or any characters before or after the JSON object.

Based on the "Input Item Sources for Analysis" provided by the system (which includes:
  [INDEX], cid, link, title, item_author, item_number, item_state, item_createdAt,
  item_closedAt, item_commentCount, and text_snippet for each item context):

1. For each ${itemType} or group of related ${itemType}s, create a single, information-dense sentence.
   - This summary must include the ${itemType} number, title, author (@item_author), and its current state (item_state, e.g., open, closed, merged).
   - Mention key activities or findings very briefly if possible within the single sentence.

   Example for an issue:
     "Issue #${itemsForThisTopic[0]?.metadata?.number || 'X'} titled '${itemsForThisTopic[0]?.title || 'a topic'}' by @${itemsForThisTopic[0]?.metadata?.author || 'user'} is ${itemsForThisTopic[0]?.metadata?.state || 'open'}"

   Example for a pull request:
     "PR #${itemsForThisTopic[0]?.metadata?.number || 'Y'} by @${itemsForThisTopic[0]?.metadata?.author || 'contributor'} titled '${itemsForThisTopic[0]?.title || 'a feature'}' is ${itemsForThisTopic[0]?.metadata?.state || 'merged'}"

2. The JSON output should be an object with:
   - "title" (string, e.g., "Summary for ${topicForPrompt}")
   - "content" (array of summary entry objects)

3. Each summary entry object in the "content" array must include:
   a. 'text' (string): Your narrative summary of one or more related input ${itemType}s.
   b. 'contributing_item_indices' (array of numbers): An array of 0-based [INDEX] numbers from the input items that this summary text pertains to.

Do NOT include detailed sources (beyond what's in your narrative text), images, or videos in YOUR response; only the contributing_item_indices.
"""
`

          } else if (topic === GITHUB_SUMMARY_TOPIC_ID) {
 
            const repoCompany = itemsForThisTopic[0]?.metadata?.githubCompany;
            const repoName = itemsForThisTopic[0]?.metadata?.githubRepo;
            if (repoCompany && repoName) promptCustomInstructions.repositoryName = `${repoCompany}/${repoName}`;
            promptCustomInstructions.aiPrompt = 
              `Please respond ONLY with a valid JSON object. Do not include any additional text, markdown, or any characters before or after the JSON object.\n\n` +
              `Based on the "Input Item Sources for Analysis" provided by the system (which includes [INDEX], cid, link, and text_snippet for each item context):\n` +
              `1. Summarize the key information from the provided items for the topic '${topicForPrompt}'. This summary should cover overall repository activity like PRs opened/merged, issues, and contributor counts if available in the items.\n` +
              `2. The JSON output should be an object with a "title" (string, e.g., "Overall GitHub Activity for ${promptCustomInstructions.repositoryName}") and a "content" (array of summary entry objects, typically one entry for this overall summary).\n` +
              `3. Each summary entry object in the "content" array must include:
` +
              `   a. 'text' (string): Your overall summary of repository activity.
` +
              `   b. 'contributing_item_indices' (array of numbers): An array of 0-based [INDEX] numbers from the input items that this summary text pertains to.\n` +
              `Do NOT include detailed sources, images, or videos in YOUR response; only the contributing_item_indices.`;
          } else {
 
            if (topic === "crypto market") {
              promptCustomInstructions.dataProviderName = (this as any).config?.marketDataProviderName || "codexAnalytics";
            }
            promptCustomInstructions.aiPrompt = 
              `Please respond ONLY with a valid JSON object. Do not include any additional text, markdown, or any characters before or after the JSON object.\n\n` +
              `Based on the "Input Item Sources for Analysis" provided by the system (which includes [INDEX], cid, link, and text_snippet for each item context):\n` +
              `1. Summarize the key information from the provided items for the topic '${topicForPrompt}'.\n` +
              `2. The JSON output should be an object with a "title" (string, e.g., "Summary for ${topicForPrompt}") and a "content" (array of summary entry objects).\n` +
              `3. Each summary entry object in the "content" array must include:\n` +
              `   a. 'text' (string): Your summary of one or more related input items.\n` +
              `   b. 'contributing_item_indices' (array of numbers): An array of 0-based [INDEX] numbers from the input items that this summary text pertains to.\n` +
              `Example entry: { "text": "Summary of item Z...", "contributing_item_indices": [2] }\n` +
              `Do NOT include detailed sources, images, or videos in YOUR response; only the contributing_item_indices.`;
          }

          const prompt = createJSONPromptForTopics(topicForPrompt, itemsForThisTopic, dateStr, promptCustomInstructions);
          let summaryTextFromAI = await retryOperation(() => this.provider.summarize(prompt));
          console.log(`[DailySummaryGenerator] Raw AI Response for topic '${topicForPrompt}':\n${summaryTextFromAI}`);
          let parsedAIResponse: any = {};
          try {
            let sanitizedJsonString = summaryTextFromAI.replace(/```json\n|```/g, "").trim();
            parsedAIResponse = JSON.parse(sanitizedJsonString);
          } catch (parseError: any) {
            console.warn(`[DailySummaryGenerator] Initial JSON.parse failed for topic '${topicForPrompt}'. Attempting extraction. Error: ${parseError.message}`);
            const firstBrace = summaryTextFromAI.indexOf('{');
            const lastBrace = summaryTextFromAI.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              const extractedJson = summaryTextFromAI.substring(firstBrace, lastBrace + 1);
              try {
                parsedAIResponse = JSON.parse(extractedJson);
                console.log(`[DailySummaryGenerator] Successfully parsed extracted JSON for topic '${topicForPrompt}'.`);
              } catch (secondParseError: any) {
                console.error(`[DailySummaryGenerator] Failed to parse extracted JSON for topic '${topicForPrompt}'. AI Response (substring attempt): ${extractedJson}. Error: ${secondParseError.message}`);
                parsedAIResponse = { title: promptCustomInstructions.title || `Summary for ${topicForPrompt}`, content: [] }; 
              }
            } else {
              console.error(`[DailySummaryGenerator] Could not find JSON in AI response for topic '${topicForPrompt}'. Raw AI Response: ${summaryTextFromAI}`);
              parsedAIResponse = { title: promptCustomInstructions.title || `Summary for ${topicForPrompt}`, content: [] }; 
            }
          }
          
          let finalContentForTopic: any[] = [];
          if (parsedAIResponse.content && Array.isArray(parsedAIResponse.content)) {
            if (topic === PULL_REQUEST_TOPIC_ID && overallGitHubSummaryText) {
              finalContentForTopic.push({ text: overallGitHubSummaryText });
              overallGitHubSummaryText = null;
            }
            parsedAIResponse.content.forEach((aiEntry: any) => {
              {
                if (topic === "crypto market") {
                  if (aiEntry.text) {
                    finalContentForTopic.push(aiEntry.text);
                  }
                } else {
                  const contentEntry: any = {
                    text: aiEntry.text || ""
                  };
                  if (aiEntry.contributing_item_indices && 
                      Array.isArray(aiEntry.contributing_item_indices) && 
                      aiEntry.contributing_item_indices.length === 1) {
                    const index = aiEntry.contributing_item_indices[0];
                    if (index >= 0 && index < itemsForThisTopic.length) {
                      const originalItem = itemsForThisTopic[index];
                      if (originalItem.link) {
                        contentEntry.link = originalItem.link;
                      }
                    }
                  } 
                  finalContentForTopic.push(contentEntry);
                }
              }
            });
          }

          const getHumanReadableTitle = (topic: string, baseTitle: string, repoName?: string, dataProvider?: string) => {
            switch (topic) {
              case 'pull_request':
                return repoName ? `Pull Requests for ${repoName}` : 'Pull Requests';
              case 'issue':
                return repoName ? `Issues for ${repoName}` : 'Issues';
              case 'github_summary':
                return repoName ? `GitHub Summary for ${repoName}` : 'GitHub Activity Summary';
              case 'crypto market':
                return dataProvider ? `Crypto Market Data from ${dataProvider}` : 'Crypto Market Update';
              default:
                return baseTitle;
            }
          };

          const humanReadableTitle = getHumanReadableTitle(topic, parsedAIResponse.title || promptCustomInstructions.title || `Summary for ${topicForPrompt}`, promptCustomInstructions.repositoryName, promptCustomInstructions.dataProviderName);

          const topicSummaryOutput: any = {
            title: humanReadableTitle,
            topic: topic,
            content: finalContentForTopic 
          };

          if (promptCustomInstructions.repositoryName && !topicSummaryOutput.title.includes(promptCustomInstructions.repositoryName)) {
            topicSummaryOutput.repository_name = promptCustomInstructions.repositoryName;
          }
          if (promptCustomInstructions.dataProviderName && !topicSummaryOutput.title.includes(promptCustomInstructions.dataProviderName)) {
            topicSummaryOutput.data_provider = promptCustomInstructions.dataProviderName;
          }
  
          allSummariesFromAI.push(topicSummaryOutput);
          if (topic !== GITHUB_SUMMARY_TOPIC_ID) {
             groupsToSummarize++;
          }
        }
        catch (e: any) {
          console.error(`[DailySummaryGenerator] Error processing group for topic '${group?.topic}': ${e.message}`, e.stack);
        }
      }

      if (allSummariesFromAI.length === 0 && contentItems.length > 0) {
        console.warn(`[DailySummaryGenerator] No summaries were successfully generated for ${dateStr} despite having content items. Check AI provider or prompt issues.`);
        return;
      }

      const summariesToOutput = allSummariesFromAI.map(({ topic, ...rest }) => rest);

      const mdPrompt = createMarkdownPromptForJSON(summariesToOutput, dateStr);
      const markdownReport = await retryOperation(() => this.provider.summarize(mdPrompt));
      const markdownStringFromAI = markdownReport.replace(/```markdown\n|```/g, "");

      const finalReportTitle = `Daily Report - ${dateStr}`;

      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: finalReportTitle,
        categories: JSON.stringify(summariesToOutput, null, 2),
        markdown: markdownStringFromAI,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);
      await this.writeSummaryToFile(dateStr, currentTime, summariesToOutput);
      
      const finalMarkdownContentForFile = `# ${finalReportTitle}\n\n${markdownStringFromAI}`;
      await this.writeMDToFile(dateStr, finalMarkdownContentForFile);

      console.log(`Daily report for ${dateStr} generated and stored successfully.`);
    } catch (error) {
      console.error(`Error generating daily summary for ${dateStr}:`, error);
    }
  }

  public async checkIfFileMatchesDB(dateStr: string, summary: SummaryItem) {
    try {
      let jsonParsed = await this.readSummaryFromFile(dateStr);

      let summaryParsed = {
        type: summary.type,
        title: summary.title,
        categories: JSON.parse(summary.categories || "[]"),
        date: summary.date
      };

      if (!this.deepEqual(jsonParsed, summaryParsed)) {
        console.log("JSON file didn't match database, resaving summary to file.");
        await this.writeSummaryToFile(dateStr, summary.date || new Date().getTime(), summaryParsed.categories);
      }
    }
    catch (error) {
      console.error(`Error checkIfFileMatchesDB:`, error);
    }
  }

  public async generateContent() {
    try {
      const today = new Date();

      let summary: SummaryItem[] = await this.storage.getSummaryBetweenEpoch((today.getTime() - (hour * 24)) / 1000, today.getTime() / 1000);
      
      if (summary && summary.length <= 0) {
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        
        const dateStr = summaryDate.toISOString().slice(0, 10);
        console.log(`Summarizing data from for daily report`);
      
        await this.generateAndStoreSummary(dateStr);
        
        console.log(`Daily report is complete`);
      }
      else {
        console.log('Summary already generated for today, validating file is correct');
        const summaryDate = new Date(today);
        summaryDate.setDate(summaryDate.getDate() - 1);
        
        const dateStr = summaryDate.toISOString().slice(0, 10);

        await this.checkIfFileMatchesDB(dateStr, summary[0]);
      }
    } catch (error) {
      console.error(`Error creating daily report:`, error);
    }
  }

  private deepEqual(obj1: any, obj2: any): boolean {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  private async readSummaryFromFile(dateStr: string): Promise<any> {
    try {
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      const data = fs.readFileSync(filePath, 'utf8');

      return JSON.parse(data);
    }
    catch (error) {
      console.error(`Error reading the file ${dateStr}:`, error);
      return undefined;
    }
  }

  private async writeSummaryToFile(dateStr: string, currentTime: number, allSummaries: any[]): Promise<void> {
    try {
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      fs.writeFileSync(filePath, JSON.stringify({
        type: this.summaryType,
        title: `Daily Report - ${dateStr}`,
        categories: allSummaries,
        date: currentTime,
      }, null, 2));
    }
    catch (error) {
      console.error(`Error saving daily summary to json file ${dateStr}:`, error);
    }
  }

  private async writeMDToFile(dateStr: string, content: string): Promise<void> {
    try {
      const mdDir = path.join(this.outputPath, 'md');
      this.ensureDirectoryExists(mdDir);
      
      const filePath = path.join(mdDir, `${dateStr}.md`);
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving daily summary to markdown file ${dateStr}:`, error);
    }
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private groupObjects(objects: any[]): any[] {
    const topicMap = new Map();

    objects.forEach(obj => {
      if (obj.source.indexOf('github') >= 0) {
        let github_topic;
        if (obj.type === 'githubPullRequestContributor' || obj.type === 'githubPullRequest' || obj.type === 'githubCompletedItem') {
          github_topic = 'pull_request';
        } else if (obj.type === 'githubIssueContributor' || obj.type === 'githubIssue') {
          github_topic = 'issue';
        } else if (obj.type === 'githubCommitContributor') {
          github_topic = 'commit';
        } else if (obj.type === 'githubStatsSummary') {
          github_topic = 'github_summary';
        } else {
          github_topic = 'github_other';
        }
        
        if (!obj.topics) {
          obj.topics = [];
        }
        
        if (!obj.topics.includes(github_topic)) {
          obj.topics.push(github_topic);
        }

        if (!topicMap.has(github_topic)) {
          topicMap.set(github_topic, []);
        }
        topicMap.get(github_topic).push(obj);
      }
      else if (obj.cid.indexOf('analytics') >= 0) {
        let token_topic = 'crypto market';
        if (!obj.topics) {
          obj.topics = [];
        }

        if (!topicMap.has(token_topic)) {
          topicMap.set(token_topic, []);
        }
        topicMap.get(token_topic).push(obj);
      }
      else {
 if (obj.topics && obj.topics.length > 0 && !this.groupBySourceType) {
          obj.topics.forEach((topic: any) => {
            let shortCase = topic.toLowerCase();
            if (!this.blockedTopics.includes(shortCase)) {
              if (!topicMap.has(shortCase)) {
                topicMap.set(shortCase, []);
              }
              topicMap.get(shortCase).push(obj);
            }
          });
        }
        else {
          let shortCase = obj.type.toLowerCase();
          if (!this.blockedTopics.includes(shortCase)) {
            if (!topicMap.has(shortCase)) {
              topicMap.set(shortCase, []);
            }
            topicMap.get(shortCase).push(obj);
          }
        }
      }
    });

    const sortedTopics = Array.from(topicMap.entries()).sort((a, b) => b[1].length - a[1].length);
    const alreadyAdded: any = {};
    let groupedTopics: any[] = [];
    let githubSummaryGroup: any = null;

    const githubTopicNames = ['pull_request', 'issue', 'commit', 'contributors'];

    const otherSortedTopics: any[] = []; 
    for (const [topic, associatedObjects] of sortedTopics) {
      const mergedTopics = new Set<string>();
      associatedObjects.forEach((obj: any) => {
        if (obj.topics) {
          obj.topics.forEach((t: any) => mergedTopics.add(t.toLowerCase()));
        }
      });

      if (topic === 'github_summary') {
        githubSummaryGroup = { topic, objects: associatedObjects, allTopics: Array.from(mergedTopics) };
      } else {
        otherSortedTopics.push([topic, associatedObjects]);
      }
    }


    if (githubSummaryGroup) {
      if (!alreadyAdded[githubSummaryGroup.topic]) {
        alreadyAdded[githubSummaryGroup.topic] = true;
        groupedTopics.push(githubSummaryGroup);
      }
    }

    otherSortedTopics.forEach(([topic, associatedObjects]) => {
      if (githubTopicNames.includes(topic)) {
        if (!alreadyAdded[topic]) {
          const mergedTopics = new Set<string>();
          associatedObjects.forEach((obj: any) => {
            if (obj.topics) {
              obj.topics.forEach((t: any) => mergedTopics.add(t.toLowerCase()));
            }
          });
          alreadyAdded[topic] = true;
          groupedTopics.push({ topic, objects: associatedObjects, allTopics: Array.from(mergedTopics) });
        }
      }
    });

    otherSortedTopics.forEach(([topic, associatedObjects]) => {
      if (alreadyAdded[topic]) return;

      const mergedTopics = new Set<string>();
      associatedObjects.forEach((obj: any) => {
        if (obj.topics) {
          obj.topics.forEach((t: any) => mergedTopics.add(t.toLowerCase()));
        }
      });

      if (!(associatedObjects && associatedObjects.length > 1 && topic !== 'crypto market')) {
        alreadyAdded[topic] = true;
        groupedTopics.push({ topic, objects: associatedObjects, allTopics: Array.from(mergedTopics) });
      }
    });
    
    return groupedTopics;
  }
}
