// src/types.ts

import { z } from 'zod';
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
  embedding?: number[];  // Vector embedding for semantic search (1536 dimensions for text-embedding-3-small)
}

/**
 * Represents a summary of multiple content items.
 * Used for generating daily or topic-based summaries.
 */
export interface SummaryItem {
  id?: number;          // Will be assigned by storage if not provided
  type: string;          // e.g. "dailySummary", "discordChannelSummary", "weeklySummary"
  title?: string;        // optional title for the summary
  categories?: string;   // main content (JSON string for structured summaries)
  markdown?: string;     // Optional Markdown version of the summary
  date?: number;         // When it was created/published (epoch seconds)
  contentHash?: string;  // SHA-256 hash of source content used to generate this summary
  startDate?: number;    // Epoch seconds — for range summaries, the start of the range
  endDate?: number;      // Epoch seconds — for range summaries, the end of the range
  granularity?: SummaryGranularity; // What time period this summary covers
  metadata?: Record<string, any>;   // Flexible metadata (highlights, trends, contributors, etc.)
  tokensUsed?: number;   // Actual tokens consumed to generate this summary
  estimatedCostUsd?: number; // Estimated cost of generation in USD
}

/**
 * Time granularity for generated summaries.
 */
export type SummaryGranularity = 'daily' | 'weekly' | 'monthly' | 'custom';

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
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalAiCalls?: number;
    estimatedCostUsd?: number;
  };
}

/**
 * Represents an aggregation job with a unique ID
 */
export interface JobStatus {
  jobId: string;
  configName: string;
  startTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number; // 0-100
  error?: string;
  result?: any;
  /** Reason for cancellation (e.g. 'license_expired') — helps frontend show targeted messaging */
  cancelReason?: string;
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
      totalPromptTokens?: number;
      totalCompletionTokens?: number;
      totalAiCalls?: number;
      estimatedCostUsd?: number;
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

// ============================================
// GENERATOR PLUGIN TYPES
// ============================================

/**
 * Interface that any generator plugin must implement.
 * 
 * Generators are read + transform: they read content from storage, process it
 * (typically via AI), and return results. They do NOT write to storage or filesystem —
 * the caller handles all persistence.
 */
export interface GeneratorPlugin {
  /** Unique name for this generator instance */
  name: string;
  /** The summaryType this generator produces (used for DB lookups and chaining) */
  readonly outputType: string;
  /** Whether this generator can accept upstream generator output as input */
  readonly supportsChaining?: boolean;

  /**
   * Generate summaries for a single date.
   * Reads from this.storage, calls AI provider, returns results.
   * Does NOT save to storage or write files — caller handles persistence.
   */
  generate(dateStr: string, context?: GeneratorContext): Promise<GeneratorResult>;

