/**
 * Telegram Adapter - Telegram-specific implementation of BaseAdapter
 * 
 * Handles Telegram bot connections via deep link flow:
 * 1. User clicks "Connect Telegram" on our platform
 * 2. We generate a unique connection token
 * 3. User clicks deep link to add bot to their group
 * 4. Bot receives /start command with token in the group
 * 5. Bot validates token and creates the connection
 */

import { Telegraf, Context } from 'telegraf';
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
  WebhookPayload,
  ExternalConnectionRow,
  ExternalChannelRow,
  ExternalOAuthStateRow,
  TelegramMessageCache,
  mapConnectionRow,
  mapChannelRow,
} from '../types';
import { databaseService } from '../../databaseService';

// Token expiration (30 minutes for Telegram since it requires user action)
const TOKEN_EXPIRATION_MS = 30 * 60 * 1000;

/**
 * Telegram Adapter
 * 
 * Uses webhook/deep-link flow for connections rather than OAuth
 */
export class TelegramAdapter extends BaseAdapter {
  readonly platform: PlatformType = 'telegram';
  readonly displayName = 'Telegram';
  readonly icon = 'telegram';
  readonly description = 'Connect Telegram groups and channels to fetch messages';
  readonly authType: AuthType = 'webhook';
  readonly resourceTypes = ['group', 'supergroup', 'channel'];

  private bot: Telegraf | null = null;
  private isInitialized = false;

  /**
   * Check if Telegram is configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.TELEGRAM_BOT_TOKEN &&
      process.env.TELEGRAM_BOT_USERNAME
    );
  }

  /**
   * Initialize the Telegram bot
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || !this.isConfigured()) {
      return;
    }

    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

    // Handle /start command with connection token
    this.bot.command('start', async (ctx: Context) => {
      await this.handleStartCommand(ctx);
    });

    // Handle bot being added/removed from chats
    this.bot.on('my_chat_member', async (ctx: Context) => {
      await this.handleChatMemberUpdate(ctx);
    });

    // Handle new messages (for caching)
    this.bot.on('message', async (ctx: Context) => {
      await this.handleMessage(ctx);
    });

    // Start bot
    if (process.env.TELEGRAM_WEBHOOK_URL) {
      // Webhook mode for production
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
      await this.bot.telegram.setWebhook(webhookUrl);
      console.log(`[TelegramAdapter] Webhook set to: ${webhookUrl}`);
    } else if (process.env.TELEGRAM_USE_POLLING === 'true') {
      // Polling mode for development
      this.bot.launch();
      console.log('[TelegramAdapter] Bot started in polling mode');
    }

    this.isInitialized = true;
    console.log('[TelegramAdapter] Bot initialized');
  }

  /**
   * Shutdown the Telegram bot
   */
  async shutdown(): Promise<void> {
    if (this.bot) {
      this.bot.stop('Shutdown');
      this.bot = null;
      this.isInitialized = false;
    }
  }

  /**
   * Get the Telegram bot instance
   */
  async getClient(): Promise<Telegraf> {
    if (!this.bot || !this.isInitialized) {
      await this.initialize();
    }
    return this.bot!;
  }

  /**
   * Generate connection URL (deep link)
   * @param userId - User ID initiating the connection
   * @param redirectUrl - Optional URL to redirect to after connection (not used for Telegram)
   * @param popup - If true, indicates popup mode (stored in metadata for future use)
   */
  async generateAuthUrl(userId: string, redirectUrl?: string, popup?: boolean): Promise<AuthUrlResult> {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;

    // Generate unique connection token
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION_MS);

    // Store pending connection
    await databaseService.query(
      `INSERT INTO external_oauth_states (user_id, platform, state, redirect_url, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, 'telegram', token, redirectUrl || null, JSON.stringify({ popup: !!popup }), expiresAt]
    );

    // Generate deep link for adding bot to a group
    // startgroup parameter triggers "Add to group" dialog
    const url = `https://t.me/${botUsername}?startgroup=${token}`;

    return {
      url,
      state: token,
      platform: 'telegram',
      authType: 'webhook',
      instructions: `Click the link to add the bot to your Telegram group. The bot will automatically connect once added.`,
    };
  }

