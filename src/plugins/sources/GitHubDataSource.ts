/**
 * @fileoverview Implementation of a content source for fetching GitHub activity data
 * Handles retrieval and processing of contributor activities and repository summaries
 */

import { ContentSource } from "./ContentSource";  // Your unified interface
import { ContentItem } from "../../types";         // Your unified item interface
import fetch from "node-fetch";

/**
 * Configuration interface for GitHubDataSource
 * @interface GithubDataSourceConfig
 * @property {string} name - The name identifier for this GitHub source
 * @property {string} contributorsUrl - URL endpoint for contributors data JSON
 * @property {string} summaryUrl - URL endpoint for repository summary data JSON
 * @property {string} historicalSummaryUrl - URL template for historical summary data (supports date placeholders)
 * @property {string} historicalContributorUrl - URL template for historical contributor data (supports date placeholders)
 * @property {string} githubCompany - GitHub organization/company name
 * @property {string} githubRepo - GitHub repository name
 */
interface GithubDataSourceConfig {
  name: string;
  contributorsUrl: string;
  summaryUrl: string;
  historicalSummaryUrl: string;
  historicalContributorUrl: string;
  githubCompany: string;
  githubRepo: string;
}

/**
 * GitHubDataSource class that implements ContentSource interface for GitHub activity data
 * Fetches and processes contributor activities and repository summaries from JSON endpoints
 * @implements {ContentSource}
 */
