/**
 * @fileoverview Implementation of a content source for fetching messages from Telegram chats
 * Handles message retrieval from Telegram groups/channels via cached messages
 * 
 * Supports two modes:
 * 1. Self-hosted mode: Uses provided botToken directly (for CLI usage)
 * 2. Platform mode: Uses TelegramAdapter via connectionId (for multi-tenant platform)
 * 
 * Note: Unlike Discord, Telegram Bot API doesn't support fetching historical messages.
 * Messages are cached when received by the webhook/polling bot and retrieved from cache.
 */

import { Telegraf } from 'telegraf';
import { ContentSource } from './ContentSource';
import { 
  ContentItem, 
  PlatformSourceConfig,
  isPlatformSourceConfig,
} from '../../types';
import { externalConnectionService, telegramAdapter } from '../../services/externalConnections';
import { TelegramMessageCache } from '../../services/externalConnections/types';
import { logger } from '../../helpers/cliHelper';
import { StoragePlugin } from '../storage/StoragePlugin';
import { databaseService } from '../../services/databaseService';

/**
 * Configuration for self-hosted Telegram source
 */
interface TelegramSourceConfig {
  name: string;
  botToken: string;
  chatIds: string[];  // Telegram chat IDs (can be negative for groups)
  storage: StoragePlugin;
}

/**
 * Unified config type for both self-hosted and platform modes
 */
type UnifiedTelegramConfig = TelegramSourceConfig | PlatformSourceConfig;

/**
 * TelegramSource class that implements ContentSource interface for Telegram messages
 * Fetches messages from Telegram groups/channels via cached webhook data
 * 
 * @implements {ContentSource}
 */
export class TelegramSource implements ContentSource {
  /** Name identifier for this Telegram source */
  public name: string;
  /** Telegram bot token for authentication (self-hosted mode only) */
  private botToken: string | null = null;
  /** List of Telegram chat IDs to monitor */
  private chatIds: string[];
  /** Telegraf client instance (self-hosted mode only) */
  private bot: Telegraf | null = null;
  /** Storage plugin for cursor management - public for injection by loadStorage */
  public storage: StoragePlugin | string;
  
  /**
   * Gets the storage plugin, ensuring it has been properly injected
   * @throws Error if storage is still a string (not yet injected)
   */
  private getStorage(): StoragePlugin {
    if (typeof this.storage === 'string') {
      throw new Error(`[TelegramSource] Storage '${this.storage}' has not been injected. Make sure loadStorage() is called before fetchItems().`);
    }
    return this.storage;
  }
  /** Whether running in platform mode (multi-tenant) */
  private isPlatformMode: boolean = false;
  /** Connection ID for platform mode */
  private connectionId: string | null = null;
  /** User ID for platform mode */
  private platformUserId: string | null = null;

  /** Platform type required for this source (used by frontend to filter available plugins) */
  static requiresPlatform = 'telegram';
  
  static constructorInterface = {
    parameters: [
      {
        name: 'botToken',
        type: 'string',
        required: false,
        description: 'Telegram bot token for authentication (self-hosted mode)',
        secret: true
      },
      {
        name: 'connectionId',
        type: 'string',
        required: false,
        description: 'External connection ID (platform mode)'
      },
      {
        name: 'chatIds',
        type: 'array',
        required: false,
        description: 'List of Telegram chat IDs to monitor (self-hosted mode)'
      },
      {
        name: 'channelIds',
        type: 'array',
        required: false,
        description: 'List of channel IDs to monitor (platform mode, same as chat IDs)'
      },
      {
        name: 'storage',
        type: 'object',
        required: true,
        description: 'Storage plugin for cursor management'
      }
    ]
  };

  /**
   * Creates a new TelegramSource instance
   * @param {UnifiedTelegramConfig} config - Configuration object
   */
  constructor(config: UnifiedTelegramConfig) {
    this.name = config.name;
    this.storage = config.storage;

    if (isPlatformSourceConfig(config)) {
      // Platform mode - use external connection service
      this.isPlatformMode = true;
      this.connectionId = config.connectionId;
      this.chatIds = config.channelIds; // In platform mode, channelIds are the chat IDs
      this.platformUserId = config._userId || null;
      logger.info(`[TelegramSource] Initialized in platform mode with connection ${config.connectionId}`);
    } else if ('botToken' in config) {
      // Self-hosted mode - use provided bot token
      this.isPlatformMode = false;
      this.botToken = config.botToken;
      this.chatIds = config.chatIds;
      this.bot = new Telegraf(config.botToken);
      logger.info(`[TelegramSource] Initialized in self-hosted mode for ${this.chatIds.length} chats`);
    } else {
      throw new Error('TelegramSource requires either botToken (self-hosted) or connectionId (platform mode)');
    }
  }

  /**
   * Validate platform mode connection before fetching
   */
  private async validatePlatformConnection(): Promise<void> {
    if (!this.isPlatformMode || !this.connectionId) {
      return;
    }

    const connection = await externalConnectionService.getConnectionById(this.connectionId);
    if (!connection) {
      throw new Error(`Connection ${this.connectionId} not found`);
    }

    if (!connection.isActive) {
      throw new Error(`Connection ${this.connectionId} is no longer active`);
    }

    // For Telegram, validate that requested chat IDs match the connection
    const validation = await externalConnectionService.validateChannels(
      this.connectionId,
      this.chatIds
    );

    if (!validation.valid) {
      throw new Error(`Some chats are not accessible: ${validation.invalidChannels.join(', ')}`);
    }
  }

