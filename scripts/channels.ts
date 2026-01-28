/**
 * Discord Channel Management CLI
 *
 * Single source of truth for all channel operations:
 * - discover: Fetch channels from Discord API (or raw data if no token)
 * - analyze: Run LLM analysis on channels to generate recommendations
 * - propose: Generate config diff and PR body for tracking changes
 * - list/show/stats: Query channel data from registry
 * - track/untrack/mute/unmute: Manage channel tracking state
 * - build-registry: Backfill from discordRawData
 *
 * Usage:
 *   npm run channels -- discover
 *   npm run channels -- analyze [--all] [--channel=ID]
 *   npm run channels -- propose [--dry-run]
 *   npm run channels -- list [--tracked|--active|--muted|--quiet]
 *   npm run channels -- show <channelId>
 *   npm run channels -- stats
 *   npm run channels -- track <channelId>
 *   npm run channels -- untrack <channelId>
 *   npm run channels -- mute <channelId>
 *   npm run channels -- unmute <channelId>
 *   npm run channels -- build-registry [--dry-run]
 */

import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { Client, GatewayIntentBits, ChannelType, TextChannel } from "discord.js";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  DiscordChannelRegistry,
  DiscordChannel,
  AIAnalysisResult,
  AIRecommendation,
  RecommendedChange
} from "../src/plugins/storage/DiscordChannelRegistry";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = "./config";
const BACKUP_DIR = "./config/backup";
const DEFAULT_CONFIGS = ["elizaos.json", "hyperfy-discord.json"];

// Activity thresholds (messages per day)
const ACTIVITY_THRESHOLDS = {
  HOT: 50,      // >50 msgs/day
  ACTIVE: 7,    // 7-50 msgs/day
  MODERATE: 1.5 // 1.5-7 msgs/day
  // Below 1.5 = Quiet/Dead
};

// Rate limiting for activity sampling
const SAMPLE_DELAY_MS = 500;

// ============================================================================
// Types
// ============================================================================

interface CliArgs {
  command: string;
  channelId?: string;
  guildId?: string;
  dryRun?: boolean;
  tracked?: boolean;
  active?: boolean;
  muted?: boolean;
  quiet?: boolean;
  testConfigs?: boolean;
  debug?: boolean;
  // Analyze options
  all?: boolean;
}

interface DiscordRawData {
  channel: { id: string; name: string; topic?: string; category?: string; guildId?: string; guildName?: string };
  date: string;
  users: Record<string, any>;
  messages: Array<{ id: string; uid: string; content: string }>;
}

interface DiscordSourceConfig {
  type: string;
  name: string;
  params: {
    botToken?: string;
    guildId?: string;
    channelIds?: string[];
  };
}

interface DiscordRawData {
  channel: {
    id: string;
    name: string;
    topic?: string;
    category?: string;
    guildId?: string;
    guildName?: string;
  };
  date: string;
  users: Record<string, { username?: string; displayName?: string; nickname?: string }>;
  messages: Array<{
    id: string;
    uid: string;
    content: string;
    timestamp?: string;
  }>;
}

interface LoadedConfig {
  path: string;
  config: any;
  discordSources: DiscordSourceConfig[];
}

interface ChannelActivity {
  velocity: number;
  lastMessage: number | null;
  daysSinceLastMsg?: number;
  badge: string;
  description: string;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): CliArgs {
  const command = process.argv[2] || "help";
  const args: CliArgs = { command };

  // Check for channel ID as positional argument
  let argStartIndex = 3;
  if (command !== "help" && process.argv[3] && !process.argv[3].startsWith("--")) {
    args.channelId = process.argv[3];
    argStartIndex = 4;
  }

  for (let i = argStartIndex; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--tracked") args.tracked = true;
    else if (arg === "--active") args.active = true;
    else if (arg === "--muted") args.muted = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--test-configs") args.testConfigs = true;
    else if (arg === "--debug") args.debug = true;
    else if (arg === "--all") args.all = true;
    else if (arg.startsWith("--guild=")) args.guildId = arg.split("=")[1];
    else if (arg.startsWith("--channel=")) args.channelId = arg.split("=")[1];
  }

  return args;
}

// ============================================================================
// Config Loading
// ============================================================================

