/**
 * Media download script for Discord data
 * Downloads media files from Discord messages stored in the database
 * Organizes files by type and date with content-hash deduplication
 * 
 * @module download-media
 */

import { SQLiteStorage } from "./plugins/storage/SQLiteStorage";
import { ContentItem, DiscordAttachment, DiscordEmbed, DiscordSticker } from "./types";
import { logger } from "./helpers/cliHelper";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { createHash } from "crypto";

// Constants for network operations
const DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_BASE_MS = 1000; // Base delay for exponential backoff
const DEFAULT_RATE_LIMIT_MS = 500; // Rate limit between downloads
const USER_AGENT = 'DiscordBot (AI-News-Aggregator, 1.0) Node.js/Discord.js';

dotenv.config();

interface MediaDownloadItem {
  url: string;
  filename: string;
  contentType?: string;
  messageId: string;
  messageDate: string;
  channelName: string;
  guildName: string;
  mediaType: 'attachment' | 'embed_image' | 'embed_thumbnail' | 'embed_video' | 'sticker';
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

  async init(): Promise<void> {
    await this.storage.init();
    await this.loadMediaIndex();
    await this.ensureDirectoryStructure();
    logger.info('Media downloader initialized');
  }

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

  private async saveMediaIndex(): Promise<void> {
    const indexPath = path.join(this.baseDir, 'metadata', 'index.json');
    const metadataDir = path.dirname(indexPath);
    
    fs.mkdirSync(metadataDir, { recursive: true });
    
    const indexData = Array.from(this.mediaIndex.values());
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    logger.debug(`Saved ${indexData.length} entries to media index`);
  }

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

  private generateContentHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private generateUrlHash(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  private extractMediaFromDiscordData(item: ContentItem): MediaDownloadItem[] {
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
                  filename: this.extractFilenameFromUrl(embed.image.url),
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
                  filename: this.extractFilenameFromUrl(embed.thumbnail.url),
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

  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'unknown';
      return filename.includes('.') ? filename : `${filename}.jpg`;
    } catch {
      return 'unknown.jpg';
    }
  }

