/**
 * Twitter/X posting service.
 *
 * Supports two modes:
 *  1. **Platform-level posting** — Uses a single set of app credentials
 *     (`TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`,
 *     `TWITTER_ACCESS_SECRET`) for a bot account. Good for auto-posting
 *     summaries from the platform's own Twitter account.
 *
 *  2. **Per-user posting** — (Future) Uses OAuth 2.0 user tokens stored
 *     in `external_connections` for users who link their Twitter account.
 *
 * Uses `twitter-api-v2` for the Twitter v2 API.
 *
 * @module services/twitterService
 */

import { TwitterApi } from 'twitter-api-v2';
import { logger } from '../helpers/cliHelper';

// ============================================
// Types
// ============================================

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
}

export interface ShareableContent {
  /** Config slug (for URL construction) */
  configSlug: string;
  /** Config display name */
  configName: string;
  /** Summary title (e.g., "ElizaOS Daily Update — 2026-03-02") */
  title: string;
  /** Brief summary text (will be truncated to fit tweet limit) */
  summary: string;
  /** Optional topics/hashtags */
  topics?: string[];
  /** Date string (YYYY-MM-DD) */
  date: string;
}

// ============================================
// Configuration
// ============================================

function getBaseUrl(): string {
  return process.env.SITE_URL || process.env.BASE_URL || 'https://digitalgardener.com';
}

function isConfigured(): boolean {
  return !!(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_SECRET
  );
}

/**
 * Get a Twitter client authenticated with the platform bot credentials.
 * Returns null if credentials aren't configured.
 */
function getPlatformClient(): TwitterApi | null {
  if (!isConfigured()) return null;

  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });
}

// ============================================
// Tweet composition
// ============================================

/** Max tweet length (280 chars). We reserve 5 for safety. */
const MAX_TWEET_LENGTH = 275;

/**
 * Compose a tweet from shareable content.
 *
 * Format:
 *   {title}
 *
 *   {summary — truncated}
 *
 *   {hashtags}
 *   {url}
 */
export function composeTweet(content: ShareableContent): string {
  const url = `${getBaseUrl()}/configs/${content.configSlug}?date=${content.date}`;

  // Build hashtags from topics (max 3, remove special chars)
  const hashtags = (content.topics || [])
    .slice(0, 3)
    .map((t) => `#${t.replace(/[^a-zA-Z0-9]/g, '')}`)
    .filter((h) => h.length > 1 && h.length <= 25)
    .join(' ');

  // Fixed parts
  const title = content.title.slice(0, 80);
  const footer = [hashtags, url].filter(Boolean).join('\n');
  const fixedLength = title.length + 2 + footer.length + 2; // +2 for newlines before/after

  // Truncate summary to fit
  const maxSummary = MAX_TWEET_LENGTH - fixedLength;
  let summary = content.summary;
  if (summary.length > maxSummary) {
    summary = summary.slice(0, maxSummary - 1) + '\u2026'; // ellipsis
  }

  return `${title}\n\n${summary}\n\n${footer}`;
}

// ============================================
// Posting
// ============================================

/**
 * Post a tweet using the platform bot account.
 */
export async function postTweet(text: string): Promise<TweetResult> {
  const client = getPlatformClient();
  if (!client) {
    return { success: false, error: 'Twitter credentials not configured' };
  }

  try {
    const result = await client.v2.tweet(text);
    const tweetId = result.data.id;
    // Construct URL (we don't have the username easily, but the ID works)
    const tweetUrl = `https://x.com/i/status/${tweetId}`;

    logger.info(`TwitterService: Tweet posted successfully (${tweetId})`);
    return { success: true, tweetId, tweetUrl };
  } catch (error: any) {
    const msg = error?.data?.detail || error?.message || String(error);
    logger.error('TwitterService: Failed to post tweet', msg);
    return { success: false, error: msg };
  }
}

/**
 * Share a summary to Twitter.
 *
 * Composes the tweet text from the content and posts it.
 * Can be called from the share API endpoint or the auto-post hook.
 */
export async function shareSummary(content: ShareableContent): Promise<TweetResult> {
  const text = composeTweet(content);
  return postTweet(text);
}

// ============================================
// Auto-post support
// ============================================

/**
 * Whether auto-posting is enabled for the platform.
 * Requires Twitter credentials + explicit opt-in via TWITTER_AUTO_POST=true.
 */
export function isAutoPostEnabled(): boolean {
  return isConfigured() && process.env.TWITTER_AUTO_POST === 'true';
}

// ============================================
// Exports
// ============================================

export const twitterService = {
  isConfigured,
  isAutoPostEnabled,
  composeTweet,
  postTweet,
  shareSummary,
};