  /**
   * Generate summaries for an arbitrary date range.
   * Only implemented by generators that support multi-day summarization.
   */
  generateForRange?(
    startDate: string,
    endDate: string,
    options?: RangeGeneratorOptions
  ): Promise<GeneratorResult>;
}

/**
 * Context passed to a generator by the caller.
 * Enables chaining (upstream results), budget enforcement, and force-regeneration.
 */
export interface GeneratorContext {
  /** SummaryItems from upstream generators in the chain (dependsOn) */
  upstreamSummaries?: SummaryItem[];
  /** Force regeneration even if content hash is unchanged */
  force?: boolean;
  /** Maximum tokens this generation may consume (enforced by AI provider) */
  tokenBudget?: number;
}

/**
 * Result returned by a generator after processing.
 * Contains everything needed for the caller to persist and track the generation.
 */
export interface GeneratorResult {
  /** Whether the generation completed successfully */
  success: boolean;
  /** Generated summaries — caller saves these to storage */
  summaryItems: SummaryItem[];
  /** Suggested file outputs — caller writes these to disk if file output is enabled */
  fileOutputs?: FileOutput[];
  /** True if generation was skipped (e.g., content hash unchanged) */
  skipped?: boolean;
  /** Error message if generation failed */
  error?: string;
  /** Statistics about the generation run */
  stats?: GeneratorStats;
}

/**
 * Statistics collected during a generation run.
 */
export interface GeneratorStats {
  /** Number of content items processed */
  itemsProcessed: number;
  /** Total tokens consumed across all AI calls */
  tokensUsed: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

/**
 * A file output suggested by a generator.
 * The caller decides whether and where to write it.
 */
export interface FileOutput {
  /** Relative path from the output directory (e.g., "json/2026-01-15.json") */
  relativePath: string;
  /** File content as a string */
  content: string;
  /** File format */
  format: 'json' | 'md';
}

/**
 * Options for range-based generation (multi-day summaries).
 */
export interface RangeGeneratorOptions {
  /**
   * How to source the input data:
   * - 'daily_summaries': Re-summarize existing daily SummaryItems (cheap, fast)
   * - 'raw_content': Process all raw ContentItems across the range (expensive, thorough)
   * - 'hybrid': Daily summaries as base + raw items for key topics (balanced)
   */
  dataStrategy: 'daily_summaries' | 'raw_content' | 'hybrid';
  /** For hybrid mode: max raw content items to pull for deep-dive topics */
  hybridRawItemLimit?: number;
  /** Force regeneration even if content hash is unchanged */
  force?: boolean;
  /** Human-readable label for the summary (e.g., "Week 3 January 2026") */
  label?: string;
  /** Maximum tokens this generation may consume */
  tokenBudget?: number;
}

// ============================================
// EXPORTER PLUGIN TYPES
// ============================================

/**
 * Interface for exporter plugins.
 * 
 * Exporters write raw data to the filesystem without AI processing.
 * Unlike generators, they handle their own file I/O and don't produce SummaryItems.
 */
export interface ExporterPlugin {
  /** Unique name for this exporter instance */
  name: string;

  /**
   * Export data for a single date.
   * Reads from storage, writes to filesystem.
   */
  export(dateStr: string): Promise<ExporterResult>;

