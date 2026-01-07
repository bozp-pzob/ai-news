/**
 * CDN Upload CLI
 * Uploads media files to CDN (Bunny CDN by default)
 *
 * Usage:
 *   npm run upload-cdn -- --file ./media/image.png --remote elizaos-media/
 *   npm run upload-cdn -- --dir ./media/ --remote elizaos-media/
 *   npm run upload-cdn -- --manifest ./media/manifest.json --update-manifest
 *
 * @module upload-cdn
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { logger } from "./helpers/cliHelper";
import {
  BunnyCDNProvider,
  getDefaultCDNConfig,
  uploadDirectoryToCDN
} from "./helpers/cdnUploader";
import { swapUrlsInJsonFile } from "./helpers/mediaLookup";
import { CDNUploadResult, MediaManifest } from "./types";

dotenv.config();

interface UploadStats {
  total: number;
  uploaded: number;
  skipped: number;
  skippedExists: number;
  failed: number;
  totalSize: number;
}

/**
 * Upload a single file to CDN
 */
async function uploadSingleFile(
  filePath: string,
  remotePath: string,
  dryRun: boolean
): Promise<CDNUploadResult> {
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

  const provider = new BunnyCDNProvider({
    storageZone: config.storageZone!,
    password: config.password!,
    storageHost: config.storageHost,
    cdnUrl: config.cdnUrl,
    dryRun: config.dryRun,
    maxFileSize: config.maxFileSize
  });

  // If remotePath is a directory (ends with /), append filename
  let finalRemotePath = remotePath;
  if (remotePath.endsWith("/")) {
    finalRemotePath = remotePath + path.basename(filePath);
  }

  return provider.upload(filePath, finalRemotePath);
}

/**
 * Upload directory to CDN
 */
async function uploadDirectory(
  dirPath: string,
  remotePrefix: string,
  dryRun: boolean
): Promise<CDNUploadResult[]> {
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
async function uploadFromManifest(
  manifestPath: string,
  dryRun: boolean,
  updateManifest: boolean
): Promise<{ results: CDNUploadResult[]; manifest: MediaManifest }> {
  // Read manifest
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const manifest: MediaManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  );

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

  const provider = new BunnyCDNProvider({
    storageZone: config.storageZone!,
    password: config.password!,
    storageHost: config.storageHost,
    cdnUrl: config.cdnUrl,
    dryRun: config.dryRun,
    maxFileSize: config.maxFileSize
  });

  const results: CDNUploadResult[] = [];
  const baseDir = path.dirname(manifestPath);

  // Build remote prefix from manifest source
  const remotePrefix = `${manifest.source}-media`;

  for (const entry of manifest.files) {
    // Local file path - check both base_path and direct filename
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

    // Update manifest entry with CDN URL if successful
    if (result.success && updateManifest) {
      entry.cdn_url = result.cdnUrl;
      entry.cdn_path = result.remotePath;
      entry.cdn_uploaded_at = new Date().toISOString();
    }
  }

  // Update manifest with CDN metadata
  if (updateManifest) {
    const stats = calculateStats(results);
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

    // Write updated manifest (unless dry-run)
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
function calculateStats(results: CDNUploadResult[]): UploadStats {
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
 * Update manifest with CDN URLs without uploading (for already-uploaded files)
 */
async function updateManifestUrlsOnly(
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

  // Update manifest CDN metadata
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

  // Write updated manifest
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

  const stats = calculateStats(results);

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
  logger.info(
    `📦 Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`
  );

  // Print failures
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

  // Print sample CDN URLs
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
  npm run upload-cdn -- --swap-urls <json> --manifest <manifest>  Swap Discord URLs for CDN

Options:
  --file <path>         Local file to upload
  --dir <path>          Local directory to upload
  --manifest <path>     Manifest JSON file (reads files from manifest.files[])
  --remote <path>       Remote path/prefix on CDN
  --update-manifest     Update manifest with CDN URLs after upload
  --update-urls-only    Just update manifest with CDN URLs (no upload)
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

Examples:
  # Upload single file
  npm run upload-cdn -- --file ./media/image.png --remote elizaos-media/

  # Upload directory
  npm run upload-cdn -- --dir ./media/ --remote elizaos-media/

  # Upload from manifest and update it with CDN URLs
  npm run upload-cdn -- --manifest ./media/manifest.json --update-manifest

  # Dry run (preview without uploading)
  npm run upload-cdn -- --dir ./media/ --remote elizaos-media/ --dry-run

  # Swap Discord URLs for CDN URLs in output JSON (overwrites file)
  npm run upload-cdn -- --swap-urls ./output/elizaos/json/2026-01-01.json --manifest ./media/manifest.json

  # Swap URLs to a separate CDN-enriched directory
  npm run upload-cdn -- --swap-urls ./output/elizaos/json/2026-01-01.json --manifest ./media/manifest.json --output ./output/elizaos/json-cdn/2026-01-01.json
`);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let filePath: string | undefined;
  let dirPath: string | undefined;
  let manifestPath: string | undefined;
  let remotePath: string | undefined;
  let updateManifest = false;
  let updateUrlsOnly = false;
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

    // Handle --swap-urls option
    if (swapUrlsPath) {
      if (!manifestPath) {
        throw new Error("--manifest is required for --swap-urls");
      }

      // Create output directory if specified and doesn't exist
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
      // Single file upload
      if (!remotePath) {
        throw new Error("--remote is required for file upload");
      }
      logger.info(
        `${dryRun ? "[DRY RUN] " : ""}Uploading file: ${filePath}`
      );
      const result = await uploadSingleFile(filePath, remotePath, dryRun);
      results = [result];
    } else if (dirPath) {
      // Directory upload
      if (!remotePath) {
        throw new Error("--remote is required for directory upload");
      }
      logger.info(
        `${dryRun ? "[DRY RUN] " : ""}Uploading directory: ${dirPath}`
      );
      results = await uploadDirectory(dirPath, remotePath, dryRun);
    } else if (manifestPath && updateUrlsOnly) {
      // Just update manifest with CDN URLs (no upload)
      logger.info(`Updating manifest with CDN URLs: ${manifestPath}`);
      await updateManifestUrlsOnly(manifestPath, remotePath);
      logger.info("Done! Manifest updated with CDN URLs.");
      process.exit(0);
    } else if (manifestPath) {
      // Manifest-based upload
      logger.info(
        `${dryRun ? "[DRY RUN] " : ""}Uploading from manifest: ${manifestPath}`
      );
      const { results: uploadResults } = await uploadFromManifest(
        manifestPath,
        dryRun,
        updateManifest
      );
      results = uploadResults;
    } else {
      printHelp();
      process.exit(1);
    }

    printSummary(results, jsonOutput);

    // Exit with error code if any failures
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

export { uploadSingleFile, uploadDirectory, uploadFromManifest };
