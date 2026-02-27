import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { ContentItem, MediaDownloadItem } from "../types";
import { logger } from "./cliHelper";
import { extractAttachmentMedia, extractEmbedMedia, extractStickerMedia } from "./mediaHelper";
import { safeJsonParse, isValidArray } from "./generalHelper";

/**
 * File utility functions for Digital Gardener.
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
 * Validates that a file path is safe to use (prevents path traversal attacks)
 * @param filePath - File path to validate
 * @returns True if path is safe, false otherwise
 */
export const isValidPath = (filePath: string): boolean => {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  // Check for path traversal attempts
  const dangerous = ['../', '..\\', '~/', '/etc/', '/root/', '/home/'];
  if (dangerous.some(pattern => filePath.includes(pattern))) {
    return false;
  }
  
  // Ensure path is relative and not absolute
  if (path.isAbsolute(filePath)) {
    return false;
  }
  
  return true;
};

/**
 * Sanitizes a filename by removing dangerous characters
 * @param filename - Original filename
 * @returns Sanitized filename
 */
export const sanitizeFilename = (filename: string): string => {
  if (!filename || typeof filename !== 'string') {
    return 'unknown';
  }
  
  // Remove dangerous characters and replace with underscores
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_') // Remove leading dots
    .substring(0, 255); // Limit length
};

/**
 * Validates that a URL is safe to download from
 * @param url - URL to validate
 * @returns True if URL is safe, false otherwise
 */
export const isValidUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const urlObj = new URL(url);
    
    // Only allow HTTPS and HTTP
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
    
    // Block localhost and private IP ranges
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return false;
    }
    
    // Block private IP ranges (basic check)
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensures the output directory exists safely.
 * @param dirPath - Directory path to check/create
 */
