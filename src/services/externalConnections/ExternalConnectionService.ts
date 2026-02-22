/**
 * External Connection Service - Main orchestrator for platform connections
 * 
 * Manages connections to external platforms (Discord, Telegram, Slack)
 * and delegates platform-specific logic to adapters.
 */

import { BaseAdapter, discordAdapter, telegramAdapter, githubAdapter } from './adapters';
import {
  PlatformType,
  ExternalConnection,
  ExternalConnectionWithCount,
  ExternalChannel,
  AuthUrlResult,
  OAuthCallbackParams,
  ValidationResult,
  PlatformInfo,
  WebhookPayload,
  ExternalConnectionRow,
  ExternalChannelRow,
  mapConnectionRow,
  mapChannelRow,
} from './types';
import { databaseService } from '../databaseService';

/**
 * External Connection Service
 * 
 * Singleton service that manages all external platform connections
 */
class ExternalConnectionService {
  private adapters: Map<PlatformType, BaseAdapter> = new Map();
  private initialized = false;

  constructor() {
    // Register adapters
    this.registerAdapter(discordAdapter);
    this.registerAdapter(telegramAdapter);
    this.registerAdapter(githubAdapter);
  }

  /**
   * Register a platform adapter
   */
  private registerAdapter(adapter: BaseAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /**
   * Get an adapter by platform type
   */
  private getAdapter(platform: PlatformType): BaseAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`Unknown platform: ${platform}`);
    }
    return adapter;
  }

  /**
   * Initialize all configured adapters
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[ExternalConnectionService] Initializing adapters...');

    for (const [platform, adapter] of this.adapters) {
      if (adapter.isConfigured()) {
        try {
          await adapter.initialize();
          console.log(`[ExternalConnectionService] ${platform} adapter initialized`);
        } catch (error) {
          console.error(`[ExternalConnectionService] Failed to initialize ${platform} adapter:`, error);
        }
      } else {
        console.log(`[ExternalConnectionService] ${platform} adapter not configured, skipping`);
      }
    }

    this.initialized = true;
  }

  /**
   * Shutdown all adapters
   */
  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown();
    }
    this.initialized = false;
  }

  // ============================================================================
  // PLATFORM INFO
  // ============================================================================

  /**
   * Get all available platforms (configured and enabled)
   */
  getAvailablePlatforms(): PlatformInfo[] {
    return Array.from(this.adapters.values())
      .map(adapter => adapter.getPlatformInfo())
      .filter(info => info.isEnabled);
  }

  /**
   * Get info for a specific platform
   */
  getPlatformInfo(platform: PlatformType): PlatformInfo | null {
    const adapter = this.adapters.get(platform);
    if (!adapter) return null;
    return adapter.getPlatformInfo();
  }

  /**
   * Check if a platform is configured
   */
  isPlatformConfigured(platform: PlatformType): boolean {
    const adapter = this.adapters.get(platform);
    return adapter?.isConfigured() ?? false;
  }

  // ============================================================================
  // AUTHORIZATION FLOW
  // ============================================================================

  /**
   * Generate authorization URL for a platform
   * @param platform - Platform type
   * @param userId - User ID
   * @param redirectUrl - Optional URL to redirect to after auth completes
   * @param popup - If true, callback will return HTML for popup mode
   */
  async generateAuthUrl(
    platform: PlatformType,
    userId: string,
    redirectUrl?: string,
    popup?: boolean
  ): Promise<AuthUrlResult> {
    const adapter = this.getAdapter(platform);
    if (!adapter.isConfigured()) {
      throw new Error(`${platform} is not configured`);
    }
    return adapter.generateAuthUrl(userId, redirectUrl, popup);
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(params: OAuthCallbackParams): Promise<ExternalConnection> {
    const adapter = this.getAdapter(params.platform);
    return adapter.handleCallback(params);
  }

  /**
   * Handle webhook events
   */
  async handleWebhook(platform: PlatformType, data: any): Promise<void> {
    const adapter = this.getAdapter(platform);
    await adapter.handleWebhook({ platform, data });
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  /**
   * Get all connections for a user
   */
  async getUserConnections(
    userId: string,
    platform?: PlatformType
  ): Promise<ExternalConnectionWithCount[]> {
    let query = `
      SELECT c.*, COUNT(ch.id) as channel_count
      FROM external_connections c
      LEFT JOIN external_channels ch ON ch.connection_id = c.id AND ch.is_accessible = TRUE
      WHERE c.user_id = $1 AND c.is_active = TRUE
    `;
    const params: any[] = [userId];

    if (platform) {
      query += ` AND c.platform = $2`;
      params.push(platform);
    }

    query += ` GROUP BY c.id ORDER BY c.created_at DESC`;

    const result = await databaseService.query(query, params);

    return result.rows.map((row: any) => ({
      ...mapConnectionRow(row as ExternalConnectionRow),
      channelCount: parseInt(row.channel_count) || 0,
    }));
  }

  /**
   * Get a specific connection
   */
  async getConnection(userId: string, connectionId: string): Promise<ExternalConnection | null> {
    const result = await databaseService.query(
      `SELECT * FROM external_connections 
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );

    if (result.rows.length === 0) return null;
    return mapConnectionRow(result.rows[0] as ExternalConnectionRow);
  }

  /**
   * Get a connection by ID (without user check - for internal use)
   */
  async getConnectionById(connectionId: string): Promise<ExternalConnection | null> {
    const result = await databaseService.query(
      `SELECT * FROM external_connections WHERE id = $1`,
      [connectionId]
    );

    if (result.rows.length === 0) return null;
    return mapConnectionRow(result.rows[0] as ExternalConnectionRow);
  }

  /**
   * Get connection by platform and external ID
   */
  async getConnectionByExternalId(
    userId: string,
    platform: PlatformType,
    externalId: string
  ): Promise<ExternalConnection | null> {
    const result = await databaseService.query(
      `SELECT * FROM external_connections 
       WHERE user_id = $1 AND platform = $2 AND external_id = $3`,
      [userId, platform, externalId]
    );

    if (result.rows.length === 0) return null;
    return mapConnectionRow(result.rows[0] as ExternalConnectionRow);
  }

  /**
   * Remove a connection (soft delete - marks as inactive)
   */
  async removeConnection(userId: string, connectionId: string): Promise<void> {
    await databaseService.query(
      `UPDATE external_connections 
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );
  }

  /**
   * Verify a connection is still valid
   */
  async verifyConnection(connectionId: string): Promise<boolean> {
    const connection = await this.getConnectionById(connectionId);
    if (!connection) return false;

    const adapter = this.getAdapter(connection.platform);
    return adapter.verifyConnection(connection);
  }

  /**
   * Validate that user owns a connection
   */
  async validateUserOwnsConnection(userId: string, connectionId: string): Promise<boolean> {
    const result = await databaseService.query(
      `SELECT id FROM external_connections 
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [connectionId, userId]
    );
    return result.rows.length > 0;
  }

  // ============================================================================
  // CHANNEL MANAGEMENT
  // ============================================================================

  /**
   * Get channels for a connection
   */
  async getChannels(connectionId: string): Promise<ExternalChannel[]> {
    const result = await databaseService.query(
      `SELECT * FROM external_channels 
       WHERE connection_id = $1 
       ORDER BY parent_name NULLS FIRST, position`,
      [connectionId]
    );

    return result.rows.map((row: ExternalChannelRow) => mapChannelRow(row));
  }

  /**
   * Sync channels for a connection
   */
  async syncChannels(connectionId: string): Promise<ExternalChannel[]> {
    const connection = await this.getConnectionById(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    const adapter = this.getAdapter(connection.platform);
    return adapter.syncChannels(connection);
  }

  /**
   * Validate channels are accessible
   */
  async validateChannels(connectionId: string, channelIds: string[]): Promise<ValidationResult> {
    const connection = await this.getConnectionById(connectionId);
    if (!connection) {
      return { valid: false, invalidChannels: channelIds };
    }

    const adapter = this.getAdapter(connection.platform);
    return adapter.validateChannels(connection, channelIds);
  }

  /**
   * Get channels grouped by parent (category)
   */
  async getGroupedChannels(connectionId: string): Promise<Record<string, ExternalChannel[]>> {
    const channels = await this.getChannels(connectionId);
    const grouped: Record<string, ExternalChannel[]> = {};

    for (const channel of channels) {
      const category = channel.parentName || 'No Category';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(channel);
    }

    return grouped;
  }

  // ============================================================================
  // PLATFORM CLIENT ACCESS (for source plugins)
  // ============================================================================

  /**
   * Get the platform client for a connection
   * Used by source plugins to access Discord.js Client, Telegraf, etc.
   */
  async getClient(platform: PlatformType): Promise<any> {
    const adapter = this.getAdapter(platform);
    return adapter.getClient();
  }

  /**
   * Get Discord adapter (for backward compatibility)
   */
  getDiscordAdapter() {
    return discordAdapter;
  }

  /**
   * Get Telegram adapter
   */
  getTelegramAdapter() {
    return telegramAdapter;
  }

  /**
   * Get GitHub adapter
   */
  getGitHubAdapter() {
    return githubAdapter;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clean up expired OAuth states
   */
  async cleanupExpiredStates(): Promise<number> {
    const result = await databaseService.query(
      `DELETE FROM external_oauth_states WHERE expires_at < NOW() RETURNING id`
    );
    return result.rows.length;
  }

  /**
   * Verify all connections for a platform
   */
  async verifyAllConnections(platform?: PlatformType): Promise<{ verified: number; inactive: number }> {
    let query = `SELECT * FROM external_connections WHERE is_active = TRUE`;
    const params: any[] = [];

    if (platform) {
      query += ` AND platform = $1`;
      params.push(platform);
    }

    const result = await databaseService.query(query, params);
    let verified = 0;
    let inactive = 0;

    for (const row of result.rows) {
      const connection = mapConnectionRow(row as ExternalConnectionRow);
      const isValid = await this.verifyConnection(connection.id);
      if (isValid) {
        verified++;
      } else {
        inactive++;
      }
    }

    return { verified, inactive };
  }
}

// Singleton instance
export const externalConnectionService = new ExternalConnectionService();
