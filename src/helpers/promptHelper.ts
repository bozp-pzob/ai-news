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

Given the following JSON summary for ${dateStr}, generate a markdown report accordingly:

${jsonStr}

Only return the final markdown text.`;
}

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
  
  objects.forEach((item) => {
    prompt += `\n***source***\n`;
    if (item.text) prompt += `text: ${item.text}\n`;
    if (item.link) prompt += `sources: ${item.link}\n`;
    if (item.metadata?.photos) prompt += `photos: ${item.metadata?.photos}\n`;
    if (item.metadata?.videos) prompt += `videos: ${item.metadata?.videos}\n`;
    prompt += `\n***source_end***\n\n`;
  });

  prompt += `Provide a clear and concise summary based on the ***sources*** above for the topic. DO NOT PULL DATA FROM OUTSIDE SOURCES'${topic}'. Combine similar sources into a longer summary if it makes sense.\n\n`;

  prompt += `Response MUST be a valid JSON object containing:\n- 'title': The title of the topic.\n- 'content': A list of messages with keys 'text', 'sources', 'images', and 'videos'.\n\n`;

  return prompt;
}