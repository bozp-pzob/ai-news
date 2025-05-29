/**
 * Configuration helper utilities for the AI News Aggregator.
 * This module provides functions for loading and configuring plugins and components.
 * 
 * @module helpers
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ConfigItem, InstanceConfig } from "../types";
import { logger } from "./cliHelper"; // Import logger

dotenv.config();

/**
 * Loads all TypeScript modules from a specified directory.
 * 
 * This function:
 * 1. Scans a directory for TypeScript files
 * 2. Imports each file as a module
 * 3. Returns a mapping of class names to their implementations
 * 
 * @param directory - The directory to load modules from (relative to plugins directory)
 * @returns A promise that resolves to a record of class names to their implementations
 */
export const loadDirectoryModules = async (directory : string): Promise<Record<string, any>> => {
  const classes: Record<string, any> = {};
  const dir = path.join(__dirname, "../", "plugins", directory);
  
  // Check if directory exists before reading
  if (!fs.existsSync(dir)) {
    logger.warning(`Plugin directory not found: ${dir}. Skipping module loading for this directory.`);
    return classes;
  }

  const files = fs.readdirSync(dir).filter(file => file.endsWith(".ts"));
  
  for (const file of files) {
    const modulePath = path.join(dir, file);
    try {
        const moduleExports = await import(modulePath);
        const className = file.replace(".ts", "");
        classes[className] = moduleExports.default || moduleExports[className];
    } catch (importError: any) {
         logger.error(`Failed to import module ${modulePath}: ${importError.message}`);
    }
  }
  
  return classes;
};

/**
 * Creates instances of components based on configuration items.
 * 
 * @param items - Configuration items to instantiate
 * @param mapping - Mapping of component types to their class implementations
 * @param category - Category of components being instantiated (for error messages)
 * @returns A promise that resolves to an array of component instances with optional intervals
 * @throws Error if a component type is unknown
 */
export const loadItems = async (items: ConfigItem[], mapping: Record<string, any>, category: string): Promise<InstanceConfig[]> => {
  if (!items) return []; // Handle case where config section is missing
  return items.map((item) => {
    const { type, name, params, interval } = item;
    const ClassRef = mapping[type];
    if (!ClassRef) {
      // Log warning instead of throwing error immediately, allows validation later
      logger.error(`[Config Load] Unknown ${category} type specified in config: ${type} (Name: ${name}). Instance will not be created.`);
      // Return a placeholder or null to filter out later?
      // For now, let's throw to maintain original behavior, but validation should handle this case.
      throw new Error(`Unknown ${category} type: ${type}`); 
    }
    try {
        const resolvedParams = Object.entries(params || {}).reduce((acc, [key, value]) => {
          acc[key] = typeof value === "string" ? resolveParam(value) : value;
          return acc;
        }, {} as Record<string, any>);

        // Pass the configured name to the constructor if the class expects it
        const instance = new ClassRef({ name, ...resolvedParams });
        
        // Store the original config name on the instance if not already present
        if (!instance.name) {
            instance.name = name; 
        }
        
        return interval !== undefined ? { instance, interval } : { instance };
    } catch (instantiationError: any) {
         logger.error(`[Config Load] Error instantiating ${category} '${name}' (Type: ${type}): ${instantiationError.message}`);
         // Propagate error or return null/skip?
         throw instantiationError; 
    }
  });
}

/**
 * Injects AI providers into components that require them.
 */
export const loadProviders = async (instances: InstanceConfig[], providers: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    const requiredProviderName = instance.provider; // Provider name often stored directly
    if (requiredProviderName && typeof requiredProviderName === 'string') {
      const chosenProvider = providers.find((providerConfig : InstanceConfig) => {
        return providerConfig.instance.name === requiredProviderName;
      });

      if (!chosenProvider) {
        logger.warning(`[Config Injection] Component '${instance.name}' requires provider '${requiredProviderName}', but it was not found. Provider will not be injected.`);
      } else {
        instance.provider = chosenProvider.instance; // Overwrite name string with instance
        logger.info(`[Config Injection] Injected provider '${requiredProviderName}' into component '${instance.name}'.`);
      }
    }
  });
  return instances;
}

export const loadParsers = async (instances: InstanceConfig[], parsers: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("parser" in instance && instance.parser) {
      const chosenParser = parsers.find((parser : any) => {
        return parser.instance.name === instance.parser
      });

      if ( ! chosenParser ) {
        throw(`Error: Invalid Parser Name ${instance.parser}`);
      }
      else {
        instance.parser = chosenParser.instance;
      }
    }
  });

  return instances;
}

