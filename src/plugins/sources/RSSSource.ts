// src/plugins/sources/RSSSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import Parser from 'rss-parser';
import { ContentParser } from "../parsers/ContentParser";
import { StoragePlugin } from "../storage/StoragePlugin";
import { getCookies,getKasadaProtectedCookies } from "../../helpers/cookieHelper";
import { bypassRealtorProtection, debugRealtorAccess } from "../../helpers/realtorHelper";

interface RSSSourceConfig {
  name: string;
  feeds: string[];
  userAgent?: string;
  headers?: Record<string, string>;
  parser?: ContentParser | undefined;
  storage?: StoragePlugin | undefined;
}

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: string[];
  private userAgent: string | undefined;
  private headers: Record<string, string> | undefined;
  private parser: ContentParser | undefined;
  private storage: StoragePlugin | undefined;

  constructor(config: RSSSourceConfig) {
    this.name = config.name;
    this.rssParser = new Parser();
    this.feeds = config.feeds;
    this.userAgent = config.userAgent;
    this.headers = config.headers;
    this.parser = config.parser;
    this.storage = config.storage;
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
    for (const feedUrl of this.feeds) {
      // let websiteData = await getKasadaProtectedCookies('https://realtor.com')
      let websiteData = await debugRealtorAccess()
      console.log( websiteData )
      // console.log( websiteData.cookies, websiteData.headers, websiteData.rawCookieString )

      // let _headers = {
      //   "Cookie": websiteData.rawCookieString,
      // }
      let resultItems: ContentItem[] = [];
      let parsedItems: ContentItem[] = [];

      try {
        let feed;
        try {
          feed = await this.rssParser.parseURL(feedUrl);
        } catch (initialError) {
          const headerObj: HeadersInit = {};
          if (this.userAgent) {
            headerObj['User-Agent'] = this.userAgent;
          }
          
          // Add any additional headers
          if (this.headers) {
              for (const [key, value] of Object.entries(this.headers)) {
                headerObj[key] = value;
              }
          }
          
          const response = await fetch(feedUrl, {
            headers: headerObj
          });
          
          if (response.ok) {
            const text = await response.text();
            feed = await this.rssParser.parseString(text);
          } else {
            throw new Error(`Failed to fetch with status: ${response.status}`);
          }
        }
        
        if (feed && feed.items && feed.items.length > 0) {
          const processedItems = await this.processItems(feed.items, feedUrl);

          resultItems = resultItems.concat(processedItems);
        }
        
        if ( this.parser ) {
            for (const item of resultItems) {
                if ( item.link ) {
                    const parsedDetails = await this.parser.parseDetails(item.link, this.headers, item.title || '');
                    
                    if ( parsedDetails ) {
                        parsedItems.push( parsedDetails );
                    }
                }
            }
        }

        return parsedItems;
      } catch (error) {
        console.error(`ERROR: Fetching feed - ${feedUrl}`, error);
      }
    }
    // console.log( resultItems )
    return [];
    // return resultItems;
  }
}