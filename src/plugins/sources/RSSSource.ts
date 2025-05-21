// src/plugins/sources/RSSSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import Parser from 'rss-parser';
import { ContentParser } from "../parsers/ContentParser";
import { StoragePlugin } from "../storage/StoragePlugin";
// import { getCookies,getKasadaProtectedCookies } from "../../helpers/cookieHelper";
import { formatCookiesForRequest, debugRealtorAccess } from "../../helpers/realtorHelper"; // Using debugRealtorAccess now
import { Page, Browser } from 'puppeteer'; // Import Page and Browser types

interface ProxyConfig { // Re-define or import from a shared types file if available
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
  proxy?: ProxyConfig; // Added proxy config
}

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: string[];
  private userAgent: string | undefined;
  private headers: Record<string, string> | undefined;
  private parser: ContentParser | undefined;
  private storage: StoragePlugin | undefined;
  private page: Page | undefined; 
  private browser: Browser | undefined; 
  private proxyConfig?: ProxyConfig; // Added proxyConfig member

  constructor(config: RSSSourceConfig) {
    this.name = config.name;
    this.rssParser = new Parser();
    this.feeds = config.feeds;
    this.userAgent = config.userAgent;
    this.headers = config.headers;
    this.parser = config.parser;
    this.storage = config.storage;
    this.proxyConfig = config.proxy; // Store proxy config
  }

  private async processItems(items: Parser.Item[], feedUrl: string): Promise<ContentItem[]> {
    let processedItems: ContentItem[] = [];

    for (const item of items) {
      const date = item.pubDate ? new Date(item.pubDate).getTime() / 1000 : Math.floor(Date.now() / 1000);
      
      // Extract any media content from the item
      const media: string[] = [];
      if (item.enclosure && item.enclosure.url) {
        media.push(item.enclosure.url);
      }
      
      // Check for media:content elements if available
      const mediaContent = (item as any)['media:content'];
      if (mediaContent) {
        if (Array.isArray(mediaContent)) {
          mediaContent.forEach(m => {
            if (m.$ && m.$.url) media.push(m.$.url);
          });
        } else if (mediaContent.$ && mediaContent.$.url) {
          media.push(mediaContent.$.url);
        }
      }

      if ( item.link ) {
          const storedItem = await this.storage?.getContentItemByLink(item.link);
    
          if ( ! storedItem ) {
              processedItems.push({
                cid: item.guid || item.link || `${feedUrl}-${date}`,
                type: "rss",
                source: this.name,
                text: item.content || item.summary || "",
                title: item.title || "",
                link: item.link || "",
                date: date,
                metadata: {
                  feedUrl: feedUrl,
                  author: item.creator || "",
                  categories: item.categories || [],
                  media: media
                },
              });
          }
      }
    }
    
    return processedItems;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    let dynamicCookies: any[] | undefined;
    let dynamicCookieString: string | undefined;
    // let dynamicHeaders: Record<string, string> | undefined; // Headers from realtorHelper might not be directly applicable for RSS

    try {
      // TODO: Determine when to call bypassRealtorProtection. For now, assume it's for realtor.com feeds.
      // This logic might need refinement based on feedUrl or a config flag.
      // For now, assume debugRealtorAccess is relevant if any feed contains 'realtor.com'
      // or if specific conditions for needing advanced headers are met.
      const needsDynamicHeaders = this.feeds.some(feed => feed.includes('realtor.com'));

      if (needsDynamicHeaders) {
        console.log('[RSSSource] Attempting to run debugRealtorAccess to fetch dynamic page context (cookies, etc.)...');
        try {
          const initialUrlForPuppeteer = this.feeds.find(feed => feed.includes('realtor.com')) || 'https://www.realtor.com/';
          console.log(`[RSSSource] Initial URL for debugRealtorAccess: ${initialUrlForPuppeteer}`);
          
          const realtorContext = await debugRealtorAccess(
            {
              // headless: true, // Already default in debugRealtorAccess
              initialUrl: initialUrlForPuppeteer,
              // Potentially pass other relevant options from this.config if needed
            },
            this.proxyConfig // Pass proxy configuration
          );

          if (realtorContext && realtorContext.success && realtorContext.page) {
            this.page = realtorContext.page;
            this.browser = realtorContext.browser;
            
            const pageCookies = await this.page.cookies();
            if (pageCookies && pageCookies.length > 0) {
              dynamicCookies = pageCookies;
              dynamicCookieString = formatCookiesForRequest(dynamicCookies);
              console.log('[RSSSource] Successfully fetched dynamic cookies via debugRealtorAccess:', dynamicCookieString);
            } else {
              console.log('[RSSSource] debugRealtorAccess successful, but no cookies were extracted from the page.');
            }
          } else {
            console.warn('[RSSSource] debugRealtorAccess did not succeed or did not return a page object.');
          }
        } catch (realtorError) {
          console.error('[RSSSource] Error during debugRealtorAccess execution:', realtorError);
          // this.page and this.browser remain undefined.
        }
      }
    } catch (initializationError) { 
      console.error('[RSSSource] Error during initial dynamic header fetching phase:', initializationError);
      // this.page and this.browser remain undefined.
    }
    
    let allFetchedItems: ContentItem[] = [];

    // Wrap the main feed processing and parsing logic in a try...finally block
    // to ensure browser cleanup.
    try {
      for (const feedUrl of this.feeds) {
        let resultItems: ContentItem[] = [];
        let parsedItems: ContentItem[] = [];

        try { // Inner try for processing a single feed URL
          let feed;
          const requestOptions: Parser.RequestOptions = { headers: {} };
        
        // Start with base headers
        if (this.userAgent) {
          requestOptions.headers!['User-Agent'] = this.userAgent;
        }
        if (this.headers) {
          for (const [key, value] of Object.entries(this.headers)) {
            if (!key.toLowerCase().startsWith('sec-ch-ua')) {
              requestOptions.headers![key] = value;
            }
          }
        }

        // Add dynamic cookies if available
        if (dynamicCookieString) {
          requestOptions.headers!['Cookie'] = dynamicCookieString;
        }
        
        console.log(`[RSSSource] Fetching RSS feed: ${feedUrl} with options:`, JSON.stringify(requestOptions.headers, null, 2));
        
        // Initialize feed to a safe default structure
        feed = { items: [] } as Parser.Output<{ [key: string]: any; }>;


        try {
          // Attempt to parse the URL
          const parsedOutput = await this.rssParser.parseURL(feedUrl, requestOptions)
            .catch(parserError => {
              console.error(`[RSSSource] Error during direct rssParser.parseURL for ${feedUrl}:`, parserError.message);
              // Return null to signal failure and trigger fallback in the outer catch
              return null; 
            });

          if (parsedOutput) {
            feed = parsedOutput;
          } else {
            // If parseURL's .catch returned null, throw a generic error to trigger the main fallback.
            throw new Error(`rssParser.parseURL for ${feedUrl} failed or returned null.`);
          }

        } catch (initialError) {
          console.warn(`[RSSSource] Initial attempt to parse URL ${feedUrl} failed (Error: ${initialError.message}). Attempting fallback fetch...`);
          
          const fallbackHeaderObj: HeadersInit = {};

          // Start with base headers
          if (this.userAgent) {
            fallbackHeaderObj['User-Agent'] = this.userAgent;
          }
          if (this.headers) {
            for (const [key, value] of Object.entries(this.headers)) {
              if (!key.toLowerCase().startsWith('sec-ch-ua')) {
                fallbackHeaderObj[key] = value;
              }
            }
          }
          // Add dynamic cookies if available, potentially overwriting static 'Cookie' header
          if (dynamicCookieString) {
            fallbackHeaderObj['Cookie'] = dynamicCookieString;
          }
          
          console.log(`[RSSSource] Fallback fetch for ${feedUrl} with headers:`, JSON.stringify(fallbackHeaderObj, null, 2));
          
          const response = await fetch(feedUrl, {
            headers: fallbackHeaderObj as Record<string, string>, // Cast to Record<string, string>
          });

          const contentType = response.headers.get('content-type');
          console.log(`[RSSSource] Fallback fetch for ${feedUrl} - Response Content-Type: ${contentType}`);
          
          if (response.ok) {
            const text = await response.text();
            if (text && text.trim().startsWith('<')) {
              try {
                feed = await this.rssParser.parseString(text);
              } catch (parserError) {
                console.error(`[RSSSource] Error from rssParser.parseString for ${feedUrl} after fallback:`, parserError.message);
                feed = { items: [] } as Parser.Output<{ [key: string]: any; }>; // Default to empty items
              }
            } else {
              console.warn(`[RSSSource] Fetched content for ${feedUrl} in fallback does not appear to be XML or is empty. Snippet: ${text.substring(0,100)}`);
              feed = { items: [] } as Parser.Output<{ [key: string]: any; }>; // Default to empty items
            }
          } else {
            console.warn(`[RSSSource] Fallback fetch for ${feedUrl} failed with status: ${response.status}`);
            feed = { items: [] } as Parser.Output<{ [key: string]: any; }>; // Default to empty items on fetch error
          }
        }
        
        // Ensure feed is an object with items before proceeding
        if (!feed || !feed.items) {
            console.warn(`[RSSSource] Feed object for ${feedUrl} is invalid or has no items after parsing attempts. Defaulting to empty items.`);
            feed = { items: [] } as Parser.Output<{ [key: string]: any; }>;
        }

        if (feed.items.length > 0) {
          const processedItems = await this.processItems(feed.items, feedUrl);
          resultItems = resultItems.concat(processedItems);
        } else {
            console.log(`[RSSSource] No valid feed items found for ${feedUrl} after parsing attempts.`);
        }
        
        if (this.parser && resultItems.length > 0) { // Only parse if there are items to parse
          for (const item of resultItems) {
            if (item.link) {
              try { 
                if (this.page && this.parser.name === "RealtorParser") {
                  console.log(`[RSSSource] Attempting to call RealtorParser.parseDetails for ${item.link} using ${this.page ? 'valid' : 'invalid'} page object from debugRealtorAccess.`);
                  if (this.page) { 
                    console.log(`[RSSSource] Current URL of this.page before passing to RealtorParser: ${this.page.url()}`);
                  }
                  const parsedDetails = await (this.parser as any).parseDetails(item.link, this.page, item.title || '');
                  if (parsedDetails) {
                    parsedItems.push(parsedDetails);
                  } else {
                    console.warn(`[RSSSource] RealtorParser.parseDetails returned undefined for item link: ${item.link}`);
                  }
                } else if (this.parser) { 
                  console.log(`[RSSSource] Calling default parser.parseDetails for item link: ${item.link}.`);
                  const currentHeadersForParser = { ...this.headers }; 
                  if (dynamicCookieString) { 
                    currentHeadersForParser['Cookie'] = dynamicCookieString;
                  }
                  const parsedDetails = await (this.parser as any).parseDetails(item.link, currentHeadersForParser, item.title || '');
                  if (parsedDetails) {
                    parsedItems.push(parsedDetails);
                  } else {
                    console.warn(`[RSSSource] Default parser.parseDetails returned undefined for item link: ${item.link}`);
                  }
                }
              } catch (parsingError) {
                console.error(`[RSSSource] Error parsing item link ${item.link} with parser ${this.parser.name ? this.parser.name : 'unknown'}:`, parsingError);
              }
            }
          }
        }
        // Concatenate parsed items if any, otherwise use resultItems (which might be empty if feed processing failed)
        allFetchedItems = allFetchedItems.concat(parsedItems.length > 0 ? parsedItems : resultItems);
        
      } catch (feedProcessingError) { 
        console.error(`[RSSSource] Critical error processing feed URL ${feedUrl}:`, feedProcessingError);
        // Continue to the next feed URL, allFetchedItems will not include items from this failed feed.
      }
    }
    } finally {
      if (this.browser) {
        console.log('[RSSSource] Closing browser instance from RSSSource after processing all feeds...');
        try {
          await this.browser.close();
        } catch (browserCloseError) {
          console.error('[RSSSource] Error closing browser in RSSSource:', browserCloseError);
        }
        this.browser = undefined;
        this.page = undefined; 
      }
    }

    return allFetchedItems;
  }
}