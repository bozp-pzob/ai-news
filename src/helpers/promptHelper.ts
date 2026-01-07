/**
 * Prompt generation utilities for the AI News Aggregator.
 * This module provides functions for creating prompts for AI models.
 *
 * @module helpers
 */

import { MediaLookup } from "./mediaLookup";

/**
 * Options for prompt generation with media support
 */
export interface PromptMediaOptions {
  mediaLookup?: MediaLookup;
  dateStr?: string;
  maxImagesPerSource?: number;
  maxVideosPerSource?: number;
}

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

export const createJSONPromptForTopics = (
  topic: string,
  objects: any[],
  dateStr: string,
  mediaOptions?: PromptMediaOptions
): string => {
  let prompt = `Generate a summary for the topic. Focus on the following details:\n\n`;

  const maxImages = mediaOptions?.maxImagesPerSource ?? 5;
  const maxVideos = mediaOptions?.maxVideosPerSource ?? 3;
  let hasMedia = false;

  objects.forEach((item) => {
    prompt += `\n***source***\n`;
    if (item.text) prompt += `text: ${item.text}\n`;
    if (item.link) prompt += `sources: ${item.link}\n`;

    // Get media from metadata (existing behavior)
    let photos = item.metadata?.photos || [];
    let videos = item.metadata?.videos || [];
    // Get enricher-generated media
    const posters = item.metadata?.images || [];
    const memes = (item.metadata?.memes || []).map((m: any) =>
      typeof m === 'string' ? m : m.url
    ).filter(Boolean);

    // Always extract media from Discord raw data
    // If MediaLookup available, will use CDN URLs; otherwise Discord URLs
    const extractedMedia = extractMediaFromItem(
      item,
      mediaOptions?.mediaLookup || null,
      dateStr
    );

    if (extractedMedia.images.length > 0) {
      photos = [...new Set([...photos, ...extractedMedia.images])];
    }
    if (extractedMedia.videos.length > 0) {
      videos = [...new Set([...videos, ...extractedMedia.videos])];
    }

    // Limit and add to prompt
    if (photos.length > 0) {
      prompt += `photos: ${photos.slice(0, maxImages).join(", ")}\n`;
      hasMedia = true;
    }
    if (videos.length > 0) {
      prompt += `videos: ${videos.slice(0, maxVideos).join(", ")}\n`;
      hasMedia = true;
    }
    if (posters.length > 0) {
      prompt += `posters: ${posters.join(", ")}\n`;
      hasMedia = true;
    }
    if (memes.length > 0) {
      prompt += `memes: ${memes.join(", ")}\n`;
      hasMedia = true;
    }
    prompt += `\n***source_end***\n\n`;
  });

  prompt += `Provide a clear and concise summary based on the ***sources*** above for the topic. DO NOT PULL DATA FROM OUTSIDE SOURCES'${topic}'. Combine similar sources into a longer summary if it makes sense.\n\n`;

  prompt += `Response MUST be a valid JSON object containing:\n- 'title': The title of the topic.\n- 'content': A list of messages with keys 'text', 'sources', 'images', 'videos', 'posters', and 'memes'.\n\n`;

  // Add instruction about using provided media URLs
  if (hasMedia) {
    prompt += `IMPORTANT: When including images, videos, posters, or memes in your response, use the exact URLs provided above.\n\n`;
  }

  return prompt;
};

/**
 * Extract media URLs directly from Discord raw data
 * Pulls URLs from message attachments and embeds
 */
function extractMediaFromDiscordRawData(item: any): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];

  // Try to parse Discord raw data from item.text
  if (item.type === "discordRawData" && item.text) {
    try {
      const rawData = JSON.parse(item.text);

      // Get all messages and extract media URLs
      if (rawData.messages && Array.isArray(rawData.messages)) {
        for (const msg of rawData.messages) {
          // Extract from attachments
          if (msg.attachments && Array.isArray(msg.attachments)) {
            for (const att of msg.attachments) {
              const url = att.url || att.proxy_url;
              if (!url) continue;

              const contentType = att.content_type || "";
              if (contentType.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp)$/i.test(url)) {
                images.push(url);
              } else if (contentType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(url)) {
                videos.push(url);
              }
            }
          }

          // Extract from embeds
          if (msg.embeds && Array.isArray(msg.embeds)) {
            for (const embed of msg.embeds) {
              // Embed image
              if (embed.image?.url) {
                images.push(embed.image.url);
              }
              // Embed thumbnail
              if (embed.thumbnail?.url) {
                images.push(embed.thumbnail.url);
              }
              // Embed video
              if (embed.video?.url) {
                videos.push(embed.video.url);
              }
            }
          }
        }
      }
    } catch {
      // Not JSON or parse error, ignore
    }
  }

  return { images, videos };
}

/**
 * Extract media URLs from a content item
 * First extracts Discord URLs from raw data, then optionally maps to CDN URLs
 */
function extractMediaFromItem(
  item: any,
  mediaLookup: MediaLookup | null,
  dateStr: string
): { images: string[]; videos: string[] } {
  // First, extract Discord URLs directly from raw data
  const discordMedia = extractMediaFromDiscordRawData(item);

  // If no MediaLookup, return Discord URLs as-is
  if (!mediaLookup) {
    return discordMedia;
  }

  // If MediaLookup available, try to map Discord URLs to CDN URLs
  const images: string[] = [];
  const videos: string[] = [];

  // For now, keep Discord URLs but also add any CDN URLs we can find by message ID
  // This allows gradual migration - Discord URLs work, CDN URLs are added when available
  if (item.type === "discordRawData" && item.text) {
    try {
      const rawData = JSON.parse(item.text);
      if (rawData.messages && Array.isArray(rawData.messages)) {
        for (const msg of rawData.messages) {
          const mediaRefs = mediaLookup.getMediaForMessage(msg.id);
          for (const ref of mediaRefs) {
            if (ref.type === "image") {
              images.push(ref.url);
            } else if (ref.type === "video") {
              videos.push(ref.url);
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Merge: prefer CDN URLs if available, otherwise use Discord URLs
  const finalImages = images.length > 0 ? images : discordMedia.images;
  const finalVideos = videos.length > 0 ? videos : discordMedia.videos;

  return { images: finalImages, videos: finalVideos };
}