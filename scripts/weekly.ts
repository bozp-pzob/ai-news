/**
 * Weekly Summary Generator CLI
 *
 * Generates weekly.json by combining the last 7 days of daily outputs.
 * Maintains the same structure as daily.json for consistency.
 *
 * Usage:
 *   npm run weekly -- generate                           # Last 7 days from yesterday
 *   npm run weekly -- generate --week-of=2026-01-15     # Calendar week containing date
 *   npm run weekly -- generate --from=2026-01-01 --to=2026-01-07  # Custom range
 *   npm run weekly -- generate --dry-run                # Preview without writing
 *   npm run weekly -- generate --format=discord         # Discord only
 *   npm run weekly -- generate --format=elizaos         # ElizaOS only
 *   npm run weekly -- generate -o weekly2.json          # Custom output filename
 *   npm run weekly -- generate --ai                     # AI-curated version (newsroom style)
 *   npm run weekly -- generate --ai -o weekly-curated.json  # AI version with custom name
 *   npm run weekly -- list                              # List available daily files
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import { parseDate, formatDate, addOneDay } from "../src/helpers/dateHelper";
import { logger } from "../src/helpers/cliHelper";
import { writeJsonFile } from "../src/helpers/fileHelper";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const DISCORD_JSON_DIR = "./output/discord/summaries/json";
const ELIZAOS_JSON_DIR = "./output/elizaos/json";
const DEFAULT_CONFIG = "./config/elizaos.json";

/**
 * Load AI provider config from elizaos.json
 */
function loadAIConfig(): { model: string; useOpenRouter: boolean } {
  try {
    const configPath = path.resolve(DEFAULT_CONFIG);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // Find the summary provider (first AI provider with "summary" in name, or first one)
    const aiProviders = config.ai || [];
    const summaryProvider = aiProviders.find((p: any) => p.name?.includes("summary")) || aiProviders[0];

    if (summaryProvider?.params) {
      return {
        model: summaryProvider.params.model || "gpt-4o-mini",
        useOpenRouter: summaryProvider.params.useOpenRouter || false,
      };
    }
  } catch (error) {
    logger.warning(`Could not load AI config from ${DEFAULT_CONFIG}, using defaults`);
  }

  return { model: "gpt-4o-mini", useOpenRouter: false };
}

// ============================================================================
// Types
// ============================================================================

interface CliArgs {
  command: string;
  weekOf?: string;
  from?: string;
  to?: string;
  dryRun?: boolean;
  format?: "discord" | "elizaos" | "both";
  output?: string;
  ai?: boolean;
}

interface DailyDiscordSummary {
  server: string;
  title: string;
  date: number;
  stats: {
    totalMessages: number;
    totalUsers: number;
  };
  categories: Array<{
    channelId: string;
    channelName: string;
    summary: string;
    messageCount: number;
    userCount: number;
  }>;
}

interface DailyElizaosSummary {
  type: string;
  title: string;
  categories: Array<{
    title: string;
    content: Array<{
      text: string;
      sources: string | string[];
      images: string | string[];
      videos: string | string[];
      memes?: { url: string; summary: string };
      posters?: string;
    }>;
    topic?: string;
  }>;
  date: number;
}

interface WeeklyDiscordSummary {
  type: "discordWeeklySummary";
  server: string;
  title: string;
  weekOf: string;
  dateRange: {
    start: string;
    end: string;
  };
  generatedAt: number;
  stats: {
    totalMessages: number;
    totalUsers: number;
    averageMessagesPerDay: number;
    activeDays: number;
    peakDay: {
      date: string;
      messages: number;
    };
  };
  channelSummary: Record<
    string,
    {
      name: string;
      totalMessages: number;
      daysActive: number;
    }
  >;
  days: DailyDiscordSummary[];
}

interface WeeklyElizaosSummary {
  type: "elizaosWeeklySummary";
  title: string;
  categories: Array<{
    title: string;
    content: Array<{
      text: string;
      sources: string | string[];
      images: string | string[];
      videos: string | string[];
      memes?: { url: string; summary: string };
      posters?: string;
    }>;
    topic?: string;
  }>;
  date: number;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): CliArgs {
  const command = process.argv[2] || "help";
  const args: CliArgs = { command, format: "both" };

  for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--ai") args.ai = true;
    else if (arg.startsWith("--week-of=")) args.weekOf = arg.split("=")[1];
    else if (arg.startsWith("--from=")) args.from = arg.split("=")[1];
    else if (arg.startsWith("--to=")) args.to = arg.split("=")[1];
    else if (arg === "-o" || arg === "--output") {
      args.output = process.argv[++i];
    } else if (arg.startsWith("--output=")) {
      args.output = arg.split("=")[1];
    } else if (arg.startsWith("-o=")) {
      args.output = arg.split("=")[1];
    } else if (arg.startsWith("--format=")) {
      const format = arg.split("=")[1];
      if (format === "discord" || format === "elizaos" || format === "both") {
        args.format = format;
      }
    }
  }

  return args;
}

