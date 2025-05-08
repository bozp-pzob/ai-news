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
        name: 'outputPath',
        type: 'string',
        required: false,
        description: 'Location to store summary for md and json generation'
      }
    ]
  };
  
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
      
      // Fetch items based on whether a specific source type was configured
      let contentItems: ContentItem[];
      if (this.source) {
        console.log(`Fetching content for type: ${this.source}`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.source);
      } else {
        console.log(`Fetching all content types for summary generation.`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime); // Fetch all types
      }

      if (contentItems.length === 0) {
        console.warn(`No content found for date ${dateStr} to generate summary.`);
        return;
      }

      const groupedContent = this.groupObjects(contentItems);

      const allSummaries: any[] = [];
      let groupsToSummarize = 0;

      for (const grouped of groupedContent) {
        try {
          if (!grouped) continue;
          const { topic, objects } = grouped;
          
          if (!topic || !objects || objects.length <= 0 || groupsToSummarize >= this.maxGroupsToSummarize) continue;

          const prompt = createJSONPromptForTopics(topic, objects, dateStr);
          const summaryText = await retryOperation(() => this.provider.summarize(prompt));
          const summaryJSONString = summaryText.replace(/```json\n|```/g, "");
          let summaryJSON = JSON.parse(summaryJSONString);
          summaryJSON["topic"] = topic;
  
          allSummaries.push(summaryJSON);
          groupsToSummarize++;
        }
        catch (e) {
          console.log(e);
        }
      }

      const mdPrompt = createMarkdownPromptForJSON(allSummaries, dateStr);
      const markdownReport = await retryOperation(() => this.provider.summarize(mdPrompt));
      const markdownString = markdownReport.replace(/```markdown\n|```/g, "");

      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: `Daily Report - ${dateStr}`,
        categories: JSON.stringify(allSummaries, null, 2),
        markdown: markdownString,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);
      await this.writeSummaryToFile(dateStr, currentTime, allSummaries);
      await this.writeMDToFile(dateStr, markdownString);

      console.log(`Daily report for ${dateStr} generated and stored successfully.`);
    } catch (error) {
      console.error(`Error generating daily summary for ${dateStr}:`, error);
    }
  }

  /**
   * Checks if a file's content matches the database record and updates if needed
   * @param {string} dateStr - ISO date string to check
   * @param {SummaryItem} summary - Summary item from database
   * @returns {Promise<void>}
   */
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

  /**
   * Generates content for the current day if not already generated
   * @returns {Promise<void>}
   */
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

  /**
   * Deep equality comparison of two objects
   * @private
   * @param {any} obj1 - First object to compare
   * @param {any} obj2 - Second object to compare
   * @returns {boolean} True if objects are deeply equal
   */
  private deepEqual(obj1: any, obj2: any) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  /**
   * Reads a summary from a JSON file
   * @private
   * @param {string} dateStr - ISO date string for the summary
   * @returns {Promise<any>} Parsed summary data
   */
  private async readSummaryFromFile(dateStr: string) {
    try {
      const jsonDir = path.join(this.outputPath, 'json');
      this.ensureDirectoryExists(jsonDir);
      
      const filePath = path.join(jsonDir, `${dateStr}.json`);
      const data = fs.readFileSync(filePath, 'utf8');

      return JSON.parse(data);
    }
    catch (error) {
      console.error(`Error reading the file ${dateStr}:`, error);
    }
  }

  /**
   * Writes a summary to a JSON file
   * @private
   * @param {string} dateStr - ISO date string for the summary
   * @param {number} currentTime - Current timestamp
   * @param {any[]} allSummaries - Array of summaries to write
   * @returns {Promise<void>}
   */
  private async writeSummaryToFile(dateStr: string, currentTime: number, allSummaries: any[]) {
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

  /**
   * Writes a summary to a Markdown file
   * @private
   * @param {string} dateStr - ISO date string for the summary
   * @param {string} content - Markdown content to write
   * @returns {Promise<void>}
   */
  private async writeMDToFile(dateStr: string, content: string) {
    try {
      const mdDir = path.join(this.outputPath, 'md');
      this.ensureDirectoryExists(mdDir);
      
      const filePath = path.join(mdDir, `${dateStr}.md`);
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving daily summary to markdown file ${dateStr}:`, error);
    }
  }

  /**
   * Ensures a directory exists, creating it if necessary
   * @private
   * @param {string} dirPath - Path to the directory
   */
  private ensureDirectoryExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Groups content items, handling special cases for GitHub and crypto content
   * @private
   * @param {any[]} objects - Array of content items to group
   * @returns {any[]} Array of grouped content
   */
  private groupObjects(objects: any[]): any[] {
    const topicMap = new Map();

    objects.forEach(obj => {
      // Handle GitHub content
      if (obj.source.indexOf('github') >= 0) {
        let github_topic;
        if (obj.type === 'githubPullRequestContributor' || obj.type === 'githubPullRequest') {
          github_topic = 'pull_request';
        } else if (obj.type === 'githubIssueContributor' || obj.type === 'githubIssue') {
          github_topic = 'issue';
        } else if (obj.type === 'githubCommitContributor') {
          github_topic = 'commit';
        } else if (obj.type === 'githubStatsSummary') {
          github_topic = 'github_summary';
        } else if (obj.type === 'githubTopContributors') {
          github_topic = 'contributors';
        } else if (obj.type === 'githubCompletedItem') {
          github_topic = 'completed_items';
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
      // Handle crypto analytics content
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
      // Handle general content with topics
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

    // Sort topics by number of items and handle miscellaneous content
    const sortedTopics = Array.from(topicMap.entries()).sort((a, b) => b[1].length - a[1].length);
    const alreadyAdded: any = {};

    const miscTopics: any = {
      topic: 'Misceleanous',
      objects: [],
      allTopics: []
    };

    let groupedTopics: any[] = [];

    sortedTopics.forEach(([topic, associatedObjects]) => {
      const mergedTopics = new Set();
      let topicAlreadyAdded = false;
      associatedObjects.forEach((obj: any) => {
        if (obj.topics) {
          obj.topics.forEach((t: any) => {
            let lower = t.toLowerCase();

            if (alreadyAdded[lower]) {
              topicAlreadyAdded = true;
            }
            else {
              mergedTopics.add(lower);
            }
          });
        }
      });
      
      // Handle GitHub topics separately
      if (topic === 'pull_request' || topic === 'issue' || topic === 'commit' || 
          topic === 'github_summary' || topic === 'contributors' || topic === 'completed_items') {
        if (!topicAlreadyAdded) {
          alreadyAdded[topic] = true;
          groupedTopics.push({
            topic,
            objects: associatedObjects,
            allTopics: Array.from(mergedTopics)
          });
        }
      }
      // Group small topics into miscellaneous
      else if (associatedObjects && associatedObjects.length <= 1) {
        let objectIds = associatedObjects.map((object: any) => object.id);
        let alreadyAddedToMisc = miscTopics["objects"].find((object: any) => objectIds.indexOf(object.id) >= 0);
        if (!alreadyAddedToMisc) {
          miscTopics["objects"] = miscTopics["objects"].concat(associatedObjects);
          miscTopics["allTopics"] = miscTopics["allTopics"].concat(Array.from(mergedTopics));
        }
      } 
      // Add other topics normally
      else if (!topicAlreadyAdded) {
        alreadyAdded[topic] = true;
        groupedTopics.push({
          topic,
          objects: associatedObjects,
          allTopics: Array.from(mergedTopics)
        });
      }
    });
    
    groupedTopics.push(miscTopics);

    return groupedTopics;
  }
}
