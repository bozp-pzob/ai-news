/**
 * @fileoverview Implementation of a content source for fetching GitHub repository statistics
 * Handles retrieval and processing of repository stats, including issues, PRs, and contributor metrics
 * 
 * @deprecated This plugin is deprecated. Use GitHubSource instead,
 * which provides direct GitHub API access with rate limiting, real-time data fetching,
 * and support for both self-hosted and platform modes.
 * 
 * Migration guide:
 * - Replace `statsUrl` with direct `owner` and `repo` parameters
 * - Use `token` for authentication instead of relying on pre-processed JSON
 * - The new plugin combines both contributor and stats data
 * 
 * @see GitHubSource
 */

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import fetch from "node-fetch";

/**
 * Calculate days between two ISO timestamps.
 * Returns days from creation to close/merge, or days since creation if still open.
 */
function calculateDaysOpen(createdAt: string, closedAt?: string | null): number {
  const created = new Date(createdAt).getTime();
  const closed = closedAt ? new Date(closedAt).getTime() : Date.now();
  return Math.floor((closed - created) / (1000 * 60 * 60 * 24));
}

/**
 * Format duration as human-readable string, only if notable (>7 days).
 */
function formatDuration(days: number | undefined): string {
  if (!days || days <= 7) return "";
  if (days > 365) return `, open ${Math.floor(days / 365)}+ years`;
  if (days > 30) return `, open ${Math.floor(days / 30)} months`;
  return `, open ${days} days`;
}

/**
 * Configuration interface for GitHubStatsDataSource
 * @interface GitHubStatsDataSourceConfig
 * @property {string} name - The name identifier for this stats source
 * @property {string} statsUrl - URL endpoint for current repository stats
 * @property {string} historicalStatsUrl - URL template for historical stats (supports date placeholders)
 * @property {string} githubCompany - GitHub organization/company name
 * @property {string} githubRepo - GitHub repository name
 * @deprecated Use GitHubSourceConfig instead
 */
interface GitHubStatsDataSourceConfig {
  name: string;
  statsUrl: string;
  historicalStatsUrl: string;
  githubCompany: string;
  githubRepo: string;
}

/**
 * GitHubStatsDataSource class that implements ContentSource interface for GitHub repository statistics
 * Fetches and processes repository metrics, issue/PR activity, and contributor stats
 * @implements {ContentSource}
 * @deprecated Use GitHubSource instead for direct GitHub API access
 */
export class GitHubStatsDataSource implements ContentSource {
  /** Name identifier for this stats source */
  public name: string;
  /** URL endpoint for current stats */
  private statsUrl: string;
  /** URL template for historical stats */
  private historicalStatsUrl: string;
  /** GitHub organization/company name */
  private githubCompany: string;
  /** GitHub repository name */
  private githubRepo: string;
  /** Base URL for GitHub repository */
  private baseGithubUrl: string;
  /** Base URL for GitHub preview images */
  private baseGithubImageUrl: string;

  static constructorInterface = {
    parameters: [
      {
        name: 'statsUrl',
        type: 'string',
        required: true,
        description: 'URL for stats data JSON endpoint'
      },
      {
        name: 'historicalStatsUrl',
        type: 'string',
        required: true,
        description: 'URL template for historical summary data (includes date placeholders)'
      },
      {
        name: 'githubCompany',
        type: 'string',
        required: true,
        description: 'GitHub company/organization name'
      },
      {
        name: 'githubRepo',
        type: 'string',
        required: true,
        description: 'GitHub repository name'
      }
    ]
  };

  /**
   * Creates a new GitHubStatsDataSource instance
   * @param {GitHubStatsDataSourceConfig} config - Configuration object for the stats source
   * @deprecated Use GitHubSource instead
   */
  constructor(config: GitHubStatsDataSourceConfig) {
    console.warn(
      '[DEPRECATED] GitHubStatsDataSource is deprecated and will be removed in a future version. ' +
      'Please migrate to GitHubSource for direct GitHub API access. ' +
      'See documentation for migration guide.'
    );
    
    this.name = config.name;
    this.statsUrl = config.statsUrl;
    this.historicalStatsUrl = config.historicalStatsUrl;
    this.githubCompany = config.githubCompany;
    this.githubRepo = config.githubRepo;
    this.baseGithubUrl = `https://github.com/${this.githubCompany}/${this.githubRepo}/`;
    this.baseGithubImageUrl = `https://opengraph.githubassets.com/1/${this.githubCompany}/${this.githubRepo}/`;
  }

  /**
   * Fetches current repository statistics
   * @returns {Promise<ContentItem[]>} Array of content items containing repository stats
   */
  public async fetchItems(): Promise<ContentItem[]> {
    try {
      const targetDate = new Date();
      const statsResp = await fetch(this.statsUrl);
      if (!statsResp.ok) {
        console.error(`Failed to fetch stats.json. Status: ${statsResp.status}`);
        return [];
      }
      const statsData = await statsResp.json();

      return this.processStatsData(statsData, targetDate);
    } catch (error) {
      console.error("Error fetching GitHub stats data:", error);
      return [];
    }
  }

  /**
   * Fetches historical repository statistics for a specific date
   * @param {string} date - ISO date string to fetch historical stats from
   * @returns {Promise<ContentItem[]>} Array of content items containing historical repository stats
   */
  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    try {
      const targetDate = new Date(date);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getUTCDate()).padStart(2, '0');
      
