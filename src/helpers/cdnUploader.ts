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
import { CDNConfig, CDNProvider, CDNUploadResult } from "../types";
import { logger } from "./cliHelper";

// Constants
const DEFAULT_STORAGE_HOST = "https://la.storage.bunnycdn.com";
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes
const MAX_RETRY_ATTEMPTS = 2;
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
   * Check if a file exists on CDN using HEAD request
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
