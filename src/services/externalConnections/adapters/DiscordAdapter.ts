/**
 * Discord Adapter - Discord-specific implementation of BaseAdapter
 * 
 * Handles Discord OAuth, bot management, and channel syncing
 */

import { Client, GatewayIntentBits, Guild, ChannelType, PermissionFlagsBits } from 'discord.js';
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
  CreateConnectionRequest,
  ExternalConnectionRow,
  ExternalChannelRow,
  ExternalOAuthStateRow,
  mapConnectionRow,
  mapChannelRow,
} from '../types';
import { databaseService } from '../../databaseService';

// Discord OAuth2 endpoints
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_API_URL = 'https://discord.com/api/v10';

// OAuth state expiration (10 minutes)
const STATE_EXPIRATION_MS = 10 * 60 * 1000;

/**
 * Discord Adapter
 * 
 * Provides Discord integration for the external connections system
 */
export class DiscordAdapter extends BaseAdapter {
  readonly platform: PlatformType = 'discord';
  readonly displayName = 'Discord';
  readonly icon = 'discord';
  readonly description = 'Connect Discord servers to fetch messages from channels';
  readonly authType: AuthType = 'oauth';
  readonly resourceTypes = ['text_channel', 'announcement_channel', 'forum_channel'];

  private client: Client | null = null;
  private isInitialized = false;

  /**
   * Check if Discord is configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_CLIENT_SECRET &&
      process.env.DISCORD_BOT_TOKEN &&
      process.env.DISCORD_OAUTH_REDIRECT_URI
    );
  }

  /**
   * Initialize the Discord bot client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || !this.isConfigured()) {
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });

    // Handle bot being added/removed from guilds
    this.client.on('guildCreate', async (guild) => {
      console.log(`[DiscordAdapter] Bot added to guild: ${guild.name} (${guild.id})`);
    });

    this.client.on('guildDelete', async (guild) => {
      console.log(`[DiscordAdapter] Bot removed from guild: ${guild.name} (${guild.id})`);
      // Mark connection as inactive
      await databaseService.query(
        `UPDATE external_connections 
         SET is_active = FALSE, updated_at = NOW() 
         WHERE platform = 'discord' AND external_id = $1`,
        [guild.id]
      );
    });

    this.client.on('error', (error) => {
      console.error('[DiscordAdapter] Client error:', error);
    });

    // Login
    await this.client.login(process.env.DISCORD_BOT_TOKEN);
    this.isInitialized = true;
    console.log('[DiscordAdapter] Bot logged in successfully');
  }

  /**
   * Shutdown the Discord client
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.isInitialized = false;
    }
  }

  /**
   * Get the Discord client, initializing if needed
   */
  async getClient(): Promise<Client> {
    if (!this.client || !this.isInitialized) {
      await this.initialize();
    }
    return this.client!;
  }

  /**
   * Check if client is ready
   */
  isClientReady(): boolean {
    return this.client?.isReady() ?? false;
  }