  private async downloadFile(item: MediaDownloadItem, outputPath: string): Promise<{ success: boolean; fileSize: number; contentType: string }> {
    return new Promise((resolve, reject) => {
      const request = https.get(item.url, {
        timeout: DOWNLOAD_TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT
        }
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const fileSize = parseInt(response.headers['content-length'] || '0');
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        
        const writeStream = fs.createWriteStream(outputPath);
        response.pipe(writeStream);

        writeStream.on('finish', () => {
          resolve({ success: true, fileSize, contentType });
        });

        writeStream.on('error', (error) => {
          reject(error);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  private async downloadWithRetry(item: MediaDownloadItem, outputPath: string): Promise<{ success: boolean; fileSize: number; contentType: string }> {
    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.downloadFile(item, outputPath);
      } catch (error) {
        lastError = error as Error;
        logger.debug(`Download attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for ${item.filename}: ${error}`);
        
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  async downloadMediaForDate(date: string): Promise<void> {
    logger.info(`Starting media download for date: ${date}`);
    
    // Convert date to epoch range (start and end of day)
    // Database stores epoch in seconds, not milliseconds
    const startOfDay = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000);
    const endOfDay = Math.floor(new Date(date + 'T23:59:59Z').getTime() / 1000);
    
    const items = await this.storage.getContentItemsBetweenEpoch(startOfDay, endOfDay, 'discordRawData');
    const allMediaItems: MediaDownloadItem[] = [];

    for (const item of items) {
      const mediaItems = this.extractMediaFromDiscordData(item);
      allMediaItems.push(...mediaItems);
    }

    this.stats.total = allMediaItems.length;
    logger.info(`Found ${this.stats.total} media items for ${date}`);

    if (this.stats.total === 0) {
      return;
    }

    // Create date directory
    const dateDir = path.join(this.baseDir, date);
    fs.mkdirSync(dateDir, { recursive: true });

    // Process media items
    for (let i = 0; i < allMediaItems.length; i++) {
      const item = allMediaItems[i];
      
      try {
        // Generate URL hash for deduplication check
        const urlHash = this.generateUrlHash(item.url);
        
        // Check if we already have this media
        if (this.mediaIndex.has(urlHash)) {
          logger.debug(`Skipping duplicate media: ${item.filename}`);
          this.stats.skipped++;
          continue;
        }

        // Determine file type directory
        const typeDir = this.getFileTypeDir(item.contentType || '', item.filename);
        const fullTypeDir = path.join(dateDir, typeDir);
        fs.mkdirSync(fullTypeDir, { recursive: true });

        // Create unique filename to avoid conflicts
        const timestamp = new Date(item.messageDate).getTime();
        const uniqueFilename = `${timestamp}_${item.messageId}_${item.filename}`;
        const outputPath = path.join(fullTypeDir, uniqueFilename);

        // Download file
        logger.info(`[${i + 1}/${this.stats.total}] Downloading: ${item.filename}`);
        const result = await this.downloadWithRetry(item, outputPath);

        if (result.success) {
          // Generate content hash
          const fileData = fs.readFileSync(outputPath);
          const contentHash = this.generateContentHash(fileData);

          // Add to media index
          const indexEntry: MediaIndexEntry = {
            hash: contentHash,
            originalFilename: item.filename,
            contentType: result.contentType,
            fileSize: result.fileSize,
            filePath: path.relative(this.baseDir, outputPath),
            firstSeen: timestamp
          };

          this.mediaIndex.set(urlHash, indexEntry);
          this.stats.downloaded++;
          
          logger.success(`Downloaded: ${item.filename} (${result.fileSize} bytes)`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, DEFAULT_RATE_LIMIT_MS));

      } catch (error) {
        const errorMsg = `Failed to download ${item.filename}: ${error}`;
        logger.error(errorMsg);
        this.stats.failed++;
        this.stats.errors.push(errorMsg);
      }
    }

    await this.saveMediaIndex();
    this.logStats();
  }

  private logStats(): void {
    logger.info(`\n📊 Download Statistics:`);
    logger.info(`Total media items: ${this.stats.total}`);
    logger.info(`Successfully downloaded: ${this.stats.downloaded}`);
    logger.info(`Skipped (duplicates): ${this.stats.skipped}`);
    logger.info(`Failed: ${this.stats.failed}`);
    
    if (this.stats.errors.length > 0) {
      logger.info(`\n❌ Errors:`);
      for (const error of this.stats.errors.slice(0, 10)) {
        logger.error(`  ${error}`);
      }
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

async function main() {
  const args = process.argv.slice(2);
  
  // Help command
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Discord Media Downloader

Downloads media files from Discord messages stored in the database.
Organizes files by type: media/images/, media/videos/, media/audio/, media/documents/
Stores metadata in: media/metadata/

Usage:
  npm run download-media                    # Download today's media
  npm run download-media -- --date 2024-01-15     # Download specific date
  npm run download-media -- --db ./custom.sqlite   # Use custom database
  npm run download-media -- --output ./downloads   # Custom output directory

Options:
  --date YYYY-MM-DD     Download media for specific date
  --db PATH             Database file path (default: data/db.sqlite)
  --output PATH         Output directory (default: ./media)
  --help, -h            Show this help message
    `);
    process.exit(0);
  }

  // Parse arguments
  let targetDate = new Date().toISOString().split('T')[0]; // Today
  let dbPath = 'data/db.sqlite';
  let outputDir = './media';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--date':
        targetDate = args[i + 1];
        i++;
        break;
      case '--db':
        dbPath = args[i + 1];
        i++;
        break;
      case '--output':
        outputDir = args[i + 1];
        i++;
        break;
    }
  }

  const downloader = new MediaDownloader(dbPath, outputDir);
  
  try {
    await downloader.init();
    await downloader.downloadMediaForDate(targetDate);
  } catch (error) {
    logger.error(`Media download failed: ${error}`);
    process.exit(1);
  } finally {
    await downloader.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}