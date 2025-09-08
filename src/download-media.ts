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
const USER_AGENT = 'DiscordBot (AI-News-Aggregator, 1.0) Node.js/Discord.js'; // Discord API compliant User-Agent

// Discord Rate Limiting Constants
const DISCORD_GLOBAL_RATE_LIMIT = 50; // 50 requests per second globally
const DISCORD_RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_CONCURRENT_DOWNLOADS = 5; // Limit concurrent downloads

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
    const dirs = [
      path.join(this.baseDir, 'images'),
      path.join(this.baseDir, 'videos'),
      path.join(this.baseDir, 'audio'),
      path.join(this.baseDir, 'documents'),
      path.join(this.baseDir, 'metadata')
    ];
    
    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
   * Organize downloaded file into correct directory based on actual content
   */
  private async organizeDownloadedFile(filePath: string, mediaItem: MediaDownloadItem, hash: string, originalFilename: string): Promise<number> {
    let actualFileSize = 0;
    
    try {
      // Get actual file size
      const fileStats = fs.statSync(filePath);
      actualFileSize = fileStats.size;
      
      // Detect actual file type from content
      const actualFileType = await this.detectActualFileType(filePath);
      const attachment = mediaItem.originalData as DiscordAttachment;
      const expectedType = await this.getFileTypeDir(attachment.content_type || '', mediaItem.filename);
      
      let finalPath = filePath;
      let finalType = expectedType;
      
      // If actual type differs from expected, move file to correct directory
      if (actualFileType !== 'unknown' && actualFileType !== expectedType) {
        const correctDir = path.join(this.baseDir, actualFileType);
        fs.mkdirSync(correctDir, { recursive: true });
        
        const newPath = path.join(correctDir, originalFilename);
        
        // Move file to correct directory
        if (!fs.existsSync(newPath)) {
          fs.renameSync(filePath, newPath);
          finalPath = newPath;
          finalType = actualFileType;
          
          logger.info(`📁 Moved ${originalFilename} from ${expectedType}/ to ${actualFileType}/ (detected: ${this.getFileTypeDescription(actualFileType)})`);
        } else {
          // File already exists in correct location, remove duplicate
          fs.unlinkSync(filePath);
          logger.debug(`Removed duplicate file: ${originalFilename}`);
          return actualFileSize;
        }
      }
      
      // Update analytics
      this.updateAnalytics(mediaItem, actualFileSize, finalType);
      
      // Add to media index
      const mediaIndexEntry: MediaIndexEntry = {
        hash,
        originalFilename: mediaItem.filename,
        contentType: attachment.content_type || 'unknown',
        fileSize: actualFileSize,
        filePath: path.relative(this.baseDir, finalPath),
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
      logger.debug(`Failed to organize downloaded file ${filePath}: ${error}`);
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
              originalData: attachment
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
                originalData: embed
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
                originalData: embed
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
                originalData: { content_type: 'video/mp4', size: undefined, ...embed }
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
            const extension = sticker.format_type === 1 ? 'png' : 'gif';
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
              }
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
    // Determine file type directory (initial classification)
    const attachment = mediaItem.originalData as DiscordAttachment;
    const fileTypeDir = await this.getFileTypeDir(attachment.content_type || '', mediaItem.filename);
    const typeDir = path.join(this.baseDir, fileTypeDir);
    
    // Ensure directories exist
    fs.mkdirSync(typeDir, { recursive: true });
    
    // Create unique filename to avoid conflicts
    const hash = createHash('sha256').update(mediaItem.url).digest('hex').substring(0, 8);
    const basename = path.parse(mediaItem.filename).name;
    const extension = path.parse(mediaItem.filename).ext;
    const uniqueFilename = `${basename}_${hash}${extension}`;
    const filePath = path.join(typeDir, uniqueFilename);
    
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
    const downloadPromises = allMediaItems.map((mediaItem, index) => {
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
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  let dbPath = './data/db.sqlite';
  let outputDir = './media';
  let dateStr: string | undefined;
  let startDateStr: string | undefined;
  let endDateStr: string | undefined;

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        console.log(`
Discord Media Downloader

Downloads media files from Discord messages stored in the database.
Organizes files by type: media/images/, media/videos/, media/audio/, media/documents/
Stores metadata in: media/metadata/YYYY-MM-DD.json, media/metadata/index.json

Usage:
  npm run download-media                    # Download today's media
  npm run download-media -- --date 2024-01-15     # Download specific date
  npm run download-media -- --start 2024-01-10 --end 2024-01-15  # Download date range
  npm run download-media -- --db ./custom.sqlite   # Use custom database
  npm run download-media -- --output ./downloads   # Custom output directory

Options:
  --date YYYY-MM-DD     Download media for specific date
  --start YYYY-MM-DD    Start date for range download
  --end YYYY-MM-DD      End date for range download
  --db PATH             Database file path (default: ./data/db.sqlite)
  --output PATH         Output directory (default: ./media)
  --help, -h            Show this help message
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
    }
  }

  try {
    const downloader = new MediaDownloader(dbPath, outputDir);
    await downloader.init();

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

export { MediaDownloader, MediaDownloadItem, DownloadStats };