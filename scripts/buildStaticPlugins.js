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
const glob = require('glob');

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
 * Extract and parse a static class field to a JavaScript object
 * @param {string} content - File content to search in
 * @param {string} fieldName - Static field name (e.g., 'constructorInterface')
 * @returns {object|null} - Parsed object or null if not found/invalid
 */
function extractStaticField(content, fieldName) {
  // Match the static field with more flexible pattern: static {fieldName} = { ... };
  // This handles various formatting scenarios including multi-line definitions
  const regex = new RegExp(`static\\s+${fieldName}\\s*=\\s*({[\\s\\S]*?});`, 'm');
  const match = content.match(regex);
  
  if (!match || !match[1]) {
    return null;
  }
  
  try {
    // Attempt to clean and parse the object definition
    let objectStr = match[1]
      // Remove single-line comments
      .replace(/\/\/.*$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//gm, '')
      // Handle string literals with proper escaping
      .replace(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g, (match) => {
        return JSON.stringify(match.slice(1, -1));
      })
      // Wrap property names in quotes if they're unquoted
      .replace(/(\b)(\w+)\s*:/g, '$1"$2":')
      // Handle trailing commas
      .replace(/,\s*([}\]])/g, '$1');
    
    // For improved handling of TypeScript syntax
    objectStr = objectStr
      .replace(/true/g, 'true')
      .replace(/false/g, 'false')
      .replace(/null/g, 'null')
      .replace(/undefined/g, 'null')
      // Replace any remaining unknown keywords with null
      .replace(/\b(default|export|import|as|from|const|let|var)\b/g, 'null');
    
    // Parse with a more resilient approach
    return Function(`"use strict"; try { return (${objectStr}); } catch(e) { return {}; }`)();
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
      description 
    };
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    // Return empty defaults for graceful handling
    return { 
      constructorInterface: null, 
      configSchema: {}, 
      description: '' 
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
    const files = glob.sync('**/*.ts', { 
      cwd: fullPath, 
      ignore: ['**/*.d.ts', '**/*.test.ts'] 
    });
    
    // Process each file
    for (const file of files) {
      const filePath = path.join(fullPath, file);
      const { constructorInterface, configSchema, description } = extractTypeInfo(filePath);
      
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