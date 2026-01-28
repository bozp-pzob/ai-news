// src/types.ts

import { StoragePlugin } from "./plugins/storage/StoragePlugin";

/**
 * Represents a normalized article object in the system.
 */
export interface ContentItem {
  id?: number;          // Will be assigned by storage if not provided
  cid: string;          // Content Id from the source
  type: string;          // e.g. "tweet", "newsArticle", "discordMessage", "githubIssue"
  source: string;        // e.g. "twitter", "bbc-rss", "discord", "github"
  title?: string;        // optional – for articles, maybe a tweet "title" is same as text
  text?: string;         // main text content (tweet text, article abstract, etc.)
  link?: string;         // URL to the item
  topics?: string[];
  date?: number;           // When it was created/published
  metadata?: Record<string, any>; // Additional key-value data
}

/**
 * Represents a summary of multiple content items.
 * Used for generating daily or topic-based summaries.
 */
export interface SummaryItem {
  id?: number;          // Will be assigned by storage if not provided
  type: string;          // e.g. "tweet", "newsArticle", "discordMessage", "githubIssue"
  title?: string;        // optional – for articles, maybe a tweet "title" is same as text
  categories?: string;   // main content (JSON string for structured summaries)
  markdown?: string;     // Optional Markdown version of the summary
  date?: number;         // When it was created/published (epoch seconds)
}

/**
 * Represents the detailed status of an aggregation process
 */
export interface AggregationStatus {
  status: 'running' | 'stopped';
  currentSource?: string;
  currentPhase?: 'fetching' | 'enriching' | 'generating' | 'idle' | 'connecting' | 'waiting';
  lastUpdated?: number;
  errors?: Array<{
    message: string;
    source?: string;
    timestamp: number;
  }>;
  stats?: {
    totalItemsFetched?: number;
    itemsPerSource?: Record<string, number>;
    lastFetchTimes?: Record<string, number>;
  };
}

/**
 * Represents an aggregation job with a unique ID
 */
export interface JobStatus {
  jobId: string;
  configName: string;
  startTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number; // 0-100
  error?: string;
  result?: any;
  intervals?: NodeJS.Timeout[]; // Array of interval IDs for cleanup when stopping
  aggregationStatus?: {
    currentSource?: string;
    currentPhase?: 'fetching' | 'enriching' | 'generating' | 'idle' | 'connecting' | 'waiting';
    mode?: 'standard' | 'historical';
    config?: any;
    filter?: any;
    errors?: Array<{
      message: string;
      source?: string;
      timestamp: number;
    }>;
    stats?: {
      totalItemsFetched?: number;
      itemsPerSource?: Record<string, number>;
      lastFetchTimes?: Record<string, number>;
    };
  };
}
  
/**
 * An interface that any source plugin must implement.
 */
export interface SourcePlugin {
  name: string;
  fetchArticles(): Promise<ContentItem[]>;
}

/**
 * An interface for any enricher plugin.
 * The enrich() method should transform or annotate a list of articles.
 */
export interface EnricherPlugin {
  enrich(articles: ContentItem[]): ContentItem[] | Promise<ContentItem[]>;
}

/**
 * Configuration for AI-based enrichers.
 * Defines settings for AI-powered content enrichment.
 */
export interface AiEnricherConfig {
  provider: AiProvider;       // The chosen AI provider
  maxTokens?: number;         // If you want a limit, e.g. chunk large texts
  thresholdLength?: number;   // Only summarize if content is above a certain length
}

/**
 * Configuration for AI image generation.
 */
export interface ImageGenerationConfig {
  model?: string;
  promptTemplates?: Record<string, string[]>;
  defaultPrompts?: string[];
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
  uploadToCDN?: boolean;
  cdnPath?: string;
}

/**
 * Options for a single image generation request.
 */
export interface ImageGenerationOptions {
  category?: string;
  referenceImages?: string[];
  aspectRatio?: string;
  imageSize?: '1K' | '2K' | '4K';
}

/**
 * Interface for AI providers that can process text.
 * Defines core AI capabilities used throughout the system.
 */
export interface AiProvider {
  summarize(text: string): Promise<string>;
  topics(text: string): Promise<string[]>;
  image(text: string, options?: ImageGenerationOptions): Promise<string[]>;
}

/**
 * Configuration item for plugins and components.
 * Used to define and configure various system components.
 */
