#!/usr/bin/env node

/**
 * Discord Channel Discovery Script
 * 
 * Enumerates all visible channels in configured Discord guilds and generates
 * a markdown checklist showing tracking status for each channel.
 */

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG_DIR = path.join(__dirname, '../config');
const OUTPUT_FILE = path.join(__dirname, 'CHANNELS.md');

/**
 * Load and parse a JSON configuration file
 */
async function loadConfig(configPath) {
    try {
        const content = await fs.readFile(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`Warning: Could not load config ${configPath}:`, error.message);
        return null;
    }
}

/**
 * Resolve environment variable references in config values
 */
function resolveEnvVar(value) {
    if (typeof value === 'string' && value.startsWith('process.env.')) {
        const envVar = value.replace('process.env.', '');
        return process.env[envVar];
    }
    return value;
}

/**
 * Get all Discord source configurations from config files
 */
async function getDiscordConfigs() {
    const configFiles = await fs.readdir(CONFIG_DIR);
    const discordConfigs = [];

    for (const file of configFiles) {
        if (!file.endsWith('.json')) continue;
        
        const config = await loadConfig(path.join(CONFIG_DIR, file));
        if (!config) continue;

        // Skip non-pipeline config files
        if (!Array.isArray(config.sources)) {
            console.log(`⏭️  Skipping ${file} (not a pipeline config)`);
            continue;
        }

        // Find Discord sources in this config
        const discordSources = config.sources.filter(source => 
            source.type === 'DiscordRawDataSource' || 
            source.type === 'DiscordChannelSource' ||
            source.type === 'DiscordAnnouncementSource'
        );

        for (const source of discordSources) {
            const guildId = resolveEnvVar(source.params?.guildId) || process.env.DISCORD_GUILD_ID;
            const botToken = resolveEnvVar(source.params?.botToken) || process.env.DISCORD_TOKEN;
            if (guildId && botToken) {
                discordConfigs.push({
                    configFile: file,
                    sourceName: source.name,
                    guildId: guildId,
                    botToken: botToken,
                    channelIds: source.params?.channelIds || [],
                    type: source.type
                });
            }
        }
    }

    return discordConfigs;
}

/**
 * Fetch all channels from a Discord guild using specific bot token
 */
async function fetchGuildChannels(guildId, botToken) {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    try {
        await client.login(botToken);
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        
        const channelList = channels
            .filter(channel => channel.type === ChannelType.GuildText)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                category: channel.parent?.name || 'No Category',
                categoryPosition: channel.parent?.position || 0,
                position: channel.position
            }))
            .sort((a, b) => {
                // First sort by category position, then by channel position within category
                if (a.categoryPosition !== b.categoryPosition) {
                    return a.categoryPosition - b.categoryPosition;
                }
                return a.position - b.position;
            });

        const result = {
            guildName: guild.name,
            channels: channelList
        };

        await client.destroy();
        return result;
    } catch (error) {
        console.error(`Error fetching channels for guild ${guildId}:`, error.message);
        await client.destroy();
        return {
            guildName: `Guild ${guildId}`,
            channels: []
        };
    }
}

/**
 * Generate analytics reminder section
 */
function generateAnalyticsReminder() {
    const now = new Date();
    const lastCheck = getLastAnalyticsCheck();
    const nextCheck = new Date(lastCheck.getTime() + (28 * 24 * 60 * 60 * 1000)); // 28 days later
    const daysUntilCheck = Math.ceil((nextCheck.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    
    let reminder = `## 📊 Analytics Reminder\n`;
    
    if (daysUntilCheck <= 0) {
        reminder += `🔔 **TIME TO CHECK ANALYTICS!** It's been 28+ days since last check.\n\n`;
        reminder += `📈 **Action Required**: Review channel activity and consider removing inactive channels:\n`;
        reminder += `- [Discord Server Analytics](https://discord.com/developers/servers/1253563208833433701/analytics/engagement)\n`;
        reminder += `- Look for channels with 0-5 messages in the last 28 days\n`;
        reminder += `- Consider unchecking low-activity channels to reduce noise\n\n`;
        reminder += `Analytics timer will reset when you update configs (run \`npm run update-configs\`).\n\n`;
    } else {
        reminder += `⏰ Next analytics review in **${daysUntilCheck} days** (${nextCheck.toISOString().split('T')[0]})\n\n`;
        reminder += `📈 [Discord Analytics](https://discord.com/developers/servers/1253563208833433701/analytics/engagement) | Review channel activity every 28 days\n\n`;
    }
    
    return reminder;
}

/**
 * Get the last analytics check date from a file or default to 28 days ago
 */
function getLastAnalyticsCheck() {
    const analyticsFile = path.join(__dirname, '.last-analytics-check');
    try {
        const content = require('fs').readFileSync(analyticsFile, 'utf8');
        return new Date(content.trim());
    } catch {
        // Default to 28 days ago if no file exists
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() - 28);
        return defaultDate;
    }
}

/**
 * Get analytics date range (last 28 days)
 */
function getAnalyticsDateRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 28);
    
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
    };
}

/**
 * Generate markdown checklist content organized by category
 */
