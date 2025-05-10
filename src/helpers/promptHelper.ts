import * as fs from 'fs';
import * as path from 'path';

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
 * 1. Takes JSON summary data and a date string
 * 2. Formats a prompt that instructs an AI model to convert the JSON into markdown
 * 3. Includes specific guidelines for the markdown format
 * 
 * @param summaryData - The JSON data to be converted to markdown
 * @param dateStr - The date string associated with the summary data
 * @returns A formatted prompt string for the AI model
 */
export const createMarkdownPromptForJSON = (summaryData: any, dateStr: string): string => {
  const jsonStr = JSON.stringify(summaryData, null, 2);
  const repoNameFromData = summaryData.repository_name;

  return `You are an expert at converting structured JSON data into a concise markdown report for language model processing.
  The overall report WILL HAVE A MAIN H1 TITLE (e.g., "# Daily Report - ${dateStr}") PREPENDED TO YOUR OUTPUT SEPARATELY.
  YOUR TASK IS TO GENERATE THE MARKDOWN FOR THE SUBSEQUENT CONTENT SECTIONS.
  
The markdown YOU generate should:
- Use H2 (##) for the main heading of EACH section derived from the JSON data provided below. For example, if the JSON data describes Twitter activity, the heading should be formatted like "## Twitter Activity". If it describes GitHub activity for a repository (e.g., "${repoNameFromData}"), the heading should be formatted like "## GitHub Activity for ${repoNameFromData}".
- Include bullet lists for key points under the H2 headings.
- For each item or theme summarized, if there are 'sources', list them as the last bullet point for that item, comma-separated. Example: "- Sources: source_identifier_1, source_identifier_2"
- If a source is not a valid HTTP or HTTPS URL (e.g., it's an identifier like 'githubStatsSummary'), display it as plain text without attempting to create a markdown hyperlink.
- Be concise and easy to parse.
- Exclude any raw JSON output.
- Maintain hierarchical structure.
- Focus on key information.
- ONLY report on what has been done or accomplished.
- DO NOT include statements about what is missing, not done, or needs improvement.
- DO NOT include recommendations or suggestions.
- DO NOT include phrases like "no technical discussions" or "limited content".
- When summarizing content that originates from user posts (like tweets or forum messages), clearly attribute statements, opinions, or actions (e.g., retweets) to the specific user who made them (e.g., "@username mentioned...", "UserX retweeted UserY's post about...").

Given the following JSON summary for ${dateStr}, generate a markdown report accordingly:

${jsonStr}

Only return the final markdown text.`;
}

const logsDir = path.join(__dirname, '../../logs/prompts'); // Define a logs directory

