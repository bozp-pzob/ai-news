/**
 * General-purpose web page scraper with BFS crawling.
 * 
 * Fetches and extracts content from web pages with optional link-following
 * from seed/index pages using CSS selectors. Supports AI-powered structured
 * extraction or plain readability-based content extraction.
 * 
 * Features:
 * - Auto-fallback fetching (node-fetch -> patchright for bot-protected sites)
 * - BFS crawling with configurable depth, CSS link selectors, and path filters
 * - Structured data extraction (JSON-LD, Open Graph) for free before AI
 * - RSS feed auto-discovery
 * - Per-source browser context isolation
 * - SSRF protection, URL normalization, rate limiting
 * 
 * @module plugins/sources/WebScraperSource
 */

import { ContentSource } from './ContentSource';
import { AiProvider, ContentItem } from '../../types';
import { StoragePlugin } from '../storage/StoragePlugin';
import { fetchHTML, BrowserManager, FetchHTMLOptions } from '../../helpers/patchrightHelper';
import {
  extractReadableContent,
  extractStructuredData,
  extractPageContent,
  extractLinks,
  discoverRSSFeeds,
  normalizeUrl,
  resolveUrl,
  isSameOrigin,
  matchesPathPattern,
} from '../../helpers/htmlHelper';
import crypto from 'crypto';

// ============================================
// CONFIGURATION
// ============================================

interface WebScraperSourceConfig {
  name: string;
  /** Seed URLs to scrape */
  urls: string[];
  /** Custom User-Agent string (used for node-fetch only; browser uses its real UA) */
  userAgent?: string;
  /** AI provider for structured extraction */
  provider?: AiProvider | string;
  /** TypeScript interface for AI to map data to */
  objectTypeString?: string;
  /** Topics to exclude from extraction */
  excludeTopics?: string;
  /** Storage plugin for caching generated HTML parsers */
  storage?: StoragePlugin | string;
  /** Enable link-following from seed pages (default: false) */
  crawlEnabled?: boolean;
  /** CSS selector for links to follow (default: "a") */
  crawlLinkSelector?: string;
  /** Max pages to scrape (default: 10) */
  crawlMaxPages?: number;
  /** Max link-following depth (default: 1) */
  crawlMaxDepth?: number;
  /** Only follow same-domain links (default: true) */
  crawlSameDomain?: boolean;
  /** Glob patterns for allowed URL paths */
  crawlAllowedPaths?: string[];
  /** Glob patterns for excluded URL paths */
  crawlExcludePaths?: string[];
  /** Delay between requests in ms (default: 1000) */
  crawlDelayMs?: number;
  /** Respect robots.txt (default: true) */
  crawlRespectRobotsTxt?: boolean;
}

// ============================================
// SOURCE PLUGIN
// ============================================

export class WebScraperSource implements ContentSource {
  public name: string;
  private urls: string[];
  private userAgent?: string;
  private provider?: AiProvider;
  private objectTypeString?: string;
  private excludeTopics?: string;
  /** Storage plugin for cached HTML parsers — exposed as public for injection by loadStorage() */
  public storage: StoragePlugin | string | undefined;

  // Crawl configuration
  private crawlEnabled: boolean;
  private crawlLinkSelector: string;
  private crawlMaxPages: number;
  private crawlMaxDepth: number;
  private crawlSameDomain: boolean;
  private crawlAllowedPaths?: string[];
  private crawlExcludePaths?: string[];
  private crawlDelayMs: number;
  private crawlRespectRobotsTxt: boolean;

  // robots.txt cache
  private robotsCache: Map<string, Set<string>> = new Map();

  static description = 'Fetches and extracts content from web pages with optional crawling';

  static constructorInterface = {
    parameters: [
      {
        name: 'urls',
        type: 'string[]',
        required: true,
        description: 'Seed URLs to scrape',
      },
      {
        name: 'userAgent',
        type: 'string',
        required: false,
        description: 'Custom User-Agent string (used for node-fetch only; browser uses its real UA)',
      },
      {
        name: 'provider',
        type: 'object',
        required: false,
        description: 'AI provider for structured content extraction',
      },
      {
        name: 'objectTypeString',
        type: 'string',
        required: false,
        description: 'TypeScript interface for AI to map extracted data to',
      },
      {
        name: 'excludeTopics',
        type: 'string',
        required: false,
        description: 'Topics to exclude from extraction',
      },
      {
        name: 'storage',
        type: 'object',
        required: false,
        description: 'Storage plugin for caching generated HTML parsers',
      },
      {
        name: 'crawlEnabled',
        type: 'boolean',
        required: false,
        description: 'Enable link-following from seed pages (default: false)',
      },
      {
        name: 'crawlLinkSelector',
        type: 'string',
        required: false,
        description: 'CSS selector for links to follow (default: "a")',
      },
      {
        name: 'crawlMaxPages',
        type: 'number',
        required: false,
        description: 'Max pages to scrape (default: 10)',
      },
      {
        name: 'crawlMaxDepth',
        type: 'number',
        required: false,
        description: 'Max link-following depth from seed pages (default: 1)',
      },
      {
        name: 'crawlSameDomain',
        type: 'boolean',
        required: false,
        description: 'Only follow same-domain links (default: true)',
      },
      {
        name: 'crawlAllowedPaths',
        type: 'string[]',
        required: false,
        description: 'Glob patterns for allowed URL paths (e.g., ["/blog/*"])',
      },
      {
        name: 'crawlExcludePaths',
        type: 'string[]',
        required: false,
        description: 'Glob patterns for excluded URL paths (e.g., ["/login", "/admin/*"])',
      },
      {
        name: 'crawlDelayMs',
        type: 'number',
        required: false,
        description: 'Delay between requests in milliseconds (default: 1000)',
      },
      {
        name: 'crawlRespectRobotsTxt',
        type: 'boolean',
        required: false,
        description: 'Respect robots.txt crawl rules (default: true)',
      },
    ],
  };

