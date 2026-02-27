/**
 * @fileoverview Daily summary generator that reads content from storage, groups it by topic,
 * and uses AI to produce structured JSON and markdown summaries.
 * 
 * Implements GeneratorPlugin: reads from storage, calls AI, returns results.
 * Does NOT write to storage or filesystem — the caller handles all persistence.
 */

import { OpenAIProvider } from "../ai/OpenAIProvider";
import { SQLiteStorage } from "../storage/SQLiteStorage";
import {
  ContentItem,
  SummaryItem,
  GeneratorPlugin,
  GeneratorResult,
  GeneratorContext,
  GeneratorStats,
  FileOutput,
  BudgetExhaustedError,
} from "../../types";
import {
  createJSONPromptForTopics,
  createMarkdownPromptForJSON,
  PromptMediaOptions,
  SUMMARIZE_OPTIONS,
} from "../../helpers/promptHelper";
import { createMediaLookup, findManifestPath, MediaLookup } from "../../helpers/mediaHelper";
import { computeContentHash } from "../../helpers/fileHelper";
import { retryOperation } from "../../helpers/generalHelper";

/**
 * Configuration interface for DailySummaryGenerator
 */
interface DailySummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  summaryType: string;
  source?: string;
  maxGroupsToSummarize?: number;
  groupBySourceType?: boolean;
  /** Path to media manifest for CDN URL enrichment */
  mediaManifestPath?: string;
  /** Topics to exclude from summaries (default: ['open source']) */
  blockedTopics?: string[];
  /** UTC hour (0-23) after which daily summary generation is allowed (default: 20 / 8 PM) */
  generateAfterHour?: number;
  /** Output path — used only for media manifest auto-discovery */
  outputPath?: string;
}

/**
 * DailySummaryGenerator produces daily summaries of content grouped by topic.
 * 
 * Implements GeneratorPlugin:
 * - Reads ContentItems from storage for the target date
 * - Groups content by topic (or source type)
 * - Sends each group through AI summarization
 * - Produces hierarchical markdown report
 * - Returns GeneratorResult with SummaryItem and FileOutputs — caller saves them
 */
export class DailySummaryGenerator implements GeneratorPlugin {
  public readonly name: string;
  public readonly outputType: string;
  public readonly supportsChaining = true;

  /** UTC hour (0-23) after which daily summary generation is allowed. Exposed for entry points to check. */
  public readonly generateAfterHour: number;

