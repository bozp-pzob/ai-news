/**
 * Base Adapter - Abstract base class for platform adapters
 * 
 * Defines the interface that all platform adapters must implement
 */

import {
  PlatformType,
  AuthType,
  ExternalConnection,
  ExternalChannel,
  AuthUrlResult,
  OAuthCallbackParams,
  ValidationResult,
  PlatformInfo,
  WebhookPayload,
} from '../types';

/**
 * Abstract base class for platform adapters
 * 
 * Each platform (Discord, Telegram, Slack) implements this interface
 * to provide platform-specific connection and data fetching logic
 */
export abstract class BaseAdapter {
  /** Platform identifier */
  abstract readonly platform: PlatformType;
  
  /** Human-readable platform name */
  abstract readonly displayName: string;
  
  /** Icon identifier for frontend */
  abstract readonly icon: string;
  
  /** Description for users */
  abstract readonly description: string;
  
  /** Authorization type */
  abstract readonly authType: AuthType;
  
  /** Types of resources this platform provides (e.g., 'channel', 'chat') */
  abstract readonly resourceTypes: string[];

  /**
   * Check if this adapter is properly configured
   * (has required environment variables)
   */
  abstract isConfigured(): boolean;

  /**
   * Get platform info for frontend display
   */
  getPlatformInfo(): PlatformInfo {
    return {
      platform: this.platform,
      displayName: this.displayName,
      icon: this.icon,
      description: this.description,
      authType: this.authType,
      resourceTypes: this.resourceTypes,
      isEnabled: this.isConfigured(),
    };
  }

  /**
   * Generate authorization URL for connecting
   * 
   * For OAuth platforms (Discord, Slack): Returns URL to redirect user to
   * For webhook platforms (Telegram): Returns deep link and instructions
   * 
   * @param userId - User ID initiating the connection
   * @param redirectUrl - Optional URL to redirect to after auth
   * @param popup - If true, callback will return HTML for popup mode
   */
  abstract generateAuthUrl(userId: string, redirectUrl?: string, popup?: boolean): Promise<AuthUrlResult>;

  /**
   * Handle OAuth callback or connection completion
   * 
   * @param params - Callback parameters from the platform
   * @returns Created connection record
   */
  abstract handleCallback(params: OAuthCallbackParams): Promise<ExternalConnection>;

  /**
   * Handle webhook events (for platforms like Telegram)
   * 
   * Default implementation does nothing - override in webhook-based adapters
   * 
   * @param payload - Webhook payload from the platform
   */
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    // Default: do nothing
    // Override in adapters that use webhooks (Telegram)
  }

  /**
   * Verify that a connection is still valid
   * (e.g., bot still in guild, app still installed)
   * 
   * @param connection - Connection to verify
   * @returns Whether the connection is still valid
   */
  abstract verifyConnection(connection: ExternalConnection): Promise<boolean>;

  /**
   * Refresh OAuth tokens if needed
   * 
   * Default implementation does nothing - override in OAuth adapters with refresh tokens
   * 
   * @param connection - Connection to refresh
   */
  async refreshTokens(connection: ExternalConnection): Promise<void> {
    // Default: do nothing
    // Override in adapters that use OAuth with refresh tokens (Slack)
  }

  /**
   * Sync channels/resources for a connection
   * 
   * Fetches current list of channels from the platform
   * and updates the database
   * 
   * @param connection - Connection to sync
   * @returns List of channels
   */
  abstract syncChannels(connection: ExternalConnection): Promise<ExternalChannel[]>;

  /**
   * Validate that channels are accessible
   * 
   * @param connection - Connection to validate against
   * @param channelIds - Channel IDs to validate
   */
  abstract validateChannels(
    connection: ExternalConnection,
    channelIds: string[]
  ): Promise<ValidationResult>;

  /**
   * Get the platform client instance
   * 
   * Returns the underlying client (Discord.js Client, Telegraf, etc.)
   * for use by source plugins
   */
  abstract getClient(): Promise<any>;

  /**
   * Initialize the adapter
   * 
   * Called on startup to set up any required resources
   * (e.g., connecting to Discord, starting Telegram bot)
   */
  async initialize(): Promise<void> {
    // Default: do nothing
    // Override if adapter needs initialization
  }

  /**
   * Shutdown the adapter
   * 
   * Called on shutdown to clean up resources
   */
  async shutdown(): Promise<void> {
    // Default: do nothing
    // Override if adapter needs cleanup
  }
}