export interface ConfigItem {
  type: string;
  name: string;
  params: Record<string, any>;
  interval?: number;
  mediaDownload?: MediaDownloadConfig;
}

/**
 * Configuration for component instances at runtime.
 * Used to manage component instances and their execution schedules.
 */
export interface InstanceConfig {
  instance: any;
  interval?: number;
}

/**
 * Configuration for storage plugins.
 * Used to configure how content is persisted.
 */
export interface StorageConfig {
  name: string;
  dbPath: string;
}

/**
 * Configuration for date-based filtering.
 * Used to specify date ranges or specific dates for content filtering.
 */
export interface DateConfig {
  filterType: 'before' | 'after' | 'during';
  date?: string;
  after?: string;
  before?: string;
}

/**
 * Configuration for output paths.
 * Used to specify where generated content should be saved.
 */
export interface OutputConfig {
  path: string;  // Directory path for output files
}

/**
 * Interface for Discord raw data structure
 * @interface DiscordRawData
 */
export interface DiscordRawData {
  channel: {
    id: string;
    name: string;
    topic: string | null;
    category: string | null;
  };
  date: string;
  users: {
    [userId: string]: {
      name: string;
      nickname: string | null;
      roles?: string[];
      isBot?: boolean;
    };
  };
  messages: {
    id: string;
    ts: string;
    uid: string;
    content: string;
    type?: string;
    mentions?: string[];
    ref?: string;
    edited?: string;
    reactions?: {
      emoji: string;
      count: number;
    }[];
    attachments?: DiscordAttachment[];
    embeds?: DiscordEmbed[];
    sticker_items?: DiscordSticker[];
    threadName?: string; // For forum channel messages - indicates which thread the message came from
  }[];
}

/**
 * Interface for Discord attachment objects
 * Based on Discord API message attachment structure
 */
export interface DiscordAttachment {
  id: string;
  filename: string;
  title?: string;
  description?: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url?: string;  // Optional - may not always be present
  height?: number;
  width?: number;
  duration_secs?: number;
  waveform?: string;
  ephemeral?: boolean;
  flags?: number;
}

/**
 * Interface for Discord embed objects
 * Based on Discord API message embed structure
 */
export interface DiscordEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  image?: {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  thumbnail?: {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  video?: {
    url?: string;
    proxy_url?: string;
    height?: number;
    width?: number;
  };
  author?: {
    name?: string;
    url?: string;
    icon_url?: string;
  };
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}

/**
 * Interface for Discord sticker objects
 * Based on Discord API sticker item structure
 */
export interface DiscordSticker {
  id: string;
  name: string;
  format_type: number;
  description?: string;
}

/**
 * Configuration interface for media downloads
 * @interface MediaDownloadConfig
 */
export interface MediaDownloadConfig {
  enabled: boolean;
  outputPath?: string;
  maxFileSize?: number; // in bytes, default 50MB
  allowedTypes?: string[]; // MIME types or extensions
  excludedTypes?: string[];
  rateLimit?: number; // milliseconds between downloads, default 100
  retryAttempts?: number; // default 3
  organizeBy?: 'flat' | 'server' | 'channel'; // folder organization mode (default: 'flat')
}

/**
 * Configuration interface for DiscordRawDataSource
 * @interface DiscordRawDataSourceConfig
 * @property {string} name - The name identifier for this Discord source
 * @property {string} botToken - Discord bot token for authentication
 * @property {string[]} channelIds - Array of Discord channel IDs to monitor
 * @property {string} guildId - Discord guild/server ID
 * @property {MediaDownloadConfig} mediaDownload - Optional media download configuration
 */
export interface DiscordRawDataSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
  guildId: string;
  storage: StoragePlugin;
  mediaDownload?: MediaDownloadConfig;
}

/**
 * Interface for time-based message blocks
 * @interface TimeBlock
 */
export interface TimeBlock {
  startTime: Date;
  endTime: Date;
  messages: DiscordRawData['messages'];
  users: DiscordRawData['users'];
}

/**
 * Interface for Discord Summaries
 * @interface DiscordSummary
 */
export interface DiscordSummary {
  channelId?: string;
  channelName: string;
  guildName: string;
  summary: string;
  faqs: SummaryFaqs[];
  helpInteractions: HelpInteractions[];
  actionItems: ActionItems[];
}


