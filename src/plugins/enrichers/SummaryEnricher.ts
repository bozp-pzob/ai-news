/**
 * SummaryEnricher - Enriches generated JSON summaries with memes and posters.
 *
 * This runs AFTER generators produce summaries, enriching the category content
 * with contextually relevant memes and AI-generated images.
 *
 * Pipeline: Fetch → Store → Generate → Enrich (this) → CDN upload
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ContentItem, EnricherPlugin } from "@types";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
} from "../../helpers/configHelper";
import { logger } from "../../helpers/cliHelper";

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

export interface SummaryEnricherConfig {
  /** Enricher plugins (MemeEnricher, AiImageEnricher) */
  enrichers: EnricherPlugin[];
  /** Output directory for JSON files */
  outputPath: string;
}

export class SummaryEnricher {
  private enrichers: EnricherPlugin[];
  private outputPath: string;

  constructor(config: SummaryEnricherConfig) {
    this.enrichers = config.enrichers;
    this.outputPath = config.outputPath;
  }

  /**
   * Enrich a summary JSON file with memes and posters.
   *
   * @param dateStr - Date string (YYYY-MM-DD) for the summary
   * @param jsonSubpath - Subpath within outputPath (e.g., "elizaos/json")
   */
  public async enrichSummary(dateStr: string, jsonSubpath: string): Promise<void> {
    const jsonPath = path.join(this.outputPath, jsonSubpath, `${dateStr}.json`);

    if (!fs.existsSync(jsonPath)) {
      console.log(`SummaryEnricher: No JSON file found at ${jsonPath}`);
      return;
    }

    console.log(`\n=== SummaryEnricher ===`);
    console.log(`Enriching: ${jsonPath}`);

    try {
      const jsonContent = fs.readFileSync(jsonPath, "utf-8");
      const summary: SummaryJson = JSON.parse(jsonContent);

      if (!summary.categories || summary.categories.length === 0) {
        console.log(`SummaryEnricher: No categories in summary`);
        return;
      }

      let totalEnriched = 0;

      // Process each category
      for (const category of summary.categories) {
        if (!category.content || !Array.isArray(category.content) || category.content.length === 0) continue;

        const categoryTopic = category.topic || category.title || "unknown";
        console.log(`SummaryEnricher: Processing category "${categoryTopic}" with ${category.content.length} content items`);

        // Process each content item in the category
        for (let i = 0; i < category.content.length; i++) {
          const contentItem = category.content[i];

          // Skip if already has memes and posters
          if (contentItem.memes?.length && contentItem.posters?.length) {
            continue;
          }

          // Skip if no text
          if (!contentItem.text || contentItem.text.trim().length === 0) {
            continue;
          }

          // Convert to ContentItem format for enrichers
          const fakeContentItem: ContentItem = {
            cid: `summary-${dateStr}-${categoryTopic}-${i}`,
            source: "summary",
            type: this.topicToSourceType(categoryTopic),
            title: category.title,
            text: contentItem.text,
            date: new Date(dateStr).getTime() / 1000,
            metadata: {
              images: contentItem.images || [],
              videos: contentItem.videos || [],
              memes: contentItem.memes || [],
            },
          };

          // Run enrichers
          let enrichedItems = [fakeContentItem];
          for (const enricher of this.enrichers) {
            enrichedItems = await enricher.enrich(enrichedItems);
          }

          const enriched = enrichedItems[0];

          // Extract generated media back to category content
          if (enriched.metadata?.memes?.length) {
            contentItem.memes = enriched.metadata.memes;
            totalEnriched++;
          }

          if (enriched.metadata?.images?.length) {
            // Add new AI-generated images as posters (don't replace existing images)
            const newPosters = enriched.metadata.images.filter(
              (img: string) => !contentItem.images?.includes(img)
            );
            if (newPosters.length > 0) {
              contentItem.posters = [...(contentItem.posters || []), ...newPosters];
              totalEnriched++;
            }
          }
        }
      }

      // Write updated JSON back
      fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
      console.log(`SummaryEnricher: Enriched ${totalEnriched} content items, saved to ${jsonPath}\n`);

    } catch (error) {
      console.error(`SummaryEnricher: Error enriching ${jsonPath}:`, error);
    }
  }

  /**
   * Map category topics back to source types for enricher compatibility.
   */
  private topicToSourceType(topic: string): string {
    const mapping: Record<string, string> = {
      discordrawdata: "discordRawData",
      discord: "discordRawData",
      issue: "githubIssue",
      issues: "githubIssue",
      pull_request: "githubPullRequest",
      pull_requests: "githubPullRequest",
      github_summary: "githubStatsSummary",
      contributors: "githubTopContributors",
      completed_items: "githubCompletedItem",
    };
    return mapping[topic.toLowerCase()] || topic;
  }
}

// ============================================================================
// CLI FUNCTIONALITY
// ============================================================================

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

/**
 * Print help message
 */
function printHelp(): void {
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
}

/**
 * Main CLI function
 */
async function main() {
  dotenv.config();

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
      printHelp();
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
          if (category.content && Array.isArray(category.content)) {
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
