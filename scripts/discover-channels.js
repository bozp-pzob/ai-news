#!/usr/bin/env node

/**
 * Discord Channel Discovery Script
 * Discovers all channels in configured Discord servers and outputs a checklist
 * for easy tracking and configuration management.
 * 
 * Usage:
 * - npm run discover-channels
 * - node scripts/discover-channels.js --config=elizaos.json
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

class ChannelDiscovery {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });
    this.allChannels = new Map(); // guildId -> channels
    this.trackedChannels = new Map(); // guildId -> Set of tracked channel IDs
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
            const guildId = source.params?.guildId?.replace('process.env.', '') || 'unknown';
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
            const categoryA = a.parent?.name || 'Uncategorized';
            const categoryB = b.parent?.name || 'Uncategorized';
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
   * Generate markdown checklist of all channels
   */
  generateChecklist() {
    console.log('📝 Generating channel checklist...');

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    let markdown = `# Discord Channel Management\n\n`;
    markdown += `*Last updated: ${timeStr}*\n\n`;
    markdown += `## Overview\n\n`;

    let totalChannels = 0;
    let trackedChannels = 0;

    for (const [guildId, guildData] of this.allChannels) {
      totalChannels += guildData.channels.size;
      const tracked = this.trackedChannels.get(guildId) || new Set();
      trackedChannels += tracked.size;
    }

    markdown += `- **Total channels discovered**: ${totalChannels}\n`;
    markdown += `- **Currently tracked**: ${trackedChannels}\n`;
    markdown += `- **Available to track**: ${totalChannels - trackedChannels}\n\n`;

    markdown += `## Instructions\n\n`;
    markdown += `1. ✅ **Check boxes** for channels you want to track\n`;
    markdown += `2. ⚠️  **Uncheck boxes** for channels to stop tracking\n`;
    markdown += `3. 🔄 **Run \`npm run update-configs\`** to apply changes to configuration files\n\n`;

    markdown += `## Guilds and Channels\n\n`;

    // Generate checklist for each guild
    for (const [guildId, guildData] of this.allChannels) {
      const { guild, channels } = guildData;
      const tracked = this.trackedChannels.get(guildId) || new Set();

      markdown += `### ${guild.name}\n\n`;
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
        if (categoryName !== 'Uncategorized') {
          markdown += `#### ${categoryName}\n\n`;
        }

        for (const { channelId, channel } of categoryChannels) {
          const isTracked = tracked.has(channelId);
          const checkbox = isTracked ? '- [x]' : '- [ ]';
          const topic = channel.topic ? ` - *${channel.topic.substring(0, 80)}${channel.topic.length > 80 ? '...' : ''}*` : '';
          
          markdown += `${checkbox} **#${channel.name}** (\`${channelId}\`)${topic}\n`;
        }

        markdown += `\n`;
      }
    }

    // Configuration reference
    markdown += `## Configuration Reference\n\n`;
    markdown += `Current channel assignments by configuration file:\n\n`;

    for (const [configName, config] of this.configs) {
      markdown += `### ${configName}\n\n`;
      
      for (const source of config.discordSources) {
        const channelIds = source.params?.channelIds || [];
        markdown += `- **${source.name}**: ${channelIds.length} channels\n`;
        
        if (channelIds.length > 0) {
          // Show which channels are configured
          for (const channelId of channelIds.slice(0, 5)) { // Show first 5
            const guildData = this.findChannelInGuilds(channelId);
            if (guildData) {
              markdown += `  - #${guildData.channel.name}\n`;
            } else {
              markdown += `  - \`${channelId}\` *(channel not found)*\n`;
            }
          }
          if (channelIds.length > 5) {
            markdown += `  - ... and ${channelIds.length - 5} more\n`;
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
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const isTestMode = args.includes('--test-configs');

  const discovery = new ChannelDiscovery();

  try {
    discovery.loadConfigs();

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
    const markdown = discovery.generateChecklist();
    discovery.saveChecklist(markdown);

    console.log('\n✨ Channel discovery complete!');
    console.log(`\n📋 Next steps:`);
    console.log(`1. Review the generated checklist: ${OUTPUT_FILE}`);
    console.log(`2. Check/uncheck channels as needed`);
    console.log(`3. Run 'npm run update-configs' to apply changes`);

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