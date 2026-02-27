/**
 * @fileoverview Range summary generator for multi-day (weekly, monthly, custom) summaries.
 *
 * Implements GeneratorPlugin with generateForRange().
 * Supports three data strategies:
 * - 'daily_summaries': Re-summarize existing daily SummaryItems (cheap, fast)
 * - 'raw_content': Process all raw ContentItems across the range (expensive, thorough)
 * - 'hybrid': Daily summaries as base + raw items for key topics (balanced)
 *
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
  RangeGeneratorOptions,
  SummaryGranularity,
  BudgetExhaustedError,
  SummarizeOptions,
} from "../../types";
import { computeContentHash } from "../../helpers/fileHelper";
import { logger } from "../../helpers/cliHelper";
import { retryOperation } from "../../helpers/generalHelper";
import { SUMMARIZE_OPTIONS } from "../../helpers/promptHelper";

/**
 * Configuration interface for RangeSummaryGenerator
 */
export interface RangeSummaryGeneratorConfig {
  provider: OpenAIProvider;
  storage: SQLiteStorage;
  /** The summaryType of the daily summaries this generator reads from (e.g., "dailySummary") */
  dailySummaryType: string;
  /** The summaryType this generator produces (e.g., "weeklySummary") */
  summaryType: string;
  /** For hybrid/raw modes: the content source type to fetch raw items */
  source?: string;
  /** For hybrid mode: max raw content items per deep-dive topic (default: 50) */
  hybridRawItemLimit?: number;
}

/**
 * RangeSummaryGenerator produces multi-day summaries by aggregating daily summaries
 * and/or raw content across a date range.
 *
 * Implements GeneratorPlugin:
 * - generate() is not the primary entry point (throws if called)
 * - generateForRange() is the primary entry point
 * - Reads existing daily SummaryItems or raw ContentItems from storage
 * - Uses AI to produce a consolidated range summary
 * - Returns GeneratorResult with SummaryItem and FileOutputs — caller saves them
 */
export class RangeSummaryGenerator implements GeneratorPlugin {
  public readonly name: string;
  public readonly outputType: string;
  public readonly supportsChaining = false;

  private provider: OpenAIProvider;
  private storage: SQLiteStorage;
  private dailySummaryType: string;
  private summaryType: string;
  private source: string | undefined;
  private hybridRawItemLimit: number;

  static constructorInterface = {
    parameters: [
      {
        name: 'provider',
        type: 'AIProvider',
        required: true,
        description: 'AI Provider plugin for summarization.'
      },
      {
        name: 'storage',
        type: 'StoragePlugin',
        required: true,
        description: 'Storage Plugin to read daily summaries and raw content from.'
      },
      {
        name: 'dailySummaryType',
        type: 'string',
        required: true,
        description: 'The summaryType of existing daily summaries to read (e.g., "dailySummary").'
      },
      {
        name: 'summaryType',
        type: 'string',
        required: true,
        description: 'The summaryType this generator produces (e.g., "weeklySummary").'
      },
      {
        name: 'source',
        type: 'string',
        required: false,
        description: 'Content source type for raw/hybrid modes.'
      },
      {
        name: 'hybridRawItemLimit',
        type: 'number',
        required: false,
        description: 'Max raw content items for hybrid deep-dive topics (default: 50).'
      },
    ]
  };

  constructor(config: RangeSummaryGeneratorConfig) {
    this.name = (config as any).name || 'RangeSummaryGenerator';
    this.provider = config.provider;
    this.storage = config.storage;
    this.dailySummaryType = config.dailySummaryType;
    this.summaryType = config.summaryType;
    this.outputType = config.summaryType;
    this.source = config.source;
    this.hybridRawItemLimit = config.hybridRawItemLimit || 50;
  }

  // ============================================
  // GeneratorPlugin interface
  // ============================================

  /**
   * Single-date generation is not the primary use case for RangeSummaryGenerator.
   * If called, generates a summary using daily_summaries strategy for just that date.
   */
  public async generate(dateStr: string, context?: GeneratorContext): Promise<GeneratorResult> {
    return this.generateForRange(dateStr, dateStr, {
      dataStrategy: 'daily_summaries',
      force: context?.force,
      tokenBudget: context?.tokenBudget,
    });
  }