// Helper function to ensure log directory exists
const ensureLogDirectoryExists = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created log directory: ${dirPath}`);
  }
};

// Helper function to write prompt to a file
const logPromptToFile = (topic: string, dateStr: string, prompt: string) => {
  ensureLogDirectoryExists(logsDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${dateStr}_${topic.replace(/\s+/g, '_')}_${timestamp}.log`;
  const filePath = path.join(logsDir, filename);
  try {
    fs.writeFileSync(filePath, prompt);
    console.log(`Prompt for topic '${topic}' logged to: ${filePath}`);
  } catch (error) {
    console.error(`Failed to write prompt to file ${filePath}:`, error);
  }
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
export const createJSONPromptForTopics = (topic: string, objects: any[], dateStr: string, customInstructions?: { title?: string, aiPrompt?: string, repositoryName?: string, dataProviderName?: string }): string => {
  let prompt = ``;
  console.log(`[PromptHelper] Creating JSON prompt for topic: "${topic}" on date: ${dateStr} with ${objects.length} objects.`);

  const defaultTwitterTitle = "Twitter Activity";
  const twitterTitle = customInstructions?.title || defaultTwitterTitle;
  const additionalAiPrompt = customInstructions?.aiPrompt || "";

  if (topic.toLowerCase().includes('tweet') || topic.toLowerCase().includes('twitter')) {
    prompt += `Generate a summary for the topic: '${topic}'.\n\n`;
    prompt += `Below are several tweet and retweet sources. Your primary task is to:\n`;
    prompt += `1. Analyze all tweet sources to identify the main themes, subjects, or discussions present in the content.\n`;
    prompt += `2. For each distinct theme you identify, provide a consolidated summary.\n`;
    prompt += `3. In your summary for each theme, incorporate information from all relevant source tweets. Make sure to clearly attribute who made specific statements or retweets (e.g., "User @X tweeted...", "User @Y retweeted @Z's post about...").\n`;
    prompt += `4. If multiple tweets discuss the same point within a theme, synthesize this information rather than listing each tweet separately.\n\n`;
    if (additionalAiPrompt) {
        prompt += `ADDITIONAL INSTRUCTIONS: ${additionalAiPrompt}\n\n`;
    }

    prompt += `--- Tweet Sources ---\n`;
    objects.forEach((item, index) => {
      let actingUser = 'UnknownUser';
      if (item.type === 'retweet' && item.metadata?.retweetedByUserName) {
        actingUser = item.metadata.retweetedByUserName;
      } else if (item.metadata?.authorUserName) {
        actingUser = item.metadata.authorUserName;
      } else if (item.source === 'twitter' && item.metadata?.originalUserName) {
         // Fallback for older tweet structures if authorUserName is missing but it's a known twitter source item
        actingUser = item.metadata.originalUserName;
      }
      
      prompt += `\n***source ${index + 1} (user: @${actingUser}, type: ${item.type})***\n`;

      if (item.type === 'retweet') {
        prompt += `retweet_details: Retweeted by @${item.metadata?.retweetedByUserName || 'unknown'} (Original post by @${item.metadata?.originalUserName || 'unknown'})\n`;
        if (item.text) prompt += `original_tweet_text: ${item.text}\n`;
      } else {
        if (item.text) prompt += `text: ${item.text}\n`;
      }
      
      let sourceLinks = [];
      if (item.link) sourceLinks.push(item.link);
      if (item.metadata?.quotedTweet?.link) {
        if (!sourceLinks.includes(item.metadata.quotedTweet.link)) {
          sourceLinks.push(item.metadata.quotedTweet.link);
        }
      }
      if (sourceLinks.length > 0) {
        prompt += `sources: ${sourceLinks.join(', ')}\n`;
      }

      if (item.metadata?.photos && item.metadata.photos.length > 0) prompt += `photos: ${item.metadata.photos.join(',')}\n`;
      if (item.metadata?.videos && item.metadata.videos.length > 0) prompt += `videos: ${item.metadata.videos.join(',')}\n`;
      
      if (item.metadata?.quotedTweet) {
        prompt += `\n--- Quoted Tweet Context ---\n`;
        if (item.metadata.quotedTweet.text) {
          prompt += `quoted_text_content: ${item.metadata.quotedTweet.text}\n`;
        }
        if (item.metadata.quotedTweet.userName) {
          prompt += `quoted_user_handle: @${item.metadata.quotedTweet.userName}\n`;
        }
        prompt += `--- End Quoted Tweet Context ---\n`;
      }
      prompt += `\n***source_end***\n\n`;
    });
    prompt += `--- End of Tweet Sources ---\n\n`;

    prompt += `Provide a detailed and comprehensive summary based on the themes you identify from the tweet sources above.\n`;
    prompt += `Focus on key information, updates, and developments.\n`;
    prompt += `Exclude casual conversation, general sentiment, and unrelated commentary. Do not use information not present in the sources. All URLs under 'sources:' must be included in the 'sources' array of your JSON response.\n\n`;

    prompt += `Response MUST be a valid JSON object containing:
- 'title': "${twitterTitle}".
- 'content': A list of messages. Each message in this list should represent a distinct THEME identified from the tweets.
  Each message (theme) should have keys:
    - 'theme_title': A short title for the identified theme.
    - 'text': A summary of the discussion for this theme, synthesizing information from relevant tweets and attributing to users.
    - 'sources': An array of all source URLs that contributed to this theme's summary.
    - 'images': An array of image URLs relevant to this theme (combine all relevant images for the theme).
    - 'videos': An array of video URLs relevant to this theme (combine all relevant videos for the theme).\n\n`;

  } else { // For non-Twitter topics, use existing logic (flattened list of sources)
    let nonTwitterTitle = customInstructions?.title;
    let finalAiPrompt = additionalAiPrompt; // For non-twitter, customInstructions.aiPrompt is the main way to add more detail

    if (!nonTwitterTitle) {
      if (topic.toLowerCase().includes('issue')) {
        // Assuming topic might be 'issue_elizaOS/eliza' or similar, or repo name is in customInstructions
        const repoName = customInstructions?.repositoryName || "the repository";
        nonTwitterTitle = `Issues for ${repoName}`;
      } else if (topic.toLowerCase().includes('pull_request') || topic.toLowerCase().includes('pr')) {
        const repoName = customInstructions?.repositoryName || "the repository";
        nonTwitterTitle = `Pull Requests for ${repoName}`;
      } else if (topic.toLowerCase().includes('market')) {
        nonTwitterTitle = "Crypto Market Update";
      } else {
        nonTwitterTitle = `Summary for ${topic}`;
      }
    }

    prompt = `Generate a summary. Focus on the following details:\n\n`;
    if (finalAiPrompt) {
        prompt += `ADDITIONAL INSTRUCTIONS: ${finalAiPrompt}\n\n`;
    }
    objects.forEach((item, index) => {
      prompt += `\n***source ${index + 1} (${item.type})***\n`; 

      if (item.type === 'retweet') {
        prompt += `retweet_details: Retweeted by @${item.metadata?.retweetedByUserName} (Original post by @${item.metadata?.originalUserName})\n`;
        if (item.text) prompt += `original_tweet_text: ${item.text}\n`;
      } else {
        if (item.text) prompt += `text: ${item.text}\n`;
      }
      
      let sourceLinks = [];
      if (item.link) sourceLinks.push(item.link);
      if (item.metadata?.quotedTweet?.link) {
        if (!sourceLinks.includes(item.metadata.quotedTweet.link)) {
          sourceLinks.push(item.metadata.quotedTweet.link);
        }
      }
      if (sourceLinks.length > 0) {
        prompt += `sources: ${sourceLinks.join(', ')}\n`;
      }

      if (item.metadata?.photos && item.metadata.photos.length > 0) prompt += `photos: ${item.metadata.photos.join(',')}\n`;
      if (item.metadata?.videos && item.metadata.videos.length > 0) prompt += `videos: ${item.metadata.videos.join(',')}\n`;
      
      if (item.metadata?.quotedTweet) {
        prompt += `\n--- Quoted Tweet Context ---\n`;
        if (item.metadata.quotedTweet.text) {
          prompt += `quoted_text_content: ${item.metadata.quotedTweet.text}\n`;
        }
        if (item.metadata.quotedTweet.userName) {
          prompt += `quoted_user_handle: @${item.metadata.quotedTweet.userName}\n`;
        }
        prompt += `--- End Quoted Tweet Context ---\n`;
      }
      prompt += `\n***source_end***\n\n`;
    });

    prompt += `Provide a detailed and comprehensive summary based on the ***sources*** above for the topic: '${topic}'. Be succinct, factual, and objective. Only include key information, updates, and developments. Merge similar sources into a longer summary if it makes sense. 
When a source is a 'retweet', its 'original_tweet_text' is the main content. Note who retweeted it and who the original author was. 
Integrate quoted tweet content (from '--- Quoted Tweet Context ---') with the main tweet or original_tweet_text it refers to. 
Exclude casual conversation, general sentiment, and unrelated commentary. Do not use information not present in the sources. All URLs under 'sources:' must be included in the 'sources' array of your JSON response.\n\n`;
    
    let responseFormatInstruction = `Response MUST be a valid JSON object containing:
- 'title': "${nonTwitterTitle}".
- 'content': A list of messages with keys 'text', 'sources', 'images', 'videos'.\n\n`;

    if (topic.toLowerCase().includes('issue') || topic.toLowerCase().includes('pull_request') || topic.toLowerCase().includes('pr')) {
      const repoNameForPrompt = customInstructions?.repositoryName || "the_repository_name"; // Fallback for instruction text
      responseFormatInstruction = `Response MUST be a valid JSON object containing:
- 'title': "${nonTwitterTitle}".
- 'repository_name': "${repoNameForPrompt}".
- 'content': A list of messages with keys 'text', 'sources', 'images', 'videos'.\n\n`;
    }

    if (topic.toLowerCase().includes('market')) {
      const marketDataProvider = customInstructions?.dataProviderName;
      responseFormatInstruction = `Response MUST be a valid JSON object containing:
- 'title': "${nonTwitterTitle}".
- 'data_provider': "${marketDataProvider || 'Not Specified'}".
- 'content': A list of messages with keys 'text', 'images', and 'videos' (the 'sources' key should be omitted or replaced by 'data_provider' at the top level).\n\n`;
    }
    prompt += responseFormatInstruction;
  }

  logPromptToFile(topic, dateStr, prompt); // Log the generated prompt
  return prompt;
}