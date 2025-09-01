/**
 * Media download script for Discord data
 * Downloads media files from Discord messages stored in the database
 * Organizes files by date in media/YYYY-MM-DD/ folders
 * 
 * @module download-media
 */

import { SQLiteStorage } from "./plugins/storage/SQLiteStorage";
import { ContentItem, DiscordRawData, DiscordAttachment, DiscordEmbed, DiscordSticker } from "./types";
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

dotenv.config();

interface MediaDownloadItem {
  url: string;
  filename: string;
  messageId: string;
  messageDate: string;
  channelName: string;
  guildName: string;
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
  errors: string[];
}

class MediaDownloader {
  private storage: SQLiteStorage;
  private baseDir: string;
  private stats: DownloadStats;
  private mediaIndex: Map<string, MediaIndexEntry> = new Map();
  private dailyReferences: MediaReference[] = [];

  constructor(dbPath: string, baseDir: string = './media') {
    this.storage = new SQLiteStorage({ name: 'media-downloader', dbPath });
    this.baseDir = baseDir;
    this.stats = {
      total: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
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
  private getFileTypeDir(contentType: string, filename: string): string {
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
   * Extract all media items from Discord raw data
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
              channelName: discordData.channel.name,
              guildName: item.metadata?.guildName || 'unknown',
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
                channelName: discordData.channel.name,
                guildName: item.metadata?.guildName || 'unknown',
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
                channelName: discordData.channel.name,
                guildName: item.metadata?.guildName || 'unknown',
                mediaType: 'embed_thumbnail',
                originalData: embed
              });
            }
            
            if (embed.video?.url) {
              const filename = `embed-video-${message.id}.${embed.video.url.split('.').pop() || 'mp4'}`;
              mediaItems.push({
                url: embed.video.url,
                filename,
                messageId: message.id,
                messageDate,
                channelName: discordData.channel.name,
                guildName: item.metadata?.guildName || 'unknown',
                mediaType: 'embed_video',
                originalData: embed
              });
            }
          }
        }

        // Process stickers
        if (message.sticker_items) {
          for (const sticker of message.sticker_items) {
            const extension = sticker.format_type === 1 ? 'png' : 'gif';
            const filename = `${sticker.name}.${extension}`;
            const stickerUrl = `https://media.discordapp.net/stickers/${sticker.id}.${extension}`;
            
            mediaItems.push({
              url: stickerUrl,
              filename,
              messageId: message.id,
              messageDate,
              channelName: discordData.channel.name,
              guildName: item.metadata?.guildName || 'unknown',
              mediaType: 'sticker',
              originalData: sticker
            });
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
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      const success = await this.downloadMediaAttempt(mediaItem, attempt);
      if (success) {
        return true;
      }
      
      // If not the last attempt, wait before retrying with exponential backoff
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
        logger.debug(`Retrying download for ${mediaItem.filename} in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return false; // All attempts failed
  }

  /**
   * Single attempt to download a media file
   */
  private async downloadMediaAttempt(mediaItem: MediaDownloadItem, attempt: number): Promise<boolean> {
    const dateDir = path.join(this.baseDir, mediaItem.messageDate);
    const guildChannelDir = `${this.sanitizeFilename(mediaItem.guildName)}_${this.sanitizeFilename(mediaItem.channelName)}`;
    const channelDir = path.join(dateDir, guildChannelDir);
    
    // Ensure directories exist
    fs.mkdirSync(channelDir, { recursive: true });
    
    // Create unique filename to avoid conflicts
    const hash = createHash('sha256').update(mediaItem.url).digest('hex').substring(0, 8);
    const basename = path.parse(mediaItem.filename).name;
    const extension = path.parse(mediaItem.filename).ext;
    const uniqueFilename = `${basename}_${hash}${extension}`;
    const filePath = path.join(channelDir, uniqueFilename);
    
    // Skip if file already exists
    if (fs.existsSync(filePath)) {
      if (attempt === 1) { // Only log once
        logger.debug(`Skipping existing file: ${uniqueFilename}`);
        this.stats.skipped++;
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

      const request = https.get(mediaItem.url, (response) => {
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

        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          const errorMsg = `HTTP ${response.statusCode} for ${mediaItem.url} (attempt ${attempt})`;
          if (attempt === MAX_RETRY_ATTEMPTS) {
            this.stats.failed++;
            this.stats.errors.push(errorMsg);
            logger.error(`Failed to download ${mediaItem.url}: HTTP ${response.statusCode}`);
          }
          file.close();
          try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
          resolve(false);
          return;
        }

        response.pipe(file);
        
        file.on('finish', () => {
          clearTimeout(timeout);
          file.close();
          if (attempt === 1) { // Only count once
            this.stats.downloaded++;
            logger.debug(`Downloaded: ${uniqueFilename}`);
          }
          resolve(true);
        });
        
        file.on('error', (err) => {
          clearTimeout(timeout);
          const errorMsg = `File write error for ${mediaItem.url}: ${err.message} (attempt ${attempt})`;
          if (attempt === MAX_RETRY_ATTEMPTS) {
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
        if (attempt === MAX_RETRY_ATTEMPTS) {
          this.stats.failed++;
          this.stats.errors.push(errorMsg);
          logger.error(errorMsg);
        }
        file.close();
        try { fs.unlinkSync(filePath); } catch (e) {} // Clean up partial file
        resolve(false);
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
    
    // Download media with rate limiting
    let processed = 0;
    for (const mediaItem of allMediaItems) {
      await this.downloadMedia(mediaItem);
      processed++;
      
      if (processed % 10 === 0) {
        logger.info(`Progress: ${processed}/${allMediaItems.length} (${Math.round(processed/allMediaItems.length*100)}%)`);
      }
      
      // Rate limiting - wait 100ms between downloads
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return this.stats;
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
    logger.info(`❌ Failed: ${this.stats.failed}`);
    
    if (this.stats.errors.length > 0) {
      logger.info('\n🚨 Errors:');
      this.stats.errors.slice(0, 10).forEach(error => logger.error(`  ${error}`));
      if (this.stats.errors.length > 10) {
        logger.info(`  ... and ${this.stats.errors.length - 10} more errors`);
      }
    }
    
    const successRate = this.stats.total > 0 ? Math.round((this.stats.downloaded / this.stats.total) * 100) : 0;
    logger.info(`\n🎯 Success rate: ${successRate}%`);
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