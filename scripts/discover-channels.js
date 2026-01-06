#!/usr/bin/env node

/**
 * Discord Channel Discovery Script
 * Discovers all channels in configured Discord servers and outputs a checklist
 * for easy tracking and configuration management.
 *
 * Usage:
 * - npm run discover-channels                    # Basic discovery (no activity sampling)
 * - npm run discover-channels -- --sample        # Include activity sampling (1 API call per channel)
 * - node scripts/discover-channels.js --test-configs  # Validate configs without Discord API
 */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const CONFIG_DIR = './config';
const OUTPUT_FILE = './scripts/CHANNELS.md';
const DEFAULT_CONFIGS = ['elizaos.json', 'hyperfy-discord.json'];

// Activity thresholds (messages per day)
const ACTIVITY_THRESHOLDS = {
  HOT: 50,      // 🔥 >50 msgs/day
  ACTIVE: 7,    // 🟢 7-50 msgs/day
  MODERATE: 1.5 // 🔵 1.5-7 msgs/day
  // Below 1.5 = ⚫ Quiet/Dead
};

// Rate limiting for activity sampling
const SAMPLE_DELAY_MS = 500; // Delay between channel samples

class ChannelDiscovery {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });
    this.allChannels = new Map(); // guildId -> channels
    this.trackedChannels = new Map(); // guildId -> Set of tracked channel IDs
    this.mutedChannels = new Set(); // Set of muted channel IDs
    this.channelActivity = new Map(); // channelId -> { velocity, lastMessage, badge }
    this.configs = new Map(); // configName -> config
  }

  /**
   * Load configuration files and extract Discord sources
   */
  loadConfigs() {
    console.log('📂 Loading configuration files...');

    const configFiles = fs.readdirSync(CONFIG_DIR)
      .filter(file => file.endsWith('.json'))
      .filter(file => DEFAULT_CONFIGS.length === 0 || DEFAULT_CONFIGS.includes(file));

    for (const configFile of configFiles) {
      try {
        const configPath = path.join(CONFIG_DIR, configFile);
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        // Find Discord sources
        const discordSources = config.sources?.filter(source =>
          source.type === 'DiscordRawDataSource'
        ) || [];

        if (discordSources.length > 0) {
          this.configs.set(configFile, {
            ...config,
            discordSources
          });

          console.log(`✓ Loaded ${configFile}: ${discordSources.length} Discord source(s)`);

          // Track which channels are already configured
          for (const source of discordSources) {
            // Resolve guildId from environment variable if needed
            let guildId = source.params?.guildId || 'unknown';
            if (guildId.startsWith('process.env.')) {
              const envVar = guildId.replace('process.env.', '');
              guildId = process.env[envVar] || envVar;
            }
            const channelIds = source.params?.channelIds || [];

            if (!this.trackedChannels.has(guildId)) {
              this.trackedChannels.set(guildId, new Set());
            }

            for (const channelId of channelIds) {
              this.trackedChannels.get(guildId).add(channelId);
            }
          }
        } else {
          console.log(`⚠️  Skipped ${configFile}: No Discord sources found`);
        }
      } catch (error) {
        console.error(`❌ Failed to load ${configFile}: ${error.message}`);
      }
    }

    console.log(`📋 Loaded ${this.configs.size} valid configurations\n`);
  }

  /**
   * Load existing muted channels from CHANNELS.md
   */
  loadMutedChannels() {
    if (!fs.existsSync(OUTPUT_FILE)) {
      return;
    }

    try {
      const content = fs.readFileSync(OUTPUT_FILE, 'utf8');
      // Parse table rows looking for muted channels (last column has ✅ or [x])
      // Handles both formats:
      // New format:       | #channel | `id` | activity | ✅ | ✅ |
      // Old format:       | #channel | `id` | activity | [x] | [x] |
      const lines = content.split('\n');
      for (const line of lines) {
        // Match any table row ending with | ✅ | or | [x] | (mute column)
        const match = line.match(/\|\s*#[^|]+\|\s*`(\d+)`.*\|\s*(?:✅|\[x\])\s*\|$/);
        if (match) {
          this.mutedChannels.add(match[1]);
        }
      }
      if (this.mutedChannels.size > 0) {
        console.log(`🔇 Loaded ${this.mutedChannels.size} muted channels from existing file`);
      }
    } catch (error) {
      console.log(`⚠️  Could not parse existing muted channels: ${error.message}`);
    }
  }

  /**
   * Validate configurations without making Discord API calls
   */
  validateConfigs() {
    console.log('🔍 Validating configurations...\n');

    let totalSources = 0;
    let totalChannels = 0;

    for (const [configName, config] of this.configs) {
      console.log(`📝 ${configName}:`);

      for (const source of config.discordSources) {
        totalSources++;
        const channelCount = source.params?.channelIds?.length || 0;
        totalChannels += channelCount;

        console.log(`  └─ ${source.name}: ${channelCount} channels configured`);

        // Check for required environment variables
        const requiredVars = [];
        if (source.params?.botToken?.includes('process.env.')) {
          requiredVars.push(source.params.botToken.replace('process.env.', ''));
        }
        if (source.params?.guildId?.includes('process.env.')) {
          requiredVars.push(source.params.guildId.replace('process.env.', ''));
        }

        if (requiredVars.length > 0) {
          const missingVars = requiredVars.filter(varName => !process.env[varName]);
          if (missingVars.length > 0) {
            console.log(`     ⚠️  Missing environment variables: ${missingVars.join(', ')}`);
          } else {
            console.log(`     ✅ Environment variables configured`);
          }
        }
      }
      console.log('');
    }

    console.log(`📊 Summary: ${totalSources} Discord sources, ${totalChannels} channels total\n`);
  }

  /**
   * Connect to Discord and discover channels
   */
  async discoverChannels() {
    console.log('🔗 Connecting to Discord...');

    // Try to find a valid Discord token from loaded configs
    let botToken = null;
    for (const [configName, config] of this.configs) {
      for (const source of config.discordSources) {
        const tokenVar = source.params?.botToken?.replace('process.env.', '');
        if (tokenVar && process.env[tokenVar]) {
          botToken = process.env[tokenVar];
          console.log(`🔑 Using token from ${configName} (${tokenVar})`);
          break;
        }
      }
      if (botToken) break;
    }

    if (!botToken) {
      throw new Error('No valid Discord bot token found in environment variables');
    }

    await this.client.login(botToken);
    console.log(`✅ Connected to Discord as ${this.client.user?.tag}\n`);

    console.log('🔍 Discovering channels...');

    // Collect unique guild IDs from all configs
    const guildIds = new Set();
    for (const [configName, config] of this.configs) {
      for (const source of config.discordSources) {
        const guildIdVar = source.params?.guildId?.replace('process.env.', '');
        const guildId = guildIdVar ? process.env[guildIdVar] : source.params?.guildId;
        if (guildId) {
          guildIds.add(guildId);
        }
      }
    }

    // Discover channels for each guild
    for (const guildId of guildIds) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();

        const textChannels = channels
          .filter(channel => channel?.type === ChannelType.GuildText)
          .sort((a, b) => {
            // Sort by category, then by position
            const categoryA = a.parent?.name || 'zzz_Uncategorized';
            const categoryB = b.parent?.name || 'zzz_Uncategorized';
            if (categoryA !== categoryB) {
              return categoryA.localeCompare(categoryB);
            }
            return (a.position || 0) - (b.position || 0);
          });

        this.allChannels.set(guildId, {
          guild,
          channels: textChannels
        });

        console.log(`📋 ${guild.name}: Found ${textChannels.size} text channels`);
      } catch (error) {
        console.error(`❌ Failed to fetch guild ${guildId}: ${error.message}`);
      }
    }

    console.log('');
  }

  /**
   * Sample channel activity by fetching recent messages
   * Calculates velocity (msgs/day) from timestamp spread of up to 100 messages
   */
  async sampleChannelActivity() {
    console.log('📊 Sampling channel activity...\n');

    let sampled = 0;
    let errors = 0;
    const totalChannels = Array.from(this.allChannels.values())
      .reduce((sum, g) => sum + g.channels.size, 0);

    for (const [guildId, guildData] of this.allChannels) {
      console.log(`  ${guildData.guild.name}:`);

      for (const [channelId, channel] of guildData.channels) {
        try {
          // Fetch up to 100 messages (Discord's max per call)
          const messages = await channel.messages.fetch({ limit: 100 });

          if (messages.size === 0) {
            // No messages at all
            this.channelActivity.set(channelId, {
              velocity: 0,
              lastMessage: null,
              badge: '⚫',
              description: 'empty'
            });
          } else {
            const oldest = messages.last();
            const newest = messages.first();
            const oldestTime = oldest.createdTimestamp;
            const newestTime = newest.createdTimestamp;
            const now = Date.now();

            // Calculate time span and velocity
            const daySpan = Math.max((newestTime - oldestTime) / (1000 * 60 * 60 * 24), 0.1);
            const velocity = messages.size / daySpan;

            // Calculate days since last message
            const daysSinceLastMsg = (now - newestTime) / (1000 * 60 * 60 * 24);

            // Determine activity badge
            let badge, description;
            if (daysSinceLastMsg > 90) {
              // No activity in 90+ days = dead regardless of historical velocity
              badge = '⚫';
              description = `${Math.floor(daysSinceLastMsg)}d ago`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.HOT) {
              badge = '🔥';
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.ACTIVE) {
              badge = '🟢';
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.MODERATE) {
              badge = '🔵';
              description = `${velocity.toFixed(1)}/day`;
            } else {
              badge = '⚫';
              description = velocity > 0.1 ? `${velocity.toFixed(1)}/day` : `${Math.floor(daysSinceLastMsg)}d ago`;
            }

            this.channelActivity.set(channelId, {
              velocity,
              lastMessage: newestTime,
              daysSinceLastMsg,
              badge,
              description
            });
          }

          sampled++;
          process.stdout.write(`\r    Sampled ${sampled}/${totalChannels} channels...`);

          // Rate limit to avoid hitting Discord API limits
          await this.sleep(SAMPLE_DELAY_MS);

        } catch (error) {
          // Channel might not be accessible (permissions)
          this.channelActivity.set(channelId, {
            velocity: 0,
            lastMessage: null,
            badge: '🔒',
            description: 'no access'
          });
          errors++;
        }
      }
    }

    console.log(`\n\n✅ Sampled ${sampled} channels (${errors} inaccessible)\n`);

    // Auto-mute inaccessible channels (no point recommending what we can't read)
    let autoMuted = 0;
    for (const [channelId, activity] of this.channelActivity) {
      if (activity.badge === '🔒' && !this.mutedChannels.has(channelId)) {
        this.mutedChannels.add(channelId);
        autoMuted++;
      }
    }
    if (autoMuted > 0) {
      console.log(`🔇 Auto-muted ${autoMuted} inaccessible channels\n`);
    }
  }

  /**
   * Get activity info for a channel
   */
  getActivityInfo(channelId) {
    return this.channelActivity.get(channelId) || {
      badge: '❓',
      description: 'not sampled'
    };
  }

  /**
   * Generate markdown with table format
   */
  generateChecklist(includeSampling = false) {
    console.log('📝 Generating channel checklist...');

    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    let markdown = `# Discord Channel Tracking Status\n`;
    markdown += `*Updated: ${timeStr}*\n\n`;

    // Collect stats
    let totalChannels = 0;
    let trackedCount = 0;
    let mutedCount = 0;
    let newCount = 0;
    const recommendations = []; // Hot/active untracked, unmuted channels

    for (const [guildId, guildData] of this.allChannels) {
      const tracked = this.trackedChannels.get(guildId) || new Set();

      for (const [channelId, channel] of guildData.channels) {
        totalChannels++;
        const isTracked = tracked.has(channelId);
        const isMuted = this.mutedChannels.has(channelId);

        if (isTracked) trackedCount++;
        if (isMuted) mutedCount++;
        if (!isTracked && !isMuted) newCount++;

        // Collect recommendations (hot/active, not tracked, not muted)
        if (!isTracked && !isMuted && includeSampling) {
          const activity = this.getActivityInfo(channelId);
          if (activity.badge === '🔥' || activity.badge === '🟢') {
            recommendations.push({
              channel,
              channelId,
              guildName: guildData.guild.name,
              activity
            });
          }
        }
      }
    }

    // Summary stats
    markdown += `## Summary\n\n`;
    markdown += `| Metric | Count |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Total Channels | ${totalChannels} |\n`;
    markdown += `| Currently Tracking | ${trackedCount} |\n`;
    markdown += `| Muted | ${mutedCount} |\n`;
    markdown += `| Available | ${newCount} |\n\n`;

    // Recommendations section (if we have activity data)
    if (recommendations.length > 0) {
      // Sort by velocity (highest first)
      recommendations.sort((a, b) => (b.activity.velocity || 0) - (a.activity.velocity || 0));

      markdown += `## 🔥 Recommendations\n\n`;
      markdown += `**${recommendations.length} active channels** not being tracked:\n\n`;
      markdown += `| Channel | ID | Activity | Track | Mute |\n`;
      markdown += `|---------|-----|----------|-------|------|\n`;

      for (const rec of recommendations.slice(0, 20)) { // Show top 20
        markdown += `| #${rec.channel.name} | \`${rec.channelId}\` | ${rec.activity.badge} ${rec.activity.description} | ⬜ | ⬜ |\n`;
      }
      if (recommendations.length > 20) {
        markdown += `| *...and ${recommendations.length - 20} more* | | | | |\n`;
      }
      markdown += `\n`;
    }

    // Instructions
    markdown += `## Instructions\n\n`;
    markdown += `1. **Track**: Change ⬜ to ✅ to add channel to config\n`;
    markdown += `2. **Mute**: Change ⬜ to ✅ to hide from recommendations (won't track)\n`;
    markdown += `3. Run \`npm run update-configs\` to apply changes\n`;
    if (!includeSampling) {
      markdown += `4. Run with \`--sample\` flag to get activity data\n`;
    }
    markdown += `\n`;

    // Activity legend (if sampling was done)
    if (includeSampling) {
      markdown += `## Activity Legend\n\n`;
      markdown += `| Badge | Meaning |\n`;
      markdown += `|-------|--------|\n`;
      markdown += `| 🔥 | Hot: >50 msgs/day |\n`;
      markdown += `| 🟢 | Active: 7-50 msgs/day |\n`;
      markdown += `| 🔵 | Moderate: 1.5-7 msgs/day |\n`;
      markdown += `| ⚫ | Quiet: <1.5 msgs/day or inactive |\n`;
      markdown += `| 🔒 | No access (bot can't read) |\n`;
      markdown += `\n`;
    }

    // Generate table for each guild
    for (const [guildId, guildData] of this.allChannels) {
      const { guild, channels } = guildData;
      const tracked = this.trackedChannels.get(guildId) || new Set();

      markdown += `## ${guild.name}\n\n`;
      markdown += `*Guild ID: \`${guildId}\`*\n\n`;

      // Group channels by category
      const channelsByCategory = new Map();

      for (const [channelId, channel] of channels) {
        const categoryName = channel.parent?.name || 'Uncategorized';
        if (!channelsByCategory.has(categoryName)) {
          channelsByCategory.set(categoryName, []);
        }
        channelsByCategory.get(categoryName).push({ channelId, channel });
      }

      // Output channels by category
      for (const [categoryName, categoryChannels] of channelsByCategory) {
        // When sampling, filter out locked channels first to check if category is empty
        let visibleChannels = categoryChannels;
        if (includeSampling) {
          visibleChannels = categoryChannels.filter(({ channelId }) => {
            const activity = this.getActivityInfo(channelId);
            return activity.badge !== '🔒';
          });
          // Skip empty categories (all channels locked)
          if (visibleChannels.length === 0) {
            continue;
          }
        }

        markdown += `### ${categoryName}\n\n`;

        // Table header
        if (includeSampling) {
          markdown += `| Channel | ID | Activity | Track | Mute |\n`;
          markdown += `|---------|-----|----------|-------|------|\n`;
        } else {
          markdown += `| Channel | ID | Track | Mute |\n`;
          markdown += `|---------|-----|-------|------|\n`;
        }

        for (const { channelId, channel } of visibleChannels) {
          const isTracked = tracked.has(channelId);
          const isMuted = this.mutedChannels.has(channelId);
          const trackBox = isTracked ? '✅' : '⬜';
          const muteBox = isMuted ? '✅' : '⬜';

          if (includeSampling) {
            const activity = this.getActivityInfo(channelId);
            markdown += `| #${channel.name} | \`${channelId}\` | ${activity.badge} ${activity.description} | ${trackBox} | ${muteBox} |\n`;
          } else {
            markdown += `| #${channel.name} | \`${channelId}\` | ${trackBox} | ${muteBox} |\n`;
          }
        }

        markdown += `\n`;
      }
    }

    return markdown;
  }

  /**
   * Find a channel across all guilds
   */
  findChannelInGuilds(channelId) {
    for (const [guildId, guildData] of this.allChannels) {
      const channel = guildData.channels.get(channelId);
      if (channel) {
        return { guild: guildData.guild, channel };
      }
    }
    return null;
  }

  /**
   * Save checklist to file
   */
  saveChecklist(markdown) {
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
    console.log(`✅ Checklist saved to ${OUTPUT_FILE}`);
  }

  /**
   * Cleanup Discord client
   */
  async cleanup() {
    if (this.client.isReady()) {
      this.client.destroy();
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const isTestMode = args.includes('--test-configs');
  const includeSampling = args.includes('--sample');

  const discovery = new ChannelDiscovery();

  try {
    discovery.loadConfigs();
    discovery.loadMutedChannels();

    if (isTestMode) {
      console.log('🧪 Running in test mode (no Discord API calls)\n');
      discovery.validateConfigs();
      console.log('✅ Configuration validation complete');
      return;
    }

    if (discovery.configs.size === 0) {
      console.log('❌ No valid Discord configurations found');
      process.exit(1);
    }

    await discovery.discoverChannels();

    if (includeSampling) {
      await discovery.sampleChannelActivity();
    }

    const markdown = discovery.generateChecklist(includeSampling);
    discovery.saveChecklist(markdown);

    console.log('\n✨ Channel discovery complete!');
    console.log(`\n📋 Next steps:`);
    console.log(`1. Review the generated checklist: ${OUTPUT_FILE}`);
    console.log(`2. Check Track column for channels to add`);
    console.log(`3. Check Mute column for channels to ignore`);
    console.log(`4. Run 'npm run update-configs' to apply changes`);

  } catch (error) {
    console.error(`\n❌ Discovery failed: ${error.message}`);
    process.exit(1);
  } finally {
    await discovery.cleanup();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});

if (require.main === module) {
  main();
}
