// src/plugins/sources/RSSSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import Parser from 'rss-parser';
import { ContentParser } from "../parsers/ContentParser";
import { StoragePlugin } from "../storage/StoragePlugin";
import { getCookies, cookiesToHeader, getCookieValue, getRSSXML } from "../../helpers/patchrightHelper";

interface RSSSourceConfig {
  name: string;
  feeds: any[];
  userAgent?: string;
  headers?: Record<string, string>;
  parser?: ContentParser | undefined;
  storage?: StoragePlugin | undefined;
}

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: any[];
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
    for (const feed of this.feeds) {
      let feedUrl = feed.url;
      let cookieURL = feed.cookieURL;

      let cookies : any[] = await getCookies( cookieURL );

      let headers : any = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-control": "no-cache",
        "Cookie": cookiesToHeader(cookies),
        "Pragma": "no-cache",
        "Priority": "u=0, i",
        "Sec-Ch-Ua": "\"Not(A:Brand\";v=\"99\", \"Google Chrome\";v=\"133\", \"Chromium\";v=\"133\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "Windows",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
      }

      let resultItems: ContentItem[] = [];
      let parsedItems: ContentItem[] = [];

      try {
        let feed = await getRSSXML(feedUrl);
        // try {
        //   feed = await this.rssParser.parseURL(feedUrl);
        // } catch (initialError) {
        //   console.log( initialError )
        //   console.log(cookiesToHeader(cookies))
        //   const response = await fetch(feedUrl, { headers: headers });
          
        //   if (response.ok) {
        //     const text = await response.text();
        //     feed = await this.rssParser.parseString(text);
        //   } else {
        //     throw new Error(`Failed to fetch with status: ${response.status}`);
        //   }
        // }
        
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