  constructor(config: WebScraperSourceConfig) {
    this.name = config.name;
    this.urls = config.urls || [];
    this.userAgent = config.userAgent;
    this.objectTypeString = config.objectTypeString;
    this.excludeTopics = config.excludeTopics;

    // AI provider (may be injected as string name by configHelper, resolved later)
    if (config.provider && typeof config.provider !== 'string') {
      this.provider = config.provider;
    }

    // Storage for cached parsers (may be string name initially, loadStorage() replaces)
    if (config.storage) {
      this.storage = config.storage;
    }

    // Crawl config
    this.crawlEnabled = config.crawlEnabled ?? false;
    this.crawlLinkSelector = config.crawlLinkSelector || 'a';
    this.crawlMaxPages = config.crawlMaxPages ?? 10;
    this.crawlMaxDepth = config.crawlMaxDepth ?? 1;
    this.crawlSameDomain = config.crawlSameDomain ?? true;
    this.crawlAllowedPaths = config.crawlAllowedPaths;
    this.crawlExcludePaths = config.crawlExcludePaths;
    this.crawlDelayMs = config.crawlDelayMs ?? 1000;
    this.crawlRespectRobotsTxt = config.crawlRespectRobotsTxt ?? true;
  }

  /**
   * Fetch items from configured URLs, optionally crawling for more pages.
   */
  public async fetchItems(): Promise<ContentItem[]> {
    console.log(`[WebScraperSource:${this.name}] Starting fetch for ${this.urls.length} seed URL(s), crawl=${this.crawlEnabled}`);

    const results: ContentItem[] = [];
    const visited = new Set<string>();

    // BFS queue: { url, depth }
    const queue: Array<{ url: string; depth: number }> = this.urls.map(url => ({ url, depth: 0 }));

    while (queue.length > 0 && results.length < this.crawlMaxPages) {
      const { url, depth } = queue.shift()!;

      // Normalize and check for duplicates
      const normalized = normalizeUrl(url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      // Check robots.txt
      if (this.crawlRespectRobotsTxt && depth > 0) {
        const allowed = await this.isAllowedByRobots(url);
        if (!allowed) {
          console.log(`[WebScraperSource:${this.name}] Blocked by robots.txt: ${url}`);
          continue;
        }
      }

      try {
        console.log(`[WebScraperSource:${this.name}] Fetching (depth=${depth}): ${url}`);

        const fetchOptions: FetchHTMLOptions = {
          sourceId: this.name,
          userAgent: this.userAgent,
        };

        const { html, usedBrowser } = await fetchHTML(url, fetchOptions);

        // Extract structured data (free, no AI)
        const structuredData = extractStructuredData(html);
        const discoveredFeeds = discoverRSSFeeds(html);

        if (discoveredFeeds.length > 0) {
          console.log(`[WebScraperSource:${this.name}] Discovered RSS feeds on ${url}: ${discoveredFeeds.join(', ')}`);
        }

        // Extract content (cached parser, AI-generated parser, or Readability fallback)
        // Pass pre-fetched HTML to avoid re-fetching the same URL
        const resolvedStorage = (this.storage && typeof this.storage !== 'string') ? this.storage : undefined;
        let item = await extractPageContent(url, {
          sourceId: this.name,
          sourceName: this.name,
          type: 'webPageContent',
          title: structuredData.openGraph?.title || '',
          provider: this.provider,
          objectTypeString: this.objectTypeString,
          excludeTopics: this.excludeTopics,
          html, // Use already-fetched HTML
          storage: resolvedStorage,
        });

        if (!item) {
          // extractPageContent failed entirely — create minimal item
          const urlHash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
          item = {
            cid: `web-${urlHash}-error`,
            type: 'webPageContent',
            source: this.name,
            text: '',
            title: structuredData.openGraph?.title || url,
            link: url,
            date: Math.floor(Date.now() / 1000),
            metadata: {},
          };
        }

        // Enrich with crawl-specific metadata
        item.metadata = {
          ...item.metadata,
          discoveredRSSFeeds: discoveredFeeds.length > 0 ? discoveredFeeds : undefined,
          crawlDepth: depth,
          fetchMethod: usedBrowser ? 'browser' : 'fetch',
        };

        results.push(item);

        // Crawl: extract and queue child links
        if (this.crawlEnabled && depth < this.crawlMaxDepth) {
          const links = extractLinks(html, this.crawlLinkSelector);
          let addedCount = 0;

          for (const href of links) {
            const absoluteUrl = resolveUrl(href, url);
            if (!absoluteUrl) continue;

            const normalizedLink = normalizeUrl(absoluteUrl);
            if (visited.has(normalizedLink)) continue;

            // Same-domain check
            if (this.crawlSameDomain && !isSameOrigin(absoluteUrl, url)) continue;

            // Path pattern checks
            try {
              const parsedUrl = new URL(absoluteUrl);

              if (this.crawlAllowedPaths && this.crawlAllowedPaths.length > 0) {
                if (!matchesPathPattern(parsedUrl.pathname, this.crawlAllowedPaths)) continue;
              }

              if (this.crawlExcludePaths && this.crawlExcludePaths.length > 0) {
                if (matchesPathPattern(parsedUrl.pathname, this.crawlExcludePaths)) continue;
              }
            } catch {
              continue;
            }

            // Don't exceed max pages
            if (results.length + queue.length >= this.crawlMaxPages) break;

            queue.push({ url: absoluteUrl, depth: depth + 1 });
            addedCount++;
          }

          if (addedCount > 0) {
            console.log(`[WebScraperSource:${this.name}] Queued ${addedCount} links from ${url}`);
          }
        }

        // Rate limiting delay
        if (queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.crawlDelayMs));
        }
      } catch (error: any) {
        console.error(`[WebScraperSource:${this.name}] Error fetching ${url}:`, error.message);
        // Continue with next URL
      }
    }

