// src/plugins/sources/TwitterSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";

// Hypothetical Twitter client
import { SearchMode, Scraper } from 'agent-twitter-client';
import { TwitterCache } from "../../helpers/cache";

interface TwitterSourceConfig {
  name: string;
  username: string | undefined;
  password: string | undefined;
  email: string | undefined;
  cookies: string | undefined;
  accounts: string[];          // e.g., user to watch
}

export class TwitterSource implements ContentSource {
  public name: string;
  private client: Scraper;
  private accounts: string[];
  private username: string | undefined;
  private password: string | undefined;
  private cookies: string | undefined;
  private email: string | undefined;
  private cache: TwitterCache;

  constructor(config: TwitterSourceConfig) {
    this.name = config.name;
    this.client = new Scraper();
    this.accounts = config.accounts;
    this.username = config.username;
    this.password = config.password;
    this.cookies = config.cookies;
    this.email = config.email;
    this.cache = new TwitterCache();
  }

  private async init() {
    let retries = 5;

    if (!this.username) {
      throw new Error("Twitter username not configured");
    }
    if (this.cookies) {
      const cookiesArray = JSON.parse(this.cookies);

      await this.setCookiesFromArray(cookiesArray);
    } else {
      const cachedCookies = await this.getCachedCookies(this.username);
      if (cachedCookies) {
          await this.setCookiesFromArray(cachedCookies);
      }
    }

    while (retries > 0) {
      const cookies = await this.client.getCookies();
      if ((await this.client.isLoggedIn()) && !!cookies) {
        console.info("Already logged in.");
        await this.cacheCookies(this.username, cookies);
        console.info("Successfully logged in and cookies cached.");
        break;
      }

      try {
        await this.client.login(
          this.username,
          this.password || '',
          this.email
        );
      } catch (error:any) {
        console.error(`Login attempt failed: ${error?.message || ''}`);
      }

      retries--;

      if (retries === 0) {
        throw new Error("Twitter login failed after maximum retries.");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async processTweets(tweets: any[]): Promise<any> {
    let tweetsResponse : any[] = [];

    for (const tweet of tweets) {
      let photos = tweet.photos.map((img : any) => img.url) || [];
      let retweetPhotos = tweet.retweetedStatus?.photos?.map((img : any) => img.url) || [];
      let videos = tweet.videos.map((img : any) => img.url) || [];
      let videoPreview = tweet.videos.map((img : any) => img.preview) || [];
      let retweetVideos = tweet.retweetedStatus?.videos.map((img : any) => img.url) || [];
      let retweetVideoPreview = tweet.retweetedStatus?.videos.map((img : any) => img.preview) || [];
      
      tweetsResponse.push({
        cid: tweet.id,
        type: "tweet",
        source: this.name,
        text: tweet.text,
        link: tweet.permanentUrl,
        date: tweet.timestamp,
        metadata: {
          userId: tweet.userId,
          tweetId: tweet.id,
          likes: tweet.likes,
          replies: tweet.replies,
          retweets: tweet.retweets,
          photos: photos.concat(retweetPhotos,videoPreview,retweetVideoPreview),
          videos: videos.concat(retweetVideos)
        },
      })
    }
    
    return tweetsResponse;
  }

  public async fetchHistorical(date:string): Promise<ContentItem[]> {
    const isLoggedIn = await this.client.isLoggedIn();
    
    if ( ! isLoggedIn ) {
      await this.init();
    }

    let resultTweets: ContentItem[] = [];
    let targetDate = new Date(date).getTime() / 1000;
    
    for await (const account of this.accounts) {
      const cachedData = this.cache.get(account, date);

      if (cachedData) {
        resultTweets = resultTweets.concat(cachedData);
        continue;
      }

      let cursor = this.cache.getCursor(account);

      const tweetsByDate: Record<string, ContentItem[]> = {};

      let query = `from:${account}`;
      let tweets : any = await this.client.fetchSearchTweets(query, 100, 1);
      
      while ( tweets["tweets"].length > 0 ) {
        let processedTweets = await this.processTweets(tweets["tweets"]);
        for (const tweet of processedTweets) {
          const tweetDateStr = new Date((tweet.date) * 1000).toISOString().slice(0, 10);
          if (!tweetsByDate[tweetDateStr]) {
            tweetsByDate[tweetDateStr] = [];
          }
          tweetsByDate[tweetDateStr].push(tweet);
        }

        const lastTweet = tweets["tweets"][tweets["tweets"].length - 1];
        if (lastTweet.timestamp < targetDate) {
          if (cursor) {
            this.cache.setCursor(account, cursor);
          }
          break;
        }

        cursor = tweets["next"];
        tweets = await this.client.fetchSearchTweets(`from:${account}`, 100, 1, cursor);
      }

      for (const [tweetDate, tweetList] of Object.entries(tweetsByDate)) {
        this.cache.set(account, tweetDate, tweetList, 300);
      }
  
      if (tweetsByDate[date]) {
        resultTweets = resultTweets.concat(tweetsByDate[date]);
      }
    }

    return resultTweets;
  }

  public async fetchItems(): Promise<ContentItem[]> {
    const isLoggedIn = await this.client.isLoggedIn();
    
    if ( ! isLoggedIn ) {
      await this.init();
    }

    let tweetsResponse : any[] = [];

    for await (const account of this.accounts) {
      const tweets : AsyncGenerator<any> = await this.client.getTweets(account, 10);
      
      for await (const tweet of tweets) {
        tweetsResponse = tweetsResponse.concat(await this.processTweets([tweet]));
      }
    }
    
    return tweetsResponse
  }
  
  private async setCookiesFromArray(cookiesArray: any[]) {
    const cookieStrings = cookiesArray.map(
        (cookie) =>
            `${cookie.key}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path}; ${
                cookie.secure ? "Secure" : ""
            }; ${cookie.httpOnly ? "HttpOnly" : ""}; SameSite=${
                cookie.sameSite || "Lax"
            }`
    );
    await this.client.setCookies(cookieStrings);
  }

  private async getCachedCookies(username: string) {
    return await this.cache.get(
      `twitter/${username}/cookies`,
      new Date().toISOString()
    );
  }
  
  private async cacheCookies(username: string, cookies: any[]) {
    await this.cache.set(
      `twitter/${username}/cookies`,
      new Date().toISOString(),
      cookies
    );
  }
}