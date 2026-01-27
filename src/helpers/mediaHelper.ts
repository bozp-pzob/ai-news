/**
 * Shared media processing utilities for Discord content.
 * Provides common functions for processing attachments, embeds, stickers,
 * manifest-based lookups, and CDN URL swapping.
 *
 * @module helpers/mediaHelper
 */

import fs from "fs";
import path from "path";
import {
  DiscordAttachment,
  DiscordEmbed,
  DiscordSticker,
  MediaDownloadItem,
  MediaManifest,
  MediaManifestEntry,
} from "../types";
import { extractFilenameFromUrl, removeEmptyArrays } from "./fileHelper";

/**
 * Process a Discord attachment into standardized format
 * @param attachment - Raw attachment data from Discord.js or parsed JSON
 * @returns Standardized DiscordAttachment object
 */
export const processDiscordAttachment = (attachment: any): DiscordAttachment => {
  return {
    id: attachment.id,
    filename: attachment.name || attachment.filename || 'unknown',
    title: attachment.title || undefined,
    description: attachment.description || undefined,
    content_type: attachment.contentType || attachment.content_type || undefined,
    size: attachment.size,
    url: attachment.url,
    proxy_url: attachment.proxyURL || attachment.proxy_url,
    height: attachment.height || undefined,
    width: attachment.width || undefined,
    duration_secs: attachment.duration || attachment.duration_secs || undefined,
    waveform: attachment.waveform || undefined,
    ephemeral: attachment.ephemeral || undefined,
    flags: attachment.flags?.bitfield || attachment.flags || undefined
  };
};

/**
 * Process a Discord embed into standardized format
 * @param embed - Raw embed data from Discord.js or parsed JSON
 * @returns Standardized DiscordEmbed object
 */
export const processDiscordEmbed = (embed: any): DiscordEmbed => {
  return {
    title: embed.title || undefined,
    description: embed.description || undefined,
    url: embed.url || undefined,
    color: embed.color || undefined,
    image: embed.image ? {
      url: embed.image.url,
      proxy_url: embed.image.proxyURL || embed.image.proxy_url || undefined,
      height: embed.image.height || undefined,
      width: embed.image.width || undefined
    } : undefined,
    thumbnail: embed.thumbnail ? {
      url: embed.thumbnail.url,
      proxy_url: embed.thumbnail.proxyURL || embed.thumbnail.proxy_url || undefined,
      height: embed.thumbnail.height || undefined,
      width: embed.thumbnail.width || undefined
    } : undefined,
    video: embed.video ? {
      url: embed.video.url || undefined,
      proxy_url: embed.video.proxyURL || embed.video.proxy_url || undefined,
      height: embed.video.height || undefined,
      width: embed.video.width || undefined
    } : undefined
  };
};

/**
 * Process a Discord sticker into standardized format
 * @param sticker - Raw sticker data from Discord.js or parsed JSON
 * @returns Standardized DiscordSticker object
 */
export const processDiscordSticker = (sticker: any): DiscordSticker => {
  return {
    id: sticker.id,
    name: sticker.name,
    format_type: sticker.format || sticker.format_type,
    description: sticker.description || undefined
  };
};

/**
 * Extract media download items from a Discord attachment
 * @param attachment - Discord attachment object
 * @param messageId - ID of the message containing the attachment
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns MediaDownloadItem if attachment has downloadable media, undefined otherwise
 */
