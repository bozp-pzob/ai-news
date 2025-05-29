import * as fs from 'fs';
import * as path from 'path';
import { ensureDirectoryExists, writeFile } from './fileHelper';
import { ContentItem } from '../types'; // Ensure ContentItem is imported if not already

/**
 * Prompt generation utilities for the AI News Aggregator.
 * This module provides functions for creating prompts for AI models.
 * 
 * @module helpers
 */

/**
 * Creates a prompt for converting JSON summary data into markdown format.
 * 
 * This function:
 * 1. Takes JSON summary data (an array of categories/topics) and a date string
 * 2. Formats a prompt that instructs an AI model to convert the JSON into markdown
 * 3. Includes specific guidelines for the markdown format, with special handling for Twitter sources.
 * 
 * @param categories - The array of category/topic objects, where each object contains a `topic` identifier, a `title`, and `content` to be converted to markdown.
 * @param dateStr - The date string associated with the summary data.
 * @returns A formatted prompt string for the AI model.
 */
export const createMarkdownPromptForJSON = (categories: any[], dateStr: string): string => {
  const jsonStr = JSON.stringify(categories, null, 2); // Stringify the whole categories array

  // Attempt to find a repository_name from any of the categories if present (for general use in prompt)
  let repoNameFromData = "the repository";
  const ghCategory = categories.find(cat => cat.repository_name);
  if (ghCategory) {
    repoNameFromData = ghCategory.repository_name;
  }

  return `You are an expert at converting structured JSON data into a concise markdown report for language model processing.
  The overall report WILL HAVE A MAIN H1 TITLE (e.g., "# Daily Report - ${dateStr}") PREPENDED TO YOUR OUTPUT SEPARATELY.
  YOUR TASK IS TO GENERATE THE MARKDOWN FOR THE SUBSEQUENT CONTENT SECTIONS based on the JSON array of categories provided below.
  
For each category object in the JSON array:
- Use H2 (##) for the main heading of EACH section, using the 'title' field from the category object. For example, if a category title is "GitHub Activity for ${repoNameFromData}", the heading should be "## GitHub Activity for ${repoNameFromData}". If it's "Thematic Twitter Activity Summary", use that as the H2 heading.
- Under each H2, iterate through the 'content' array of that category.
- For each item/theme in the 'content' array:
  - If the category's 'topic' is 'twitter_activity':
    - Display the 'theme_title' (if present) as a bolded line or H3-like emphasis if appropriate, followed by the 'text' (AI summary for the theme) using bullet points or paragraphs for the summary.
    - After the theme's summary text, create a "Sources:" list. For each tweet object in the theme's 'contributing_tweets' array, create a sub-bullet point for its 'tweet_url'.
    - Example for a Twitter theme item:
      **AI Agents and Autonomous Systems** (This could be an H3 or bolded)
        - The AI's summary of the theme...
        - Sources:
          - https://twitter.com/user/status/123
          - https://twitter.com/user/status/456
  - For other topics (non-Twitter):
    - Display the 'text' (AI summary for the item) as a main bullet point or paragraph.
    - If the item has a 'sources' array, create a "Sources:" list. For each source object in the item's 'sources' array, list its 'link' property (if it's a valid URL and present) or its 'cid' (if no valid link or it's an identifier like 'githubStatsSummary') as a sub-bullet point.
    - Example for a non-Twitter item:
      - This is a summary point from the AI.
        - Sources:
          - https://github.com/org/repo/pull/1
          - analytics-id-xyz

General Markdown Guidelines:
- Be concise and easy to parse.
- Exclude any raw JSON output.
- Maintain hierarchical structure where appropriate.
- Focus on key information and accomplishments.
- DO NOT include statements about what is missing, not done, or needs improvement.
- DO NOT include recommendations or suggestions.
- DO NOT include phrases like "no technical discussions" or "limited content" unless that IS the summary from the AI.
- When summarizing content that originates from user posts (like tweets, especially if the AI includes attributions in its 'text' summary), ensure these attributions are preserved in the markdown.

Given the following JSON array of categories for ${dateStr}, generate a markdown report accordingly:

${jsonStr}

Only return the markdown text for the content sections. The H1 title will be added separately.`;
}


