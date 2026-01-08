/**
 * Fetches AI-generated GitHub summaries from elizaos.github.io summary API
 * NOT for stats - use GitHubStatsDataSource for that
 */

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import fetch from "node-fetch";

interface GitHubSummaryDataSourceConfig {
  name: string;
  summaryUrl: string;  // e.g., https://elizaos.github.io/api/summaries/overall/day/latest.json
  historicalSummaryUrl: string;  // e.g., https://elizaos.github.io/api/summaries/overall/day/<year>-<month>-<day>.json
}

interface SummaryAPIResponse {
  content: string;  // Full AI-generated markdown
  contentHash: string;  // For deduplication
  date: string;  // ISO date
  generatedAt: string;
  interval: string;
  type: string;
}

export class GitHubSummaryDataSource implements ContentSource {
  public name: string;
  private summaryUrl: string;
  private historicalSummaryUrl: string;

  static constructorInterface = {
    parameters: [
      {
        name: 'summaryUrl',
        type: 'string',
        required: true,
        description: 'URL for AI-generated summary JSON (latest)'
      },
      {
        name: 'historicalSummaryUrl',
        type: 'string',
        required: true,
        description: 'URL template for historical summaries (with date placeholders)'
      }
    ]
  };

  constructor(config: GitHubSummaryDataSourceConfig) {
    this.name = config.name;
    this.summaryUrl = config.summaryUrl;
    this.historicalSummaryUrl = config.historicalSummaryUrl;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    try {
      const response = await fetch(this.summaryUrl);
      if (!response.ok) {
        console.error(`Failed to fetch summary. Status: ${response.status}`);
        return [];
      }

      const data = await response.json() as SummaryAPIResponse;
      return this.processSummary(data, this.summaryUrl);
    } catch (error) {
      console.error("Error fetching GitHub summary:", error);
      return [];
    }
  }

  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    try {
      const targetDate = new Date(date);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getUTCDate()).padStart(2, '0');

      const url = this.historicalSummaryUrl
        .replace("<year>", String(year))
        .replace("<month>", month)
        .replace("<day>", day);

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Failed to fetch historical summary. Status: ${response.status}`);
        return [];
      }

      const data = await response.json() as SummaryAPIResponse;
      return this.processSummary(data, url);
    } catch (error) {
      console.error("Error fetching historical GitHub summary:", error);
      return [];
    }
  }

  private processSummary(data: SummaryAPIResponse, sourceUrl: string): ContentItem[] {
    const timestamp = new Date(data.date).getTime() / 1000;

    return [{
      type: "githubAISummary",
      cid: `github-summary-${data.date}-${data.contentHash.slice(0, 8)}`,
      source: sourceUrl,
      link: sourceUrl,  // Use the API URL as the source link
      title: `GitHub Activity Summary - ${data.date}`,
      text: data.content,
      date: timestamp,
      metadata: {
        contentHash: data.contentHash,
        generatedAt: data.generatedAt,
        interval: data.interval,
        summaryType: data.type
      }
    }];
  }
}