export const extractAttachmentMedia = (
  attachment: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem | undefined => {
  if (!attachment.url) {
    return undefined;
  }

  return {
    url: attachment.url,
    filename: attachment.filename || attachment.name || 'unknown',
    contentType: attachment.content_type || attachment.contentType,
    messageId,
    messageDate,
    channelName,
    guildName,
    mediaType: 'attachment'
  };
};

/**
 * Extract media download items from a Discord embed
 * @param embed - Discord embed object
 * @param messageId - ID of the message containing the embed
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns Array of MediaDownloadItem objects for all media in the embed
 */
export const extractEmbedMedia = (
  embed: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem[] => {
  const mediaItems: MediaDownloadItem[] = [];

  // Extract image
  if (embed.image?.url) {
    mediaItems.push({
      url: embed.image.url,
      filename: extractFilenameFromUrl(embed.image.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_image'
    });
  }

  // Extract thumbnail
  if (embed.thumbnail?.url) {
    mediaItems.push({
      url: embed.thumbnail.url,
      filename: extractFilenameFromUrl(embed.thumbnail.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_thumbnail'
    });
  }

  // Extract video
  if (embed.video?.url) {
    mediaItems.push({
      url: embed.video.url,
      filename: extractFilenameFromUrl(embed.video.url),
      messageId,
      messageDate,
      channelName,
      guildName,
      mediaType: 'embed_video'
    });
  }

  return mediaItems;
};

/**
 * Extract media download items from a Discord sticker
 * @param sticker - Discord sticker object
 * @param messageId - ID of the message containing the sticker
 * @param messageDate - Timestamp of the message
 * @param channelName - Name of the channel
 * @param guildName - Name of the guild/server
 * @returns MediaDownloadItem if sticker has downloadable media, undefined otherwise
 */
export const extractStickerMedia = (
  sticker: any,
  messageId: string,
  messageDate: string,
  channelName: string,
  guildName: string
): MediaDownloadItem | undefined => {
  if (!sticker.url) {
    return undefined;
  }

  return {
    url: sticker.url,
    filename: `${sticker.name}.${sticker.format_type === 1 ? 'png' : 'gif'}`,
    messageId,
    messageDate,
    channelName,
    guildName,
    mediaType: 'sticker'
  };
};

/**
 * Normalize Discord CDN URL for consistent hashing
 * Strips expiring signature params (ex, is, hm) so same file gets same hash
 */
export const normalizeDiscordUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    if (urlObj.host === 'cdn.discordapp.com' || urlObj.host === 'media.discordapp.net') {
      urlObj.searchParams.delete('ex');  // expiry timestamp
      urlObj.searchParams.delete('is');  // issued timestamp
      urlObj.searchParams.delete('hm');  // hash/signature
      return urlObj.toString();
    }
  } catch {}
  return url;
};

/**
 * Check if file is a spoiler (filename starts with SPOILER_)
 */
export const isSpoiler = (filename: string): boolean => {
  return filename.startsWith('SPOILER_');
};

/**
 * Check if content is animated based on hash prefix or filename
 * Discord uses 'a_' prefix for animated avatars/icons
 */
export const isAnimated = (hashOrFilename: string): boolean => {
  return hashOrFilename.startsWith('a_') || hashOrFilename.toLowerCase().endsWith('.gif');
};

/**
 * Get sticker format extension based on format_type
 * Format types: 1=PNG, 2=APNG, 3=Lottie, 4=GIF
 */
export const getStickerExtension = (formatType: number): string => {
  switch (formatType) {
    case 1: return 'png';   // PNG
    case 2: return 'png';   // APNG (still uses .png extension)
    case 3: return 'json';  // Lottie animation
    case 4: return 'gif';   // GIF
    default: return 'png';
  }
};

/**
 * Map content-type to file extension
 * Based on actual content types found in Discord data
 */
export const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/x-python': 'py',
  'video/mp2t': 'ts',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
};

/**
 * Valid file extensions that can be extracted from URLs
 */
export const VALID_URL_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif',
  'mp4', 'webm', 'mov', 'avi', 'mkv',
  'mp3', 'wav', 'ogg', 'flac',
  'pdf', 'txt', 'json', 'md', 'csv', 'py', 'log',
]);

/**
 * Get validated file extension from content-type, URL, or default
 * Priority: content_type > URL path > default based on media_type
 */
export const getValidatedExtension = (
  contentType: string | undefined,
  url: string,
  mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker'
): string => {
  // 1. Try content-type (most reliable for Discord attachments)
  if (contentType) {
    // Handle charset suffix: "text/plain; charset=utf-8" -> "text/plain"
    const baseType = contentType.split(';')[0].trim().toLowerCase();
    const ext = CONTENT_TYPE_TO_EXT[baseType];
    if (ext) return ext;
  }

  // 2. Try extracting from URL path (for embeds)
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    if (match) {
      const ext = match[1].toLowerCase();
      if (VALID_URL_EXTENSIONS.has(ext)) {
        return ext;
      }
    }
  } catch {}

  // 3. Default based on media type
  switch (mediaType) {
    case 'embed_video': return 'mp4';
    case 'sticker': return 'png';
    default: return 'jpg'; // embed_image, embed_thumbnail, attachment fallback
  }
};
// ============================================================================
// Media Lookup and CDN URL Swapping
// ============================================================================