  /**
   * Export data for a date range.
   */
  exportRange?(startDate: string, endDate: string): Promise<ExporterResult>;
}

/**
 * Result returned by an exporter after processing.
 */
export interface ExporterResult {
  /** Whether the export completed successfully */
  success: boolean;
  /** Number of files written to disk */
  filesWritten: number;
  /** Error message if export failed */
  error?: string;
}

// ============================================
// GENERATOR CONFIGURATION TYPES
// ============================================

/**
 * Configuration item for generators (extends ConfigItem with dependsOn).
 */
export interface GeneratorConfigItem extends ConfigItem {
  /**
   * Name of another generator that must run before this one.
   * Enables generator chaining — this generator can access the upstream
   * generator's output via GeneratorContext.upstreamSummaries.
   */
  dependsOn?: string;
}

/**
 * Runtime config for a generator instance.
 */
export interface GeneratorInstanceConfig {
  instance: GeneratorPlugin;
  interval?: number;
  dependsOn?: string;
}

/**
 * Runtime config for an exporter instance.
 */
export interface ExporterInstanceConfig {
  instance: ExporterPlugin;
  interval?: number;
}

/**
 * Error thrown when a generation exceeds its token budget.
 * The AI provider throws this mid-generation so generators can
 * catch it and return partial results.
 */
export class BudgetExhaustedError extends Error {
  constructor(
    public readonly usage: AiUsageStats,
    public readonly budget: number,
  ) {
    super(`Token budget exceeded: ${usage.totalTokens} tokens used, budget was ${budget}`);
    this.name = 'BudgetExhaustedError';
  }
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
 * Tracks cumulative token usage and estimated cost for AI API calls.
 */
export interface AiUsageStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  estimatedCostUsd: number;
}

/**
 * Options for AI summarization calls.
 * Allows callers to specify system prompts, temperature overrides, and JSON output mode.
 * Based on prompt engineering research recommending separation of system instructions
 * from user content, and task-specific temperature tuning.
 */
export interface SummarizeOptions {
  /** System-level instructions separated from user content for better instruction following */
  systemPrompt?: string;
  /** Override the default temperature for this call (e.g., 0.3 for factual, 0.7 for creative) */
  temperature?: number;
  /** Request JSON output mode from the model when supported */
  jsonMode?: boolean;
}

/**
 * Interface for AI providers that can process text.
 * Defines core AI capabilities used throughout the system.
 */
export interface AiProvider {
  summarize(text: string, options?: SummarizeOptions): Promise<string>;
  topics(text: string): Promise<string[]>;
  image(text: string, options?: ImageGenerationOptions): Promise<string[]>;
  /** Generate vector embeddings for one or more texts. Returns one embedding array per input text. */
  embed(texts: string[], model?: string): Promise<number[][]>;
  /** Get the model's maximum context length in tokens (0 if unknown) */
  getContextLength(): number;
  /** Get cumulative token usage and cost stats since last reset */
  getUsageStats(): AiUsageStats;
  /** Reset cumulative usage stats to zero */
  resetUsageStats(): void;
  /** Set a token budget for this provider. Throws BudgetExhaustedError if exceeded mid-call. */
  setTokenBudget?(budget: number): void;
  /** Clear the token budget (no limit). */
  clearTokenBudget?(): void;
  /** Get remaining tokens in the budget, or null if no budget is set. */
  getRemainingBudget?(): number | null;
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
 * Generic configuration for component instances at runtime.
 * Used for sources, enrichers, and other non-generator plugins.
 * For generators and exporters, use GeneratorInstanceConfig and ExporterInstanceConfig.
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

// ============================================
// MULTI-TENANT PLATFORM TYPES
// ============================================

/**
 * User tier levels
 */
export type UserTier = 'free' | 'paid' | 'admin';

/**
 * Config visibility options
 */
export type ConfigVisibility = 'public' | 'private' | 'shared' | 'unlisted';

/**
 * Config storage type
 */
export type ConfigStorageType = 'platform' | 'external';

/**
 * Config status
 */
export type ConfigStatus = 'idle' | 'running' | 'error' | 'paused';

/**
 * Platform user
 */
export interface PlatformUser {
  id: string;
  privyId: string;
  email?: string;
  walletAddress?: string;
  tier: UserTier;
  settings?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform config (data pipeline)
 */
export interface PlatformConfig {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: ConfigVisibility;
  storageType: ConfigStorageType;
  externalDbUrl?: string;
  externalDbValid?: boolean;
  monetizationEnabled: boolean;
  pricePerQuery?: number;
  ownerWallet?: string;
  configJson: Record<string, any>;
  status: ConfigStatus;
  lastRunAt?: Date;
  lastError?: string;
  runsToday: number;
  totalItems: number;
  totalQueries: number;
  totalRevenue: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Payment record
 */
export interface Payment {
  id: string;
  configId: string;
  payerWallet: string;
  amount: number;
  platformFee: number;
  ownerRevenue: number;
  txSignature?: string;
  status: 'pending' | 'verified' | 'settled' | 'failed';
  createdAt: Date;
  settledAt?: Date;
}

/**
 * API usage record
 */
export interface ApiUsage {
  id: string;
  configId: string;
  userId?: string;
  walletAddress?: string;
  endpoint: string;
  method: string;
  statusCode?: number;
  responseTimeMs?: number;
  paymentId?: string;
  createdAt: Date;
}

/**
 * Content item with embedding
 */
export interface ContentItemWithEmbedding extends ContentItem {
  embedding?: number[];
}

/**
 * Summary item with embedding
 */
export interface SummaryItemWithEmbedding extends SummaryItem {
  embedding?: number[];
}

/**
 * Vector search result
 */
export interface VectorSearchResult extends ContentItem {
  similarity: number;
}

/**
 * PostgreSQL storage configuration
 */
export interface PostgresStorageConfig {
  name: string;
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  poolSize?: number;
  configId?: string;
}

// ============================================
// DISCORD MULTI-TENANT TYPES
// ============================================

/**
 * Discord channel types (from Discord API)
 * @see https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
export enum DiscordChannelType {
  GUILD_TEXT = 0,
  DM = 1,
  GUILD_VOICE = 2,
  GROUP_DM = 3,
  GUILD_CATEGORY = 4,
  GUILD_ANNOUNCEMENT = 5,
  ANNOUNCEMENT_THREAD = 10,
  PUBLIC_THREAD = 11,
  PRIVATE_THREAD = 12,
  GUILD_STAGE_VOICE = 13,
  GUILD_DIRECTORY = 14,
  GUILD_FORUM = 15,
  GUILD_MEDIA = 16,
}

/**
 * Discord guild connection - tracks which user added bot to which guild
 */
export interface DiscordGuildConnection {
  id: string;
  userId: string;
  guildId: string;
  guildName: string;
  guildIcon?: string;
  botPermissions: number;
  addedAt: Date;
  isActive: boolean;
  lastVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Discord guild channel - cached channel info for connected guilds
 */
export interface DiscordGuildChannel {
  id: string;
  guildConnectionId: string;
  channelId: string;
  channelName: string;
  channelType: DiscordChannelType;
  categoryId?: string;
  categoryName?: string;
  position: number;
  isAccessible: boolean;
  lastSyncedAt: Date;
}

/**
 * Discord OAuth state - for CSRF protection during OAuth flow
 */
export interface DiscordOAuthState {
  id: string;
  userId: string;
  state: string;
  redirectUrl?: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Discord OAuth callback data from Discord's redirect
 */
export interface DiscordOAuthCallbackData {
  code: string;
  state: string;
  guildId: string;
  permissions?: string;
}

/**
 * Discord OAuth token response
 */
export interface DiscordOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  guild?: {
    id: string;
    name: string;
    icon?: string;
    owner_id: string;
    permissions: string;
  };
}

/**
 * Discord API user response
 */
export interface DiscordApiUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
  email?: string;
}

/**
 * Discord API guild response
 */
export interface DiscordApiGuild {
  id: string;
  name: string;
  icon?: string;
  owner_id: string;
  permissions?: string;
  features: string[];
}

/**
 * Discord API channel response
 */
export interface DiscordApiChannel {
  id: string;
  type: number;
  guild_id?: string;
  position?: number;
  name?: string;
  topic?: string;
  parent_id?: string;
  permission_overwrites?: Array<{
    id: string;
    type: number;
    allow: string;
    deny: string;
  }>;
}

/**
 * Platform mode source config (generic)
 * Used when running on the multi-tenant platform with external connections
 * Works for Discord, Telegram, Slack, etc.
 */
export interface PlatformSourceConfig {
  name: string;
  connectionId: string;           // Reference to external_connections.id
  channelIds: string[];           // Selected channel/resource IDs
  storage: StoragePlugin;
  mediaDownload?: MediaDownloadConfig;
  // Injected at runtime by platform
  _userId?: string;
  _platform?: string;             // 'discord', 'telegram', 'slack'
  _externalId?: string;           // guild_id, chat_id, workspace_id
}

/**
 * Legacy alias for backward compatibility
 * @deprecated Use PlatformSourceConfig instead
 */
export type PlatformDiscordSourceConfig = PlatformSourceConfig;

/**
 * Combined Discord source config (supports both modes)
 */
export type UnifiedDiscordSourceConfig = DiscordRawDataSourceConfig | PlatformSourceConfig;

/**
 * Check if config is platform mode (generic)
 */
export function isPlatformSourceConfig(config: any): config is PlatformSourceConfig {
  return 'connectionId' in config;
}

/**
 * Legacy alias for backward compatibility
 * @deprecated Use isPlatformSourceConfig instead
 */
export function isPlatformDiscordConfig(config: UnifiedDiscordSourceConfig): config is PlatformSourceConfig {
  return isPlatformSourceConfig(config);
}

/**
 * Discord guild connection with channels (for API responses)
 */
export interface DiscordGuildConnectionWithChannels extends DiscordGuildConnection {
  channels: DiscordGuildChannel[];
}

/**
 * Create guild connection request
 */
export interface CreateGuildConnectionRequest {
  code: string;
  state: string;
  guildId: string;
  permissions?: number;
}

/**
 * Guild connection API response
 */
export interface GuildConnectionResponse {
  id: string;
  guildId: string;
  guildName: string;
  guildIcon?: string;
  isActive: boolean;
  addedAt: string;
  channelCount?: number;
}

// ============================================
// SITE PARSER TYPES (for cached HTML parsers)
// ============================================

/**
 * Represents a cached site parser generated by an LLM.
 * Parsers are JavaScript function bodies that run in a sandboxed vm context
 * with a cheerio-loaded document ($) to extract structured data from HTML.
 * 
 * Keyed by domain + path pattern + optional objectTypeString.
 */
export interface SiteParser {
  id?: number;
  /** Domain the parser targets, e.g. "example.com" */
  domain: string;
  /** Glob-style path pattern, e.g. "/blog/*" or "/*" */
  pathPattern: string;
  /** JavaScript function body string. Executed as: new Function('$', parserCode) */
  parserCode: string;
  /** TypeScript interface the parser was generated for (nullable — same site may need different parsers for different schemas) */
  objectTypeString?: string;
  /** Incremented each time the parser is regenerated */
  version: number;
  /** Number of consecutive validation failures since last success */
  consecutiveFailures: number;
  /** Epoch seconds of last successful parse */
  lastSuccessAt?: number;
  /** Epoch seconds of last validation failure */
  lastFailureAt?: number;
  /** Epoch seconds when first created */
  createdAt: number;
  /** Epoch seconds when last modified */
  updatedAt: number;
  /** The URL used to generate this parser (for debugging) */
  sampleUrl?: string;
  /** Extra info: field names, generation model, etc. */
  metadata?: Record<string, any>;
}

// ============================================
// GITHUB API TYPES (Zod Schemas)
// ============================================

/**
 * GitHub user schema for API responses
 */
export const GitHubUserSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().optional(),
});

/**
 * GitHub label schema
 */
export const GitHubLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable().optional(),
});

/**
 * GitHub reaction schema
 */
export const GitHubReactionSchema = z.object({
  id: z.string(),
  content: z.string(), // THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED, HEART, ROCKET, EYES
  createdAt: z.string(),
  user: GitHubUserSchema.nullable().optional(),
});

// ============================================
// Pull Request Schemas
// ============================================

/**
 * GitHub PR file change schema
 */
export const GitHubPRFileSchema = z.object({
  path: z.string(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changeType: z.string().optional(), // ADDED, DELETED, MODIFIED, RENAMED, COPIED
});

/**
 * GitHub PR review schema
 */
export const GitHubPRReviewSchema = z.object({
  id: z.string(),
  state: z.string(), // APPROVED, CHANGES_REQUESTED, COMMENTED, PENDING, DISMISSED
  body: z.string().nullable().default(''),
  createdAt: z.string(),
  submittedAt: z.string().optional(),
  author: GitHubUserSchema.nullable().optional(),
  url: z.string().optional(),
});

/**
 * GitHub PR comment schema
 */
export const GitHubPRCommentSchema = z.object({
  id: z.string(),
  body: z.string().nullable().default(''),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  author: GitHubUserSchema.nullable().optional(),
  url: z.string().optional(),
  reactions: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubReactionSchema).default([]),
  }).optional(),
});