/**
 * Interface for SummaryFaqs for Discord sumamries
 * @interface SummaryFaqs
 */
export interface SummaryFaqs {
  question: string;
  askedBy: string;
  answeredBy: string;
}

/**
 * Interface for HelpInteractions for Discord sumamries
 * @interface HelpInteractions
 */
export interface HelpInteractions {
  helper: string;
  helpee: string;
  context: string;
  resolution: string;
}

/**
 * Interface for ActionItems for Discord sumamries
 * @interface ActionItems
 */
export interface ActionItems { 
  type: 'Technical' | 'Documentation' | 'Feature';
  description: string;
  mentionedBy: string;
}

/**
 * Interface for media download items
 * Used by download-media.ts and mediaHelper.ts
 * Note: Extended fields (channelId, guildId, userId, originalData) are optional
 * for compatibility with mediaHelper, but download-media.ts always provides them
 * @interface MediaDownloadItem
 */
export interface MediaDownloadItem {
  url: string;
  filename: string;
  messageId: string;
  messageDate: string;
  channelId?: string;
  channelName: string;
  guildId?: string;
  guildName: string;
  userId?: string;
  mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
  // Extended fields - optional for mediaHelper compatibility
  originalData?: DiscordAttachment | DiscordEmbed | DiscordSticker;
  contentType?: string;
  messageContent?: string;
  reactions?: Array<{ emoji: string; count: number }>;
}

/**
 * Analytics for media downloads
 * @interface MediaAnalytics
 */
export interface MediaAnalytics {
  totalFilesByType: Record<string, number>;
  averageFileSizeByType: Record<string, number>;
  totalSizeByType: Record<string, number>;
  largestFilesByType: Record<string, Array<{ filename: string; size: number; url: string }>>;
}

/**
 * Statistics for media download operations
 * @interface DownloadStats
 */
export interface DownloadStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  filtered: number;
  errors: string[];
  analytics?: MediaAnalytics;
}

/**
 * Entry in the media manifest for VPS download
 * @interface MediaManifestEntry
 */
export interface MediaManifestEntry {
  // Core identifiers
  url: string;
  proxy_url?: string;
  filename: string;
  unique_name: string;
  hash: string;

  // File metadata
  type: 'image' | 'video' | 'audio' | 'document';
  is_spoiler?: boolean;
  is_animated?: boolean;
  media_type: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
  size?: number;
  content_type?: string;
  width?: number;
  height?: number;

  // Discord context
  message_id: string;
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
  user_id: string;
  timestamp: string;

  // Message context
  message_content?: string;
  reactions?: Array<{ emoji: string; count: number }>;

  // CDN upload fields (populated after upload)
  cdn_url?: string;
  cdn_path?: string;
  cdn_uploaded_at?: string;
}

/**
 * Media manifest file structure for VPS download
 * @interface MediaManifest
 */
export interface MediaManifest {
  date: string;
  source: string;
  generated_at: string;
  base_path: string;
  files: MediaManifestEntry[];
  stats: {
    total_files: number;
    by_type: Record<string, number>;
    total_size_bytes: number;
  };
  cdn?: {
    provider: string;
    base_url: string;
    uploaded_at: string;
    upload_stats: {
      total: number;
      uploaded: number;
      skipped: number;
      failed: number;
      removed?: number; // Number of failed entries removed from manifest
    };
  };
}

// =============================================================================
// CDN Upload Types
// =============================================================================

/**
 * Result of a CDN upload operation
 * @interface CDNUploadResult
 */
export interface CDNUploadResult {
  localPath: string;
  remotePath: string;
  cdnUrl: string;
  success: boolean;
  message: string;
  size?: number;
}

/**
 * Configuration for CDN providers
 * @interface CDNConfig
 */
export interface CDNConfig {
  provider: 'bunny' | 'ipfs';
  storageZone?: string;
  storageHost?: string;
  cdnUrl?: string;
  password?: string;
  dryRun?: boolean;
  maxFileSize?: number;
  /** Skip upload if file already exists on CDN (default: true) */
  skipExisting?: boolean;
}

/**
 * CDN Provider interface for upload operations
 * @interface CDNProvider
 */
export interface CDNProvider {
  name: string;
  upload(localPath: string, remotePath: string): Promise<CDNUploadResult>;
  getPublicUrl(remotePath: string): string;
}