function loadConfigs(): Map<string, LoadedConfig> {
  console.log("Loading configuration files...");

  const configs = new Map<string, LoadedConfig>();

  if (!fs.existsSync(CONFIG_DIR)) {
    console.error(`Config directory not found: ${CONFIG_DIR}`);
    return configs;
  }

  const configFiles = fs.readdirSync(CONFIG_DIR)
    .filter(file => file.endsWith(".json"))
    .filter(file => DEFAULT_CONFIGS.length === 0 || DEFAULT_CONFIGS.includes(file));

  for (const configFile of configFiles) {
    try {
      const configPath = path.join(CONFIG_DIR, configFile);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

      // Find Discord sources
      const discordSources = config.sources?.filter(
        (source: any) => source.type === "DiscordRawDataSource"
      ) || [];

      if (discordSources.length > 0) {
        configs.set(configFile, {
          path: configPath,
          config,
          discordSources
        });
        console.log(`  Loaded ${configFile}: ${discordSources.length} Discord source(s)`);
      }
    } catch (error: any) {
      console.error(`  Failed to load ${configFile}: ${error.message}`);
    }
  }

  console.log(`Loaded ${configs.size} configurations with Discord sources\n`);
  return configs;
}

function getTrackedChannelIds(configs: Map<string, LoadedConfig>): Map<string, Set<string>> {
  const trackedChannels = new Map<string, Set<string>>(); // guildId -> Set of channel IDs

  for (const [, configData] of configs) {
    for (const source of configData.discordSources) {
      let guildId = source.params?.guildId || "unknown";
      if (guildId.startsWith("process.env.")) {
        const envVar = guildId.replace("process.env.", "");
        guildId = process.env[envVar] || envVar;
      }
      const channelIds = source.params?.channelIds || [];

      if (!trackedChannels.has(guildId)) {
        trackedChannels.set(guildId, new Set());
      }

      for (const channelId of channelIds) {
        trackedChannels.get(guildId)!.add(channelId);
      }
    }
  }

  return trackedChannels;
}

function getGuildIds(configs: Map<string, LoadedConfig>): Set<string> {
  const guildIds = new Set<string>();

  for (const [, configData] of configs) {
    for (const source of configData.discordSources) {
      const guildIdVar = source.params?.guildId?.replace("process.env.", "");
      const guildId = guildIdVar ? process.env[guildIdVar] : source.params?.guildId;
      if (guildId) {
        guildIds.add(guildId);
      }
    }
  }

  return guildIds;
}

// ============================================================================
// Command: discover
// ============================================================================

