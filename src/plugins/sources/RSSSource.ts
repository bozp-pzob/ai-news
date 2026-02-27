/**
 * RSS/Atom feed source plugin.
 * 
 * Fetches and processes RSS/Atom feeds, with optional AI-powered content
 * extraction from individual feed item pages. Supports cookie-protected
 * feeds via browser-based cookie capture.
 * 
 * When feed items have no inline content (just links), automatically
 * fetches the linked page and extracts content via Readability. If an
 * AI provider is configured, uses structured AI extraction instead.
 * 
 * Skips items that already exist in storage to avoid wasting AI tokens
 * and browser resources on re-processing.
 * 
 * @module plugins/sources/RSSSource
 */

import { ContentSource } from './ContentSource';
import { AiProvider, ContentItem } from '../../types';
import { StoragePlugin } from '../storage/StoragePlugin';
import { getCookiesAndHeaders, fetchHTML } from '../../helpers/patchrightHelper';
import { extractPageContent } from '../../helpers/htmlHelper';
import Parser from 'rss-parser';

// ============================================
// CONFIGURATION
// ============================================

interface RSSFeed {
  /** RSS/Atom feed URL */
  url: string;
  /** URL to visit for cookie capture (for auth-protected feeds) */
  cookieUrl?: string;
  /** Topics to exclude from AI extraction */
  excludeTopics?: string;
  /** TypeScript interface for AI to map data to */
  objectTypeString?: string;
  /** Content type identifier (e.g., "article", "listing") */
  type?: string;
}

interface RSSSourceConfig {
  name: string;
  /** Array of feed configurations */
  feeds: RSSFeed[];
  /** AI provider for structured content extraction from feed item pages */
  provider?: AiProvider | string;
  /** Storage plugin for dedup -- skips items already in storage to save AI tokens */
  storage?: StoragePlugin | string;
}

