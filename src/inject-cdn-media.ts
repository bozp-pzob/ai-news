/**
 * Inject CDN Media into JSON
 *
 * Reads memes/posters from the database and injects them into json-cdn output.
 * Also swaps Discord URLs for CDN URLs.
 *
 * Usage:
 *   npm run inject-cdn-media -- --json ./output/json/2026-01-01.json --db ./data/elizaos.sqlite --manifest ./media/manifest.json --output ./output/json-cdn/2026-01-01.json
 *
 * @module inject-cdn-media
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { buildUrlSwapMap, swapUrlsInObject } from "./helpers/mediaLookup";
import { logger } from "./helpers/cliHelper";
import {
  mirrorUrlsToCDN,
  uploadBase64ImageToCDN,
  getDefaultCDNConfig
} from "./helpers/cdnUploader";

dotenv.config();

// CDN folder for Imgflip memes - preserves original filenames for easy URL swapping
const IMGFLIP_CDN_FOLDER = "imgflip";
// CDN folder for AI-generated posters
const POSTERS_CDN_FOLDER = "posters";

interface ContentMessage {
  text: string;
  sources: string[];
  images: string[];
  videos: string[];
  posters?: string[];
  memes?: Array<{ url: string; template?: string; summary?: string }>;
}

interface CategoryContent {
  title: string;
  topic?: string;
  content: ContentMessage[];
}

interface SummaryJson {
  type: string;
  title: string;
  date: number;
  categories: CategoryContent[];
}

interface MemeData {
  url: string;
  template?: string;
  summary?: string;
}

interface PosterData {
  url: string;
}

/**
 * Extract memes and posters from database for a given date
 */
async function getMediaFromDb(
  dbPath: string,
  dateStr: string
): Promise<{ memes: MemeData[]; posters: PosterData[] }> {
  const memes: MemeData[] = [];
  const posters: PosterData[] = [];

  // Parse date to epoch range
  const startDate = new Date(dateStr);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(dateStr);
  endDate.setUTCHours(23, 59, 59, 999);

  const startEpoch = Math.floor(startDate.getTime() / 1000);
  const endEpoch = Math.floor(endDate.getTime() / 1000);

  let db: Database<sqlite3.Database, sqlite3.Statement> | null = null;

  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });

    // Query items with memes or images in metadata
    const rows = await db.all(
      `SELECT metadata FROM items WHERE date >= ? AND date <= ? AND metadata IS NOT NULL`,
      [startEpoch, endEpoch]
    );

    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata);

        // Extract memes
        if (metadata.memes && Array.isArray(metadata.memes)) {
          for (const meme of metadata.memes) {
            if (meme.url) {
              memes.push({
                url: meme.url,
                template: meme.template,
                summary: meme.summary,
              });
            }
          }
        }

        // Extract AI-generated images (posters)
        if (metadata.images && Array.isArray(metadata.images)) {
          for (const img of metadata.images) {
            if (typeof img === "string") {
              posters.push({ url: img });
            } else if (img.url) {
              posters.push({ url: img.url });
            }
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    logger.info(`Found ${memes.length} memes and ${posters.length} posters for ${dateStr}`);
  } catch (error) {
    logger.error(`Error reading from database: ${error}`);
  } finally {
    if (db) {
      await db.close();
    }
  }

  return { memes, posters };
}

/**
 * Mirror memes from Imgflip to CDN
 * Returns memes with CDN URLs instead of Imgflip URLs
 */
async function mirrorMemesToCDN(memes: MemeData[]): Promise<MemeData[]> {
  if (memes.length === 0) return memes;

  // Check if CDN credentials are available
  const config = getDefaultCDNConfig();
  if (!config.storageZone || !config.password) {
    logger.info("CDN credentials not set, keeping Imgflip URLs");
    return memes;
  }

  // Extract Imgflip URLs
  const imgflipUrls = memes
    .map(m => m.url)
    .filter(url => url.includes("imgflip.com"));

  if (imgflipUrls.length === 0) {
    logger.info("No Imgflip URLs to mirror");
    return memes;
  }

  logger.info(`Mirroring ${imgflipUrls.length} memes to CDN (${IMGFLIP_CDN_FOLDER}/)...`);

  // Mirror to CDN
  const urlMap = await mirrorUrlsToCDN(
    imgflipUrls,
    IMGFLIP_CDN_FOLDER,
    config,
    (current, total, url, status) => {
      const filename = path.basename(new URL(url).pathname);
      process.stdout.write(`\r[${status}] ${current}/${total} ${filename.padEnd(20)}`);
      if (current === total) process.stdout.write("\n");
    }
  );

  logger.info(`Mirrored ${urlMap.size}/${imgflipUrls.length} memes to CDN`);

  // Update meme URLs
  return memes.map(meme => ({
    ...meme,
    url: urlMap.get(meme.url) || meme.url
  }));
}

/**
 * Upload posters to CDN
 * Handles both base64 data URLs and regular URLs
 */
async function uploadPostersToCDN(
  posters: PosterData[],
  dateStr: string
): Promise<PosterData[]> {
  if (posters.length === 0) return posters;

  const config = getDefaultCDNConfig();
  if (!config.storageZone || !config.password) {
    logger.info("CDN credentials not set, keeping original poster URLs");
    return posters;
  }

  logger.info(`Uploading ${posters.length} posters to CDN...`);
  const results: PosterData[] = [];

  for (let i = 0; i < posters.length; i++) {
    const poster = posters[i];

    // Handle base64 data URLs
    if (poster.url.startsWith("data:image/")) {
      const remotePath = `${POSTERS_CDN_FOLDER}/${dateStr}/poster-${i + 1}`;
      const result = await uploadBase64ImageToCDN(poster.url, remotePath, config);
      if (result.success && result.cdnUrl) {
        results.push({ url: result.cdnUrl });
        logger.info(`  [✓] Uploaded poster ${i + 1}`);
      } else {
        logger.info(`  [✗] Failed poster ${i + 1}: ${result.message}`);
        results.push(poster); // Keep original
      }
    } else {
      // Keep regular URLs as-is (or mirror if needed)
      results.push(poster);
    }
  }

  return results;
}

