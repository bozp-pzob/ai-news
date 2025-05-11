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
  metadata?: {
    // For all tweets (standard or original part of retweet)
    authorUserId?: string;       // User ID of the tweet's author (for standard tweets, or original author for retweets)
    authorUserName?: string;     // UserName of the tweet's author ( " )

    quotedTweet?: QuoteTweet;
    // Fields for retweets
    retweetedByTweetId?: string; // The ID of the retweet action itself
    retweetedByUserId?: string;  // User ID of the account that retweeted
    retweetedByUserName?: string;// UserName of the account that retweeted
    originalTweetId?: string;    // ID of the original tweet that was retweeted
    originalUserId?: string;     // User ID of the original tweet's author
    originalUserName?: string;   // UserName of the original tweet's author
    originalTweetTimestamp?: number; // Timestamp of the original tweet

    // Thread information
    thread?: {
      conversationId?: string; // ID of the root tweet of the conversation/thread
      isContinuation?: boolean; // True if this tweet is a reply in a thread by the same author
    };

    // Standard metadata fields that would apply to the original tweet if it's a retweet context
    photos?: any[]; 
    videos?: any[];
    likes?: number;
    replies?: number;
    retweets?: number; // Number of retweets the original tweet received
    isPin?: boolean;
    isReply?: boolean;
    isSelfThread?: boolean;
    hashtags?: string[];
    mentions?: any[]; // Assuming Mention might have a structure like { id: string, username?: string, name?: string }
    urls?: string[];
    sensitiveContent?: boolean;
    // Keep allowing other dynamic keys
    [key: string]: any;
  };
}

/**
 * Represents the data structure for a quoted tweet.
 */
export interface QuoteTweet {
  id?: string;
  text?: string;
  link?: string;
  userId?: string;
  userName?: string; // e.g., screen name of the original author
  // Add any other relevant fields from the quoted tweet you might want to store
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
