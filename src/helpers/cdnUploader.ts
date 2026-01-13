/**
 * CDN upload helper with provider abstraction
 * Supports Bunny CDN with future extensibility for IPFS
 *
 * @module helpers/cdnUploader
 */

import fs from "fs";
import path from "path";
import https from "https";
import { URL } from "url";
import dotenv from "dotenv";
import { CDNConfig, CDNProvider, CDNUploadResult, MediaManifest } from "../types";
import { logger } from "./cliHelper";
import { swapUrlsInJsonFile } from "./mediaHelper";

dotenv.config();

// Helper function for delays
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Default propagation delay after upload before verification (CDN edge propagation)
// Bunny CDN storage API has eventual consistency - 5s provides reasonable buffer
const DEFAULT_PROPAGATION_DELAY_MS = 5000;

// Constants
const DEFAULT_STORAGE_HOST = "https://la.storage.bunnycdn.com";
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 4000; // 4 seconds fixed delay between retries
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// Allowed file extensions for upload
const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  ".mp4", ".webm", ".mov", ".avi", ".mkv",
  ".mp3", ".wav", ".ogg", ".flac",
  ".json", ".txt"
]);

/**
 * Validate remote path for security issues
 * @param remotePath - Remote path to validate
 * @returns Object with isValid flag and sanitized path or error message
 */
export function validateRemotePath(remotePath: string): { isValid: boolean; result: string } {
  // Strip leading slashes
  let cleanPath = remotePath.replace(/^\/+/, "");

  // Block path traversal
  if (cleanPath.includes("..")) {
    return { isValid: false, result: "Path traversal not allowed" };
  }

  // Block suspicious patterns
  if (/[<>|\x00]/.test(cleanPath)) {
    return { isValid: false, result: "Invalid characters in path" };
  }

  // Ensure path is not empty
  if (!cleanPath) {
    return { isValid: false, result: "Path cannot be empty" };
  }

  return { isValid: true, result: cleanPath };
}

/**
 * Get content type based on file extension
 * @param filePath - File path to check
 * @returns MIME type string
 */
export function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".json": "application/json",
    ".txt": "text/plain"
  };
  return contentTypes[ext] || "application/octet-stream";
}

/**
 * Bunny CDN Provider implementation
 */
export class BunnyCDNProvider implements CDNProvider {
  name = "bunny";
  private storageZone: string;
  private password: string;
  private storageHost: string;
  private cdnUrl: string;
  private dryRun: boolean;
  private maxFileSize: number;
  private skipExisting: boolean;

  constructor(config: {
    storageZone: string;
    password: string;
    storageHost?: string;
    cdnUrl?: string;
    dryRun?: boolean;
    maxFileSize?: number;
    skipExisting?: boolean;
  }) {
    this.storageZone = config.storageZone;
    this.password = config.password;
    this.storageHost = config.storageHost || DEFAULT_STORAGE_HOST;
    this.cdnUrl = config.cdnUrl || `https://${config.storageZone}.b-cdn.net`;
    this.dryRun = config.dryRun || false;
    this.maxFileSize = config.maxFileSize || MAX_FILE_SIZE_BYTES;
    this.skipExisting = config.skipExisting ?? true; // Default to skip existing
  }

  /**
   * Get the public CDN URL for a remote path
   */
  getPublicUrl(remotePath: string): string {
    const cleanPath = remotePath.replace(/^\/+/, "");
    return `${this.cdnUrl.replace(/\/+$/, "")}/${cleanPath}`;
  }

  /**
   * Check if a file exists on CDN storage using HEAD request to storage API
   * This checks the storage zone directly (requires AccessKey)
   */
  async checkExists(remotePath: string): Promise<boolean> {
    const validation = validateRemotePath(remotePath);
    if (!validation.isValid) return false;

    const cleanRemotePath = validation.result;

    return new Promise((resolve) => {
      const url = new URL(`${this.storageHost}/${this.storageZone}/${cleanRemotePath}`);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "HEAD",
        headers: {
          "AccessKey": this.password
        }
      };

      const req = https.request(options, (res) => {
        // 200 = exists, 404 = doesn't exist
        resolve(res.statusCode === 200);
      });

      req.on("error", () => resolve(false));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Check if a file exists via public CDN URL using HEAD request
   * This verifies the file is accessible to end users (no auth required)
   * May have different consistency characteristics than storage API
   */
  async checkExistsViaCDN(remotePath: string): Promise<{ exists: boolean; statusCode?: number }> {
    const validation = validateRemotePath(remotePath);
    if (!validation.isValid) return { exists: false };

    const cleanRemotePath = validation.result;
    const cdnUrl = this.getPublicUrl(cleanRemotePath);

    return new Promise((resolve) => {
      const url = new URL(cdnUrl);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "HEAD",
        headers: {
          "User-Agent": "CDN-Verifier/1.0"
        }
      };

      const req = https.request(options, (res) => {
        // 200 = exists and cached, 404 = not found
        resolve({ exists: res.statusCode === 200, statusCode: res.statusCode });
      });

      req.on("error", () => resolve({ exists: false }));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ exists: false });
      });