async function commandDiscover(db: Database, args: CliArgs): Promise<void> {
  console.log("\n Discord Channel Discovery\n");

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

  const configs = loadConfigs();

  if (args.testConfigs) {
    console.log("Running in test mode (no Discord API calls)\n");
    validateConfigs(configs);
    return;
  }

  // Find a valid Discord token
  let botToken: string | null = null;
  for (const [configName, configData] of configs) {
    for (const source of configData.discordSources) {
      const tokenVar = source.params?.botToken?.replace("process.env.", "");
      if (tokenVar && process.env[tokenVar]) {
        botToken = process.env[tokenVar]!;
        console.log(`Using token from ${configName} (${tokenVar})`);
        break;
      }
    }
    if (botToken) break;
  }

  // Fallback to building from raw data if no Discord token
  if (!botToken) {
    console.log("No Discord token available. Building registry from raw data...\n");
    await buildRegistryFromRawData(db, registry, true);

    const stats = await registry.getStats();
    console.log("\nRegistry now contains " + stats.totalChannels + " channels");
    console.log("  Tracked: " + stats.trackedChannels);
    console.log("\nNext steps:");
    console.log("1. Run 'npm run channels -- analyze --stale' to analyze channels with LLM");
    console.log("2. Run 'npm run channels -- propose' to generate config changes");
    return;
  }

  if (configs.size === 0) {
    console.error("No valid Discord configurations found");
    process.exit(1);
  }

  // Load muted channels from existing registry
  const existingChannels = await registry.getAllChannels();
  const mutedChannels = new Set<string>(
    existingChannels.filter(c => c.isMuted).map(c => c.id)
  );
  if (mutedChannels.size > 0) {
    console.log(`Loaded ${mutedChannels.size} muted channels from registry\n`);
  }

  // Get tracked channels from config
  const trackedChannels = getTrackedChannelIds(configs);

  // Connect to Discord
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  console.log("Connecting to Discord...");
  await client.login(botToken);
  console.log(`Connected to Discord as ${client.user?.tag}\n`);

  // Discover channels from each guild
  const guildIds = getGuildIds(configs);
  const allChannels = new Map<string, { guild: any; channels: Map<string, TextChannel> }>();
  const channelActivity = new Map<string, ChannelActivity>();

  console.log("Discovering channels...");
  for (const guildId of guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const textChannels = new Map<string, TextChannel>();
      channels
        .filter(channel => channel?.type === ChannelType.GuildText)
        .sort((a, b) => {
          const categoryA = a!.parent?.name || "zzz_Uncategorized";
          const categoryB = b!.parent?.name || "zzz_Uncategorized";
          if (categoryA !== categoryB) {
            return categoryA.localeCompare(categoryB);
          }
          return (a!.position || 0) - (b!.position || 0);
        })
        .forEach(channel => {
          textChannels.set(channel!.id, channel as TextChannel);
        });

      allChannels.set(guildId, { guild, channels: textChannels });
      console.log(`  ${guild.name}: Found ${textChannels.size} text channels`);

      // Upsert all channels to registry
      const observedAt = new Date().toISOString().split("T")[0];
      const tracked = trackedChannels.get(guildId) || new Set<string>();

      for (const [channelId, channel] of textChannels) {
        try {
          await registry.upsertChannel({
            id: channelId,
            guildId: guildId,
            guildName: guild.name,
            name: channel.name,
            topic: channel.topic || null,
            categoryId: channel.parentId || null,
            categoryName: channel.parent?.name || null,
            type: channel.type,
            position: channel.position,
            nsfw: channel.nsfw,
            rateLimitPerUser: channel.rateLimitPerUser || 0,
            createdAt: Math.floor(channel.createdTimestamp! / 1000),
            observedAt,
            isTracked: tracked.has(channelId),
            isMuted: mutedChannels.has(channelId)
          });
        } catch (error: any) {
          if (args.debug) {
            console.error(`    Failed to upsert channel ${channelId}: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`  Failed to fetch guild ${guildId}: ${error.message}`);
    }
  }

  console.log("");

  // Sample activity from each channel
  console.log("Sampling channel activity...\n");

    let sampled = 0;
    let errors = 0;
    const totalChannels = Array.from(allChannels.values())
      .reduce((sum, g) => sum + g.channels.size, 0);

    for (const [guildId, guildData] of allChannels) {
      console.log(`  ${guildData.guild.name}:`);

      for (const [channelId, channel] of guildData.channels) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });

          if (messages.size === 0) {
            channelActivity.set(channelId, {
              velocity: 0,
              lastMessage: null,
              badge: "dead",
              description: "empty"
            });
          } else {
            const oldest = messages.last()!;
            const newest = messages.first()!;
            const oldestTime = oldest.createdTimestamp;
            const newestTime = newest.createdTimestamp;
            const now = Date.now();

            const daySpan = Math.max((newestTime - oldestTime) / (1000 * 60 * 60 * 24), 0.1);
            const velocity = messages.size / daySpan;
            const daysSinceLastMsg = (now - newestTime) / (1000 * 60 * 60 * 24);

            let badge: string, description: string;
            if (daysSinceLastMsg > 90) {
              badge = "dead";
              description = `${Math.floor(daysSinceLastMsg)}d ago`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.HOT) {
              badge = "hot";
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.ACTIVE) {
              badge = "active";
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.MODERATE) {
              badge = "moderate";
              description = `${velocity.toFixed(1)}/day`;
            } else {
              badge = "quiet";
              description = velocity > 0.1 ? `${velocity.toFixed(1)}/day` : `${Math.floor(daysSinceLastMsg)}d ago`;
            }

            channelActivity.set(channelId, {
              velocity,
              lastMessage: newestTime,
              daysSinceLastMsg,
              badge,
              description
            });

            // Record activity in registry
            const observedAt = new Date().toISOString().split("T")[0];
            try {
              await registry.recordActivity(channelId, observedAt, messages.size);
            } catch (e) {
              // Channel might not exist in registry
            }
          }

          sampled++;
          process.stdout.write(`\r    Sampled ${sampled}/${totalChannels} channels...`);
          await sleep(SAMPLE_DELAY_MS);

        } catch (error: any) {
          channelActivity.set(channelId, {
            velocity: 0,
            lastMessage: null,
            badge: "locked",
            description: "no access"
          });
          errors++;

          // Auto-mute inaccessible channels (but not tracked ones)
          const tracked = trackedChannels.get(guildId)?.has(channelId);
          if (!mutedChannels.has(channelId) && !tracked) {
            mutedChannels.add(channelId);
            await registry.setMuted(channelId, true);
          }
        }
      }
    }

    console.log(`\n\n  Sampled ${sampled} channels (${errors} inaccessible)\n`);

  await client.destroy();

  // Print summary stats
  const stats = await registry.getStats();
  console.log("\n Channel discovery complete!");
  console.log(`\nRegistry now contains ${stats.totalChannels} channels`);
  console.log(`  Tracked: ${stats.trackedChannels}`);
  console.log(`  Muted: ${stats.mutedChannels}`);
  console.log("\nNext steps:");
  console.log("1. Run 'npm run channels -- analyze --stale' to analyze channels with LLM");
  console.log("2. Run 'npm run channels -- propose' to generate config changes");
}

function validateConfigs(configs: Map<string, LoadedConfig>): void {
  console.log("Validating configurations...\n");

  let totalSources = 0;
  let totalChannels = 0;

  for (const [configName, configData] of configs) {
    console.log(`${configName}:`);

    for (const source of configData.discordSources) {
      totalSources++;
      const channelCount = source.params?.channelIds?.length || 0;
      totalChannels += channelCount;

      console.log(`  - ${source.name}: ${channelCount} channels configured`);

      const requiredVars: string[] = [];
      if (source.params?.botToken?.includes("process.env.")) {
        requiredVars.push(source.params.botToken.replace("process.env.", ""));
      }
      if (source.params?.guildId?.includes("process.env.")) {
        requiredVars.push(source.params.guildId.replace("process.env.", ""));
      }

      if (requiredVars.length > 0) {
        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
          console.log(`    Missing environment variables: ${missingVars.join(", ")}`);
        } else {
          console.log(`    Environment variables configured`);
        }
      }
    }
    console.log("");
  }

  console.log(`Summary: ${totalSources} Discord sources, ${totalChannels} channels total\n`);
}

function getActivityBadge(velocity: number, daysSinceActivity?: number): string {
  if (daysSinceActivity && daysSinceActivity > 90) return "⚫";
  if (velocity >= ACTIVITY_THRESHOLDS.HOT) return "🔥";
  if (velocity >= ACTIVITY_THRESHOLDS.ACTIVE) return "🟢";
  if (velocity >= ACTIVITY_THRESHOLDS.MODERATE) return "🔵";
  return "⚫";
}

// ============================================================================
// Command: analyze
// ============================================================================

async function loadChannelMessages(db: Database, channelId: string, limit: number = 100): Promise<string[]> {
  const rows = await db.all<Array<{ text: string }>>(
    `SELECT text FROM items
     WHERE type = 'discordRawData'
       AND json_extract(text, '$.channel.id') = ?
     ORDER BY date DESC
     LIMIT 10`,
    channelId
  );

  const messages: string[] = [];
  for (const row of rows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      for (const msg of data.messages) {
        if (!msg.content.trim()) continue;
        const user = data.users[msg.uid];
        const username = user?.displayName || user?.nickname || user?.username || "Unknown";
        messages.push(`[${username}]: ${msg.content.slice(0, 500)}`);
        if (messages.length >= limit) break;
      }
    } catch (e) {
      // Skip malformed entries
    }
    if (messages.length >= limit) break;
  }

  return messages;
}

async function analyzeChannelWithLLM(
  openai: OpenAI,
  model: string,
  channel: DiscordChannel,
  messagesText: string
): Promise<AIAnalysisResult | null> {
  const prompt = `Analyze these Discord messages from #${channel.name}.

Messages:
${messagesText}

Respond ONLY with valid JSON:
{
  "recommendation": "TRACK|MAYBE|SKIP",
  "reason": "brief explanation (15 words max)"
}

Guidelines:
- TRACK: Technical content, development discussion, code sharing, valuable for documentation
- MAYBE: Mixed content, occasional useful info, could be filtered
- SKIP: Bot spam, price talk, low signal, no documentation value`;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 150
    });

    const content = completion.choices[0]?.message?.content || "";

    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        recommendation: parsed.recommendation as AIRecommendation,
        reason: parsed.reason || ""
      };
    }

    throw new Error("No JSON found in response");
  } catch (error: any) {
    console.error(`    LLM error for #${channel.name}: ${error.message}`);
    return null;
  }
}

async function commandAnalyze(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  console.log("\n Channel Analysis\n");

  // Auto-populate registry if empty but raw data exists
  const stats = await registry.getStats();
  if (stats.totalChannels === 0) {
    const rawCount = await db.get<{ count: number }>(
      "SELECT COUNT(DISTINCT json_extract(text, '$.channel.id')) as count FROM items WHERE type = 'discordRawData'"
    );
    if (rawCount && rawCount.count > 0) {
      console.log(`Registry empty but found ${rawCount.count} channels in raw data.`);
      console.log("Auto-populating registry...\n");
      await buildRegistryFromRawData(db, registry);
      console.log("");
    }
  }

  // Initialize OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set in environment");
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: process.env.USE_OPENROUTER === "true" ? "https://openrouter.ai/api/v1" : undefined,
    defaultHeaders: process.env.USE_OPENROUTER === "true" ? {
      "HTTP-Referer": process.env.SITE_URL || "",
      "X-Title": process.env.SITE_NAME || ""
    } : undefined
  });

  const model = process.env.USE_OPENROUTER === "true" ? "openai/gpt-4o-mini" : "gpt-4o-mini";

  // Determine which channels to analyze
  let channelsToAnalyze: DiscordChannel[];

  if (args.channelId) {
    // Single channel mode
    const channel = await registry.getChannelById(args.channelId);
    if (!channel) {
      console.error(`Channel ${args.channelId} not found in registry`);
      process.exit(1);
    }
    channelsToAnalyze = [channel];
    console.log(`Analyzing single channel: #${channel.name}`);
  } else if (args.all) {
    // All non-muted channels with activity
    channelsToAnalyze = (await registry.getAllChannels()).filter(c => !c.isMuted && c.currentVelocity > 0);
    console.log(`Analyzing all ${channelsToAnalyze.length} active channels`);
  } else {
    // Default: channels needing analysis (never analyzed or >30 days old)
    channelsToAnalyze = await registry.getChannelsNeedingAnalysis(30);
    console.log(`Analyzing ${channelsToAnalyze.length} channels needing analysis`);
  }

  if (channelsToAnalyze.length === 0) {
    console.log("\nNo channels to analyze.\n");
    return;
  }

  console.log("");

  // Analyze each channel
  let analyzed = 0;
  let tracked = 0;
  let maybe = 0;
  let skip = 0;
  let errors = 0;

  for (const channel of channelsToAnalyze) {
    process.stdout.write(`  Analyzing #${channel.name.padEnd(25)}...`);

    // Load messages for this channel
    const messages = await loadChannelMessages(db, channel.id, 50);

    if (messages.length === 0) {
      console.log(" no messages");
      continue;
    }

    const messagesText = messages.join("\n");
    const analysis = await analyzeChannelWithLLM(openai, model, channel, messagesText);

    if (analysis) {
      await registry.updateAIAnalysis(channel.id, analysis);
      console.log(` ${analysis.recommendation}`);

      if (analysis.recommendation === "TRACK") tracked++;
      else if (analysis.recommendation === "MAYBE") maybe++;
      else skip++;

      analyzed++;
    } else {
      console.log(" ERROR");
      errors++;
    }

    // Rate limiting
    await sleep(200);
  }

  console.log(`\nAnalysis complete!`);
  console.log(`  Analyzed: ${analyzed}`);
  console.log(`  TRACK: ${tracked}`);
  console.log(`  MAYBE: ${maybe}`);
  console.log(`  SKIP: ${skip}`);
  console.log(`  Errors: ${errors}`);
  console.log("\nNext steps:");
  console.log("1. Run 'npm run channels -- propose' to generate config changes");
}

// ============================================================================
// Command: propose
// ============================================================================

async function commandProposeUpdate(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  // Get recommended changes from registry
  const changes = await registry.getRecommendedChanges();

  if (changes.length === 0) {
    // No output for piping - the workflow checks for empty output
    if (!args.dryRun) {
      console.error("No recommended changes.");
    }
    return;
  }

  const toAdd = changes.filter(c => c.action === "add");
  const toRemove = changes.filter(c => c.action === "remove");

  // Get stats
  const stats = await registry.getStats();
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Generate markdown PR body
  let md = `## Channel Tracking Update - ${monthYear}\n\n`;

  md += `### Summary\n`;
  md += `- **Channels analyzed**: ${stats.totalChannels}\n`;
  md += `- **Recommended to add**: ${toAdd.length}\n`;
  md += `- **Recommended to remove**: ${toRemove.length}\n\n`;

  // Recommended Additions
  if (toAdd.length > 0) {
    md += `### Recommended Additions\n\n`;
    md += `| Channel | Activity | AI Recommendation | Reason |\n`;
    md += `|---------|----------|-------------------|--------|\n`;

    for (const ch of toAdd) {
      const activityBadge = getActivityBadge(ch.currentVelocity);
      const activityDesc = ch.currentVelocity >= 1 ? `${Math.round(ch.currentVelocity)}/day` : `${ch.currentVelocity.toFixed(1)}/day`;
      md += `| #${ch.channelName} | ${activityBadge} ${activityDesc} | ${ch.recommendation} | ${ch.reason} |\n`;
    }
    md += `\n`;
  }

  // Recommended Removals
  if (toRemove.length > 0) {
    md += `### Recommended Removals\n\n`;
    md += `| Channel | Activity | Reason |\n`;
    md += `|---------|----------|--------|\n`;

    for (const ch of toRemove) {
      const activityBadge = getActivityBadge(ch.currentVelocity);
      const activityDesc = ch.currentVelocity >= 1 ? `${Math.round(ch.currentVelocity)}/day` : `${ch.currentVelocity.toFixed(1)}/day`;
      md += `| #${ch.channelName} | ${activityBadge} ${activityDesc} | ${ch.reason} |\n`;
    }
    md += `\n`;
  }

  // Config changes diff
  md += `### Config Changes\n\n`;
  md += "```diff\n";
  md += `// config/elizaos.json\n`;
  md += `  "channelIds": [\n`;

  for (const ch of toAdd) {
    md += `+   "${ch.channelId}",  // #${ch.channelName}\n`;
  }
  for (const ch of toRemove) {
    md += `-   "${ch.channelId}",  // #${ch.channelName} (${ch.reason})\n`;
  }

  md += `  ]\n`;
  md += "```\n\n";

  md += `---\n`;
  md += `*Generated by channel-update workflow*\n`;

  // Output the markdown
  console.log(md);

  // In dry-run mode, also log to stderr
  if (args.dryRun) {
    console.error(`\n[DRY RUN] Would create PR with ${toAdd.length} additions and ${toRemove.length} removals`);
  }
}

// ============================================================================
// Command: list
// ============================================================================

async function commandList(registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  let channels: DiscordChannel[];

  if (args.tracked) {
    console.log("\n Tracked Channels\n");
    channels = await registry.getTrackedChannels();
  } else if (args.active) {
    console.log("\n Active Channels (velocity >= 1.5)\n");
    channels = await registry.getActiveChannels(1.5);
  } else if (args.muted) {
    console.log("\n Muted Channels\n");
    channels = (await registry.getAllChannels()).filter(c => c.isMuted);
  } else if (args.quiet) {
    console.log("\n Quiet Channels (no activity in 90 days)\n");
    channels = await registry.getInactiveChannels(90);
  } else {
    console.log("\n All Channels\n");
    channels = await registry.getAllChannels();
  }

  if (channels.length === 0) {
    console.log("   No channels found.\n");
    return;
  }

  // Group by guild
  const byGuild = new Map<string, DiscordChannel[]>();
  for (const channel of channels) {
    const guildName = channel.guildName || "Unknown Guild";
    if (!byGuild.has(guildName)) {
      byGuild.set(guildName, []);
    }
    byGuild.get(guildName)!.push(channel);
  }

  for (const [guildName, guildChannels] of byGuild) {
    console.log(`\n${guildName}:`);
    for (const ch of guildChannels) {
      const velocity = ch.currentVelocity.toFixed(1);
      const tracked = ch.isTracked ? "T" : " ";
      const muted = ch.isMuted ? "M" : " ";
      const category = ch.categoryName ? `[${ch.categoryName}]` : "";
      console.log(`  ${tracked} ${muted} #${ch.name.padEnd(25)} ${velocity.padStart(6)} msgs/day  ${category}`);
    }
  }

  console.log(`\nTotal: ${channels.length} channels\n`);
}

// ============================================================================
// Command: show
// ============================================================================

async function commandShow(registry: DiscordChannelRegistry, channelId: string): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  console.log(`\n Channel: #${channel.name}\n`);
  console.log(`ID: ${channel.id}`);
  console.log(`Guild: ${channel.guildName} (${channel.guildId})`);
  console.log(`Category: ${channel.categoryName || "(none)"}`);
  console.log(`Topic: ${channel.topic || "(none)"}`);
  console.log(`Type: ${channel.type} | Position: ${channel.position ?? "n/a"}`);
  console.log(`NSFW: ${channel.nsfw} | Rate Limit: ${channel.rateLimitPerUser}s`);

  console.log(`\nActivity:`);
  console.log(`   Current velocity: ${channel.currentVelocity.toFixed(1)} msgs/day`);
  console.log(`   Total messages: ${channel.totalMessages}`);
  console.log(`   Last activity: ${channel.lastActivityAt ? new Date(channel.lastActivityAt * 1000).toISOString().split("T")[0] : "never"}`);

  console.log(`\nTracking:`);
  console.log(`   Is tracked: ${channel.isTracked}`);
  console.log(`   Is muted: ${channel.isMuted}`);
  console.log(`   First seen: ${new Date(channel.firstSeen * 1000).toISOString().split("T")[0]}`);
  console.log(`   Last seen: ${new Date(channel.lastSeen * 1000).toISOString().split("T")[0]}`);

  if (channel.nameChanges.length > 1) {
    console.log(`\nName History (${channel.nameChanges.length} changes):`);
    for (const change of channel.nameChanges.slice(0, 5)) {
      console.log(`   ${change.observedAt}: "${change.name}"`);
    }
    if (channel.nameChanges.length > 5) {
      console.log(`   ... and ${channel.nameChanges.length - 5} more`);
    }
  }

  if (channel.topicChanges.length > 1) {
    console.log(`\nTopic History (${channel.topicChanges.length} changes):`);
    for (const change of channel.topicChanges.slice(0, 3)) {
      const topicPreview = change.topic ? change.topic.slice(0, 60) + (change.topic.length > 60 ? "..." : "") : "(empty)";
      console.log(`   ${change.observedAt}: "${topicPreview}"`);
    }
    if (channel.topicChanges.length > 3) {
      console.log(`   ... and ${channel.topicChanges.length - 3} more`);
    }
  }

  if (channel.activityHistory.length > 0) {
    console.log(`\nRecent Activity (last 7 days):`);
    for (const snapshot of channel.activityHistory.slice(0, 7)) {
      const bar = "\u2588".repeat(Math.min(30, Math.ceil(snapshot.messageCount / 5)));
      console.log(`   ${snapshot.date}: ${snapshot.messageCount.toString().padStart(4)} msgs ${bar}`);
    }
  }

  if (channel.aiRecommendation || channel.aiSummary || channel.aiMannerisms) {
    console.log(`\nAI Analysis:`);
    if (channel.aiRecommendation) {
      console.log(`   Recommendation: ${channel.aiRecommendation}`);
      if (channel.aiReason) console.log(`   Reason: ${channel.aiReason}`);
    }
    // Legacy fields
    if (channel.aiSummary) console.log(`   Summary: ${channel.aiSummary}`);
    if (channel.aiMannerisms) console.log(`   Mannerisms: ${channel.aiMannerisms}`);
    if (channel.aiLastAnalyzed) {
      console.log(`   Last analyzed: ${new Date(channel.aiLastAnalyzed * 1000).toISOString().split("T")[0]}`);
    }
  }

  if (channel.notes) {
    console.log(`\nNotes: ${channel.notes}`);
  }

  console.log("");
}

// ============================================================================
// Command: stats
// ============================================================================

async function commandStats(registry: DiscordChannelRegistry): Promise<void> {
  console.log("\n Channel Registry Statistics\n");

  const stats = await registry.getStats();

  console.log(`Channels: ${stats.totalChannels} total, ${stats.trackedChannels} tracked, ${stats.mutedChannels} muted`);
  console.log(`Guilds: ${stats.totalGuilds}`);
  console.log(`Total messages: ${stats.totalMessages.toLocaleString()}`);

  console.log(`\nActivity Distribution:`);
  console.log(`   Hot (>50 msgs/day): ${stats.hotChannels}`);
  console.log(`   Active (7-50): ${stats.activeChannels}`);
  console.log(`   Moderate (1.5-7): ${stats.moderateChannels}`);
  console.log(`   Quiet (<1.5): ${stats.quietChannels}`);

  console.log(`\nChanges Tracked:`);
  console.log(`   Name changes: ${stats.channelsWithNameChanges} channels`);
  console.log(`   Topic changes: ${stats.channelsWithTopicChanges} channels`);
  console.log(`   Category changes: ${stats.channelsWithCategoryChanges} channels`);

  if (stats.mostActiveChannel) {
    console.log(`\nMost Active: #${stats.mostActiveChannel.name} (${stats.mostActiveChannel.velocity.toFixed(1)} msgs/day)`);
  }

  console.log("");
}

// ============================================================================
// Command: track/untrack
// ============================================================================

async function commandTrack(registry: DiscordChannelRegistry, channelId: string, tracked: boolean): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  await registry.setTracked(channelId, tracked);
  console.log(`\nChannel #${channel.name} is now ${tracked ? "tracked" : "untracked"}\n`);
}