function generateMarkdown(guildData, trackedChannels, configSummary) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    
    let markdown = `# Discord Channel Tracking Status\n`;
    markdown += `*Updated: ${timestamp}*\n\n`;
    
    // Add analytics reminder at the top
    markdown += generateAnalyticsReminder();

    for (const [guildId, data] of Object.entries(guildData)) {
        const { guildName, channels } = data;
        const trackedIds = trackedChannels[guildId] || new Set();
        const totalChannels = channels.length;
        const trackedCount = channels.filter(ch => trackedIds.has(ch.id)).length;
        const newChannels = channels.filter(ch => !trackedIds.has(ch.id));

        markdown += `## ${guildName} (${guildId})\n`;
        markdown += `**Total Channels**: ${totalChannels} | **Currently Tracking**: ${trackedCount} | **New Channels**: ${newChannels.length}\n\n`;

        // Group channels by category, maintaining Discord order
        const categorizedChannels = {};
        const categoryOrder = [];
        
        for (const channel of channels) {
            if (!categorizedChannels[channel.category]) {
                categorizedChannels[channel.category] = [];
                categoryOrder.push(channel.category);
            }
            categorizedChannels[channel.category].push(channel);
        }

        // Display all channels by category with checkboxes
        markdown += `### Channels\n`;
        for (const category of categoryOrder) {
            const categoryChannels = categorizedChannels[category];
            
            if (category !== 'No Category') {
                markdown += `**${category}:**\n`;
            }
            
            for (const channel of categoryChannels) {
                const isTracked = trackedIds.has(channel.id);
                const checkbox = isTracked ? '[x]' : '[ ]';
                const newTag = isTracked ? '' : ' **NEW**';
                
                markdown += `- ${checkbox} #${channel.name} (${channel.id})${newTag}\n`;
            }
            markdown += `\n`;
        }
    }

    // Add configuration summary
    markdown += `## Configuration Summary\n`;
    for (const config of configSummary) {
        markdown += `- **${config.configFile}**: ${config.sourceName} (${config.channelCount} channels)\n`;
    }

    return markdown;
}

/**
 * Main execution function
 */
async function main() {
    console.log('🔍 Starting Discord channel discovery...');

    // Load environment variables
    require('dotenv').config({ path: path.join(__dirname, '../.env') });

    // Test mode - just validate configs without Discord API
    if (process.argv.includes('--test-configs')) {
        console.log('🧪 Running in test mode - validating configurations only');
        const discordConfigs = await getDiscordConfigs();
        console.log(`📋 Found ${discordConfigs.length} Discord source configuration(s):`);
        for (const config of discordConfigs) {
            console.log(`  - ${config.configFile}: ${config.sourceName} (${config.channelIds.length} channels)`);
            if (process.argv.includes('--debug')) {
                console.log(`    Guild ID: ${config.guildId}`);
                console.log(`    Bot Token: ${config.botToken ? config.botToken.substring(0, 20) + '...' : 'undefined'}`);
                console.log(`    Channels: ${config.channelIds.slice(0, 3).join(', ')}${config.channelIds.length > 3 ? '...' : ''}`);
            }
        }
        return;
    }

    // Get Discord configurations
    const discordConfigs = await getDiscordConfigs();
    if (discordConfigs.length === 0) {
        console.error('❌ No Discord configurations found');
        process.exit(1);
    }

    console.log(`📋 Found ${discordConfigs.length} Discord source(s) to analyze`);

    // Group configs by unique guild+token combinations
    const guildTokenMap = new Map();
    const trackedChannels = {};
    
    for (const config of discordConfigs) {
        const key = `${config.guildId}:${config.botToken}`;
        if (!guildTokenMap.has(key)) {
            guildTokenMap.set(key, {
                guildId: config.guildId,
                botToken: config.botToken
            });
        }
        
        if (!trackedChannels[config.guildId]) {
            trackedChannels[config.guildId] = new Set();
        }
        
        for (const channelId of config.channelIds) {
            trackedChannels[config.guildId].add(channelId);
        }
    }

    // Fetch channels for each unique guild+token combination
    const guildData = {};
    
    for (const [key, {guildId, botToken}] of guildTokenMap) {
        console.log(`📡 Fetching channels for guild ${guildId}...`);
        guildData[guildId] = await fetchGuildChannels(guildId, botToken);
    }

    // Generate configuration summary
    const configSummary = discordConfigs.map(config => ({
        configFile: config.configFile,
        sourceName: config.sourceName,
        channelCount: config.channelIds.length
    }));

    // Generate markdown
    const markdown = generateMarkdown(guildData, trackedChannels, configSummary);
    
    // Write to file
    await fs.writeFile(OUTPUT_FILE, markdown, 'utf8');
    console.log(`✅ Channel checklist written to ${OUTPUT_FILE}`);

    // Log summary
    const totalChannels = Object.values(guildData).reduce((sum, data) => sum + data.channels.length, 0);
    const totalTracked = Object.values(trackedChannels).reduce((sum, set) => sum + set.size, 0);
    const newChannels = totalChannels - totalTracked;

    console.log(`📊 Summary: ${totalChannels} total channels, ${totalTracked} tracked, ${newChannels} new`);
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