      req.end();
    });
  }

  /**
   * Upload a single file to Bunny CDN
   */
  async upload(localPath: string, remotePath: string): Promise<CDNUploadResult> {
    // Validate remote path
    const validation = validateRemotePath(remotePath);
    if (!validation.isValid) {
      return {
        localPath,
        remotePath,
        cdnUrl: "",
        success: false,
        message: `Invalid path: ${validation.result}`
      };
    }
    const cleanRemotePath = validation.result;

    // Check if file already exists on CDN (skip re-upload)
    if (this.skipExisting) {
      const exists = await this.checkExists(cleanRemotePath);
      if (exists) {
        return {
          localPath,
          remotePath: cleanRemotePath,
          cdnUrl: this.getPublicUrl(cleanRemotePath),
          success: true,
          message: "skipped-exists"
        };
      }
    }

    // Check file exists locally
    if (!fs.existsSync(localPath)) {
      return {
        localPath,
        remotePath: cleanRemotePath,
        cdnUrl: "",
        success: false,
        message: "File not found"
      };
    }

    // Check file size
    const stats = fs.statSync(localPath);
    if (stats.size > this.maxFileSize) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
      const maxMB = (this.maxFileSize / 1024 / 1024).toFixed(0);
      return {
        localPath,
        remotePath: cleanRemotePath,
        cdnUrl: "",
        success: false,
        message: `File too large: ${sizeMB}MB (max ${maxMB}MB)`,
        size: stats.size
      };
    }

    // Check file extension
    const ext = path.extname(localPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return {
        localPath,
        remotePath: cleanRemotePath,
        cdnUrl: "",
        success: false,
        message: `File type not allowed: ${ext}`
      };
    }

    // Dry run mode
    if (this.dryRun) {
      return {
        localPath,
        remotePath: cleanRemotePath,
        cdnUrl: this.getPublicUrl(cleanRemotePath),
        success: true,
        message: "dry-run",
        size: stats.size
      };
    }

    // Perform upload with retry
    return this.uploadWithRetry(localPath, cleanRemotePath, stats.size);
  }

  /**
   * Upload with retry logic for transient failures
   */
  private async uploadWithRetry(
    localPath: string,
    remotePath: string,
    fileSize: number
  ): Promise<CDNUploadResult> {
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const result = await this.doUpload(localPath, remotePath, fileSize);
        if (result.success) {
          return result;
        }

        // Check if error is retryable (5xx)
        if (result.message.includes("HTTP 5")) {
          lastError = result.message;
          logger.debug(`Upload attempt ${attempt} failed (retryable): ${result.message}`);

          // Wait before retry (except after last attempt)
          if (attempt < MAX_RETRY_ATTEMPTS) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        // Non-retryable error
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Retry on connection/timeout errors
        if (errorMsg.includes("ECONNRESET") ||
            errorMsg.includes("ETIMEDOUT") ||
            errorMsg.includes("ENOTFOUND")) {
          lastError = errorMsg;
          logger.debug(`Upload attempt ${attempt} failed (retryable): ${errorMsg}`);

          // Wait before retry (except after last attempt)
          if (attempt < MAX_RETRY_ATTEMPTS) {
            await delay(RETRY_DELAY_MS);
          }
          continue;
        }

        return {
          localPath,
          remotePath,
          cdnUrl: "",
          success: false,
          message: `Error: ${errorMsg}`,
          size: fileSize
        };
      }
    }

    return {
      localPath,
      remotePath,
      cdnUrl: "",
      success: false,
      message: `Failed after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError}`,
      size: fileSize
    };
  }

  /**
   * Perform the actual HTTP PUT upload
   */
  private doUpload(
    localPath: string,
    remotePath: string,
    fileSize: number
  ): Promise<CDNUploadResult> {
    return new Promise((resolve) => {
      const url = new URL(`${this.storageHost}/${this.storageZone}/${remotePath}`);

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "PUT",
        headers: {
          "AccessKey": this.password,
          "Content-Type": "application/octet-stream",
          "Content-Length": fileSize
        }
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve({
              localPath,
              remotePath,
              cdnUrl: this.getPublicUrl(remotePath),
              success: true,
              message: "uploaded",
              size: fileSize
            });
          } else {
            resolve({
              localPath,
              remotePath,
              cdnUrl: "",
              success: false,
              message: `HTTP ${res.statusCode}: ${data.substring(0, 100)}`,
              size: fileSize
            });
          }
        });
      });

      req.on("error", (error) => {
        resolve({
          localPath,
          remotePath,
          cdnUrl: "",
          success: false,
          message: `Request error: ${error.message}`,
          size: fileSize
        });
      });

      req.setTimeout(DEFAULT_TIMEOUT_MS, () => {
        req.destroy();
        resolve({
          localPath,
          remotePath,
          cdnUrl: "",
          success: false,
          message: "Request timeout",
          size: fileSize
        });
      });

      // Stream file to request
      const fileStream = fs.createReadStream(localPath);
      fileStream.pipe(req);
      fileStream.on("error", (error) => {
        req.destroy();
        resolve({
          localPath,
          remotePath,
          cdnUrl: "",
          success: false,
          message: `File read error: ${error.message}`,
          size: fileSize
        });
      });
    });
  }
}

