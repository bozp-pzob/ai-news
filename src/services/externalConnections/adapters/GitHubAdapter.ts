/**
 * GitHub Adapter - GitHub App implementation for read-only repository access
 * 
 * Uses GitHub Apps (not OAuth Apps) to provide:
 * - Read-only access to repositories (no write permissions)
 * - User-selected repository access during installation
 * - Granular permissions at the app level
 * 
 * Environment variables required:
 * - GITHUB_APP_ID: The GitHub App ID
 * - GITHUB_APP_PRIVATE_KEY: The GitHub App private key (PEM format)
 * - GITHUB_APP_SLUG: The GitHub App URL slug (for installation link)
 * 
 * Resource Types (stored in external_channels.resource_type):
 * - 100: GitHub Repository
 * (Using 100+ range to avoid conflict with Discord channel types 0-15)
 * 
 * Flow:
 * 1. User clicks "Connect GitHub"
 * 2. User is sent to GitHub App installation page
 * 3. User selects repositories to grant access
 * 4. GitHub redirects back with installation_id
 * 5. We store installation_id and fetch accessible repos
 * 6. API calls use installation access tokens (auto-refreshed)
 */

import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';
import crypto from 'crypto';
import { BaseAdapter } from './BaseAdapter';
import {
  PlatformType,
  AuthType,
  ExternalConnection,
  ExternalChannel,
  AuthUrlResult,
  OAuthCallbackParams,
  ValidationResult,
  ExternalConnectionRow,
  ExternalChannelRow,
  ExternalOAuthStateRow,
  mapConnectionRow,
  mapChannelRow,
} from '../types';
import { databaseService } from '../../databaseService';

// GitHub API endpoints
const GITHUB_API_URL = 'https://api.github.com';

// OAuth state expiration (10 minutes)
const STATE_EXPIRATION_MS = 10 * 60 * 1000;

// Installation token cache expiration (50 minutes - tokens last 1 hour)
const TOKEN_CACHE_EXPIRATION_MS = 50 * 60 * 1000;

/**
 * Cached installation token with expiration
 */
interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * GitHub App metadata stored in connection
 */
interface GitHubAppMetadata {
  installationId: number;
  login: string;
  accountType: 'User' | 'Organization';
  avatarUrl?: string;
  selectedRepos?: string[]; // User's selected repo IDs for tracking
  permissions?: Record<string, string>;
  repositorySelection?: 'all' | 'selected';
}

/**
 * GitHub Adapter
 * 
 * Provides GitHub integration using GitHub Apps for read-only access.
 * Users install the app and select which repositories to grant access to.
 */
export class GitHubAdapter extends BaseAdapter {
  readonly platform: PlatformType = 'github';
  readonly displayName = 'GitHub';
  readonly icon = 'github';
  readonly description = 'Connect your GitHub repositories with read-only access';
  readonly authType: AuthType = 'oauth'; // Using OAuth-style flow for installation
  readonly resourceTypes = ['repository'];

  // Cache Octokit clients by installation ID
  private clients: Map<number, Octokit> = new Map();
  
  // Cache installation tokens
  private tokenCache: Map<number, CachedToken> = new Map();

  // App-level Octokit (for installation management)
  private appOctokit: Octokit | null = null;

  /**
   * Check if GitHub App is configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY
    );
  }

  /**
   * Get the GitHub App slug for installation URL
   */
  private getAppSlug(): string {
    return process.env.GITHUB_APP_SLUG || 'ai-news-aggregator';
  }