/**
 * GitHub commit within a PR schema
 */
export const GitHubCommitInPRSchema = z.object({
  commit: z.object({
    oid: z.string(),
    message: z.string(),
    messageHeadline: z.string().optional(),
    committedDate: z.string(),
    author: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      date: z.string().optional(),
      user: GitHubUserSchema.nullable().optional(),
    }).optional(),
    additions: z.number().default(0),
    deletions: z.number().default(0),
    changedFiles: z.number().default(0),
  }),
});

/**
 * GitHub closing issue reference schema
 */
export const GitHubClosingIssueSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
});

/**
 * Raw pull request schema from GitHub API
 */
export const RawPullRequestSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(''),
  state: z.string(), // OPEN, CLOSED, MERGED
  merged: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable().optional(),
  mergedAt: z.string().nullable().optional(),
  headRefOid: z.string().optional(),
  baseRefOid: z.string().optional(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changedFiles: z.number().default(0),
  author: GitHubUserSchema.nullable().optional(),
  labels: z.object({
    nodes: z.array(GitHubLabelSchema).default([]),
  }).optional(),
  commits: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubCommitInPRSchema).default([]),
  }).optional(),
  closingIssuesReferences: z.object({
    nodes: z.array(GitHubClosingIssueSchema).default([]),
  }).optional(),
  reactions: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubReactionSchema).default([]),
  }).optional(),
  reviews: z.object({
    nodes: z.array(GitHubPRReviewSchema).default([]),
  }).optional(),
  comments: z.object({
    nodes: z.array(GitHubPRCommentSchema).default([]),
  }).optional(),
  files: z.object({
    nodes: z.array(GitHubPRFileSchema).default([]),
  }).optional(),
});