export const ensureDirectoryExists = (dirPath: string) => {
    // Validate path before creating
    if (!isValidPath(dirPath)) {
      throw new Error(`Invalid directory path: ${dirPath}`);
    }
    
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
 * Computes a deterministic SHA-256 hash of an array of ContentItems.
 * Used by generators to detect whether source data has changed since the last summary.
 * Items are sorted by cid for deterministic ordering, and only cid + text are included.
 * @param items - Array of content items to hash
 * @returns SHA-256 hash as hex string
 */
export const computeContentHash = (items: ContentItem[]): string => {
  const sorted = [...items].sort((a, b) => a.cid.localeCompare(b.cid));
  const canonical = sorted.map(item => ({ cid: item.cid, text: item.text }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
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
    const data = safeJsonParse(item.text, {} as any);
    
    if (data.messages && isValidArray(data.messages)) {
      for (const message of data.messages) {
        const channelName = data.channel?.name || 'unknown';
        const guildName = data.guild?.name || 'unknown';

        // Process attachments using shared utility
        if (message.attachments && isValidArray(message.attachments)) {
          for (const attachment of message.attachments) {
            const mediaItem = extractAttachmentMedia(
              attachment,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            if (mediaItem) {
              mediaItems.push(mediaItem);
            }
          }
        }

        // Process embeds using shared utility
        if (message.embeds && isValidArray(message.embeds)) {
          for (const embed of message.embeds) {
            const embedMedia = extractEmbedMedia(
              embed,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            mediaItems.push(...embedMedia);
          }
        }

        // Process stickers using shared utility
        if (message.sticker_items && isValidArray(message.sticker_items)) {
          for (const sticker of message.sticker_items) {
            const mediaItem = extractStickerMedia(
              sticker,
              message.id,
              message.ts,
              channelName,
              guildName
            );
            if (mediaItem) {
              mediaItems.push(mediaItem);
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

/**
 * Recursively remove empty arrays and null/undefined values from an object.
 * Converts single-item arrays to scalars (keeping the same key name).
 * This follows the sparse object pattern, reducing JSON file size by ~15-20%.
 *
 * Output format:
 *   - 0 items: omit key entirely
 *   - 1 item: key: value (scalar)
 *   - 2+ items: key: [values] (array)
 *
 * Example:
 *   { images: [], videos: ["url"], sources: ["url1", "url2"] }
 *   → { videos: "url", sources: ["url1", "url2"] }
 *
 * @param obj - Object to clean
 * @returns Cleaned object with no empty arrays or null/undefined values
 */
export const removeEmptyArrays = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(removeEmptyArrays).filter(x => x !== undefined);
  }

  if (obj && typeof obj === 'object') {
    const result: any = {};

    for (const [key, value] of Object.entries(obj)) {
      const cleaned = removeEmptyArrays(value);

      // Skip empty arrays (omit key entirely)
      if (Array.isArray(cleaned) && cleaned.length === 0) {
        continue;
      }

      // Skip null/undefined
      if (cleaned === null || cleaned === undefined) {
        continue;
      }

      // Convert single-item arrays to scalars (keep same key name)
      if (Array.isArray(cleaned) && cleaned.length === 1) {
        result[key] = cleaned[0];
        continue;
      }

      result[key] = cleaned;
    }

    return result;
  }

  return obj;
};

/**
 * Calculate size reduction percentage
 *
 * @param originalSize - Original size in bytes
 * @param cleanedSize - Cleaned size in bytes
 * @returns Percentage reduction (e.g., "15.2%")
 */
export const calculateReduction = (originalSize: number, cleanedSize: number): string => {
  const reduction = ((originalSize - cleanedSize) / originalSize * 100).toFixed(1);
  return `${reduction}%`;
};

/**
 * Format bytes as human-readable size
 *
 * @param bytes - Size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "234 KB")
 */
export const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
};

/**
 * Writes JSON data to a file, ensuring the directory exists.
 * @param filePath - Full path to the output file
 * @param data - Data to serialize as JSON
 * @param pretty - Whether to pretty-print the JSON (default: true)
 * @param clean - Whether to remove empty arrays before writing (default: false)
 */
export const writeJsonFile = (filePath: string, data: unknown, pretty: boolean = true, clean: boolean = false): void => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const processedData = clean ? removeEmptyArrays(data) : data;
  const content = pretty ? JSON.stringify(processedData, null, 2) : JSON.stringify(processedData);
  fs.writeFileSync(filePath, content);
}

/**
 * Detect actual file type by examining file content (magic numbers)
 * @param filePath - Path to file to examine
 * @returns File type directory name ('images', 'videos', 'audio', 'documents') or 'unknown'
 */
export const detectActualFileType = (filePath: string): string => {
  try {
    const buffer = fs.readFileSync(filePath);
    const chunk = buffer.slice(0, Math.min(buffer.length, 512));
    const header = chunk.toString('utf8', 0, Math.min(chunk.length, 100));

    // Check for HTML content
    if (header.includes('<!DOCTYPE html') || header.includes('<html') || header.includes('<HTML')) {
      return 'documents';
    }

    // Check magic numbers for common file types
    const hex = chunk.toString('hex', 0, Math.min(chunk.length, 16));

    // Image formats
    if (hex.startsWith('89504e47')) return 'images'; // PNG
    if (hex.startsWith('ffd8ff')) return 'images'; // JPEG
    if (hex.startsWith('47494638')) return 'images'; // GIF
    if (hex.startsWith('52494646') && buffer.toString('utf8', 8, 12) === 'WEBP') return 'images'; // WEBP
    if (hex.startsWith('424d')) return 'images'; // BMP

    // Video formats
    if (hex.startsWith('00000000667479704d503441')) return 'videos'; // MP4
    if (hex.startsWith('1a45dfa3')) return 'videos'; // MKV/WEBM
    if (hex.startsWith('464c5601')) return 'videos'; // FLV

    // Audio formats
    if (hex.startsWith('494433') || hex.startsWith('fff3') || hex.startsWith('fffb')) return 'audio'; // MP3
    if (hex.startsWith('52494646') && buffer.toString('utf8', 8, 12) === 'WAVE') return 'audio'; // WAV
    if (hex.startsWith('4f676753')) return 'audio'; // OGG
    if (hex.startsWith('664c6143')) return 'audio'; // FLAC

  } catch {
    // Silent fail - return unknown
  }

  return 'unknown';
}

/**
 * Async version of getFileTypeDir that can check actual file content
 * @param contentType - MIME content type
 * @param filename - Original filename
 * @param filePath - Optional path to downloaded file for magic number detection
 * @returns File type directory name ('images', 'videos', 'audio', 'documents')
 */
export const getFileTypeDirAsync = async (contentType: string, filename: string, filePath?: string): Promise<string> => {
  // If we have the downloaded file, check its actual content type
  if (filePath && fs.existsSync(filePath)) {
    const actualType = detectActualFileType(filePath);
    if (actualType !== 'unknown') {
      return actualType;
    }
  }

  // Use provided content type if available
  if (contentType) {
    if (contentType.startsWith('image/')) return 'images';
    if (contentType.startsWith('video/')) return 'videos';
    if (contentType.startsWith('audio/')) return 'audio';
    if (contentType.startsWith('text/html')) return 'documents';
  }

  // Fallback to extension
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images';
  if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(ext)) return 'videos';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';

  return 'documents';
}