/**
 * Create a CDN provider from config (factory function)
 */
export function createCDNProvider(config: CDNConfig): CDNProvider {
  if (config.provider === "bunny") {
    if (!config.storageZone || !config.password) {
      throw new Error("Bunny CDN requires storageZone and password");
    }
    return new BunnyCDNProvider({
      storageZone: config.storageZone,
      password: config.password,
      storageHost: config.storageHost,
      cdnUrl: config.cdnUrl,
      dryRun: config.dryRun,
      maxFileSize: config.maxFileSize,
      skipExisting: config.skipExisting
    });
  }

  // Future: Add IPFS provider here
  // if (config.provider === "ipfs") { ... }

  throw new Error(`Unsupported CDN provider: ${config.provider}`);
}

/**
 * Create default CDN config from environment variables
 */
export function getDefaultCDNConfig(): CDNConfig {
  return {
    provider: "bunny",
    storageZone: process.env.BUNNY_STORAGE_ZONE || "",
    storageHost: process.env.BUNNY_STORAGE_HOST || DEFAULT_STORAGE_HOST,
    cdnUrl: process.env.BUNNY_CDN_URL || "",
    password: process.env.BUNNY_STORAGE_PASSWORD || "",
    maxFileSize: MAX_FILE_SIZE_BYTES
  };
}

/**
 * Upload a single file to CDN (convenience function)
 */
export async function uploadFileToCDN(
  localPath: string,
  remotePath: string,
  config?: Partial<CDNConfig>
): Promise<CDNUploadResult> {
  const fullConfig = { ...getDefaultCDNConfig(), ...config };
  const provider = createCDNProvider(fullConfig as CDNConfig);
  return provider.upload(localPath, remotePath);
}

/**
 * Upload all files in a directory to CDN
 */
export async function uploadDirectoryToCDN(
  localDir: string,
  remotePrefix: string,
  config?: Partial<CDNConfig>,
  onProgress?: (current: number, total: number, filename: string, status: string) => void
): Promise<CDNUploadResult[]> {
  const fullConfig = { ...getDefaultCDNConfig(), ...config };
  const provider = createCDNProvider(fullConfig as CDNConfig);
  const results: CDNUploadResult[] = [];

  // Get all files in directory (non-recursive for now)
  if (!fs.existsSync(localDir)) {
    throw new Error(`Directory not found: ${localDir}`);
  }

  const allFiles = fs.readdirSync(localDir);
  // Filter to only files (not directories)
  const files = allFiles.filter(file => {
    const localPath = path.join(localDir, file);
    return fs.statSync(localPath).isFile();
  });

  const total = files.length;
  let current = 0;

  for (const file of files) {
    current++;
    const localPath = path.join(localDir, file);

    const remotePath = `${remotePrefix.replace(/\/+$/, "")}/${file}`;
    const result = await provider.upload(localPath, remotePath);
    results.push(result);

    // Report progress
    if (onProgress) {
      const status = result.success ? "✓" : "✗";
      onProgress(current, total, file, status);
    }
  }

  return results;
}

/**
 * Upload a base64-encoded image to CDN
 * Handles data URLs like "data:image/png;base64,..."
 *
 * @param base64Data - Base64 data URL (e.g., "data:image/png;base64,...")
 * @param remotePath - Remote path on CDN (without extension, will be added based on image type)
 * @param config - Optional CDN config overrides
 * @returns CDN upload result with public URL
 */
