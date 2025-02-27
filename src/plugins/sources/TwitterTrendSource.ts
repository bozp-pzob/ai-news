// src/plugins/sources/TwitterSource.ts

import { ContentSource } from "./ContentSource";
import { ContentItem } from "../../types";
import { createHash } from 'crypto';

// Hypothetical Twitter client
import { SearchMode, Scraper } from 'agent-twitter-client';
import { OpenAIProvider } from "../ai/OpenAIProvider";

interface TwitterSourceConfig {
  name: string;
  username: string | undefined;
  password: string | undefined;
  email: string | undefined;
  topics: string[];
  provider: OpenAIProvider;
}

export class TwitterTrendSource implements ContentSource {
  public name: string;
  private client: Scraper;
  private topics: string[];
  private username: string | undefined;
  private password: string | undefined;
  private email: string | undefined;
  private maxTweetTrends: number = 50;
  private provider: OpenAIProvider| undefined;;

  constructor(config: TwitterSourceConfig) {
    this.name = config.name;
    this.client = new Scraper();
    this.topics = config.topics;
    this.username = config.username;
    this.password = config.password;
    this.email = config.email;
    this.provider = config.provider;
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

  public async fetchItems(): Promise<ContentItem[]> {
    const isLoggedIn = await this.client.isLoggedIn();
    
    if ( ! isLoggedIn ) {
        if ( this.username && this.password && this.email ) {
            await this.client.login(this.username, this.password, this.email);
        }
    }

    let tweetsResponse : any[] = [];

    for await (const topic of this.topics) {
      let query = `${topic}`
      let cursor;
    
      let tweets : any = await this.client.fetchSearchTweets(query, 100, 1);
      
      while ( tweets["tweets"].length > 0 ) {
        let processedTweets = await this.processTweets(tweets["tweets"]);

        tweetsResponse = tweetsResponse.concat(processedTweets)

        if ( this.maxTweetTrends <  tweetsResponse.length ) {
          break;
        }
        
        tweets = await this.client.fetchSearchTweets(query, 100, SearchMode["Latest"], cursor);
                
        cursor = tweets["next"];
      }
    }
    
    const summarizedContent = await this.summarizeTrends(tweetsResponse, 3000);
    console.log( summarizedContent )
    return []
    return summarizedContent
  }

  private async summarizeTrends(tweets: ContentItem[], charLimit = 1000) {
    let transcriptBatch = '';
    let summarizedContent: ContentItem[] = []
  
    for await (const tweet of tweets) {
      const tweetTranscript = this.formatStructuredTranscript(tweet);
  
      if (transcriptBatch.length + tweetTranscript.length > charLimit) {
        const structuredPrompt = this.formatStructuredPrompt(transcriptBatch);

        const response = await this.provider?.summarize(structuredPrompt);
        
        summarizedContent.push({
          type: "twitterTrendSummary",
          cid: `${createHash('sha256').update(response ?? '').digest('hex')}`,
          source: this.name,
          text: response,
          link: ``,
          date: Math.floor(new Date().getTime() / 1000),
          metadata: {
            summaryDate: Math.floor(new Date().getTime() / 1000),
          },
        });
        transcriptBatch = '';
      }
      
      transcriptBatch += tweetTranscript;
    };
  
    if (transcriptBatch.length > 0) {
      const structuredPrompt = this.formatStructuredPrompt(transcriptBatch);

      const response = await this.provider?.summarize(structuredPrompt);
      summarizedContent.push({
        type: "twitterTrendSummary",
        cid: `${createHash('sha256').update(response ?? '').digest('hex')}`,
        source: this.name,
        text: response,
        link: ``,
        date: Math.floor(new Date().getTime() / 1000),
        metadata: {
          summaryDate: Math.floor(new Date().getTime() / 1000),
        },
      });
      // console.log('Structured Prompt:', structuredPrompt);
    }
    return summarizedContent;
  }

  private formatStructuredTranscript(tweet: ContentItem): string {
    let prompt = ``;
    prompt += `\n***source***\n`;
    if (tweet.text) prompt += `text: ${tweet.text}\n`;
    if (tweet.link) prompt += `sources: ${tweet.link}\n`;
    if (tweet.metadata?.photos) prompt += `photos: ${tweet.metadata?.photos}\n`;
    if (tweet.metadata?.videos) prompt += `videos: ${tweet.metadata?.videos}\n`;
    prompt += `\n***source_end***\n\n`;
  
    return prompt;
  }

  private formatStructuredPrompt(transcript: string): string {
    return `Analyze these Twitter Trends:
            
1. Summary (max 500 words):
- Focus ONLY on the most important sections based on the topics provided: ${this.topics.join()}
- Highlight concrete solutions and implementations
- Be specific and VERY concise

2. Target Items (max 20 total):
- Promissing Tokens: Tokens from legitimate sources. 
- Diamond in the Rough: Tokens that aren't copycats, have real legs, will go to the moon.

For each action item, include:
- Clear description, the token symbol, the token address
- Who mentioned it

Chat transcript:
${transcript}

Return the analysis in the specified structured format. Be specific about technical content and avoid duplicating information.`;
  }
}