export class GitHubDataSource implements ContentSource {
  /** Name identifier for this GitHub source */
  public name: string;
  /** URL endpoint for contributors data */
  private contributorsUrl: string;
  /** URL endpoint for repository summary */
  private summaryUrl: string;
  /** URL template for historical summary data */
  private historicalSummaryUrl: string;
  /** URL template for historical contributor data */
  private historicalContributorUrl: string;
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
        name: 'contributorsUrl',
        type: 'string',
        required: true,
        description: 'URL for contributors data JSON endpoint'
      },
      {
        name: 'summaryUrl',
        type: 'string',
        required: true,
        description: 'URL for summary data JSON endpoint'
      },
      {
        name: 'historicalSummaryUrl',
        type: 'string',
        required: true,
        description: 'URL template for historical summary data (includes date placeholders)'
      },
      {
        name: 'historicalContributorUrl',
        type: 'string',
        required: true,
        description: 'URL template for historical contributor data (includes date placeholders)'
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
   * Creates a new GitHubDataSource instance
   * @param {GithubDataSourceConfig} config - Configuration object for the GitHub source
   */
  constructor(config: GithubDataSourceConfig) {
    this.name = config.name;
    this.contributorsUrl = config.contributorsUrl;
    this.summaryUrl = config.summaryUrl;
    this.historicalSummaryUrl = config.historicalSummaryUrl;
    this.historicalContributorUrl = config.historicalContributorUrl;
    this.githubCompany = config.githubCompany;
    this.githubRepo = config.githubRepo;
    this.baseGithubUrl = `https://github.com/${this.githubCompany}/${this.githubRepo}/`;
    this.baseGithubImageUrl = `https://opengraph.githubassets.com/1/${this.githubCompany}/${this.githubRepo}/`;
  }

  /**
   * Fetches current GitHub activity data from both contributors and summary endpoints
   * @returns {Promise<ContentItem[]>} Array of content items containing GitHub activities
   */
  public async fetchItems(): Promise<ContentItem[]> {
    try {
      const targetDate = new Date();
      const contributorsResp = await fetch(this.contributorsUrl);
      if (!contributorsResp.ok) {
        console.error(`Failed to fetch contributors.json. Status: ${contributorsResp.status}`);
        return [];
      }
      const contributorsData = await contributorsResp.json();

      const summaryResp = await fetch(this.summaryUrl);
      if (!summaryResp.ok) {
        console.error(`Failed to fetch summary.json. Status: ${summaryResp.status}`);
        return [];
      }
      const summaryData : any = await summaryResp.json();

      const githubData = await this.processGithubData(contributorsData, summaryData, targetDate);

      return githubData;
    } catch (error) {
      console.error("Error fetching GitHub data:", error);
      return [];
    }
  }

  /**
   * Fetches historical GitHub activity data for a specific date
   * @param {string} date - ISO date string to fetch historical data from
   * @returns {Promise<ContentItem[]>} Array of content items containing historical GitHub activities
   */
  public async fetchHistorical(date:string): Promise<ContentItem[]> {
    try {
      const targetDate = new Date(date);
      const year = targetDate.getFullYear();
      const month = String(targetDate.getMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getUTCDate()).padStart(2, '0');
      const historicalSummary = this.historicalSummaryUrl.replace("<year>", String(year)).replace("<month>", month).replace("<day>", day)
      const historicalContributor = this.historicalContributorUrl.replace("<year>", String(year)).replace("<month>", month).replace("<day>", day)

      const contributorsResp = await fetch(historicalContributor);
      let contributorsData: any = [];
      if (!contributorsResp.ok) {
        console.error(`Failed to fetch contributors.json. Status: ${contributorsResp.status}`);
        contributorsData = [];
      }
      else {
        contributorsData = await contributorsResp.json();
      }

      const summaryResp = await fetch(historicalSummary);
      let summaryData: any = [];
      if (!summaryResp.ok) {
        console.error(`Failed to fetch summary.json. Status: ${summaryResp.status}`);
        summaryData = [];
      }
      else {
        summaryData = await summaryResp.json();
      }

      const githubData = await this.processGithubData(contributorsData, summaryData, targetDate)

      return githubData;
    } catch (error) {
      console.error("Error fetching GitHub data:", error);
      return [];
    }
  }

  /**
   * Processes raw GitHub data into ContentItem format
   * @private
   * @param {any} contributorsData - Raw contributors data from API
   * @param {any} summaryData - Raw summary data from API
   * @param {Date} date - Target date for the data
   * @returns {Promise<ContentItem[]>} Array of processed GitHub content items
   */
  private async processGithubData(contributorsData: any, summaryData: any, date: Date): Promise<ContentItem[]> {
    try {
      const githubItems : ContentItem[] = [];
  
      // Process contributor activities (commits, PRs, issues)
      (Array.isArray(contributorsData)
        ? contributorsData : [] ).forEach((c: any) => {
          // Process commits
          if ( c.activity?.code?.commits?.length > 0 ) {
            c.activity?.code?.commits?.forEach((commit: any) => {
              const item : ContentItem = {
                type: "githubCommitContributor",
                cid: `github-commit-${commit.sha}`,
                source: this.name,
                link: `${this.baseGithubUrl}commit/${commit.sha}`,
                text: commit.message,
                date: date.getTime() / 1000,
                metadata: {
                    additions: commit.additions,
                    deletions: commit.deletions,
                    changed_files: commit.changed_files,
                    photos: [`${this.baseGithubImageUrl}commit/${commit.sha}`]
                },
              }
  
              githubItems.push(item);
            })
          }
  
          // Process pull requests
          if ( c.activity?.code?.pull_requests?.length > 0 ) {
            c.activity?.code?.pull_requests?.forEach((pr: any) => {
              const item : ContentItem = {
                type: "githubPullRequestContributor",
                cid: `github-pull-${pr.number}`,
                source: this.name,
                link: `${this.baseGithubUrl}pull/${pr.number}`,
                text: `Title: ${pr.title}\nBody: ${pr.body}`,
                date: date.getTime() / 1000,
                metadata: {
                  number: pr.number,
                  state: pr.state,
                  merged: pr.merged,
                  photos: [`${this.baseGithubImageUrl}pull/${pr.number}`]
                },
              }
  
              githubItems.push(item);
            })
          }
  
          // Process issues
          if ( c.activity?.issues?.opened?.length > 0 ) {
            c.activity?.issues?.opened?.forEach((issue: any) => {
              const item : ContentItem = {
                type: "githubIssueContributor",
                cid: `github-issue-${issue.number}`,
                source: this.name,
                link: `${this.baseGithubUrl}issues/${issue.number}`,
                text: `Title: ${issue.title}\nBody: ${issue.body}`,
                date: date.getTime() / 1000,
                metadata: {
                  number: issue.number,
                  state: issue.state,
                  photos: [`${this.baseGithubImageUrl}issues/${issue.number}`]
                },
              }
  
              githubItems.push(item);
            })
          }
        });
      
      // Create summary item
      const cid = `github-contrib-${summaryData.title}`;
  
      const summaryItem: ContentItem = {
        type: "githubSummary",
        title: summaryData.title,
        cid: cid,
        source: this.name,
        text: summaryData.overview,
        date: date.getTime() / 1000,
        metadata: {
          metrics: summaryData.metrics,
          changes: summaryData.changes,
          areas: summaryData.areas,
          issues_summary: summaryData.issues_summary,
          top_contributors: summaryData.top_contributors,
          questions: summaryData.questions,
        },
      };
  
      return [...githubItems, summaryItem];
    } catch(error) {
      return [];
    }
  }
}