export async function uploadBase64ImageToCDN(
  base64Data: string,
  remotePath: string,
  config?: Partial<CDNConfig>
): Promise<CDNUploadResult> {
  // Parse the data URL to extract mime type and base64 content
  const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) {
    return {
      localPath: "",
      remotePath,
      cdnUrl: "",
      success: false,
      message: "Invalid base64 image data format. Expected: data:image/<type>;base64,<data>"
    };
  }

  const [, imageType, data] = matches;

  // Map image type to extension
  const extMap: Record<string, string> = {
    "jpeg": "jpg",
    "png": "png",
    "gif": "gif",
    "webp": "webp",
    "svg+xml": "svg"
  };
  const ext = extMap[imageType] || imageType;

  // Decode base64 to buffer
  let buffer: Buffer;
  try {
    buffer = Buffer.from(data, "base64");
  } catch (error) {
    return {
      localPath: "",
      remotePath,
      cdnUrl: "",
      success: false,
      message: `Failed to decode base64: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  // Write to temp file
  const tempPath = `/tmp/ai-image-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  try {
    fs.writeFileSync(tempPath, buffer);
  } catch (error) {
    return {
      localPath: tempPath,
      remotePath,
      cdnUrl: "",
      success: false,
      message: `Failed to write temp file: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  // Ensure remote path has correct extension
  const finalRemotePath = remotePath.endsWith(`.${ext}`)
    ? remotePath
    : `${remotePath.replace(/\.[^.]+$/, "")}.${ext}`;

  // Upload to CDN
  const result = await uploadFileToCDN(tempPath, finalRemotePath, config);

  // Clean up temp file
  try {
    fs.unlinkSync(tempPath);
  } catch {
    // Ignore cleanup errors
  }

  return result;
}

/**
 * Download an image from URL and upload to CDN
 * Preserves original filename for easy URL base swapping
 * e.g., https://i.imgflip.com/abc123.jpg -> https://cdn.example.com/imgflip/abc123.jpg
 *
 * @param sourceUrl - URL to download from
 * @param cdnFolder - Folder on CDN (e.g., "imgflip")
 * @param config - Optional CDN config overrides
 * @returns CDN upload result with public URL
 */
export async function downloadAndUploadToCDN(
  sourceUrl: string,
  cdnFolder: string,
  config?: Partial<CDNConfig>
): Promise<CDNUploadResult> {
  // Extract filename from source URL (e.g., "abc123.jpg" from "https://i.imgflip.com/abc123.jpg")
  const urlPath = new URL(sourceUrl).pathname;
  const filename = path.basename(urlPath);
  const ext = path.extname(filename).toLowerCase();

  // Validate extension
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      localPath: sourceUrl,
      remotePath: `${cdnFolder}/${filename}`,
      cdnUrl: "",
      success: false,
      message: `File type not allowed: ${ext}`
    };
  }

  const remotePath = `${cdnFolder.replace(/\/+$/, "")}/${filename}`;

  // Download to temp file
  const tempPath = `/tmp/cdn-download-${Date.now()}-${filename}`;

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return {
        localPath: sourceUrl,
        remotePath,
        cdnUrl: "",
        success: false,
        message: `Download failed: HTTP ${response.status}`
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Check file size
    const maxFileSize = config?.maxFileSize || MAX_FILE_SIZE_BYTES;
    if (buffer.length > maxFileSize) {
      const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
      const maxMB = (maxFileSize / 1024 / 1024).toFixed(0);
      return {
        localPath: sourceUrl,
        remotePath,
        cdnUrl: "",
        success: false,
        message: `File too large: ${sizeMB}MB (max ${maxMB}MB)`
      };
    }

    fs.writeFileSync(tempPath, buffer);
  } catch (error) {
    return {
      localPath: sourceUrl,
      remotePath,
      cdnUrl: "",
      success: false,
      message: `Download error: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  // Upload to CDN
  const result = await uploadFileToCDN(tempPath, remotePath, config);

  // Clean up temp file
  try {
    fs.unlinkSync(tempPath);
  } catch {
    // Ignore cleanup errors
  }

  return {
    ...result,
    localPath: sourceUrl // Show source URL instead of temp path
  };
}

/**
 * Download and upload multiple URLs to CDN
 * Returns map of original URL -> CDN URL for easy swapping
 */
export async function mirrorUrlsToCDN(
  sourceUrls: string[],
  cdnFolder: string,
  config?: Partial<CDNConfig>,
  onProgress?: (current: number, total: number, url: string, status: string) => void
): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();
  const total = sourceUrls.length;

  for (let i = 0; i < sourceUrls.length; i++) {
    const url = sourceUrls[i];
    const result = await downloadAndUploadToCDN(url, cdnFolder, config);

    if (result.success && result.cdnUrl) {
      urlMap.set(url, result.cdnUrl);
    }

    if (onProgress) {
      const status = result.success ? "✓" : "✗";
      onProgress(i + 1, total, url, status);
    }
  }

  return urlMap;
}

// ============================================================================
// CLI FUNCTIONALITY
// ============================================================================

interface UploadStats {
  total: number;
  uploaded: number;
  skipped: number;
  skippedExists: number;
  failed: number;
  totalSize: number;
}

/**
 * Prepare CDN config with credential validation and dry-run handling
 */
export function prepareCDNConfig(dryRun: boolean): CDNConfig {
  const config = getDefaultCDNConfig();
  config.dryRun = dryRun;

  // Allow dry-run without credentials for testing
  if (!dryRun && (!config.storageZone || !config.password)) {
    throw new Error(
      "Missing CDN credentials. Set BUNNY_STORAGE_ZONE and BUNNY_STORAGE_PASSWORD"
    );
  }

  // Use placeholder values for dry-run if not set
  if (dryRun) {
    config.storageZone = config.storageZone || "dry-run-zone";
    config.password = config.password || "dry-run-password";
  }

  return config;
}

/**
 * Upload a single file to CDN (CLI wrapper)
 */
export async function uploadSingleFileCLI(
  filePath: string,
  remotePath: string,
  dryRun: boolean
): Promise<CDNUploadResult> {
  const config = prepareCDNConfig(dryRun);

  // If remotePath is a directory (ends with /), append filename
  let finalRemotePath = remotePath;
  if (remotePath.endsWith("/")) {
    finalRemotePath = remotePath + path.basename(filePath);
  }

  return uploadFileToCDN(filePath, finalRemotePath, config);
}

/**
 * Upload directory to CDN (CLI wrapper with progress)
 */
export async function uploadDirectoryCLI(
  dirPath: string,
  remotePrefix: string,
  dryRun: boolean
): Promise<CDNUploadResult[]> {
  const config = prepareCDNConfig(dryRun);

  // Progress callback
  const onProgress = (current: number, total: number, filename: string, status: string) => {
    const pct = Math.round((current / total) * 100);
    const truncatedName = filename.length > 40 ? filename.substring(0, 37) + "..." : filename;
    process.stdout.write(`\r[${status}] ${current}/${total} (${pct}%) ${truncatedName.padEnd(43)}`);
    if (current === total) {
      process.stdout.write("\n");
    }
  };

  return uploadDirectoryToCDN(dirPath, remotePrefix, config, onProgress);
}

/**
 * Upload files from manifest and optionally update it with CDN URLs
 */
export async function uploadFromManifest(
  manifestPath: string,
  dryRun: boolean,
  updateManifest: boolean
): Promise<{ results: CDNUploadResult[]; manifest: MediaManifest }> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest: MediaManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

  const config = prepareCDNConfig(dryRun);
  const provider = createCDNProvider(config);

  const results: CDNUploadResult[] = [];
  const baseDir = path.dirname(manifestPath);
  const remotePrefix = `${manifest.source}-media`;

  for (const entry of manifest.files) {
    let localPath = path.join(baseDir, entry.unique_name);
    if (!fs.existsSync(localPath) && manifest.base_path) {
      localPath = path.join(manifest.base_path, entry.unique_name);
    }

    if (!fs.existsSync(localPath)) {
      results.push({
        localPath,
        remotePath: `${remotePrefix}/${entry.unique_name}`,
        cdnUrl: "",
        success: false,
        message: "File not found locally"
      });
      continue;
    }

    const remotePath = `${remotePrefix}/${entry.unique_name}`;
    const result = await provider.upload(localPath, remotePath);
    results.push(result);

    if (result.success && updateManifest) {
      entry.cdn_url = result.cdnUrl;
      entry.cdn_path = result.remotePath;
      entry.cdn_uploaded_at = new Date().toISOString();
    }
  }

  if (updateManifest) {
    const stats = calculateUploadStats(results);
    manifest.cdn = {
      provider: "bunny",
      base_url: provider.getPublicUrl(remotePrefix),
      uploaded_at: new Date().toISOString(),
      upload_stats: {
        total: stats.total,
        uploaded: stats.uploaded,
        skipped: stats.skipped,
        failed: stats.failed
      }
    };

    if (!dryRun) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      logger.info(`Updated manifest: ${manifestPath}`);
    }
  }

  return { results, manifest };
}

