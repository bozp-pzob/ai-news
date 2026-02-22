/**
 * GitHub API Client
 * 
 * Enhanced GitHub API client with robust rate limiting and retry handling.
 * Uses GraphQL for efficient data fetching with pagination support.
 * 
 * Based on elizaOS implementation patterns.
 */

import { Octokit } from 'octokit';
import pRetry, { AbortError } from 'p-retry';
import { delay } from '../helpers/generalHelper';
import {
  TokenBucket,
  RateLimitInfo,
  ConcurrencyManager,
  AdaptiveConcurrencyManager,
  RateLimitExceededError,
  SecondaryRateLimitError,
  DEFAULT_RETRY_CONFIG,
  createGraphQLPointsBucket,
  createConcurrentBucket,
  consumeTokens,
  parseRateLimitError,
} from '../helpers/rateLimiter';
import {
  RawPullRequest,
  RawIssue,
  RawCommit,
  GitHubRepository,
  GitHubAuthenticatedUser,
  RawPullRequestSchema,
  RawIssueSchema,
  RawCommitSchema,
  GitHubRepositorySchema,
  GitHubAuthenticatedUserSchema,
  FetchOptions,
  GitHubPageInfo,
  GitHubSearchResponse,
  GitHubRepositoryResponse,
  GitHubGraphQLResponse,
} from '../types';

/**
 * Simple logger interface
 */
interface Logger {
  debug(message: string, meta?: Record<string, any>): void;
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
}

/**
 * Default console-based logger
 */
const defaultLogger: Logger = {
  debug: (msg, meta) => console.debug(`[GitHub] ${msg}`, meta || ''),
  info: (msg, meta) => console.info(`[GitHub] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[GitHub] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[GitHub] ${msg}`, meta || ''),
};

/**
 * GitHub API Client with comprehensive rate limiting
 */
export class GitHubApiClient {
  private octokit: Octokit;
  private logger: Logger;
  private rateLimitInfo: RateLimitInfo | null = null;
  private concurrencyManager: AdaptiveConcurrencyManager;
  private pointsBucket: TokenBucket;
  private concurrentBucket: TokenBucket;

  constructor(token: string, logger?: Logger) {
    this.logger = logger || defaultLogger;

    if (!token) {
      throw new Error('GitHub token is required');
    }

    this.octokit = new Octokit({ auth: token });
    this.concurrencyManager = new AdaptiveConcurrencyManager();
    this.pointsBucket = createGraphQLPointsBucket();
    this.concurrentBucket = createConcurrentBucket();
  }

  /**
   * Get the concurrency manager for external monitoring
   */
  getConcurrencyManager(): ConcurrencyManager {
    return this.concurrencyManager;
  }

  /**
   * Get the underlying Octokit instance
   */
  getOctokit(): Octokit {
    return this.octokit;
  }

  /**
   * Check primary rate limit before making a request
   */
  private async checkRateLimit(): Promise<void> {
    if (!this.rateLimitInfo || this.rateLimitInfo.remaining > 0) return;

    const now = Date.now();
    const resetTime = this.rateLimitInfo.resetAt.getTime();
    const waitTime = Math.max(0, resetTime - now) + 1000; // Add 1s buffer

    this.logger.warn(
      `Primary rate limit exceeded. Waiting ${waitTime / 1000}s until ${this.rateLimitInfo.resetAt.toISOString()}`,
    );
    await delay(waitTime);
    this.rateLimitInfo.remaining = this.rateLimitInfo.limit;
  }

  /**
   * Check and consume from secondary rate limit buckets
   */
  private async checkSecondaryRateLimits(cost: number = 1): Promise<void> {
    await consumeTokens(this.pointsBucket, cost);
    await consumeTokens(this.concurrentBucket, 1);
  }

  /**
   * Handle rate limit errors with type detection
   */
  private handleRateLimitError(error: unknown): void {
    const rateLimitType = parseRateLimitError(error);

    if (rateLimitType.type === 'secondary') {
      this.concurrencyManager.reduceOnSecondaryLimit();
      this.logger.warn(
        `Secondary rate limit detected. Reduced concurrency to ${this.concurrencyManager.getCurrentLevel()}`,
        {
          waitTime: rateLimitType.waitTime,
          strategy: rateLimitType.strategy,
        },
      );
    } else {
      this.logger.warn(
        `Primary rate limit detected. Wait time: ${rateLimitType.waitTime}ms`,
        { strategy: rateLimitType.strategy },
      );
    }
  }

