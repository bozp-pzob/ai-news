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
 * @param categories - The array of category/topic objects, where each object contains a `topic` identifier (though not strictly used by this prompt anymore for H2), a `title`, and `content` to be converted to markdown.
 * @param dateStr - The date string associated with the summary data.
 * @returns A formatted prompt string for the AI model.
 */
export const createMarkdownPromptForJSON = (categories: any[], dateStr: string): string => {
  const jsonStr = JSON.stringify(categories, null, 2); // Stringify the whole categories array

  // Attempt to find a repository_name from any of the categories if present (for general use in prompt)
  let repoNameFromData = "the repository"; // Default
  const ghCategoryWithRepo = categories.find(cat => cat.repository_name);
  if (ghCategoryWithRepo) {
    repoNameFromData = ghCategoryWithRepo.repository_name;
  }

  return `You are an expert at converting structured JSON data into a concise markdown report for language model processing.
  The overall report WILL HAVE A MAIN H1 TITLE (e.g., "# Daily Report - ${dateStr}") PREPENDED TO YOUR OUTPUT SEPARATELY.
  YOUR TASK IS TO GENERATE THE MARKDOWN FOR THE SUBSEQUENT CONTENT SECTIONS based on the JSON array of categories provided below.
  
For each category object in the JSON array:
- Use H2 (##) for the main heading of EACH section, using the 'title' field from the category object. For example, if a category title is "Pull Requests or Issues for ${repoNameFromData}", the heading should be "### Pull Requests for ${repoNameFromData}". If it's "Thematic Twitter Activity Summary", use that as the H2 heading.
- Under each H2, iterate through the 'content' array of that category.
- For each item/theme in the 'content' array:
  - If the category's 'topic' is 'twitter_activity':
    - Display the 'theme_title' (if present) as a H3 (###) heading, followed by the 'text' (AI summary for the theme) using bullet points or paragraphs for the summary.
    - After the theme's summary text, create a "Sources:" list. For each tweet object in the theme's 'contributing_tweets' array, create a sub-bullet point for its 'tweet_url'.
    - Example for a Twitter theme item:
      ### AI Agents and Autonomous Systems
        - The AI's summary of the theme...
        - Sources:
          - https://twitter.com/user/status/123
          - https://twitter.com/user/status/456
  - For other topics (non-Twitter):
    - If the category's 'topic' is 'crypto market', each item in its 'content' array is a string. Display each string as a direct bullet point.
      - Example for a crypto market item:
        - WETH is currently trading at $2,663.02.
    - For all other non-Twitter topics (e.g., 'issue', 'pull_request', 'github_summary', 'github_other'):
      - Each item in the 'content' array is an object which will have a 'text' property and may have an optional 'link' property.
      - Display the 'text' as a bullet point or paragraph.
      - If a 'link' property exists for an item, display it after its text, perhaps as " (Source: [link])" or on a new sub-bullet for clarity.
      - Example for an issue/PR item with a link:
        - Issue #123 by @user titled 'Fix bug' is open. (Source: https://github.com/issue/123)
      - Example for a summary item (e.g., from github_other) with a link:
        - A bug fix was implemented for TEE Tests. (Source: https://github.com/elizaOS/eliza/pull/4807)
      - Example for an item with no link:
        - This is a summary point from the AI with no direct source link provided for this entry.

General Markdown Guidelines:
- Be concise and easy to parse.
- Avoid unnecessary newlines, especially between items in a bulleted list. Ensure list items flow directly one after another.
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
  prompt += customInstructions?.aiPrompt || `Generate a summary for the topic: '${topic}'.\n`;
  prompt += `\n--- Input Item Sources for Analysis (Details for each item are provided below, identified by its 0-based [INDEX]) ---\n`;

  objects.forEach((item, index) => {
    prompt += `\n***Item Context [${index}]***\n`;
    prompt += `cid: ${item.cid}\n`;
    prompt += `link: ${item.link || 'N/A'}\n`;
    prompt += `type: ${item.type}\n`;
    prompt += `source_plugin: ${item.source}\n`;

    if (topic.toLowerCase().includes('tweet') || topic.toLowerCase().includes('twitter')) {
      let actingUser = 'UnknownUser';
      if (item.type === 'retweet' && item.metadata?.retweetedByUserName) {
        actingUser = item.metadata.retweetedByUserName;
      } else if (item.metadata?.authorUserName) {
        actingUser = item.metadata.authorUserName;
      }
      prompt += `author: @${actingUser}\n`;
      if (item.metadata?.authorProfileImageUrl) {
        prompt += `author_pfp_url: ${item.metadata.authorProfileImageUrl}\n`;
      }
      const isRetweet = item.type === 'retweet';
      prompt += `is_retweet: ${isRetweet}\n`;
      if (isRetweet) {
        prompt += `original_tweet_author: @${item.metadata?.originalUserName || 'unknown'}\n`;
        prompt += `tweet_text_snippet: ${(item.metadata?.originalTweetText || item.text || '').substring(0, 280)}\n`; 
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
        prompt += `--- Quoted Tweet Context for Item [${index}] ---\n`;
        prompt += `  quoted_tweet_url: ${item.metadata.quotedTweet.link || 'N/A'}\n`;
        prompt += `  quoted_author: @${item.metadata.quotedTweet.userName || 'unknown'}\n`;
        prompt += `  quoted_text_snippet: ${(item.metadata.quotedTweet.text || '').substring(0, 150)}\n`;
        prompt += `--- End Quoted Tweet Context for Item [${index}] ---\n`;
      }
    } else if (item.source.toLowerCase().includes('github') && (item.type.toLowerCase().includes('issue') || item.type.toLowerCase().includes('pull_request'))) {
      // GitHub Issue or Pull Request specific context
      prompt += `title: ${item.title || 'N/A'}\n`;
      prompt += `item_author: ${item.metadata?.author || 'unknown'}\n`;
      prompt += `item_number: ${item.metadata?.number || 'N/A'}\n`;
      prompt += `item_state: ${item.metadata?.state || 'unknown'}\n`;
      prompt += `item_createdAt: ${item.metadata?.createdAt || 'N/A'}\n`;
      if (item.metadata?.closedAt) {
        prompt += `item_closedAt: ${item.metadata.closedAt}\n`;
      }
      if (typeof item.metadata?.commentCount === 'number') {
        prompt += `item_commentCount: ${item.metadata.commentCount}\n`;
      }
      prompt += `text_snippet: ${(item.text || item.title || '').substring(0, 500)}\n`; // Use body or title for snippet
    } else { // For other general items
      prompt += `title: ${item.title || 'N/A'}\n`;
      prompt += `text_snippet: ${(item.text || '').substring(0, 500)}\n`; 
    }
    prompt += `***End Item Context [${index}]***\n`;
  });
  prompt += `\n--- End of Input Item Sources ---\n\n`;

  if (process.env.DEBUG || process.env.LOG_PROMPT) {
    logPromptToFile(topic, dateStr, prompt);
  }
  return prompt;
}
