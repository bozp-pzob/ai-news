/**
 * Tests for the Twitter service — tweet composition logic.
 *
 * These tests don't call the Twitter API; they validate the pure
 * composeTweet() function and the configuration checks.
 */

import { describe, it, expect } from 'vitest';
import { composeTweet, ShareableContent } from '../src/services/twitterService';

describe('twitterService.composeTweet', () => {
  const base: ShareableContent = {
    configSlug: 'elizaos',
    configName: 'ElizaOS',
    title: 'ElizaOS Daily Update — 2026-03-02',
    summary: 'The community discussed plugin architecture, AI model routing, and deployment strategies.',
    topics: ['ElizaOS', 'AI', 'Plugins'],
    date: '2026-03-02',
  };

  it('includes title, summary, hashtags, and URL', () => {
    const tweet = composeTweet(base);

    expect(tweet).toContain('ElizaOS Daily Update');
    expect(tweet).toContain('community discussed');
    expect(tweet).toContain('#ElizaOS');
    expect(tweet).toContain('/configs/elizaos');
    expect(tweet).toContain('date=2026-03-02');
  });

  it('stays within 275 characters (MAX_TWEET_LENGTH with 5-char safety margin)', () => {
    const tweet = composeTweet(base);
    expect(tweet.length).toBeLessThanOrEqual(275);
  });

  it('truncates long summaries with ellipsis', () => {
    const long = {
      ...base,
      summary: 'A'.repeat(500),
    };
    const tweet = composeTweet(long);

    expect(tweet.length).toBeLessThanOrEqual(275);
    expect(tweet).toContain('\u2026'); // ellipsis
  });

  it('limits to 3 hashtags', () => {
    const many = {
      ...base,
      topics: ['One', 'Two', 'Three', 'Four', 'Five'],
    };
    const tweet = composeTweet(many);

    const hashtags = tweet.match(/#\w+/g) || [];
    expect(hashtags.length).toBeLessThanOrEqual(3);
  });

  it('works with no topics', () => {
    const noTopics = { ...base, topics: undefined };
    const tweet = composeTweet(noTopics);
    expect(tweet).not.toContain('#');
    expect(tweet.length).toBeLessThanOrEqual(275);
  });

  it('works with empty summary', () => {
    const empty = { ...base, summary: '' };
    const tweet = composeTweet(empty);
    expect(tweet).toContain('ElizaOS Daily Update');
    expect(tweet.length).toBeLessThanOrEqual(275);
  });

  it('strips special characters from hashtags', () => {
    const special = {
      ...base,
      topics: ['AI & ML', 'C++', 'node.js'],
    };
    const tweet = composeTweet(special);

    expect(tweet).toContain('#AIML');
    expect(tweet).toContain('#C');
    expect(tweet).toContain('#nodejs');
  });
});