  /**
   * Handle OAuth callback (called when connection is completed via webhook)
   */
  async handleCallback(params: OAuthCallbackParams): Promise<ExternalConnection> {
    const { state, chatId, chatTitle, chatType } = params;

    // Validate token
    const stateResult = await databaseService.query(
      `SELECT * FROM external_oauth_states 
       WHERE state = $1 AND platform = 'telegram' AND expires_at > NOW()`,
      [state]
    );

    if (stateResult.rows.length === 0) {
      throw new Error('Invalid or expired connection token');
    }

    const oauthState = stateResult.rows[0] as ExternalOAuthStateRow;
    const userId = oauthState.user_id;

    // Delete used token
    await databaseService.query('DELETE FROM external_oauth_states WHERE id = $1', [oauthState.id]);

    // Check if connection already exists
    const existingResult = await databaseService.query(
      `SELECT * FROM external_connections 
       WHERE user_id = $1 AND platform = 'telegram' AND external_id = $2`,
      [userId, chatId.toString()]
    );

    let connection: ExternalConnection;

    if (existingResult.rows.length > 0) {
      // Update existing connection
      const updateResult = await databaseService.query(
        `UPDATE external_connections 
         SET external_name = $1, is_active = TRUE, metadata = $2, updated_at = NOW()
         WHERE user_id = $3 AND platform = 'telegram' AND external_id = $4
         RETURNING *`,
        [chatTitle, JSON.stringify({ chatType }), userId, chatId.toString()]
      );
      connection = mapConnectionRow(updateResult.rows[0] as ExternalConnectionRow);
    } else {
      // Create new connection
      const insertResult = await databaseService.query(
        `INSERT INTO external_connections 
         (user_id, platform, external_id, external_name, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, 'telegram', chatId.toString(), chatTitle, JSON.stringify({ chatType })]
      );
      connection = mapConnectionRow(insertResult.rows[0] as ExternalConnectionRow);
    }

    // Create the channel record (for Telegram, the chat itself is the channel)
    await this.syncChannels(connection);

    return connection;
  }

  /**
   * Handle webhook events
   */
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    if (!this.bot) {
      await this.initialize();
    }

    // Process the update through Telegraf
    await this.bot!.handleUpdate(payload.data);
  }

  /**
   * Handle /start command in a group
   */
  private async handleStartCommand(ctx: Context): Promise<void> {
    const chat = ctx.chat;
    const message = ctx.message;

    if (!chat || !message || !('text' in message)) return;

    // Only process in groups/supergroups
    if (chat.type === 'private') {
      await ctx.reply('Please add me to a group and use /start [token] there to connect it.');
      return;
    }

    // Extract token from command
    const parts = message.text.split(' ');
    if (parts.length < 2) {
      await ctx.reply('Please use the connection link from the platform to add this group.');
      return;
    }

    const token = parts[1];

    try {
      // Complete the connection
      await this.handleCallback({
        platform: 'telegram',
        state: token,
        chatId: chat.id,
        chatTitle: 'title' in chat ? chat.title : 'Telegram Chat',
        chatType: chat.type,
      });

      await ctx.reply('Successfully connected! This group is now linked to your AI News account.');
    } catch (error: any) {
      console.error('[TelegramAdapter] Connection error:', error);
      await ctx.reply(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Handle bot being added/removed from chats
   */
  private async handleChatMemberUpdate(ctx: Context): Promise<void> {
    const update = ctx.myChatMember;
    if (!update) return;

    const chat = update.chat;
    const newStatus = update.new_chat_member.status;

    if (newStatus === 'left' || newStatus === 'kicked') {
      // Bot was removed - mark connections as inactive
      await databaseService.query(
        `UPDATE external_connections 
         SET is_active = FALSE, updated_at = NOW()
         WHERE platform = 'telegram' AND external_id = $1`,
        [chat.id.toString()]
      );
      console.log(`[TelegramAdapter] Bot removed from chat: ${chat.id}`);
    }
  }

  /**
   * Handle incoming messages (for caching)
   */
  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message;
    const chat = ctx.chat;

    if (!message || !chat || chat.type === 'private') return;

    // Find active connections for this chat
    const connections = await databaseService.query(
      `SELECT id FROM external_connections 
       WHERE platform = 'telegram' AND external_id = $1 AND is_active = TRUE`,
      [chat.id.toString()]
    );

    if (connections.rows.length === 0) return;

    // Cache the message for each connection
    for (const conn of connections.rows) {
      try {
        await databaseService.query(
          `INSERT INTO telegram_message_cache 
           (connection_id, chat_id, message_id, from_user_id, from_username, text, caption, 
            message_type, has_media, reply_to_message_id, raw_message, message_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12))
           ON CONFLICT (connection_id, chat_id, message_id) DO NOTHING`,
          [
            conn.id,
            chat.id.toString(),
            message.message_id,
            'from' in message && message.from ? message.from.id : null,
            'from' in message && message.from ? message.from.username : null,
            'text' in message ? message.text : null,
            'caption' in message ? message.caption : null,
            this.getMessageType(message),
            this.hasMedia(message),
            'reply_to_message' in message && message.reply_to_message 
              ? message.reply_to_message.message_id 
              : null,
            JSON.stringify(message),
            message.date,
          ]
        );
      } catch (error) {
        console.error('[TelegramAdapter] Error caching message:', error);
      }
    }
  }

  /**
   * Get message type
   */
  private getMessageType(message: any): string {
    if (message.text) return 'text';
    if (message.photo) return 'photo';
    if (message.video) return 'video';
    if (message.document) return 'document';
    if (message.audio) return 'audio';
    if (message.voice) return 'voice';
    if (message.sticker) return 'sticker';
    if (message.poll) return 'poll';
    return 'other';
  }

  /**
   * Check if message has media
   */
  private hasMedia(message: any): boolean {
    return !!(message.photo || message.video || message.document || 
              message.audio || message.voice || message.sticker);
  }

  /**
   * Verify Telegram connection is still valid
   */
  async verifyConnection(connection: ExternalConnection): Promise<boolean> {
    try {
      const bot = await this.getClient();
      const chat = await bot.telegram.getChat(connection.externalId);
      
      if (chat) {
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
      // Mark as inactive if bot can't access the chat
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
   * Sync channels for a Telegram connection
   * For Telegram, the chat itself is the only "channel"
   */
  async syncChannels(connection: ExternalConnection): Promise<ExternalChannel[]> {
    const bot = await this.getClient();

    try {
      const chat = await bot.telegram.getChat(connection.externalId);
      const chatType = 'type' in chat ? chat.type : 'group';
      const chatTitle = 'title' in chat ? chat.title : connection.externalName;

      // Upsert the channel record
      await databaseService.query(
        `INSERT INTO external_channels 
         (connection_id, external_id, external_name, resource_type, is_accessible, metadata, last_synced_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, NOW())
         ON CONFLICT (connection_id, external_id) 
         DO UPDATE SET 
           external_name = EXCLUDED.external_name,
           is_accessible = TRUE,
           last_synced_at = NOW()`,
        [
          connection.id,
          connection.externalId,
          chatTitle,
          this.chatTypeToResourceType(chatType),
          JSON.stringify({ chatType }),
        ]
      );

      // Fetch and return
      const result = await databaseService.query(
        `SELECT * FROM external_channels WHERE connection_id = $1`,
        [connection.id]
      );

      return result.rows.map((row: ExternalChannelRow) => mapChannelRow(row));
    } catch (error) {
      console.error('[TelegramAdapter] Error syncing channels:', error);
      return [];
    }
  }

  /**
   * Convert Telegram chat type to resource type number
   */
  private chatTypeToResourceType(chatType: string): number {
    switch (chatType) {
      case 'group': return 1;
      case 'supergroup': return 2;
      case 'channel': return 3;
      default: return 0;
    }
  }

  /**
   * Validate Telegram channels
   */
  async validateChannels(
    connection: ExternalConnection,
    channelIds: string[]
  ): Promise<ValidationResult> {
    // For Telegram, validate that the channel ID matches the connection's chat ID
    const invalidChannels = channelIds.filter(id => id !== connection.externalId);

    return {
      valid: invalidChannels.length === 0,
      invalidChannels,
    };
  }

  /**
   * Get cached messages for a chat
   */
  async getCachedMessages(
    connectionId: string,
    chatId: string,
    options: { limit?: number; afterMessageId?: number; beforeDate?: Date } = {}
  ): Promise<TelegramMessageCache[]> {
    let query = `
      SELECT * FROM telegram_message_cache 
      WHERE connection_id = $1 AND chat_id = $2
    `;
    const params: any[] = [connectionId, chatId];
    let paramIndex = 3;

    if (options.afterMessageId) {
      query += ` AND message_id > $${paramIndex}`;
      params.push(options.afterMessageId);
      paramIndex++;
    }

    if (options.beforeDate) {
      query += ` AND message_date < $${paramIndex}`;
      params.push(options.beforeDate);
      paramIndex++;
    }

    query += ` ORDER BY message_date DESC`;

    if (options.limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
    }

    const result = await databaseService.query(query, params);
    return result.rows.map((row: any) => this.mapMessageCacheRow(row));
  }

  /**
   * Map database row to TelegramMessageCache
   */
  private mapMessageCacheRow(row: any): TelegramMessageCache {
    return {
      id: row.id,
      connectionId: row.connection_id,
      chatId: row.chat_id,
      messageId: row.message_id,
      fromUserId: row.from_user_id || undefined,
      fromUsername: row.from_username || undefined,
      text: row.text || undefined,
      caption: row.caption || undefined,
      messageType: row.message_type,
      hasMedia: row.has_media,
      replyToMessageId: row.reply_to_message_id || undefined,
      rawMessage: row.raw_message,
      messageDate: row.message_date,
      createdAt: row.cached_at,
    };
  }
}

// Singleton instance
export const telegramAdapter = new TelegramAdapter();
