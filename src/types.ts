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
 * Interface for AI providers that can process text.
 * Defines core AI capabilities used throughout the system.
 */
export interface AiProvider {
  summarize(text: string): Promise<string>;
  topics(text: string): Promise<string[]>;
  image(text: string): Promise<string[]>;
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
  }[];
}

/**
 * Configuration interface for DiscordRawDataSource
 * @interface DiscordRawDataSourceConfig
 * @property {string} name - The name identifier for this Discord source
 * @property {string} botToken - Discord bot token for authentication
 * @property {string[]} channelIds - Array of Discord channel IDs to monitor
 * @property {string} guildId - Discord guild/server ID
 */
export interface DiscordRawDataSourceConfig {
  name: string;
  botToken: string;
  channelIds: string[];
  guildId: string;
  storage: StoragePlugin;
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