  /**
   * Generate a summary for an arbitrary date range.
   *
   * Fetches data according to the chosen strategy, sends through AI for
   * consolidation, and returns the result.
   *
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD), inclusive
   * @param options - Data strategy, budget, etc.
   * @returns GeneratorResult with summaryItems and fileOutputs
   */
  public async generateForRange(
    startDate: string,
    endDate: string,
    options?: RangeGeneratorOptions
  ): Promise<GeneratorResult> {
    const startTime = Date.now();
    const strategy = options?.dataStrategy || 'daily_summaries';
    const label = options?.label || `${startDate} to ${endDate}`;

    logger.info(`[RangeSummaryGenerator] Generating range summary: ${label} (strategy: ${strategy})`);

    try {
      // Calculate epoch range
      const startEpoch = Math.floor(new Date(startDate).setUTCHours(0, 0, 0, 0) / 1000);
      const endEpoch = Math.floor(new Date(endDate).setUTCHours(23, 59, 59, 999) / 1000);

      // Reset provider usage stats
      this.provider.resetUsageStats();

      // Set token budget
      if (options?.tokenBudget && this.provider.setTokenBudget) {
        this.provider.setTokenBudget(options.tokenBudget);
      }

      // Fetch data according to strategy
      let inputData: string;
      let itemsProcessed = 0;
      let contentHash: string | undefined;

      switch (strategy) {
        case 'daily_summaries':
          const dailyResult = await this.fetchDailySummaries(startEpoch, endEpoch);
          inputData = dailyResult.text;
          itemsProcessed = dailyResult.count;
          contentHash = dailyResult.contentHash;
          break;

        case 'raw_content':
          const rawResult = await this.fetchRawContent(startEpoch, endEpoch);
          inputData = rawResult.text;
          itemsProcessed = rawResult.count;
          contentHash = rawResult.contentHash;
          break;

        case 'hybrid':
          const hybridResult = await this.fetchHybridContent(startEpoch, endEpoch);
          inputData = hybridResult.text;
          itemsProcessed = hybridResult.count;
          contentHash = hybridResult.contentHash;
          break;

        default:
          throw new Error(`Unknown data strategy: ${strategy}`);
      }

      if (!inputData || itemsProcessed === 0) {
        logger.warning(`[RangeSummaryGenerator] No data found for range ${label}`);
        if (this.provider.clearTokenBudget) this.provider.clearTokenBudget();
        return {
          success: true,
          summaryItems: [],
          skipped: true,
          stats: this.buildStats(0, startTime),
        };
      }

      // Content hash check — skip if source data hasn't changed (unless forced)
      if (!options?.force && contentHash) {
        const existing = await this.storage.getSummaryBetweenEpoch(startEpoch, startEpoch);
        const existingSummary = existing.find(
          s => s.type === this.summaryType && s.granularity !== 'daily'
        );
        if (existingSummary?.contentHash && existingSummary.contentHash === contentHash) {
          logger.info(`[RangeSummaryGenerator] Source data unchanged for ${label}, skipping.`);
          if (this.provider.clearTokenBudget) this.provider.clearTokenBudget();
          return {
            success: true,
            summaryItems: [],
            skipped: true,
            stats: this.buildStats(itemsProcessed, startTime),
          };
        }
      }

      // Determine granularity
      const dayCount = Math.ceil((endEpoch - startEpoch) / 86400);
      const granularity: SummaryGranularity = dayCount <= 7 ? 'weekly' : dayCount <= 31 ? 'monthly' : 'custom';

      // Generate the range summary via AI
      let markdown: string;
      try {
        markdown = await this.generateRangeSummaryMarkdown(inputData, startDate, endDate, label, strategy);
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          logger.warning(`[RangeSummaryGenerator] Budget exhausted, returning partial result.`);
          markdown = `# Range Summary: ${label}\n\n*Summary truncated due to budget limits.*`;
        } else {
          throw e;
        }
      }

      // Build SummaryItem
      const usageStats = this.provider.getUsageStats();
      const summaryItem: SummaryItem = {
        type: this.summaryType,
        title: `Range Summary: ${label}`,
        categories: JSON.stringify({ strategy, dayCount, startDate, endDate }),
        markdown,
        date: startEpoch,
        contentHash,
        startDate: startEpoch,
        endDate: endEpoch,
        granularity,
        metadata: { strategy, label, dayCount },
        tokensUsed: usageStats.totalTokens,
        estimatedCostUsd: usageStats.estimatedCostUsd,
      };

      // Build FileOutputs
      const fileOutputs: FileOutput[] = [
        {
          relativePath: `range/${startDate}_${endDate}.md`,
          content: markdown,
          format: 'md',
        },
        {
          relativePath: `range/${startDate}_${endDate}.json`,
          content: JSON.stringify({
            type: this.summaryType,
            title: summaryItem.title,
            startDate,
            endDate,
            granularity,
            strategy,
            dayCount,
          }, null, 2),
          format: 'json',
        },
      ];

      // Clear token budget
      if (this.provider.clearTokenBudget) {
        this.provider.clearTokenBudget();
      }

      logger.success(`[RangeSummaryGenerator] Range summary generated for ${label} (${usageStats.totalTokens} tokens, $${usageStats.estimatedCostUsd.toFixed(4)})`);

      return {
        success: true,
        summaryItems: [summaryItem],
        fileOutputs,
        stats: this.buildStats(itemsProcessed, startTime),
      };

    } catch (error) {
      if (this.provider.clearTokenBudget) {
        this.provider.clearTokenBudget();
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[RangeSummaryGenerator] Error generating range summary for ${label}: ${errorMsg}`);

      return {
        success: false,
        summaryItems: [],
        error: errorMsg,
        stats: this.buildStats(0, startTime),
      };
    }
  }

  // ============================================
  // Data fetching strategies
  // ============================================

  /**
   * Strategy: daily_summaries
   * Fetches existing daily SummaryItems and concatenates their markdown.
   * Cheapest and fastest option.
   */
  private async fetchDailySummaries(startEpoch: number, endEpoch: number): Promise<{ text: string; count: number; contentHash: string }> {
    const summaries = await this.storage.getSummaryBetweenEpoch(startEpoch, endEpoch);

    // Filter to only daily summaries of the configured type
    const dailySummaries = summaries.filter(
      s => s.type === this.dailySummaryType && (!s.granularity || s.granularity === 'daily')
    );

    if (dailySummaries.length === 0) {
      return { text: '', count: 0, contentHash: '' };
    }

    // Sort by date
    dailySummaries.sort((a, b) => (a.date || 0) - (b.date || 0));

    // Build combined text from markdown content
    const sections: string[] = [];
    for (const summary of dailySummaries) {
      const dateLabel = summary.date
        ? new Date(summary.date * 1000).toISOString().slice(0, 10)
        : 'unknown-date';

      if (summary.markdown) {
        sections.push(`<daily_summary date="${dateLabel}">\n${summary.markdown}\n</daily_summary>`);
      } else if (summary.categories) {
        // Fallback to JSON categories if no markdown
        sections.push(`<daily_summary date="${dateLabel}">\n${summary.categories}\n</daily_summary>`);
      }
    }

    const text = sections.join('\n\n');
    const contentHash = computeContentHash(
      dailySummaries.map(s => ({
        cid: `summary-${s.id || s.date}`,
        type: s.type,
        source: 'summary',
        text: s.markdown || s.categories || '',
      }))
    );

    return { text, count: dailySummaries.length, contentHash };
  }

  /**
   * Strategy: raw_content
   * Fetches all raw ContentItems across the range. Most expensive but most thorough.
   */
  private async fetchRawContent(startEpoch: number, endEpoch: number): Promise<{ text: string; count: number; contentHash: string }> {
    const contentItems = this.source
      ? await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch, this.source)
      : await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch);

    if (contentItems.length === 0) {
      return { text: '', count: 0, contentHash: '' };
    }

    const contentHash = computeContentHash(contentItems);

    // Group by date, then summarize each day's content
    const byDate = new Map<string, ContentItem[]>();
    for (const item of contentItems) {
      const dateStr = item.date
        ? new Date(item.date * 1000).toISOString().slice(0, 10)
        : 'unknown';
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, []);
      }
      byDate.get(dateStr)!.push(item);
    }

    const sections: string[] = [];
    for (const [dateStr, items] of Array.from(byDate.entries()).sort()) {
      const itemTexts = items
        .map(i => i.text || i.title || '')
        .filter(t => t.length > 0)
        .slice(0, 200) // Cap per day to avoid overwhelming the context
        .join('\n---\n');

      sections.push(`<raw_content date="${dateStr}" items="${items.length}">\n${itemTexts}\n</raw_content>`);
    }

    return { text: sections.join('\n\n'), count: contentItems.length, contentHash };
  }

  /**
   * Strategy: hybrid
   * Uses daily summaries as base, then enriches with raw content for key topics.
   */
  private async fetchHybridContent(startEpoch: number, endEpoch: number): Promise<{ text: string; count: number; contentHash: string }> {
    // Start with daily summaries
    const dailyResult = await this.fetchDailySummaries(startEpoch, endEpoch);

    if (!dailyResult.text) {
      // Fall back to raw content if no daily summaries exist
      logger.warning(`[RangeSummaryGenerator] No daily summaries found for hybrid mode, falling back to raw content.`);
      return this.fetchRawContent(startEpoch, endEpoch);
    }

    // Also fetch a limited number of raw content items for depth
    const rawItems = this.source
      ? await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch, this.source)
      : await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch);

    // Take a sample of raw items (most recent, most relevant)
    const sampledItems = rawItems.slice(0, this.hybridRawItemLimit);
    let rawSection = '';
    if (sampledItems.length > 0) {
      const rawTexts = sampledItems
        .map(i => i.text || i.title || '')
        .filter(t => t.length > 0)
        .join('\n---\n');

      rawSection = `\n\n<raw_content_supplement items="${sampledItems.length}">\n${rawTexts}\n</raw_content_supplement>`;
    }

    const combinedText = dailyResult.text + rawSection;
    const contentHash = computeContentHash([
      ...rawItems.slice(0, this.hybridRawItemLimit).map(i => ({
        cid: i.cid,
        type: i.type,
        source: i.source,
        text: i.text,
      })),
      { cid: 'daily-hash', type: 'hash', source: 'summary', text: dailyResult.contentHash },
    ]);

    return {
      text: combinedText,
      count: dailyResult.count + sampledItems.length,
      contentHash,
    };
  }

  // ============================================
  // AI summarization
  // ============================================

  /**
   * Generate the range summary markdown using AI.
   */
  private async generateRangeSummaryMarkdown(
    inputData: string,
    startDate: string,
    endDate: string,
    label: string,
    strategy: string
  ): Promise<string> {
    const systemPrompt = `You are an expert analyst producing high-quality multi-day summary reports.
Your task is to synthesize the provided data into a comprehensive, well-structured markdown report.

Guidelines:
- Identify and highlight the most significant themes, trends, and developments across the entire period
- Group related topics together, even if they span multiple days
- Call out notable changes, milestones, or turning points
- Include key metrics and statistics where available
- Use clear section headings and bullet points for readability
- Both AI agents and humans are your audience — be precise and include specific details
- Do NOT just list what happened each day — synthesize across the period to find patterns and insights`;

    const userPrompt = `Generate a comprehensive summary report for the period ${startDate} to ${endDate} (${label}).
Data strategy used: ${strategy}

Here is the source data:

${inputData}

Produce a well-structured markdown report that synthesizes the key themes, developments, and trends across this entire period.`;

    const options: SummarizeOptions = {
      systemPrompt,
      temperature: 0.4,
    };

    const result = await retryOperation(() =>
      this.provider.summarize(userPrompt, options)
    );

    // Clean up
    return result
      .trim()
      .replace(/```markdown\n?|```\n?/g, '');
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
}