/**
 * Calculate upload statistics
 */
export function calculateUploadStats(results: CDNUploadResult[]): UploadStats {
  const stats: UploadStats = {
    total: results.length,
    uploaded: 0,
    skipped: 0,
    skippedExists: 0,
    failed: 0,
    totalSize: 0
  };

  for (const result of results) {
    if (result.success) {
      if (result.message === "dry-run") {
        stats.skipped++;
      } else if (result.message === "skipped-exists") {
        stats.skippedExists++;
      } else {
        stats.uploaded++;
      }
      stats.totalSize += result.size || 0;
    } else {
      stats.failed++;
    }
  }

  return stats;
}

/**
 * Verification result with detailed metrics for monitoring
 */
export interface VerificationResult {
  verified: number;
  failed: number;
  retried: number;
  initialVerified: number;
  initialFailed: number;
  totalFiles: number;
  initialSuccessRate: number;
  finalSuccessRate: number;
  hadInitialFailures: boolean;
  allRequiredRetry: boolean;
}

/**
 * Options for verification behavior
 */
export interface VerifyOptions {
  retryFailures?: boolean;
  remotePrefix?: string;
  propagationDelay?: number;  // ms to wait before verification (default: 2000)
  useCdnUrl?: boolean;        // verify via public CDN URL instead of storage API
}

/**
 * Verify CDN uploads by checking file accessibility
 *
 * IMPORTANT: This function tracks initial vs final verification rates
 * to detect silent failures where files don't immediately appear on CDN.
 *
 * When all files fail initial verification but succeed on retry, this
 * indicates a CDN propagation delay issue. The function will:
 * 1. Log a prominent warning about the issue
 * 2. Still return success if retries worked
 * 3. But set allRequiredRetry=true so callers can detect this condition
 */