// ============================================================================
// Command: mute/unmute
// ============================================================================

async function commandMute(registry: DiscordChannelRegistry, channelId: string, muted: boolean): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  await registry.setMuted(channelId, muted);
  console.log(`\nChannel #${channel.name} is now ${muted ? "muted" : "unmuted"}\n`);
}

// ============================================================================
// Helper: build registry from raw data
// ============================================================================

async function buildRegistryFromRawData(db: Database, registry: DiscordChannelRegistry, verbose: boolean = true): Promise<void> {
  // Get all discordRawData entries ordered by date
  if (verbose) console.log("Fetching discordRawData entries...");
  const rawDataRows = await db.all<Array<{ cid: string; text: string; metadata: string }>>(
    "SELECT cid, text, metadata FROM items WHERE type = 'discordRawData' ORDER BY date ASC"
  );
  if (verbose) console.log(`   Found ${rawDataRows.length} entries\n`);

  if (rawDataRows.length === 0) {
    if (verbose) console.log("No discordRawData found. Nothing to process.");
    return;
  }

  // Track progress
  let processed = 0;
  const channelsSeen = new Set<string>();
  const channelMessageCounts = new Map<string, Map<string, number>>();

  if (verbose) console.log("Processing entries...\n");

  for (const row of rawDataRows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      const observedAt = data.date.split("T")[0];

      const channelId = data.channel?.id || metadata.channelId;
      if (!channelId) continue;

      channelsSeen.add(channelId);

      // Count messages
      if (!channelMessageCounts.has(channelId)) {
        channelMessageCounts.set(channelId, new Map());
      }
      const dateMap = channelMessageCounts.get(channelId)!;
      const currentCount = dateMap.get(observedAt) || 0;
      dateMap.set(observedAt, currentCount + (data.messages?.length || 0));

      // Prepare channel data
      const channelData = {
        id: channelId,
        guildId: metadata.guildId || data.channel?.guildId || "unknown",
        guildName: metadata.guildName || data.channel?.guildName || "unknown",
        name: data.channel?.name || metadata.channelName || "unknown",
        topic: data.channel?.topic || null,
        categoryId: null,
        categoryName: data.channel?.category || null,
        type: 0,
        position: null,
        nsfw: false,
        rateLimitPerUser: 0,
        createdAt: Math.floor(new Date(observedAt).getTime() / 1000),
        observedAt,
        isTracked: true
      };

      try {
        await registry.upsertChannel(channelData);
      } catch (e: any) {
        // Validation errors are expected for some edge cases
      }

      processed++;

      if (verbose && processed % 200 === 0) {
        console.log(`   Progress: ${processed}/${rawDataRows.length} (${Math.round(processed / rawDataRows.length * 100)}%)`);
      }

    } catch (error) {
      // Skip malformed entries
    }
  }

  if (verbose) console.log(`\nRecording activity history...\n`);

  // Record activity for each channel by date
  let activityRecorded = 0;
  for (const [channelId, dateMap] of channelMessageCounts) {
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const date of sortedDates) {
      const messageCount = dateMap.get(date)!;
      try {
        await registry.recordActivity(channelId, date, messageCount);
        activityRecorded++;
      } catch (error) {
        // Channel might not exist
      }
    }
  }

  if (verbose) {
    console.log(`Processing complete!`);
    console.log(`   Entries processed: ${processed}`);
    console.log(`   Unique channels: ${channelsSeen.size}`);
    console.log(`   Activity records: ${activityRecorded}`);
  }
}

