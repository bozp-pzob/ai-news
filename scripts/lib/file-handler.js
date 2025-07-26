/**
 * File handling utilities for AI News pipeline scripts
 * 
 * Provides utilities for database encryption/decryption, file copying,
 * directory management, and deployment preparation.
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Directory path to create
 * @returns {Promise<void>}
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} - True if file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Copy a file from source to destination, creating directories as needed
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {Object} options - Copy options
 * @param {boolean} options.createDirs - Create destination directories (default: true)
 * @param {boolean} options.overwrite - Overwrite existing files (default: true)
 * @returns {Promise<boolean>} - True if file was copied
 */
async function copyFile(src, dest, options = {}) {
    const { createDirs = true, overwrite = true } = options;
    
    try {
        // Check if source exists
        if (!(await fileExists(src))) {
            console.warn(`Source file not found: ${src}`);
            return false;
        }
        
        // Check if destination exists and overwrite is false
        if (!overwrite && await fileExists(dest)) {
            console.log(`Skipping existing file: ${dest}`);
            return false;
        }
        
        // Create destination directory
        if (createDirs) {
            await ensureDir(path.dirname(dest));
        }
        
        // Copy file
        await fs.copyFile(src, dest);
        console.log(`Copied: ${src} → ${dest}`);
        return true;
    } catch (error) {
        console.error(`Failed to copy ${src} → ${dest}:`, error.message);
        return false;
    }
}

/**
 * Copy directory contents recursively
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @param {Object} options - Copy options
 * @param {boolean} options.skipErrors - Continue on individual file errors (default: true)
 * @returns {Promise<{copied: number, failed: number}>} - Copy statistics
 */
async function copyDirectory(srcDir, destDir, options = {}) {
    const { skipErrors = true } = options;
    let copied = 0;
    let failed = 0;
    
    try {
        if (!(await fileExists(srcDir))) {
            console.warn(`Source directory not found: ${srcDir}`);
            return { copied, failed };
        }
        
        await ensureDir(destDir);
        
        const entries = await fs.readdir(srcDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const srcPath = path.join(srcDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            
            try {
                if (entry.isDirectory()) {
                    const result = await copyDirectory(srcPath, destPath, options);
                    copied += result.copied;
                    failed += result.failed;
                } else {
                    const success = await copyFile(srcPath, destPath);
                    if (success) {
                        copied++;
                    } else {
                        failed++;
                    }
                }
            } catch (error) {
                failed++;
                if (!skipErrors) {
                    throw error;
                }
                console.error(`Failed to copy ${srcPath}:`, error.message);
            }
        }
        
        console.log(`Directory copy complete: ${copied} files copied, ${failed} failed`);
        return { copied, failed };
    } catch (error) {
        console.error(`Failed to copy directory ${srcDir} → ${destDir}:`, error.message);
        throw error;
    }
}

/**
 * Encrypt a SQLite database file using OpenSSL
 * @param {string} inputPath - Path to unencrypted database
 * @param {string} outputPath - Path for encrypted output
 * @param {string} encryptionKey - Encryption key
 * @returns {Promise<boolean>} - True if encryption succeeded
 */
async function encryptDatabase(inputPath, outputPath, encryptionKey) {
    if (!encryptionKey) {
        throw new Error('Encryption key is required');
    }
    
    if (!(await fileExists(inputPath))) {
        console.warn(`Database file not found for encryption: ${inputPath}`);
        return false;
    }
    
    try {
        console.log(`Encrypting database: ${inputPath} → ${outputPath}`);
        
        await ensureDir(path.dirname(outputPath));
        
        await executeCommand('openssl', [
            'enc', '-aes-256-cbc', '-salt', '-pbkdf2',
            '-in', inputPath,
            '-out', outputPath,
            '-k', encryptionKey
        ]);
        
        console.log('Database encryption successful');
        
        // Remove original unencrypted file
        await fs.unlink(inputPath);
        console.log(`Removed unencrypted database: ${inputPath}`);
        
        return true;
    } catch (error) {
        console.error('Database encryption failed:', error.message);
        return false;
    }
}

/**
 * Decrypt a SQLite database file using OpenSSL
 * @param {string} inputPath - Path to encrypted database
 * @param {string} outputPath - Path for decrypted output
 * @param {string} encryptionKey - Decryption key
 * @returns {Promise<boolean>} - True if decryption succeeded
 */
async function decryptDatabase(inputPath, outputPath, encryptionKey) {
    if (!encryptionKey) {
        throw new Error('Decryption key is required');
    }
    
    if (!(await fileExists(inputPath))) {
        console.log(`No encrypted database found: ${inputPath}`);
        return false;
    }
    
    try {
        console.log(`Decrypting database: ${inputPath} → ${outputPath}`);
        
        await ensureDir(path.dirname(outputPath));
        
        await executeCommand('openssl', [
            'enc', '-d', '-aes-256-cbc', '-salt', '-pbkdf2',
            '-in', inputPath,
            '-out', outputPath,
            '-k', encryptionKey
        ]);
        
        // Verify database integrity if sqlite3 is available
        try {
            await executeCommand('sqlite3', [outputPath, 'PRAGMA integrity_check;']);
            console.log('Database integrity check passed');
        } catch (error) {
            console.warn('Could not verify database integrity (sqlite3 not available)');
        }
        
        console.log('Database decryption successful');
        
        // Remove encrypted file
        await fs.unlink(inputPath);
        console.log(`Removed encrypted database: ${inputPath}`);
        
        return true;
    } catch (error) {
        console.error('Database decryption failed:', error.message);
        // Clean up failed decryption
        try {
            await fs.unlink(outputPath);
        } catch {}
        return false;
    }
}

/**
 * Execute a command with arguments
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Execution options
 * @returns {Promise<string>} - Command output
 */
function executeCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            ...options
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
            }
        });
        
        child.on('error', (error) => {
            reject(new Error(`Failed to execute ${command}: ${error.message}`));
        });
    });
}

/**
 * Get file age in hours
 * @param {string} filePath - Path to file
 * @returns {Promise<number|null>} - Age in hours, or null if file doesn't exist
 */
async function getFileAge(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
    } catch {
        return null;
    }
}

/**
 * Clean old files from a directory
 * @param {string} dirPath - Directory to clean
 * @param {number} maxAgeHours - Maximum age in hours
 * @param {string} pattern - Glob pattern to match (optional)
 * @returns {Promise<number>} - Number of files removed
 */
async function cleanOldFiles(dirPath, maxAgeHours, pattern = '*') {
    try {
        if (!(await fileExists(dirPath))) {
            return 0;
        }
        
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        let removed = 0;
        
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            
            const filePath = path.join(dirPath, entry.name);
            const age = await getFileAge(filePath);
            
            if (age !== null && age > maxAgeHours) {
                await fs.unlink(filePath);
                console.log(`Removed old file: ${filePath} (${Math.round(age)}h old)`);
                removed++;
            }
        }
        
        return removed;
    } catch (error) {
        console.error(`Failed to clean old files from ${dirPath}:`, error.message);
        return 0;
    }
}

module.exports = {
    ensureDir,
    fileExists,
    copyFile,
    copyDirectory,
    encryptDatabase,
    decryptDatabase,
    executeCommand,
    getFileAge,
    cleanOldFiles
};