// src/types.ts

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

export interface SummaryItem {
  id?: number;          // Will be assigned by storage if not provided
  type: string;          // e.g. "tweet", "newsArticle", "discordMessage", "githubIssue"
  title?: string;        // optional – for articles, maybe a tweet "title" is same as text
  categories?: string;         // main content (tweet text, article abstract, etc.)
  markdown?: string;      //optional - Markdown version of main content
  date?: number;           // When it was created/published
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

  
export interface AiEnricherConfig {
  provider: AiProvider;       // The chosen AI provider
  maxTokens?: number;         // If you want a limit, e.g. chunk large texts
  thresholdLength?: number;   // Only summarize if content is above a certain length
}

export interface AiProvider {
  summarize(text: string): Promise<string>;
  topics(text: string): Promise<string[]>;
  image(text: string): Promise<string[]>;
}

export interface ConfigItem {
  type: string;
  name: string;
  params: Record<string, any>;
  interval?: number;
}

export interface InstanceConfig {
  instance: any;
  interval?: number;
}

export interface StorageConfig {
  name: string;
  dbPath: string;
}

export interface DateConfig {
  filterType: 'before' | 'after' | 'during';
  date?: string;
  after?: string;
  before?: string;
}

export interface OutputConfig {
  path: string;  // Directory path for output files
}
