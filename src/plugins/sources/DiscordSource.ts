/**
 * @fileoverview Unified Discord Source - Combines all Discord data fetching modes
 * 
 * This plugin provides a single interface for fetching Discord data with three modes:
 * - detailed: Full message data with metadata, reactions, attachments (delegates to DiscordRawDataSource)
 * - summarized: AI-generated conversation summaries (delegates to DiscordChannelSource)
 * - simple: Basic messages from announcement channels only (delegates to DiscordAnnouncementSource)
 * 
 * Supports both self-hosted mode (botToken) and platform mode (connectionId).
 */

import { ContentSource } from './ContentSource';
import { ContentItem, AiProvider, MediaDownloadConfig } from '../../types';
import { StoragePlugin } from '../storage/StoragePlugin';
import { DiscordRawDataSource } from './DiscordRawDataSource';
import { DiscordChannelSource } from './DiscordChannelSource';
import { DiscordAnnouncementSource } from './DiscordAnnouncementSource';
import { logger } from '../../helpers/cliHelper';

/**
 * Operating modes for the unified Discord source
 */
export type DiscordSourceMode = 'detailed' | 'summarized' | 'simple';

/**
 * Configuration interface for the unified DiscordSource
 */
export interface DiscordSourceConfig {
  /** Name identifier for this Discord source */
  name: string;
  /** Operating mode: detailed, summarized, or simple */
  mode: DiscordSourceMode;
  /** External connection ID (platform mode) */
  connectionId?: string;
  /** List of Discord channel IDs to monitor */
  channelIds: string[];
  /** Storage plugin (required for detailed and summarized modes) */
  storage?: StoragePlugin;
  /** AI provider (required for summarized mode) */
  provider?: AiProvider;
  /** Discord bot token (self-hosted mode) */
  botToken?: string;
  /** Discord guild/server ID (self-hosted mode) */
  guildId?: string;
  /** Media download configuration (detailed mode only) */
  mediaDownload?: MediaDownloadConfig;
  // Platform mode injected fields
  _userId?: string;
  _externalId?: string;
}

/**
 * Unified Discord Source - Single plugin for all Discord data fetching needs
 * 
 * Modes:
 * - **detailed**: Full message data with reactions, attachments, user info, embeds, reply threads.
 *   Best for advanced data analysis, archiving, building custom reports.
 *   Requires: storage
 * 
 * - **summarized**: AI-generated conversation summaries grouped by time/topic.
 *   Best for busy channels where you want a digest instead of reading everything.
 *   Requires: storage, provider (AI)
 * 
 * - **simple**: Basic message content in a lightweight format.
 *   Best for tracking updates, news, official posts. Only works with announcement channels.
 *   Requires: nothing extra
 * 
 * @implements {ContentSource}
 */
export class DiscordSource implements ContentSource {
  /** Name identifier for this Discord source */
  public name: string;
  
  /** Storage plugin - exposed for injection by loadStorage */
  public storage: StoragePlugin | string | undefined;
  
  /** Platform type required for this source (used by frontend to filter available plugins) */
  static requiresPlatform = 'discord';
  
  /** Description shown in the UI */
  static description = 'Fetch messages from Discord channels with multiple modes';
  
