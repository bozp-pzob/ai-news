/**
 * Media download script for Discord data
 * Downloads media files from Discord messages stored in the database
 * Organizes files by type (images/, videos/, audio/, documents/) with content-hash deduplication
 * Includes filtering, rate limiting, and analytics capabilities
 * 
 * @module download-media
 */

import { SQLiteStorage } from "./plugins/storage/SQLiteStorage";
import { ContentItem, DiscordRawData, DiscordAttachment, DiscordEmbed, DiscordSticker, MediaDownloadConfig } from "./types";
import { logger } from "./helpers/cliHelper";
import { writeJsonFile } from "./helpers/fileHelper";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import https from "https";
import { createHash } from "crypto";

// Constants for network operations
const DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000; // Base delay for exponential backoff
const DEFAULT_RATE_LIMIT_MS = 500; // Increased default rate limit between downloads (was 100ms)
const USER_AGENT = process.env.DISCORD_USER_AGENT || 'DiscordBot (media-downloader, 1.0)'; // Configurable via env var

// Discord Rate Limiting Constants
const DISCORD_GLOBAL_RATE_LIMIT = 50; // 50 requests per second globally
const DISCORD_RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_CONCURRENT_DOWNLOADS = 5; // Limit concurrent downloads

// URL Refresh Constants (for expired Discord CDN URLs)
const DISCORD_404_THRESHOLD = 5; // After this many Discord 404s, trigger manifest refresh
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// URL classification helpers
const isDiscordUrl = (url: string) => url.includes('discord') || url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net');
const isTwitterUrl = (url: string) => url.includes('twitter.com') || url.includes('twimg.com');

dotenv.config();

/**
 * Discord-compliant rate limiter that respects API headers and implements proper backoff
 */
class DiscordRateLimiter {
  private requestQueue: Array<() => void> = [];
  private globalRateLimit: { resetAt: number; remaining: number } = { resetAt: 0, remaining: DISCORD_GLOBAL_RATE_LIMIT };
  private bucketLimits: Map<string, { resetAt: number; remaining: number; limit: number }> = new Map();
  private processing = false;
  private activeRequests = 0;