// ============================================
// Issue Schemas
// ============================================

/**
 * GitHub issue comment schema
 */
export const GitHubIssueCommentSchema = z.object({
  id: z.string(),
  body: z.string().nullable().default(''),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  author: GitHubUserSchema.nullable().optional(),
  url: z.string().optional(),
  reactions: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubReactionSchema).default([]),
  }).optional(),
});

/**
 * Raw issue schema from GitHub API
 */
export const RawIssueSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().default(''),
  state: z.string(), // OPEN, CLOSED
  locked: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable().optional(),
  author: GitHubUserSchema.nullable().optional(),
  labels: z.object({
    nodes: z.array(GitHubLabelSchema).default([]),
  }).optional(),
  reactions: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubReactionSchema).default([]),
  }).optional(),
  comments: z.object({
    totalCount: z.number().default(0),
    nodes: z.array(GitHubIssueCommentSchema).default([]),
  }).optional(),
});

// ============================================
// Commit Schemas
// ============================================

/**
 * Raw commit schema from GitHub API
 */
export const RawCommitSchema = z.object({
  oid: z.string(),
  message: z.string(),
  messageHeadline: z.string().optional(),
  committedDate: z.string(),
  author: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    date: z.string().optional(),
    user: GitHubUserSchema.nullable().optional(),
  }).optional(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  changedFiles: z.number().default(0),
});