  private provider: OpenAIProvider;
  private storage: SQLiteStorage;
  private summaryType: string;
  private source: string | undefined;
  private blockedTopics: string[];
  private maxGroupsToSummarize: number;
  private groupBySourceType: boolean;
  private mediaManifestPath: string | undefined;
  private mediaLookup: MediaLookup | null = null;
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
        description: 'Storage Plugin to read content items from.'
      },
      {
        name: 'summaryType',
        type: 'string',
        required: true,
        description: 'Type for summary stored in the database (e.g., "dailySummary", "elizaosDailySummary").'
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Specific content type to generate the summary from. If omitted, uses all types.'
      },
      {
        name: 'maxGroupsToSummarize',
        type: 'string',
        required: false,
        description: 'Max number of topic groups to generate summaries for (default 10).'
      },
      {
        name: 'groupBySourceType',
        type: 'boolean',
        required: false,
        description: 'Group by source type from storage, instead of topics generated from enriching.'
      },
      {
        name: 'mediaManifestPath',
        type: 'string',
        required: false,
        description: 'Path to media manifest JSON for CDN URL enrichment in summaries.'
      },
      {
        name: 'blockedTopics',
        type: 'string[]',
        required: false,
        description: 'Topics to exclude from summaries (default: ["open source"]).'
      },
      {
        name: 'generateAfterHour',
        type: 'number',
        required: false,
        description: 'UTC hour (0-23) after which the daily summary is generated. Defaults to 20 (8 PM UTC). Set to 0 to generate immediately.'
      }
    ]
  };

  constructor(config: DailySummaryGeneratorConfig) {
    this.name = (config as any).name || 'DailySummaryGenerator';
    this.provider = config.provider;
    this.storage = config.storage;
    this.summaryType = config.summaryType;
    this.outputType = config.summaryType;
    this.source = config.source;
    this.outputPath = config.outputPath || './';
    this.maxGroupsToSummarize = config.maxGroupsToSummarize || 10;
    this.groupBySourceType = config.groupBySourceType || false;
    this.mediaManifestPath = config.mediaManifestPath;
    this.blockedTopics = config.blockedTopics || ['open source'];
    this.generateAfterHour = typeof config.generateAfterHour === 'string'
      ? parseInt(config.generateAfterHour, 10)
      : (config.generateAfterHour ?? 20);
  }

  // ============================================
  // GeneratorPlugin interface
  // ============================================

  /**
   * Generate a daily summary for a specific date.
   * 
   * Reads content items from storage, groups by topic, AI-summarizes each group,
   * produces a hierarchical markdown report, and returns the result.
   * Does NOT save to storage or write files — caller handles persistence.
   * 
   * @param dateStr - ISO date string (YYYY-MM-DD)
   * @param context - Optional context for chaining, budget, and force-regeneration
   * @returns GeneratorResult with summaryItems and fileOutputs
   */
  public async generate(dateStr: string, context?: GeneratorContext): Promise<GeneratorResult> {
    const startTime = Date.now();

    try {
      const currentTime = Math.floor(new Date(dateStr).getTime() / 1000);
      const targetTime = currentTime + (60 * 60 * 24);

      // Fetch items based on whether a specific source type was configured
      let contentItems: ContentItem[];
      if (this.source) {
        console.log(`[DailySummaryGenerator] Fetching content for type: ${this.source}`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime, this.source);
      } else {
        console.log(`[DailySummaryGenerator] Fetching all content types for summary generation.`);
        contentItems = await this.storage.getContentItemsBetweenEpoch(currentTime, targetTime);
      }

      if (contentItems.length === 0) {
        console.warn(`[DailySummaryGenerator] No content found for date ${dateStr}.`);
        return {
          success: true,
          summaryItems: [],
          skipped: true,
          stats: this.buildStats(0, startTime),
        };
      }

      // Content hash check — skip if source data hasn't changed (unless forced)
      const contentHash = computeContentHash(contentItems);
      if (!context?.force) {
        const existingSummaries = await this.storage.getSummaryBetweenEpoch(currentTime, currentTime);
        const existingSummary = existingSummaries.find(s => s.type === this.summaryType);
        if (existingSummary?.contentHash && existingSummary.contentHash === contentHash) {
          console.log(`[DailySummaryGenerator] Source data unchanged for ${dateStr} (hash: ${contentHash.slice(0, 12)}...), skipping.`);
          return {
            success: true,
            summaryItems: [],
            skipped: true,
            stats: this.buildStats(contentItems.length, startTime),
          };
        }
      }

      // Reset provider usage stats so we can track this generation's token usage
      this.provider.resetUsageStats();

      // Set token budget on the provider if provided
      if (context?.tokenBudget && this.provider.setTokenBudget) {
        this.provider.setTokenBudget(context.tokenBudget);
      }

      // Load media lookup for CDN URL enrichment
      const mediaLookup = await this.getMediaLookup();
      const mediaOptions: PromptMediaOptions | undefined = mediaLookup
        ? { mediaLookup, dateStr, maxImagesPerSource: 5, maxVideosPerSource: 3 }
        : undefined;

      if (mediaOptions) {
        const mediaForDate = mediaLookup!.getMediaForDate(dateStr);
        console.log(`[DailySummaryGenerator] Found ${mediaForDate.length} media items for ${dateStr}`);
      }

      // Group and summarize
      const groupedContent = this.groupObjects(contentItems);
      const allSummaries: any[] = [];
      let groupsToSummarize = 0;

      for (const grouped of groupedContent) {
        try {
          if (!grouped) continue;
          const { topic, objects } = grouped;
          if (!topic || !objects || objects.length <= 0 || groupsToSummarize >= this.maxGroupsToSummarize) continue;

          const summaryJSON = await this.summarizeTopicGroup(topic, objects, dateStr);
          if (summaryJSON) {
            allSummaries.push(summaryJSON);
            groupsToSummarize++;
          }
        } catch (e) {
          if (e instanceof BudgetExhaustedError) {
            console.warn(`[DailySummaryGenerator] Budget exhausted during topic summarization, returning partial results.`);
            break;
          }
          console.error(`[DailySummaryGenerator] Error summarizing topic group:`, e);
        }
      }

      // Generate hierarchical markdown report
      let markdownString: string;
      try {
        const markdownReport = await this.hierarchicalSummarize(allSummaries, dateStr);
        markdownString = markdownReport.replace(/```markdown\n|```/g, "");
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          console.warn(`[DailySummaryGenerator] Budget exhausted during markdown generation, using partial summary.`);
          markdownString = `# Daily Report - ${dateStr}\n\n*Summary truncated due to budget limits.*`;
        } else {
          throw e;
        }
      }

      // Build SummaryItem
      const usageStats = this.provider.getUsageStats();
      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: `Daily Report - ${dateStr}`,
        categories: JSON.stringify(allSummaries, null, 2),
        markdown: markdownString,
        date: currentTime,
        contentHash,
        granularity: 'daily',
        tokensUsed: usageStats.totalTokens,
        estimatedCostUsd: usageStats.estimatedCostUsd,
      };

      // Build FileOutputs
      const fileOutputs: FileOutput[] = [
        {
          relativePath: `json/${dateStr}.json`,
          content: JSON.stringify({
            type: this.summaryType,
            title: `Daily Report - ${dateStr}`,
            categories: allSummaries,
            date: currentTime,
          }, null, 2),
          format: 'json',
        },
        {
          relativePath: `md/${dateStr}.md`,
          content: markdownString,
          format: 'md',
        },
      ];

      // Clear token budget
      if (this.provider.clearTokenBudget) {
        this.provider.clearTokenBudget();
      }

      console.log(`[DailySummaryGenerator] Daily report for ${dateStr} generated (${usageStats.totalTokens} tokens, $${usageStats.estimatedCostUsd.toFixed(4)}).`);

      return {
        success: true,
        summaryItems: [summaryItem],
        fileOutputs,
        stats: this.buildStats(contentItems.length, startTime),
      };
    } catch (error) {
      // Clear token budget on error
      if (this.provider.clearTokenBudget) {
        this.provider.clearTokenBudget();
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[DailySummaryGenerator] Error generating daily summary for ${dateStr}:`, errorMsg);

      return {
        success: false,
        summaryItems: [],
        error: errorMsg,
        stats: this.buildStats(0, startTime),
      };
    }
  }

  // ============================================
  // Internal helpers
  // ============================================

  /**
   * Build GeneratorStats from current provider usage and timing.
   */
  private buildStats(itemsProcessed: number, startTime: number): GeneratorStats {
    const usageStats = this.provider.getUsageStats();
    return {
      itemsProcessed,
      tokensUsed: usageStats.totalTokens,
      estimatedCostUsd: usageStats.estimatedCostUsd,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Get or initialize the MediaLookup instance.
   */
  private async getMediaLookup(): Promise<MediaLookup | null> {
    if (this.mediaLookup) {
      return this.mediaLookup;
    }

    let manifestPath = this.mediaManifestPath;
    if (!manifestPath && this.source) {
      manifestPath = findManifestPath(this.source, this.outputPath) || undefined;
    }

    if (manifestPath) {
      console.log(`[DailySummaryGenerator] Loading media manifest from: ${manifestPath}`);
      this.mediaLookup = await createMediaLookup(manifestPath);
      if (this.mediaLookup) {
        const stats = this.mediaLookup.getStats();
        console.log(`[DailySummaryGenerator] Media loaded: ${stats.totalImages} images, ${stats.totalVideos} videos`);
      }
    }

    return this.mediaLookup;
  }

  /**
   * Performs hierarchical summarization to handle large datasets within token limits.
   * Recursively summarizes chunks until all content fits in one final summary.
   */
  private async hierarchicalSummarize(summaries: any[], dateStr: string, chunkSize: number = 8): Promise<string> {
    if (!summaries || summaries.length === 0) {
      return `# Daily Report - ${dateStr}\n\nNo content to summarize.`;
    }

    if (summaries.length <= chunkSize) {
      console.log(`[DailySummaryGenerator] Direct summarization of ${summaries.length} summaries`);
      const mdPrompt = createMarkdownPromptForJSON(summaries, dateStr);
      return await retryOperation(() => this.provider.summarize(mdPrompt, SUMMARIZE_OPTIONS.markdownConversion));
    }

    console.log(`[DailySummaryGenerator] Hierarchical summarization: ${summaries.length} summaries in chunks of ${chunkSize}`);
    const chunks: any[][] = [];
    for (let i = 0; i < summaries.length; i += chunkSize) {
      chunks.push(summaries.slice(i, i + chunkSize));
    }

    const chunkSummaries = await Promise.all(
      chunks.map(async (chunk, index) => {
        console.log(`[DailySummaryGenerator] Processing chunk ${index + 1}/${chunks.length} (${chunk.length} items)`);
        const chunkPrompt = createMarkdownPromptForJSON(chunk, `${dateStr} - Part ${index + 1}`);
        const chunkResult = await retryOperation(() => this.provider.summarize(chunkPrompt, SUMMARIZE_OPTIONS.markdownConversion));
        return {
          topic: `Summary Part ${index + 1}`,
          content: [{
            text: chunkResult.replace(/```markdown\n|```/g, ""),
            sources: [],
            images: [],
            videos: []
          }]
        };
      })
    );

    console.log(`[DailySummaryGenerator] Combining ${chunkSummaries.length} chunk summaries`);
    return await this.hierarchicalSummarize(chunkSummaries, dateStr, chunkSize);
  }

  /**
   * Rough token estimate (~4 chars per token).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Summarizes a topic group, automatically chunking if the content exceeds token limits.
   */
  private async summarizeTopicGroup(topic: string, objects: any[], dateStr: string): Promise<any | null> {
    const providerContext = this.provider.getContextLength?.() || 0;
    const MAX_TOKENS = providerContext > 0 ? Math.floor(providerContext * 0.8) : 100000;

    const fullPrompt = createJSONPromptForTopics(topic, objects, dateStr);
    const estimatedTokens = this.estimateTokens(fullPrompt);

    if (estimatedTokens <= MAX_TOKENS) {
      const summaryText = await retryOperation(() => this.provider.summarize(fullPrompt, SUMMARIZE_OPTIONS.topicSummary));
      const summaryJSONString = summaryText.replace(/```json\n|```/g, "");
      const summaryJSON = JSON.parse(summaryJSONString);
      summaryJSON["topic"] = topic;
      return summaryJSON;
    }

    console.log(`[DailySummaryGenerator] Topic "${topic}" has ~${estimatedTokens} tokens (${objects.length} items), chunking`);

    const ratio = Math.ceil(estimatedTokens / MAX_TOKENS);
    const chunkSize = Math.max(1, Math.ceil(objects.length / ratio));
    const chunks: any[][] = [];
    for (let i = 0; i < objects.length; i += chunkSize) {
      chunks.push(objects.slice(i, i + chunkSize));
    }

    console.log(`[DailySummaryGenerator] Split into ${chunks.length} chunks of ~${chunkSize} items each`);

    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkPrompt = createJSONPromptForTopics(topic, chunks[i], dateStr);
      const chunkTokens = this.estimateTokens(chunkPrompt);
      console.log(`[DailySummaryGenerator] Summarizing chunk ${i + 1}/${chunks.length} (~${chunkTokens} tokens, ${chunks[i].length} items)`);

      const summaryText = await retryOperation(() => this.provider.summarize(chunkPrompt, SUMMARIZE_OPTIONS.topicSummary));
      const cleanText = summaryText.replace(/```json\n|```/g, "");
      chunkSummaries.push(cleanText);
    }

    const partsXml = chunkSummaries.map((s, i) => `  <part index="${i + 1}">\n${s}\n  </part>`).join('\n');
    const mergePrompt = `Merge the following partial summaries of the topic "${topic}" for ${dateStr} into a single cohesive summary.\n\n<partial_summaries>\n${partsXml}\n</partial_summaries>\n\nRespond with a valid JSON object containing:\n- "title": The title of the topic.\n- "content": A list of messages with keys "text", "sources", "images", and "videos".`;

    if (this.estimateTokens(mergePrompt) > MAX_TOKENS) {
      console.log(`[DailySummaryGenerator] Merge prompt also too large, concatenating chunk results directly`);
      const mergedContent: any[] = [];
      for (const chunkText of chunkSummaries) {
        try {
          const parsed = JSON.parse(chunkText);
          if (parsed.content && Array.isArray(parsed.content)) {
            mergedContent.push(...parsed.content);
          }
        } catch {
          mergedContent.push({ text: chunkText, sources: [], images: [], videos: [] });
        }
      }
      return { topic, title: topic, content: mergedContent };
    }

    const mergedText = await retryOperation(() => this.provider.summarize(mergePrompt, SUMMARIZE_OPTIONS.topicSummary));
    const mergedJSONString = mergedText.replace(/```json\n|```/g, "");
    const mergedJSON = JSON.parse(mergedJSONString);
    mergedJSON["topic"] = topic;
    return mergedJSON;
  }

  /**
   * Groups content items by topic, handling special cases for GitHub and crypto content.
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
          return;
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
        const token_topic = 'crypto market';
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
            const shortCase = topic.toLowerCase();
            if (!this.blockedTopics.includes(shortCase)) {
              if (!topicMap.has(shortCase)) {
                topicMap.set(shortCase, []);
              }
              topicMap.get(shortCase).push(obj);
            }
          });
        } else {
          const shortCase = obj.type.toLowerCase();
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
      topic: 'miscellaneous',
      objects: [],
      allTopics: []
    };

    const groupedTopics: any[] = [];

    sortedTopics.forEach(([topic, associatedObjects]) => {
      const mergedTopics = new Set();
      let topicAlreadyAdded = false;
      associatedObjects.forEach((obj: any) => {
        if (obj.topics) {
          obj.topics.forEach((t: any) => {
            const lower = t.toLowerCase();
            if (alreadyAdded[lower]) {
              topicAlreadyAdded = true;
            } else {
              mergedTopics.add(lower);
            }
          });
        }
      });

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
      else if (associatedObjects && associatedObjects.length <= 1) {
        const objectIds = associatedObjects.map((object: any) => object.id);
        const alreadyAddedToMisc = miscTopics["objects"].find((object: any) => objectIds.indexOf(object.id) >= 0);
        if (!alreadyAddedToMisc) {
          miscTopics["objects"] = miscTopics["objects"].concat(associatedObjects);
          miscTopics["allTopics"] = miscTopics["allTopics"].concat(Array.from(mergedTopics));
        }
      }
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