/**
 * Media item with CDN URL for injection into prompts
 */
export interface MediaReference {
  url: string;
  type: "image" | "video";
  filename: string;
  messageId: string;
  channelId: string;
}

/**
 * MediaLookup class for matching CDN media to messages
 */
export class MediaLookup {
  private manifestPath: string;
  private manifest: MediaManifest | null = null;
  private byMessageId: Map<string, MediaManifestEntry[]> = new Map();
  private byDate: Map<string, MediaManifestEntry[]> = new Map();
  private byChannelDate: Map<string, MediaManifestEntry[]> = new Map();

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath;
  }

  /**
   * Load and index the manifest
   */
  async load(): Promise<boolean> {
    if (!fs.existsSync(this.manifestPath)) {
      console.warn(`[MediaLookup] Manifest not found: ${this.manifestPath}`);
      return false;
    }

    try {
      const content = fs.readFileSync(this.manifestPath, "utf-8");
      this.manifest = JSON.parse(content);

      if (!this.manifest?.files) {
        console.warn("[MediaLookup] Manifest has no files array");
        return false;
      }

      // Build indexes
      for (const entry of this.manifest.files) {
        // Skip entries without CDN URL
        if (!entry.cdn_url) continue;

        // Index by message ID
        const messageId = entry.message_id;
        if (messageId) {
          if (!this.byMessageId.has(messageId)) {
            this.byMessageId.set(messageId, []);
          }
          this.byMessageId.get(messageId)!.push(entry);
        }

        // Index by date
        const date = entry.timestamp;
        if (date) {
          if (!this.byDate.has(date)) {
            this.byDate.set(date, []);
          }
          this.byDate.get(date)!.push(entry);

          // Index by channel+date
          const channelId = entry.channel_id;
          if (channelId) {
            const key = `${channelId}:${date}`;
            if (!this.byChannelDate.has(key)) {
              this.byChannelDate.set(key, []);
            }
            this.byChannelDate.get(key)!.push(entry);
          }
        }
      }

      console.log(
        `[MediaLookup] Loaded ${this.manifest.files.length} media items, ` +
          `${this.byMessageId.size} unique messages, ${this.byDate.size} dates`
      );
      return true;
    } catch (error) {
      console.error(`[MediaLookup] Error loading manifest:`, error);
      return false;
    }
  }

  /**
   * Get media for a specific message
   */
  getMediaForMessage(messageId: string): MediaReference[] {
    const entries = this.byMessageId.get(messageId) || [];
    return entries.map((e) => this.toMediaReference(e));
  }

  /**
   * Get all media for a specific date
   */
  getMediaForDate(dateStr: string): MediaReference[] {
    const entries = this.byDate.get(dateStr) || [];
    return entries.map((e) => this.toMediaReference(e));
  }

  /**
   * Get media for a specific channel on a specific date
   */
  getMediaForChannelDate(channelId: string, dateStr: string): MediaReference[] {
    const key = `${channelId}:${dateStr}`;
    const entries = this.byChannelDate.get(key) || [];
    return entries.map((e) => this.toMediaReference(e));
  }

  /**
   * Get images only for a date
   */
  getImagesForDate(dateStr: string): string[] {
    return this.getMediaForDate(dateStr)
      .filter((m) => m.type === "image")
      .map((m) => m.url);
  }

  /**
   * Get videos only for a date
   */
  getVideosForDate(dateStr: string): string[] {
    return this.getMediaForDate(dateStr)
      .filter((m) => m.type === "video")
      .map((m) => m.url);
  }

  /**
   * Get all unique dates with media
   */
  getDatesWithMedia(): string[] {
    return Array.from(this.byDate.keys()).sort();
  }

  /**
   * Get media stats
   */
  getStats(): {
    totalMedia: number;
    totalImages: number;
    totalVideos: number;
    datesWithMedia: number;
  } {
    if (!this.manifest?.files) {
      return { totalMedia: 0, totalImages: 0, totalVideos: 0, datesWithMedia: 0 };
    }

    let images = 0;
    let videos = 0;
    for (const entry of this.manifest.files) {
      if (entry.cdn_url) {
        if (entry.type === "image") images++;
        else if (entry.type === "video") videos++;
      }
    }

    return {
      totalMedia: images + videos,
      totalImages: images,
      totalVideos: videos,
      datesWithMedia: this.byDate.size,
    };
  }

  /**
   * Convert manifest entry to MediaReference
   */
  private toMediaReference(entry: MediaManifestEntry): MediaReference {
    return {
      url: entry.cdn_url || entry.url,
      type: entry.type as "image" | "video",
      filename: entry.unique_name || entry.filename,
      messageId: entry.message_id,
      channelId: entry.channel_id || "",
    };
  }
}

