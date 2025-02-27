// src/plugins/sources/GitHubDataSource.ts

import { ContentSource } from "./ContentSource";  // Your unified interface
import { ContentItem } from "../../types";         // Your unified item interface
import fetch from "node-fetch";

interface GithubDataSourceConfig {
  name: string;                   // e.g. "github-data"
  githubCompany: string;          // e.g. "elizaos"
  githubRepo: string;             // e.g. "data"
  token?: string;                 // Optional GitHub personal access token
}

/**
 * A plugin that fetches GitHub data (commits, pull requests, and issues)
 * for a given repository and date using GitHub’s raw REST API.
 */
export class RawGitHubDataSource implements ContentSource {
  public name: string;
  private githubCompany: string;
  private githubRepo: string;
  private token?: string;
  private baseApiUrl: string;
  private baseGithubUrl: string;
  private baseGithubImageUrl: string;

  constructor(config: GithubDataSourceConfig) {
    this.name = config.name;
    this.githubCompany = config.githubCompany;
    this.githubRepo = config.githubRepo;
    this.token = config.token;
    this.baseApiUrl = "https://api.github.com";
    this.baseGithubUrl = `https://github.com/${this.githubCompany}/${this.githubRepo}/`;
    this.baseGithubImageUrl = `https://opengraph.githubassets.com/1/${this.githubCompany}/${this.githubRepo}/`;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    try {
      const targetDate = new Date();
      const year = targetDate.getUTCFullYear();
      const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(targetDate.getUTCDate()).padStart(2, '0');
      const since = `${year}-${month}-${day}T00:00:00Z`;
      const until = `${year}-${month}-${day}T23:59:59Z`;

      // Fetch each type of GitHub data in parallel.
      const [commits, pullRequests, issues] = await Promise.all([
        this.fetchCommits(since, until),
        this.fetchPullRequests(since, until),
        this.fetchIssues(since, until),
      ]);

      // Combine and (optionally) sort the items by creation date.
      const allItems = [...commits, ...pullRequests, ...issues];
      // allItems.sort((a, b) => a.date - b.date);
      return allItems;
    } catch (error) {
      console.error("Error fetching GitHub data:", error);
      return [];
    }
  }

  /**
   * Fetch commits from the GitHub API within the specified time window.
   */
  private async fetchCommits(since: string, until: string): Promise<ContentItem[]> {
    const url = `${this.baseApiUrl}/repos/${this.githubCompany}/${this.githubRepo}/commits?since=${since}&until=${until}`;
    const headers: any = { Accept: 'application/vnd.github.v3+json' };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error(`Failed to fetch commits. Status: ${resp.status}`);
        return [];
      }
      const data = await resp.json() as any;
      const items: ContentItem[] = data.map((commit: any) => {
        return {
          type: "githubCommit",
          cid: `github-commit-${commit.sha}`,
          source: this.name,
          link: `${this.baseGithubUrl}commit/${commit.sha}`,
          text: commit.commit.message,
          date: new Date(commit.commit.author.date).getTime() / 1000,
          metadata: {
            author: commit.commit.author.name,
            photos: [`${this.baseGithubImageUrl}commit/${commit.sha}`]
          },
        };
      });
      return items;
    } catch (error) {
      console.error("Error fetching commits:", error);
      return [];
    }
  }

  private async fetchPullRequests(since: string, until: string): Promise<ContentItem[]> {
    const query = `repo:${this.githubCompany}/${this.githubRepo} is:pr created:${since}..${until}`;
    const url = `${this.baseApiUrl}/search/issues?q=${encodeURIComponent(query)}`;
    const headers: any = { Accept: 'application/vnd.github.v3+json' };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error(`Failed to fetch pull requests. Status: ${resp.status}`);
        return [];
      }
      const data = await resp.json() as any;
      const items: ContentItem[] = data.items.map((pr: any) => {
        return {
          type: "githubPullRequest",
          cid: `github-pull-${pr.number}`,
          source: this.name,
          link: `${this.baseGithubUrl}pull/${pr.number}`,
          text: `Title: ${pr.title}\nBody: ${pr.body || ""}`,
          date: new Date(pr.created_at).getTime() / 1000,
          metadata: {
            state: pr.state,
            photos: [`${this.baseGithubImageUrl}pull/${pr.number}`]
          },
        };
      });
      return items;
    } catch (error) {
      console.error("Error fetching pull requests:", error);
      return [];
    }
  }

  private async fetchIssues(since: string, until: string): Promise<ContentItem[]> {
    const query = `repo:${this.githubCompany}/${this.githubRepo} is:issue created:${since}..${until}`;
    const url = `${this.baseApiUrl}/search/issues?q=${encodeURIComponent(query)}`;
    const headers: any = { Accept: 'application/vnd.github.v3+json' };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.error(`Failed to fetch issues. Status: ${resp.status}`);
        return [];
      }
      const data = await resp.json() as any;
      const items: ContentItem[] = data.items.map((issue: any) => {
        return {
          type: "githubIssue",
          cid: `github-issue-${issue.number}`,
          source: this.name,
          link: `${this.baseGithubUrl}issues/${issue.number}`,
          text: `Title: ${issue.title}\nBody: ${issue.body || ""}`,
          date: new Date(issue.created_at).getTime() / 1000,
          metadata: {
            state: issue.state,
            photos: [`${this.baseGithubImageUrl}issues/${issue.number}`]
          },
        };
      });
      return items;
    } catch (error) {
      console.error("Error fetching issues:", error);
      return [];
    }
  }
}