  /**
   * Add a request to the rate-limited queue
   */
  async enqueue<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  /**
   * Process the request queue respecting rate limits
   */
  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0 || this.activeRequests >= MAX_CONCURRENT_DOWNLOADS) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0 && this.activeRequests < MAX_CONCURRENT_DOWNLOADS) {
      const now = Date.now();
      
      // Check global rate limit
      if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
        const waitTime = this.globalRateLimit.resetAt - now;
        logger.debug(`Global rate limit hit, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
        continue;
      }

      // Reset global rate limit if window passed
      if (now >= this.globalRateLimit.resetAt) {
        this.globalRateLimit = { resetAt: now + DISCORD_RATE_LIMIT_WINDOW, remaining: DISCORD_GLOBAL_RATE_LIMIT };
      }

      const request = this.requestQueue.shift()!;
      this.activeRequests++;
      this.globalRateLimit.remaining--;

      // Execute request without blocking the queue
      setImmediate(async () => {
        try {
          await request();
        } catch (error) {
          logger.debug(`Request failed: ${error}`);
        } finally {
          this.activeRequests--;
          // Continue processing queue
          setImmediate(() => this.processQueue());
        }
      });

      // Small delay between requests to prevent overwhelming
      await this.sleep(50);
    }

    this.processing = false;
  }

  /**
   * Update rate limits based on Discord response headers
   */
  updateRateLimits(headers: any, bucket?: string) {
    const now = Date.now();

    // Update global rate limit from headers
    if (headers['x-ratelimit-global']) {
      const retryAfter = parseFloat(headers['retry-after']) * 1000;
      this.globalRateLimit = { resetAt: now + retryAfter, remaining: 0 };
      logger.warning(`Global rate limit hit, reset in ${retryAfter}ms`);
    }

    // Update bucket-specific rate limit
    if (bucket && headers['x-ratelimit-limit']) {
      const limit = parseInt(headers['x-ratelimit-limit']);
      const remaining = parseInt(headers['x-ratelimit-remaining'] || '0');
      const resetAfter = parseFloat(headers['x-ratelimit-reset-after'] || '1') * 1000;
      
      this.bucketLimits.set(bucket, {
        resetAt: now + resetAfter,
        remaining,
        limit
      });

      if (remaining <= 0) {
        logger.debug(`Bucket ${bucket} rate limit hit, reset in ${resetAfter}ms`);
      }
    }
  }

  /**
   * Check if a request to a specific bucket should be delayed
   */
  shouldDelay(bucket?: string): number {
    const now = Date.now();
    let delay = 0;

    // Check global rate limit
    if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
      delay = Math.max(delay, this.globalRateLimit.resetAt - now);
    }

    // Check bucket rate limit
    if (bucket && this.bucketLimits.has(bucket)) {
      const bucketLimit = this.bucketLimits.get(bucket)!;
      if (now < bucketLimit.resetAt && bucketLimit.remaining <= 0) {
        delay = Math.max(delay, bucketLimit.resetAt - now);
      }
    }

    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

interface MediaDownloadItem {
  url: string;
  filename: string;
  messageId: string;
  messageDate: string;
  channelId: string;
  channelName: string;
  guildId: string;
  guildName: string;
  userId: string;
  mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
  originalData: DiscordAttachment | DiscordEmbed | DiscordSticker;
  // Additional context for manifest
  messageContent?: string;
  reactions?: Array<{ emoji: string; count: number }>;
}

interface MediaReference {
  hash: string;
  originalFilename: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildId: string;
  guildName: string;
  userId: string;
  timestamp: number;
  messageDate: string;
  mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
  url: string;
  fileSize?: number;
  contentType?: string;
  width?: number;
  height?: number;
}

interface MediaIndexEntry {
  hash: string;
  originalFilename: string;
  contentType: string;
  fileSize: number;
  filePath: string; // relative to media directory
  firstSeen: number;
  width?: number;
  height?: number;
  duration?: number;
}

interface DailyMediaMetadata {
  date: string;
  references: MediaReference[];
  totalFiles: number;
  uniqueFiles: number;
  totalSize: number;
}

interface DownloadStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  filtered: number;
  errors: string[];
  analytics?: MediaAnalytics;
}

interface MediaAnalytics {
  totalFilesByType: Record<string, number>;
  averageFileSizeByType: Record<string, number>;
  totalSizeByType: Record<string, number>;
  largestFilesByType: Record<string, Array<{ filename: string; size: number; url: string; }>>;
}

/**
 * Entry in the media manifest for VPS download
 */
interface MediaManifestEntry {
  // Core identifiers
  url: string;
  proxy_url?: string;   // Discord proxy URL for external media
  filename: string;
  unique_name: string;  // hash12.ext
  hash: string;         // 12-char hash of normalized URL

  // File metadata
  type: 'image' | 'video' | 'audio' | 'document';
  is_spoiler?: boolean;   // filename starts with SPOILER_
  is_animated?: boolean;  // animated content (GIF, a_ prefix)
  media_type: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
  size?: number;
  content_type?: string;
  width?: number;
  height?: number;

  // Discord context
  message_id: string;
  channel_id: string;
  channel_name: string;
  guild_id: string;
  guild_name: string;
  user_id: string;
  timestamp: string;

  // Message context (for search/filtering)
  message_content?: string;
  reactions?: Array<{ emoji: string; count: number }>;
}

/**
 * Media manifest file structure for VPS download
 */
interface MediaManifest {
  date: string;
  source: string;       // elizaos, hyperfy
  generated_at: string;
  base_path: string;    // e.g., "elizaos-media"
  files: MediaManifestEntry[];
  stats: {
    total_files: number;
    by_type: Record<string, number>;
    total_size_bytes: number;
  };
}

class MediaDownloader {
  private storage: SQLiteStorage;
  private baseDir: string;
  private stats: DownloadStats;
  private mediaIndex: Map<string, MediaIndexEntry> = new Map();
  private dailyReferences: MediaReference[] = [];
  private config: MediaDownloadConfig;
  private rateLimiter: DiscordRateLimiter;
  private analytics: MediaAnalytics = {
    totalFilesByType: {},
    averageFileSizeByType: {},
    totalSizeByType: {},
    largestFilesByType: {}
  };

  // URL refresh tracking
  private discord404Count = 0; // Total Discord CDN 404s
  private urlRefreshCache: Map<string, string> = new Map(); // old URL -> fresh URL
  private manifestRefreshed = false;
  private currentManifestPath?: string;

  constructor(dbPath: string, baseDir: string = './media', config?: MediaDownloadConfig) {
    this.storage = new SQLiteStorage({ name: 'media-downloader', dbPath });
    this.baseDir = baseDir;
    this.rateLimiter = new DiscordRateLimiter();
    this.config = {
      enabled: true,
      maxFileSize: 52428800, // 50MB default
      rateLimit: DEFAULT_RATE_LIMIT_MS,
      retryAttempts: 3,
      ...config
    };
    this.stats = {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      filtered: 0,
      errors: []
    };
  }

  /**
   * Initialize storage connection and load media index
   */
  async init(): Promise<void> {
    await this.storage.init();
    await this.loadMediaIndex();
    await this.ensureDirectoryStructure();
    logger.info('Media downloader initialized');
  }

  /**
   * Load existing media index from file
   */
  private async loadMediaIndex(): Promise<void> {
    const indexPath = path.join(this.baseDir, 'metadata', 'index.json');
    
    if (fs.existsSync(indexPath)) {
      try {
        const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        for (const entry of indexData) {
          this.mediaIndex.set(entry.hash, entry);
        }
        logger.debug(`Loaded ${this.mediaIndex.size} entries from media index`);
      } catch (error) {
        logger.error(`Failed to load media index: ${error}`);
      }
    }
  }

  /**
   * Save media index to file
   */
  private async saveMediaIndex(): Promise<void> {
    const indexPath = path.join(this.baseDir, 'metadata', 'index.json');
    const metadataDir = path.dirname(indexPath);
    
    fs.mkdirSync(metadataDir, { recursive: true });
    
    const indexData = Array.from(this.mediaIndex.values());
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    logger.debug(`Saved ${indexData.length} entries to media index`);
  }

  /**
   * Save daily metadata to file
   */
  private async saveDailyMetadata(date: string): Promise<void> {
    if (this.dailyReferences.length === 0) return;
    
    const metadataPath = path.join(this.baseDir, 'metadata', `${date}.json`);
    const metadataDir = path.dirname(metadataPath);
    
    fs.mkdirSync(metadataDir, { recursive: true });
    
    const uniqueHashes = new Set(this.dailyReferences.map(ref => ref.hash));
    const totalSize = this.dailyReferences.reduce((sum, ref) => sum + (ref.fileSize || 0), 0);
    
    const dailyMetadata: DailyMediaMetadata = {
      date,
      references: this.dailyReferences,
      totalFiles: this.dailyReferences.length,
      uniqueFiles: uniqueHashes.size,
      totalSize
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(dailyMetadata, null, 2));
    logger.info(`Saved metadata for ${dailyMetadata.totalFiles} media references (${dailyMetadata.uniqueFiles} unique) on ${date}`);
    
    // Clear daily references for next batch
    this.dailyReferences = [];
  }

  /**
   * Ensure directory structure exists
   */
  private async ensureDirectoryStructure(): Promise<void> {
    // Just create base directory - subdirectories created on demand based on organizeBy setting
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * Get the output directory for a media item based on organization mode
   * @throws Error if guild/channel name is missing when required
   */
  private getOutputDir(mediaItem: MediaDownloadItem): string {
    const organizeBy = this.config.organizeBy || 'flat';

    switch (organizeBy) {
      case 'server':
        if (!mediaItem.guildName) {
          throw new Error(`Missing guild name for message ${mediaItem.messageId} - cannot organize by server`);
        }
        const serverDir = this.sanitizeForPath(mediaItem.guildName);
        return path.join(this.baseDir, serverDir);

      case 'channel':
        if (!mediaItem.guildName) {
          throw new Error(`Missing guild name for message ${mediaItem.messageId} - cannot organize by channel`);
        }
        if (!mediaItem.channelName) {
          throw new Error(`Missing channel name for message ${mediaItem.messageId} - cannot organize by channel`);
        }
        const serverDir2 = this.sanitizeForPath(mediaItem.guildName);
        const channelDir = this.sanitizeForPath(mediaItem.channelName);
        return path.join(this.baseDir, serverDir2, channelDir);

      case 'flat':
      default:
        return this.baseDir;
    }
  }

  /**
   * Sanitize a string for use in file paths (directory/file names)
   */
  private sanitizeForPath(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || 'unnamed';
  }

  /**
   * Generate a human-readable unique filename: {sanitized-name}_{hash8}.{ext}
   */
  private generateUniqueFilename(originalFilename: string, normalizedUrl: string, ext: string): string {
    const hash = createHash('sha256').update(normalizedUrl).digest('hex').substring(0, 8);
    const baseName = path.basename(originalFilename, path.extname(originalFilename));
    const sanitized = this.sanitizeForPath(baseName);

    return `${sanitized}_${hash}.${ext}`;
  }

  /**
   * Determine file type directory based on MIME type
   */
  /**
   * Determine appropriate file type directory based on actual file content
   */
  private async getFileTypeDir(contentType: string, filename: string, filePath?: string): Promise<string> {
    // If we have the downloaded file, check its actual content type
    if (filePath && fs.existsSync(filePath)) {
      const actualType = await this.detectActualFileType(filePath);
      if (actualType !== 'unknown') {
        return actualType;
      }
    }

    // Use provided content type if available
    if (contentType) {
      if (contentType.startsWith('image/')) return 'images';
      if (contentType.startsWith('video/')) return 'videos';  
      if (contentType.startsWith('audio/')) return 'audio';
      if (contentType.startsWith('text/html')) return 'documents'; // HTML files go to documents
    }
    
    // Fallback to extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images';
    if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(ext)) return 'videos';
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
    
    return 'documents';
  }

  /**
   * Detect actual file type by examining file content
   */
  private async detectActualFileType(filePath: string): Promise<string> {
    try {
      const buffer = fs.readFileSync(filePath); // Read file
      const chunk = buffer.slice(0, Math.min(buffer.length, 512)); // Use first 512 bytes
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
      
    } catch (error) {
      logger.debug(`Failed to detect file type for ${filePath}: ${error}`);
    }
    
    return 'unknown';
  }

  /**
   * Process downloaded file: update index, analytics, and references
   */
  private async organizeDownloadedFile(filePath: string, mediaItem: MediaDownloadItem, hash: string, uniqueFilename: string): Promise<number> {
    let actualFileSize = 0;

    try {
      // Get actual file size
      const fileStats = fs.statSync(filePath);
      actualFileSize = fileStats.size;

      // Detect actual file type from content (for analytics only, no file moving)
      const actualFileType = await this.detectActualFileType(filePath);
      const attachment = mediaItem.originalData as DiscordAttachment;
      const fileType = actualFileType !== 'unknown' ? actualFileType :
        await this.getFileTypeDir(attachment.content_type || '', mediaItem.filename);

      // Update analytics
      this.updateAnalytics(mediaItem, actualFileSize, fileType);

      // Add to media index
      const mediaIndexEntry: MediaIndexEntry = {
        hash,
        originalFilename: mediaItem.filename,
        contentType: attachment.content_type || 'unknown',
        fileSize: actualFileSize,
        filePath: path.relative(this.baseDir, filePath),
        firstSeen: Date.now()
      };
      this.mediaIndex.set(hash, mediaIndexEntry);

      // Add to daily references
      this.dailyReferences.push({
        hash,
        originalFilename: mediaItem.filename,
        messageId: mediaItem.messageId,
        channelId: mediaItem.channelId,
        channelName: mediaItem.channelName,
        guildId: mediaItem.guildId,
        guildName: mediaItem.guildName,
        userId: mediaItem.userId,
        timestamp: Date.now(),
        messageDate: new Date().toISOString(),
        mediaType: mediaItem.mediaType,
        url: mediaItem.url,
        fileSize: actualFileSize,
        contentType: attachment.content_type
      });

    } catch (error) {
      logger.debug(`Failed to process downloaded file ${filePath}: ${error}`);
      // Fallback to original analytics logic
      const attachment = mediaItem.originalData as DiscordAttachment;
      actualFileSize = attachment.size || 0;
      this.updateAnalytics(mediaItem, actualFileSize);
    }
    
    return actualFileSize;
  }

  /**
   * Get human-readable description of file type
   */
  private getFileTypeDescription(fileType: string): string {
    switch (fileType) {
      case 'images': return 'Image file';
      case 'videos': return 'Video file';
      case 'audio': return 'Audio file';
      case 'documents': return 'Document/HTML file';
      default: return 'Unknown file type';
    }
  }

  /**
   * Generate content hash from file data
   */
  private generateContentHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate URL-based hash for deduplication before download
   */
  private generateUrlHash(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  /**
   * Update analytics with media information
   */
  private updateAnalytics(mediaItem: MediaDownloadItem, fileSize?: number, fileType?: string): void {
    const attachment = mediaItem.originalData as DiscordAttachment;
    const type = fileType || 'documents'; // Default to documents if no type specified
    const size = fileSize || attachment.size || 0;
    
    // Update counts
    this.analytics.totalFilesByType[type] = (this.analytics.totalFilesByType[type] || 0) + 1;
    
    // Update sizes
    this.analytics.totalSizeByType[type] = (this.analytics.totalSizeByType[type] || 0) + size;
    this.analytics.averageFileSizeByType[type] = this.analytics.totalSizeByType[type] / this.analytics.totalFilesByType[type];
    
    // Track largest files (top 5 per type)
    if (!this.analytics.largestFilesByType[type]) {
      this.analytics.largestFilesByType[type] = [];
    }
    
    this.analytics.largestFilesByType[type].push({
      filename: mediaItem.filename,
      size,
      url: mediaItem.url
    });
    
    // Keep only top 5 largest files per type
    this.analytics.largestFilesByType[type].sort((a, b) => b.size - a.size);
    if (this.analytics.largestFilesByType[type].length > 5) {
      this.analytics.largestFilesByType[type] = this.analytics.largestFilesByType[type].slice(0, 5);
    }
  }

  /**
   * Refresh all Discord CDN URLs in the manifest via Discord API
   * Groups by channel to minimize API calls
   */
  private async refreshManifestUrls(mediaItems: MediaDownloadItem[]): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      logger.error('DISCORD_TOKEN not set - cannot refresh expired URLs');
      return;
    }

    logger.info('🔄 Refreshing expired Discord URLs...');

    // Group items by channel and message for efficient API calls
    const messageGroups = new Map<string, { channelId: string; messageId: string; items: MediaDownloadItem[] }>();

    for (const item of mediaItems) {
      if (!isDiscordUrl(item.url)) continue;

      const key = `${item.channelId}:${item.messageId}`;
      if (!messageGroups.has(key)) {
        messageGroups.set(key, { channelId: item.channelId, messageId: item.messageId, items: [] });
      }
      messageGroups.get(key)!.items.push(item);
    }

    const totalMessages = messageGroups.size;
    const etaSeconds = Math.ceil(totalMessages * 0.5); // 500ms per message
    logger.info(`Fetching fresh URLs for ${totalMessages} messages (ETA: ~${Math.ceil(etaSeconds/60)} min)...`);

    let refreshed = 0;
    let failed = 0;
    let processed = 0;
    const progressInterval = Math.max(1, Math.floor(totalMessages / 10)); // Show progress every 10%

    for (const [key, group] of messageGroups) {
      try {
        const freshMessage = await this.fetchDiscordMessage(token, group.channelId, group.messageId);
        if (freshMessage) {
          // Map old URLs to fresh URLs from the message
          this.mapFreshUrls(group.items, freshMessage);
          refreshed++;
        } else {
          failed++;
        }

        processed++;
        // Show progress periodically
        if (processed % progressInterval === 0) {
          const pct = Math.round((processed / totalMessages) * 100);
          logger.info(`  Refresh progress: ${processed}/${totalMessages} (${pct}%)`);
        }

        // Rate limit: 500ms between requests (2 req/sec) to avoid 429s
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logger.debug(`Failed to refresh message ${key}: ${error}`);
        failed++;
        processed++;
      }
    }

    logger.info(`✅ Refreshed ${refreshed} messages (${failed} failed)`);
    this.manifestRefreshed = true;
  }

  /**
   * Fetch a Discord message via API to get fresh attachment URLs
   */
  private async fetchDiscordMessage(token: string, channelId: string, messageId: string): Promise<any> {
    return new Promise((resolve) => {
      const options = {
        hostname: 'discord.com',
        path: `/api/v10/channels/${channelId}/messages/${messageId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bot ${token}`,
          'User-Agent': USER_AGENT
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          } else if (res.statusCode === 429) {
            const retryAfter = parseFloat(res.headers['retry-after'] as string || '5') * 1000;
            logger.warning(`Rate limited, waiting ${Math.round(retryAfter/1000)}s then retrying...`);
            // Wait and retry
            setTimeout(async () => {
              const retry = await this.fetchDiscordMessage(token, channelId, messageId);
              resolve(retry);
            }, retryAfter);
            return;
          } else {
            logger.debug(`Failed to fetch message ${messageId}: HTTP ${res.statusCode}`);
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  /**
   * Map fresh URLs from Discord API response to our media items
   */
  private mapFreshUrls(items: MediaDownloadItem[], message: any): void {
    // Build lookup from attachment ID to fresh URL
    const freshAttachments = new Map<string, string>();
    for (const att of message.attachments || []) {
      freshAttachments.set(att.id, att.url);
      // Also map by filename as fallback
      freshAttachments.set(att.filename, att.url);
    }

    // Map embed URLs (thumbnails, images, videos)
    const freshEmbeds: string[] = [];
    for (const embed of message.embeds || []) {
      if (embed.thumbnail?.url) freshEmbeds.push(embed.thumbnail.url);
      if (embed.image?.url) freshEmbeds.push(embed.image.url);
      if (embed.video?.url) freshEmbeds.push(embed.video.url);
    }

    for (const item of items) {
      let freshUrl: string | undefined;

      if (item.mediaType === 'attachment') {
        // Try by attachment ID (extracted from URL) or filename
        const attachmentId = this.extractAttachmentId(item.url);
        freshUrl = freshAttachments.get(attachmentId) || freshAttachments.get(item.filename);
      } else {
        // For embeds, try to match by URL path (ignoring query params)
        const oldPath = this.getUrlPath(item.url);
        freshUrl = freshEmbeds.find(url => this.getUrlPath(url) === oldPath);
      }

      if (freshUrl && freshUrl !== item.url) {
        this.urlRefreshCache.set(item.url, freshUrl);
        logger.debug(`Refreshed URL for ${item.filename}`);
      }
    }
  }

  /**
   * Extract attachment ID from Discord CDN URL
   */
  private extractAttachmentId(url: string): string {
    // URL format: https://cdn.discordapp.com/attachments/{channel_id}/{attachment_id}/{filename}
    const match = url.match(/attachments\/\d+\/(\d+)\//);
    return match ? match[1] : '';
  }

  /**
   * Get URL path without query string for comparison
   */
  private getUrlPath(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.pathname;
    } catch {
      return url;
    }
  }

  /**
   * Get potentially refreshed URL for a media item
   */
  private getRefreshedUrl(item: MediaDownloadItem): string {
    return this.urlRefreshCache.get(item.url) || item.url;
  }

  /**
   * Check if media item should be downloaded based on config filters
   */
  private shouldDownloadMedia(mediaItem: MediaDownloadItem): { allowed: boolean; reason?: string } {
    const attachment = mediaItem.originalData as DiscordAttachment;
    
    // Check file size if available
    if (attachment.size && this.config.maxFileSize && attachment.size > this.config.maxFileSize) {
      const sizeMB = Math.round(attachment.size / 1024 / 1024);
      const limitMB = Math.round(this.config.maxFileSize / 1024 / 1024);
      return { 
        allowed: false, 
        reason: `File size ${sizeMB}MB exceeds limit of ${limitMB}MB` 
      };
    }
    
    // Check content type filtering
    if (attachment.content_type) {
      if (this.config.excludedTypes?.some(type => 
        attachment.content_type?.includes(type) || 
        mediaItem.filename.toLowerCase().includes(type.toLowerCase())
      )) {
        return { 
          allowed: false, 
          reason: `Content type ${attachment.content_type} is excluded` 
        };
      }
      
      if (this.config.allowedTypes && this.config.allowedTypes.length > 0) {
        const isAllowed = this.config.allowedTypes.some(type => 
          attachment.content_type?.includes(type) || 
          mediaItem.filename.toLowerCase().includes(type.toLowerCase())
        );
        if (!isAllowed) {
          return { 
            allowed: false, 
            reason: `Content type ${attachment.content_type} not in allowed types` 
          };
        }
      }
    }
    
    return { allowed: true };
  }

  /**
   * Extract all media items from Discord raw data with filtering
   */
  private extractMediaFromDiscordData(item: ContentItem): MediaDownloadItem[] {
    const mediaItems: MediaDownloadItem[] = [];
    
    if (item.type !== 'discordRawData' || !item.text) {
      return mediaItems;
    }

    try {
      const discordData: DiscordRawData = JSON.parse(item.text);
      const messageDate = new Date(item.date! * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
      
      for (const message of discordData.messages) {
        // Process attachments
        if (message.attachments) {
          for (const attachment of message.attachments) {
            mediaItems.push({
              url: attachment.url,
              filename: attachment.filename,
              messageId: message.id,
              messageDate,
              channelId: discordData.channel.id,
              channelName: discordData.channel.name,
              guildId: item.metadata?.guildId || 'unknown',
              guildName: item.metadata?.guildName || 'unknown',
              userId: message.uid,
              mediaType: 'attachment',
              originalData: attachment,
              messageContent: message.content,
              reactions: message.reactions
            });
          }
        }

        // Process embed images, thumbnails, and videos
        if (message.embeds) {
          for (const embed of message.embeds) {
            if (embed.image) {
              const filename = `embed-image-${message.id}.${embed.image.url.split('.').pop() || 'jpg'}`;
              mediaItems.push({
                url: embed.image.url,
                filename,
                messageId: message.id,
                messageDate,
                channelId: discordData.channel.id,
                channelName: discordData.channel.name,
                guildId: item.metadata?.guildId || 'unknown',
                guildName: item.metadata?.guildName || 'unknown',
                userId: message.uid,
                mediaType: 'embed_image',
                originalData: embed,
                messageContent: message.content,
                reactions: message.reactions
              });
            }

            if (embed.thumbnail) {
              const filename = `embed-thumbnail-${message.id}.${embed.thumbnail.url.split('.').pop() || 'jpg'}`;
              mediaItems.push({
                url: embed.thumbnail.url,
                filename,
                messageId: message.id,
                messageDate,
                channelId: discordData.channel.id,
                channelName: discordData.channel.name,
                guildId: item.metadata?.guildId || 'unknown',
                guildName: item.metadata?.guildName || 'unknown',
                userId: message.uid,
                mediaType: 'embed_thumbnail',
                originalData: embed,
                messageContent: message.content,
                reactions: message.reactions
              });
            }
            
            if (embed.video?.url) {
              const filename = `embed-video-${message.id}.${embed.video.url.split('.').pop() || 'mp4'}`;
              const mediaItem = {
                url: embed.video.url,
                filename,
                messageId: message.id,
                messageDate,
                channelId: discordData.channel.id,
                channelName: discordData.channel.name,
                guildId: item.metadata?.guildId || 'unknown',
                guildName: item.metadata?.guildName || 'unknown',
                userId: message.uid,
                mediaType: 'embed_video' as const,
                originalData: { content_type: 'video/mp4', size: undefined, ...embed },
                messageContent: message.content,
                reactions: message.reactions
              };
              
              // Apply filtering
              const filterResult = this.shouldDownloadMedia(mediaItem);
              if (filterResult.allowed) {
                mediaItems.push(mediaItem);
              } else {
                logger.debug(`Filtering out ${mediaItem.filename}: ${filterResult.reason}`);
                this.stats.filtered++;
              }
            }
          }
        }

        // Process stickers
        if (message.sticker_items) {
          for (const sticker of message.sticker_items) {
            // Use proper sticker format extension (1=PNG, 2=APNG, 3=Lottie/JSON, 4=GIF)
            const extension = this.getStickerExtension(sticker.format_type);
            const filename = `${sticker.name}.${extension}`;
            const stickerUrl = `https://media.discordapp.net/stickers/${sticker.id}.${extension}`;
            
            const mediaItem = {
              url: stickerUrl,
              filename,
              messageId: message.id,
              messageDate,
              channelId: discordData.channel.id,
              channelName: discordData.channel.name,
              guildId: item.metadata?.guildId || 'unknown',
              guildName: item.metadata?.guildName || 'unknown',
              userId: message.uid,
              mediaType: 'sticker' as const,
              originalData: {
                content_type: extension === 'gif' ? 'image/gif' : 'image/png',
                size: undefined,
                ...sticker
              },
              messageContent: message.content,
              reactions: message.reactions
            };
            
            // Apply filtering
            const filterResult = this.shouldDownloadMedia(mediaItem);
            if (filterResult.allowed) {
              mediaItems.push(mediaItem);
            } else {
              logger.debug(`Filtering out ${mediaItem.filename}: ${filterResult.reason}`);
              this.stats.filtered++;
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error parsing Discord data for item ${item.cid}: ${error}`);
    }

    return mediaItems;
  }

  /**
   * Download a single media file with retry logic
   */
  private async downloadMedia(mediaItem: MediaDownloadItem): Promise<boolean> {
    const maxRetries = this.config.retryAttempts || MAX_RETRY_ATTEMPTS;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const success = await this.downloadMediaAttempt(mediaItem, attempt, maxRetries);
      if (success) {
        return true;
      }
      
      // If not the last attempt, wait before retrying with exponential backoff
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
        logger.debug(`Retrying download for ${mediaItem.filename} in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return false; // All attempts failed
  }

  /**
   * Single attempt to download a media file
   */
  private async downloadMediaAttempt(mediaItem: MediaDownloadItem, attempt: number, maxRetries: number = MAX_RETRY_ATTEMPTS): Promise<boolean> {
    const attachment = mediaItem.originalData as DiscordAttachment;

    // Normalize URL to strip expiring params for consistent hashing
    const normalizedUrl = this.normalizeDiscordUrl(mediaItem.url);
    const hash = createHash('sha256').update(normalizedUrl).digest('hex').substring(0, 8);
    const ext = this.getValidatedExtension(attachment.content_type, mediaItem.url, mediaItem.mediaType);

    // Generate human-readable unique filename: {sanitized-name}_{hash8}.{ext}
    const uniqueFilename = this.generateUniqueFilename(mediaItem.filename, normalizedUrl, ext);

    // Get output directory based on organization mode (flat, server, or channel)
    const outputDir = this.getOutputDir(mediaItem);
    fs.mkdirSync(outputDir, { recursive: true });

    const filePath = path.join(outputDir, uniqueFilename);
    
    // Skip if file already exists, but still add to index if not already there
    if (fs.existsSync(filePath)) {
      if (attempt === 1) { // Only log once
        logger.debug(`Skipping existing file: ${uniqueFilename}`);
        this.stats.skipped++;

        // Add to media index if not already present (for existing files)
        if (!this.mediaIndex.has(hash)) {
          let fileSize = 0;
          try {
            const fileStats = fs.statSync(filePath);
            fileSize = fileStats.size;
          } catch (e) {
            const attachment = mediaItem.originalData as DiscordAttachment;
            fileSize = attachment.size || 0;
          }

          const mediaIndexEntry: MediaIndexEntry = {
            hash,
            originalFilename: mediaItem.filename,
            contentType: (mediaItem.originalData as DiscordAttachment).content_type || 'unknown',
            fileSize,
            filePath: path.relative(this.baseDir, filePath),
            firstSeen: Date.now()
          };
          this.mediaIndex.set(hash, mediaIndexEntry);
          
          // Add to daily references for metadata export
          this.dailyReferences.push({
            hash,
            originalFilename: mediaItem.filename,
            messageId: mediaItem.messageId,
            channelId: mediaItem.channelId,
            channelName: mediaItem.channelName,
            guildId: mediaItem.guildId,
            guildName: mediaItem.guildName,
            userId: mediaItem.userId,
            timestamp: Date.now(),
            messageDate: new Date().toISOString(),
            mediaType: mediaItem.mediaType,
            url: mediaItem.url,
            fileSize,
            contentType: (mediaItem.originalData as DiscordAttachment).content_type
          });
        }
      }
      return true;
    }

    return new Promise((resolve) => {
      let hasTimedOut = false;
      const file = fs.createWriteStream(filePath);
      
      // Set up timeout
      const timeout = setTimeout(() => {
        hasTimedOut = true;
        logger.debug(`Download timeout for ${mediaItem.url} (attempt ${attempt})`);
        file.destroy();
        try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
        resolve(false);
      }, DOWNLOAD_TIMEOUT_MS);

      const options = {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*'
        }
      };
      
      const request = https.get(mediaItem.url, options, (response) => {
        if (hasTimedOut) return;
        
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          clearTimeout(timeout);
          file.close();
          try { fs.unlinkSync(filePath); } catch (e) {}
          
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            logger.debug(`Following redirect for ${mediaItem.filename}`);
            // Create new media item with redirect URL
            const redirectMediaItem = { ...mediaItem, url: redirectUrl };
            this.downloadMediaAttempt(redirectMediaItem, attempt).then(resolve);
            return;
          }
        }

        // Update rate limiter with response headers
        this.rateLimiter.updateRateLimits(response.headers, response.headers['x-ratelimit-bucket'] as string);
        
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          
          // Handle Discord rate limiting (HTTP 429)
          if (response.statusCode === 429) {
            const retryAfter = parseFloat(response.headers['retry-after'] as string) || 1;
            const waitTime = retryAfter * 1000;
            const isGlobal = response.headers['x-ratelimit-global'] === 'true';
            const scope = response.headers['x-ratelimit-scope'] as string;
            
            logger.warning(`Rate limited${isGlobal ? ' (global)' : ''} by Discord API. Scope: ${scope || 'unknown'}. Waiting ${Math.round(waitTime)}ms before retry`);
            
            file.close();
            try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
            
            // The rate limiter will handle the delay, so we just return false to trigger retry
            resolve(false);
            return;
          }
          
          const errorMsg = `HTTP ${response.statusCode} for ${mediaItem.url} (attempt ${attempt})`;
          if (attempt === maxRetries) {
            this.stats.failed++;
            this.stats.errors.push(errorMsg);
            logger.error(`Failed to download ${mediaItem.url}: HTTP ${response.statusCode}`);
          }
          file.close();
          try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
          resolve(false);
          return;
        }

        // Update rate limiter with successful response headers
        this.rateLimiter.updateRateLimits(response.headers, response.headers['x-ratelimit-bucket'] as string);

        response.pipe(file);
        
        file.on('finish', async () => {
          clearTimeout(timeout);
          file.close();
          if (attempt === 1) { // Only count once
            this.stats.downloaded++;
            
            // Post-download file organization - check actual file type and move if needed
            const actualFileSize = await this.organizeDownloadedFile(filePath, mediaItem, hash, uniqueFilename);
            
            logger.debug(`Downloaded and organized: ${uniqueFilename}`);
          }
          resolve(true);
        });
        
        file.on('error', (err) => {
          clearTimeout(timeout);
          const errorMsg = `File write error for ${mediaItem.url}: ${err.message} (attempt ${attempt})`;
          if (attempt === maxRetries) {
            this.stats.failed++;
            this.stats.errors.push(errorMsg);
            logger.error(errorMsg);
          }
          file.close();
          try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
          resolve(false);
        });
      });

      request.on('error', (err) => {
        if (hasTimedOut) return;
        clearTimeout(timeout);
        const errorMsg = `Download error for ${mediaItem.url}: ${err.message} (attempt ${attempt})`;
        
        // Handle common network errors that warrant retry
        const retryableErrors = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'];
        const isRetryable = retryableErrors.some(code => err.message.includes(code));
        
        if (attempt === maxRetries || !isRetryable) {
          this.stats.failed++;
          this.stats.errors.push(errorMsg);
          logger.error(errorMsg);
        } else {
          logger.debug(`Network error (retryable): ${err.message}`);
        }
        
        file.close();
        try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
        resolve(false);
      });
      
      // Set request timeout
      request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        if (hasTimedOut) return;
        hasTimedOut = true;
        logger.debug(`Request timeout for ${mediaItem.url} (attempt ${attempt})`);
        request.destroy();
      });

      // Set timeout on the request itself
      request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        hasTimedOut = true;
        request.destroy();
      });
    });
  }

  /**
   * Sanitize filename for filesystem
   */
  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
  }

  /**
   * Normalize Discord CDN URL for consistent hashing
   * Strips expiring signature params (ex, is, hm) so same file gets same hash
   */
  private normalizeDiscordUrl(url: string): string {
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
  }

  /**
   * Check if file is a spoiler (filename starts with SPOILER_)
   */
  private isSpoiler(filename: string): boolean {
    return filename.startsWith('SPOILER_');
  }

  /**
   * Check if content is animated based on hash prefix or filename
   * Discord uses 'a_' prefix for animated avatars/icons
   */
  private isAnimated(hashOrFilename: string): boolean {
    return hashOrFilename.startsWith('a_') || hashOrFilename.toLowerCase().endsWith('.gif');
  }

  /**
   * Sanitize reactions array to handle deleted/invalid emoji gracefully
   * Custom emoji may be deleted from the server, resulting in null/undefined fields
   */
  private sanitizeReactions(reactions?: Array<{ emoji: string; count: number }>): Array<{ emoji: string; count: number }> | undefined {
    if (!reactions || reactions.length === 0) {
      return undefined;
    }

    return reactions
      .filter(r => {
        // Keep reactions that have valid emoji data
        if (!r || typeof r.count !== 'number') return false;
        // Emoji should be a non-empty string (either unicode or custom emoji name/id)
        if (!r.emoji || r.emoji === 'null' || r.emoji === 'undefined') return false;
        return true;
      })
      .map(r => ({
        emoji: r.emoji || '❓', // Fallback for edge cases
        count: r.count
      }));
  }

  /**
   * Get sticker format extension based on format_type
   * Format types: 1=PNG, 2=APNG, 3=Lottie, 4=GIF
   */
  private getStickerExtension(formatType: number): string {
    switch (formatType) {
      case 1: return 'png';   // PNG
      case 2: return 'png';   // APNG (still uses .png extension)
      case 3: return 'json';  // Lottie animation
      case 4: return 'gif';   // GIF
      default: return 'png';
    }
  }

  /**
   * Map content-type to file extension
   * Based on actual content types found in Discord data
   */
  private static CONTENT_TYPE_TO_EXT: Record<string, string> = {
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
  private static VALID_URL_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif',
    'mp4', 'webm', 'mov', 'avi', 'mkv',
    'mp3', 'wav', 'ogg', 'flac',
    'pdf', 'txt', 'json', 'md', 'csv', 'py', 'log',
  ]);

  /**
   * Get validated file extension from content-type, URL, or default
   * Priority: content_type > URL path > default based on media_type
   */
  private getValidatedExtension(
    contentType: string | undefined,
    url: string,
    mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker'
  ): string {
    // 1. Try content-type (most reliable for Discord attachments)
    if (contentType) {
      // Handle charset suffix: "text/plain; charset=utf-8" -> "text/plain"
      const baseType = contentType.split(';')[0].trim().toLowerCase();
      const ext = MediaDownloader.CONTENT_TYPE_TO_EXT[baseType];
      if (ext) return ext;
    }

    // 2. Try extracting from URL path (for embeds)
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        const ext = match[1].toLowerCase();
        if (MediaDownloader.VALID_URL_EXTENSIONS.has(ext)) {
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
  }

  /**
   * Download all media from Discord data within date range
   */
  async downloadMediaInDateRange(startDate: Date, endDate: Date): Promise<DownloadStats> {
    const startEpoch = Math.floor(startDate.getTime() / 1000);
    const endEpoch = Math.floor(endDate.getTime() / 1000);
    
    logger.info(`Fetching Discord data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Get all Discord raw data items in date range
    const items = await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch, 'discordRawData');
    
    logger.info(`Found ${items.length} Discord data items to process`);
    
    // Extract all media items
    const allMediaItems: MediaDownloadItem[] = [];
    for (const item of items) {
      const mediaItems = this.extractMediaFromDiscordData(item);
      allMediaItems.push(...mediaItems);
    }
    
    this.stats.total = allMediaItems.length;
    logger.info(`Found ${allMediaItems.length} media items to download`);

    // Pre-refresh Discord URLs (they expire after ~24hrs)
    const discordItems = allMediaItems.filter(item => isDiscordUrl(item.url));
    if (discordItems.length > 0 && process.env.DISCORD_TOKEN) {
      logger.info(`\n🔄 Pre-refreshing ${discordItems.length} Discord URLs...`);
      await this.refreshManifestUrls(discordItems);

      // Apply refreshed URLs to items
      for (const item of allMediaItems) {
        const freshUrl = this.urlRefreshCache.get(item.url);
        if (freshUrl) {
          item.url = freshUrl;
        }
      }
      logger.info(`✅ Refreshed ${this.urlRefreshCache.size} URLs\n`);
    }

    // Download media with improved rate limiting and concurrency
    await this.downloadMediaConcurrently(allMediaItems);
    
    // Save daily metadata if there were any downloads
    if (this.dailyReferences.length > 0) {
      // Use the first day from the date range for the filename
      const dateStr = startDate.toISOString().split('T')[0];
      await this.saveDailyMetadata(dateStr);
    }
    
    this.stats.analytics = this.analytics;
    return this.stats;
  }

  /**
   * Download media items concurrently with proper rate limiting
   */
  private async downloadMediaConcurrently(allMediaItems: MediaDownloadItem[]): Promise<void> {
    let processed = 0;
    const progressInterval = Math.max(1, Math.floor(allMediaItems.length / 20)); // Show progress every 5%

    // Create download promises using rate limiter
    const downloadPromises = allMediaItems.map((mediaItem) => {
      return this.rateLimiter.enqueue(async () => {
        try {
          await this.downloadMedia(mediaItem);
          processed++;

          // Show progress periodically
          if (processed % progressInterval === 0 || processed === allMediaItems.length) {
            const percentage = Math.round((processed / allMediaItems.length) * 100);
            logger.info(`Progress: ${processed}/${allMediaItems.length} (${percentage}%)`);
          }
        } catch (error) {
          logger.debug(`Failed to download ${mediaItem.url}: ${error}`);
          this.stats.failed++;
          this.stats.errors.push(`${mediaItem.url}: ${error}`);
        }
      });
    });

    // Wait for all downloads to complete
    await Promise.all(downloadPromises);
  }

  /**
   * Download media for a specific date
   */
  async downloadMediaForDate(date: Date): Promise<DownloadStats> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    return this.downloadMediaInDateRange(date, nextDay);
  }

  /**
   * Generate a media manifest for a specific date without downloading files.
   * The manifest contains URLs and metadata that can be used by a VPS script
   * to download the files later.
   *
   * @param date - The date to generate manifest for
   * @param sourceName - Source identifier (e.g., 'elizaos', 'hyperfy')
   * @returns MediaManifest object
   */
  async generateManifestAll(sourceName: string): Promise<MediaManifest> {
    // Query all data from epoch 0 to far future
    const startEpoch = 0;
    const endEpoch = Math.floor(Date.now() / 1000) + 86400; // Tomorrow

    logger.info(`Generating full manifest for all data (source: ${sourceName})`);

    return this.generateManifestForEpochRange(startEpoch, endEpoch, 'all', sourceName);
  }

  async generateManifest(date: Date, sourceName: string): Promise<MediaManifest> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const startEpoch = Math.floor(date.getTime() / 1000);
    const endEpoch = Math.floor(nextDay.getTime() / 1000);
    const dateStr = date.toISOString().split('T')[0];

    logger.info(`Generating manifest for ${dateStr} (source: ${sourceName})`);

    return this.generateManifestForEpochRange(startEpoch, endEpoch, dateStr, sourceName);
  }

  private async generateManifestForEpochRange(startEpoch: number, endEpoch: number, dateStr: string, sourceName: string): Promise<MediaManifest> {

    // Get all Discord raw data items in date range
    const items = await this.storage.getContentItemsBetweenEpoch(startEpoch, endEpoch, 'discordRawData');

    logger.info(`Found ${items.length} Discord data items to process`);

    // Extract all media items
    const allMediaItems: MediaDownloadItem[] = [];
    for (const item of items) {
      const mediaItems = this.extractMediaFromDiscordData(item);
      allMediaItems.push(...mediaItems);
    }

    logger.info(`Found ${allMediaItems.length} media items for manifest`);

    // Convert to manifest entries
    const manifestEntries: MediaManifestEntry[] = [];
    const seenUrls = new Set<string>();
    const byType: Record<string, number> = {};
    let totalSize = 0;

    for (const mediaItem of allMediaItems) {
      // Skip duplicates by URL
      if (seenUrls.has(mediaItem.url)) {
        continue;
      }
      seenUrls.add(mediaItem.url);

      // Generate human-readable unique filename: {sanitized-name}_{hash8}.{ext}
      // Normalize URL to strip expiring params for consistent hashing
      const normalizedUrl = this.normalizeDiscordUrl(mediaItem.url);
      const hash = createHash('sha256').update(normalizedUrl).digest('hex').substring(0, 8);
      const attachment = mediaItem.originalData as DiscordAttachment;
      const ext = this.getValidatedExtension(attachment.content_type, mediaItem.url, mediaItem.mediaType);
      const uniqueName = this.generateUniqueFilename(mediaItem.filename, normalizedUrl, ext);

      // Determine file type
      const fileTypeDir = await this.getFileTypeDir(attachment.content_type || '', mediaItem.filename);
      const type = fileTypeDir.replace(/s$/, '') as 'image' | 'video' | 'audio' | 'document'; // Remove trailing 's'

      // Detect spoiler and animated content
      const isSpoiler = this.isSpoiler(mediaItem.filename);
      const isAnimated = this.isAnimated(mediaItem.filename);

      // Get proxy URL if available (for embed media)
      const proxyUrl = attachment.proxy_url || undefined;

      // Track stats
      byType[type] = (byType[type] || 0) + 1;
      if (attachment.size) {
        totalSize += attachment.size;
      }

      manifestEntries.push({
        // Core identifiers
        url: mediaItem.url,
        proxy_url: proxyUrl,
        filename: mediaItem.filename,
        unique_name: uniqueName,
        hash,

        // File metadata
        type,
        is_spoiler: isSpoiler || undefined,
        is_animated: isAnimated || undefined,
        media_type: mediaItem.mediaType,
        size: attachment.size,
        content_type: attachment.content_type,
        width: attachment.width,
        height: attachment.height,

        // Discord context
        message_id: mediaItem.messageId,
        channel_id: mediaItem.channelId,
        channel_name: mediaItem.channelName,
        guild_id: mediaItem.guildId,
        guild_name: mediaItem.guildName,
        user_id: mediaItem.userId,
        timestamp: mediaItem.messageDate,

        // Message context
        message_content: mediaItem.messageContent,
        reactions: this.sanitizeReactions(mediaItem.reactions)
      });
    }

    const manifest: MediaManifest = {
      date: dateStr,
      source: sourceName,
      generated_at: new Date().toISOString(),
      base_path: `${sourceName}-media`,
      files: manifestEntries,
      stats: {
        total_files: manifestEntries.length,
        by_type: byType,
        total_size_bytes: totalSize
      }
    };

    logger.info(`Generated manifest with ${manifest.files.length} unique files (${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')})`);

    return manifest;
  }

  /**
   * Generate manifest and save to file
   *
   * @param date - The date to generate manifest for
   * @param sourceName - Source identifier (e.g., 'elizaos', 'hyperfy')
   * @param outputPath - Path to save the manifest JSON file
   */
  async generateManifestToFile(date: Date, sourceName: string, outputPath: string): Promise<MediaManifest> {
    const manifest = await this.generateManifest(date, sourceName);

    // Write manifest to file
    writeJsonFile(outputPath, manifest);
    logger.info(`Saved manifest to ${outputPath}`);

    return manifest;
  }

  /**
   * Print download statistics
   */
  printStats(): void {
    logger.info('\n📊 Download Statistics:');
    logger.info(`Total media items: ${this.stats.total}`);
    logger.info(`✅ Downloaded: ${this.stats.downloaded}`);
    logger.info(`⏭️  Skipped (already exists): ${this.stats.skipped}`);
    logger.info(`🚫 Filtered out: ${this.stats.filtered}`);
    logger.info(`❌ Failed: ${this.stats.failed}`);
    
    if (this.stats.errors.length > 0) {
      logger.info('\n🚨 Errors:');
      this.stats.errors.slice(0, 10).forEach(error => logger.error(`  ${error}`));
      if (this.stats.errors.length > 10) {
        logger.info(`  ... and ${this.stats.errors.length - 10} more errors`);
      }
    }
    
    // Print analytics if we have downloaded files
    if (this.stats.downloaded > 0) {
      this.printAnalytics();
    }
    
    const successRate = this.stats.total > 0 ? Math.round((this.stats.downloaded / this.stats.total) * 100) : 0;
    logger.info(`\n🎯 Success rate: ${successRate}%`);
  }

  /**
   * Print media analytics information
   */
  private printAnalytics(): void {
    logger.info('\n📈 Media Analytics:');
    
    // Media types distribution
    const types = Object.keys(this.analytics.totalFilesByType);
    if (types.length > 0) {
      logger.info('\n📊 File Types:');
      types.forEach(type => {
        const count = this.analytics.totalFilesByType[type];
        const avgSizeMB = (this.analytics.averageFileSizeByType[type] / 1024 / 1024).toFixed(2);
        const totalSizeMB = (this.analytics.totalSizeByType[type] / 1024 / 1024).toFixed(2);
        logger.info(`  ${type}: ${count} files, avg ${avgSizeMB}MB, total ${totalSizeMB}MB`);
        
        // Show top 5 largest files for this type
        const largest = this.analytics.largestFilesByType[type];
        if (largest && largest.length > 0) {
          logger.info(`    Largest files:`);
          largest.slice(0, 5).forEach((file, index) => {
            const sizeMB = (file.size / 1024 / 1024).toFixed(2);
            logger.info(`      ${index + 1}. ${file.filename} (${sizeMB}MB)`);
          });
        }
      });
    }
  }

  async close(): Promise<void> {
    await this.saveMediaIndex();
    await this.storage.close();
  }
}

/**
 * Standalone helper function for generating manifests
 * Can be imported and used from other modules like historical.ts
 */
export async function generateManifestToFile(
  dbPath: string,
  dateStr: string,
  sourceName: string,
  outputPath: string,
  endDateStr?: string
): Promise<MediaManifest> {
  const downloader = new MediaDownloader(dbPath, './media'); // outputDir not used for manifest
  await downloader.init();

  try {
    if (endDateStr) {
      // Date range: generate combined manifest
      const startDate = new Date(dateStr);
      const endDate = new Date(endDateStr);
      const allEntries: MediaManifestEntry[] = [];
      const seenUrls = new Set<string>();

      // Iterate through each date in range
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const manifest = await downloader.generateManifest(currentDate, sourceName);
        for (const entry of manifest.files) {
          if (!seenUrls.has(entry.url)) {
            seenUrls.add(entry.url);
            allEntries.push(entry);
          }
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Build combined manifest
      const combinedManifest: MediaManifest = {
        date: `${dateStr}_to_${endDateStr}`,
        source: sourceName,
        generated_at: new Date().toISOString(),
        base_path: `${sourceName}-media`,
        files: allEntries,
        stats: {
          total_files: allEntries.length,
          by_type: allEntries.reduce((acc, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          total_size_bytes: allEntries.reduce((sum, e) => sum + (e.size || 0), 0),
        },
      };

      writeJsonFile(outputPath, combinedManifest);
      return combinedManifest;
    } else {
      // Single date
      const date = new Date(dateStr);
      return await downloader.generateManifestToFile(date, sourceName, outputPath);
    }
  } finally {
    await downloader.close();
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  let dbPath = './data/db.sqlite';
  let outputDir = './media';
  let dateStr: string | undefined;
  let startDateStr: string | undefined;
  let endDateStr: string | undefined;
  let generateManifest = false;
  let allData = false;
  let manifestOutput: string | undefined;
  let sourceName = 'default';
  let organizeBy: 'flat' | 'server' | 'channel' = 'flat';

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        console.log(`
Discord Media Downloader

Downloads media files from Discord messages stored in the database.
Files are saved with human-readable names: {sanitized-name}_{hash8}.{ext}
Manifest is stored alongside files in the output directory.

Usage:
  npm run download-media                              # Download today's media (flat folder)
  npm run download-media -- --date 2024-01-15        # Download specific date
  npm run download-media -- --start 2024-01-10 --end 2024-01-15  # Download date range
  npm run download-media -- --by-server              # Organize by server (guild)
  npm run download-media -- --by-channel             # Organize by server/channel
  npm run download-media -- --db ./custom.sqlite     # Use custom database
  npm run download-media -- --output ./downloads     # Custom output directory

Manifest Generation (for VPS download - no API calls, reads from database):
  npm run generate-manifest -- --date 2024-01-15 --source elizaos --db ./data/elizaos.sqlite
  npm run generate-manifest -- --all --source elizaos --db ./data/elizaos.sqlite

Options:
  --date YYYY-MM-DD       Download/generate manifest for specific date
  --start YYYY-MM-DD      Start date for range download
  --end YYYY-MM-DD        End date for range download
  --all                   Generate manifest for ALL data in database
  --db PATH               Database file path (default: ./data/db.sqlite)
  --output PATH           Output directory for downloads (default: ./media)
  --by-server             Organize files by server: media/{server-name}/
  --by-channel            Organize files by channel: media/{server-name}/{channel-name}/
  --generate-manifest     Generate manifest JSON instead of downloading
  --manifest-output PATH  Output path for manifest file (default: {output}/manifest.json)
  --source NAME           Source name for manifest (default: 'default')
  --help, -h              Show this help message

File Naming:
  Files are saved as: {sanitized-original-name}_{hash8}.{ext}
  Example: screen-recording-20250906_085b9cc1.mp4
`);
        process.exit(0);

      case '--date':
        dateStr = args[++i];
        break;

      case '--start':
        startDateStr = args[++i];
        break;

      case '--end':
        endDateStr = args[++i];
        break;

      case '--db':
        dbPath = args[++i];
        break;

      case '--output':
        outputDir = args[++i];
        break;

      case '--by-server':
        organizeBy = 'server';
        break;

      case '--by-channel':
        organizeBy = 'channel';
        break;

      case '--generate-manifest':
        generateManifest = true;
        break;

      case '--all':
        allData = true;
        break;

      case '--manifest-output':
        manifestOutput = args[++i];
        break;

      case '--source':
        sourceName = args[++i];
        break;
    }
  }

  try {
    const downloader = new MediaDownloader(dbPath, outputDir, { enabled: true, organizeBy });
    await downloader.init();

    // Manifest generation mode
    if (generateManifest) {
      // Default manifest location: alongside media files
      const outputPath = manifestOutput || path.join(outputDir, 'manifest.json');
      let manifest: MediaManifest;

      if (allData) {
        // All data manifest - single query, no date iteration
        logger.info(`Generating full media manifest for all data`);
        manifest = await downloader.generateManifestAll(sourceName);
        // Save to file (ensure directory exists)
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
      } else if (startDateStr && endDateStr) {
        // Date range manifest
        logger.info(`Generating media manifest for range: ${startDateStr} to ${endDateStr}`);
        manifest = await generateManifestToFile(dbPath, startDateStr, sourceName, outputPath, endDateStr);
      } else {
        // Single date manifest
        const date = dateStr ? new Date(dateStr) : new Date();
        const dateStrFormatted = date.toISOString().split('T')[0];
        logger.info(`Generating media manifest for ${dateStrFormatted}`);
        manifest = await downloader.generateManifestToFile(date, sourceName, outputPath);
      }

      logger.info(`\nManifest Summary:`);
      logger.info(`  Date: ${manifest.date}`);
      logger.info(`  Source: ${manifest.source}`);
      logger.info(`  Total files: ${manifest.stats.total_files}`);
      logger.info(`  By type: ${Object.entries(manifest.stats.by_type).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      logger.info(`  Total size: ${(manifest.stats.total_size_bytes / 1024 / 1024).toFixed(2)} MB`);
      logger.info(`  Output: ${outputPath}`);

      await downloader.close();
      process.exit(0);
    }

    // Download mode
    let stats: DownloadStats;

    if (startDateStr && endDateStr) {
      // Date range download
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);
      logger.info(`Downloading media for date range: ${startDateStr} to ${endDateStr}`);
      stats = await downloader.downloadMediaInDateRange(startDate, endDate);
    } else if (dateStr) {
      // Specific date download
      const date = new Date(dateStr);
      logger.info(`Downloading media for date: ${dateStr}`);
      stats = await downloader.downloadMediaForDate(date);
    } else {
      // Default to today
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      logger.info(`Downloading media for today: ${todayStr}`);
      stats = await downloader.downloadMediaForDate(today);
    }

    downloader.printStats();
    await downloader.close();

    process.exit(stats.failed > 0 ? 1 : 0);

  } catch (error) {
    logger.error(`Failed to download media: ${error}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { MediaDownloader, MediaDownloadItem, DownloadStats, MediaManifest, MediaManifestEntry };
