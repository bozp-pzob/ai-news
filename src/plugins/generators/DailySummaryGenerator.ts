/**
 * @fileoverview Implementation of a daily summary generator for content aggregation
 * Handles generation of daily summaries from various content sources using AI-powered summarization
 */

import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import { ContentItem, SummaryItem } from "../../types";
import { createJSONPromptForTopics, createMarkdownPromptForJSON } from "../../helpers/promptHelper";
import { retryOperation } from "../../helpers/generalHelper";
import { enrichAiSummaryContent } from "../../helpers/summaryHelper";
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

      for (const group of groupedContent) {
        try {
          if (!group) continue;
          // itemsForThisTopic are the original ContentItems for the current group/topic
          const { topic, objects: itemsForThisTopic } = group; 
          
          if (!topic || !itemsForThisTopic || itemsForThisTopic.length <= 0 || groupsToSummarize >= this.maxGroupsToSummarize) continue;

          let promptCustomInstructions: { title?: string, aiPrompt?: string, repositoryName?: string, dataProviderName?: string } = {};
          let topicForPrompt = topic;
          let isTwitterActivity = false;
          
          console.log(`[DailySummaryGenerator] Preparing to summarize topic: '${topicForPrompt}'. Number of items: ${itemsForThisTopic.length}`);
          // Note: contextObjectsForAI is not directly used further down if promptHelper formats its own context, 
          // but it was part of a previous logging strategy. We pass itemsForThisTopic to createJSONPromptForTopics.
          // If createJSONPromptForTopics *doesn't* internally map itemsForThisTopic to a context like this,
          // then itemsForThisTopic (original ContentItems) are sent directly.
          // The important part is that promptHelper receives the raw items to extract all needed fields.

          if (topic === "twitter_activity") { 
            isTwitterActivity = true;
            topicForPrompt = "Twitter Activity"; 
            promptCustomInstructions.title = (this as any).config?.twitterSummaryTitle || "Thematic Twitter Activity Summary";
            itemsForThisTopic.sort((a: ContentItem, b: ContentItem) => { 
              const userA = a.metadata?.authorUserName || a.metadata?.retweetedByUserName || '';
              const userB = b.metadata?.authorUserName || b.metadata?.retweetedByUserName || '';
              if (userA.localeCompare(userB) !== 0) return userA.localeCompare(userB);
              const convoIdA = a.metadata?.thread?.conversationId || '';
              const convoIdB = b.metadata?.thread?.conversationId || '';
              if (convoIdA.localeCompare(convoIdB) !== 0) return convoIdA.localeCompare(convoIdB);
              return (a.date || 0) - (b.date || 0);
            });
            const baseAiPrompt = (this as any).config?.twitterAdditionalInstructions || "";
            promptCustomInstructions.aiPrompt = 
              `Please respond ONLY with a valid JSON object. Do not include any additional text, markdown, or any characters before or after the JSON object.\n\n` +
              `${baseAiPrompt}\n` +
              `Based on the detailed "Input Tweet Sources for Analysis" provided by the system (which includes cid, tweet_url, author, author_pfp_url, tweet_text_snippet, media_images, media_videos, likes, retweets for each tweet context):\n` +
              `1. Identify key themes or subjects from the tweets.\n` +
              `2. For each theme, construct a JSON object. The top-level JSON response should be an object with a "title" (string, e.g., "${promptCustomInstructions.title}") and a "content" (array of these theme objects).\n` +
              `3. Each theme object in the "content" array must include:\n` +
              `   a. 'theme_title' (string): A concise title for the identified theme.\n` +
              `   b. 'text' (string): Your summary of the theme, synthesizing information from the relevant tweets and attributing key statements or actions to specific authors (e.g., "@userX mentioned...").\n` +
              `   c. 'contributing_tweets' (array of objects): An array of tweet objects that directly contributed to this theme. For each tweet in this array, extract the following details PRECISELY from the corresponding input tweet context provided by the system:\n` +
              `      {\n` +
              `        "cid": "string (the unique ID of the tweet, from cid)",\n` +
              `        "author": "string (the @username of the tweet author)",\n` +
              `        "author_pfp": "string (URL of the author's profile picture, from author_pfp_url)",\n` +
              `        "tweet_url": "string (the direct URL to the tweet, from tweet_url)",\n` +
              `        "tweet_text_snippet": "string (the provided text snippet of the tweet, from tweet_text_snippet)",\n` +
              `        "media": {\n` +
              `          "images": ["string (array of image URLs from media_images)"],\n` +
              `          "videos": ["string (array of video URLs from media_videos)"]\n` +
              `        },\n` +
              `        "likes": "number (number of likes, from likes)",\n` +
              `        "retweets": "number (number of retweets, from retweets)"\n` +
              `      }\n` +
              `Ensure you accurately map the data from the input context (cid, author, author_pfp_url, tweet_url, etc.) to these fields for each contributing tweet.`;

          } else { // For non-Twitter topics (GitHub, Crypto, Misc, etc.)
            if (topic === "issue" || topic === "pull_request") {
              const repoCompany = itemsForThisTopic[0]?.metadata?.githubCompany;
              const repoName = itemsForThisTopic[0]?.metadata?.githubRepo;
              if (repoCompany && repoName) promptCustomInstructions.repositoryName = `${repoCompany}/${repoName}`;
              else console.warn(`[DailySummaryGenerator] Repository details missing for GitHub topic: ${topic}`);
            } else if (topic === "crypto market") {
              promptCustomInstructions.dataProviderName = (this as any).config?.marketDataProviderName || "codexAnalytics";
            }
            promptCustomInstructions.aiPrompt = 
              `Please respond ONLY with a valid JSON object. Do not include any additional text, markdown, or any characters before or after the JSON object.\n\n` +
              `Based on the "Input Item Sources for Analysis" provided by the system (which includes cid, link, text_snippet for each item context):\n` +
              `1. Summarize the key information from the provided items for the topic '${topicForPrompt}'.\n` +
              `2. The JSON output should be an object with a "title" (string, e.g., "Summary for ${topicForPrompt}") and a "content" (array of summary entry objects).\n` +
              `3. Each summary entry object in the "content" array must include:\n` +
              `   a. 'text' (string): Your summary of one or more related input items.\n` +
              `   b. 'contributing_item_cids' (array of strings): An array of 'cid' strings from the input items that this summary text pertains to.\n` +
              `Example entry: { "text": "Summary of item Z...", "contributing_item_cids": ["cid_Z"] }\n` +
              `Do NOT include detailed sources, images, or videos in YOUR response; only the CIDs.`;
          }

          // Pass original itemsForThisTopic to createJSONPromptForTopics, 
          // as promptHelper.ts now handles formatting the input context for the AI.
          const prompt = createJSONPromptForTopics(topicForPrompt, itemsForThisTopic, dateStr, promptCustomInstructions);
          
          let summaryTextFromAI = await retryOperation(() => this.provider.summarize(prompt));
          console.log(`[DailySummaryGenerator] Raw AI Response for topic '${topicForPrompt}':\n${summaryTextFromAI}`);
          
          let parsedAIResponse: any;
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
          
          console.log(`[DailySummaryGenerator] Parsed AI Response for topic '${topicForPrompt}':\n${JSON.stringify(parsedAIResponse, null, 2)}`);
          if (parsedAIResponse.content && Array.isArray(parsedAIResponse.content)) {
            parsedAIResponse.content.forEach((entry: any, index: number) => {
              const cidsToLog = isTwitterActivity ? "(Full contributing_tweets structure expected)" : JSON.stringify(entry.contributing_item_cids);
              console.log(`[DailySummaryGenerator] AI Response content entry ${index} for topic '${topicForPrompt}' - CIDs/Structure: ${cidsToLog}`);
            });
          }

          let finalContentForTopic: any[];

          if (isTwitterActivity) {
            // For Twitter, AI is expected to return the fully structured contributing_tweets in parsedAIResponse.content (which are themes)
            // Each theme object in parsedAIResponse.content should have a contributing_tweets array.
            finalContentForTopic = parsedAIResponse.content || []; 
            if (Array.isArray(finalContentForTopic)) {
                finalContentForTopic.forEach(theme => {
                    if (theme.contributing_tweets && Array.isArray(theme.contributing_tweets)) {
                        // Data is already structured by AI as per prompt.
                    } else {
                        // If AI failed to provide contributing_tweets for a theme, ensure it's an empty array.
                        // Also log if the AI provided contributing_item_cids instead, which would be a deviation.
                        if(theme.contributing_item_cids) {
                            console.warn(`[DailySummaryGenerator] Twitter theme '${theme.theme_title}' received 'contributing_item_cids' instead of 'contributing_tweets'. Discarding CIDs and setting empty tweets array.`);
                        }
                        theme.contributing_tweets = []; 
                    }
                    // Remove contributing_item_cids if AI mistakenly added it for Twitter themes
                    delete theme.contributing_item_cids;
                });
            }
          } else {
            // For other topics, use enrichAiSummaryContent to build the sources array from CIDs
            finalContentForTopic = enrichAiSummaryContent(
              parsedAIResponse.content, // This content has {text, contributing_item_cids}
              itemsForThisTopic,        // Original items for lookup
              isTwitterActivity         // false for non-Twitter topics
            );
          }

          const topicSummaryOutput: any = {
            title: parsedAIResponse.title || promptCustomInstructions.title || `Summary for ${topicForPrompt}`,
            topic: topic,
            content: finalContentForTopic 
          };

          if (promptCustomInstructions.repositoryName) {
            topicSummaryOutput.repository_name = promptCustomInstructions.repositoryName;
          }
          if (promptCustomInstructions.dataProviderName) {
            topicSummaryOutput.data_provider = promptCustomInstructions.dataProviderName;
          }
  
          allSummariesFromAI.push(topicSummaryOutput);
          groupsToSummarize++;
        }
        catch (e: any) {
          console.error(`[DailySummaryGenerator] Error processing group for topic '${group?.topic}': ${e.message}`, e.stack);
        }
      }

      if (allSummariesFromAI.length === 0 && contentItems.length > 0) {
        console.warn(`[DailySummaryGenerator] No summaries were successfully generated for ${dateStr} despite having content items. Check AI provider or prompt issues.`);
        return;
      }

      const mdPrompt = createMarkdownPromptForJSON(allSummariesFromAI, dateStr);
      const markdownReport = await retryOperation(() => this.provider.summarize(mdPrompt));
      const markdownStringFromAI = markdownReport.replace(/```markdown\n|```/g, "");

      const finalReportTitle = `Daily Report - ${dateStr}`;

      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: finalReportTitle,
        categories: JSON.stringify(allSummariesFromAI, null, 2),
        markdown: markdownStringFromAI,
        date: currentTime,
      };

      await this.storage.saveSummaryItem(summaryItem);
      await this.writeSummaryToFile(dateStr, currentTime, allSummariesFromAI);
      
      // Construct the full markdown content for the file
      const finalMarkdownContentForFile = `# ${finalReportTitle}\n\n${markdownStringFromAI}`;
      await this.writeMDToFile(dateStr, finalMarkdownContentForFile);

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
        if (obj.source && (obj.source.toLowerCase().includes('twitter') || obj.source.toLowerCase().includes('tweet'))) {
          // Group all Twitter items (tweets and retweets) under a single topic
          const twitterActivityTopic = "twitter_activity"; 
          if (!this.blockedTopics.includes(twitterActivityTopic)) {
            if (!topicMap.has(twitterActivityTopic)) {
              topicMap.set(twitterActivityTopic, []);
            }
            topicMap.get(twitterActivityTopic).push(obj);
          }
        } else if (obj.topics && obj.topics.length > 0 && !this.groupBySourceType) {
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