/**
 * Create a media lookup instance from a manifest file
 */
export async function createMediaLookup(
  manifestPath: string
): Promise<MediaLookup | null> {
  const lookup = new MediaLookup(manifestPath);
  const loaded = await lookup.load();
  return loaded ? lookup : null;
}

/**
 * Build a map of Discord URLs to CDN URLs from manifest
 */
export function buildUrlSwapMap(manifestPath: string): Map<string, string> {
  const swapMap = new Map<string, string>();

  if (!fs.existsSync(manifestPath)) {
    return swapMap;
  }

  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest: MediaManifest = JSON.parse(content);

    for (const entry of manifest.files || []) {
      if (entry.cdn_url && entry.url) {
        // Map original Discord URL to CDN URL
        swapMap.set(entry.url, entry.cdn_url);
        // Also map proxy_url if present
        if (entry.proxy_url) {
          swapMap.set(entry.proxy_url, entry.cdn_url);
        }
      }
    }

    console.log(`[MediaLookup] Built URL swap map with ${swapMap.size} entries`);
  } catch (error) {
    console.error(`[MediaLookup] Error building swap map:`, error);
  }

  return swapMap;
}

/**
 * Swap Discord URLs for CDN URLs in a JSON object (recursive)
 */
export function swapUrlsInObject(obj: any, swapMap: Map<string, string>): any {
  if (typeof obj === "string") {
    // Check if this string is a URL we should swap
    return swapMap.get(obj) || obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => swapUrlsInObject(item, swapMap));
  }

  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = swapUrlsInObject(value, swapMap);
    }
    return result;
  }

  return obj;
}

/**
 * Swap Discord URLs for CDN URLs in a JSON file
 */
export function swapUrlsInJsonFile(
  jsonPath: string,
  manifestPath: string,
  outputPath?: string
): boolean {
  try {
    const swapMap = buildUrlSwapMap(manifestPath);
    if (swapMap.size === 0) {
      console.warn("[MediaLookup] No URLs to swap");
      return false;
    }

    const content = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(content);

    const swapped = swapUrlsInObject(data, swapMap);

    // Clean empty arrays to reduce JSON size (~15-20% reduction)
    const cleaned = removeEmptyArrays(swapped);

    const outPath = outputPath || jsonPath;
    fs.writeFileSync(outPath, JSON.stringify(cleaned, null, 2));
    console.log(`[MediaLookup] Swapped URLs and cleaned empty arrays in ${outPath}`);

    return true;
  } catch (error) {
    console.error(`[MediaLookup] Error swapping URLs:`, error);
    return false;
  }
}

/**
 * Find manifest file for a source
 * Checks common locations: ./media/manifest.json, ./output/{source}/media/manifest.json
 */
export function findManifestPath(source: string, basePath: string = "."): string | null {
  const candidates = [
    path.join(basePath, "media", "manifest.json"),
    path.join(basePath, "media-manifest.json"),
    path.join(basePath, `${source}-media`, "manifest.json"),
    path.join(basePath, "output", source, "media", "manifest.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
