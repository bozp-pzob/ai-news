/**
 * @fileoverview GitHub Source Plugin
 * 
 * Fetches and processes GitHub contribution data (PRs, issues, commits, reviews)
 * directly from the GitHub API. Supports both raw data collection and summarized output.
 * 
 * Features:
 * - Simple config: Just provide repo URLs or "owner/repo" strings
 * - Public repos: Track public repos without authentication (60 req/hr limit)
 * - Private repos: Use GitHub App connection for read-only access
 * - Auto-fetch: When using connectionId without repos, tracks all connected repos
 * - File-level details: PR output includes file paths and changes
 * - Two modes: 'raw' (individual items) or 'summarized' (one summary per repo)
 * 
 * This plugin replaces the deprecated GitHubDataSource and GitHubStatsDataSource
 * which relied on pre-processed JSON from external URLs.
 */

import { ContentSource } from './ContentSource';
import { 
  ContentItem, 
  AiProvider, 
  RawPullRequest, 
  RawIssue, 
  RawCommit, 
  DailyStats, 
  ContributorStats,
  RawComment,
  RawReviewComment,
  RawReviewSubmission,
  MergedPRInfo,
  ClosedIssueInfo,
  GitHubActivityTypes,
} from '../../types';
import { StoragePlugin } from '../storage/StoragePlugin';
import { generateSummarizeInput, SUMMARIZE_OPTIONS } from '../../helpers/promptHelper';
import { externalConnectionService } from '../../services/externalConnections/ExternalConnectionService';
import { Octokit } from 'octokit';

/**
 * Default activity types - all enabled for private repos (authenticated)
 * Public repos have a more conservative default to save API quota
 */
const DEFAULT_ACTIVITY_TYPES_PRIVATE: GitHubActivityTypes = {
  newPRs: true,
  newIssues: true,
  commits: true,
  comments: true,
  reviews: true,
  reviewComments: true,
  mergedPRs: true,
  closedIssues: true,
};

const DEFAULT_ACTIVITY_TYPES_PUBLIC: GitHubActivityTypes = {
  newPRs: true,
  newIssues: true,
  commits: true,
  comments: false,       // Disabled by default for public repos
  reviews: false,        // Disabled by default for public repos
  reviewComments: false, // Disabled by default for public repos
  mergedPRs: true,
  closedIssues: true,
};

/**
 * Internal repository configuration (parsed from user input)
 */
interface ParsedRepo {
  owner: string;
  repo: string;
}

/**
 * Configuration interface for GitHubSource
 * 
 * Simple two-mode configuration:
 * 1. Public repos: Just provide repo URLs or "owner/repo" strings in repos[]
 * 2. Private repos: Provide connectionId (GitHub App), optionally with repos[]
 */
export interface GitHubSourceConfig {
  /** Name identifier for this source */
  name: string;
  
  /** 
   * Repositories to track - accepts URLs or "owner/repo" shorthand
   * Examples:
   *   - "https://github.com/facebook/react"
   *   - "facebook/react"
   *   - "https://github.com/microsoft/typescript.git"
   * 
   * Optional if connectionId is provided (will auto-fetch from connection)
   */
  repos?: string[];
  
  /** 
   * External connection ID (for GitHub App authenticated access)
   * If provided without repos[], will auto-fetch all repos from the connection
   */
  connectionId?: string;
  
  /** 
   * Operating mode: 'raw' outputs all items, 'summarized' outputs single summary per repo
   * Defaults to 'summarized'
   */
  mode?: 'raw' | 'summarized';
  
  /** Storage plugin for cursor tracking */
  storage?: StoragePlugin;
  
  /** Fetch interval in seconds (used for period labeling in summarized mode) */
  interval?: number;
  
  /** Usernames to exclude from contributor stats (bots, etc.) */
  contributorsToExclude?: string[];
  
  /** AI summary configuration */
  aiSummary?: {
    enabled: boolean;
    provider?: AiProvider;
  };
  
  /**
   * GitHub personal access token for authenticated API access (5,000 req/hr).
   * Falls back to GITHUB_TOKEN env var if not set.
   * Not needed when using connectionId (GitHub App auth).
   */
  token?: string;
  
  /**
   * Activity types to track. Defaults vary based on auth mode:
   * - Private repos (connectionId): All enabled
   * - Public repos: Comments/reviews disabled to save API quota (60 req/hr limit)
   */
  activityTypes?: GitHubActivityTypes;
}

/**
 * Collected GitHub data for a single repository
 */
interface RepositoryData {
  owner: string;
  repo: string;
  pullRequests: RawPullRequest[];
  issues: RawIssue[];
  commits: RawCommit[];
  comments: RawComment[];
  reviewComments: RawReviewComment[];
  reviewSubmissions: RawReviewSubmission[];
  mergedPRs: MergedPRInfo[];
  closedIssues: ClosedIssueInfo[];
  stats: DailyStats;
}

/**
 * Parse a repo string into owner and repo
 * Accepts:
 *   - Full URL: "https://github.com/owner/repo" or "https://github.com/owner/repo.git"
 *   - Shorthand: "owner/repo"
 */
function parseRepoString(input: string): ParsedRepo {
  // Handle full URL: https://github.com/owner/repo or https://github.com/owner/repo.git
  const urlMatch = input.match(/github\.com\/([^\/]+)\/([^\/\.\s]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }
  
  // Handle shorthand: owner/repo
  const parts = input.trim().split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }
  
  throw new Error(`Invalid repo format: "${input}". Use "owner/repo" or a GitHub URL.`);
}

/**
 * GitHub Source
 * 
 * Implements ContentSource interface for direct GitHub API access.
 * Supports fetching current data and historical snapshots from multiple repositories.
 */
export class GitHubSource implements ContentSource {
  public name: string;
  
  private config: GitHubSourceConfig;
  private repositories: ParsedRepo[] = [];
  private unauthenticatedClient: Octokit | null = null;
  private initialized: boolean = false;

  /**
   * Constructor interface for plugin registry
   */
  static constructorInterface = {
    parameters: [
      {
        name: 'repos',
        type: 'array',
        required: false,
        description: 'Repository URLs or "owner/repo" strings to track'
      },
      {
        name: 'connectionId',
        type: 'string',
        required: false,
        description: 'GitHub App connection ID (for private repos)'
      },
      {
        name: 'mode',
        type: 'string',
        required: false,
        description: 'Operating mode: "raw" or "summarized" (default: "summarized")'
      },
      {
        name: 'interval',
        type: 'number',
        required: false,
        description: 'Fetch interval in seconds (for period labeling)'
      },
      {
        name: 'contributorsToExclude',
        type: 'array',
        required: false,
        description: 'Usernames to exclude (bots, etc.)'
      },
      {
        name: 'aiSummary',
        type: 'object',
        required: false,
        description: 'AI summary configuration { enabled: boolean, provider?: AiProvider }'
      },
      {
        name: 'activityTypes',
        type: 'object',
        required: false,
        description: 'Activity types to track (newPRs, newIssues, commits, comments, reviews, reviewComments, mergedPRs, closedIssues)'
      }
    ]
  };

