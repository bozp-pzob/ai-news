/**
 * Standalone script to enrich JSON summaries with memes and posters.
 *
 * This runs independently of the main pipeline, allowing quick iteration
 * on media generation without re-fetching or re-generating summaries.
 *
 * Usage:
 *   npm run enrich-json -- --json ./output/elizaos/json/2026-01-06.json --config elizaos.json
 *   npm run enrich-json -- --dir ./output/elizaos/json --date 2026-01-06 --config elizaos.json
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ContentItem, EnricherPlugin } from "./types";
import {
  loadDirectoryModules,
  loadItems,
  loadProviders,
} from "./helpers/configHelper";
import { logger } from "./helpers/cliHelper";

dotenv.config();

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

/**
 * Map category topics to source types for enricher compatibility.
 */
function topicToSourceType(topic: string): string {
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

/**
 * Enrich a single JSON file with memes and posters.
 */
async function enrichJsonFile(
  jsonPath: string,
  enrichers: EnricherPlugin[]
): Promise<{ enriched: number; file: string }> {
  if (!fs.existsSync(jsonPath)) {
    logger.warning(`File not found: ${jsonPath}`);
    return { enriched: 0, file: jsonPath };
  }

  logger.info(`Processing: ${jsonPath}`);

  const jsonContent = fs.readFileSync(jsonPath, "utf-8");
  const summary: SummaryJson = JSON.parse(jsonContent);
  const dateStr = path.basename(jsonPath, ".json");

  if (!summary.categories || summary.categories.length === 0) {
    logger.warning(`No categories in ${jsonPath}`);
    return { enriched: 0, file: jsonPath };
  }

  let totalEnriched = 0;

  for (const category of summary.categories) {
    if (!category.content || category.content.length === 0) continue;

    const categoryTopic = category.topic || category.title || "unknown";
    logger.info(`  Category "${categoryTopic}": ${category.content.length} items`);

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
        type: topicToSourceType(categoryTopic),
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
      for (const enricher of enrichers) {
        enrichedItems = await enricher.enrich(enrichedItems);
      }

      const enriched = enrichedItems[0];

      // Extract generated media back to category content
      if (enriched.metadata?.memes?.length) {
        contentItem.memes = enriched.metadata.memes;
        totalEnriched++;
      }

      if (enriched.metadata?.images?.length) {
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
  logger.success(`Enriched ${totalEnriched} items in ${jsonPath}`);

  return { enriched: totalEnriched, file: jsonPath };
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let jsonFile: string | undefined;
  let jsonDir: string | undefined;
  let date: string | undefined;
  let configFile = "elizaos.json";

  for (const arg of args) {
    if (arg.startsWith("--json=")) jsonFile = arg.split("=")[1];
    else if (arg.startsWith("--dir=")) jsonDir = arg.split("=")[1];
    else if (arg.startsWith("--date=")) date = arg.split("=")[1];
    else if (arg.startsWith("--config=")) configFile = arg.split("=")[1];
    else if (arg === "--help" || arg === "-h") {
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
  --help, -h        Show this help

Examples:
  npm run enrich-json -- --json ./output/elizaos/json/2026-01-06.json
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

  // Process files
  let results: Array<{ enriched: number; file: string }> = [];

  if (jsonFile) {
    const result = await enrichJsonFile(jsonFile, enrichers);
    results.push(result);
  } else if (jsonDir) {
    if (date) {
      const filePath = path.join(jsonDir, `${date}.json`);
      const result = await enrichJsonFile(filePath, enrichers);
      results.push(result);
    } else {
      // Process all JSON files in directory
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith(".json"));
      for (const file of files) {
        const result = await enrichJsonFile(path.join(jsonDir, file), enrichers);
        results.push(result);
      }
    }
  }

  // Summary
  const totalEnriched = results.reduce((sum, r) => sum + r.enriched, 0);
  logger.success(`\nTotal: ${totalEnriched} items enriched across ${results.length} files`);

  process.exit(0);
}

main().catch((error) => {
  logger.error(`Error: ${error}`);
  process.exit(1);
});
