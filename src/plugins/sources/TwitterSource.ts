/**
 * @fileoverview Implementation of a content source for fetching Twitter data
 * Handles authentication, tweet retrieval, and caching for specified Twitter accounts
 */

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import { parseDate, addOneDay, formatDate } from "../../helpers/dateHelper";

// Hypothetical Twitter client
import { SearchMode, Scraper } from 'agent-twitter-client';
import { TwitterCache } from "../../helpers/cache";

/**
 * Configuration interface for TwitterSource
 * @interface TwitterSourceConfig
 * @property {string} name - The name identifier for this Twitter source
 * @property {string} [username] - Twitter account username for authentication
 * @property {string} [password] - Twitter account password
 * @property {string} [email] - Email associated with Twitter account
 * @property {string} [cookies] - Serialized cookies for authentication
 * @property {string[]} accounts - Array of Twitter accounts to monitor
 * @property {string} [fetchMode] - Fetch mode for historical tweets
 */
interface TwitterSourceConfig {
  name: string;
  username: string | undefined;
  password: string | undefined;
  email: string | undefined;
  cookies: string | undefined;
  accounts: string[];
  fetchMode?: 'timeline' | 'search';
}

const QUOTED_TWEET_FETCH_TIMEOUT = 15000; // 15 seconds timeout

/**
 * TwitterSource class that implements ContentSource interface for Twitter data
 * Handles Twitter authentication, tweet fetching, and data caching
 * @implements {ContentSource}
 */
export class TwitterSource implements ContentSource {
  /** Name identifier for this Twitter source */
  public name: string;
  /** Twitter scraper client instance */
  private client: Scraper;
  /** List of Twitter accounts to monitor */
  private accounts: string[];
  /** Twitter account username */
  private username: string | undefined;
  /** Twitter account password */
  private password: string | undefined;
  /** Serialized cookies for authentication */
  private cookies: string | undefined;
  /** Email associated with Twitter account */
  private email: string | undefined;
  /** Cache instance for storing Twitter data */
  private cache: TwitterCache;
  /** Fetch mode for historical tweets */
  private fetchMode: 'timeline' | 'search';

  /**
   * Creates a new TwitterSource instance
   * @param {TwitterSourceConfig} config - Configuration object for the Twitter source
   */
  constructor(config: TwitterSourceConfig) {
    this.name = config.name;
    this.client = new Scraper();
    this.accounts = config.accounts;
    this.username = config.username;
    this.password = config.password;
    this.cookies = config.cookies;
    this.email = config.email;
    this.cache = new TwitterCache();
    // Log exactly what is received before defaulting
    console.log(`[TwitterSource Constructor] Received config.fetchMode: ${config.fetchMode} (type: ${typeof config.fetchMode})`);
    this.fetchMode = config.fetchMode || 'timeline'; // Default to timeline if not specified or falsy
    console.log(`[TwitterSource] Initialized with final fetchMode: ${this.fetchMode}`);
  }

  /**
   * Initializes the Twitter client with authentication
   * Handles login with credentials or cookies
   * @private
   * @throws {Error} If authentication fails after maximum retries
   */
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