// ============================================================================
// Date Utilities
// ============================================================================

function getYesterday(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function determineDateRange(args: CliArgs): { startDate: string; endDate: string } {
  if (args.from && args.to) {
    return { startDate: args.from, endDate: args.to };
  }

  if (args.weekOf) {
    const monday = getMondayOfWeek(parseDate(args.weekOf));
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { startDate: formatDate(monday), endDate: formatDate(sunday) };
  }

  const yesterday = getYesterday();
  const weekAgo = subtractDays(yesterday, 6);
  return { startDate: formatDate(weekAgo), endDate: formatDate(yesterday) };
}

// ============================================================================
// File Operations
// ============================================================================

function collectDailyFiles<T>(dir: string, startDate: string, endDate: string): T[] {
  const files: T[] = [];
  let current = parseDate(startDate);
  const end = parseDate(endDate);

  logger.info(`Scanning ${dir} for ${startDate} to ${endDate}...`);

  while (current <= end) {
    const dateStr = formatDate(current);
    const filePath = path.join(dir, `${dateStr}.json`);

    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        files.push(content);
        logger.success(`  Found: ${dateStr}.json`);
      } catch (error: any) {
        logger.warning(`  Error reading ${dateStr}.json: ${error.message}`);
      }
    } else {
      logger.warning(`  Missing: ${dateStr}.json`);
    }

    current = addOneDay(current);
  }

  return files;
}

function writeWeeklyFile(dir: string, filename: string, content: any, dryRun: boolean): void {
  const filePath = path.join(dir, filename);

  if (dryRun) {
    logger.info(`[DRY RUN] Would write to: ${filePath}`);
    logger.info(`  Content preview (${JSON.stringify(content).length} bytes)`);
    logger.info(`  - type: ${content.type}`);
    logger.info(`  - title: ${content.title}`);
    logger.info(`  - categories: ${content.categories?.length || 0}`);
    return;
  }

  writeJsonFile(filePath, content);
  logger.success(`Written: ${filePath}`);
}

// ============================================================================
// AI Curation - Newsroom Style Editing
// ============================================================================

const WEEKLY_CURATION_PROMPT = `You are combining 7 daily JSON summaries into 1 weekly summary.
This is a merge + dedupe + rank problem. Do NOT re-summarize every day — dedupe into story-groups.

## Weekly Selection Logic

### Step 1: Normalize
Treat each daily content item as a candidate with: text, sources, media, topic, day.

### Step 2: Group by Topic Slug
Group all items by their "topic" field. Valid topic slugs are:
- discordrawdata (Discord discussions)
- pull_request (GitHub PRs)
- issue (GitHub issues)
- github_summary (GitHub activity)
- contributors (contributor highlights)
- completed_items (completed work)
- miscellaneous (other content)

### Step 3: Merge Within Each Topic
Within each topic group, merge similar stories:
- same event discussed multiple days → 1 entry
- overlapping entities/keywords → combine
For each merged group: 1 representative text, merged sources (unique URLs), best 2-3 media links.

### Step 4: Rank by Importance
Prefer: high impact, actionable, time-sensitive, widely discussed.
Deprioritize: duplicates, low-signal chatter, speculation.

### Step 5: Compose Output
One category per topic slug that has content.
Each category: 3-8 content items max.
Total: 12-16 items max across all categories.

## Output Schema
{
  "categories": [
    {
      "title": "Weekly Discord Discussions",
      "content": [
        {"text": "summary", "sources": ["url1"], "images": ["img"], "videos": ["vid"], "memes": {"url": "x", "summary": "y"}, "posters": "url"}
      ],
      "topic": "discordrawdata"
    }
  ]
}

CRITICAL: "topic" MUST be one of the valid slugs listed above - do not invent new ones.
CRITICAL: categories[] and content[] MUST be arrays.
CRITICAL: Plain text only (no markdown, no emojis).
CRITICAL: Do not invent facts or add outside information.`;

