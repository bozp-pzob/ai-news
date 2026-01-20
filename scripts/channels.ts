/**
 * Discord Channel Management CLI
 *
 * Single source of truth for all channel operations:
 * - discover: Fetch ALL channels from Discord API → registry → CHANNELS.md
 * - sync: Parse CHANNELS.md → update registry → update configs
 * - list/show/stats: Query channel data from registry
 * - track/untrack/mute/unmute: Manage channel tracking state
 * - build-registry: Backfill from discordRawData
 *
 * Usage:
 *   npm run channels -- discover [--sample]
 *   npm run channels -- sync [--dry-run]
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
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { DiscordChannelRegistry, DiscordChannel } from "../src/plugins/storage/DiscordChannelRegistry";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = "./config";
const OUTPUT_FILE = "./scripts/CHANNELS.md";
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
  sample?: boolean;
  dryRun?: boolean;
  tracked?: boolean;
  active?: boolean;
  muted?: boolean;
  quiet?: boolean;
  testConfigs?: boolean;
  debug?: boolean;
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

interface LoadedConfig {
  path: string;
  config: any;
  discordSources: DiscordSourceConfig[];
}

interface GuildChannelData {
  guildName: string;
  checkedChannels: { channelId: string; channelName: string }[];
  uncheckedChannels: { channelId: string; channelName: string }[];
  mutedChannels: { channelId: string; channelName: string }[];
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

    if (arg === "--sample") args.sample = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--tracked") args.tracked = true;
    else if (arg === "--active") args.active = true;
    else if (arg === "--muted") args.muted = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--test-configs") args.testConfigs = true;
    else if (arg === "--debug") args.debug = true;
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

  const configs = loadConfigs();

  if (args.testConfigs) {
    console.log("Running in test mode (no Discord API calls)\n");
    validateConfigs(configs);
    return;
  }

  if (configs.size === 0) {
    console.error("No valid Discord configurations found");
    process.exit(1);
  }

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

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

  if (!botToken) {
    throw new Error("No valid Discord bot token found in environment variables");
  }

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

  // Sample activity if requested
  if (args.sample) {
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
  }

  // Generate CHANNELS.md from registry
  console.log("Generating CHANNELS.md from registry...");
  const markdown = await generateChecklist(registry, args.sample ? channelActivity : null);
  fs.writeFileSync(OUTPUT_FILE, markdown, "utf8");
  console.log(`Checklist saved to ${OUTPUT_FILE}`);

  await client.destroy();

  console.log("\n Channel discovery complete!");
  console.log("\nNext steps:");
  console.log(`1. Review the generated checklist: ${OUTPUT_FILE}`);
  console.log("2. Check Track column for channels to add");
  console.log("3. Check Mute column for channels to ignore");
  console.log("4. Run 'npm run channels -- sync' to apply changes");
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

async function generateChecklist(
  registry: DiscordChannelRegistry,
  channelActivity: Map<string, ChannelActivity> | null
): Promise<string> {
  const now = new Date();
  const timeStr = now.toISOString().replace("T", " ").substring(0, 19) + " UTC";
  const includeSampling = channelActivity !== null && channelActivity.size > 0;

  let markdown = `# Discord Channel Tracking Status\n`;
  markdown += `*Updated: ${timeStr}*\n\n`;

  // Get all channels from registry
  const allChannels = await registry.getAllChannels();

  // Collect stats
  let totalChannels = allChannels.length;
  let trackedCount = allChannels.filter(c => c.isTracked).length;
  let mutedCount = allChannels.filter(c => c.isMuted).length;
  let newCount = allChannels.filter(c => !c.isTracked && !c.isMuted).length;
  const recommendations: Array<{ channel: DiscordChannel; activity: ChannelActivity }> = [];

  // Collect recommendations
  if (includeSampling) {
    for (const channel of allChannels) {
      if (!channel.isTracked && !channel.isMuted) {
        const activity = channelActivity!.get(channel.id);
        if (activity && (activity.badge === "hot" || activity.badge === "active")) {
          recommendations.push({ channel, activity });
        }
      }
    }
    recommendations.sort((a, b) => (b.activity.velocity || 0) - (a.activity.velocity || 0));
  }

  // Summary stats
  markdown += `## Summary\n\n`;
  markdown += `| Metric | Count |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total Channels | ${totalChannels} |\n`;
  markdown += `| Currently Tracking | ${trackedCount} |\n`;
  markdown += `| Muted | ${mutedCount} |\n`;
  markdown += `| Available | ${newCount} |\n\n`;

  // Recommendations section
  if (recommendations.length > 0) {
    markdown += `## Recommendations\n\n`;
    markdown += `**${recommendations.length} active channels** not being tracked:\n\n`;
    markdown += `| Channel | ID | Activity | Track | Mute |\n`;
    markdown += `|---------|-----|----------|-------|------|\n`;

    for (const rec of recommendations.slice(0, 20)) {
      const badge = getActivityBadge(rec.activity.badge);
      markdown += `| #${rec.channel.name} | \`${rec.channel.id}\` | ${badge} ${rec.activity.description} | \u2B1C | \u2B1C |\n`;
    }
    if (recommendations.length > 20) {
      markdown += `| *...and ${recommendations.length - 20} more* | | | | |\n`;
    }
    markdown += `\n`;
  }

  // Instructions
  markdown += `## Instructions\n\n`;
  markdown += `1. **Track**: Change \u2B1C to \u2705 to add channel to config\n`;
  markdown += `2. **Mute**: Change \u2B1C to \u2705 to hide from recommendations (won't track)\n`;
  markdown += `3. Run \`npm run channels -- sync\` to apply changes\n`;
  if (!includeSampling) {
    markdown += `4. Run with \`--sample\` flag to get activity data\n`;
  }
  markdown += `\n`;

  // Activity legend
  if (includeSampling) {
    markdown += `## Activity Legend\n\n`;
    markdown += `| Badge | Meaning |\n`;
    markdown += `|-------|--------|\n`;
    markdown += `| \uD83D\uDD25 | Hot: >50 msgs/day |\n`;
    markdown += `| \uD83D\uDFE2 | Active: 7-50 msgs/day |\n`;
    markdown += `| \uD83D\uDD35 | Moderate: 1.5-7 msgs/day |\n`;
    markdown += `| \u26AB | Quiet: <1.5 msgs/day or inactive |\n`;
    markdown += `| \uD83D\uDD12 | No access (bot can't read) |\n`;
    markdown += `\n`;
  }

  // Group channels by guild
  const channelsByGuild = new Map<string, DiscordChannel[]>();
  for (const channel of allChannels) {
    const guildName = channel.guildName || "Unknown Guild";
    if (!channelsByGuild.has(guildName)) {
      channelsByGuild.set(guildName, []);
    }
    channelsByGuild.get(guildName)!.push(channel);
  }

  // Generate table for each guild
  for (const [guildName, guildChannels] of channelsByGuild) {
    const guildId = guildChannels[0]?.guildId || "unknown";

    markdown += `## ${guildName}\n\n`;
    markdown += `*Guild ID: \`${guildId}\`*\n\n`;

    // Group by category
    const channelsByCategory = new Map<string, DiscordChannel[]>();
    for (const channel of guildChannels) {
      const categoryName = channel.categoryName || "Uncategorized";
      if (!channelsByCategory.has(categoryName)) {
        channelsByCategory.set(categoryName, []);
      }
      channelsByCategory.get(categoryName)!.push(channel);
    }

    // Sort categories
    const sortedCategories = Array.from(channelsByCategory.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    for (const [categoryName, categoryChannels] of sortedCategories) {
      // Filter out locked channels when sampling
      let visibleChannels = categoryChannels;
      if (includeSampling) {
        visibleChannels = categoryChannels.filter(ch => {
          const activity = channelActivity!.get(ch.id);
          return !activity || activity.badge !== "locked";
        });
        if (visibleChannels.length === 0) continue;
      }

      markdown += `### ${categoryName}\n\n`;

      if (includeSampling) {
        markdown += `| Channel | ID | Activity | Track | Mute |\n`;
        markdown += `|---------|-----|----------|-------|------|\n`;
      } else {
        markdown += `| Channel | ID | Track | Mute |\n`;
        markdown += `|---------|-----|-------|------|\n`;
      }

      for (const channel of visibleChannels) {
        const trackBox = channel.isTracked ? "\u2705" : "\u2B1C";
        const muteBox = channel.isMuted ? "\u2705" : "\u2B1C";

        if (includeSampling) {
          const activity = channelActivity!.get(channel.id) || {
            badge: "unknown",
            description: "not sampled"
          };
          const badge = getActivityBadge(activity.badge);
          markdown += `| #${channel.name} | \`${channel.id}\` | ${badge} ${activity.description} | ${trackBox} | ${muteBox} |\n`;
        } else {
          markdown += `| #${channel.name} | \`${channel.id}\` | ${trackBox} | ${muteBox} |\n`;
        }
      }

      markdown += `\n`;
    }
  }

  return markdown;
}

function getActivityBadge(badge: string): string {
  switch (badge) {
    case "hot": return "\uD83D\uDD25";
    case "active": return "\uD83D\uDFE2";
    case "moderate": return "\uD83D\uDD35";
    case "quiet": return "\u26AB";
    case "dead": return "\u26AB";
    case "locked": return "\uD83D\uDD12";
    default: return "\u2753";
  }
}

// ============================================================================
// Command: sync
// ============================================================================

async function commandSync(db: Database, args: CliArgs): Promise<void> {
  console.log(`\n Discord Channel Sync ${args.dryRun ? "(DRY RUN)" : ""}\n`);

  // Parse checklist
  const guildChannels = parseChecklist();

  // Load configurations
  const configs = loadConfigs();
  if (configs.size === 0) {
    console.error("No Discord configurations found to update");
    process.exit(1);
  }

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

  // Update registry based on checklist
  console.log("Updating registry from checklist...\n");
  let registryUpdates = 0;

  for (const [guildId, guildData] of guildChannels) {
    // Update tracked channels
    for (const ch of guildData.checkedChannels) {
      const channel = await registry.getChannelById(ch.channelId);
      if (channel && !channel.isTracked) {
        if (!args.dryRun) {
          await registry.setTracked(ch.channelId, true);
        }
        registryUpdates++;
        console.log(`  Track: #${ch.channelName} (${ch.channelId})`);
      }
    }

    // Update untracked channels
    for (const ch of guildData.uncheckedChannels) {
      const channel = await registry.getChannelById(ch.channelId);
      if (channel && channel.isTracked) {
        if (!args.dryRun) {
          await registry.setTracked(ch.channelId, false);
        }
        registryUpdates++;
        console.log(`  Untrack: #${ch.channelName} (${ch.channelId})`);
      }
    }

    // Update muted channels
    for (const ch of guildData.mutedChannels) {
      const channel = await registry.getChannelById(ch.channelId);
      if (channel && !channel.isMuted) {
        if (!args.dryRun) {
          await registry.setMuted(ch.channelId, true);
        }
        registryUpdates++;
        console.log(`  Mute: #${ch.channelName} (${ch.channelId})`);
      }
    }
  }

  console.log(`\nRegistry: ${registryUpdates} updates\n`);

  // Update config files
  console.log("Updating configuration files...\n");

  const changes = new Map<string, {
    added: { channelId: string; channelName: string }[];
    removed: { channelId: string; channelName: string }[];
    sources: any[];
  }>();

  for (const [configFile, configData] of configs) {
    const { config, discordSources } = configData;
    let configUpdated = false;
    const configChanges = {
      added: [] as { channelId: string; channelName: string }[],
      removed: [] as { channelId: string; channelName: string }[],
      sources: [] as any[]
    };

    for (const source of discordSources) {
      const guildIdVar = source.params?.guildId?.replace("process.env.", "");
      const guildId = guildIdVar ? process.env[guildIdVar] : source.params?.guildId;

      if (!guildId) {
        console.log(`  Cannot determine guild ID for source ${source.name} in ${configFile}`);
        continue;
      }

      const guildData = guildChannels.get(guildId);
      if (!guildData) {
        console.log(`  No checklist data found for guild ${guildId} (${source.name})`);
        continue;
      }

      const currentChannels = new Set(source.params?.channelIds || []);
      const shouldTrack = new Set(guildData.checkedChannels.map(ch => ch.channelId));

      const toAdd = [...shouldTrack].filter(id => !currentChannels.has(id));
      const toRemove = [...currentChannels].filter(id => !shouldTrack.has(id));

      if (toAdd.length > 0 || toRemove.length > 0) {
        configUpdated = true;

        if (!source.params) source.params = {};
        source.params.channelIds = [...shouldTrack];

        const sourceChange = {
          sourceName: source.name,
          guildName: guildData.guildName,
          added: toAdd.map(id => {
            const ch = guildData.checkedChannels.find(c => c.channelId === id);
            return { channelId: id, channelName: ch?.channelName || "Unknown" };
          }),
          removed: toRemove.map(id => {
            const ch = guildData.uncheckedChannels.find(c => c.channelId === id);
            return { channelId: id, channelName: ch?.channelName || "Unknown" };
          }),
          totalChannels: shouldTrack.size
        };

        configChanges.sources.push(sourceChange);
        configChanges.added.push(...sourceChange.added);
        configChanges.removed.push(...sourceChange.removed);
      }
    }

    if (configUpdated) {
      changes.set(configFile, configChanges);

      console.log(`${configFile}:`);
      for (const sourceChange of configChanges.sources) {
        console.log(`  - ${sourceChange.sourceName} (${sourceChange.guildName}):`);
        console.log(`    Total channels: ${sourceChange.totalChannels}`);

        if (sourceChange.added.length > 0) {
          console.log(`    Added ${sourceChange.added.length} channels:`);
          for (const ch of sourceChange.added) {
            console.log(`      + #${ch.channelName} (${ch.channelId})`);
          }
        }

        if (sourceChange.removed.length > 0) {
          console.log(`    Removed ${sourceChange.removed.length} channels:`);
          for (const ch of sourceChange.removed) {
            console.log(`      - #${ch.channelName} (${ch.channelId})`);
          }
        }
      }
      console.log("");
    }
  }

  if (changes.size === 0) {
    console.log("No changes needed! All configurations are already in sync with the checklist.\n");
    return;
  }

  if (args.dryRun) {
    console.log("DRY RUN: No files were actually modified\n");
    generateSyncSummary(changes);
    console.log("\nRun without --dry-run to apply these changes");
    return;
  }

  // Create backups and save
  console.log("Creating configuration backups...");
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const [configFile] of changes) {
    const configData = configs.get(configFile)!;
    const backupFile = `${configFile}.${timestamp}.backup`;
    const backupPath = path.join(BACKUP_DIR, backupFile);
    fs.copyFileSync(configData.path, backupPath);
    console.log(`  Backed up ${configFile} to ${backupFile}`);
  }

  console.log("\nSaving updated configurations...");
  for (const [configFile] of changes) {
    const configData = configs.get(configFile)!;
    const updatedJson = JSON.stringify(configData.config, null, 2);
    fs.writeFileSync(configData.path, updatedJson, "utf8");
    console.log(`  Saved ${configFile}`);
  }

  console.log("");
  generateSyncSummary(changes);

  console.log("\n Channel sync complete!");
  console.log("\nNext steps:");
  console.log("1. Review the updated configuration files");
  console.log("2. Test your data collection with the new channel selections");
  console.log("3. Commit the changes to your repository");
}

function parseChecklist(): Map<string, GuildChannelData> {
  console.log("Parsing channel checklist...");

  if (!fs.existsSync(OUTPUT_FILE)) {
    throw new Error(`Checklist file not found: ${OUTPUT_FILE}`);
  }

  const content = fs.readFileSync(OUTPUT_FILE, "utf8");
  const lines = content.split("\n");

  const guildChannels = new Map<string, GuildChannelData>();
  const channelToGuild = new Map<string, string>();
  const pendingRecommendations: { channelId: string; channelName: string; isTrackChecked: boolean; isMuteChecked: boolean }[] = [];
  let currentGuild: string | null = null;
  let currentGuildId: string | null = null;
  let inRecommendations = false;

  for (const line of lines) {
    // Detect Recommendations section
    if (line.includes("## ") && line.includes("Recommendations")) {
      inRecommendations = true;
      continue;
    }

    // Match guild headers
    const guildMatch = line.match(/^##+ ([^*\n]+)$/);
    if (guildMatch && !line.includes("Summary") && !line.includes("Recommendations") &&
        !line.includes("Instructions") && !line.includes("Legend")) {
      currentGuild = guildMatch[1].trim();
      inRecommendations = false;
      continue;
    }

    // Match guild ID
    const guildIdMatch = line.match(/\*Guild ID: `([^`]+)`\*/);
    if (guildIdMatch && currentGuild) {
      currentGuildId = guildIdMatch[1];
      guildChannels.set(currentGuildId, {
        guildName: currentGuild,
        checkedChannels: [],
        uncheckedChannels: [],
        mutedChannels: []
      });
      continue;
    }

    // Match table rows with activity
    const tableMatchWithActivity = line.match(/^\|\s*#([^|]+)\|\s*`(\d+)`\s*\|[^|]*\|\s*(\u2705|\u2B1C|\[[x ]\])\s*\|\s*(\u2705|\u2B1C|\[[x ]\])\s*\|/);
    // Match table rows without activity
    const tableMatchNoActivity = line.match(/^\|\s*#([^|]+)\|\s*`(\d+)`\s*\|\s*(\u2705|\u2B1C|\[[x ]\])\s*\|\s*(\u2705|\u2B1C|\[[x ]\])\s*\|/);

    const tableMatch = tableMatchWithActivity || tableMatchNoActivity;
    if (tableMatch) {
      const [, channelName, channelId, trackChecked, muteChecked] = tableMatch;
      const isTrackChecked = trackChecked === "\u2705" || trackChecked === "[x]";
      const isMuteChecked = muteChecked === "\u2705" || muteChecked === "[x]";

      if (inRecommendations) {
        pendingRecommendations.push({ channelId, channelName: channelName.trim(), isTrackChecked, isMuteChecked });
      } else if (currentGuildId) {
        const guildData = guildChannels.get(currentGuildId)!;
        channelToGuild.set(channelId, currentGuildId);

        if (isMuteChecked) {
          guildData.mutedChannels.push({ channelId, channelName: channelName.trim() });
        } else if (isTrackChecked) {
          guildData.checkedChannels.push({ channelId, channelName: channelName.trim() });
        } else {
          guildData.uncheckedChannels.push({ channelId, channelName: channelName.trim() });
        }
      }
      continue;
    }
  }

  // Process pending recommendations
  let recommendationsApplied = 0;
  for (const rec of pendingRecommendations) {
    const guildId = channelToGuild.get(rec.channelId);
    if (guildId) {
      const guildData = guildChannels.get(guildId)!;

      if (rec.isMuteChecked) {
        guildData.checkedChannels = guildData.checkedChannels.filter(c => c.channelId !== rec.channelId);
        guildData.uncheckedChannels = guildData.uncheckedChannels.filter(c => c.channelId !== rec.channelId);
        if (!guildData.mutedChannels.find(c => c.channelId === rec.channelId)) {
          guildData.mutedChannels.push({ channelId: rec.channelId, channelName: rec.channelName });
        }
        recommendationsApplied++;
      } else if (rec.isTrackChecked) {
        guildData.mutedChannels = guildData.mutedChannels.filter(c => c.channelId !== rec.channelId);
        guildData.uncheckedChannels = guildData.uncheckedChannels.filter(c => c.channelId !== rec.channelId);
        if (!guildData.checkedChannels.find(c => c.channelId === rec.channelId)) {
          guildData.checkedChannels.push({ channelId: rec.channelId, channelName: rec.channelName });
        }
        recommendationsApplied++;
      }
    }
  }

  // Log summary
  let totalMuted = 0;
  for (const [, guildData] of guildChannels) {
    totalMuted += guildData.mutedChannels?.length || 0;
  }
  console.log(`  Parsed ${guildChannels.size} guilds from checklist`);
  if (recommendationsApplied > 0) {
    console.log(`  Applied ${recommendationsApplied} changes from Recommendations section`);
  }
  if (totalMuted > 0) {
    console.log(`  Found ${totalMuted} muted channels (will be ignored)\n`);
  } else {
    console.log("");
  }

  return guildChannels;
}

