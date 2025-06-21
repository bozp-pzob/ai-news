import fs from "fs";
import path from "path";

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