      const historicalStatsUrl = this.historicalStatsUrl
        .replace("<year>", String(year))
        .replace("<month>", month)
        .replace("<day>", day);

      const statsResp = await fetch(historicalStatsUrl);
      if (!statsResp.ok) {
        console.error(`Failed to fetch historical stats. Status: ${statsResp.status}`);
        return [];
      }
      
      const statsData = await statsResp.json();
      return this.processStatsData(statsData, targetDate, historicalStatsUrl);
    } catch (error) {
      console.error("Error fetching historical GitHub stats data:", error);
      return [];
    }
  }

  /**
   * Processes raw stats data into ContentItem format
   * @private
   * @param {any} statsData - Raw stats data from API
   * @param {Date} date - Target date for the data
   * @param {string} [historicalUrl] - Optional URL for historical data source
   * @returns {ContentItem[]} Array of processed stats content items
   */
  private processStatsData(statsData: any, date: Date, historicalUrl?: string): ContentItem[] {
    const githubItems: ContentItem[] = [];
    const timestamp = date.getTime() / 1000;
    const dateStr = date.toISOString().split('T')[0];
    
    // Create a summary item from the overview
    const summaryItem: ContentItem = {
      type: "githubStatsSummary",
      cid: `github-stats-${dateStr}`,
      source: historicalUrl || this.statsUrl,
      title: `GitHub Activity Summary for ${this.githubCompany}/${this.githubRepo} (${dateStr})`,
      text: statsData.overview,
      date: timestamp,
      metadata: {
        interval: statsData.interval,
        repository: statsData.repository,
        codeChanges: statsData.codeChanges,
        newPRs: statsData.newPRs,
        mergedPRs: statsData.mergedPRs,
        newIssues: statsData.newIssues,
        closedIssues: statsData.closedIssues,
        activeContributors: statsData.activeContributors,
        historicalUrl: historicalUrl
      }
    };
    githubItems.push(summaryItem);

    // Process top issues
    if (statsData.topIssues && Array.isArray(statsData.topIssues)) {
      statsData.topIssues.forEach((issue: any) => {
        const issueUrl = `${this.baseGithubUrl}issues/${issue.number}`;
        const daysOpen = issue.createdAt ? calculateDaysOpen(issue.createdAt, issue.closedAt) : undefined;
        const duration = formatDuration(daysOpen);
        const issueItem: ContentItem = {
          type: "githubIssue",
          cid: `github-issue-${issue.number}`,
          source: issueUrl,
          title: issue.title,
          text: `Issue #${issue.number}: ${issue.title} (by ${issue.author}${duration})`,
          link: issueUrl,
          date: timestamp,
          metadata: {
            id: issue.id,
            author: issue.author,
            number: issue.number,
            repository: issue.repository,
            createdAt: issue.createdAt,
            closedAt: issue.closedAt,
            daysOpen,
            state: issue.state,
            commentCount: issue.commentCount,
            photos: [`${this.baseGithubImageUrl}issues/${issue.number}`]
          }
        };
        githubItems.push(issueItem);
      });
    }

    // Process top PRs
    if (statsData.topPRs && Array.isArray(statsData.topPRs)) {
      statsData.topPRs.forEach((pr: any) => {
        const prUrl = `${this.baseGithubUrl}pull/${pr.number}`;
        const daysOpen = pr.createdAt ? calculateDaysOpen(pr.createdAt, pr.mergedAt) : undefined;
        const duration = formatDuration(daysOpen);
        const prItem: ContentItem = {
          type: "githubPullRequest",
          cid: `github-pr-${pr.number}`,
          source: prUrl,
          title: pr.title,
          text: `PR #${pr.number}: ${pr.title} (by ${pr.author}${duration})`,
          link: prUrl,
          date: timestamp,
          metadata: {
            id: pr.id,
            author: pr.author,
            number: pr.number,
            repository: pr.repository,
            createdAt: pr.createdAt,
            mergedAt: pr.mergedAt,
            daysOpen,
            additions: pr.additions,
            deletions: pr.deletions,
            photos: [`${this.baseGithubImageUrl}pull/${pr.number}`]
          }
        };
        githubItems.push(prItem);
      });
    }

    // Process completed items
    if (statsData.completedItems && Array.isArray(statsData.completedItems)) {
      statsData.completedItems.forEach((item: any) => {
        const prUrl = `${this.baseGithubUrl}pull/${item.prNumber}`;
        const completedItem: ContentItem = {
          type: "githubCompletedItem",
          cid: `github-completed-${item.prNumber}`,
          source: prUrl,
          title: item.title,
          text: `${item.type}: ${item.title} (PR #${item.prNumber})`,
          link: prUrl,
          date: timestamp,
          metadata: {
            prNumber: item.prNumber,
            type: item.type
          }
        };
        githubItems.push(completedItem);
      });
    }

    // Process top contributors
    if (statsData.topContributors && Array.isArray(statsData.topContributors)) {
      const contributorsItem: ContentItem = {
        type: "githubTopContributors",
        cid: `github-contributors-${dateStr}`,
        source: this.baseGithubUrl,
        title: "Top Contributors",
        text: `Top contributors for ${this.githubCompany}/${this.githubRepo}`,
        date: timestamp,
        metadata: {
          contributors: statsData.topContributors
        }
      };
      githubItems.push(contributorsItem);
    }

    return githubItems;
  }
} 