export async function verifyManifestUploads(
  manifestPath: string,
  retryFailures: boolean = false,
  remotePrefix?: string,
  options?: VerifyOptions
): Promise<VerificationResult> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest: MediaManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

  if (!manifest.files || manifest.files.length === 0) {
    logger.info("No files to verify in manifest");
    return {
      verified: 0,
      failed: 0,
      retried: 0,
      initialVerified: 0,
      initialFailed: 0,
      totalFiles: 0,
      initialSuccessRate: 100,
      finalSuccessRate: 100,
      hadInitialFailures: false,
      allRequiredRetry: false
    };
  }

  // Merge options
  const opts: VerifyOptions = {
    retryFailures,
    remotePrefix,
    propagationDelay: DEFAULT_PROPAGATION_DELAY_MS,
    useCdnUrl: true,  // Use public CDN URL by default (more reliable than storage API)
    ...options
  };

  const config = getDefaultCDNConfig();
  const provider = createCDNProvider(config) as BunnyCDNProvider;
  const prefix = opts.remotePrefix || `${manifest.source}-media`;
  const totalFiles = manifest.files.length;

  // Wait for CDN propagation if configured
  if (opts.propagationDelay && opts.propagationDelay > 0) {
    logger.info(`Waiting ${opts.propagationDelay}ms for CDN propagation...`);
    await delay(opts.propagationDelay);
  }

  logger.info(`Verifying ${totalFiles} files via ${opts.useCdnUrl ? "CDN URL" : "storage API"}...`);

  let verified = 0;
  let failed = 0;
  let retried = 0;
  const failures: Array<{ entry: typeof manifest.files[0]; reason: string }> = [];

  // Verify each file
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i];
    const progress = i + 1;
    const pct = Math.round((progress / totalFiles) * 100);
    process.stdout.write(`\rVerifying: ${progress}/${totalFiles} (${pct}%)`);

    if (!entry.cdn_path) {
      failed++;
      failures.push({ entry, reason: "missing cdn_path in manifest" });
      continue;
    }

    try {
      let exists: boolean;
      let detail = "";

      if (opts.useCdnUrl) {
        // Verify via public CDN URL
        const result = await provider.checkExistsViaCDN(entry.cdn_path);
        exists = result.exists;
        if (!exists) {
          detail = result.statusCode ? `HTTP ${result.statusCode}` : "connection error";
        }
      } else {
        // Verify via storage API
        exists = await provider.checkExists(entry.cdn_path);
        if (!exists) {
          detail = "storage API verification failed (auth or not found)";
        }
      }

      if (exists) {
        verified++;
      } else {
        failed++;
        failures.push({ entry, reason: detail || "file not found" });
      }
    } catch (error) {
      failed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      failures.push({ entry, reason: `error: ${errorMsg}` });
    }
  }
  process.stdout.write("\n");

  // Track initial metrics BEFORE any retry
  const initialVerified = verified;
  const initialFailed = failed;
  const initialSuccessRate = totalFiles > 0 ? (initialVerified / totalFiles) * 100 : 100;
  const allRequiredRetry = initialFailed === totalFiles && totalFiles > 0;

  logger.info(`Initial verification: ${initialVerified} verified, ${initialFailed} failed`);

  // Warn loudly if verification rate is concerning
  if (allRequiredRetry) {
    logger.warning("");
    logger.warning("========================================");
    logger.warning("WARNING: 100% of files failed initial verification!");
    logger.warning("This indicates a CDN propagation delay or configuration issue.");
    logger.warning("========================================");
    logger.warning("");
    logger.warning("Sample failures:");
    failures.slice(0, 5).forEach(({ entry, reason }) => {
      logger.warning(`  - ${entry.unique_name}`);
      logger.warning(`    cdn_path: ${entry.cdn_path || "NOT SET"}`);
      logger.warning(`    reason: ${reason}`);
    });
    if (failures.length > 5) {
      logger.warning(`  ... and ${failures.length - 5} more`);
    }
    logger.warning("");
  } else if (initialSuccessRate < 90 && initialFailed > 0) {
    logger.warning(`WARNING: Only ${initialSuccessRate.toFixed(1)}% initial verification rate`);
    logger.warning("Sample failures:");
    failures.slice(0, 3).forEach(({ entry, reason }) => {
      logger.warning(`  - ${entry.unique_name}: ${reason}`);
    });
  }

  // Retry failures if requested
  if (opts.retryFailures && failures.length > 0) {
    logger.info(`\nRetrying ${failures.length} failed uploads...`);
    const baseDir = path.dirname(manifestPath);
    let retrySucceeded = 0;
    let retryFailed = 0;

    for (const { entry } of failures) {
      let localPath = path.join(baseDir, entry.unique_name);

      // Try base_path if file not found in manifest directory
      if (!fs.existsSync(localPath) && manifest.base_path) {
        localPath = path.join(manifest.base_path, entry.unique_name);
      }

      if (!fs.existsSync(localPath)) {
        logger.debug(`Local file not found for retry: ${entry.unique_name}`);
        retryFailed++;
        continue;
      }

      const remotePath = `${prefix}/${entry.unique_name}`;

      // Skip existing check is disabled for retry to force re-upload
      const retryConfig = { ...config, skipExisting: false };
      const retryProvider = createCDNProvider(retryConfig);
      const result = await retryProvider.upload(localPath, remotePath);

      if (result.success) {
        // Update entry with new CDN info
        entry.cdn_url = result.cdnUrl;
        entry.cdn_path = result.remotePath;
        entry.cdn_uploaded_at = new Date().toISOString();
        retried++;
        verified++;
        failed--;
        retrySucceeded++;
      } else {
        logger.debug(`Retry upload failed for ${entry.unique_name}: ${result.message}`);
        retryFailed++;
      }
    }

    logger.info(`Retry complete: ${retrySucceeded} succeeded, ${retryFailed} failed`);
  }

  // Update manifest with final state
  if (opts.retryFailures) {
    // Remove CDN info from entries that are still failed
    for (const entry of manifest.files) {
      if (!entry.cdn_url) {
        delete entry.cdn_path;
        delete entry.cdn_uploaded_at;
      }
    }

    // Update stats
    if (manifest.cdn) {
      manifest.cdn.upload_stats = {
        ...manifest.cdn.upload_stats,
        uploaded: verified,
        failed: failed
      };
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    logger.info(`Updated manifest: ${manifestPath}`);
  }

  const finalSuccessRate = totalFiles > 0 ? (verified / totalFiles) * 100 : 100;

  return {
    verified,
    failed,
    retried,
    initialVerified,
    initialFailed,
    totalFiles,
    initialSuccessRate,
    finalSuccessRate,
    hadInitialFailures: initialFailed > 0,
    allRequiredRetry
  };
}