    // Close browser context for this source
    await BrowserManager.closeContext(this.name);

    console.log(`[WebScraperSource:${this.name}] Completed. Scraped ${results.length} page(s), visited ${visited.size} URL(s)`);
    return results;
  }

  /**
   * Fetch historical content. Web pages don't have native historical versions,
   * so this returns current content (same as fetchItems).
   */
  public async fetchHistorical(date: string): Promise<ContentItem[]> {
    console.log(`[WebScraperSource:${this.name}] fetchHistorical called for ${date}, returning current content`);
    return this.fetchItems();
  }

  /**
   * Check if a URL is allowed by the site's robots.txt.
   * Results are cached per origin.
   */
  private async isAllowedByRobots(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const origin = parsed.origin;

      if (!this.robotsCache.has(origin)) {
        await this.fetchRobotsTxt(origin);
      }

      const disallowed = this.robotsCache.get(origin);
      if (!disallowed || disallowed.size === 0) return true;

      for (const path of disallowed) {
        if (parsed.pathname.startsWith(path)) {
          return false;
        }
      }

      return true;
    } catch {
      return true; // If we can't check, allow
    }
  }

  /**
   * Fetch and parse robots.txt for an origin.
   */
  private async fetchRobotsTxt(origin: string): Promise<void> {
    const disallowed = new Set<string>();
    this.robotsCache.set(origin, disallowed);

    try {
      const response = await fetch(`${origin}/robots.txt`);
      if (!response.ok) return;

      const text = await response.text();
      let isRelevantAgent = false;

      for (const line of text.split('\n')) {
        const trimmed = line.trim().toLowerCase();

        if (trimmed.startsWith('user-agent:')) {
          const agent = trimmed.replace('user-agent:', '').trim();
          isRelevantAgent = agent === '*';
        } else if (isRelevantAgent && trimmed.startsWith('disallow:')) {
          const path = trimmed.replace('disallow:', '').trim();
          if (path) {
            disallowed.add(path);
          }
        }
      }
    } catch {
      // Ignore -- can't fetch robots.txt
    }
  }

  /**
   * Remove empty structured data sections to keep metadata clean.
   */
  private compactStructuredData(data: ReturnType<typeof extractStructuredData>): Record<string, any> | undefined {
    const compact: Record<string, any> = {};
    if (data.jsonLd.length > 0) compact.jsonLd = data.jsonLd;
    if (Object.keys(data.openGraph).length > 0) compact.openGraph = data.openGraph;
    if (Object.keys(data.twitterCard).length > 0) compact.twitterCard = data.twitterCard;
    if (Object.keys(data.metaData).length > 0) compact.metaData = data.metaData;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }
}