// ============================================
// SOURCE PLUGIN
// ============================================

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: RSSFeed[];
  /** AI provider — exposed as public for injection by loadProviders() */
  public provider: AiProvider | undefined;
  /** Storage plugin for dedup — exposed as public for injection by loadStorage() */
  public storage: StoragePlugin | string | undefined;

  static description = 'Fetches and processes RSS/Atom feeds with optional AI content extraction';

  static constructorInterface = {
    parameters: [
      {
        name: 'feeds',
        type: 'array',
        required: true,
        description: 'Array of feed configs: [{url, cookieUrl?, excludeTopics?, objectTypeString?, type?}]',
      },
      {
        name: 'provider',
        type: 'object',
        required: false,
        description: 'AI provider for structured content extraction from feed item pages',
      },
      {
        name: 'storage',
        type: 'object',
        required: false,
        description: 'Storage plugin to skip already-processed items (saves AI tokens)',
      },
    ],
  };

  constructor(config: RSSSourceConfig) {
    this.name = config.name;
    this.rssParser = new Parser();
    this.feeds = config.feeds || [];
    // AI provider — stored as string name initially, loadProviders() replaces
    // it with the actual AiProvider instance after construction
    if (config.provider) {
      this.provider = config.provider as any;
    }
    // Storage for dedup — stored as string name initially, loadStorage() replaces
    // it with the actual StoragePlugin instance after construction
    if (config.storage) {
      this.storage = config.storage;
    }
  }

  /**
   * Process raw RSS items into ContentItems.
   * Extracts media content from enclosures and media:content elements.
   */
  private processItems(items: Parser.Item[], feedUrl: string): ContentItem[] {
    const processedItems: ContentItem[] = [];

    for (const item of items) {
      const date = item.pubDate
        ? new Date(item.pubDate).getTime() / 1000
        : Math.floor(Date.now() / 1000);

      // Extract media attachments
      const media: string[] = [];
      if (item.enclosure && item.enclosure.url) {
        media.push(item.enclosure.url);
      }

      const mediaContent = (item as any)['media:content'];
      if (mediaContent) {
        if (Array.isArray(mediaContent)) {
          mediaContent.forEach((m: any) => {
            if (m.$ && m.$.url) media.push(m.$.url);
          });
        } else if (mediaContent.$ && mediaContent.$.url) {
          media.push(mediaContent.$.url);
        }
      }

      if (item.link) {
        processedItems.push({
          cid: item.guid || item.link || `${feedUrl}-${date}`,
          type: 'rss',
          source: this.name,
          text: item.content || item.summary || '',
          title: item.title || '',
          link: item.link || '',
          date,
          metadata: {
            feedUrl,
            author: item.creator || '',
            categories: item.categories || [],
            media,
          },
        });
      }
    }

    return processedItems;
  }

  /**
   * Check which CIDs already exist in storage.
   * Returns a Set of CIDs that should be skipped.
   * If no storage is configured (or not yet injected), returns an empty set.
   */
  private async getExistingCids(items: ContentItem[]): Promise<Set<string>> {
    const existing = new Set<string>();

    // Storage must be injected (not still a string name) and available
    if (!this.storage) {
      console.log(`[RSSSource:${this.name}] Dedup: No storage configured, processing all items`);
      return existing;
    }
    if (typeof this.storage === 'string') {
      console.warn(`[RSSSource:${this.name}] Dedup: Storage is still a string "${this.storage}" — injection did not happen. ` +
        `Ensure the storage name in this source's config matches the name in the storage config section.`);
      return existing;
    }

    const storage = this.storage;
    console.log(`[RSSSource:${this.name}] Dedup: Checking ${items.length} items against storage (${storage.constructor?.name || 'unknown'})`);

    // Log a sample CID for debugging
    if (items.length > 0 && items[0].cid) {
      console.log(`[RSSSource:${this.name}] Dedup: Sample CID being checked: "${items[0].cid}"`);
    }

    let checked = 0;
    let errors = 0;
    for (const item of items) {
      if (item.cid) {
        try {
          const found = await storage.getContentItem(item.cid);
          checked++;
          if (found) {
            existing.add(item.cid);
          }
        } catch (err: any) {
          errors++;
          // Log first error in full, then summarize
          if (errors === 1) {
            console.warn(`[RSSSource:${this.name}] Dedup: Storage error checking CID "${item.cid}": ${err.message}`);
          }
        }
      }
    }

    if (errors > 0) {
      console.warn(`[RSSSource:${this.name}] Dedup: ${errors}/${checked + errors} storage lookups failed — those items will be re-processed`);
    }
    console.log(`[RSSSource:${this.name}] Dedup: ${existing.size} of ${items.length} items already in storage`);

    return existing;
  }

  /**
   * Fetch items from all configured RSS feeds.
   * 
   * Two-phase approach to avoid wasting AI tokens:
   * 1. Parse RSS feed → get all items with CIDs (cheap, just XML)
   * 2. Check storage for existing CIDs → only extract new items (expensive)
   * 
   * For each NEW feed item:
   * - If the item has inline content (description/summary), uses it directly
   * - If the item has no content (just a link), fetches the linked page
   *   and extracts content via Readability (free) or AI (if provider configured)
   * - If an AI provider is configured and objectTypeString is set, always
   *   fetches the page for rich structured extraction regardless of inline content
   */
  public async fetchItems(): Promise<ContentItem[]> {
    // Diagnostic: show storage injection state
    const storageType = typeof this.storage;
    const storageInfo = storageType === 'object' ? this.storage?.constructor?.name : `"${this.storage}"`;
    console.log(`[RSSSource:${this.name}] fetchItems() — storage: ${storageInfo} (${storageType}), provider: ${this.provider ? this.provider.constructor?.name || 'yes' : 'none'}`);

    const allResults: ContentItem[] = [];

    for (const feed of this.feeds) {
      const feedUrl = feed.url;
      const cookieUrl = feed.cookieUrl;
      const excludeTopics = feed.excludeTopics;
      const objectTypeString = feed.objectTypeString;
      const feedType = feed.type || 'rss';
      let headers: Record<string, string> = {};

      // Get cookies if needed for auth-protected feeds
      if (cookieUrl) {
        try {
          headers = await getCookiesAndHeaders(cookieUrl, this.name);
        } catch (err: any) {
          console.warn(`[RSSSource:${this.name}] Failed to get cookies from ${cookieUrl}:`, err.message);
        }
      }

      try {
        let parsedFeed: Parser.Output<any> | undefined;

        // Strategy 1: Try direct RSS parsing (fast path, works for unprotected feeds)
        try {
          parsedFeed = await this.rssParser.parseURL(feedUrl);
        } catch (directErr: any) {
          console.log(`[RSSSource:${this.name}] Direct RSS parse failed for ${feedUrl}: ${directErr.message}`);
          
          // Strategy 2: Fetch with auto-fallback (node-fetch -> patchright) then parse
          // This handles bot-protected feeds (Cloudflare, 429, etc.)
          try {
            const { html, usedBrowser } = await fetchHTML(feedUrl, {
              sourceId: this.name,
              headers,
            });

            // Verify the response is actually XML/RSS before parsing
            if (this.isLikelyXML(html)) {
              parsedFeed = await this.rssParser.parseString(html);
              console.log(`[RSSSource:${this.name}] Parsed RSS via ${usedBrowser ? 'browser' : 'fetch'} fallback`);
            } else {
              console.warn(`[RSSSource:${this.name}] Response from ${feedUrl} is not valid RSS/XML (likely bot protection page). ` +
                `${usedBrowser ? 'Browser was used but site still blocked.' : 'Try installing patchright for browser-based fetching: npm install patchright'}`);
            }
          } catch (fetchErr: any) {
            console.error(`[RSSSource:${this.name}] Fallback fetch also failed for ${feedUrl}: ${fetchErr.message}`);
          }
        }

        if (parsedFeed && parsedFeed.items && parsedFeed.items.length > 0) {
          const resultItems = this.processItems(parsedFeed.items, feedUrl);
          console.log(`[RSSSource:${this.name}] Fetched ${resultItems.length} items from ${feedUrl}`);

          // Phase 1: Check which items already exist in storage (cheap DB lookups)
          const existingCids = await this.getExistingCids(resultItems);
          const newItems = resultItems.filter(item => !existingCids.has(item.cid));
          const skippedCount = resultItems.length - newItems.length;

          if (skippedCount > 0) {
            console.log(`[RSSSource:${this.name}] Skipping ${skippedCount} already-stored items, processing ${newItems.length} new items`);
          }

          // Phase 2: Only do expensive page extraction for NEW items
          for (const item of newItems) {
            const hasContent = item.text && item.text.trim().length > 50;
            const needsPageFetch = !hasContent || (this.provider && objectTypeString);

            if (needsPageFetch && item.link) {
              // Fetch the linked page and extract content (AI or Readability)
              try {
                const resolvedStorage = (this.storage && typeof this.storage !== 'string') ? this.storage : undefined;
                const enriched = await extractPageContent(item.link, {
                  sourceId: this.name,
                  sourceName: this.name,
                  type: feedType,
                  title: item.title,
                  provider: this.provider,
                  objectTypeString,
                  excludeTopics,
                  storage: resolvedStorage,
                });

                if (enriched) {
                  // Preserve RSS metadata (feedUrl, categories, media) on enriched item
                  enriched.cid = item.cid;
                  enriched.metadata = {
                    ...enriched.metadata,
                    feedUrl,
                    author: enriched.metadata?.author || item.metadata?.author,
                    categories: item.metadata?.categories,
                    media: item.metadata?.media,
                  };
                  allResults.push(enriched);
                  continue;
                }
              } catch (err: any) {
                console.warn(`[RSSSource:${this.name}] Failed to extract content for ${item.link}:`, err.message);
              }
            }

            // Use the raw RSS item (has inline content or page fetch failed)
            allResults.push(item);
          }
        }
      } catch (error: any) {
        console.error(`[RSSSource:${this.name}] Error fetching feed ${feedUrl}:`, error.message);
      }
    }

    console.log(`[RSSSource:${this.name}] Total items fetched: ${allResults.length}`);
    return allResults;
  }

  /**
   * Check if a string is likely XML/RSS content rather than HTML.
   * Bot protection pages return HTML which will cause rss-parser errors.
   */
  private isLikelyXML(content: string): boolean {
    const trimmed = content.trim();

    // Check for XML declaration or common RSS/Atom root elements
    if (trimmed.startsWith('<?xml')) return true;
    if (trimmed.startsWith('<rss')) return true;
    if (trimmed.startsWith('<feed')) return true;

    // Check first 500 chars for RSS/Atom markers
    const head = trimmed.substring(0, 500).toLowerCase();
    if (head.includes('<rss') || head.includes('<feed') || head.includes('<channel>')) return true;

    // Reject if it looks like HTML (bot protection pages, error pages, etc.)
    if (head.includes('<!doctype html') || head.includes('<html')) return false;

    // If it starts with '<' but isn't HTML, assume XML
    if (trimmed.startsWith('<')) return true;

    return false;
  }
}