/**
 * Injects storage plugins into components that require them.
 */
export const loadStorage = async (instances: InstanceConfig[], storages: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    const requiredStorageName = instance.storage; // Storage name often stored directly
    if (requiredStorageName && typeof requiredStorageName === 'string') {
      const chosenStorage = storages.find((storageConfig : InstanceConfig) => {
        return storageConfig.instance.name === requiredStorageName;
      });

      if (!chosenStorage) {
        logger.warning(`[Config Injection] Component '${instance.name}' requires storage '${requiredStorageName}', but it was not found. Storage will not be injected.`);
      } else {
        instance.storage = chosenStorage.instance; // Overwrite name string with instance
        logger.info(`[Config Injection] Injected storage '${requiredStorageName}' into component '${instance.name}'.`);
      }
    }
  });
  return instances;
}

/**
 * Resolves parameter values, including environment variables.
 */
export const resolveParam = (value: string): any => { // Ensure input is string
  if (value.startsWith("process.env.")) {
    const envVar = value.replace("process.env.", "");
    return process.env[envVar]; // Return undefined if not found
  }
  return value;
};

/**
 * Validates the loaded configuration instances for cross-references.
 */
export const validateConfiguration = (configs: {
  sources: InstanceConfig[];
  ai: InstanceConfig[];
  enrichers: InstanceConfig[];
  generators: InstanceConfig[];
  storage: InstanceConfig[];
}): void => {
  logger.info("Validating configuration dependencies...");
  let validationIssues = 0;

  // Create sets of the ACTUAL INSTANCE names
  const validAiNames = new Set(configs.ai.map(c => c.instance.name));
  const validStorageNames = new Set(configs.storage.map(c => c.instance.name));
  const validSourceNames = new Set(configs.sources.map(c => c.instance.name));
  // Assuming enrichers also have a .name property
  // const validEnricherNames = new Set(configs.enrichers.map(c => c.instance.name)); 

  // Helper to check dependencies stored in instance.params
  const checkParamDependency = (instance: any, paramName: string, depType: string, validNames: Set<string>) => {
    const instanceName = instance.name || instance.constructor?.name || 'UnnamedInstance';
    const requiredDepName = instance.params?.[paramName]; // Get the name from PARAMS

    if (requiredDepName) { // Check if the parameter exists
        if (typeof requiredDepName === 'string') {
            if (!validNames.has(requiredDepName)) {
                 logger.warning(`[Config Validation] ${instance.constructor?.name} '${instanceName}' requires ${depType} '${requiredDepName}' (from params.${paramName}), but it was not found.`);
                 validationIssues++;
            }
         } else {
            // Log if the parameter value isn't a string (it should be before injection)
            logger.warning(`[Config Validation] ${instance.constructor?.name} '${instanceName}' has an invalid non-string 'params.${paramName}' parameter: ${requiredDepName}`);
            validationIssues++;
         }
    } 
    // Else: Parameter not specified, assume optional or handled elsewhere
  };

  // Validate Enrichers (Example assumes provider is in params)
  configs.enrichers.forEach(({ instance }) => {
    checkParamDependency(instance, 'provider', 'provider', validAiNames);
  });

  // Validate Generators
  configs.generators.forEach(({ instance }) => {
    checkParamDependency(instance, 'provider', 'provider', validAiNames);
    checkParamDependency(instance, 'storage', 'storage', validStorageNames);
    checkParamDependency(instance, 'source', 'source', validSourceNames);
    // If we add enricher injection back:
    // checkParamDependency(instance, 'enricher', 'enricher', validEnricherNames);
  });

  // Validate Sources 
  configs.sources.forEach(({ instance }) => {
    // Note: DiscordRawDataSource constructor takes params differently,
    // injection logic puts instances directly on properties like instance.storage,
    // NOT instance.params.storage. Validation needs refinement if we want 
    // to deeply check injected properties vs params across all plugin types.
    // For now, we focus on params which is safer before injection occurs elsewhere.
    checkParamDependency(instance, 'provider', 'provider', validAiNames);
    checkParamDependency(instance, 'storage', 'storage', validStorageNames);
  });

  if (validationIssues === 0) {
    logger.success("Configuration validation passed.");
  } else {
    logger.warning(`Configuration validation completed with ${validationIssues} potential issues.`);
  }
}; 