function generateSyncSummary(changes: Map<string, any>): void {
  console.log("Configuration Update Summary\n");

  let totalAdded = 0;
  let totalRemoved = 0;
  let totalSources = 0;

  for (const [configFile, configChanges] of changes) {
    console.log(`${configFile}:`);
    console.log(`   Sources updated: ${configChanges.sources.length}`);
    console.log(`   Channels added: ${configChanges.added.length}`);
    console.log(`   Channels removed: ${configChanges.removed.length}`);

    totalAdded += configChanges.added.length;
    totalRemoved += configChanges.removed.length;
    totalSources += configChanges.sources.length;
    console.log("");
  }

  console.log(`Overall Changes:`);
  console.log(`   Configuration files updated: ${changes.size}`);
  console.log(`   Discord sources updated: ${totalSources}`);
  console.log(`   Total channels added: ${totalAdded}`);
  console.log(`   Total channels removed: ${totalRemoved}`);
  console.log(`   Net channel change: ${totalAdded - totalRemoved > 0 ? "+" : ""}${totalAdded - totalRemoved}`);
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

  if (channel.aiSummary || channel.aiMannerisms) {
    console.log(`\nAI Insights:`);
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
// Command: build-registry
// ============================================================================

async function commandBuildRegistry(db: Database, args: CliArgs): Promise<void> {
  console.log("\n Building Discord Channel Registry\n");

  if (args.dryRun) {
    console.log("(DRY RUN - no changes will be made)\n");
  }

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();
  console.log("Initialized discord_channels table\n");

  // Get all discordRawData entries ordered by date
  console.log("Fetching discordRawData entries...");
  const rawDataRows = await db.all<Array<{ cid: string; text: string; metadata: string }>>(
    "SELECT cid, text, metadata FROM items WHERE type = 'discordRawData' ORDER BY date ASC"
  );
  console.log(`   Found ${rawDataRows.length} entries\n`);

  if (rawDataRows.length === 0) {
    console.log("No discordRawData found. Nothing to process.");
    return;
  }

  // Track progress
  let processed = 0;
  const channelsSeen = new Set<string>();
  const channelMessageCounts = new Map<string, Map<string, number>>();

  console.log("Processing entries...\n");

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

      if (!args.dryRun) {
        try {
          await registry.upsertChannel(channelData);
        } catch (e: any) {
          // Validation errors are expected for some edge cases
          if (args.debug) {
            console.error(`  Failed to upsert channel ${channelId}: ${e.message}`);
          }
        }
      }

      processed++;

      if (processed % 200 === 0) {
        console.log(`   Progress: ${processed}/${rawDataRows.length} (${Math.round(processed / rawDataRows.length * 100)}%)`);
      }

    } catch (error) {
      console.error(`  Failed to process ${row.cid}:`, error);
    }
  }

  console.log(`\nRecording activity history...\n`);

  // Record activity for each channel by date
  let activityRecorded = 0;
  for (const [channelId, dateMap] of channelMessageCounts) {
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const date of sortedDates) {
      const messageCount = dateMap.get(date)!;
      if (!args.dryRun) {
        try {
          await registry.recordActivity(channelId, date, messageCount);
          activityRecorded++;
        } catch (error) {
          // Channel might not exist
        }
      } else {
        activityRecorded++;
      }
    }
  }

  console.log(`Processing complete!`);
  console.log(`   Entries processed: ${processed}`);
  console.log(`   Unique channels: ${channelsSeen.size}`);
  console.log(`   Activity records: ${activityRecorded}`);

  if (args.dryRun) {
    console.log("\nDRY RUN complete - no changes were made");
    return;
  }

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

Discovery & Sync:
  discover [--sample] [--test-configs]    Fetch ALL channels from Discord API -> registry -> CHANNELS.md
  sync [--dry-run]                        Parse CHANNELS.md -> update registry -> update configs

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
  npm run channels -- discover --sample     # Discover all channels with activity sampling
  npm run channels -- sync --dry-run        # Preview sync changes
  npm run channels -- list --tracked        # List tracked channels
  npm run channels -- show 1253563209462448241
  npm run channels -- track 1253563209462448241
  npm run channels -- mute 1253563209462448241
  npm run channels -- build-registry

Workflow:
  1. npm run channels -- discover --sample   # Fetch all channels from Discord
  2. Edit scripts/CHANNELS.md                # Check/uncheck channels to track/mute
  3. npm run channels -- sync                # Apply changes to registry and configs
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
      case "sync":
        await commandSync(db, args);
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