  /**
   * Convert a cached Telegram message to ContentItem format
   */
  private messageToContentItem(msg: TelegramMessageCache, chatName: string): ContentItem {
    const content = msg.text || msg.caption || '';
    const messageType = msg.messageType || 'text';
    
    // Build message link (works for public groups/channels, may not work for private)
    const chatId = msg.chatId;
    const messageId = msg.messageId;
    
    return {
      cid: `telegram-${chatId}-${messageId}`,
      type: 'telegramMessage',
      source: `${this.name} - ${chatName}`,
      title: `Telegram message from ${msg.fromUsername || msg.fromUserId || 'Unknown'}`,
      text: content,
      link: `https://t.me/c/${chatId.replace('-100', '')}/${messageId}`,
      date: msg.messageDate ? new Date(msg.messageDate).getTime() : Date.now(),
      metadata: {
        chatId: msg.chatId,
        messageId: msg.messageId,
        fromUserId: msg.fromUserId,
        fromUsername: msg.fromUsername,
        messageType,
        hasMedia: msg.hasMedia,
        replyToMessageId: msg.replyToMessageId,
      }
    };
  }

  /**
   * Fetch recent items from Telegram (platform mode - from cache)
   */
  private async fetchFromCache(): Promise<ContentItem[]> {
    const items: ContentItem[] = [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const chatId of this.chatIds) {
      try {
        // Get the cursor for last fetched message
        const cursorKey = `${this.name}-telegram-${chatId}`;
        const lastMessageId = await this.getStorage().getCursor(cursorKey);

        // Fetch cached messages
        const messages = await telegramAdapter.getCachedMessages(
          this.connectionId!,
          chatId,
          {
            limit: 100,
            afterMessageId: lastMessageId ? parseInt(lastMessageId) : undefined,
          }
        );

        if (messages.length === 0) {
          logger.info(`[TelegramSource] No new messages for chat ${chatId}`);
          continue;
        }

        // Get chat name from the connection
        const connection = await externalConnectionService.getConnectionById(this.connectionId!);
        const chatName = connection?.externalName || `Chat ${chatId}`;

        // Convert to content items
        for (const msg of messages) {
          items.push(this.messageToContentItem(msg, chatName));
        }

        // Update cursor to newest message
        const newestMessage = messages.reduce((a, b) => 
          a.messageId > b.messageId ? a : b
        );
        await this.getStorage().setCursor(cursorKey, newestMessage.messageId.toString());

        logger.success(`[TelegramSource] Fetched ${messages.length} messages from ${chatName}`);
      } catch (error) {
        logger.error(`[TelegramSource] Error fetching chat ${chatId}: ${error}`);
      }
    }

    return items;
  }

  /**
   * Fetch items in self-hosted mode
   * Note: Telegram Bot API doesn't support fetching history, so this only works
   * if you've set up message caching yourself
   */
  private async fetchSelfHosted(): Promise<ContentItem[]> {
    logger.warning(
      '[TelegramSource] Self-hosted mode: Telegram Bot API does not support fetching message history. ' +
      'You need to set up webhook/polling to cache messages first.'
    );
    
    // In self-hosted mode, we would need to implement our own message caching
    // For now, return empty - users should use platform mode or implement caching
    return [];
  }

  /**
   * Fetches recent messages from Telegram chats
   * @returns {Promise<ContentItem[]>} Array of content items containing Telegram messages
   */
  public async fetchItems(): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    if (this.isPlatformMode) {
      return this.fetchFromCache();
    } else {
      return this.fetchSelfHosted();
    }
  }

  /**
   * Fetches historical messages from Telegram for a specific date
   * @param {string} date - ISO date string to fetch historical messages from
   * @returns {Promise<ContentItem[]>} Array of content items
   */
  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    // Validate platform connection if in platform mode
    await this.validatePlatformConnection();

    if (!this.isPlatformMode) {
      logger.warning(
        '[TelegramSource] Historical fetch not supported in self-hosted mode. ' +
        'Telegram Bot API does not support fetching message history.'
      );
      return [];
    }

    const items: ContentItem[] = [];
    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    for (const chatId of this.chatIds) {
      try {
        // Query cached messages for the specific date
        const result = await databaseService.query(
          `SELECT * FROM telegram_message_cache 
           WHERE connection_id = $1 
             AND chat_id = $2 
             AND message_date >= $3 
             AND message_date < $4
           ORDER BY message_date ASC`,
          [this.connectionId, chatId, targetDate, nextDay]
        );

        if (result.rows.length === 0) {
          logger.info(`[TelegramSource] No messages for chat ${chatId} on ${date}`);
          continue;
        }

        // Get chat name
        const connection = await externalConnectionService.getConnectionById(this.connectionId!);
        const chatName = connection?.externalName || `Chat ${chatId}`;

        // Convert to content items
        for (const row of result.rows) {
          const msg: TelegramMessageCache = {
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
          items.push(this.messageToContentItem(msg, chatName));
        }

        logger.success(`[TelegramSource] Fetched ${result.rows.length} historical messages from ${chatName} for ${date}`);
      } catch (error) {
        logger.error(`[TelegramSource] Error fetching historical for chat ${chatId}: ${error}`);
      }
    }

    return items;
  }
}
