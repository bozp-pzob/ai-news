import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import fetch from "node-fetch";

interface GitHubStatsDataSourceConfig {
  name: string;
  statsUrl: string;
  historicalStatsUrl: string;
  githubCompany: string;
  githubRepo: string;
}

/**
 * A plugin that fetches GitHub stats data from a single JSON endpoint
 * and returns ContentItems in a unified format.
 */
export class GitHubStatsDataSource implements ContentSource {
  public name: string;
  private statsUrl: string;
  private historicalStatsUrl: string;
  private githubCompany: string;
  private githubRepo: string;
  private baseGithubUrl: string;
  private baseGithubImageUrl: string;

  constructor(config: GitHubStatsDataSourceConfig) {
    this.name = config.name;
    this.statsUrl = config.statsUrl;
    this.historicalStatsUrl = config.historicalStatsUrl;
    this.githubCompany = config.githubCompany;
    this.githubRepo = config.githubRepo;
    this.baseGithubUrl = `https://github.com/${this.githubCompany}/${this.githubRepo}/`;
    this.baseGithubImageUrl = `https://opengraph.githubassets.com/1/${this.githubCompany}/${this.githubRepo}/`;
  }

  /**
   * Fetch items from the stats JSON endpoint and convert them
   * into an array of ContentItem objects.
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
   * Fetch historical items for a specific date
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
   * Process the stats data into ContentItems
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
        const issueItem: ContentItem = {
          type: "githubIssue",
          cid: `github-issue-${issue.number}`,
          source: issueUrl,
          title: issue.title,
          text: `Issue #${issue.number} by ${issue.author}`,
          link: issueUrl,
          date: timestamp,
          metadata: {
            id: issue.id,
            author: issue.author,
            number: issue.number,
            repository: issue.repository,
            createdAt: issue.createdAt,
            closedAt: issue.closedAt,
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
        const prItem: ContentItem = {
          type: "githubPullRequest",
          cid: `github-pr-${pr.number}`,
          source: prUrl,
          title: pr.title,
          text: `PR #${pr.number} by ${pr.author}`,
          link: prUrl,
          date: timestamp,
          metadata: {
            id: pr.id,
            author: pr.author,
            number: pr.number,
            repository: pr.repository,
            createdAt: pr.createdAt,
            mergedAt: pr.mergedAt,
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
          text: `${item.type}: ${item.title}`,
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