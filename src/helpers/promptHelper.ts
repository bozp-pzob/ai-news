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
  return `You are an expert at converting structured JSON data into a concise markdown report for language model processing.
  
The markdown should:
- Use clear, hierarchical headings
- Include bullet lists for key points
- Be concise and easy to parse
- Exclude any raw JSON output
- Maintain hierarchical structure
- Focus on key information
- ONLY report on what has been done or accomplished
- DO NOT include statements about what is missing, not done, or needs improvement
- DO NOT include recommendations or suggestions
- DO NOT include phrases like "no technical discussions" or "limited content"
- Add a short source link and source name to the end of each source

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
 * @returns A formatted prompt string for the AI model
 */
export const createJSONPromptForTopics = (topic: string, objects: any[], dateStr: string): string => {
  let prompt = `Generate a summary for the topic. Focus on the following details:\n\n`;
  console.log(`[PromptHelper] Creating JSON prompt for topic: "${topic}" on date: ${dateStr} with ${objects.length} objects.`);
  objects.forEach((item, index) => {
    prompt += `\n***source ${index + 1}***\n`; // Add index to distinguish sources
    if (item.text) prompt += `text: ${item.text}\n`;
    
    // Combine main link and quoted link under the 'sources:' label
    let sourceLinks = [];
    if (item.link) sourceLinks.push(item.link);
    if (item.metadata?.quotedTweet?.link) {
      // Ensure we don't duplicate if the main link itself was the quoted link (edge case, unlikely here)
      if (!sourceLinks.includes(item.metadata.quotedTweet.link)) {
        sourceLinks.push(item.metadata.quotedTweet.link);
      }
    }
    if (sourceLinks.length > 0) {
      prompt += `sources: ${sourceLinks.join(', ')}\n`; // Present as a comma-separated list if multiple
    }

    if (item.metadata?.photos) prompt += `photos: ${item.metadata?.photos}\n`;
    if (item.metadata?.videos) prompt += `videos: ${item.metadata?.videos}\n`;
    
    // Include quoted tweet text and user information if available (link is now part of sources)
    if (item.metadata?.quotedTweet) {
      console.log(`[PromptHelper] Item ${index + 1} (ID: ${item.cid || 'N/A'}) has a quoted tweet. Adding its text & user to prompt.`);
      prompt += `\n--- Quoted Tweet Context ---\n`;
      if (item.metadata.quotedTweet.text) {
        prompt += `quoted_text_content: ${item.metadata.quotedTweet.text}\n`;
        console.log(`[PromptHelper] Added quoted_text_content for item ${index + 1}`);
      }
      // Link is handled above
      if (item.metadata.quotedTweet.userName) {
        prompt += `quoted_user_handle: @${item.metadata.quotedTweet.userName}\n`;
        console.log(`[PromptHelper] Added quoted_user_handle for item ${index + 1}`);
      }
      prompt += `--- End Quoted Tweet Context ---\n`;
    } else {
      // console.log(`[PromptHelper] Item ${index + 1} (ID: ${item.cid || 'N/A'}) does not have a quoted tweet.`);
    }
    
    prompt += `\n***source_end***\n\n`;
  });

  prompt += `Provide a detailed and comprehensive summary based on the ***sources*** above for the topic: '${topic}'. Be succinct, factual, and objective. Only include key information, updates, and developments. Merge similar sources into a longer summary if it makes sense. Integrate quoted tweet content with the main tweet. Exclude casual conversation, general sentiment, and unrelated commentary. Do not use information not present in the sources. All URLs under 'sources:' must be included in the 'sources' array of your JSON response.\n\n`;

  prompt += `Response MUST be a valid JSON object containing:\n- 'title': The title of the topic.\n- 'content': A list of messages with keys 'text', 'sources', 'images', and 'videos'.\n\n`;

  logPromptToFile(topic, dateStr, prompt); // Log the generated prompt
  return prompt;
}