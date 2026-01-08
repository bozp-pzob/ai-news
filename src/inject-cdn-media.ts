/**
 * Inject CDN Media into JSON
 *
 * Swaps Discord attachment URLs for CDN URLs using a manifest file.
 * Memes and posters are now handled directly by enrichers during generation
 * (CDN-first architecture).
 *
 * Usage:
 *   npm run inject-cdn-media -- --json ./output/json/2026-01-01.json --manifest ./media/manifest.json --output ./output/json-cdn/2026-01-01.json
 *
 * @module inject-cdn-media
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { buildUrlSwapMap, swapUrlsInObject } from "./helpers/mediaHelper";
import { logger } from "./helpers/cliHelper";
import {
  removeEmptyArrays,
  calculateReduction,
  formatSize,
} from "./helpers/fileHelper";

dotenv.config();

interface SummaryJson {
  type: string;
  title: string;
  date: number;
  categories: any[];
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let jsonPath = "";
  let manifestPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--json":
        jsonPath = args[++i];
        break;
      case "--db":
        // DB argument kept for backwards compatibility but no longer used
        logger.info("Note: --db argument is deprecated (memes/posters handled by enrichers)");
        i++;
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
  if (!jsonPath || !outputPath) {
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

  // Swap Discord URLs for CDN URLs if manifest provided
  if (manifestPath && fs.existsSync(manifestPath)) {
    logger.info(`Swapping URLs using manifest: ${manifestPath}`);
    const swapMap = buildUrlSwapMap(manifestPath);
    if (swapMap.size > 0) {
      data = swapUrlsInObject(data, swapMap);
      logger.info(`Swapped ${swapMap.size} URL mappings`);
    } else {
      logger.info("No URLs to swap in manifest");
    }
  } else if (manifestPath) {
    logger.warning(`Manifest not found: ${manifestPath}`);
  } else {
    logger.info("No manifest provided, skipping URL swap");
  }

  // Clean JSON by removing empty arrays
  const originalSize = Buffer.byteLength(JSON.stringify(data, null, 2), "utf-8");
  const cleanedData = removeEmptyArrays(data);
  const cleanedSize = Buffer.byteLength(JSON.stringify(cleanedData, null, 2), "utf-8");

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(cleanedData, null, 2));
  logger.info(`CDN-enriched JSON saved to: ${outputPath}`);
  logger.info(`Size: ${formatSize(originalSize)} → ${formatSize(cleanedSize)} (-${calculateReduction(originalSize, cleanedSize)})`);
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

Swaps Discord attachment URLs for CDN URLs using a manifest file.
Automatically removes empty arrays (videos/memes/posters) for cleaner output.
Memes and posters are handled directly by enrichers during generation.

Usage:
  npm run inject-cdn-media -- --json <path> --output <path> [--manifest <path>]

Required Arguments:
  --json <path>      Input JSON file
  --output <path>    Output path for CDN-enriched JSON

Optional Arguments:
  --manifest <path>  Media manifest for Discord URL swapping
  --db <path>        (Deprecated) Database path - no longer needed
  --help, -h         Show this help message

Features:
  - Swaps Discord URLs with CDN URLs
  - Removes empty arrays (reduces size ~15-20%)
  - Preserves only non-empty media arrays

Examples:
  npm run inject-cdn-media -- \\
    --json ./output/elizaos/json/2026-01-01.json \\
    --manifest ./media-upload/manifest.json \\
    --output ./output/elizaos/json-cdn/2026-01-01.json
`);
}

main().catch((error) => {
  logger.error(`Fatal error: ${error}`);
  process.exit(1);
});