// Helper function to write prompt to a file
const logPromptToFile = (topic: string, dateStr: string, prompt: string) => {
  const logsDir = path.join(__dirname, '../../logs/prompts'); // Define a logs directory
  ensureDirectoryExists(logsDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${dateStr}_${topic.replace(/\s+/g, '_')}_${timestamp}`;
  console.log(`Prompt for topic '${topic}' logged to: ${filename}`);
  writeFile(logsDir, filename, prompt, 'log');
};

/**
 * Creates a prompt for generating a JSON summary of topics from content items.
 * 
 * This function:
 * 1. Takes a topic, an array of content items, and a date string
 * 2. Formats a prompt that instructs an AI model to generate a JSON summary
 * 3. Includes the content items with their text, links, and media
 * 4. Specifies the required JSON structure for the response
 * 
 * @param topic - The topic to summarize
 * @param objects - Array of content items related to the topic
 * @param dateStr - The date string associated with the content
 * @param customInstructions - Optional custom instructions for the AI, including a title for the output.
 * @returns A formatted prompt string for the AI model
 */
export const createJSONPromptForTopics = (topic: string, objects: ContentItem[], dateStr: string, customInstructions?: { title?: string, aiPrompt?: string, repositoryName?: string, dataProviderName?: string }): string => {
  let prompt = ``;
  console.log(`[PromptHelper] Creating JSON prompt for topic: "${topic}" on date: ${dateStr} with ${objects.length} objects.`);

  const defaultTwitterTitle = "Thematic Twitter Activity Summary";
  const twitterTitle = customInstructions?.title || defaultTwitterTitle;
  
  // The customInstructions.aiPrompt is now the primary way to define the AI's task for a topic
  // It should contain the full instructions including the expected JSON output structure.
  // The code below will primarily be for formatting the input data (objects) for the AI.

  if (topic.toLowerCase().includes('tweet') || topic.toLowerCase().includes('twitter')) {
    prompt += customInstructions?.aiPrompt || `Generate a summary for the topic: '${topic}'.\n`; // Use custom AI prompt if provided
    prompt += `\n--- Input Tweet Sources for Analysis (Details for each tweet are provided below) ---\n`;
    objects.forEach((item, index) => {
      let actingUser = 'UnknownUser';
      if (item.metadata?.authorUserName) {
        actingUser = item.metadata.authorUserName;
      } else if (item.type === 'retweet' && item.metadata?.retweetedByUserName) {
        actingUser = item.metadata.retweetedByUserName; // User who retweeted
      }

      prompt += `\n***Tweet Context ${index + 1}***\n`;
      prompt += `cid: ${item.cid}\n`;
      prompt += `tweet_url: ${item.link || 'N/A'}\n`;
      prompt += `author: @${actingUser}\n`;
      if (item.metadata?.authorProfileImageUrl) {
        prompt += `author_pfp_url: ${item.metadata.authorProfileImageUrl}\n`;
      }
      prompt += `type: ${item.type}\n`;
      if (item.type === 'retweet') {
        prompt += `original_author: @${item.metadata?.originalUserName || 'unknown'}\n`;
        prompt += `tweet_text_snippet: ${(item.metadata?.originalTweetText || item.text || '').substring(0, 280)}\n`; // Prefer original text for retweets
      } else {
        prompt += `tweet_text_snippet: ${(item.text || '').substring(0, 280)}\n`;
      }
      if (item.metadata?.photos && item.metadata.photos.length > 0) {
        prompt += `media_images: ${item.metadata.photos.join(',')}\n`;
      }
      if (item.metadata?.videos && item.metadata.videos.length > 0) {
        prompt += `media_videos: ${item.metadata.videos.join(',')}\n`;
      }
      if (typeof item.metadata?.likes === 'number') {
        prompt += `likes: ${item.metadata.likes}\n`;
      }
      if (typeof item.metadata?.retweets === 'number') {
        prompt += `retweets: ${item.metadata.retweets}\n`;
      }
      if (item.metadata?.thread?.conversationId) {
        prompt += `conversation_id: ${item.metadata.thread.conversationId}\n`;
      }
      if (typeof item.metadata?.thread?.isContinuation === 'boolean') {
        prompt += `is_continuation: ${item.metadata.thread.isContinuation}\n`;
      }
      if (item.metadata?.quotedTweet) {
        prompt += `--- Quoted Tweet Context ---\n`;
        prompt += `  quoted_tweet_url: ${item.metadata.quotedTweet.link || 'N/A'}\n`;
        prompt += `  quoted_author: @${item.metadata.quotedTweet.userName || 'unknown'}\n`;
        prompt += `  quoted_text_snippet: ${(item.metadata.quotedTweet.text || '').substring(0, 150)}\n`;
        prompt += `--- End Quoted Tweet Context ---\n`;
      }
      prompt += `***End Tweet Context ${index + 1}***\n`;
    });
    prompt += `\n--- End of Input Tweet Sources ---\n\n`;
    // The specific JSON output structure will now be part of customInstructions.aiPrompt passed from DailySummaryGenerator

  } else { // For non-Twitter topics
    prompt += customInstructions?.aiPrompt || `Generate a summary for the topic: '${topic}'.\n`;
    prompt += `\n--- Input Item Sources for Analysis (Details for each item are provided below) ---\n`;
    objects.forEach((item, index) => {
      prompt += `\n***Item Context ${index + 1}***\n`;
      prompt += `cid: ${item.cid}\n`;
      prompt += `link: ${item.link || 'N/A'}\n`;
      prompt += `type: ${item.type}\n`;
      prompt += `source_plugin: ${item.source}\n`; 
      prompt += `text_snippet: ${(item.text || '').substring(0, 500)}\n`; // Longer snippet for general items
      // Include more general metadata if useful, but avoid overwhelming the AI.
      // For now, focusing on what DailySummaryGenerator asks the AI to return (CIDs for enrichment).
      prompt += `***End Item Context ${index + 1}***\n`;
    });
    prompt += `\n--- End of Input Item Sources ---\n\n`;
    // The specific JSON output structure will be part of customInstructions.aiPrompt 
    // passed from DailySummaryGenerator for these topics too.
  }

  if (process.env.DEBUG || process.env.LOG_PROMPT) {
    logPromptToFile(topic, dateStr, prompt);
  }
  return prompt;
}