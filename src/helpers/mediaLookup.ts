/**
 * Media Lookup Helper
 * Provides lookup functionality to match CDN media URLs to Discord messages
 *
 * @module helpers/mediaLookup
 */

import fs from "fs";
import path from "path";
import { MediaManifest, MediaManifestEntry } from "../types";

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

    const outPath = outputPath || jsonPath;
    fs.writeFileSync(outPath, JSON.stringify(swapped, null, 2));
    console.log(`[MediaLookup] Swapped URLs in ${outPath}`);

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