async function curateWithAI(
  days: DailyElizaosSummary[],
  startDate: string,
  endDate: string
): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  const aiConfig = loadAIConfig();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for --ai mode");
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: aiConfig.useOpenRouter ? "https://openrouter.ai/api/v1" : undefined,
  });

  // Prepare the content for AI processing
  const allContent: any[] = [];
  for (const day of days) {
    const dayDate = day.title?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "unknown";
    const categories = Array.isArray(day.categories) ? day.categories : day.categories ? [day.categories] : [];
    for (const category of categories) {
      const contentItems = Array.isArray(category.content) ? category.content : category.content ? [category.content] : [];
      for (const item of contentItems) {
        allContent.push({
          date: dayDate,
          category: category.title,
          topic: category.topic,
          text: item.text,
          sources: item.sources,
          images: item.images,
          videos: item.videos,
          memes: item.memes,
          posters: item.posters,
        });
      }
    }
  }

  const userPrompt = `Here are ${days.length} days of daily reports from ${startDate} to ${endDate}. Curate them into a weekly digest following the editorial guidelines.

## Raw Daily Content (${allContent.length} items):

${JSON.stringify(allContent, null, 2)}

Remember: Return ONLY the JSON object with "categories" array. No markdown, no explanation.`;

  logger.info(`Sending ${allContent.length} content items to AI for curation...`);
  logger.info(`Using model: ${aiConfig.model}`);

  const response = await openai.chat.completions.create({
    model: aiConfig.model,
    messages: [
      { role: "system", content: WEEKLY_CURATION_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 16000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from AI");
  }

  // Parse the JSON response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not extract JSON from AI response");
  }

  return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// Weekly Summary Builders
// ============================================================================

function buildDiscordWeekly(
  days: DailyDiscordSummary[],
  startDate: string,
  endDate: string
): WeeklyDiscordSummary {
  let totalMessages = 0;
  let peakDay = { date: "", messages: 0 };
  const channelStats = new Map<string, { name: string; totalMessages: number; daysActive: number }>();

  for (const day of days) {
    const dayMessages = day.stats?.totalMessages || 0;
    totalMessages += dayMessages;

    const dayDate = day.title?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || formatDate(new Date(day.date * 1000));

    if (dayMessages > peakDay.messages) {
      peakDay = { date: dayDate, messages: dayMessages };
    }

    for (const category of day.categories || []) {
      const existing = channelStats.get(category.channelId) || {
        name: category.channelName,
        totalMessages: 0,
        daysActive: 0,
      };
      existing.totalMessages += category.messageCount || 0;
      existing.daysActive += 1;
      channelStats.set(category.channelId, existing);
    }
  }

  const totalUsers = days.reduce((sum, day) => sum + (day.stats?.totalUsers || 0), 0);

  return {
    type: "discordWeeklySummary",
    server: days[0]?.server || "unknown",
    title: `${days[0]?.server || "Discord"} Weekly Summary - ${startDate} to ${endDate}`,
    weekOf: startDate,
    dateRange: { start: startDate, end: endDate },
    generatedAt: Math.floor(Date.now() / 1000),
    stats: {
      totalMessages,
      totalUsers,
      averageMessagesPerDay: days.length > 0 ? Math.round(totalMessages / days.length) : 0,
      activeDays: days.length,
      peakDay,
    },
    channelSummary: Object.fromEntries(channelStats),
    days,
  };
}

function buildElizaosWeekly(
  days: DailyElizaosSummary[],
  startDate: string,
  endDate: string
): WeeklyElizaosSummary {
  // Combine all categories from all days
  const allCategories: WeeklyElizaosSummary["categories"] = [];

  for (const day of days) {
    const categories = Array.isArray(day.categories) ? day.categories : day.categories ? [day.categories] : [];
    for (const category of categories) {
      allCategories.push(category);
    }
  }

  return {
    type: "elizaosWeeklySummary",
    title: `Weekly Report - ${startDate} to ${endDate}`,
    categories: allCategories,
    date: Math.floor(Date.now() / 1000),
  };
}

async function buildElizaosWeeklyWithAI(
  days: DailyElizaosSummary[],
  startDate: string,
  endDate: string
): Promise<WeeklyElizaosSummary> {
  // Get AI-curated categories
  const aiResult = await curateWithAI(days, startDate, endDate);

  return {
    type: "elizaosWeeklySummary",
    title: `Weekly Report - ${startDate} to ${endDate}`,
    categories: aiResult.categories || [],
    date: Math.floor(Date.now() / 1000),
  };
}

// ============================================================================
// Commands
// ============================================================================

async function commandGenerate(args: CliArgs): Promise<void> {
  logger.info("=== Weekly Summary Generator ===");

  const { startDate, endDate } = determineDateRange(args);
  logger.info(`Date range: ${startDate} to ${endDate}`);
  logger.info(`Format: ${args.format}`);
  logger.info(`AI curation: ${args.ai ? "ENABLED" : "disabled"}`);
  if (args.output) logger.info(`Output filename: ${args.output}`);
  if (args.dryRun) logger.info("Mode: DRY RUN");

  const outputFilename = args.output || "weekly.json";

  // Generate Discord weekly
  if (args.format !== "elizaos") {
    logger.info("--- Discord Summary ---");
    const discordDays = collectDailyFiles<DailyDiscordSummary>(DISCORD_JSON_DIR, startDate, endDate);

    if (discordDays.length > 0) {
      const weekly = buildDiscordWeekly(discordDays, startDate, endDate);
      writeWeeklyFile(DISCORD_JSON_DIR, outputFilename, weekly, args.dryRun || false);
      logger.info(`Stats: ${weekly.stats.totalMessages} messages, ${weekly.stats.activeDays} days`);
    } else {
      logger.warning("No Discord daily files found in range");
    }
  }

  // Generate ElizaOS weekly
  if (args.format !== "discord") {
    logger.info("--- ElizaOS Summary ---");
    const elizaosDays = collectDailyFiles<DailyElizaosSummary>(ELIZAOS_JSON_DIR, startDate, endDate);

    if (elizaosDays.length > 0) {
      let weekly: WeeklyElizaosSummary;

      if (args.ai) {
        logger.info("Running AI curation (newsroom mode)...");
        weekly = await buildElizaosWeeklyWithAI(elizaosDays, startDate, endDate);
        logger.success(`AI generated ${weekly.categories.length} curated categories`);
      } else {
        weekly = buildElizaosWeekly(elizaosDays, startDate, endDate);
        logger.info(`Combined ${weekly.categories.length} categories from ${elizaosDays.length} days`);
      }

      writeWeeklyFile(ELIZAOS_JSON_DIR, outputFilename, weekly, args.dryRun || false);
    } else {
      logger.warning("No ElizaOS daily files found in range");
    }
  }

  logger.success("=== Done ===");
}

async function commandList(): Promise<void> {
  logger.info("=== Available Daily Files ===");

  const listDir = (dir: string, label: string) => {
    logger.info(`${label}:`);
    if (!fs.existsSync(dir)) {
      logger.warning("  Directory not found");
      return;
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.json$/))
      .sort();

    if (files.length === 0) {
      logger.warning("  No daily files found");
      return;
    }

    logger.info(`  Found ${files.length} files`);
    const first = files[0].replace(".json", "");
    const last = files[files.length - 1].replace(".json", "");
    logger.info(`  Range: ${first} to ${last}`);
  };

  listDir(DISCORD_JSON_DIR, "Discord summaries");
  listDir(ELIZAOS_JSON_DIR, "ElizaOS summaries");
}

function printHelp(): void {
  console.log(`
Weekly Summary Generator CLI

Usage:
  npm run weekly -- <command> [options]

Commands:
  generate    Generate weekly.json from daily files
  list        List available daily files
  help        Show this help message

Options for 'generate':
  --from=YYYY-MM-DD     Start date for custom range
  --to=YYYY-MM-DD       End date for custom range
  --week-of=YYYY-MM-DD  Generate for calendar week containing this date
  --format=<type>       Output format: discord, elizaos, or both (default: both)
  -o, --output=<file>   Output filename (default: weekly.json)
  --ai                  Enable AI curation (newsroom-style editing)
  --dry-run             Preview without writing files

Examples:
  npm run weekly -- generate                              # Last 7 days from yesterday
  npm run weekly -- generate --week-of=2026-01-15        # Calendar week containing date
  npm run weekly -- generate --from=2026-01-01 --to=2026-01-07  # Custom range
  npm run weekly -- generate --dry-run                   # Preview without writing
  npm run weekly -- generate --format=discord            # Discord only
  npm run weekly -- generate -o weekly2.json             # Custom output filename
  npm run weekly -- generate --ai                        # AI-curated version
  npm run weekly -- generate --ai -o weekly-curated.json # AI version with custom name
  npm run weekly -- list                                 # Show available files

AI Curation Mode (--ai):
  Uses an LLM to curate the weekly content like a newsroom editor:
  - Deduplicates stories that span multiple days
  - Prioritizes high-impact developments
  - Consolidates related updates into cohesive narratives
  - Removes noise while preserving all media/source URLs

  Requires OPENAI_API_KEY environment variable.
  Set USE_OPENROUTER=true to use OpenRouter instead.
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  switch (args.command) {
    case "generate":
      await commandGenerate(args);
      break;
    case "list":
      await commandList();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
