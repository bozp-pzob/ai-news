#!/usr/bin/env node

/**
 * AI News Pipeline Collection Script
 * 
 * Replaces complex workflow bash logic with a clean, testable, portable script.
 * Handles data collection, database encryption/decryption, file preparation,
 * and deployment preparation.
 * 
 * Usage:
 *   ./scripts/run-collection.js --config=elizaos.json --mode=daily
 *   ./scripts/run-collection.js --config=discord-raw.json --mode=historical --after=2024-01-01
 */

const path = require('path');

// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (error) {
    // dotenv not installed, continue without it
    console.warn('dotenv not available - make sure environment variables are set manually');
}

const { loadPipelineConfig, validateConfig, getDefaultPaths } = require('./lib/config-loader');
const { 
    ensureDir, 
    fileExists, 
    copyFile, 
    copyDirectory, 
    encryptDatabase, 
    decryptDatabase 
} = require('./lib/file-handler');

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        config: null,
        mode: 'daily', // daily, historical, manual
        after: null,
        before: null,
        date: null,
        output: './output',
        forceOverwrite: false,
        dryRun: false
    };
    
    for (const arg of args) {
        if (arg.startsWith('--config=')) {
            options.config = arg.split('=')[1];
        } else if (arg.startsWith('--mode=')) {
            options.mode = arg.split('=')[1];
        } else if (arg.startsWith('--after=')) {
            options.after = arg.split('=')[1];
        } else if (arg.startsWith('--before=')) {
            options.before = arg.split('=')[1];
        } else if (arg.startsWith('--date=')) {
            options.date = arg.split('=')[1];
        } else if (arg.startsWith('--output=')) {
            options.output = arg.split('=')[1];
        } else if (arg === '--force-overwrite') {
            options.forceOverwrite = true;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--help') {
            showHelp();
            process.exit(0);
        } else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(1);
        }
    }
    
    if (!options.config) {
        console.error('Error: --config parameter is required');
        showHelp();
        process.exit(1);
    }
    
    return options;
}

/**
 * Show help message
 */
