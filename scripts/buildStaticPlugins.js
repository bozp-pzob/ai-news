#!/usr/bin/env node

/**
 * Build Static Plugins Script
 * 
 * This script generates a static JSON file containing all available plugin modules
 * and their constructor interfaces. This allows the frontend to load plugin data
 * without requiring a backend API call, enabling static hosting options.
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

// Config
const PLUGINS_OUTPUT_PATH = path.join(__dirname, '../frontend/public/static/plugins.json');
const PLUGINS_DIRS = {
  source: 'src/plugins/sources',
  ai: 'src/plugins/ai',
  enricher: 'src/plugins/enrichers',
  generator: 'src/plugins/generators',
  storage: 'src/plugins/storage'
};

/**
 * Find matching closing brace for an opening brace
 * @param {string} content - Content to search
 * @param {number} startIndex - Index of opening brace
 * @returns {number} - Index of closing brace or -1 if not found
 */
function findMatchingBrace(content, startIndex) {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const prevChar = i > 0 ? content[i - 1] : '';
    
    // Handle string literals
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  
  return -1;
}

/**
 * Extract and parse a static class field to a JavaScript object
 * @param {string} content - File content to search in
 * @param {string} fieldName - Static field name (e.g., 'constructorInterface')
 * @returns {object|null} - Parsed object or null if not found/invalid
 */
function extractStaticField(content, fieldName) {
  // Find the start of the static field
  const regex = new RegExp(`static\\s+${fieldName}\\s*=\\s*{`);
  const match = content.match(regex);
  
  if (!match) {
    return null;
  }
  
  // Find where the opening brace is
  const startIndex = content.indexOf(match[0]) + match[0].length - 1;
  const endIndex = findMatchingBrace(content, startIndex);
  
  if (endIndex === -1) {
    return null;
  }
  
  // Extract the full object including braces
  const objectStr = content.substring(startIndex, endIndex + 1);
  
  try {
    // Clean up TypeScript-specific syntax for JSON parsing
    let cleanStr = objectStr
      // Remove single-line comments
      .replace(/\/\/.*$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//gm, '')
      // Handle trailing commas
      .replace(/,(\s*[}\]])/g, '$1');
    
    // Use Function to evaluate as JavaScript (handles unquoted keys, etc.)
    const result = Function(`"use strict"; return (${cleanStr});`)();
    return result;
  } catch (error) {
    console.warn(`Non-critical error parsing ${fieldName}: ${error.message}`);
    return {};
  }
}

// Utility to extract TypeScript type information from source files
function extractTypeInfo(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract description
    let description = '';
    const descriptionMatch = content.match(/static\s+description\s*=\s*(['"])(.*?)\1/);
    if (descriptionMatch && descriptionMatch[2]) {
      description = descriptionMatch[2];
    } else {
      // Try to find JSDoc description as fallback
      const jsdocMatch = content.match(/\/\*\*[\s\S]*?\*\/\s*export\s+class/);
      if (jsdocMatch) {
        const jsdocText = jsdocMatch[0];
        const jsdocDescMatch = jsdocText.match(/@description\s+(.*?)(?:\r?\n|\*\/)/);
        if (jsdocDescMatch && jsdocDescMatch[1]) {
          description = jsdocDescMatch[1].trim();
        }
      }
    }
    
    // Extract requiresPlatform (for platform-specific sources like Discord, Telegram)
    let requiresPlatform = null;
    const requiresPlatformMatch = content.match(/static\s+requiresPlatform\s*=\s*(['"])(.*?)\1/);
    if (requiresPlatformMatch && requiresPlatformMatch[2]) {
      requiresPlatform = requiresPlatformMatch[2];
    }
    
    // Extract hidden flag (for deprecated/hidden plugins)
    let hidden = false;
    const hiddenMatch = content.match(/static\s+hidden\s*=\s*(true|false)/);
    if (hiddenMatch && hiddenMatch[1] === 'true') {
      hidden = true;
    }
    
    // Process constructor interface
    let constructorInterface = extractStaticField(content, 'constructorInterface');
    if (constructorInterface) {
      constructorInterface = {
        parameters: constructorInterface.parameters || []
      };
    }
    
    // Process config schema
    const configSchema = extractStaticField(content, 'configSchema') || {};
    
    return { 
      constructorInterface, 
      configSchema, 
      description,
      requiresPlatform,
      hidden
    };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    // Return empty defaults for graceful handling
    return { 
      constructorInterface: null, 
      configSchema: {}, 
      description: '',
      requiresPlatform: null,
      hidden: false
    };
  }
}

async function buildPluginsJson() {
  console.log('Building static plugins.json file...');
  
  const plugins = {};
  const projectRoot = path.join(__dirname, '..');
  
  // Process each plugin type
  for (const [type, dirPath] of Object.entries(PLUGINS_DIRS)) {
    const fullPath = path.join(projectRoot, dirPath);
    plugins[type] = [];
    
    // Check if directory exists
    if (!fs.existsSync(fullPath)) {
      console.warn(`Warning: Plugin directory not found: ${fullPath}`);
      continue;
    }
    
    // Find all TypeScript files (not .d.ts files)
    const files = globSync('**/*.ts', { 
      cwd: fullPath, 
      ignore: ['**/*.d.ts', '**/*.test.ts'] 
    });
    
    // Process each file
    for (const file of files) {
      const filePath = path.join(fullPath, file);
      const { constructorInterface, configSchema, description, requiresPlatform, hidden } = extractTypeInfo(filePath);
      
      // Create plugin info object
      const pluginName = path.basename(file, '.ts');
      const pluginInfo = {
        name: pluginName,
        pluginName: pluginName,
        type: type,
        description: description,
        configSchema: configSchema || {},
        constructorInterface: constructorInterface
      };
      
      // Only add requiresPlatform if it's defined (for platform-specific sources)
      if (requiresPlatform) {
        pluginInfo.requiresPlatform = requiresPlatform;
      }
      
      // Only add hidden if true (for deprecated/hidden plugins)
      if (hidden) {
        pluginInfo.hidden = true;
      }
      
      plugins[type].push(pluginInfo);
    }
    
    console.log(`Found ${plugins[type].length} ${type} plugins`);
  }
  
  // Create the output directory if it doesn't exist
  const outputDir = path.dirname(PLUGINS_OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write the plugins.json file
  fs.writeFileSync(PLUGINS_OUTPUT_PATH, JSON.stringify(plugins, null, 2));
  console.log(`Static plugins file generated at: ${PLUGINS_OUTPUT_PATH}`);
}

// Run the build process
buildPluginsJson().catch(error => {
  console.error('Error building plugins file:', error);
  process.exit(1);
}); 