// ============================================================================
// Command: build-registry
// ============================================================================

async function commandBuildRegistry(db: Database, args: CliArgs): Promise<void> {
  console.log("\n Building Discord Channel Registry\n");

  if (args.dryRun) {
    console.log("(DRY RUN - no changes will be made)\n");
    return;
  }

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();
  console.log("Initialized discord_channels table\n");

  await buildRegistryFromRawData(db, registry, true);

  // Get final stats
  console.log("\nRegistry Statistics:");
  const stats = await registry.getStats();
  console.log(`   Total channels: ${stats.totalChannels}`);
  console.log(`   Total guilds: ${stats.totalGuilds}`);
  console.log(`   Tracked channels: ${stats.trackedChannels}`);
  console.log(`   Total messages: ${stats.totalMessages}`);

  console.log(`\n Done!\n`);
}

// ============================================================================
// Command: help
// ============================================================================

function commandHelp(): void {
  console.log(`
Discord Channel Management CLI

Discovery & Analysis:
  discover                                Fetch channels from Discord (or raw data if no token)
  analyze [--all] [--channel=ID]          Run LLM analysis on channels
  propose [--dry-run]                     Generate config diff and PR markdown

Query Commands:
  list [--tracked|--active|--muted|--quiet]   List channels with optional filters
  show <channelId>                            Show detailed channel info
  stats                                       Show channel registry statistics

Management Commands:
  track <channelId>                       Mark channel as tracked
  untrack <channelId>                     Mark channel as not tracked
  mute <channelId>                        Mute channel (hide from recommendations)
  unmute <channelId>                      Unmute channel

Registry Commands:
  build-registry [--dry-run]              Backfill discord_channels from discordRawData

Examples:
  npm run channels -- discover              # Discover channels (Discord API or raw data)
  npm run channels -- analyze               # Analyze channels needing analysis
  npm run channels -- analyze --all         # Re-analyze all channels
  npm run channels -- analyze --channel=123 # Analyze a single channel
  npm run channels -- propose               # Generate PR body with config changes
  npm run channels -- list --tracked        # List tracked channels

Workflow (automated via GitHub Action):
  1. npm run channels -- discover            # Fetch channels
  2. npm run channels -- analyze             # Run LLM analysis
  3. npm run channels -- propose             # Generate PR body
  `);
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();
  const dbPath = path.join(process.cwd(), "data", "elizaos.sqlite");
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

  try {
    switch (args.command) {
      case "discover":
        await commandDiscover(db, args);
        break;
      case "analyze":
        await commandAnalyze(db, registry, args);
        break;
      case "propose":
        await commandProposeUpdate(db, registry, args);
        break;
      case "list":
        await commandList(registry, args);
        break;
      case "show":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- show <channelId>\n");
        } else {
          await commandShow(registry, args.channelId);
        }
        break;
      case "stats":
        await commandStats(registry);
        break;
      case "track":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- track <channelId>\n");
        } else {
          await commandTrack(registry, args.channelId, true);
        }
        break;
      case "untrack":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- untrack <channelId>\n");
        } else {
          await commandTrack(registry, args.channelId, false);
        }
        break;
      case "mute":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- mute <channelId>\n");
        } else {
          await commandMute(registry, args.channelId, true);
        }
        break;
      case "unmute":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- unmute <channelId>\n");
        } else {
          await commandMute(registry, args.channelId, false);
        }
        break;
      case "build-registry":
        await commandBuildRegistry(db, args);
        break;
      case "help":
      default:
        commandHelp();
        break;
    }
  } finally {
    await db.close();
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
