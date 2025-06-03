// src/plugins/sources/RSSSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import Parser from 'rss-parser';
import { ContentParser } from "../parsers/ContentParser";
import { StoragePlugin } from "../storage/StoragePlugin";
import { getCookiesAndHeaders } from "../../helpers/patchrightHelper";

interface RSSFeed {
  url: string;
  cookieUrl: string;
  excludeTopics: string;
  objectTypeString: string;
  type: string;
}

interface RSSSourceConfig {
  name: string;
  feeds: RSSFeed[];
  parser?: ContentParser | undefined;
  storage?: StoragePlugin | undefined;
}

export class RSSSource implements ContentSource {
  public name: string;
  private rssParser: Parser;
  private feeds: RSSFeed[];
  private parser: ContentParser | undefined;
  private storage: StoragePlugin | undefined;

  constructor(config: RSSSourceConfig) {
    this.name = config.name;
    this.rssParser = new Parser();
    this.feeds = config.feeds;
    this.parser = config.parser;
    this.storage = config.storage;
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
          mediaContent.forEach(m => {
            if (m.$ && m.$.url) media.push(m.$.url);
          });
        } else if (mediaContent.$ && mediaContent.$.url) {
          media.push(mediaContent.$.url);
        }
      }

      if ( item.link ) {
          const storedItem = await this.storage?.getContentItemByLink(item.link);
    
          // if ( ! storedItem ) {
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

            return processedItems 
          // }
      }
    }
    
    return processedItems;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    for (const feed of this.feeds) {
      let feedUrl = feed.url;
      let cookieUrl = feed.cookieUrl;
      let excludeTopics = feed.excludeTopics;
      let objectTypeString = feed.objectTypeString;
      let feedType = feed.type;
      let headers:any = {};

      if (cookieUrl) {
        headers = await getCookiesAndHeaders( cookieUrl );
      }

      let resultItems: ContentItem[] = [];
      let parsedItems: ContentItem[] = [];

      try {
        let feed;
        
        try {
          feed = await this.rssParser.parseURL(feedUrl);
        } catch (initialError) {
          const response = await fetch(feedUrl, { headers: headers });

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
                    const parsedDetails = await this.parser.parseDetails(item.link, item.title || '', feedType, objectTypeString, excludeTopics);
                    
                    if ( parsedDetails ) {
                        parsedItems.push( parsedDetails );
                    }
                }
            }
        }
        console.log(parsedItems)
        return parsedItems;
      } catch (error) {
        console.error(`ERROR: Fetching feed - ${feedUrl}`, error);
      }
    }
    return [];
  }
}