  /**
   * Processes raw tweet data into ContentItem format
   * @private
   * @param {any[]} tweets - Array of raw tweet objects
   * @returns {Promise<ContentItem[]>} Array of processed tweet content items
   */
  private async processTweets(tweets: any[]): Promise<any> {
    let tweetsResponse : any[] = [];

    for (const rawTweet of tweets) { 
      console.log(`[TwitterSource] Inspecting rawTweet ID: ${rawTweet.id}, isRetweet: ${rawTweet.isRetweet}, text: "${rawTweet.text?.substring(0,30)}..."`);

      let contentItem: Partial<ContentItem> = { source: this.name };
      let metadata: any = {}; 
      let tweetToProcessForContent: any = rawTweet; 
      let originalContentFetchedSuccessfully = false;

      // 1. Set the definitive ContentItem ID and Date from the rawTweet (action itself)
      contentItem.cid = rawTweet.id;
      contentItem.date = rawTweet.timestamp;

      // 2. Check if it's a retweet
      if (rawTweet.isRetweet) {
        contentItem.type = "retweet";
        console.log(`[TwitterSource.processTweets] rawTweet ID: ${rawTweet.id} - IS A RETWEET (rawTweet.isRetweet: ${rawTweet.isRetweet}). Set contentItem.type to 'retweet'.`);
        metadata.retweetedByTweetId = rawTweet.id;
        metadata.retweetedByUserId = rawTweet.userId;
        metadata.retweetedByUserName = rawTweet.username;

        let originalContent = rawTweet.retweetedStatus; // Prefer embedded original content

        if (!originalContent && rawTweet.retweetedStatusId) {
          console.info(`[TwitterSource] Retweet ${rawTweet.id}: retweetedStatus not embedded, trying to fetch original ${rawTweet.retweetedStatusId}`);
          try {
            const fetchPromise = this.client.getTweet(rawTweet.retweetedStatusId);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout fetching original tweet ${rawTweet.retweetedStatusId} for RT ${rawTweet.id}`)), QUOTED_TWEET_FETCH_TIMEOUT)
            );
            originalContent = await Promise.race([fetchPromise, timeoutPromise]);
            if (originalContent) {
              console.info(`[TwitterSource] Retweet ${rawTweet.id}: Successfully fetched original content ${originalContent.id}`);
              originalContentFetchedSuccessfully = true;
            } else {
              console.warn(`[TwitterSource] Retweet ${rawTweet.id}: Failed to fetch original content for ${rawTweet.retweetedStatusId} (getTweet returned null/undefined).`);
            }
          } catch (err: any) {
            console.warn(`[TwitterSource] Retweet ${rawTweet.id}: Error/Timeout fetching original content for ${rawTweet.retweetedStatusId}: ${err.message}.`);
            originalContent = null; 
          }
        } else if (originalContent) {
          console.info(`[TwitterSource] Retweet ${rawTweet.id}: Using embedded retweetedStatus. Original ID: ${originalContent.id}`);
          originalContentFetchedSuccessfully = true;
        } else if (!originalContent && !rawTweet.retweetedStatusId) {
          console.warn(`[TwitterSource] Retweet ${rawTweet.id}: isRetweet is true, but no retweetedStatus or retweetedStatusId. Original content unknown.`);
        }

        if (originalContentFetchedSuccessfully && originalContent) {
          tweetToProcessForContent = originalContent; 
          metadata.originalTweetId = originalContent.id;
          metadata.originalUserId = originalContent.userId;
          metadata.originalUserName = originalContent.username;
          metadata.originalTweetTimestamp = originalContent.timestamp;
        } else {
          console.warn(`[TwitterSource] Retweet ${rawTweet.id}: Original content could not be obtained/verified. Displaying retweet's own text/link if available.`);
          // tweetToProcessForContent remains rawTweet
          // originalTweetId might be set if retweetedStatusId was known, even if fetch failed.
          if (rawTweet.retweetedStatusId) metadata.originalTweetId = rawTweet.retweetedStatusId; 
        }
      } else { 
        contentItem.type = "tweet";
        console.log(`[TwitterSource.processTweets] rawTweet ID: ${rawTweet.id} - NOT a retweet (rawTweet.isRetweet: ${rawTweet.isRetweet}). Set contentItem.type to 'tweet'.`);
        // tweetToProcessForContent is already rawTweet
      }

      // 3. Populate contentItem and metadata from tweetToProcessForContent
      contentItem.text = tweetToProcessForContent.text;
      contentItem.link = tweetToProcessForContent.permanentUrl;
      // contentItem.title = ... // if applicable

      // Author of the displayed content
      metadata.authorUserId = tweetToProcessForContent.userId;
      metadata.authorUserName = tweetToProcessForContent.username;

      // Common metadata from tweetToProcessForContent
      metadata.photos = (tweetToProcessForContent.photos?.map((img: any) => img.url) || []).concat(tweetToProcessForContent.videos?.map((vid: any) => vid.preview) || []);
      metadata.videos = tweetToProcessForContent.videos?.map((vid: any) => vid.url) || [];
      metadata.likes = tweetToProcessForContent.likes; 
      metadata.replies = tweetToProcessForContent.replies;
      metadata.retweets = tweetToProcessForContent.retweets; 
      metadata.isPin = tweetToProcessForContent.isPin;
      metadata.isReply = tweetToProcessForContent.isReply;
      metadata.isSelfThread = tweetToProcessForContent.isSelfThread;
      metadata.hashtags = tweetToProcessForContent.hashtags;
      metadata.mentions = tweetToProcessForContent.mentions;
      metadata.urls = tweetToProcessForContent.urls;
      metadata.sensitiveContent = tweetToProcessForContent.sensitiveContent;
      // metadata.poll = tweetToProcessForContent.poll; 

      // Populate thread information
      if (tweetToProcessForContent.conversationId || typeof tweetToProcessForContent.isSelfThread === 'boolean') {
        metadata.thread = {};
        if (tweetToProcessForContent.conversationId) {
          metadata.thread.conversationId = tweetToProcessForContent.conversationId;
        }
        if (typeof tweetToProcessForContent.isSelfThread === 'boolean') {
          metadata.thread.isContinuation = tweetToProcessForContent.isSelfThread;
        }
      }

      // 4. Handle quoted tweet (based on tweetToProcessForContent)
      if (tweetToProcessForContent.isQuoted && tweetToProcessForContent.quotedStatusId) {
        const quoteTweetLogPrefix = contentItem.type === 'retweet' ? `Retweet's original ${tweetToProcessForContent.id}` : `Standard tweet ${tweetToProcessForContent.id}`;
        console.info(`[TwitterSource] ${quoteTweetLogPrefix} is a quote of ${tweetToProcessForContent.quotedStatusId}. Processing...`);
        try {
          let quotedDetails: any = null;
          // Prefer pre-populated quotedStatus if available and seems valid
          if (tweetToProcessForContent.quotedStatus && tweetToProcessForContent.quotedStatus.id === tweetToProcessForContent.quotedStatusId) {
            quotedDetails = tweetToProcessForContent.quotedStatus;
            console.info(`[TwitterSource] Using pre-populated quotedStatus for ${quoteTweetLogPrefix}`);
          } else {
            console.info(`[TwitterSource] Pre-populated quotedStatus not used or mismatched for ${quoteTweetLogPrefix}. Fetching ${tweetToProcessForContent.quotedStatusId}.`);
            const fetchPromise = this.client.getTweet(tweetToProcessForContent.quotedStatusId);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout fetching quoted status ${tweetToProcessForContent.quotedStatusId} for ${quoteTweetLogPrefix}`)), QUOTED_TWEET_FETCH_TIMEOUT)
            );
            quotedDetails = await Promise.race([fetchPromise, timeoutPromise]);
          }

          if (quotedDetails) {
            metadata.quotedTweet = {
              id: quotedDetails.id,
              text: quotedDetails.text,
              link: quotedDetails.permanentUrl,
              userId: quotedDetails.userId,
              userName: quotedDetails.username || quotedDetails.name, // Fallback to name if username not present
              date: quotedDetails.timestamp,
            };
            console.info(`[TwitterSource] Successfully processed quoted tweet ${quotedDetails.id} within ${quoteTweetLogPrefix}`);
          } else {
            metadata.quotedTweetError = `Details not found/fetched for quoted status ${tweetToProcessForContent.quotedStatusId}`;
            console.warn(`[TwitterSource] Failed to get details for quoted tweet ${tweetToProcessForContent.quotedStatusId} for ${quoteTweetLogPrefix}`);
          }
        } catch (qError: any) {
          console.warn(`[TwitterSource] Error/Timeout fetching quoted status ${tweetToProcessForContent.quotedStatusId} for ${quoteTweetLogPrefix}: ${qError.message}`);
          metadata.quotedTweetError = `Failed to fetch/process quoted status ${tweetToProcessForContent.quotedStatusId}: ${qError.message}`;
        }
      }
      
      contentItem.metadata = metadata;
      tweetsResponse.push(contentItem as ContentItem);
    }
    
    return tweetsResponse;
  }

  /**
   * Fetches historical tweets from a specific date
   * Implements caching to improve performance
   * @param {string} date - ISO date string to fetch historical tweets from
   * @returns {Promise<ContentItem[]>} Array of historical tweet content items
   */
  public async fetchHistorical(date:string): Promise<ContentItem[]> {
    const isLoggedIn = await this.client.isLoggedIn();
    
    if ( ! isLoggedIn ) {
      await this.init();
    }

    let resultTweets: ContentItem[] = [];
    const targetDateObj = parseDate(date);
    const targetDateEpoch = targetDateObj.getTime() / 1000; 
    const untilDateObj = addOneDay(targetDateObj);
    const untilDateEpoch = untilDateObj.getTime() / 1000;
    const untilDateStr = formatDate(untilDateObj); // For search mode

    console.log(`[TwitterSource.fetchHistorical] Mode: ${this.fetchMode}, Target date: ${date} (Epoch: ${targetDateEpoch} to ${untilDateEpoch})`);
    console.log(`[TwitterSource.fetchHistorical] Will process accounts: ${JSON.stringify(this.accounts)}`);

    if (this.fetchMode === 'search') {
      console.log("[TwitterSource.fetchHistorical] Using 'search' mode.");
      for await (const account of this.accounts) {
        console.log(`[TwitterSource.fetchHistorical] ----- Processing account: ${account} for date: ${date} (search mode) -----`);
        const cachedData = this.cache.get(account, date);
        if (cachedData) {
          console.log(`[TwitterSource.fetchHistorical] Using cached data for ${account} on ${date}. Count: ${cachedData.length}`);
          resultTweets = resultTweets.concat(cachedData);
          continue;
        }

        let cursor = this.cache.getCursor(account); // Search mode might use cursors differently or not at all from client
        const tweetsByDate: Record<string, ContentItem[]> = {};
        const query = `from:${account} since:${date} until:${untilDateStr}`;
        console.log(`[TwitterSource.fetchHistorical] Query for ${account}: ${query}`);

        try {
          // Assuming fetchSearchTweets handles its own pagination or we fetch a large enough batch
          // This part might need adjustment based on how fetchSearchTweets pagination works if many tweets exist for a single day
          let pageCount = 0;
          const MAX_SEARCH_PAGES = 5; // Safeguard against too many pages for search mode for a single day
          let currentPageTweets: any = await this.client.fetchSearchTweets(query, 100, SearchMode.Latest, cursor);

          while (currentPageTweets && currentPageTweets.tweets.length > 0 && pageCount < MAX_SEARCH_PAGES) {
            pageCount++;
            console.log(`[TwitterSource.fetchHistorical] Fetched page ${pageCount} for ${account} (search mode): ${currentPageTweets.tweets.length} tweets. Cursor: ${currentPageTweets.next}`);
            let processedTweets = await this.processTweets(currentPageTweets.tweets);
            for (const tweet of processedTweets) {
              // Ensure tweets are within the exact date, as search might be broad
              if (tweet.date && tweet.date >= targetDateEpoch && tweet.date < untilDateEpoch) {
                const tweetDateStr = new Date((tweet.date || 0) * 1000).toISOString().slice(0, 10);
                if (!tweetsByDate[tweetDateStr]) {
                  tweetsByDate[tweetDateStr] = [];
                }
                tweetsByDate[tweetDateStr].push(tweet);
              }
            }
            cursor = currentPageTweets.next;
            if (!cursor) break;
            currentPageTweets = await this.client.fetchSearchTweets(query, 100, SearchMode.Latest, cursor);
          }

          for (const [tweetDate, tweetList] of Object.entries(tweetsByDate)) {
            if (tweetList.length > 0) {
              console.log(`[TwitterSource.fetchHistorical] Caching ${tweetList.length} tweets for ${account} on date ${tweetDate} (search mode).`);
              this.cache.set(account, tweetDate, tweetList, 300);
            }
          }
          if (tweetsByDate[date]) {
            resultTweets = resultTweets.concat(tweetsByDate[date]);
          }
        } catch (error: any) {
          console.error(`[TwitterSource.fetchHistorical] Error processing account ${account} (search mode): ${error.message}`, error.stack);
        }
        console.log(`[TwitterSource.fetchHistorical] Finished account: ${account} (search mode). Total results: ${resultTweets.length}`);
      }
    } else { // Default to 'timeline' mode
      console.log("[TwitterSource.fetchHistorical] Using 'timeline' mode.");
      const MAX_TWEETS_TO_SCAN_PER_USER = 400; 
      for await (const account of this.accounts) {
        console.log(`[TwitterSource.fetchHistorical] ----- Processing account: ${account} for date: ${date} -----`);
        
        const cachedData = this.cache.get(account, date);
        if (cachedData) {
          console.log(`[TwitterSource.fetchHistorical] Using cached data for ${account} on ${date}. Count: ${cachedData.length}`);
          resultTweets = resultTweets.concat(cachedData);
          continue;
        }

        let userId: string;
        try {
          userId = await this.client.getUserIdByScreenName(account);
          if (!userId) {
            console.warn(`[TwitterSource.fetchHistorical] Could not get userId for account: ${account}. Skipping.`);
            continue;
          }
          console.log(`[TwitterSource.fetchHistorical] Got userId ${userId} for account ${account}.`);
        } catch (error: any) {
          console.error(`[TwitterSource.fetchHistorical] Error getting userId for ${account}: ${error.message}. Skipping.`);
          continue;
        }

        const tweetsForAccountOnDate: any[] = [];
        let tweetsScanned = 0;

        try {
          console.log(`[TwitterSource.fetchHistorical] Fetching tweets for user ${account} (ID: ${userId}) using getUserTweetsIterator.`);
          const tweetIterator = this.client.getUserTweetsIterator(userId, MAX_TWEETS_TO_SCAN_PER_USER);
          
          for await (const rawTweet of tweetIterator) {
            tweetsScanned++;
            if (!rawTweet.timestamp) {
              // console.warn(`[TwitterSource.fetchHistorical] Tweet ID ${rawTweet.id} from ${account} missing timestamp. Skipping.`);
              continue;
            }

            if (rawTweet.timestamp >= targetDateEpoch && rawTweet.timestamp < untilDateEpoch) {
              // console.log(`[TwitterSource.fetchHistorical] Tweet ${rawTweet.id} from ${account} (Timestamp: ${rawTweet.timestamp}) is within target date range.`);
              tweetsForAccountOnDate.push(rawTweet);
            } else if (rawTweet.timestamp < targetDateEpoch) {
              // console.log(`[TwitterSource.fetchHistorical] Tweet ${rawTweet.id} from ${account} (Timestamp: ${rawTweet.timestamp}) is older than target date. Assuming reverse chronological order, stopping scan for this user.`);
              break; // Tweets are generally reverse chronological in user timelines
            }
          }
          console.log(`[TwitterSource.fetchHistorical] Scanned ${tweetsScanned} tweets for ${account}. Found ${tweetsForAccountOnDate.length} tweets for date ${date}.`);

        } catch (error: any) {
          console.error(`[TwitterSource.fetchHistorical] Error fetching/iterating tweets for ${account} (ID: ${userId}): ${error.message}`, error.stack);
          // Continue to next account even if one fails
        }

        if (tweetsForAccountOnDate.length > 0) {
          const processedTweets = await this.processTweets(tweetsForAccountOnDate);
          console.log(`[TwitterSource.fetchHistorical] Processed ${processedTweets.length} tweets for ${account} on ${date}.`);
          if (processedTweets.length > 0) {
            this.cache.set(account, date, processedTweets, 300); // Cache for 5 minutes
            resultTweets = resultTweets.concat(processedTweets);
            console.log(`[TwitterSource.fetchHistorical] Added ${processedTweets.length} tweets from ${account} to results.`);
          }
        } else {
          console.log(`[TwitterSource.fetchHistorical] No tweets found for ${account} on date ${date} after scanning timeline.`);
          // Cache empty result to avoid re-fetching for a short period if desired, but not strictly necessary for empty results
          // this.cache.set(account, date, [], 300); 
        }
        console.log(`[TwitterSource.fetchHistorical] Finished processing account: ${account}. Total resultTweets now: ${resultTweets.length}`);
      }
    }

    console.log(`[TwitterSource.fetchHistorical] Finished all accounts. Total tweets for date ${date}: ${resultTweets.length}`);
    return resultTweets;
  }

  /**
   * Fetches recent tweets from configured accounts
   * @returns {Promise<ContentItem[]>} Array of recent tweet content items
   */
  public async fetchItems(): Promise<ContentItem[]> {
    const isLoggedIn = await this.client.isLoggedIn();
    
    if ( ! isLoggedIn ) {
      await this.init();
    }

    let tweetsResponse : any[] = [];

    for await (const account of this.accounts) {
      try {
        const tweets : AsyncGenerator<any> = await this.client.getTweets(account, 10);
        
        for await (const tweet of tweets) {
          tweetsResponse = tweetsResponse.concat(await this.processTweets([tweet]));
        }
      }
      catch( e ) {
        console.log(`ERROR: Fetching account - ${account}`)
      }
    }
    
    return tweetsResponse
  }
  
  /**
   * Sets cookies from an array of cookie objects
   * @private
   * @param {any[]} cookiesArray - Array of cookie objects
   */
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

  /**
   * Retrieves cached cookies for a username
   * @private
   * @param {string} username - Twitter username
   * @returns {Promise<any>} Cached cookies if available
   */
  private async getCachedCookies(username: string) {
    return await this.cache.get(
      `twitter/${username}/cookies`,
      new Date().toISOString()
    );
  }
  
  /**
   * Caches cookies for a username
   * @private
   * @param {string} username - Twitter username
   * @param {any[]} cookies - Array of cookies to cache
   */
  private async cacheCookies(username: string, cookies: any[]) {
    await this.cache.set(
      `twitter/${username}/cookies`,
      new Date().toISOString(),
      cookies
    );
  }
}