  /**
   * Generate Discord OAuth URL
   * @param userId - User ID initiating the connection
   * @param redirectUrl - Optional URL to redirect to after auth
   * @param popup - If true, callback will return HTML for popup mode
   */
  async generateAuthUrl(userId: string, redirectUrl?: string, popup?: boolean): Promise<AuthUrlResult> {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;
    const permissions = process.env.DISCORD_BOT_PERMISSIONS || '66560';

    // Generate secure state token (add _popup suffix for popup mode)
    const baseState = crypto.randomBytes(32).toString('hex');
    const state = popup ? `${baseState}_popup` : baseState;
    const expiresAt = new Date(Date.now() + STATE_EXPIRATION_MS);

    // Store state in database (store base state without popup suffix)
    await databaseService.query(
      `INSERT INTO external_oauth_states (user_id, platform, state, redirect_url, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, 'discord', baseState, redirectUrl || null, JSON.stringify({ popup: !!popup }), expiresAt]
    );

    // Build OAuth URL
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,
      response_type: 'code',
      scope: 'bot applications.commands',
      permissions,
      state,
    });

    const url = `${DISCORD_AUTH_URL}?${params.toString()}`;

    return {
      url,
      state,
      platform: 'discord',
      authType: 'oauth',
    };
  }

  /**
   * Handle Discord OAuth callback
   */
  async handleCallback(params: OAuthCallbackParams): Promise<ExternalConnection> {
    const { code, state, guild_id, permissions } = params;

    if (!code) {
      throw new Error('Missing authorization code');
    }

    if (!guild_id) {
      throw new Error('Missing guild_id - user must select a server');
    }

    // Validate state
    const stateResult = await databaseService.query(
      `SELECT * FROM external_oauth_states 
       WHERE state = $1 AND platform = 'discord' AND expires_at > NOW()`,
      [state]
    );

    if (stateResult.rows.length === 0) {
      throw new Error('Invalid or expired state token');
    }

    const oauthState = stateResult.rows[0] as ExternalOAuthStateRow;
    const userId = oauthState.user_id;

    // Delete used state
    await databaseService.query('DELETE FROM external_oauth_states WHERE id = $1', [oauthState.id]);

    // Exchange code for tokens - REQUIRED when "Requires OAuth2 Code Grant" is enabled
    // This completes the OAuth flow and triggers the bot to join the server
    const tokenUrl = 'https://discord.com/api/oauth2/token';
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;

    console.log('[DiscordAdapter] Exchanging authorization code for tokens...');
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri!,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[DiscordAdapter] Token exchange failed:', errorText);
      throw new Error(`Failed to exchange authorization code: ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('[DiscordAdapter] Token exchange successful, guild should be joined now');

    // Give the bot a moment to join the guild
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get guild info from Discord API
    const client = await this.getClient();
    
    // Debug: Log current guilds the bot is in
    console.log(`[DiscordAdapter] Bot is currently in ${client.guilds.cache.size} guilds:`);
    client.guilds.cache.forEach(g => console.log(`  - ${g.name} (${g.id})`));
    console.log(`[DiscordAdapter] Trying to fetch guild: ${guild_id}`);
    
    // Sometimes the bot needs a moment to join the guild after OAuth
    let guild;
    let retries = 3;
    while (retries > 0) {
      try {
        guild = await client.guilds.fetch(guild_id);
        break;
      } catch (fetchError: any) {
        console.log(`[DiscordAdapter] Failed to fetch guild ${guild_id}, retries left: ${retries - 1}`, fetchError.message);
        retries--;
        if (retries > 0) {
          // Wait 2 seconds before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw new Error(`Unable to access guild. Make sure the bot (DISCORD_BOT_TOKEN) matches the OAuth app (DISCORD_CLIENT_ID). Original error: ${fetchError.message}`);
        }
      }
    }

    if (!guild) {
      throw new Error('Bot is not in the selected guild');
    }

    // Check if connection already exists
    const existingResult = await databaseService.query(
      `SELECT * FROM external_connections 
       WHERE user_id = $1 AND platform = 'discord' AND external_id = $2`,
      [userId, guild_id]
    );

    let connection: ExternalConnection;

    if (existingResult.rows.length > 0) {
      // Update existing connection
      const updateResult = await databaseService.query(
        `UPDATE external_connections 
         SET external_name = $1, external_icon = $2, permissions = $3, 
             is_active = TRUE, updated_at = NOW()
         WHERE user_id = $4 AND platform = 'discord' AND external_id = $5
         RETURNING *`,
        [guild.name, guild.icon, parseInt(permissions as string) || 0, userId, guild_id]
      );
      connection = mapConnectionRow(updateResult.rows[0] as ExternalConnectionRow);
    } else {
      // Create new connection
      const insertResult = await databaseService.query(
        `INSERT INTO external_connections 
         (user_id, platform, external_id, external_name, external_icon, permissions, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, 'discord', guild_id, guild.name, guild.icon, parseInt(permissions as string) || 0, JSON.stringify({})]
      );
      connection = mapConnectionRow(insertResult.rows[0] as ExternalConnectionRow);
    }

    // Sync channels
    await this.syncChannels(connection);

    return connection;
  }

  /**
   * Verify Discord connection is still valid
   */
  async verifyConnection(connection: ExternalConnection): Promise<boolean> {
    try {
      const client = await this.getClient();
      const guild = await client.guilds.fetch(connection.externalId);
      
      if (guild) {
        // Update verification timestamp
        await databaseService.query(
          `UPDATE external_connections 
           SET last_verified_at = NOW(), is_active = TRUE 
           WHERE id = $1`,
          [connection.id]
        );
        return true;
      }
      return false;
    } catch (error) {
      // Mark as inactive if bot is no longer in guild
      await databaseService.query(
        `UPDATE external_connections 
         SET is_active = FALSE, updated_at = NOW() 
         WHERE id = $1`,
        [connection.id]
      );
      return false;
    }
  }

  /**
   * Sync channels for a Discord connection
   */
  async syncChannels(connection: ExternalConnection): Promise<ExternalChannel[]> {
    const client = await this.getClient();
    const guild = await client.guilds.fetch(connection.externalId);

    if (!guild) {
      throw new Error('Bot is not in this guild');
    }

    // Fetch all channels
    const channels = await guild.channels.fetch();
    const accessibleChannels: ExternalChannel[] = [];

    // Get categories first for parent names
    const categories = new Map<string, string>();
    channels.forEach((channel) => {
      if (channel && channel.type === ChannelType.GuildCategory) {
        categories.set(channel.id, channel.name);
      }
    });

    // Process text-based channels
    for (const [, channel] of channels) {
      if (!channel) continue;

      // Only include text-based channels the bot can read
      const isTextBased = [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
      ].includes(channel.type);

      if (!isTextBased) continue;

      // Check if bot can view and read messages
      const permissions = channel.permissionsFor(client.user!);
      const canAccess = permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ]) ?? false;

      const parentName = channel.parentId ? categories.get(channel.parentId) : undefined;

      accessibleChannels.push({
        id: '', // Will be set by database
        connectionId: connection.id,
        externalId: channel.id,
        externalName: channel.name,
        resourceType: channel.type,
        parentId: channel.parentId || undefined,
        parentName,
        position: channel.position,
        isAccessible: canAccess,
        metadata: {},
        lastSyncedAt: new Date(),
      });
    }

    // Update database
    // First, mark all existing channels for this connection
    await databaseService.query(
      `UPDATE external_channels SET is_accessible = FALSE WHERE connection_id = $1`,
      [connection.id]
    );

    // Upsert channels
    for (const channel of accessibleChannels) {
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
           last_synced_at = NOW()`,
        [
          connection.id,
          channel.externalId,
          channel.externalName,
          channel.resourceType,
          channel.parentId || null,
          channel.parentName || null,
          channel.position,
          channel.isAccessible,
          JSON.stringify(channel.metadata),
        ]
      );
    }

    // Fetch and return updated channels
    const result = await databaseService.query(
      `SELECT * FROM external_channels WHERE connection_id = $1 ORDER BY position`,
      [connection.id]
    );

    return result.rows.map((row: ExternalChannelRow) => mapChannelRow(row));
  }

  /**
   * Validate Discord channels
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
   * Get guilds the bot is in
   */
  async getGuilds(): Promise<Guild[]> {
    const client = await this.getClient();
    return Array.from(client.guilds.cache.values());
  }

  /**
   * Check if bot is in a specific guild
   */
  async isInGuild(guildId: string): Promise<boolean> {
    const client = await this.getClient();
    return client.guilds.cache.has(guildId);
  }

  /**
   * Fetch messages from a channel (for source plugins)
   */
  async fetchMessages(channelId: string, options: { limit?: number; after?: string; before?: string } = {}) {
    const client = await this.getClient();
    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not text-based');
    }

    return channel.messages.fetch({
      limit: options.limit || 100,
      after: options.after,
      before: options.before,
    });
  }
}

// Singleton instance
export const discordAdapter = new DiscordAdapter();