// ============================================
// Repository Schemas
// ============================================

/**
 * GitHub repository schema
 */
export const GitHubRepositorySchema = z.object({
  id: z.number(),
  nodeId: z.string().optional(),
  name: z.string(),
  fullName: z.string(),
  private: z.boolean(),
  owner: z.object({
    login: z.string(),
    id: z.number().optional(),
  }),
  htmlUrl: z.string(),
  description: z.string().nullable().optional(),
  fork: z.boolean().optional(),
  url: z.string().optional(),
  defaultBranch: z.string().optional(),
  stargazersCount: z.number().optional(),
  forksCount: z.number().optional(),
  language: z.string().nullable().optional(),
  pushedAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

// ============================================
// User Schemas (for OAuth)
// ============================================

/**
 * GitHub authenticated user schema
 */
export const GitHubAuthenticatedUserSchema = z.object({
  login: z.string(),
  id: z.number(),
  nodeId: z.string().optional(),
  avatarUrl: z.string(),
  gravatarId: z.string().nullable().optional(),
  url: z.string(),
  htmlUrl: z.string(),
  name: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  hireable: z.boolean().nullable().optional(),
  bio: z.string().nullable().optional(),
  twitterUsername: z.string().nullable().optional(),
  publicRepos: z.number(),
  publicGists: z.number(),
  followers: z.number(),
  following: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ============================================
// Inferred Types from Schemas
// ============================================

export type RawPullRequest = z.infer<typeof RawPullRequestSchema>;
export type RawIssue = z.infer<typeof RawIssueSchema>;
export type RawCommit = z.infer<typeof RawCommitSchema>;
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;
export type GitHubAuthenticatedUser = z.infer<typeof GitHubAuthenticatedUserSchema>;
export type GitHubPRReview = z.infer<typeof GitHubPRReviewSchema>;
export type GitHubPRComment = z.infer<typeof GitHubPRCommentSchema>;
export type GitHubIssueComment = z.infer<typeof GitHubIssueCommentSchema>;
export type GitHubLabel = z.infer<typeof GitHubLabelSchema>;
export type GitHubPRFile = z.infer<typeof GitHubPRFileSchema>;

// ============================================
// GitHub Activity Types (for daily activity tracking)
// ============================================

/**
 * Comment on an issue or PR (conversation comment, not inline code review)
 */
export interface RawComment {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author?: { login: string; avatarUrl?: string };
  issueNumber: number;
  issueTitle?: string;
  isPullRequest: boolean;
  htmlUrl: string;
}

/**
 * Inline code review comment on a PR
 */
export interface RawReviewComment {
  id: string;
  body: string;
  path: string;
  line?: number;
  side?: string;
  createdAt: string;
  author?: { login: string; avatarUrl?: string };
  prNumber: number;
  prTitle?: string;
  htmlUrl: string;
  diffHunk?: string;
  inReplyToId?: string;
}

/**
 * PR review submission (approve/request changes/comment)
 */
export interface RawReviewSubmission {
  id: string;
  body?: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: string;
  author?: { login: string; avatarUrl?: string };
  prNumber: number;
  prTitle?: string;
  htmlUrl: string;
}

/**
 * Minimal info for a merged PR (when tracking merges on old PRs)
 */
export interface MergedPRInfo {
  number: number;
  title: string;
  author: string;
  mergedAt: string;
  mergedBy?: string;
  htmlUrl: string;
}

/**
 * Minimal info for a closed issue (when tracking closes on old issues)
 */
export interface ClosedIssueInfo {
  number: number;
  title: string;
  author: string;
  closedAt: string;
  htmlUrl: string;
  stateReason?: 'completed' | 'not_planned' | 'reopened' | null;
}

/**
 * Activity types configuration for GitHubSource
 */
export interface GitHubActivityTypes {
  newPRs?: boolean;           // PRs created today (default: true)
  newIssues?: boolean;        // Issues created today (default: true)
  commits?: boolean;          // Commits today (default: true)
  comments?: boolean;         // Comments on any PR/issue today (default: true)
  reviews?: boolean;          // PR reviews submitted today (default: true)
  reviewComments?: boolean;   // Inline code review comments today (default: true)
  mergedPRs?: boolean;        // PRs merged today (default: true)
  closedIssues?: boolean;     // Issues closed today (default: true)
}

// ============================================
// GitHub Fetch Options
// ============================================

/**
 * Options for fetching GitHub data
 */
export interface FetchOptions {
  /** Start date for filtering (ISO string or Date) */
  since?: string | Date;
  /** End date for filtering (ISO string or Date) */
  until?: string | Date;
  /** Maximum number of items to fetch (for pagination limits) */
  limit?: number;
}

// ============================================
// GraphQL Response Types
// ============================================

/**
 * GitHub GraphQL pagination info
 */
export interface GitHubPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * GitHub GraphQL search response wrapper
 */
export interface GitHubSearchResponse<T> {
  search: {
    nodes: T[];
    pageInfo: GitHubPageInfo;
  };
}

/**
 * GitHub GraphQL repository response wrapper
 */
export interface GitHubRepositoryResponse<T> {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          nodes: T[];
          pageInfo: GitHubPageInfo;
        };
      };
    };
  };
}

/**
 * GitHub GraphQL response with optional errors
 */
export type GitHubGraphQLResponse<T> = {
  data: GitHubSearchResponse<T> | GitHubRepositoryResponse<T>;
  errors?: Array<{ message: string; type?: string }>;
};

// ============================================
// GitHub Stats Types
// ============================================

/**
 * Statistics for a single contributor
 */
export interface ContributorStats {
  username: string;
  avatarUrl?: string;
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
  reviews: number;
  comments: number;
  additions: number;
  deletions: number;
}

/**
 * Daily statistics for a repository
 */
export interface DailyStats {
  date: string;
  repository: string;
  prsOpened: number;
  prsMerged: number;
  prsClosed: number;
  issuesOpened: number;
  issuesClosed: number;
  commits: number;
  activeContributors: string[];
  contributors: ContributorStats[];
}
