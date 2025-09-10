import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { ContentItem, MediaDownloadItem } from "../types";
import { logger } from "./cliHelper";

/**
 * file utility functions for the AI News Aggregator.
 * This module provides file helper functions used across the application.
 * 
 * @module helpers
 */

export const isMediaFile = (url: string, contentType?: string | null): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const videoExtensions = ['.mp4', '.webm', '.mov'];
    const mediaExtensions = [...imageExtensions, ...videoExtensions];

    // Check content type if available
    if (contentType) {
      return contentType.startsWith('image/') || contentType.startsWith('video/');
    }

    // Check file extension
    return mediaExtensions.some(ext => url.toLowerCase().endsWith(ext));
}

/**
   * Writes summary content to a file in the specified format.
   * @param outputPath - File string to write the file to
   * @param dateStr - Date string for the file name
   * @param content - Content to write
   * @param format - File format ('json' or 'md')
   * @returns Promise<void>
   */
export const writeFile = async (outputPath: string, dateStr: string, content: any, format: 'json' | 'md'): Promise<void> => {
    try {
      const dir = path.join(outputPath, format);
      ensureDirectoryExists(dir);
      
      const filePath = path.join(dir, `${dateStr}.${format}`);
      
      fs.writeFileSync(filePath, content);
    } catch (error) {
      console.error(`Error saving Discord summary to ${format} file ${dateStr}:`, error);
    }
}

/**
 * Ensures the output directory exists.
 * @param dirPath - Directory path to check/create
 */
export const ensureDirectoryExists = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Determines the file type directory based on content type and filename
 * @param contentType - MIME content type
 * @param filename - Original filename
 * @returns Directory name ('images', 'videos', 'audio', or 'documents')
 */
export const getFileTypeDir = (contentType: string, filename: string): string => {
  if (contentType) {
    if (contentType.startsWith('image/')) return 'images';
    if (contentType.startsWith('video/')) return 'videos';  
    if (contentType.startsWith('audio/')) return 'audio';
  }
  
  // Fallback to extension
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images';
  if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(ext)) return 'videos';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
  
  return 'documents';
}

/**
 * Generates a SHA-256 hash of file content
 * @param data - File data buffer
 * @returns SHA-256 hash as hex string
 */
export const generateContentHash = (data: Buffer): string => {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generates a SHA-256 hash of a URL
 * @param url - URL to hash
 * @returns SHA-256 hash as hex string
 */
export const generateUrlHash = (url: string): string => {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * Extracts filename from a URL
 * @param url - URL to extract filename from
 * @returns Extracted filename with fallback to 'unknown.jpg'
 */
export const extractFilenameFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || 'unknown';
    return filename.includes('.') ? filename : `${filename}.jpg`;
  } catch {
    return 'unknown.jpg';
  }
}

/**
 * Extracts media items from Discord raw data
 * @param item - ContentItem containing Discord raw data
 * @returns Array of MediaDownloadItem objects
 */
export const extractDiscordMediaData = (item: ContentItem): MediaDownloadItem[] => {
  const mediaItems: MediaDownloadItem[] = [];
  
  if (item.type !== 'discordRawData' || !item.text) {
    return mediaItems;
  }

  try {
    const data = JSON.parse(item.text);
    
    if (data.messages && Array.isArray(data.messages)) {
      for (const message of data.messages) {
        if (message.attachments && Array.isArray(message.attachments)) {
          for (const attachment of message.attachments) {
            if (attachment.url) {
              mediaItems.push({
                url: attachment.url,
                filename: attachment.filename || 'unknown',
                contentType: attachment.content_type,
                messageId: message.id,
                messageDate: message.ts,
                channelName: data.channel?.name || 'unknown',
                guildName: data.guild?.name || 'unknown',
                mediaType: 'attachment'
              });
            }
          }
        }

        if (message.embeds && Array.isArray(message.embeds)) {
          for (const embed of message.embeds) {
            if (embed.image?.url) {
              mediaItems.push({
                url: embed.image.url,
                filename: extractFilenameFromUrl(embed.image.url),
                messageId: message.id,
                messageDate: message.ts,
                channelName: data.channel?.name || 'unknown',
                guildName: data.guild?.name || 'unknown',
                mediaType: 'embed_image'
              });
            }
            
            if (embed.thumbnail?.url) {
              mediaItems.push({
                url: embed.thumbnail.url,
                filename: extractFilenameFromUrl(embed.thumbnail.url),
                messageId: message.id,
                messageDate: message.ts,
                channelName: data.channel?.name || 'unknown',
                guildName: data.guild?.name || 'unknown',
                mediaType: 'embed_thumbnail'
              });
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to parse Discord data: ${error}`);
  }

  return mediaItems;
}
