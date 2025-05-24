// src/plugins/sources/RSSSource.ts
import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import Parser from 'rss-parser';
import type { Page as PlaywrightPage, BrowserContext as PlaywrightBrowserContext } from 'playwright-core';
import { getRealtorPageWithPatchright, formatCookiesForRequest } from "../../helpers/realtorHelper"; // Assuming formatCookiesForRequest might still be used for logging
import { ContentParser } from "../parsers/ContentParser"; 
import { StoragePlugin } from "../storage/StoragePlugin"; 
import * as path from 'path'; 

// Keep ProxyConfig if it's defined here or import from realtorHelper if defined there
interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

interface RSSSourceConfig {
  name: string;
  feeds: string[];
  userAgent?: string;
  headers?: Record<string, string>;
  parser?: ContentParser | undefined;
  storage?: StoragePlugin | undefined;
  needsDynamicHeaders?: boolean; // To flag feeds like Realtor.com
  proxy?: ProxyConfig;
  patchrightUserDataPath?: string;
  patchrightHeadless?: boolean;
  patchrightDebugMode?: boolean;
  patchrightScreenshotsPath?: string;
}

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: string[];
  private userAgent: string | undefined;
  private headers: Record<string, string> | undefined;
  private parser: ContentParser | undefined;
  private storage: StoragePlugin | undefined;
  private needsDynamicHeaders: boolean;
  private proxyConfig?: ProxyConfig;
  private patchrightUserDataPath: string;
  private patchrightHeadless: boolean;
  private patchrightDebugMode: boolean;
  private patchrightScreenshotsPath?: string;

  constructor(config: RSSSourceConfig) {
    this.name = config.name;
    this.rssParser = new Parser();
    this.feeds = config.feeds;
    this.userAgent = config.userAgent;
    this.headers = config.headers; // These are for standard fetch, filter Sec-CH-UA for them
    this.parser = config.parser;
    this.storage = config.storage;
    this.needsDynamicHeaders = config.needsDynamicHeaders || this.feeds.some(feed => feed.includes('realtor.com')); // Default based on feeds if not provided
    this.proxyConfig = config.proxy;

    // Patchright specific config
    this.patchrightUserDataPath = config.patchrightUserDataPath || path.join(__dirname, '..', '..', 'patchright_profiles', this.name || 'default_rss_profile');
    this.patchrightHeadless = config.patchrightHeadless ?? true; // Default to true (less intrusive) unless stealth demands false
    this.patchrightDebugMode = config.patchrightDebugMode ?? false;
    this.patchrightScreenshotsPath = config.patchrightScreenshotsPath; // Will be undefined if not set
  }

  private async processItems(items: Parser.Item[], feedUrl: string): Promise<ContentItem[]> {
    let processedItems: ContentItem[] = [];
    for (const item of items) {
        const date = item.pubDate ? new Date(item.pubDate).getTime() / 1000 : Math.floor(Date.now() / 1000);
        const media: string[] = [];
        if (item.enclosure && item.enclosure.url) {
            media.push(item.enclosure.url);
        }
        const mediaContent = (item as any)['media:content'];
        if (mediaContent) {
            if (Array.isArray(mediaContent)) {
                mediaContent.forEach(m => { if (m.$ && m.$.url) media.push(m.$.url); });
            } else if (mediaContent.$ && mediaContent.$.url) {
                media.push(mediaContent.$.url);
            }
        }

        if (item.link) {
            const storedItem = await this.storage?.getContentItemByLink(item.link);
            if (!storedItem) {
                let textContent = item.content || item.summary || "";
                let title = item.title || "";
                let link = item.link || "";
                let cid = item.guid || item.link || `${feedUrl}-${date}`;
                let metadata: Record<string, any> = {
                    feedUrl: feedUrl,
                    author: item.creator || "",
                    categories: item.categories || [],
                    media: media
                };
                
                processedItems.push({
                    cid, type: "rss", source: this.name, text: textContent, title, link, date, metadata,
                });
            }
        }
    }
    return processedItems;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    let allFetchedItems: ContentItem[] = [];

    for (const feedUrl of this.feeds) {
        let feed: Parser.Output<{ [key: string]: any; }> = { items: [] }; // Safe default
        let playwrightPage: PlaywrightPage | undefined = undefined;
        let playwrightContext: PlaywrightBrowserContext | undefined = undefined;

        // Determine if this feed needs dynamic fetching with Patchright
        const usePatchright = this.needsDynamicHeaders && feedUrl.includes('realtor.com');

        try {
            if (usePatchright) {
                console.log(`[RSSSource] Using Patchright for feed: ${feedUrl}`);
                const patchrightOptions = {
                    headless: this.patchrightHeadless,
                    debugMode: this.patchrightDebugMode,
                    screenshotsPath: this.patchrightScreenshotsPath,
                };
                // Ensure userDataDirPath is unique per profile or managed carefully
                const userDataDirPath = path.join(this.patchrightUserDataPath, new URL(feedUrl).hostname);

                const patchrightResult = await getRealtorPageWithPatchright(
                    feedUrl,
                    userDataDirPath,
                    patchrightOptions,
                    this.proxyConfig
                );
                
                playwrightPage = patchrightResult.page; 
                playwrightContext = patchrightResult.context; 

                if (patchrightResult.success && playwrightPage && patchrightResult.initialNavigationStatus && patchrightResult.initialNavigationStatus >= 200 && patchrightResult.initialNavigationStatus < 300) {
                    console.log(`[RSSSource] Patchright successfully navigated to ${feedUrl}, status ${patchrightResult.initialNavigationStatus}. Getting content...`);
                    try {
                        const pageContent = await playwrightPage.content();
                        if (this.patchrightDebugMode && playwrightContext) {
                            const cookies = await playwrightContext.cookies(); // Get all cookies for the context
                            console.log(`[RSSSource] Cookies from Patchright context for ${feedUrl}: ${formatCookiesForRequest(cookies)}`);
                        }

                        if (pageContent && pageContent.trim().startsWith('<')) {
                            try {
                                feed = await this.rssParser.parseString(pageContent);
                            } catch (parserError: any) {
                                console.error(`[RSSSource] Error from rssParser.parseString for ${feedUrl} (Patchright content):`, parserError.message);
                                feed = { items: [] }; 
                            }
                        } else {
                            console.warn(`[RSSSource] Content from Patchright for ${feedUrl} does not appear to be XML or is empty.`);
                            feed = { items: [] };
                        }
                    } catch (contentError: any) {
                        console.error(`[RSSSource] Error getting content from Patchright page for ${feedUrl}:`, contentError.message);
                        feed = { items: [] };
                    }
                } else {
                    console.warn(`[RSSSource] Patchright navigation to ${feedUrl} failed or returned non-2xx status. Status: ${patchrightResult.initialNavigationStatus}, Error: ${patchrightResult.error}`);
                    feed = { items: [] }; 
                }
            } else {
                // Standard RSS fetching logic
                console.log(`[RSSSource] Using standard fetch for feed: ${feedUrl}`);
                let requestOptions: Parser.RequestOptions = {};
                const headersForDirectFetch: Record<string, string> = {};
                if (this.userAgent) {
                    headersForDirectFetch['User-Agent'] = this.userAgent;
                }
                if (this.headers) {
                    for (const [key, value] of Object.entries(this.headers)) {
                        if (!key.toLowerCase().startsWith('sec-ch-ua')) {
                            headersForDirectFetch[key] = value;
                        }
                    }
                }
                requestOptions.headers = headersForDirectFetch;

                try {
                    feed = await this.rssParser.parseURL(feedUrl, requestOptions).catch(parserError => {
                        console.error(`[RSSSource] Error during initial rssParser.parseURL for ${feedUrl}:`, parserError.message);
                        return null; // Signal failure for fallback
                    });
                    if (!feed) {
                        throw new Error(`rssParser.parseURL returned null for ${feedUrl}`);
                    }
                } catch (initialError: any) {
                    console.warn(`[RSSSource] Initial attempt to parse URL ${feedUrl} failed (Error: ${initialError.message}). Attempting fallback fetch...`);
                    try {
                        const response = await fetch(feedUrl, { headers: headersForDirectFetch });
                        const contentType = response.headers.get('content-type');
                        console.log(`[RSSSource] Fallback fetch for ${feedUrl} - Response Content-Type: ${contentType}`);
                        const text = await response.text();

                        if (response.ok && text && text.trim().startsWith('<')) {
                            try {
                                feed = await this.rssParser.parseString(text);
                            } catch (parserError: any) {
                                console.error(`[RSSSource] Error from rssParser.parseString (fallback) for ${feedUrl}:`, parserError.message);
                                feed = { items: [] };
                            }
                        } else {
                            if (!response.ok) {
                                console.warn(`[RSSSource] Fallback fetch for ${feedUrl} failed with status: ${response.status}`);
                            } else {
                                console.warn(`[RSSSource] Fetched content for ${feedUrl} (fallback) does not appear to be XML or is empty.`);
                            }
                            feed = { items: [] };
                        }
                    } catch (fallbackError: any) {
                        console.error(`[RSSSource] Fallback fetch attempt for ${feedUrl} also failed:`, fallbackError.message);
                        feed = { items: [] };
                    }
                }
            }

            if (!feed || !feed.items) {
                console.warn(`[RSSSource] Feed object for ${feedUrl} is invalid or has no items after parsing attempts. Defaulting to empty items.`);
                feed = { items: [] };
            }

            let processedFeedItems: ContentItem[] = [];
            if (feed.items.length > 0) {
                 processedFeedItems = await this.processItems(feed.items, feedUrl);
                 allFetchedItems = allFetchedItems.concat(processedFeedItems);
            } else {
                console.log(`[RSSSource] No valid feed items found for ${feedUrl} to process.`);
            }
            
            // Item link parsing (detail extraction)
            // This part needs careful handling of the page object.
            // If RealtorParser is used, it should get the playwrightPage if it was created for this feed.
            if (this.parser && processedFeedItems.length > 0) {
                let detailParsedItems: ContentItem[] = [];
                for (const pItem of processedFeedItems) { // Iterate over items from *this* feed
                    if (pItem.link) {
                        try {
                            if (usePatchright && playwrightPage && this.parser.name === "RealtorParser") {
                                console.log(`[RSSSource] Calling RealtorParser.parseDetails for ${pItem.link} with Patchright page object.`);
                                const parsedDetails = await (this.parser as any).parseDetails(pItem.link, playwrightPage, pItem.title);
                                if (parsedDetails) detailParsedItems.push(parsedDetails);
                                else console.warn(`[RSSSource] RealtorParser.parseDetails returned undefined for item link: ${pItem.link}`);
                            } else if (!usePatchright && this.parser) { // Standard parsing for non-patchright items
                                console.log(`[RSSSource] Calling default parser.parseDetails for item link: ${pItem.link}.`);
                                const currentHeadersForParser = { ...this.headers };
                                Object.keys(currentHeadersForParser).forEach(key => {
                                    if (key.toLowerCase().startsWith('sec-ch-ua')) {
                                        delete currentHeadersForParser[key];
                                    }
                                });
                                const parsedDetails = await (this.parser as any).parseDetails(pItem.link, currentHeadersForParser, pItem.title);
                                if (parsedDetails) detailParsedItems.push(parsedDetails);
                                else console.warn(`[RSSSource] Default parser.parseDetails returned undefined for item link: ${pItem.link}`);
                            }
                        } catch (parsingError: any) {
                            console.error(`[RSSSource] Error parsing item link ${pItem.link} with parser ${this.parser.name || 'unknown'}:`, parsingError);
                        }
                    }
                }
                // Replace processed items with detail-parsed items if any were successful
                if(detailParsedItems.length > 0) {
                    // This logic for replacing items needs to be robust.
                    // For now, if detail parsing happened, assume it's the primary source of items.
                    // This might remove items that were processed but not detail-parsed.
                    // A more sophisticated merge might be needed if that's not desired.
                    allFetchedItems.splice(allFetchedItems.length - processedFeedItems.length); // Remove previously added items
                    allFetchedItems = allFetchedItems.concat(detailParsedItems);
                }
            }


        } catch (feedProcessingError: any) { 
            console.error(`[RSSSource] Critical error processing feed URL ${feedUrl}:`, feedProcessingError);
        } finally {
            if (playwrightContext) {
                try {
                    console.log(`[RSSSource] Closing Patchright browser context for ${feedUrl}...`);
                    await playwrightContext.close();
                } catch (closeError: any) {
                     console.error(`[RSSSource] Error closing Patchright context for ${feedUrl}: ${closeError.message}`);
                }
            }
        }
    } // End of for...of this.feeds

    return allFetchedItems;
  }
}