/**
 * Inject memes and posters into JSON categories
 */
function injectMediaIntoJson(
  data: SummaryJson,
  memes: MemeData[],
  posters: PosterData[]
): SummaryJson {
  if (!data.categories || !Array.isArray(data.categories)) {
    return data;
  }

  // Distribute memes and posters across categories
  // Strategy: Add memes/posters to first content item of each category
  const numCategories = data.categories.length;

  // Calculate distribution
  const memesPerCategory = Math.ceil(memes.length / Math.max(numCategories, 1));
  const postersPerCategory = Math.ceil(posters.length / Math.max(numCategories, 1));

  let memeIndex = 0;
  let posterIndex = 0;

  for (const category of data.categories) {
    if (!category.content || !Array.isArray(category.content)) {
      continue;
    }

    // Collect memes for this category
    const categoryMemes: MemeData[] = [];
    for (let i = 0; i < memesPerCategory && memeIndex < memes.length; i++) {
      categoryMemes.push(memes[memeIndex++]);
    }

    // Collect posters for this category
    const categoryPosters: string[] = [];
    for (let i = 0; i < postersPerCategory && posterIndex < posters.length; i++) {
      categoryPosters.push(posters[posterIndex++].url);
    }

    // Add to first content item
    if (category.content.length > 0) {
      if (categoryMemes.length > 0) {
        category.content[0].memes = categoryMemes;
      }
      if (categoryPosters.length > 0) {
        category.content[0].posters = categoryPosters;
      }
    }
  }

  return data;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let jsonPath = "";
  let dbPath = "";
  let manifestPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--json":
        jsonPath = args[++i];
        break;
      case "--db":
        dbPath = args[++i];
        break;
      case "--manifest":
        manifestPath = args[++i];
        break;
      case "--output":
        outputPath = args[++i];
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  // Validate required arguments
  if (!jsonPath || !dbPath || !outputPath) {
    logger.error("Missing required arguments");
    printHelp();
    process.exit(1);
  }

  // Read input JSON
  if (!fs.existsSync(jsonPath)) {
    logger.error(`JSON file not found: ${jsonPath}`);
    process.exit(1);
  }

  // Read and parse JSON
  let data: SummaryJson;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch (error) {
    logger.error(`Failed to parse JSON: ${error}`);
    process.exit(1);
  }

  // Extract date from JSON or filename
  const dateStr = extractDateFromJson(data, jsonPath);
  if (!dateStr) {
    logger.error("Could not determine date from JSON");
    process.exit(1);
  }
  logger.info(`Processing date: ${dateStr}`);

  // Get memes and posters from database
  let { memes, posters } = await getMediaFromDb(dbPath, dateStr);

  // Mirror memes from Imgflip to CDN (imgflip/ folder, preserves filenames)
  memes = await mirrorMemesToCDN(memes);

  // Upload posters to CDN (posters/{date}/ folder)
  posters = await uploadPostersToCDN(posters, dateStr);

  // Inject media into JSON
  data = injectMediaIntoJson(data, memes, posters);

  // Swap Discord URLs for CDN URLs if manifest provided
  if (manifestPath && fs.existsSync(manifestPath)) {
    logger.info(`Swapping URLs using manifest: ${manifestPath}`);
    const swapMap = buildUrlSwapMap(manifestPath);
    if (swapMap.size > 0) {
      data = swapUrlsInObject(data, swapMap);
      logger.info(`Swapped ${swapMap.size} URL mappings`);
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  logger.info(`CDN-enriched JSON saved to: ${outputPath}`);
}

/**
 * Extract date string from JSON data or filename
 */
function extractDateFromJson(data: SummaryJson, filePath: string): string | null {
  // Try to get from JSON date field (epoch seconds)
  if (data.date) {
    const date = new Date(data.date * 1000);
    return date.toISOString().slice(0, 10);
  }

  // Try to extract from filename (e.g., 2026-01-01.json)
  const basename = path.basename(filePath, ".json");
  if (/^\d{4}-\d{2}-\d{2}$/.test(basename)) {
    return basename;
  }

  // Try to extract from title
  if (data.title) {
    const match = data.title.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Inject CDN Media Tool

Reads memes/posters from the database and injects them into json-cdn output.
Also optionally swaps Discord URLs for CDN URLs using a manifest.

Usage:
  npm run inject-cdn-media -- --json <path> --db <path> --output <path> [--manifest <path>]

Required Arguments:
  --json <path>      Input JSON file (from regular json/ output)
  --db <path>        SQLite database path
  --output <path>    Output path for CDN-enriched JSON

Optional Arguments:
  --manifest <path>  Media manifest for URL swapping
  --help, -h         Show this help message

Examples:
  npm run inject-cdn-media -- \\
    --json ./output/elizaos/json/2026-01-01.json \\
    --db ./data/elizaos.sqlite \\
    --manifest ./media-upload/manifest.json \\
    --output ./output/elizaos/json-cdn/2026-01-01.json
`);
}

main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