function showHelp() {
    console.log(`
AI News Pipeline Collection Script

Usage: ./scripts/run-collection.js [options]

Required:
  --config=NAME       Configuration file name (e.g., elizaos.json)

Options:
  --mode=MODE         Collection mode: daily, historical, manual (default: daily)
  --after=DATE        Start date for historical collection (YYYY-MM-DD)
  --before=DATE       End date for historical collection (YYYY-MM-DD)  
  --date=DATE         Specific date for collection (YYYY-MM-DD)
  --output=PATH       Output directory (default: ./output)
  --force-overwrite   Overwrite existing data
  --dry-run          Show what would be done without executing
  --help             Show this help

Examples:
  # Daily collection (typical workflow usage)
  ./scripts/run-collection.js --config=elizaos.json --mode=daily

  # Historical collection for date range  
  ./scripts/run-collection.js --config=elizaos.json --mode=historical --after=2024-01-01 --before=2024-01-31

  # Single date collection
  ./scripts/run-collection.js --config=discord-raw.json --mode=historical --date=2024-01-15
`);
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

/**
 * Build historical collection command arguments
 */
function buildHistoricalArgs(options, config) {
    const args = ['--source', options.config];
    
    // Determine date parameters based on mode and provided options
    if (options.mode === 'daily') {
        // Daily mode uses yesterday's date
        args.push('--date', options.date || getYesterday());
    } else if (options.mode === 'historical') {
        // Historical mode supports date ranges
        if (options.after && options.before) {
            args.push('--after', options.after, '--before', options.before);
        } else if (options.after) {
            args.push('--after', options.after);
        } else if (options.before) {
            args.push('--before', options.before);
        } else if (options.date) {
            args.push('--date', options.date);
        } else {
            // Default to yesterday for historical mode without date params
            args.push('--date', getYesterday());
        }
    } else if (options.mode === 'manual') {
        // Manual mode requires explicit date parameters
        if (options.date) {
            args.push('--date', options.date);
        } else if (options.after || options.before) {
            if (options.after) args.push('--after', options.after);
            if (options.before) args.push('--before', options.before);
        } else {
            throw new Error('Manual mode requires --date, --after, or --before parameters');
        }
    }
    
    // Output directory
    args.push('--output', options.output);
    
    return args;
}

/**
 * Execute historical data collection
 */
async function runHistoricalCollection(options, config) {
    const { spawn } = require('child_process');
    
    try {
        console.log('🔄 Running historical data collection...');
        
        const args = buildHistoricalArgs(options, config);
        
        if (options.dryRun) {
            console.log('DRY RUN - Would execute:', 'npm run historical --', args.join(' '));
            return { success: true, dryRun: true };
        }
        
        console.log('Executing:', 'npm run historical --', args.join(' '));
        
        return new Promise((resolve, reject) => {
            const child = spawn('npm', ['run', 'historical', '--', ...args], {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    RUN_ONCE: 'true',
                    NODE_ENV: 'production',
                    FORCE_OVERWRITE: options.forceOverwrite ? 'true' : 'false'
                }
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Historical collection completed successfully');
                    resolve({ success: true, code });
                } else {
                    console.error(`❌ Historical collection failed with code ${code}`);
                    resolve({ success: false, code });
                }
            });
            
            child.on('error', (error) => {
                console.error('❌ Failed to start historical collection:', error.message);
                reject(error);
            });
        });
    } catch (error) {
        console.error('❌ Historical collection error:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Handle database encryption/decryption
 */
async function handleDatabaseOperations(options, config) {
    const encryptionKey = process.env.SQLITE_ENCRYPTION_KEY;
    if (!encryptionKey) {
        console.warn('⚠️  SQLITE_ENCRYPTION_KEY not found - skipping database encryption');
        return { decrypted: false, encrypted: false };
    }
    
    const configName = path.basename(options.config, '.json');
    const dbPath = `data/${configName}.sqlite`;
    const encryptedPath = `data/${configName}.sqlite.enc`;
    
    let decrypted = false;
    let encrypted = false;
    
    // Decrypt existing database if present
    if (await fileExists(encryptedPath)) {
        console.log('🔓 Decrypting existing database...');
        decrypted = await decryptDatabase(encryptedPath, dbPath, encryptionKey);
    }
    
    // After collection, encrypt the database
    if (await fileExists(dbPath)) {
        console.log('🔒 Encrypting database...');
        encrypted = await encryptDatabase(dbPath, encryptedPath, encryptionKey);
    }
    
    return { decrypted, encrypted };
}

/**
 * Prepare files for deployment
 */
async function prepareDeployment(options, config) {
    try {
        console.log('📁 Preparing files for deployment...');
        
        const paths = getDefaultPaths();
        const publicDir = paths.public;
        const configName = path.basename(options.config, '.json');
        
        // Create deployment directory structure
        await ensureDir(path.join(publicDir, 'data'));
        await ensureDir(path.join(publicDir, configName));
        
        let filesProcessed = 0;
        
        // Copy encrypted database
        const encryptedDbPath = `data/${configName}.sqlite.enc`;
        if (await fileExists(encryptedDbPath)) {
            await copyFile(encryptedDbPath, path.join(publicDir, 'data', `${configName}.sqlite.enc`));
            filesProcessed++;
        }
        
        // Copy generated outputs based on configuration
        const outputDir = options.output;
        
        // Handle different output structures based on config
        if (configName === 'elizaos') {
            // ElizaOS has both Discord and daily summaries
            const discordSummariesSrc = path.join(outputDir, 'discord', 'summaries');
            const discordSummariesDest = path.join(publicDir, 'elizaos', 'discord');
            
            if (await fileExists(discordSummariesSrc)) {
                const result = await copyDirectory(discordSummariesSrc, discordSummariesDest);
                filesProcessed += result.copied;
            }
            
            const dailySummariesSrc = path.join(outputDir, 'elizaos');
            const dailySummariesDest = path.join(publicDir, 'elizaos');
            
            if (await fileExists(dailySummariesSrc)) {
                const result = await copyDirectory(dailySummariesSrc, dailySummariesDest);
                filesProcessed += result.copied;
            }
            
            // Create daily.json files for latest data
            const yesterday = options.date || getYesterday();
            
            // Discord daily files
            const discordJsonSrc = path.join(outputDir, 'discord', 'summaries', `${yesterday}.json`);
            const discordJsonDest = path.join(publicDir, 'elizaos', 'discord', 'daily.json');
            if (await fileExists(discordJsonSrc)) {
                await copyFile(discordJsonSrc, discordJsonDest);
                filesProcessed++;
            }
            
            const discordMdSrc = path.join(outputDir, 'discord', 'summaries', `${yesterday}.md`);
            const discordMdDest = path.join(publicDir, 'elizaos', 'discord', 'daily.md');
            if (await fileExists(discordMdSrc)) {
                await copyFile(discordMdSrc, discordMdDest);
                filesProcessed++;
            }
            
            // ElizaOS daily files
            await ensureDir(path.join(publicDir, 'elizaos', 'json'));
            const elizaosJsonSrc = path.join(outputDir, 'elizaos', `${yesterday}.json`);
            const elizaosJsonDest = path.join(publicDir, 'elizaos', 'json', 'daily.json');
            if (await fileExists(elizaosJsonSrc)) {
                await copyFile(elizaosJsonSrc, elizaosJsonDest);
                filesProcessed++;
            }
        } else {
            // Generic output copying for other configurations
            const outputSrc = outputDir;
            const outputDest = path.join(publicDir, configName);
            
            if (await fileExists(outputSrc)) {
                const result = await copyDirectory(outputSrc, outputDest);
                filesProcessed += result.copied;
            }
        }
        
        console.log(`✅ Deployment preparation complete: ${filesProcessed} files processed`);
        return { filesProcessed };
        
    } catch (error) {
        console.error('❌ Deployment preparation failed:', error.message);
        throw error;
    }
}

/**
 * Validate JSON files in deployment directory
 */
async function validateJsonFiles(options) {
    try {
        console.log('🔍 Validating JSON files...');
        
        const paths = getDefaultPaths();
        const publicDir = paths.public;
        const configName = path.basename(options.config, '.json');
        
        // Find all JSON files in the deployment directory
        const { spawn } = require('child_process');
        
        if (options.dryRun) {
            console.log('DRY RUN - Would validate JSON files in:', path.join(publicDir, configName));
            return { valid: true, dryRun: true };
        }
        
        return new Promise((resolve, reject) => {
            const child = spawn('find', [
                path.join(publicDir, configName),
                '-name', '*.json',
                '-type', 'f',
                '-exec', 'jq', 'empty', '{}', ';'
            ], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stderr = '';
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ All JSON files are valid');
                    resolve({ valid: true });
                } else {
                    console.error('❌ Invalid JSON detected:', stderr);
                    resolve({ valid: false, error: stderr });
                }
            });
            
            child.on('error', (error) => {
                if (error.code === 'ENOENT') {
                    console.warn('⚠️  jq not available - skipping JSON validation');
                    resolve({ valid: true, skipped: true });
                } else {
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error('❌ JSON validation error:', error.message);
        return { valid: false, error: error.message };
    }
}

/**
 * Main execution function
 */
async function main() {
    try {
        console.log('🚀 AI News Pipeline Collection Starting...\n');
        
        // Parse command line arguments
        const options = parseArgs();
        
        // Load pipeline configuration
        console.log(`📋 Loading configuration: ${options.config}`);
        const config = await loadPipelineConfig(path.basename(options.config, '.json'));
        
        // Validate required configuration
        validateConfig(config, ['settings']);
        
        if (options.dryRun) {
            console.log('\n--- DRY RUN MODE ---');
            console.log('Configuration:', options.config);
            console.log('Mode:', options.mode);
            console.log('Output:', options.output);
            if (options.after) console.log('After:', options.after);
            if (options.before) console.log('Before:', options.before);
            if (options.date) console.log('Date:', options.date);
            console.log('---\n');
        }
        
        // Step 1: Handle database decryption
        const dbResult = await handleDatabaseOperations(options, config);
        
        // Step 2: Run historical data collection
        const collectionResult = await runHistoricalCollection(options, config);
        if (!collectionResult.success && !options.dryRun) {
            console.error('❌ Collection failed, aborting...');
            process.exit(1);
        }
        
        // Step 3: Handle database encryption (if collection succeeded)
        if (collectionResult.success && !options.dryRun) {
            // Re-encrypt database after collection
            await handleDatabaseOperations(options, config);
        }
        
        // Step 4: Prepare files for deployment
        if (!options.dryRun) {
            const deployResult = await prepareDeployment(options, config);
        } else {
            console.log('DRY RUN - Would prepare deployment files');
        }
        
        // Step 5: Validate JSON files
        const validationResult = await validateJsonFiles(options);
        if (!validationResult.valid && !validationResult.skipped && !options.dryRun) {
            console.error('❌ JSON validation failed, aborting...');
            process.exit(1);
        }
        
        // Success summary
        console.log('\n✅ Pipeline collection completed successfully!');
        console.log('📊 Summary:');
        console.log(`   Config: ${options.config}`);
        console.log(`   Mode: ${options.mode}`);
        console.log(`   Database operations: decrypt=${dbResult.decrypted}, encrypt=${dbResult.encrypted}`);
        console.log(`   Collection: ${collectionResult.success ? 'success' : 'failed'}`);
        console.log(`   JSON validation: ${validationResult.valid ? 'passed' : 'failed'}`);
        
        if (options.dryRun) {
            console.log('\n💡 This was a dry run. Use without --dry-run to execute.');
        }
        
    } catch (error) {
        console.error('❌ Pipeline collection failed:', error.message);
        process.exit(1);
    }
}

// Execute if called directly
if (require.main === module) {
    main();
}

module.exports = { main, parseArgs, buildHistoricalArgs };