  constructor(config: GitHubSourceConfig) {
    this.name = config.name;
    
    // Set default mode
    this.config = {
      ...config,
      mode: config.mode || 'summarized',
    };
    
    // Validate: need either repos or connectionId
    if ((!config.repos || config.repos.length === 0) && !config.connectionId) {
      throw new Error('GitHubSource requires either repos[] or connectionId');
    }

    // Parse repos if provided
    if (config.repos && config.repos.length > 0) {
      this.repositories = config.repos.map(r => parseRepoString(r));
      this.initialized = true;
    }

    const authMode = config.connectionId ? 'GitHub App' : 'public (unauthenticated)';
    console.log(`[${this.name}] Initialized with ${this.repositories.length} repositories, auth: ${authMode}`);
  }

  /**
   * Initialize the source - fetch repos from connection if needed
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Auto-fetch repos from connection
    if (this.config.connectionId) {
      console.log(`[${this.name}] Fetching repositories from GitHub App connection...`);
      
      try {
        const channels = await externalConnectionService.getChannels(this.config.connectionId);
        this.repositories = channels
          .filter(ch => ch.isAccessible)
          .map(ch => ({
            owner: ch.metadata?.owner || ch.parentId || '',
            repo: ch.metadata?.name || ch.externalName?.split('/').pop() || '',
          }))
          .filter(r => r.owner && r.repo);

        console.log(`[${this.name}] Auto-loaded ${this.repositories.length} repositories from connection`);
        
        if (this.repositories.length === 0) {
          throw new Error('No accessible repositories found in GitHub App connection');
        }
      } catch (error) {
        console.error(`[${this.name}] Failed to fetch repos from connection:`, error);
        throw error;
      }
    }

    this.initialized = true;
  }

  /**
   * Get GitHub API client - authenticated if connectionId, otherwise unauthenticated
   * Unauthenticated access is rate limited to 60 requests/hour
   */
  private async getClient(): Promise<Octokit> {
    // Platform mode - get client from GitHub App connection
    if (this.config.connectionId) {
      try {
        const githubAdapter = externalConnectionService.getGitHubAdapter();
        const client = await githubAdapter.getClientForConnection(this.config.connectionId);
        return client;
      } catch (error) {
        console.error(`[${this.name}] Failed to get client for connection:`, error);
        throw new Error(`GitHub App connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Use token-authenticated client if available (5,000 requests/hour)
    const token = this.config.token || process.env.GITHUB_TOKEN;
    if (!this.unauthenticatedClient) {
      if (token) {
        this.unauthenticatedClient = new Octokit({ auth: token });
        console.log(`[${this.name}] Using authenticated GitHub API access (5,000 req/hr)`);
      } else {
        this.unauthenticatedClient = new Octokit();
        console.warn(`[${this.name}] Using unauthenticated GitHub API access (60 req/hr limit). Set GITHUB_TOKEN for higher limits.`);
      }
    }
    return this.unauthenticatedClient;
  }

  /**
   * Fetch current GitHub activity data from all repositories
   * Returns data created today
   */
  public async fetchItems(): Promise<ContentItem[]> {
    await this.ensureInitialized();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.fetchDataForPeriod(today, tomorrow, today);
  }

  /**
   * Fetch historical GitHub activity for a specific date
   * Uses snapshot approach - only data CREATED on that date
   */
  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    await this.ensureInitialized();
    
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    return this.fetchDataForPeriod(targetDate, nextDay, targetDate);
  }

  /**
   * Fetch and process data for a specific time period from all repositories
   */
  private async fetchDataForPeriod(
    since: Date,
    until: Date,
    displayDate: Date,
  ): Promise<ContentItem[]> {
    const allItems: ContentItem[] = [];

    // Process each repository
    for (const repoConfig of this.repositories) {
      try {
        const items = await this.fetchRepoDataForPeriod(repoConfig, since, until, displayDate);
        allItems.push(...items);
      } catch (error) {
        console.error(`[${this.name}] Error fetching data for ${repoConfig.owner}/${repoConfig.repo}:`, error);
        // Continue with other repos
      }
    }

    return allItems;
  }

  /**
   * Get effective activity types based on config and auth mode
   */
  private getEffectiveActivityTypes(): GitHubActivityTypes {
    const isPublic = !this.config.connectionId;
    const defaults = isPublic ? DEFAULT_ACTIVITY_TYPES_PUBLIC : DEFAULT_ACTIVITY_TYPES_PRIVATE;
    return { ...defaults, ...this.config.activityTypes };
  }

  /**
   * Fetch and process data for a single repository
   */
  private async fetchRepoDataForPeriod(
    repoConfig: ParsedRepo,
    since: Date,
    until: Date,
    displayDate: Date,
  ): Promise<ContentItem[]> {
    const { owner, repo } = repoConfig;
    const activityTypes = this.getEffectiveActivityTypes();

    console.log(`[${this.name}] Fetching GitHub data for ${owner}/${repo} from ${since.toISOString()} to ${until.toISOString()}`);
    console.log(`[${this.name}] Activity types enabled:`, Object.entries(activityTypes).filter(([_, v]) => v).map(([k]) => k).join(', '));

    const client = await this.getClient();

    // Fetch data using REST API - only fetch enabled activity types
    const fetchPromises: Promise<any>[] = [];
    const fetchOrder: string[] = [];

    if (activityTypes.newPRs) {
      fetchPromises.push(this.fetchPullRequestsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('pullRequests');
    }
    if (activityTypes.newIssues) {
      fetchPromises.push(this.fetchIssuesWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('issues');
    }
    if (activityTypes.commits) {
      fetchPromises.push(this.fetchCommitsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('commits');
    }
    if (activityTypes.comments) {
      fetchPromises.push(this.fetchCommentsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('comments');
    }
    if (activityTypes.reviews) {
      fetchPromises.push(this.fetchReviewSubmissionsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('reviewSubmissions');
    }
    if (activityTypes.reviewComments) {
      fetchPromises.push(this.fetchReviewCommentsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('reviewComments');
    }
    if (activityTypes.mergedPRs) {
      fetchPromises.push(this.fetchMergedPRsWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('mergedPRs');
    }
    if (activityTypes.closedIssues) {
      fetchPromises.push(this.fetchClosedIssuesWithOctokit(client, owner, repo, since, until));
      fetchOrder.push('closedIssues');
    }

    const results = await Promise.all(fetchPromises);

    // Map results to named data
    const fetchedData: Record<string, any> = {};
    fetchOrder.forEach((key, index) => {
      fetchedData[key] = results[index];
    });

    // Extract data with defaults for disabled types
    const pullRequests: RawPullRequest[] = fetchedData.pullRequests || [];
    const issues: RawIssue[] = fetchedData.issues || [];
    const commits: RawCommit[] = fetchedData.commits || [];
    const comments: RawComment[] = fetchedData.comments || [];
    const reviewSubmissions: RawReviewSubmission[] = fetchedData.reviewSubmissions || [];
    const reviewComments: RawReviewComment[] = fetchedData.reviewComments || [];
    const mergedPRs: MergedPRInfo[] = fetchedData.mergedPRs || [];
    const closedIssues: ClosedIssueInfo[] = fetchedData.closedIssues || [];

    // Filter out excluded contributors
    const excludeSet = new Set(this.config.contributorsToExclude || []);
    const filteredPRs = pullRequests.filter(pr => !excludeSet.has(pr.author?.login || ''));
    const filteredIssues = issues.filter(issue => !excludeSet.has(issue.author?.login || ''));
    const filteredCommits = commits.filter(commit => {
      const author = commit.author?.user?.login || commit.author?.name || '';
      return !excludeSet.has(author);
    });
    const filteredComments = comments.filter(c => !excludeSet.has(c.author?.login || ''));
    const filteredReviewSubmissions = reviewSubmissions.filter(r => !excludeSet.has(r.author?.login || ''));
    const filteredReviewComments = reviewComments.filter(rc => !excludeSet.has(rc.author?.login || ''));
    const filteredMergedPRs = mergedPRs.filter(pr => !excludeSet.has(pr.author || ''));
    const filteredClosedIssues = closedIssues.filter(issue => !excludeSet.has(issue.author || ''));

    // Calculate stats
    const stats = this.calculateStats(
      filteredPRs,
      filteredIssues,
      filteredCommits,
      filteredComments,
      filteredReviewSubmissions,
      filteredReviewComments,
      filteredMergedPRs,
      filteredClosedIssues,
      displayDate,
      owner,
      repo,
    );

    const data: RepositoryData = {
      owner,
      repo,
      pullRequests: filteredPRs,
      issues: filteredIssues,
      commits: filteredCommits,
      comments: filteredComments,
      reviewComments: filteredReviewComments,
      reviewSubmissions: filteredReviewSubmissions,
      mergedPRs: filteredMergedPRs,
      closedIssues: filteredClosedIssues,
      stats,
    };

    console.log(`[${this.name}] Fetched ${filteredPRs.length} PRs, ${filteredIssues.length} issues, ${filteredCommits.length} commits for ${owner}/${repo}`);

    // Convert to ContentItems
    return this.processRepoToContentItems(data, displayDate);
  }

  /**
   * Fetch pull requests using Octokit (REST API)
   */
  private async fetchPullRequestsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawPullRequest[]> {
    const prs: RawPullRequest[] = [];
    
    try {
      const { data } = await client.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      });

      for (const pr of data) {
        const createdAt = new Date(pr.created_at);
        if (createdAt >= since && createdAt < until) {
          // Fetch additional PR details for files
          let files: Array<{ path: string; additions: number; deletions: number; changeType?: string }> = [];
          try {
            const { data: prFiles } = await client.rest.pulls.listFiles({
              owner,
              repo,
              pull_number: pr.number,
              per_page: 50,
            });
            files = prFiles.map((f: { filename: string; additions: number; deletions: number; status: string }) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              changeType: f.status,
            }));
          } catch (e) {
            console.warn(`[${this.name}] Could not fetch files for PR #${pr.number}`);
          }

          prs.push({
            id: pr.node_id,
            number: pr.number,
            title: pr.title,
            body: pr.body || '',
            state: pr.state.toUpperCase(),
            merged: pr.merged_at !== null,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at || undefined,
            mergedAt: pr.merged_at || undefined,
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            changedFiles: pr.changed_files || 0,
            author: pr.user ? { login: pr.user.login, avatarUrl: pr.user.avatar_url } : undefined,
            files: { nodes: files },
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching PRs for ${owner}/${repo}:`, error);
    }

    return prs;
  }

  /**
   * Fetch issues using Octokit (REST API)
   */
  private async fetchIssuesWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawIssue[]> {
    const issues: RawIssue[] = [];
    
    try {
      const { data } = await client.rest.issues.listForRepo({
        owner,
        repo,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      });

      for (const issue of data) {
        // Skip pull requests (they appear in issues API)
        if (issue.pull_request) continue;

        const createdAt = new Date(issue.created_at);
        if (createdAt >= since && createdAt < until) {
          issues.push({
            id: issue.node_id,
            number: issue.number,
            title: issue.title,
            body: issue.body || '',
            state: issue.state.toUpperCase(),
            locked: issue.locked,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            closedAt: issue.closed_at || undefined,
            author: issue.user ? { login: issue.user.login, avatarUrl: issue.user.avatar_url } : undefined,
            labels: {
              nodes: (issue.labels || []).map((l: any) => ({
                id: typeof l === 'string' ? l : l.id?.toString() || '',
                name: typeof l === 'string' ? l : l.name || '',
                color: typeof l === 'string' ? '' : l.color || '',
              })),
            },
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching issues for ${owner}/${repo}:`, error);
    }

    return issues;
  }

  /**
   * Fetch commits using Octokit (REST API)
   */
  private async fetchCommitsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawCommit[]> {
    const commits: RawCommit[] = [];
    
    try {
      const { data } = await client.rest.repos.listCommits({
        owner,
        repo,
        since: since.toISOString(),
        until: until.toISOString(),
        per_page: 100,
      });

      for (const commit of data) {
        commits.push({
          oid: commit.sha,
          message: commit.commit.message,
          messageHeadline: commit.commit.message.split('\n')[0],
          committedDate: commit.commit.committer?.date || commit.commit.author?.date || '',
          author: {
            name: commit.commit.author?.name,
            email: commit.commit.author?.email,
            user: commit.author ? { login: commit.author.login, avatarUrl: commit.author.avatar_url } : undefined,
          },
          additions: commit.stats?.additions || 0,
          deletions: commit.stats?.deletions || 0,
          changedFiles: commit.files?.length || 0,
        });
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching commits for ${owner}/${repo}:`, error);
    }

    return commits;
  }

  /**
   * Fetch comments on issues and PRs using Octokit (REST API)
   * This gets comments made in the time range on ANY issue/PR (not just new ones)
   */
  private async fetchCommentsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawComment[]> {
    const comments: RawComment[] = [];
    
    try {
      const { data } = await client.rest.issues.listCommentsForRepo({
        owner,
        repo,
        since: since.toISOString(),
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      });

      for (const comment of data) {
        const createdAt = new Date(comment.created_at);
        if (createdAt >= since && createdAt < until) {
          // Extract issue/PR number from the URL
          const urlMatch = comment.issue_url?.match(/\/issues\/(\d+)$/);
          const issueNumber = urlMatch ? parseInt(urlMatch[1], 10) : 0;
          
          comments.push({
            id: comment.id.toString(),
            body: comment.body || '',
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            author: comment.user ? { login: comment.user.login, avatarUrl: comment.user.avatar_url } : undefined,
            issueNumber,
            isPullRequest: comment.html_url?.includes('/pull/') || false,
            htmlUrl: comment.html_url,
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching comments for ${owner}/${repo}:`, error);
    }

    return comments;
  }

  /**
   * Fetch inline code review comments on PRs using Octokit (REST API)
   * This gets review comments made in the time range on ANY PR
   */
  private async fetchReviewCommentsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawReviewComment[]> {
    const reviewComments: RawReviewComment[] = [];
    
    try {
      const { data } = await client.rest.pulls.listReviewCommentsForRepo({
        owner,
        repo,
        since: since.toISOString(),
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      });

      for (const comment of data) {
        const createdAt = new Date(comment.created_at);
        if (createdAt >= since && createdAt < until) {
          // Extract PR number from the URL
          const urlMatch = comment.pull_request_url?.match(/\/pulls\/(\d+)$/);
          const prNumber = urlMatch ? parseInt(urlMatch[1], 10) : 0;
          
          reviewComments.push({
            id: comment.id.toString(),
            body: comment.body || '',
            path: comment.path,
            line: comment.line || comment.original_line,
            side: comment.side,
            createdAt: comment.created_at,
            author: comment.user ? { login: comment.user.login, avatarUrl: comment.user.avatar_url } : undefined,
            prNumber,
            htmlUrl: comment.html_url,
            diffHunk: comment.diff_hunk,
            inReplyToId: comment.in_reply_to_id?.toString(),
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching review comments for ${owner}/${repo}:`, error);
    }

    return reviewComments;
  }

  /**
   * Fetch PR review submissions (approve/request changes/comment) using Octokit
   * This gets reviews submitted in the time range on recently updated PRs
   */
  private async fetchReviewSubmissionsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<RawReviewSubmission[]> {
    const reviewSubmissions: RawReviewSubmission[] = [];
    
    try {
      // First, get recently updated PRs to check for reviews
      const { data: prs } = await client.rest.pulls.list({
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });

      // Filter to PRs updated in our time range
      const recentPRs = prs.filter((pr: { updated_at: string; number: number; title: string }) => {
        const updatedAt = new Date(pr.updated_at);
        return updatedAt >= since;
      });

      // Fetch reviews for each recent PR
      for (const pr of recentPRs) {
        try {
          const { data: reviews } = await client.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
          });

          for (const review of reviews) {
            if (!review.submitted_at) continue;
            
            const submittedAt = new Date(review.submitted_at);
            if (submittedAt >= since && submittedAt < until) {
              reviewSubmissions.push({
                id: review.id.toString(),
                body: review.body || undefined,
                state: review.state.toUpperCase() as RawReviewSubmission['state'],
                submittedAt: review.submitted_at,
                author: review.user ? { login: review.user.login, avatarUrl: review.user.avatar_url } : undefined,
                prNumber: pr.number,
                prTitle: pr.title,
                htmlUrl: review.html_url,
              });
            }
          }
        } catch (error) {
          console.warn(`[${this.name}] Could not fetch reviews for PR #${pr.number}`);
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching review submissions for ${owner}/${repo}:`, error);
    }

    return reviewSubmissions;
  }

  /**
   * Fetch PRs that were merged in the time range (even if created earlier)
   */
  private async fetchMergedPRsWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<MergedPRInfo[]> {
    const mergedPRs: MergedPRInfo[] = [];
    
    try {
      const { data } = await client.rest.pulls.list({
        owner,
        repo,
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });

      for (const pr of data) {
        if (!pr.merged_at) continue;
        
        const mergedAt = new Date(pr.merged_at);
        if (mergedAt >= since && mergedAt < until) {
          mergedPRs.push({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login || 'unknown',
            mergedAt: pr.merged_at,
            mergedBy: pr.merged_by?.login,
            htmlUrl: pr.html_url,
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching merged PRs for ${owner}/${repo}:`, error);
    }

    return mergedPRs;
  }

  /**
   * Fetch issues that were closed in the time range (even if created earlier)
   */
  private async fetchClosedIssuesWithOctokit(
    client: Octokit,
    owner: string,
    repo: string,
    since: Date,
    until: Date,
  ): Promise<ClosedIssueInfo[]> {
    const closedIssues: ClosedIssueInfo[] = [];
    
    try {
      const { data } = await client.rest.issues.listForRepo({
        owner,
        repo,
        state: 'closed',
        since: since.toISOString(),
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
      });

      for (const issue of data) {
        // Skip pull requests
        if (issue.pull_request) continue;
        if (!issue.closed_at) continue;
        
        const closedAt = new Date(issue.closed_at);
        if (closedAt >= since && closedAt < until) {
          closedIssues.push({
            number: issue.number,
            title: issue.title,
            author: issue.user?.login || 'unknown',
            closedAt: issue.closed_at,
            htmlUrl: issue.html_url,
            stateReason: issue.state_reason as ClosedIssueInfo['stateReason'],
          });
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching closed issues for ${owner}/${repo}:`, error);
    }

    return closedIssues;
  }

  /**
   * Calculate daily statistics from fetched data for a single repo
   */
  private calculateStats(
    prs: RawPullRequest[],
    issues: RawIssue[],
    commits: RawCommit[],
    comments: RawComment[],
    reviewSubmissions: RawReviewSubmission[],
    reviewComments: RawReviewComment[],
    mergedPRs: MergedPRInfo[],
    closedIssues: ClosedIssueInfo[],
    date: Date,
    owner: string,
    repo: string,
  ): DailyStats {
    const contributorMap = new Map<string, ContributorStats>();

    // Helper to get or create contributor stats
    const getContributor = (username: string, avatarUrl?: string): ContributorStats => {
      if (!contributorMap.has(username)) {
        contributorMap.set(username, {
          username,
          avatarUrl,
          prsOpened: 0,
          prsMerged: 0,
          prsClosed: 0,
          issuesOpened: 0,
          issuesClosed: 0,
          commits: 0,
          reviews: 0,
          comments: 0,
          additions: 0,
          deletions: 0,
        });
      }
      return contributorMap.get(username)!;
    };

    // Process PRs
    for (const pr of prs) {
      const author = pr.author?.login || 'unknown';
      const contributor = getContributor(author, pr.author?.avatarUrl);
      
      contributor.prsOpened++;
      if (pr.merged) contributor.prsMerged++;
      else if (pr.state === 'CLOSED') contributor.prsClosed++;
      
      contributor.additions += pr.additions;
      contributor.deletions += pr.deletions;

      // Count reviews
      for (const review of pr.reviews?.nodes || []) {
        if (review.author?.login) {
          const reviewer = getContributor(review.author.login, review.author.avatarUrl);
          reviewer.reviews++;
        }
      }

      // Count comments
      for (const comment of pr.comments?.nodes || []) {
        if (comment.author?.login) {
          const commenter = getContributor(comment.author.login, comment.author.avatarUrl);
          commenter.comments++;
        }
      }
    }

    // Process issues
    for (const issue of issues) {
      const author = issue.author?.login || 'unknown';
      const contributor = getContributor(author, issue.author?.avatarUrl);
      
      contributor.issuesOpened++;
      if (issue.state === 'CLOSED') contributor.issuesClosed++;

      // Count comments
      for (const comment of issue.comments?.nodes || []) {
        if (comment.author?.login) {
          const commenter = getContributor(comment.author.login, comment.author.avatarUrl);
          commenter.comments++;
        }
      }
    }

    // Process commits
    for (const commit of commits) {
      const author = commit.author?.user?.login || commit.author?.name || 'unknown';
      const contributor = getContributor(author, commit.author?.user?.avatarUrl);
      
      contributor.commits++;
      contributor.additions += commit.additions;
      contributor.deletions += commit.deletions;
    }

    // Process comments (on old PRs/issues)
    for (const comment of comments) {
      const author = comment.author?.login || 'unknown';
      const contributor = getContributor(author, comment.author?.avatarUrl);
      contributor.comments++;
    }

    // Process review submissions
    for (const review of reviewSubmissions) {
      const author = review.author?.login || 'unknown';
      const contributor = getContributor(author, review.author?.avatarUrl);
      contributor.reviews++;
    }

    // Process review comments (inline code comments)
    for (const reviewComment of reviewComments) {
      const author = reviewComment.author?.login || 'unknown';
      const contributor = getContributor(author, reviewComment.author?.avatarUrl);
      contributor.comments++;
    }

    // Process merged PRs (contributor who merged)
    for (const mergedPR of mergedPRs) {
      if (mergedPR.mergedBy) {
        const contributor = getContributor(mergedPR.mergedBy);
        contributor.prsMerged++;
      }
    }

    // Closed issues don't add to contributor stats (just tracked in overall stats)

    return {
      date: date.toISOString().split('T')[0],
      repository: `${owner}/${repo}`,
      prsOpened: prs.length,
      prsMerged: prs.filter(pr => pr.merged).length + mergedPRs.length,
      prsClosed: prs.filter(pr => pr.state === 'CLOSED' && !pr.merged).length,
      issuesOpened: issues.length,
      issuesClosed: issues.filter(i => i.state === 'CLOSED').length + closedIssues.length,
      commits: commits.length,
      activeContributors: Array.from(contributorMap.keys()),
      contributors: Array.from(contributorMap.values()),
    };
  }

  /**
   * Get human-readable period label from interval seconds
   */
  private getPeriodLabel(): string {
    const interval = this.config.interval;
    if (!interval) return 'day';
    
    if (interval < 60) return `${interval}s`;
    if (interval < 3600) return `${Math.round(interval / 60)}m`;
    if (interval < 86400) return `${Math.round(interval / 3600)}h`;
    if (interval === 86400) return 'day';
    return `${Math.round(interval / 86400)}d`;
  }

  /**
   * Convert repository data to ContentItems (one set per repo)
   */
  private async processRepoToContentItems(
    data: RepositoryData,
    date: Date,
  ): Promise<ContentItem[]> {
    const { owner, repo } = data;
    const baseGithubUrl = `https://github.com/${owner}/${repo}/`;
    const baseGithubImageUrl = `https://opengraph.githubassets.com/1/${owner}/${repo}/`;

    // Summarized mode: single comprehensive ContentItem per repo
    if (this.config.mode === 'summarized') {
      const summaryItem = await this.generateSummarizedItem(data, date, baseGithubUrl);
      return summaryItem ? [summaryItem] : [];
    }

    // Raw mode: all individual items + summary + contributor stats
    const items: ContentItem[] = [];
    const dateEpoch = Math.floor(date.getTime() / 1000);
    const dateStr = date.toISOString().split('T')[0];

    // Process Pull Requests (with file-level details)
    for (const pr of data.pullRequests) {
      // Extract file-level details
      const files = (pr.files?.nodes || []).map(f => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        changeType: f.changeType,
      }));

      items.push({
        cid: `github-pr-${owner}-${repo}-${pr.number}`,
        type: 'githubPullRequest',
        source: this.name,
        title: pr.title,
        text: pr.body || '',
        link: `${baseGithubUrl}pull/${pr.number}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          number: pr.number,
          state: pr.state,
          merged: pr.merged,
          author: pr.author?.login,
          authorAvatar: pr.author?.avatarUrl,
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          // File-level details
          files,
          labels: pr.labels?.nodes.map(l => l.name) || [],
          reviewCount: pr.reviews?.nodes.length || 0,
          commentCount: pr.comments?.nodes.length || 0,
          mergedAt: pr.mergedAt,
          closedAt: pr.closedAt,
          createdAt: pr.createdAt,
          photos: [`${baseGithubImageUrl}pull/${pr.number}`],
        },
      });
    }

    // Process Issues
    for (const issue of data.issues) {
      items.push({
        cid: `github-issue-${owner}-${repo}-${issue.number}`,
        type: 'githubIssue',
        source: this.name,
        title: issue.title,
        text: issue.body || '',
        link: `${baseGithubUrl}issues/${issue.number}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          number: issue.number,
          state: issue.state,
          locked: issue.locked,
          author: issue.author?.login,
          authorAvatar: issue.author?.avatarUrl,
          labels: issue.labels?.nodes.map(l => l.name) || [],
          commentCount: issue.comments?.nodes.length || 0,
          closedAt: issue.closedAt,
          createdAt: issue.createdAt,
          photos: [`${baseGithubImageUrl}issues/${issue.number}`],
        },
      });
    }

    // Process Commits
    for (const commit of data.commits) {
      const author = commit.author?.user?.login || commit.author?.name || 'unknown';
      items.push({
        cid: `github-commit-${owner}-${repo}-${commit.oid}`,
        type: 'githubCommit',
        source: this.name,
        title: commit.messageHeadline || commit.message.split('\n')[0],
        text: commit.message,
        link: `${baseGithubUrl}commit/${commit.oid}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          sha: commit.oid,
          shortSha: commit.oid.substring(0, 7),
          author,
          authorName: commit.author?.name,
          authorEmail: commit.author?.email,
          authorAvatar: commit.author?.user?.avatarUrl,
          additions: commit.additions,
          deletions: commit.deletions,
          changedFiles: commit.changedFiles,
          committedDate: commit.committedDate,
          photos: [`${baseGithubImageUrl}commit/${commit.oid}`],
        },
      });
    }

    // Process Reviews (from PRs)
    for (const pr of data.pullRequests) {
      for (const review of pr.reviews?.nodes || []) {
        if (review.author?.login) {
          items.push({
            cid: `github-review-${owner}-${repo}-${review.id}`,
            type: 'githubReview',
            source: this.name,
            title: `Review on PR #${pr.number}: ${pr.title}`,
            text: review.body || '',
            link: review.url || `${baseGithubUrl}pull/${pr.number}#pullrequestreview-${review.id.split('_').pop()}`,
            date: dateEpoch,
            metadata: {
              repository: `${owner}/${repo}`,
              prNumber: pr.number,
              prTitle: pr.title,
              state: review.state,
              author: review.author.login,
              authorAvatar: review.author.avatarUrl,
              submittedAt: review.submittedAt,
              createdAt: review.createdAt,
            },
          });
        }
      }
    }

    // Process Comments (on any issue/PR, not just new ones)
    for (const comment of data.comments) {
      const parentType = comment.isPullRequest ? 'PR' : 'Issue';
      items.push({
        cid: `github-comment-${owner}-${repo}-${comment.id}`,
        type: 'githubComment',
        source: this.name,
        title: `Comment on ${parentType} #${comment.issueNumber}`,
        text: comment.body || '',
        link: comment.htmlUrl || `${baseGithubUrl}issues/${comment.issueNumber}#issuecomment-${comment.id}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          commentId: comment.id,
          parentType,
          parentNumber: comment.issueNumber,
          author: comment.author?.login,
          authorAvatar: comment.author?.avatarUrl,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        },
      });
    }

    // Process Review Comments (inline code comments on PRs)
    for (const reviewComment of data.reviewComments) {
      items.push({
        cid: `github-review-comment-${owner}-${repo}-${reviewComment.id}`,
        type: 'githubReviewComment',
        source: this.name,
        title: `Code comment on PR #${reviewComment.prNumber}: ${reviewComment.path}`,
        text: reviewComment.body || '',
        link: reviewComment.htmlUrl || `${baseGithubUrl}pull/${reviewComment.prNumber}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          commentId: reviewComment.id,
          prNumber: reviewComment.prNumber,
          path: reviewComment.path,
          line: reviewComment.line,
          side: reviewComment.side,
          author: reviewComment.author?.login,
          authorAvatar: reviewComment.author?.avatarUrl,
          diffHunk: reviewComment.diffHunk,
          inReplyToId: reviewComment.inReplyToId,
          createdAt: reviewComment.createdAt,
        },
      });
    }

    // Process Review Submissions (approve/request changes/comment on PRs)
    for (const review of data.reviewSubmissions) {
      const stateText = review.state === 'APPROVED' ? 'approved'
        : review.state === 'CHANGES_REQUESTED' ? 'requested changes on'
        : review.state === 'COMMENTED' ? 'commented on'
        : review.state === 'DISMISSED' ? 'had review dismissed on'
        : 'reviewed';
      
      items.push({
        cid: `github-review-submission-${owner}-${repo}-${review.id}`,
        type: 'githubReviewSubmission',
        source: this.name,
        title: `${review.state} review on PR #${review.prNumber}: ${review.prTitle}`,
        text: review.body || `@${review.author?.login || 'unknown'} ${stateText} PR #${review.prNumber}`,
        link: review.htmlUrl || `${baseGithubUrl}pull/${review.prNumber}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          reviewId: review.id,
          prNumber: review.prNumber,
          prTitle: review.prTitle,
          state: review.state,
          author: review.author?.login,
          authorAvatar: review.author?.avatarUrl,
          submittedAt: review.submittedAt,
        },
      });
    }

    // Process Merged PRs (PRs merged today, even if created earlier)
    for (const mergedPR of data.mergedPRs) {
      items.push({
        cid: `github-pr-merged-${owner}-${repo}-${mergedPR.number}-${dateStr}`,
        type: 'githubPullRequestMerged',
        source: this.name,
        title: `PR #${mergedPR.number} merged: ${mergedPR.title}`,
        text: `PR "${mergedPR.title}" by @${mergedPR.author} was merged${mergedPR.mergedBy ? ` by @${mergedPR.mergedBy}` : ''}.`,
        link: mergedPR.htmlUrl || `${baseGithubUrl}pull/${mergedPR.number}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          number: mergedPR.number,
          title: mergedPR.title,
          author: mergedPR.author,
          mergedAt: mergedPR.mergedAt,
          mergedBy: mergedPR.mergedBy,
        },
      });
    }

    // Process Closed Issues (issues closed today, even if created earlier)
    for (const closedIssue of data.closedIssues) {
      const reasonText = closedIssue.stateReason === 'completed' ? 'completed'
        : closedIssue.stateReason === 'not_planned' ? 'closed as not planned'
        : 'closed';
      
      items.push({
        cid: `github-issue-closed-${owner}-${repo}-${closedIssue.number}-${dateStr}`,
        type: 'githubIssueClosed',
        source: this.name,
        title: `Issue #${closedIssue.number} ${reasonText}: ${closedIssue.title}`,
        text: `Issue "${closedIssue.title}" by @${closedIssue.author} was ${reasonText}.`,
        link: closedIssue.htmlUrl || `${baseGithubUrl}issues/${closedIssue.number}`,
        date: dateEpoch,
        metadata: {
          repository: `${owner}/${repo}`,
          number: closedIssue.number,
          title: closedIssue.title,
          author: closedIssue.author,
          closedAt: closedIssue.closedAt,
          stateReason: closedIssue.stateReason,
        },
      });
    }

    // Generate daily summary
    const summaryItem = await this.generateSummaryItem(data, date, baseGithubUrl);
    if (summaryItem) {
      items.push(summaryItem);
    }

    // Generate contributor stats items
    for (const contributor of data.stats.contributors) {
      items.push({
        cid: `github-contributor-${owner}-${repo}-${contributor.username}-${dateStr}`,
        type: 'githubContributorStats',
        source: this.name,
        title: `@${contributor.username} contributions to ${owner}/${repo} on ${dateStr}`,
        text: this.formatContributorSummary(contributor),
        date: dateEpoch,
        metadata: {
          ...contributor,
          repository: `${owner}/${repo}`,
          period: 'day',
        },
      });
    }

    return items;
  }

  /**
   * Generate comprehensive summary ContentItem for summarized mode
   */
  private async generateSummarizedItem(
    data: RepositoryData,
    date: Date,
    baseGithubUrl: string,
  ): Promise<ContentItem> {
    const { owner, repo } = data;
    const dateStr = date.toISOString().split('T')[0];
    const dateEpoch = Math.floor(date.getTime() / 1000);
    const periodLabel = this.getPeriodLabel();

    // Build comprehensive metadata with all item references (including file details)
    const metadata = {
      repository: `${owner}/${repo}`,
      period: periodLabel,
      intervalSeconds: this.config.interval,
      date: dateStr,
      
      // Aggregated stats
      stats: {
        prsOpened: data.stats.prsOpened,
        prsMerged: data.stats.prsMerged,
        prsClosed: data.stats.prsClosed,
        issuesOpened: data.stats.issuesOpened,
        issuesClosed: data.stats.issuesClosed,
        commits: data.stats.commits,
        comments: data.comments.length,
        reviewComments: data.reviewComments.length,
        reviewSubmissions: data.reviewSubmissions.length,
        mergedPRsToday: data.mergedPRs.length,
        closedIssuesToday: data.closedIssues.length,
        activeContributors: data.stats.activeContributors.length,
      },
      
      // All PR references with file-level details
      pullRequests: data.pullRequests.map(pr => ({
        number: pr.number,
        title: pr.title,
        author: pr.author?.login || 'unknown',
        state: pr.state,
        merged: pr.merged,
        additions: pr.additions,
        deletions: pr.deletions,
        url: `${baseGithubUrl}pull/${pr.number}`,
        // File-level details
        files: (pr.files?.nodes || []).map(f => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
        })),
      })),
      
      // All issue references
      issues: data.issues.map(issue => ({
        number: issue.number,
        title: issue.title,
        author: issue.author?.login || 'unknown',
        state: issue.state,
        url: `${baseGithubUrl}issues/${issue.number}`,
      })),
      
      // All commit references (shortened SHA)
      commits: data.commits.map(commit => ({
        sha: commit.oid.substring(0, 7),
        message: commit.messageHeadline || commit.message.split('\n')[0],
        author: commit.author?.user?.login || commit.author?.name || 'unknown',
        additions: commit.additions,
        deletions: commit.deletions,
        url: `${baseGithubUrl}commit/${commit.oid}`,
      })),
      
      // All review references (from new PRs)
      reviews: data.pullRequests.flatMap(pr => 
        (pr.reviews?.nodes || [])
          .filter(r => r.author?.login)
          .map(review => ({
            id: review.id,
            prNumber: pr.number,
            author: review.author!.login,
            state: review.state,
          }))
      ),
      
      // Comments on any issue/PR (not just new ones)
      comments: data.comments.map(comment => ({
        id: comment.id,
        parentType: comment.isPullRequest ? 'PR' : 'Issue',
        parentNumber: comment.issueNumber,
        author: comment.author?.login || 'unknown',
        url: comment.htmlUrl,
        createdAt: comment.createdAt,
      })),
      
      // Inline code review comments
      reviewComments: data.reviewComments.map(rc => ({
        id: rc.id,
        prNumber: rc.prNumber,
        path: rc.path,
        line: rc.line,
        author: rc.author?.login || 'unknown',
        url: rc.htmlUrl,
        createdAt: rc.createdAt,
      })),
      
      // Review submissions (approve/request changes)
      reviewSubmissions: data.reviewSubmissions.map(rs => ({
        id: rs.id,
        prNumber: rs.prNumber,
        prTitle: rs.prTitle,
        author: rs.author?.login || 'unknown',
        state: rs.state,
        url: rs.htmlUrl,
        submittedAt: rs.submittedAt,
      })),
      
      // PRs merged today (even if created earlier)
      mergedPRs: data.mergedPRs.map(pr => ({
        number: pr.number,
        title: pr.title,
        author: pr.author,
        mergedBy: pr.mergedBy,
        mergedAt: pr.mergedAt,
        url: pr.htmlUrl,
      })),
      
      // Issues closed today (even if created earlier)
      closedIssues: data.closedIssues.map(issue => ({
        number: issue.number,
        title: issue.title,
        author: issue.author,
        stateReason: issue.stateReason,
        closedAt: issue.closedAt,
        url: issue.htmlUrl,
      })),
      
      // Top contributors with full stats
      topContributors: data.stats.contributors
        .sort((a, b) => {
          const aScore = a.prsOpened * 10 + a.commits * 2 + a.reviews * 5 + a.comments;
          const bScore = b.prsOpened * 10 + b.commits * 2 + b.reviews * 5 + b.comments;
          return bScore - aScore;
        })
        .slice(0, 10)
        .map(c => ({
          username: c.username,
          prsOpened: c.prsOpened,
          prsMerged: c.prsMerged,
          commits: c.commits,
          reviews: c.reviews,
          comments: c.comments,
          additions: c.additions,
          deletions: c.deletions,
        })),
    };

    // Generate detailed summary text
    const summaryText = await this.generateDetailedSummaryText(data, dateStr, baseGithubUrl);

    return {
      cid: `github-summary-${owner}-${repo}-${dateStr}-${dateEpoch}`,
      type: 'githubContributionsSummary',
      source: this.name,
      title: `${owner}/${repo} - ${periodLabel} Summary (${dateStr})`,
      text: summaryText,
      date: dateEpoch,
      metadata,
    };
  }

  /**
   * Generate detailed summary text for summarized mode
   */
  private async generateDetailedSummaryText(data: RepositoryData, dateStr: string, baseGithubUrl: string): Promise<string> {
    const { owner, repo } = data;

    // If AI enabled, use AI provider
    if (this.config.aiSummary?.enabled && this.config.aiSummary?.provider) {
      try {
        const input = generateSummarizeInput(
          `${owner}/${repo}`,
          dateStr,
          data.pullRequests,
          data.issues,
          data.commits,
        );
        return await this.config.aiSummary.provider.summarize(input, SUMMARIZE_OPTIONS.githubSummary);
      } catch (error) {
        console.error(`[${this.name}] AI summary generation failed:`, error);
      }
    }

    // Detailed template summary
    return this.generateDetailedTemplateSummary(data, dateStr, baseGithubUrl);
  }

  /**
   * Generate detailed template-based summary with file details
   */
  private generateDetailedTemplateSummary(data: RepositoryData, dateStr: string, baseGithubUrl: string): string {
    const { owner, repo } = data;
    const parts: string[] = [];

    parts.push(`## ${owner}/${repo} Activity Summary`);
    parts.push(`**Period:** ${this.getPeriodLabel()} | **Date:** ${dateStr}\n`);

    // Stats overview
    parts.push('### Statistics');
    parts.push(`- **Pull Requests:** ${data.stats.prsOpened} opened, ${data.stats.prsMerged} merged, ${data.stats.prsClosed} closed`);
    parts.push(`- **Issues:** ${data.stats.issuesOpened} opened, ${data.stats.issuesClosed} closed`);
    parts.push(`- **Commits:** ${data.stats.commits}`);
    if (data.mergedPRs.length > 0) {
      parts.push(`- **PRs Merged Today:** ${data.mergedPRs.length}`);
    }
    if (data.closedIssues.length > 0) {
      parts.push(`- **Issues Closed Today:** ${data.closedIssues.length}`);
    }
    if (data.comments.length > 0 || data.reviewComments.length > 0) {
      parts.push(`- **Comments:** ${data.comments.length} discussion, ${data.reviewComments.length} code review`);
    }
    if (data.reviewSubmissions.length > 0) {
      parts.push(`- **Reviews Submitted:** ${data.reviewSubmissions.length}`);
    }
    parts.push(`- **Active Contributors:** ${data.stats.activeContributors.length}\n`);

    // List all PRs with file details
    if (data.pullRequests.length > 0) {
      parts.push('### Pull Requests');
      for (const pr of data.pullRequests) {
        const status = pr.merged ? 'MERGED' : pr.state;
        parts.push(`- **#${pr.number}** ${pr.title} (@${pr.author?.login || 'unknown'}) [${status}] +${pr.additions}/-${pr.deletions}`);
        
        // Include file-level details
        const files = pr.files?.nodes || [];
        if (files.length > 0) {
          const fileList = files.slice(0, 5).map(f => `  - \`${f.path}\` +${f.additions}/-${f.deletions}`);
          parts.push(...fileList);
          if (files.length > 5) {
            parts.push(`  - ... and ${files.length - 5} more files`);
          }
        }
      }
      parts.push('');
    }

    // List all issues
    if (data.issues.length > 0) {
      parts.push('### Issues');
      for (const issue of data.issues) {
        parts.push(`- **#${issue.number}** ${issue.title} (@${issue.author?.login || 'unknown'}) [${issue.state}]`);
      }
      parts.push('');
    }

    // List commits grouped by author
    if (data.commits.length > 0) {
      parts.push('### Commits');
      const byAuthor = new Map<string, typeof data.commits>();
      for (const c of data.commits) {
        const author = c.author?.user?.login || c.author?.name || 'unknown';
        if (!byAuthor.has(author)) byAuthor.set(author, []);
        byAuthor.get(author)!.push(c);
      }
      for (const [author, commits] of byAuthor) {
        parts.push(`**@${author}** (${commits.length} commits):`);
        for (const c of commits) {
          parts.push(`  - \`${c.oid.substring(0, 7)}\` ${c.messageHeadline || c.message.split('\n')[0]}`);
        }
      }
      parts.push('');
    }

    // List PRs merged today (even if created earlier)
    if (data.mergedPRs.length > 0) {
      parts.push('### PRs Merged Today');
      for (const pr of data.mergedPRs) {
        const mergedBy = pr.mergedBy ? ` (merged by @${pr.mergedBy})` : '';
        parts.push(`- **#${pr.number}** ${pr.title} (@${pr.author})${mergedBy}`);
      }
      parts.push('');
    }

    // List issues closed today (even if created earlier)
    if (data.closedIssues.length > 0) {
      parts.push('### Issues Closed Today');
      for (const issue of data.closedIssues) {
        const reason = issue.stateReason === 'completed' ? 'completed' 
          : issue.stateReason === 'not_planned' ? 'not planned' 
          : 'closed';
        parts.push(`- **#${issue.number}** ${issue.title} (@${issue.author}) [${reason}]`);
      }
      parts.push('');
    }

    // List review submissions (approve/request changes/comment)
    if (data.reviewSubmissions.length > 0) {
      parts.push('### Reviews Submitted');
      const byReviewer = new Map<string, typeof data.reviewSubmissions>();
      for (const r of data.reviewSubmissions) {
        const author = r.author?.login || 'unknown';
        if (!byReviewer.has(author)) byReviewer.set(author, []);
        byReviewer.get(author)!.push(r);
      }
      for (const [reviewer, reviews] of byReviewer) {
        parts.push(`**@${reviewer}** (${reviews.length} reviews):`);
        for (const r of reviews) {
          const stateEmoji = r.state === 'APPROVED' ? 'approved' 
            : r.state === 'CHANGES_REQUESTED' ? 'requested changes'
            : r.state === 'COMMENTED' ? 'commented'
            : r.state.toLowerCase();
          parts.push(`  - PR #${r.prNumber}: ${stateEmoji}`);
        }
      }
      parts.push('');
    }

    // List discussion comments (on issues/PRs)
    if (data.comments.length > 0) {
      parts.push('### Discussion Comments');
      const byAuthor = new Map<string, typeof data.comments>();
      for (const c of data.comments) {
        const author = c.author?.login || 'unknown';
        if (!byAuthor.has(author)) byAuthor.set(author, []);
        byAuthor.get(author)!.push(c);
      }
      for (const [author, comments] of byAuthor) {
        const prComments = comments.filter(c => c.isPullRequest).length;
        const issueComments = comments.length - prComments;
        const breakdown: string[] = [];
        if (prComments > 0) breakdown.push(`${prComments} on PRs`);
        if (issueComments > 0) breakdown.push(`${issueComments} on issues`);
        parts.push(`- **@${author}**: ${comments.length} comments (${breakdown.join(', ')})`);
      }
      parts.push('');
    }

    // List code review comments (inline on PRs)
    if (data.reviewComments.length > 0) {
      parts.push('### Code Review Comments');
      const byAuthor = new Map<string, typeof data.reviewComments>();
      for (const c of data.reviewComments) {
        const author = c.author?.login || 'unknown';
        if (!byAuthor.has(author)) byAuthor.set(author, []);
        byAuthor.get(author)!.push(c);
      }
      for (const [author, comments] of byAuthor) {
        const prNumbers = [...new Set(comments.map(c => c.prNumber))];
        parts.push(`- **@${author}**: ${comments.length} inline comments on ${prNumbers.length} PR(s)`);
      }
      parts.push('');
    }

    // Top contributors
    if (data.stats.contributors.length > 0) {
      parts.push('### Top Contributors');
      const sorted = [...data.stats.contributors].sort((a, b) => {
        const aScore = a.prsOpened * 10 + a.commits * 2 + a.reviews * 5;
        const bScore = b.prsOpened * 10 + b.commits * 2 + b.reviews * 5;
        return bScore - aScore;
      });
      for (const c of sorted.slice(0, 10)) {
        const activities: string[] = [];
        if (c.prsOpened > 0) activities.push(`${c.prsOpened} PRs`);
        if (c.commits > 0) activities.push(`${c.commits} commits`);
        if (c.reviews > 0) activities.push(`${c.reviews} reviews`);
        if (c.comments > 0) activities.push(`${c.comments} comments`);
        parts.push(`- **@${c.username}**: ${activities.join(', ')} (+${c.additions}/-${c.deletions})`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Generate simple summary item for raw mode
   */
  private async generateSummaryItem(
    data: RepositoryData,
    date: Date,
    baseGithubUrl: string,
  ): Promise<ContentItem | null> {
    const { owner, repo } = data;
    const dateStr = date.toISOString().split('T')[0];
    const dateEpoch = Math.floor(date.getTime() / 1000);

    // Generate summary text
    let summaryText: string;

    if (this.config.aiSummary?.enabled && this.config.aiSummary?.provider) {
      try {
        const input = generateSummarizeInput(
          `${owner}/${repo}`,
          dateStr,
          data.pullRequests,
          data.issues,
          data.commits,
        );
        summaryText = await this.config.aiSummary.provider.summarize(input, SUMMARIZE_OPTIONS.githubSummary);
      } catch (error) {
        console.error(`[${this.name}] AI summary generation failed:`, error);
        summaryText = this.generateSimpleSummary(data, dateStr, baseGithubUrl);
      }
    } else {
      summaryText = this.generateSimpleSummary(data, dateStr, baseGithubUrl);
    }

    return {
      cid: `github-summary-${owner}-${repo}-${dateStr}`,
      type: 'githubContributionsSummary',
      source: this.name,
      title: `${owner}/${repo} - ${dateStr} Contributions Summary`,
      text: summaryText,
      date: dateEpoch,
      metadata: {
        repository: `${owner}/${repo}`,
        period: 'day',
        date: dateStr,
        stats: {
          prsOpened: data.stats.prsOpened,
          prsMerged: data.stats.prsMerged,
          prsClosed: data.stats.prsClosed,
          issuesOpened: data.stats.issuesOpened,
          issuesClosed: data.stats.issuesClosed,
          commits: data.stats.commits,
          activeContributors: data.stats.activeContributors.length,
        },
        topContributors: data.stats.contributors
          .sort((a, b) => {
            const aScore = a.prsOpened * 10 + a.commits * 2 + a.reviews * 5 + a.comments;
            const bScore = b.prsOpened * 10 + b.commits * 2 + b.reviews * 5 + b.comments;
            return bScore - aScore;
          })
          .slice(0, 5)
          .map(c => c.username),
      },
    };
  }

  /**
   * Generate a simple summary without AI
   */
  private generateSimpleSummary(data: RepositoryData, dateStr: string, baseGithubUrl: string): string {
    const { owner, repo } = data;
    const parts: string[] = [];

    parts.push(`## GitHub Activity Summary for ${owner}/${repo}`);
    parts.push(`**Date:** ${dateStr}\n`);

    // Stats overview
    parts.push('### Overview');
    parts.push(`- **Pull Requests:** ${data.stats.prsOpened} opened, ${data.stats.prsMerged} merged`);
    parts.push(`- **Issues:** ${data.stats.issuesOpened} opened, ${data.stats.issuesClosed} closed`);
    parts.push(`- **Commits:** ${data.stats.commits}`);
    parts.push(`- **Active Contributors:** ${data.stats.activeContributors.length}\n`);

    // Top PRs
    if (data.pullRequests.length > 0) {
      parts.push('### Notable Pull Requests');
      const topPRs = data.pullRequests
        .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
        .slice(0, 5);
      for (const pr of topPRs) {
        const status = pr.merged ? 'merged' : pr.state.toLowerCase();
        parts.push(`- [#${pr.number}](${baseGithubUrl}pull/${pr.number}) ${pr.title} (${status}, +${pr.additions}/-${pr.deletions})`);
      }
      parts.push('');
    }

    // Top issues
    if (data.issues.length > 0) {
      parts.push('### Notable Issues');
      const topIssues = data.issues.slice(0, 5);
      for (const issue of topIssues) {
        parts.push(`- [#${issue.number}](${baseGithubUrl}issues/${issue.number}) ${issue.title} (${issue.state.toLowerCase()})`);
      }
      parts.push('');
    }

    // Top contributors
    if (data.stats.contributors.length > 0) {
      parts.push('### Top Contributors');
      const sorted = [...data.stats.contributors].sort((a, b) => {
        const aScore = a.prsOpened * 10 + a.commits * 2 + a.reviews * 5;
        const bScore = b.prsOpened * 10 + b.commits * 2 + b.reviews * 5;
        return bScore - aScore;
      });
      for (const c of sorted.slice(0, 5)) {
        const activities: string[] = [];
        if (c.prsOpened > 0) activities.push(`${c.prsOpened} PRs`);
        if (c.commits > 0) activities.push(`${c.commits} commits`);
        if (c.reviews > 0) activities.push(`${c.reviews} reviews`);
        parts.push(`- **@${c.username}**: ${activities.join(', ')}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Format a single contributor's summary
   */
  private formatContributorSummary(contributor: ContributorStats): string {
    const parts: string[] = [];
    
    if (contributor.prsOpened > 0) {
      parts.push(`${contributor.prsOpened} PR(s) opened`);
    }
    if (contributor.prsMerged > 0) {
      parts.push(`${contributor.prsMerged} merged`);
    }
    if (contributor.commits > 0) {
      parts.push(`${contributor.commits} commit(s)`);
    }
    if (contributor.reviews > 0) {
      parts.push(`${contributor.reviews} review(s)`);
    }
    if (contributor.comments > 0) {
      parts.push(`${contributor.comments} comment(s)`);
    }
    if (contributor.additions > 0 || contributor.deletions > 0) {
      parts.push(`+${contributor.additions}/-${contributor.deletions} lines`);
    }

    return parts.join(', ');
  }
}
