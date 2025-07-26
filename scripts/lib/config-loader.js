/**
 * Configuration loader for AI News pipeline scripts
 * 
 * Provides unified configuration loading with environment variable support
 * and validation for different script contexts.
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Load and parse a JSON configuration file
 * @param {string} configPath - Path to config file
 * @returns {Promise<Object>} - Parsed configuration
 */
async function loadConfig(configPath) {
    try {
        if (!path.isAbsolute(configPath)) {
            configPath = path.resolve(configPath);
        }
        
        const content = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(content);
        
        // Resolve environment variable references
        return resolveEnvVars(config);
    } catch (error) {
        throw new Error(`Failed to load config from ${configPath}: ${error.message}`);
    }
}

/**
 * Recursively resolve environment variable references in config
 * @param {any} obj - Configuration object or value
 * @returns {any} - Resolved configuration
 */
function resolveEnvVars(obj) {
    if (typeof obj === 'string') {
        if (obj.startsWith('process.env.')) {
            const envVar = obj.replace('process.env.', '');
            const value = process.env[envVar];
            if (!value) {
                console.warn(`Warning: Environment variable ${envVar} not found`);
            }
            return value || obj;
        }
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(resolveEnvVars);
    }
    
    if (obj && typeof obj === 'object') {
        const resolved = {};
        for (const [key, value] of Object.entries(obj)) {
            resolved[key] = resolveEnvVars(value);
        }
        return resolved;
    }
    
    return obj;
}

/**
 * Load pipeline configuration by name
 * @param {string} configName - Name of config file (e.g., 'elizaos', 'discord-raw')
 * @returns {Promise<Object>} - Pipeline configuration
 */
async function loadPipelineConfig(configName) {
    const configPath = path.resolve('config', `${configName}.json`);
    return await loadConfig(configPath);
}

/**
 * Get configuration for a specific component type
 * @param {Object} config - Full pipeline configuration
 * @param {string} type - Component type ('sources', 'ai', 'enrichers', etc.)
 * @param {string} name - Component name
 * @returns {Object|null} - Component configuration or null if not found
 */
function getComponentConfig(config, type, name) {
    const components = config[type] || [];
    return components.find(component => component.name === name) || null;
}

/**
 * Validate required configuration fields
 * @param {Object} config - Configuration to validate
 * @param {string[]} requiredFields - Array of required field paths (e.g., ['project.github.owner'])
 * @throws {Error} - If required fields are missing
 */
function validateConfig(config, requiredFields) {
    const missing = [];
    
    for (const field of requiredFields) {
        const value = getNestedValue(config, field);
        if (value === undefined || value === null || value === '') {
            missing.push(field);
        }
    }
    
    if (missing.length > 0) {
        throw new Error(`Missing required configuration fields: ${missing.join(', ')}`);
    }
}

/**
 * Get nested object value by dot notation
 * @param {Object} obj - Object to search
 * @param {string} path - Dot notation path (e.g., 'project.github.owner')
 * @returns {any} - Value or undefined
 */
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
}

/**
 * Get default configuration paths
 * @returns {Object} - Default paths for common configurations
 */
function getDefaultPaths() {
    return {
        configs: path.resolve('config'),
        output: path.resolve('output'),
        data: path.resolve('data'),
        public: path.resolve('public'),
        scripts: path.resolve('scripts')
    };
}

module.exports = {
    loadConfig,
    loadPipelineConfig,
    getComponentConfig,
    validateConfig,
    getNestedValue,
    getDefaultPaths,
    resolveEnvVars
};