  static constructorInterface = {
    parameters: [
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'Operating mode: detailed (full data), summarized (AI summaries), or simple (announcement channels only)'
      },
      {
        name: 'connectionId',
        type: 'string',
        required: false,
        description: 'External connection ID (platform mode)'
      },
      {
        name: 'channelIds',
        type: 'array',
        required: true,
        description: 'List of Discord channel IDs to monitor'
      },
      {
        name: 'storage',
        type: 'object',
        required: false,
        description: 'Storage plugin (required for detailed and summarized modes)'
      },
      {
        name: 'provider',
        type: 'AiProvider',
        required: false,
        description: 'AI provider (required for summarized mode)'
      },
      {
        name: 'botToken',
        type: 'string',
        required: false,
        description: 'Discord bot token (self-hosted mode)',
        secret: true
      },
      {
        name: 'guildId',
        type: 'string',
        required: false,
        description: 'Discord guild/server ID (self-hosted mode)'
      },
      {
        name: 'mediaDownload',
        type: 'object',
        required: false,
        description: 'Media download configuration (detailed mode only)'
      }
    ]
  };

  /** The delegate source that does the actual work */
  private delegate: ContentSource | null = null;
  
  /** Current operating mode */
  private mode: DiscordSourceMode;
  
  /** Stored config for lazy delegate creation */
  private config: DiscordSourceConfig;

  /**
   * Creates a new unified DiscordSource instance
   * @param config - Configuration object
   * @throws Error if required parameters for the selected mode are missing
   */
  constructor(config: DiscordSourceConfig) {
    this.name = config.name;
    this.mode = config.mode || 'detailed';
    this.config = config;
    // Store storage reference for injection - will be replaced with actual instance by loadStorage
    this.storage = config.storage;

    logger.info(`[DiscordSource] Initializing in '${this.mode}' mode for source '${this.name}'`);

    // Note: Delegate creation is deferred until first use to allow storage injection
  }
  
  /**
   * Gets or creates the delegate, ensuring storage is properly set
   */
  private getDelegate(): ContentSource {
    if (!this.delegate) {
      // Update config with injected storage (may have been replaced by loadStorage)
      if (this.storage && typeof this.storage !== 'string') {
        this.config.storage = this.storage;
      }
      
      // Validate mode-specific requirements
      this.validateConfig(this.config);
      
      // Create the appropriate delegate based on mode
      this.delegate = this.createDelegate(this.config);
    }
    return this.delegate;
  }

  /**
   * Validates the configuration based on the selected mode
   * @throws Error if required parameters are missing
   */
  private validateConfig(config: DiscordSourceConfig): void {
    switch (this.mode) {
      case 'detailed':
        if (!config.storage) {
          throw new Error('DiscordSource: Storage is required for detailed mode');
        }
        break;
        
      case 'summarized':
        if (!config.storage) {
          throw new Error('DiscordSource: Storage is required for summarized mode');
        }
        if (!config.provider) {
          throw new Error('DiscordSource: AI provider is required for summarized mode');
        }
        break;
        
      case 'simple':
        // No additional requirements for simple mode
        break;
        
      default:
        throw new Error(`DiscordSource: Unknown mode '${this.mode}'. Valid modes are: detailed, summarized, simple`);
    }

    // Validate that we have either connectionId (platform) or botToken (self-hosted)
    if (!config.connectionId && !config.botToken) {
      throw new Error('DiscordSource: Either connectionId (platform mode) or botToken (self-hosted mode) is required');
    }
  }

  /**
   * Creates the appropriate delegate source based on mode
   */
  private createDelegate(config: DiscordSourceConfig): ContentSource {
    switch (this.mode) {
      case 'detailed':
        logger.debug(`[DiscordSource] Creating DiscordRawDataSource delegate`);
        return new DiscordRawDataSource({
          name: config.name,
          channelIds: config.channelIds,
          storage: config.storage!,
          connectionId: config.connectionId,
          botToken: config.botToken,
          guildId: config.guildId,
          mediaDownload: config.mediaDownload,
          _userId: config._userId,
          _externalId: config._externalId,
        } as any);

      case 'summarized':
        logger.debug(`[DiscordSource] Creating DiscordChannelSource delegate`);
        return new DiscordChannelSource({
          name: config.name,
          channelIds: config.channelIds,
          storage: config.storage!,
          provider: config.provider,
          connectionId: config.connectionId,
          botToken: config.botToken,
          _userId: config._userId,
          _externalId: config._externalId,
        } as any);

      case 'simple':
        logger.debug(`[DiscordSource] Creating DiscordAnnouncementSource delegate`);
        return new DiscordAnnouncementSource({
          name: config.name,
          channelIds: config.channelIds,
          connectionId: config.connectionId,
          botToken: config.botToken,
          _userId: config._userId,
          _externalId: config._externalId,
        } as any);

      default:
        throw new Error(`DiscordSource: Unknown mode '${this.mode}'`);
    }
  }

  /**
   * Fetches content items from Discord based on the selected mode
   * @returns Array of content items
   */
  async fetchItems(): Promise<ContentItem[]> {
    logger.info(`[DiscordSource] Fetching items in '${this.mode}' mode`);
    const delegate = this.getDelegate();
    return delegate.fetchItems();
  }

  /**
   * Fetches historical content from a specific date
   * @param date - ISO date string
   * @returns Array of historical content items
   */
  async fetchHistorical(date: string): Promise<ContentItem[]> {
    logger.info(`[DiscordSource] Fetching historical data for ${date} in '${this.mode}' mode`);
    const delegate = this.getDelegate();
    if (delegate.fetchHistorical) {
      return delegate.fetchHistorical(date);
    }
    // Fall back to regular fetch if historical not supported
    return delegate.fetchItems();
  }

  /**
   * Connects to Discord (initializes the delegate's connection if applicable)
   */
  async connect(): Promise<void> {
    const delegate = this.getDelegate();
    if ('connect' in delegate && typeof (delegate as any).connect === 'function') {
      return (delegate as any).connect();
    }
  }

  /**
   * Disconnects from Discord (cleans up the delegate's connection if applicable)
   */
  async disconnect(): Promise<void> {
    const delegate = this.getDelegate();
    if ('disconnect' in delegate && typeof (delegate as any).disconnect === 'function') {
      return (delegate as any).disconnect();
    }
  }
}