  /**
   * Execute a GraphQL query with rate limiting and retries
   */
  private async executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    await this.checkRateLimit();
    await this.checkSecondaryRateLimits(5); // GraphQL queries cost ~5 points

    return await pRetry(
      async () => {
        try {
          const response = await this.octokit.graphql<T>(query, variables);

          // Update rate limit info from response headers (if available via octokit)
          this.concurrencyManager.increaseOnSuccess();

          // Check for GraphQL-level errors
          const data = response as any;
          if (data?.errors?.length > 0) {
            const ignorableErrorTypes = ['NOT_FOUND'];
            const criticalErrors = data.errors.filter(
              (e: { type?: string; message: string }) =>
                !ignorableErrorTypes.includes(e.type || ''),
            );

            if (criticalErrors.length > 0) {
              const errorMsg = criticalErrors
                .map((e: { message: string }) => e.message)
                .join(', ');
              throw new Error(`GraphQL Errors: ${errorMsg}`);
            }
          }

          return response;
        } catch (error: any) {
          // Check for rate limit errors
          if (error.status === 403) {
            const message = error.message || '';
            
            if (message.toLowerCase().includes('secondary rate limit')) {
              this.handleRateLimitError(error);
              const rateLimitType = parseRateLimitError(error);
              throw new SecondaryRateLimitError(
                `Secondary rate limit exceeded: ${message}`,
                rateLimitType.waitTime,
              );
            }

            if (message.toLowerCase().includes('rate limit')) {
              const resetAt = new Date(Date.now() + 3600000); // Default 1 hour
              throw new RateLimitExceededError(
                `Primary rate limit exceeded: ${message}`,
                resetAt,
              );
            }
          }

          throw error;
        }
      },
      {
        retries: DEFAULT_RETRY_CONFIG.maxRetries,
        minTimeout: DEFAULT_RETRY_CONFIG.minTimeout,
        maxTimeout: DEFAULT_RETRY_CONFIG.maxTimeout,
        factor: DEFAULT_RETRY_CONFIG.factor,
        randomize: true,
        onFailedAttempt: async ({ error, attemptNumber, retriesLeft }) => {
          this.logger.warn(
            `Attempt ${attemptNumber} failed. ${retriesLeft} retries left`,
            { error: (error as Error).message },
          );

          if (error instanceof RateLimitExceededError) {
            await delay(error.resetAt.getTime() - Date.now() + 1000);
            throw new AbortError(error.message);
          }

          if (error instanceof SecondaryRateLimitError) {
            await delay(error.waitTime);
          }
        },
      },
    );
  }

  /**
   * Paginate through GraphQL results
   */
  private async paginateGraphQL<T>(
    query: string,
    variables: Record<string, unknown>,
    extractNodes: (data: GitHubGraphQLResponse<T>) => {
      nodes: T[];
      pageInfo: GitHubPageInfo;
    },
    nodeType: string,
    limit?: number,
  ): Promise<T[]> {
    let allNodes: T[] = [];
    let hasNextPage = true;
    let endCursor: string | null = null;

    while (hasNextPage) {
      const vars = { ...variables };
      if (endCursor) vars.endCursor = endCursor;

      const data = await this.executeGraphQL<GitHubGraphQLResponse<T>>(query, vars);
      const { nodes, pageInfo } = extractNodes(data);

      allNodes = allNodes.concat(nodes);
      hasNextPage = pageInfo.hasNextPage;
      endCursor = pageInfo.endCursor;

      this.logger.info(`Paginated ${nodeType} fetch`, {
        pageCount: nodes.length,
        totalSoFar: allNodes.length,
        hasNextPage,
      });

      // Check limit
      if (limit && allNodes.length >= limit) {
        allNodes = allNodes.slice(0, limit);
        break;
      }
    }

    return allNodes;
  }

  /**
   * Fetch pull requests for a repository
   */
  async fetchPullRequests(
    owner: string,
    repo: string,
    options: FetchOptions = {},
  ): Promise<RawPullRequest[]> {
    const { since, until } = options;
    
    // Build date filter for search query
    let dateFilter = '';
    if (since || until) {
      const sinceStr = since ? (typeof since === 'string' ? since : since.toISOString().split('T')[0]) : '*';
      const untilStr = until ? (typeof until === 'string' ? until : until.toISOString().split('T')[0]) : '*';
      dateFilter = ` created:${sinceStr}..${untilStr}`;
    }
    
    const searchQuery = `repo:${owner}/${repo} is:pr${dateFilter}`;

    const query = `
      query($searchQuery: String!, $endCursor: String) {
        search(type: ISSUE, query: $searchQuery, first: 25, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on PullRequest {
              id number title body state merged createdAt updatedAt closedAt mergedAt
              headRefOid baseRefOid additions deletions changedFiles
              author { login avatarUrl }
              labels(first: 10) { nodes { id name color description } }
              commits(first: 30) {
                totalCount
                nodes { commit { oid message messageHeadline committedDate
                  author { name email date user { login avatarUrl } }
                  additions deletions changedFiles } }
              }
              closingIssuesReferences(first: 10) {
                nodes { id number title state }
              }
              reactions(first: 20) {
                totalCount
                nodes { id content createdAt user { login avatarUrl } }
              }
              reviews(first: 15) { nodes { id state body submittedAt createdAt author { login avatarUrl } url } }
              comments(first: 30) { 
                nodes { 
                  id body createdAt updatedAt author { login avatarUrl } url 
                  reactions(first: 20) {
                    totalCount
                    nodes { id content createdAt user { login avatarUrl } }
                  }
                } 
              }
              files(first: 50) { nodes { path additions deletions changeType } }
            }
          }
        }
      }
    `;

    try {
      const prs = await this.paginateGraphQL<RawPullRequest>(
        query,
        { searchQuery },
        (data) => {
          const searchData = data.data as GitHubSearchResponse<RawPullRequest>;
          return {
            nodes: searchData.search.nodes,
            pageInfo: searchData.search.pageInfo,
          };
        },
        'PullRequest',
        options.limit,
      );

      // Validate and parse each PR
      const validatedPRs = prs
        .map((pr) => {
          try {
            return RawPullRequestSchema.parse(pr);
          } catch (error) {
            this.logger.error(`Validation error for PR`, { pr, error });
            return null;
          }
        })
        .filter((pr): pr is RawPullRequest => pr !== null);

      this.logger.info(`Fetched ${validatedPRs.length} PRs for ${owner}/${repo}`);
      return validatedPRs;
    } catch (error) {
      this.logger.error('Failed to fetch pull requests', { error });
      throw error;
    }
  }

  /**
   * Fetch issues for a repository
   */
  async fetchIssues(
    owner: string,
    repo: string,
    options: FetchOptions = {},
  ): Promise<RawIssue[]> {
    const { since, until } = options;
    
    let dateFilter = '';
    if (since || until) {
      const sinceStr = since ? (typeof since === 'string' ? since : since.toISOString().split('T')[0]) : '*';
      const untilStr = until ? (typeof until === 'string' ? until : until.toISOString().split('T')[0]) : '*';
      dateFilter = ` created:${sinceStr}..${untilStr}`;
    }
    
    const searchQuery = `repo:${owner}/${repo} is:issue${dateFilter}`;

    const query = `
      query($searchQuery: String!, $endCursor: String) {
        search(type: ISSUE, query: $searchQuery, first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            ... on Issue {
              id number title body state locked createdAt updatedAt closedAt
              author { login avatarUrl }
              labels(first: 30) { nodes { id name color description } }
              reactions(first: 20) {
                totalCount
                nodes { id content createdAt user { login avatarUrl } }
              }
              comments(first: 30) {
                totalCount
                nodes { 
                  id body createdAt updatedAt author { login avatarUrl } url 
                  reactions(first: 20) {
                    totalCount
                    nodes { id content createdAt user { login avatarUrl } }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const issues = await this.paginateGraphQL<RawIssue>(
        query,
        { searchQuery },
        (data) => {
          const searchData = data.data as GitHubSearchResponse<RawIssue>;
          return {
            nodes: searchData.search.nodes,
            pageInfo: searchData.search.pageInfo,
          };
        },
        'Issue',
        options.limit,
      );

      const validatedIssues = issues
        .map((issue) => {
          try {
            return RawIssueSchema.parse(issue);
          } catch (error) {
            this.logger.error(`Validation error for Issue`, { issue, error });
            return null;
          }
        })
        .filter((issue): issue is RawIssue => issue !== null);

      this.logger.info(`Fetched ${validatedIssues.length} issues for ${owner}/${repo}`);
      return validatedIssues;
    } catch (error) {
      this.logger.error('Failed to fetch issues', { error });
      throw error;
    }
  }

  /**
   * Fetch commits for a repository
   */
  async fetchCommits(
    owner: string,
    repo: string,
    options: FetchOptions = {},
  ): Promise<RawCommit[]> {
    const { since, until } = options;

    const sinceISO = since
      ? typeof since === 'string'
        ? new Date(since).toISOString()
        : since.toISOString()
      : undefined;
    const untilISO = until
      ? typeof until === 'string'
        ? new Date(until).toISOString()
        : until.toISOString()
      : undefined;

    const query = `
      query($owner: String!, $repo: String!, $endCursor: String, $since: GitTimestamp, $until: GitTimestamp) {
        repository(owner: $owner, name: $repo) {
          defaultBranchRef {
            target {
              ... on Commit {
                history(first: 100, after: $endCursor, since: $since, until: $until) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    oid messageHeadline message committedDate
                    author { name email date user { login avatarUrl } }
                    additions deletions changedFiles
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const commits = await this.paginateGraphQL<RawCommit>(
        query,
        { owner, repo, since: sinceISO, until: untilISO },
        (data) => {
          const repoData = data.data as GitHubRepositoryResponse<RawCommit>;
          return {
            nodes: repoData.repository.defaultBranchRef.target.history.nodes,
            pageInfo: repoData.repository.defaultBranchRef.target.history.pageInfo,
          };
        },
        'Commit',
        options.limit,
      );

      const validatedCommits = commits
        .map((commit) => {
          try {
            return RawCommitSchema.parse(commit);
          } catch (error) {
            this.logger.error(`Validation error for commit`, { error, commit });
            return null;
          }
        })
        .filter((c): c is RawCommit => c !== null);

      this.logger.info(`Fetched ${validatedCommits.length} commits for ${owner}/${repo}`);
      return validatedCommits;
    } catch (error) {
      this.logger.error('Failed to fetch commits', { error });
      throw error;
    }
  }

  /**
   * Get authenticated user information
   */
  async getAuthenticatedUser(): Promise<GitHubAuthenticatedUser> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    
    // Convert snake_case to camelCase for our schema
    const user = {
      login: data.login,
      id: data.id,
      nodeId: data.node_id,
      avatarUrl: data.avatar_url,
      gravatarId: data.gravatar_id,
      url: data.url,
      htmlUrl: data.html_url,
      name: data.name,
      company: data.company,
      blog: data.blog,
      location: data.location,
      email: data.email,
      hireable: data.hireable,
      bio: data.bio,
      twitterUsername: data.twitter_username,
      publicRepos: data.public_repos,
      publicGists: data.public_gists,
      followers: data.followers,
      following: data.following,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };

    return GitHubAuthenticatedUserSchema.parse(user);
  }

  /**
   * Get repositories accessible to the authenticated user
   */
  async getUserRepositories(options: { perPage?: number; type?: 'all' | 'owner' | 'member' } = {}): Promise<GitHubRepository[]> {
    const repos: GitHubRepository[] = [];
    const perPage = options.perPage || 100;
    const type = options.type || 'all';
    
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
        per_page: perPage,
        page,
        type,
        sort: 'updated',
        direction: 'desc',
      });

      for (const repo of data) {
        try {
          const parsed = GitHubRepositorySchema.parse({
            id: repo.id,
            nodeId: repo.node_id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            owner: {
              login: repo.owner.login,
              id: repo.owner.id,
            },
            htmlUrl: repo.html_url,
            description: repo.description,
            fork: repo.fork,
            url: repo.url,
            defaultBranch: repo.default_branch,
            stargazersCount: repo.stargazers_count,
            forksCount: repo.forks_count,
            language: repo.language,
            pushedAt: repo.pushed_at,
            updatedAt: repo.updated_at,
          });
          repos.push(parsed);
        } catch (error) {
          this.logger.error(`Failed to parse repository: ${repo.full_name}`, { error });
        }
      }

      hasMore = data.length === perPage;
      page++;
    }

    this.logger.info(`Fetched ${repos.length} repositories for authenticated user`);
    return repos;
  }

  /**
   * Get a specific repository
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository | null> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo });
      
      return GitHubRepositorySchema.parse({
        id: data.id,
        nodeId: data.node_id,
        name: data.name,
        fullName: data.full_name,
        private: data.private,
        owner: {
          login: data.owner.login,
          id: data.owner.id,
        },
        htmlUrl: data.html_url,
        description: data.description,
        fork: data.fork,
        url: data.url,
        defaultBranch: data.default_branch,
        stargazersCount: data.stargazers_count,
        forksCount: data.forks_count,
        language: data.language,
        pushedAt: data.pushed_at,
        updatedAt: data.updated_at,
      });
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Verify token is valid
   */
  async verifyToken(): Promise<boolean> {
    try {
      await this.getAuthenticatedUser();
      return true;
    } catch {
      return false;
    }
  }
}
