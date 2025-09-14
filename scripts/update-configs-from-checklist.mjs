#!/usr/bin/env node

/**
 * Config Update Script
 * 
 * Reads the CHANNELS.md checklist and updates config files to add
 * newly checked channels to their respective configurations.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG_DIR = path.join(__dirname, '../config');
const CHECKLIST_FILE = path.join(__dirname, 'CHANNELS.md');

/**
 * Parse the channels checklist to extract checked channels by guild
 */
async function parseChecklist() {
    try {
        const content = await fs.readFile(CHECKLIST_FILE, 'utf8');
        const lines = content.split('\n');
        
        const guilds = {};
        let currentGuild = null;
        
        for (const line of lines) {
            // Detect guild headers: ## GuildName (1234567890)
            const guildMatch = line.match(/^## (.+?) \((\d+)\)$/);
            if (guildMatch) {
                currentGuild = {
                    name: guildMatch[1],
                    id: guildMatch[2],
                    checkedChannels: [],
                    uncheckedChannels: []
                };
                guilds[currentGuild.id] = currentGuild;
                continue;
            }
            
            // Detect channel lines: - [x] #channel-name (1234567890)
            const channelMatch = line.match(/^- \[([ x])\] #(.+?) \((\d+)\)/);
            if (channelMatch && currentGuild) {
                const isChecked = channelMatch[1] === 'x';
                const channelName = channelMatch[2];
                const channelId = channelMatch[3];
                
                if (isChecked) {
                    currentGuild.checkedChannels.push({ name: channelName, id: channelId });
                } else {
                    currentGuild.uncheckedChannels.push({ name: channelName, id: channelId });
                }
            }
        }
        
        return guilds;
    } catch (error) {
        console.error('❌ Error reading checklist:', error.message);
        return {};
    }
}

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
 * Save configuration file with pretty formatting
 */
async function saveConfig(configPath, config) {
    const content = JSON.stringify(config, null, 2) + '\n';
    await fs.writeFile(configPath, content, 'utf8');
}

/**
 * Get Discord source configurations mapped to their config files
 */
async function getDiscordSourceMap() {
    const configFiles = await fs.readdir(CONFIG_DIR);
    const sourceMap = new Map();
    
    for (const file of configFiles) {
        if (!file.endsWith('.json')) continue;
        
        const config = await loadConfig(path.join(CONFIG_DIR, file));
        if (!config || !Array.isArray(config.sources)) continue;
        
        for (const source of config.sources) {
            if (source.type === 'DiscordRawDataSource' || 
                source.type === 'DiscordChannelSource' ||
                source.type === 'DiscordAnnouncementSource') {
                
                const guildId = resolveEnvVar(source.params?.guildId);
                if (guildId) {
                    sourceMap.set(`${file}:${source.name}`, {
                        configFile: file,
                        sourceName: source.name,
                        guildId: guildId,
                        source: source
                    });
                }
            }
        }
    }
    
    return sourceMap;
}

/**
 * Resolve environment variable references
 */
function resolveEnvVar(value) {
    if (typeof value === 'string' && value.startsWith('process.env.')) {
        const envVar = value.replace('process.env.', '');
        return process.env[envVar];
    }
    return value;
}

/**
 * Update configurations based on checklist changes
 */
async function updateConfigs(dryRun = false) {
    console.log('📋 Parsing channel checklist...');
    const guilds = await parseChecklist();
    
    if (Object.keys(guilds).length === 0) {
        console.error('❌ No guilds found in checklist');
        return;
    }
    
    console.log(`✅ Found ${Object.keys(guilds).length} guild(s) in checklist`);
    
    console.log('🔍 Loading Discord source configurations...');
    const sourceMap = await getDiscordSourceMap();
    
    let totalUpdates = 0;
    const updates = [];
    
    // Check each guild for channel changes (additions and removals)
    for (const [guildId, guild] of Object.entries(guilds)) {
        const checkedChannelIds = guild.checkedChannels.map(ch => ch.id);
        
        // Find configs that match this guild
        for (const [key, sourceConfig] of sourceMap) {
            if (sourceConfig.guildId === guildId) {
                const currentChannelIds = sourceConfig.source.params?.channelIds || [];
                
                // Find channels to add (checked but not in config)
                const channelsToAdd = checkedChannelIds.filter(id => !currentChannelIds.includes(id));
                
                // Find channels to remove (in config but not checked)
                const channelsToRemove = currentChannelIds.filter(id => !checkedChannelIds.includes(id));
                
                if (channelsToAdd.length > 0 || channelsToRemove.length > 0) {
                    const channelsToAddNames = channelsToAdd.map(id => 
                        guild.checkedChannels.find(ch => ch.id === id)?.name
                    ).filter(Boolean);
                    
                    const channelsToRemoveNames = channelsToRemove.map(id => {
                        // Try to find name from unchecked channels, or fall back to ID
                        const unchecked = guild.uncheckedChannels.find(ch => ch.id === id);
                        return unchecked?.name || id;
                    });
                    
                    const finalChannelIds = currentChannelIds
                        .filter(id => !channelsToRemove.includes(id))  // Remove unchecked
                        .concat(channelsToAdd);  // Add checked
                    
                    updates.push({
                        configFile: sourceConfig.configFile,
                        sourceName: sourceConfig.sourceName,
                        guildName: guild.name,
                        channelsToAdd,
                        channelsToAddNames,
                        channelsToRemove,
                        channelsToRemoveNames,
                        currentCount: currentChannelIds.length,
                        newCount: finalChannelIds.length,
                        finalChannelIds
                    });
                    
                    totalUpdates += channelsToAdd.length + channelsToRemove.length;
                }
            }
        }
    }
    
    if (updates.length === 0) {
        console.log('✅ No configuration updates needed - all checked channels are already tracked');
        return;
    }
    
    console.log(`\n📝 Found ${totalUpdates} channel change(s) across ${updates.length} configuration(s):`);
    
    for (const update of updates) {
        console.log(`\n  📁 ${update.configFile} (${update.sourceName})`);
        console.log(`     Guild: ${update.guildName}`);
        
        if (update.channelsToAdd.length > 0) {
            console.log(`     ➕ Adding ${update.channelsToAdd.length} channel(s): ${update.channelsToAddNames.join(', ')}`);
        }
        
        if (update.channelsToRemove.length > 0) {
            console.log(`     ➖ Removing ${update.channelsToRemove.length} channel(s): ${update.channelsToRemoveNames.join(', ')}`);
        }
        
        console.log(`     Channels: ${update.currentCount} → ${update.newCount}`);
    }
    
    if (dryRun) {
        console.log('\n🧪 Dry run mode - no changes made');
        return;
    }
    
    console.log('\n💾 Applying configuration updates...');
    
    // Apply updates
    for (const update of updates) {
        const configPath = path.join(CONFIG_DIR, update.configFile);
        const config = await loadConfig(configPath);
        
        if (config) {
            // Find the matching source and update its channelIds
            for (const source of config.sources) {
                if (source.name === update.sourceName) {
                    if (!source.params) {
                        source.params = {};
                    }
                    source.params.channelIds = update.finalChannelIds;
                    break;
                }
            }
            
            await saveConfig(configPath, config);
            console.log(`✅ Updated ${update.configFile}`);
        }
    }
    
    console.log(`\n🎉 Successfully updated ${totalUpdates} channel(s) across configurations!`);
    console.log('💡 Tip: Run the aggregator to start collecting data from new channels');
    
    // Reset analytics timer when configs are updated (implies user reviewed analytics)
    const analyticsFile = path.join(__dirname, '.last-analytics-check');
    await fs.writeFile(analyticsFile, new Date().toISOString(), 'utf8');
    console.log('📊 Analytics timer reset - next reminder in 28 days');
}

/**
 * Main execution function
 */
async function main() {
    console.log('🔧 Channel Configuration Updater');
    
    // Load environment variables
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    
    const isDryRun = process.argv.includes('--dry-run');
    
    if (isDryRun) {
        console.log('🧪 Running in dry-run mode - will show changes without applying them\n');
    }
    
    try {
        await updateConfigs(isDryRun);
    } catch (error) {
        console.error('❌ Error updating configurations:', error);
        process.exit(1);
    }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { updateConfigs, parseChecklist };