/**
 * Standalone script to enrich JSON summaries with memes and posters.
 *
 * This is a thin CLI wrapper around SummaryEnricher, allowing quick iteration
 * on media generation without re-fetching or re-generating summaries.
 *
 * Usage:
 *   npm run enrich-json -- --json ./output/elizaos/json/2026-01-06.json --config elizaos.json
 *   npm run enrich-json -- --dir ./output/elizaos/json --date 2026-01-06 --config elizaos.json
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { EnricherPlugin } from "./types";
import { SummaryEnricher } from "./plugins/enrichers/SummaryEnricher";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
} from "./helpers/configHelper";
import { logger } from "./helpers/cliHelper";

dotenv.config();

/**
 * Parse a JSON file path into components for SummaryEnricher
 * Example: ./output/elizaos/json/2026-01-06.json
 *   -> { outputPath: './output', jsonSubpath: 'elizaos/json', dateStr: '2026-01-06' }
 */
function parseJsonPath(jsonPath: string): { outputPath: string; jsonSubpath: string; dateStr: string } | null {
  const absolutePath = path.resolve(jsonPath);
  const filename = path.basename(absolutePath, '.json');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!datePattern.test(filename)) {
    logger.error(`Invalid date format in filename: ${filename} (expected YYYY-MM-DD)`);
    return null;
  }

  const dirPath = path.dirname(absolutePath);
  const parts = dirPath.split(path.sep);

  // Find "output" in the path to split into outputPath and jsonSubpath
  const outputIndex = parts.findIndex(p => p === 'output');

  if (outputIndex === -1) {
    logger.error(`Could not find 'output' directory in path: ${dirPath}`);
    return null;
  }

  const outputPath = parts.slice(0, outputIndex + 1).join(path.sep);
  const jsonSubpath = parts.slice(outputIndex + 1).join(path.sep);

  return { outputPath, jsonSubpath, dateStr: filename };
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments (supports both --arg=value and --arg value)
  let jsonFile: string | undefined;
  let jsonDir: string | undefined;
  let date: string | undefined;
  let configFile = "elizaos.json";
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg.startsWith("--json=")) {
      jsonFile = arg.split("=")[1];
    } else if (arg === "--json" && nextArg && !nextArg.startsWith("--")) {
      jsonFile = nextArg;
      i++;
    } else if (arg.startsWith("--dir=")) {
      jsonDir = arg.split("=")[1];
    } else if (arg === "--dir" && nextArg && !nextArg.startsWith("--")) {
      jsonDir = nextArg;
      i++;
    } else if (arg.startsWith("--date=")) {
      date = arg.split("=")[1];
    } else if (arg === "--date" && nextArg && !nextArg.startsWith("--")) {
      date = nextArg;
      i++;
    } else if (arg.startsWith("--config=")) {
      configFile = arg.split("=")[1];
    } else if (arg === "--config" && nextArg && !nextArg.startsWith("--")) {
      configFile = nextArg;
      i++;
    } else if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Enrich JSON Summaries with Memes and Posters

Usage:
  npm run enrich-json -- --json <file.json> --config <config.json>
  npm run enrich-json -- --dir <json_dir> --date <YYYY-MM-DD> --config <config.json>

Options:
  --json=<file>     Single JSON file to enrich
  --dir=<dir>       Directory containing JSON files
  --date=<date>     Date to process (used with --dir)
  --config=<file>   Config file name (default: elizaos.json)
  --force, -f       Force regenerate memes/posters (clears existing)
  --help, -h        Show this help

Examples:
  npm run enrich-json -- --json ./output/elizaos/json/2026-01-06.json
  npm run enrich-json -- --json ./output/elizaos/json/2026-01-06.json --force
  npm run enrich-json -- --dir ./output/elizaos/json --date 2026-01-06
`);
      process.exit(0);
    }
  }

  if (!jsonFile && !jsonDir) {
    logger.error("Must specify --json or --dir");
    process.exit(1);
  }

  // Load config and enrichers
  const configPath = path.join(process.cwd(), "config", configFile);
  if (!fs.existsSync(configPath)) {
    logger.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  logger.info(`Loading config: ${configPath}`);
  const configJSON = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Load enricher and AI provider classes
  const enricherClasses = await loadDirectoryModules("enrichers");
  const aiClasses = await loadDirectoryModules("ai");

  // Initialize enrichers with AI providers
  let aiConfigs = await loadItems(configJSON.ai, aiClasses, "ai");
  let enricherConfigs = await loadItems(configJSON.enrichers, enricherClasses, "enrichers");
  enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);

  const enrichers: EnricherPlugin[] = enricherConfigs.map((c: any) => c.instance);

  if (enrichers.length === 0) {
    logger.warning("No enrichers configured");
    process.exit(0);
  }

  logger.info(`Loaded ${enrichers.length} enrichers`);

  // Determine which files to process
  const filesToProcess: string[] = [];

  if (jsonFile) {
    filesToProcess.push(jsonFile);
  } else if (jsonDir) {
    if (date) {
      filesToProcess.push(path.join(jsonDir, `${date}.json`));
    } else {
      // Process all JSON files in directory
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json"));
      filesToProcess.push(...files.map(f => path.join(jsonDir, f)));
    }
  }

  // Process each file using SummaryEnricher
  let totalEnriched = 0;

  for (const filePath of filesToProcess) {
    if (!fs.existsSync(filePath)) {
      logger.warning(`File not found: ${filePath}`);
      continue;
    }

    // Parse the path to extract components
    const parsed = parseJsonPath(filePath);
    if (!parsed) {
      logger.error(`Could not parse path: ${filePath}`);
      continue;
    }

    const { outputPath, jsonSubpath, dateStr } = parsed;

    // Handle --force by clearing existing memes/posters
    if (force) {
      const jsonContent = fs.readFileSync(filePath, 'utf-8');
      const summary = JSON.parse(jsonContent);

      if (summary.categories) {
        for (const category of summary.categories) {
          if (category.content) {
            for (const item of category.content) {
              delete item.memes;
              delete item.posters;
            }
          }
        }
        fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
        logger.info(`Cleared existing media from ${dateStr}`);
      }
    }

    // Use SummaryEnricher to enrich the file
    const summaryEnricher = new SummaryEnricher({
      enrichers,
      outputPath
    });

    try {
      await summaryEnricher.enrichSummary(dateStr, jsonSubpath);
      totalEnriched++;
      logger.success(`✅ Enriched ${dateStr}`);
    } catch (error) {
      logger.error(`Failed to enrich ${dateStr}: ${error}`);
    }
  }

  logger.success(`\n✨ Complete: Enriched ${totalEnriched}/${filesToProcess.length} files`);
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  });
}
