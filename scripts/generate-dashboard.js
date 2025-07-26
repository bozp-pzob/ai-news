#!/usr/bin/env node

/**
 * Comprehensive Dashboard Generator for AI News Aggregator
 * 
 * Provides terminal-friendly observability covering:
 * - Discord channel configuration drift
 * - GitHub workflow status and failures  
 * - Generated file availability
 * - Quick links to logs and analytics
 * 
 * Usage: node scripts/generate-dashboard.js [--config=path] [--dry-run]
 */

const fs = require('fs').promises;
const path = require('path');

// Default configuration
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../config/dashboard.json');
const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Load dashboard configuration
 */
async function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
    try {
        const content = await fs.readFile(configPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Failed to load config from ${configPath}:`, error.message);
        process.exit(1);
    }
}

/**
 * Parse CHANNELS.md file for configuration drift data
 */
async function parseChannelsFile(channelsPath) {
    try {
        const content = await fs.readFile(channelsPath, 'utf8');
        const lines = content.split('\n');
        
        const stats = {
            lastUpdated: null,
            analyticsReminder: null,
            guilds: []
        };
        
        // Extract timestamp
        const updatedLine = lines.find(line => line.includes('*Updated:'));
        if (updatedLine) {
            const match = updatedLine.match(/\*Updated: (.*?)\*/);
            stats.lastUpdated = match ? match[1] : null;
        }
        
        // Extract analytics reminder  
        const reminderLine = lines.find(line => line.includes('Next analytics review in'));
        if (reminderLine) {
            const match = reminderLine.match(/Next analytics review in \*\*(.*?)\*\*/);
            stats.analyticsReminder = match ? match[1] : null;
        }
        
        // Extract guild statistics
        const guildPattern = /^## (.+?) \((\d+)\)$/;
        const statsPattern = /\*\*Total Channels\*\*: (\d+) \| \*\*Currently Tracking\*\*: (\d+) \| \*\*New Channels\*\*: (\d+)/;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const guildMatch = line.match(guildPattern);
            
            if (guildMatch) {
                const guildName = guildMatch[1];
                const guildId = guildMatch[2];
                
                // Look for stats line
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    const statsMatch = lines[j].match(statsPattern);
                    if (statsMatch) {
                        const totalChannels = parseInt(statsMatch[1]);
                        const tracking = parseInt(statsMatch[2]);
                        const newChannels = parseInt(statsMatch[3]);
                        
                        stats.guilds.push({
                            name: guildName,
                            id: guildId,
                            totalChannels,
                            tracking,
                            newChannels,
                            coverage: totalChannels > 0 ? Math.round((tracking / totalChannels) * 100) : 0
                        });
                        break;
                    }
                }
            }
        }
        
        return stats;
    } catch (error) {
        console.warn('Warning: Could not parse channels file:', error.message);
        return { lastUpdated: null, analyticsReminder: null, guilds: [] };
    }
}

/**
 * Get recent GitHub workflow runs
 */
async function getWorkflowStatus(config) {
    try {
        const { owner, repo } = config.project.github;
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/actions/runs?per_page=20`;
        
        // Note: GitHub API works without auth for public repos, but has lower rate limits
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': `${owner}/${repo}-dashboard`
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API responded with ${response.status}`);
        }
        
        const data = await response.json();
        const cutoff = new Date(Date.now() - (config.thresholds.workflow.hoursForRecent * 60 * 60 * 1000));
        
        const recentRuns = data.workflow_runs.filter(run => 
            new Date(run.created_at) > cutoff
        );
        
        const failures = recentRuns.filter(run => 
            run.conclusion === 'failure'
        );
        
        const lastSuccess = recentRuns.find(run => 
            run.conclusion === 'success'
        );
        
        return {
            recentRuns: recentRuns.length,
            failures: failures.length,
            lastSuccess: lastSuccess ? lastSuccess.created_at : null,
            recentFailures: failures.slice(0, 5).map(run => ({
                name: run.name,
                conclusion: run.conclusion,
                created_at: run.created_at,
                html_url: run.html_url
            }))
        };
    } catch (error) {
        console.warn('Warning: Could not fetch workflow status:', error.message);
        return {
            recentRuns: 0,
            failures: 0,
            lastSuccess: null,
            recentFailures: [],
            error: error.message
        };
    }
}

/**
 * Check if critical files exist and are recent
 */
async function checkGeneratedFiles(config) {
    const results = [];
    
    for (const filePath of config.monitoring.criticalFiles) {
        const fullPath = path.join('./public', filePath);
        try {
            const stats = await fs.stat(fullPath);
            const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
            
            results.push({
                path: filePath,
                exists: true,
                age: Math.round(ageHours),
                status: ageHours < 25 ? 'fresh' : ageHours < 49 ? 'stale' : 'old'
            });
        } catch (error) {
            results.push({
                path: filePath,
                exists: false,
                age: null,
                status: 'missing'
            });
        }
    }
    
    return results;
}

/**
 * Calculate overall statistics
 */
function calculateOverallStats(channelStats) {
    if (!channelStats.guilds.length) {
        return null;
    }
    
    const totals = channelStats.guilds.reduce((acc, guild) => {
        acc.totalChannels += guild.totalChannels;
        acc.tracking += guild.tracking;
        acc.newChannels += guild.newChannels;
        return acc;
    }, { totalChannels: 0, tracking: 0, newChannels: 0 });
    
    return {
        ...totals,
        coverage: totals.totalChannels > 0 ? Math.round((totals.tracking / totals.totalChannels) * 100) : 0,
        driftPercentage: totals.totalChannels > 0 ? Math.round((totals.newChannels / totals.totalChannels) * 100) : 0
    };
}

/**
 * Generate terminal-friendly dashboard text
 */
function generateStatusText(config, channelStats, workflowStatus, fileStatus, overallStats) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    let output = '';
    
    // Header
    output += `${config.project.name} Pipeline Status (${now})\n`;
    output += '━'.repeat(60) + '\n\n';
    
    // Overall health indicator
    const healthIndicators = [];
    
    // Workflow health
    if (workflowStatus.error) {
        healthIndicators.push('⚠️  GitHub API unavailable');
    } else if (workflowStatus.failures >= config.thresholds.workflow.maxFailuresCritical) {
        healthIndicators.push(`🔴 ${workflowStatus.failures} WORKFLOW FAILURES`);
    } else if (workflowStatus.failures >= config.thresholds.workflow.maxFailuresWarning) {
        healthIndicators.push(`⚠️  ${workflowStatus.failures} workflow failure(s)`);
    } else {
        healthIndicators.push('✅ Workflows healthy');
    }
    
    // Channel drift health
    if (overallStats) {
        if (overallStats.driftPercentage >= config.thresholds.drift.critical) {
            healthIndicators.push(`🔴 HIGH DRIFT: ${overallStats.newChannels} untracked (${overallStats.driftPercentage}%)`);
        } else if (overallStats.driftPercentage >= config.thresholds.drift.warning) {
            healthIndicators.push(`⚠️  Drift: ${overallStats.newChannels} untracked (${overallStats.driftPercentage}%)`);
        } else {
            healthIndicators.push('✅ Channel config up to date');
        }
    }
    
    // File health
    const missingFiles = fileStatus.filter(f => !f.exists).length;
    const staleFiles = fileStatus.filter(f => f.status === 'stale' || f.status === 'old').length;
    
    if (missingFiles > 0) {
        healthIndicators.push(`🔴 ${missingFiles} missing files`);
    } else if (staleFiles > 0) {
        healthIndicators.push(`⚠️  ${staleFiles} stale files`);
    } else {
        healthIndicators.push('✅ Generated files current');
    }
    
    output += healthIndicators.join('\n') + '\n\n';
    
    // Detailed sections
    if (workflowStatus.recentFailures.length > 0) {
        output += 'RECENT WORKFLOW FAILURES:\n';
        workflowStatus.recentFailures.forEach(failure => {
            const timeAgo = Math.round((Date.now() - new Date(failure.created_at)) / (1000 * 60 * 60));
            output += `├─ ${failure.name} - ${timeAgo}h ago\n`;
        });
        output += '\n';
    }
    
    // Channel statistics
    if (overallStats) {
        output += 'CHANNEL TRACKING:\n';
        output += `├─ Total: ${overallStats.totalChannels} channels across ${channelStats.guilds.length} guilds\n`;
        output += `├─ Tracking: ${overallStats.tracking} (${overallStats.coverage}%)\n`;
        output += `├─ Untracked: ${overallStats.newChannels} (${overallStats.driftPercentage}%)\n`;
        
        if (channelStats.lastUpdated) {
            output += `└─ Last updated: ${channelStats.lastUpdated}\n`;
        }
        output += '\n';
    }
    
    // File status
    if (fileStatus.length > 0) {
        output += 'GENERATED FILES:\n';
        fileStatus.forEach((file, index) => {
            const isLast = index === fileStatus.length - 1;
            const prefix = isLast ? '└─' : '├─';
            
            let status = '';
            switch (file.status) {
                case 'fresh': status = '✅'; break;
                case 'stale': status = '⚠️'; break;
                case 'old': status = '🔴'; break;
                case 'missing': status = '❌'; break;
            }
            
            const ageStr = file.exists ? ` (${file.age}h ago)` : ' (missing)';
            output += `${prefix} ${status} ${file.path}${ageStr}\n`;
        });
        output += '\n';
    }
    
    // Analytics reminder
    if (channelStats.analyticsReminder) {
        const days = channelStats.analyticsReminder.match(/(\\d+)\\s+days?/);
        const dayCount = days ? parseInt(days[1]) : null;
        
        if (dayCount !== null && dayCount <= 3) {
            output += `📈 ANALYTICS REVIEW DUE: ${channelStats.analyticsReminder}\n\n`;
        }
    }
    
    // Quick actions
    output += 'QUICK ACTIONS:\n';
    if (overallStats && overallStats.newChannels > 0) {
        output += '├─ npm run update-configs  # Add new channels\n';
    }
    if (workflowStatus.failures > 0) {
        output += '├─ Check workflow logs for failure details\n';
    }
    output += '└─ npm run discover-channels  # Refresh channel list\n\n';
    
    // Quick links
    output += 'QUICK LINKS:\n';
    output += `├─ Generated files: ${config.project.homepage}\n`;
    output += `├─ Workflow logs: ${config.monitoring.links.actions}\n`;
    output += `└─ Discord analytics: ${config.monitoring.links.analytics}\n\n`;
    
    // Footer
    output += `💡 curl ${config.project.homepage}/status.txt\n`;
    
    return output;
}

/**
 * Generate HTML dashboard
 */
function generateHTMLDashboard(config, textContent) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.project.name} - Pipeline Dashboard</title>
    <meta http-equiv="refresh" content="300">
    <style>
        body {
            background: #0d1117;
            color: #c9d1d9;
            font-family: 'Courier New', 'SF Mono', Monaco, 'Cascadia Code', monospace;
            margin: 0;
            padding: 20px;
            line-height: 1.4;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        .terminal {
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 20px;
            white-space: pre-wrap;
            font-size: 14px;
            overflow-x: auto;
        }
        .header {
            color: #58a6ff;
            font-weight: bold;
            margin-bottom: 20px;
            text-align: center;
        }
        .links {
            margin-top: 20px;
            padding: 15px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
        }
        .links a {
            color: #58a6ff;
            text-decoration: none;
            margin-right: 15px;
            display: inline-block;
            margin-bottom: 5px;
        }
        .links a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            color: #8b949e;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">🚀 ${config.project.name} Dashboard</div>
        
        <div class="terminal">${textContent.replace(/\n/g, '\n')}</div>
        
        <div class="links">
            <strong>Quick Access:</strong><br>
            <a href="/status.txt" target="_blank">📄 Plain Text Status</a>
            <a href="${config.monitoring.links.repository}" target="_blank">🔧 Repository</a>
            <a href="${config.monitoring.links.actions}" target="_blank">⚙️ Workflow Logs</a>
            <a href="${config.monitoring.links.analytics}" target="_blank">📈 Discord Analytics</a>
        </div>
        
        <div class="footer">
            Auto-refreshes every 5 minutes | Generated: ${now}<br>
            Terminal access: <code>curl ${config.project.homepage}/status.txt</code>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Main dashboard generation function
 */
async function generateDashboard(options = {}) {
    try {
        console.log('🔄 Generating comprehensive pipeline dashboard...');
        
        // Load configuration
        const config = await loadConfig(options.configPath);
        
        // Ensure output directory exists
        const outputDir = path.resolve(config.output.directory);
        await fs.mkdir(outputDir, { recursive: true });
        
        // Gather data
        console.log('📊 Gathering channel statistics...');
        const channelStats = await parseChannelsFile(
            path.resolve(config.sources.channelsFile)
        );
        
        console.log('⚙️ Checking workflow status...');
        const workflowStatus = await getWorkflowStatus(config);
        
        console.log('📁 Checking generated files...');
        const fileStatus = await checkGeneratedFiles(config);
        
        const overallStats = calculateOverallStats(channelStats);
        
        // Generate outputs
        const statusText = generateStatusText(
            config, channelStats, workflowStatus, fileStatus, overallStats
        );
        
        if (options.dryRun) {
            console.log('\n--- DASHBOARD OUTPUT (DRY RUN) ---');
            console.log(statusText);
            return;
        }
        
        // Write files
        const statusPath = path.join(outputDir, config.output.statusFile);
        const dashboardPath = path.join(outputDir, config.output.dashboardFile);
        
        await fs.writeFile(statusPath, statusText, 'utf8');
        console.log(`✅ Generated status file: ${statusPath}`);
        
        const htmlContent = generateHTMLDashboard(config, statusText);
        await fs.writeFile(dashboardPath, htmlContent, 'utf8');
        console.log(`✅ Generated HTML dashboard: ${dashboardPath}`);
        
        // Summary
        console.log('\n📊 Dashboard Summary:');
        if (overallStats) {
            const driftLevel = overallStats.driftPercentage >= config.thresholds.drift.critical ? 'CRITICAL' :
                              overallStats.driftPercentage >= config.thresholds.drift.warning ? 'WARNING' : 'OK';
            console.log(`   Channel drift: ${overallStats.driftPercentage}% (${driftLevel})`);
        }
        
        if (!workflowStatus.error) {
            const workflowLevel = workflowStatus.failures >= config.thresholds.workflow.maxFailuresCritical ? 'CRITICAL' :
                                 workflowStatus.failures >= config.thresholds.workflow.maxFailuresWarning ? 'WARNING' : 'OK';
            console.log(`   Workflow health: ${workflowStatus.failures} failures (${workflowLevel})`);
        }
        
        const missingFiles = fileStatus.filter(f => !f.exists).length;
        console.log(`   File status: ${fileStatus.length - missingFiles}/${fileStatus.length} files available`);
        
        console.log(`\n💡 Access dashboard:`);
        console.log(`   curl ${config.project.homepage}/status.txt`);
        console.log(`   ${config.project.homepage}/dashboard.html`);
        
    } catch (error) {
        console.error('❌ Dashboard generation failed:', error.message);
        process.exit(1);
    }
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    const options = {};
    
    args.forEach(arg => {
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg.startsWith('--config=')) {
            options.configPath = arg.split('=')[1];
        } else if (arg === '--help') {
            console.log('Usage: node generate-dashboard.js [options]');
            console.log('Options:');
            console.log('  --config=PATH   Use custom config file');
            console.log('  --dry-run      Show output without writing files');
            console.log('  --help         Show this help');
            process.exit(0);
        }
    });
    
    generateDashboard(options);
}

module.exports = { generateDashboard };