/**
 * Update manifest with CDN URLs without uploading
 */
export async function updateManifestUrlsOnly(
  manifestPath: string,
  remotePrefix?: string
): Promise<MediaManifest> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest: MediaManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

  const config = getDefaultCDNConfig();
  const cdnBaseUrl = config.cdnUrl || `https://${config.storageZone || "cdn"}.b-cdn.net`;
  const prefix = remotePrefix || `${manifest.source}-media`;

  const now = new Date().toISOString();
  let updated = 0;

  for (const entry of manifest.files) {
    const remotePath = `${prefix}/${entry.unique_name}`;
    entry.cdn_url = `${cdnBaseUrl}/${remotePath}`;
    entry.cdn_path = remotePath;
    entry.cdn_uploaded_at = now;
    updated++;
  }

  manifest.cdn = {
    provider: "bunny",
    base_url: `${cdnBaseUrl}/${prefix}`,
    uploaded_at: now,
    upload_stats: {
      total: manifest.files.length,
      uploaded: updated,
      skipped: 0,
      failed: 0
    }
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  logger.info(`Updated ${updated} entries with CDN URLs`);
  logger.info(`Manifest saved: ${manifestPath}`);

  return manifest;
}

/**
 * Print results summary
 */
function printSummary(results: CDNUploadResult[], jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const stats = calculateUploadStats(results);

  logger.info("\n📊 Upload Statistics:");
  logger.info(`Total files: ${stats.total}`);
  logger.info(`✅ Uploaded: ${stats.uploaded}`);
  if (stats.skippedExists > 0) {
    logger.info(`⏭️  Skipped (already on CDN): ${stats.skippedExists}`);
  }
  if (stats.skipped > 0) {
    logger.info(`⏭️  Skipped (dry-run): ${stats.skipped}`);
  }
  logger.info(`❌ Failed: ${stats.failed}`);
  logger.info(`📦 Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);

  const failures = results.filter((r) => !r.success);
  if (failures.length > 0) {
    logger.info("\n🚨 Failures:");
    failures.slice(0, 10).forEach((f) => {
      logger.error(`  ${path.basename(f.localPath)}: ${f.message}`);
    });
    if (failures.length > 10) {
      logger.info(`  ... and ${failures.length - 10} more failures`);
    }
  }

  const successes = results.filter((r) => r.success && r.cdnUrl);
  if (successes.length > 0) {
    logger.info("\n🔗 Sample CDN URLs:");
    successes.slice(0, 3).forEach((s) => {
      logger.info(`  ${s.cdnUrl}`);
    });
  }
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
CDN Upload Tool

Uploads media files to Bunny CDN with support for single files, directories,
and manifest-based uploads.

Usage:
  npm run upload-cdn -- --file <path> --remote <path>   Upload single file
  npm run upload-cdn -- --dir <path> --remote <prefix>  Upload directory
  npm run upload-cdn -- --manifest <path>               Upload from manifest
  npm run upload-cdn -- --manifest <path> --verify      Verify CDN uploads
  npm run upload-cdn -- --swap-urls <json> --manifest <manifest>  Swap Discord URLs for CDN

Options:
  --file <path>         Local file to upload
  --dir <path>          Local directory to upload
  --manifest <path>     Manifest JSON file (reads files from manifest.files[])
  --remote <path>       Remote path/prefix on CDN
  --update-manifest     Update manifest with CDN URLs after upload
  --update-urls-only    Just update manifest with CDN URLs (no upload)
  --verify              Verify CDN uploads by checking file accessibility
  --retry-failures      Re-upload files that failed verification (use with --verify)
  --swap-urls <path>    Swap Discord URLs for CDN URLs in a JSON file (requires --manifest)
  --output <path>       Output path for --swap-urls (default: overwrites input file)
  --dry-run             Preview uploads without actually uploading
  --json                Output results as JSON
  --help, -h            Show this help message

Environment Variables:
  BUNNY_STORAGE_ZONE      Storage zone name (required)
  BUNNY_STORAGE_PASSWORD  Storage zone API password (required)
  BUNNY_CDN_URL           CDN URL (default: https://{zone}.b-cdn.net)
  BUNNY_STORAGE_HOST      Storage API host (default: https://la.storage.bunnycdn.com)

Exit Codes (for --verify):
  0  All files verified successfully on first attempt
  1  Some files failed verification even after retry
  2  All files needed retry (CDN propagation issue detected)

Examples:
  npm run upload-cdn -- --file ./media/image.png --remote elizaos-media/
  npm run upload-cdn -- --dir ./media/ --remote elizaos-media/
  npm run upload-cdn -- --manifest ./media/manifest.json --update-manifest
  npm run upload-cdn -- --manifest ./media/manifest.json --verify
  npm run upload-cdn -- --manifest ./media/manifest.json --verify --retry-failures
  npm run upload-cdn -- --dir ./media/ --remote elizaos-media/ --dry-run
`);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let filePath: string | undefined;
  let dirPath: string | undefined;
  let manifestPath: string | undefined;
  let remotePath: string | undefined;
  let updateManifest = false;
  let updateUrlsOnly = false;
  let verify = false;
  let retryFailures = false;
  let swapUrlsPath: string | undefined;
  let outputPath: string | undefined;
  let dryRun = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--file":
        filePath = args[++i];
        break;
      case "--dir":
        dirPath = args[++i];
        break;
      case "--manifest":
        manifestPath = args[++i];
        break;
      case "--remote":
        remotePath = args[++i];
        break;
      case "--update-manifest":
        updateManifest = true;
        break;
      case "--update-urls-only":
        updateUrlsOnly = true;
        break;
      case "--verify":
        verify = true;
        break;
      case "--retry-failures":
        retryFailures = true;
        break;
      case "--swap-urls":
        swapUrlsPath = args[++i];
        break;
      case "--output":
        outputPath = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--json":
        jsonOutput = true;
        break;
    }
  }

  try {
    let results: CDNUploadResult[] = [];

    if (swapUrlsPath) {
      if (!manifestPath) {
        throw new Error("--manifest is required for --swap-urls");
      }

      if (outputPath) {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
          logger.info(`Created output directory: ${outputDir}`);
        }
      }

      const targetPath = outputPath || swapUrlsPath;
      logger.info(`Swapping Discord URLs for CDN URLs: ${swapUrlsPath} -> ${targetPath}`);
      const success = swapUrlsInJsonFile(swapUrlsPath, manifestPath, outputPath);
      if (success) {
        logger.info(`Done! URLs swapped successfully. Output: ${targetPath}`);
      } else {
        logger.error("Failed to swap URLs.");
        process.exit(1);
      }
      process.exit(0);
    }

    if (filePath) {
      if (!remotePath) {
        throw new Error("--remote is required for file upload");
      }
      logger.info(`${dryRun ? "[DRY RUN] " : ""}Uploading file: ${filePath}`);
      const result = await uploadSingleFileCLI(filePath, remotePath, dryRun);
      results = [result];
    } else if (dirPath) {
      if (!remotePath) {
        throw new Error("--remote is required for directory upload");
      }
      logger.info(`${dryRun ? "[DRY RUN] " : ""}Uploading directory: ${dirPath}`);
      results = await uploadDirectoryCLI(dirPath, remotePath, dryRun);
    } else if (manifestPath && updateUrlsOnly) {
      logger.info(`Updating manifest with CDN URLs: ${manifestPath}`);
      await updateManifestUrlsOnly(manifestPath, remotePath);
      logger.info("Done! Manifest updated with CDN URLs.");
      process.exit(0);
    } else if (manifestPath && verify) {
      logger.info(`Verifying CDN uploads: ${manifestPath}`);
      const stats = await verifyManifestUploads(manifestPath, retryFailures, remotePath);

      logger.info("\n========================================");
      logger.info("Verification Summary");
      logger.info("========================================");
      logger.info(`Total files: ${stats.totalFiles}`);
      logger.info(`Initial verified: ${stats.initialVerified}`);
      logger.info(`Initial failed: ${stats.initialFailed}`);
      logger.info(`Initial success rate: ${stats.initialSuccessRate.toFixed(1)}%`);

      if (stats.retried > 0) {
        logger.info(`\nRetried uploads: ${stats.retried}`);
        logger.info(`Final verified: ${stats.verified}`);
        logger.info(`Final failed: ${stats.failed}`);
        logger.info(`Final success rate: ${stats.finalSuccessRate.toFixed(1)}%`);
      }

      // Determine exit code based on verification results
      let exitCode = 0;

      if (stats.failed > 0) {
        // Some files still failed after retry
        logger.error(`\nERROR: ${stats.failed} files failed verification`);
        exitCode = 1;
      } else if (stats.allRequiredRetry) {
        // All files failed initially but recovered via retry
        // This indicates a systemic issue (CDN propagation delay or path mismatch)
        logger.warning("\nWARNING: All files failed initial verification!");
        logger.warning("Files only passed after retry upload, indicating:");
        logger.warning("  1. CDN propagation delay (files not immediately available after upload)");
        logger.warning("  2. Possible path mismatch between upload and verification");
        logger.warning("  3. Storage API eventual consistency issue");
        logger.warning("\nThis is a pipeline reliability issue that should be investigated.");
        logger.warning("Consider adding a delay between upload and verification steps.");
        // Exit with code 2 to indicate "success with warnings"
        // This allows CI to distinguish between hard failures (1) and soft issues (2)
        exitCode = 2;
      }

      process.exit(exitCode);
    } else if (manifestPath) {
      logger.info(`${dryRun ? "[DRY RUN] " : ""}Uploading from manifest: ${manifestPath}`);
      const { results: uploadResults } = await uploadFromManifest(manifestPath, dryRun, updateManifest);
      results = uploadResults;
    } else {
      printHelp();
      process.exit(1);
    }

    printSummary(results, jsonOutput);

    const failures = results.filter((r) => !r.success);
    process.exit(failures.length > 0 ? 1 : 0);
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