  /**
   * Initialize the adapter - create app-level Octokit
   */
  async initialize(): Promise<void> {
    if (!this.isConfigured()) {
      console.log('[GitHubAdapter] Not configured - skipping initialization');
      return;
    }

    const appId = process.env.GITHUB_APP_ID!;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!;

    // Create app-level Octokit for installation management
    this.appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: parseInt(appId, 10),
        privateKey: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
      },
    });

    console.log('[GitHubAdapter] Initialized with GitHub App');
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    this.clients.clear();
    this.tokenCache.clear();
    this.appOctokit = null;
  }

  /**
   * Get an installation access token (cached with auto-refresh)
   */
  private async getInstallationToken(installationId: number): Promise<string> {
    // Check cache
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    if (!this.appOctokit) {
      throw new Error('GitHub App not initialized');
    }

    // Get new installation token
    const { data } = await this.appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
    });

    // Cache the token
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: Date.now() + TOKEN_CACHE_EXPIRATION_MS,
    });

    return data.token;
  }

  /**
   * Get a GitHub client for API calls (requires installation)
   */
  async getClient(): Promise<Octokit> {
    // For app-level operations, use app Octokit
    if (this.appOctokit) {
      return this.appOctokit;
    }

    throw new Error('GitHub App not initialized - call initialize() first');
  }

  /**
   * Get a GitHub client for a specific connection (installation)
   */
  async getClientForConnection(connectionId: string): Promise<Octokit> {
    // Fetch connection to get installation ID
    const result = await databaseService.query(
      `SELECT * FROM external_connections WHERE id = $1 AND platform = 'github'`,
      [connectionId]
    );

    if (result.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const row = result.rows[0] as ExternalConnectionRow;
    const metadata = row.metadata as GitHubAppMetadata;

    if (!metadata.installationId) {
      throw new Error('No installation ID for this connection');
    }

    return this.getClientForInstallation(metadata.installationId);
  }

  /**
   * Get a GitHub client for a specific installation
   */
  async getClientForInstallation(installationId: number): Promise<Octokit> {
    // Check cache
    if (this.clients.has(installationId)) {
      return this.clients.get(installationId)!;
    }

    // Get installation token and create client
    const token = await this.getInstallationToken(installationId);
    const client = new Octokit({ auth: token });

    this.clients.set(installationId, client);
    return client;
  }

  /**
   * Generate GitHub App installation URL
   * 
   * This sends users to install the GitHub App and select repositories.
   * The app requests read-only permissions configured at app creation time.
   */
  async generateAuthUrl(userId: string, redirectUrl?: string, popup?: boolean): Promise<AuthUrlResult> {
    const appSlug = this.getAppSlug();
    
    // Generate secure state token
    const baseState = crypto.randomBytes(32).toString('hex');
    const state = popup ? `${baseState}_popup` : baseState;
    const expiresAt = new Date(Date.now() + STATE_EXPIRATION_MS);

    // Store state in database
    await databaseService.query(
      `INSERT INTO external_oauth_states (user_id, platform, state, redirect_url, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, 'github', baseState, redirectUrl || null, JSON.stringify({ popup: !!popup }), expiresAt]
    );

    // Build installation URL
    // Users will be redirected to this URL to install the app and select repos
    const params = new URLSearchParams({
      state,
    });

    // GitHub App installation URL
    const url = `https://github.com/apps/${appSlug}/installations/new?${params.toString()}`;

    return {
      url,
      state,
      platform: 'github',
      authType: 'oauth',
    };
  }

  /**
   * Handle GitHub App installation callback
   * 
   * After installation, GitHub redirects with:
   * - installation_id: The installation ID
   * - setup_action: 'install' | 'update' | 'request'
   * - state: Our state token (if provided in auth URL)
   */
  async handleCallback(params: OAuthCallbackParams): Promise<ExternalConnection> {
    const { state } = params;
    
    // GitHub App callbacks include installation_id in query params
    const installationId = (params as any).installation_id;
    const setupAction = (params as any).setup_action;

    if (!installationId) {
      throw new Error('Missing installation_id - user may have cancelled installation');
    }

    if (!state) {
      throw new Error('Missing state parameter');
    }

    // Extract base state (remove _popup suffix if present)
    const baseState = state.replace(/_popup$/, '');

    // Validate state
    const stateResult = await databaseService.query(
      `SELECT * FROM external_oauth_states 
       WHERE state = $1 AND platform = 'github' AND expires_at > NOW()`,
      [baseState]
    );

    if (stateResult.rows.length === 0) {
      throw new Error('Invalid or expired state token');
    }

    const oauthState = stateResult.rows[0] as ExternalOAuthStateRow;
    const userId = oauthState.user_id;

    // Delete used state
    await databaseService.query('DELETE FROM external_oauth_states WHERE id = $1', [oauthState.id]);

    console.log(`[GitHubAdapter] Processing installation ${installationId}, action: ${setupAction}`);

    // Get installation details
    if (!this.appOctokit) {
      throw new Error('GitHub App not initialized');
    }

    const { data: installation } = await this.appOctokit.rest.apps.getInstallation({
      installation_id: parseInt(installationId, 10),
    });

    const account = installation.account as {
      login: string;
      id: number;
      type: string;
      avatar_url?: string;
    };

    // Build metadata
    const metadata: GitHubAppMetadata = {
      installationId: parseInt(installationId, 10),
      login: account.login,
      accountType: account.type as 'User' | 'Organization',
      avatarUrl: account.avatar_url,
      permissions: installation.permissions as Record<string, string>,
      repositorySelection: installation.repository_selection as 'all' | 'selected',
    };

    // Check if connection already exists for this installation
    const existingResult = await databaseService.query(
      `SELECT * FROM external_connections 
       WHERE user_id = $1 AND platform = 'github' AND (metadata->>'installationId')::int = $2`,
      [userId, installationId]
    );

    let connection: ExternalConnection;

    if (existingResult.rows.length > 0) {
      // Update existing connection
      const updateResult = await databaseService.query(
        `UPDATE external_connections 
         SET external_name = $1, external_icon = $2, metadata = $3, 
             is_active = TRUE, updated_at = NOW()
         WHERE user_id = $4 AND platform = 'github' AND (metadata->>'installationId')::int = $5
         RETURNING *`,
        [account.login, account.avatar_url, JSON.stringify(metadata), userId, installationId]
      );
      connection = mapConnectionRow(updateResult.rows[0] as ExternalConnectionRow);
      
      // Clear cached client
      this.clients.delete(parseInt(installationId, 10));
      this.tokenCache.delete(parseInt(installationId, 10));
    } else {
      // Create new connection
      const insertResult = await databaseService.query(
        `INSERT INTO external_connections 
         (user_id, platform, external_id, external_name, external_icon, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, 'github', installationId, account.login, account.avatar_url, JSON.stringify(metadata)]
      );
      connection = mapConnectionRow(insertResult.rows[0] as ExternalConnectionRow);
    }

    // Sync repositories that the installation has access to
    await this.syncChannels(connection);

    return connection;
  }

  /**
   * Verify GitHub connection is still valid
   */
  async verifyConnection(connection: ExternalConnection): Promise<boolean> {
    try {
      const metadata = connection.metadata as GitHubAppMetadata;
      
      if (!metadata.installationId) {
        return false;
      }

      // Try to get installation details
      if (!this.appOctokit) {
        return false;
      }

      await this.appOctokit.rest.apps.getInstallation({
        installation_id: metadata.installationId,
      });

      // Update verification timestamp
      await databaseService.query(
        `UPDATE external_connections 
         SET last_verified_at = NOW(), is_active = TRUE 
         WHERE id = $1`,
        [connection.id]
      );

      return true;
    } catch (error: any) {
      console.error('[GitHubAdapter] Connection verification failed:', error);
      
      // Mark as inactive if installation no longer exists
      if (error.status === 404) {
        await databaseService.query(
          `UPDATE external_connections 
           SET is_active = FALSE, updated_at = NOW() 
           WHERE id = $1`,
          [connection.id]
        );
      }

      // Clear cached client
      const metadata = connection.metadata as GitHubAppMetadata;
      if (metadata.installationId) {
        this.clients.delete(metadata.installationId);
        this.tokenCache.delete(metadata.installationId);
      }

      return false;
    }
  }

  /**
   * Sync repositories for a GitHub App installation
   * Only returns repos the installation has access to (read-only)
   */
  async syncChannels(connection: ExternalConnection): Promise<ExternalChannel[]> {
    const metadata = connection.metadata as GitHubAppMetadata;
    
    if (!metadata.installationId) {
      throw new Error('No installation ID for this connection');
    }

    const client = await this.getClientForInstallation(metadata.installationId);
    const repositories: ExternalChannel[] = [];

    console.log(`[GitHubAdapter] Syncing repositories for installation ${metadata.installationId}`);

    // Fetch all repositories accessible to this installation
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const { data } = await client.rest.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page,
      });

      for (const repo of data.repositories) {
        repositories.push({
          id: '', // Will be set by database
          connectionId: connection.id,
          externalId: repo.id.toString(),
          externalName: repo.full_name,
          resourceType: 100, // GitHub repository (100+ range for GitHub resources)
          parentId: repo.owner.login,
          parentName: repo.owner.login,
          position: 0,
          isAccessible: true,
          metadata: {
            name: repo.name,
            owner: repo.owner.login,
            fullName: repo.full_name,
            private: repo.private,
            description: repo.description,
            defaultBranch: repo.default_branch,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            pushedAt: repo.pushed_at,
            htmlUrl: repo.html_url,
            // Permissions from installation (read-only)
            permissions: {
              contents: 'read',
              metadata: 'read',
              pull_requests: 'read',
              issues: 'read',
            },
          },
          lastSyncedAt: new Date(),
        });
      }

      hasMore = data.repositories.length === perPage;
      page++;

      // Safety limit
      if (page > 50) {
        console.warn('[GitHubAdapter] Reached page limit, stopping sync');
        break;
      }
    }

    console.log(`[GitHubAdapter] Found ${repositories.length} accessible repositories`);

    // Update database
    // First, mark all existing channels for this connection as inaccessible
    await databaseService.query(
      `UPDATE external_channels SET is_accessible = FALSE WHERE connection_id = $1`,
      [connection.id]
    );

    // Upsert repositories
    for (const repo of repositories) {
      await databaseService.query(
        `INSERT INTO external_channels 
         (connection_id, external_id, external_name, resource_type, parent_id, parent_name, position, is_accessible, metadata, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (connection_id, external_id) 
         DO UPDATE SET 
           external_name = EXCLUDED.external_name,
           resource_type = EXCLUDED.resource_type,
           parent_id = EXCLUDED.parent_id,
           parent_name = EXCLUDED.parent_name,
           position = EXCLUDED.position,
           is_accessible = EXCLUDED.is_accessible,
           metadata = EXCLUDED.metadata,
           last_synced_at = NOW()`,
        [
          connection.id,
          repo.externalId,
          repo.externalName,
          repo.resourceType,
          repo.parentId || null,
          repo.parentName || null,
          repo.position,
          repo.isAccessible,
          JSON.stringify(repo.metadata),
        ]
      );
    }

    // Fetch and return updated channels
    const result = await databaseService.query(
      `SELECT * FROM external_channels WHERE connection_id = $1 ORDER BY external_name`,
      [connection.id]
    );

    return result.rows.map((row: ExternalChannelRow) => mapChannelRow(row));
  }

  /**
   * Validate that repositories are accessible
   */
  async validateChannels(
    connection: ExternalConnection,
    channelIds: string[]
  ): Promise<ValidationResult> {
    // Get accessible channels from database
    const result = await databaseService.query(
      `SELECT external_id FROM external_channels 
       WHERE connection_id = $1 AND is_accessible = TRUE`,
      [connection.id]
    );

    const accessibleIds = new Set(result.rows.map((r: ExternalChannelRow) => r.external_id));
    const invalidChannels = channelIds.filter((id) => !accessibleIds.has(id));

    return {
      valid: invalidChannels.length === 0,
      invalidChannels,
    };
  }

  /**
   * Get repository information by owner/repo
   */
  async getRepository(connectionId: string, owner: string, repo: string) {
    const client = await this.getClientForConnection(connectionId);
    
    try {
      const { data } = await client.rest.repos.get({ owner, repo });
      return data;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update selected repositories for tracking
   * Users can choose which of their accessible repos to track
   */
  async updateSelectedRepos(connectionId: string, repoIds: string[]): Promise<void> {
    // Get current connection
    const result = await databaseService.query(
      `SELECT * FROM external_connections WHERE id = $1 AND platform = 'github'`,
      [connectionId]
    );

    if (result.rows.length === 0) {
      throw new Error('Connection not found');
    }

    const row = result.rows[0] as ExternalConnectionRow;
    const metadata = row.metadata as GitHubAppMetadata;

    // Update metadata with selected repos
    metadata.selectedRepos = repoIds;

    await databaseService.query(
      `UPDATE external_connections SET metadata = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(metadata), connectionId]
    );
  }

  /**
   * Get selected repositories for a connection
   */
  async getSelectedRepos(connectionId: string): Promise<string[]> {
    const result = await databaseService.query(
      `SELECT metadata FROM external_connections WHERE id = $1 AND platform = 'github'`,
      [connectionId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const metadata = result.rows[0].metadata as GitHubAppMetadata;
    return metadata.selectedRepos || [];
  }

  /**
   * Invalidate cached client for an installation
   */
  invalidateClient(connectionId: string): void {
    // We need to look up the installation ID from the connection
    // For simplicity, clear all caches (could be optimized)
    this.clients.clear();
    this.tokenCache.clear();
  }

  /**
   * Invalidate cached client for a specific installation
   */
  invalidateInstallationClient(installationId: number): void {
    this.clients.delete(installationId);
    this.tokenCache.delete(installationId);
  }
}

// Singleton instance
export const githubAdapter = new GitHubAdapter();
