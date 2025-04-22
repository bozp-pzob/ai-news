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
  
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".ts"));
  
  for (const file of files) {
    const modulePath = path.join(dir, file);
    const moduleExports = await import(modulePath);
    const className = file.replace(".ts", "");

    classes[className] = moduleExports.default || moduleExports[className];
  }
  
  return classes;
};

/**
 * Creates instances of components based on configuration items.
 * 
 * This function:
 * 1. Maps configuration items to their corresponding class implementations
 * 2. Resolves parameter values (including environment variables)
 * 3. Creates instances with the resolved parameters
 * 
 * @param items - Configuration items to instantiate
 * @param mapping - Mapping of component types to their class implementations
 * @param category - Category of components being instantiated (for error messages)
 * @returns A promise that resolves to an array of component instances with optional intervals
 * @throws Error if a component type is unknown
 */
export const loadItems = async (items: ConfigItem[], mapping: Record<string, any>, category: string): Promise<InstanceConfig[]> => {
  return items.map((item) => {
    const { type, name, params, interval } = item;
    const ClassRef = mapping[type];
    if (!ClassRef) {
      throw new Error(`Unknown ${category} type: ${type}`);
    }
    const resolvedParams = Object.entries(params).reduce((acc, [key, value]) => {
      acc[key] = typeof value === "string" ? resolveParam(value) : value;
      return acc;
    }, {} as Record<string, any>);

    const instance = new ClassRef({ name, ...resolvedParams });
    
    return interval !== undefined ? { instance, interval } : { instance };
  });
}

/**
 * Injects AI providers into components that require them.
 * 
 * This function:
 * 1. Identifies components that require an AI provider
 * 2. Finds the specified provider in the available providers
 * 3. Injects the provider instance into the component
 * 
 * @param instances - Component instances that may require providers
 * @param providers - Available AI provider instances
 * @returns A promise that resolves to the component instances with injected providers
 * @throws Error if a specified provider is not found
 */
export const loadProviders = async (instances: InstanceConfig[], providers: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("provider" in instance && instance.provider) {
      const chosenProvider = providers.find((provider : any) => {
        return provider.instance.name === instance.provider
      });

      if ( ! chosenProvider ) {
        throw(`Error: Invalid Provider Name ${instance.provider}`);
      }
      else {
        instance.provider = chosenProvider.instance;
      }
    }
  });

  return instances;
}

/**
 * Injects storage plugins into components that require them.
 * 
 * This function:
 * 1. Identifies components that require a storage plugin
 * 2. Finds the specified storage plugin in the available plugins
 * 3. Injects the storage plugin instance into the component
 * 
 * @param instances - Component instances that may require storage
 * @param storages - Available storage plugin instances
 * @returns A promise that resolves to the component instances with injected storage plugins
 * @throws Error if a specified storage plugin is not found
 */
export const loadStorage = async (instances: InstanceConfig[], storages: InstanceConfig[]): Promise<InstanceConfig[]> => {
  instances.forEach(({ instance }) => {
    if ("storage" in instance && instance.storage) {
      const chosenStorage = storages.find((storage : any) => {
        return storage.instance.name === instance.storage
      });

      if ( ! chosenStorage ) {
        throw(`Error: Invalid Storage Name ${instance.storage}`);
      }
      else {
        instance.storage = chosenStorage.instance;
      }
    }
  });

  return instances;
}

/**
 * Resolves parameter values, including environment variables.
 * 
 * This function:
 * 1. Checks if a value references an environment variable
 * 2. If so, retrieves the value from the environment
 * 3. Otherwise, returns the original value
 * 
 * @param value - The parameter value to resolve
 * @returns The resolved value (environment variable or original value)
 */
export const resolveParam = (value: String): any => {
  if (value.startsWith("process.env.")) {
    const envVar = value.replace("process.env.", "");
    return process.env[envVar] || "";
  }
  return value;
};

/**
 * Validates the loaded configuration instances for cross-references.
 * Checks if specified providers, storage, and sources actually exist.
 * 
 * @param configs - An object containing arrays of all loaded instance configurations.
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

  const validAiNames = new Set(configs.ai.map(c => c.instance.name));
  const validStorageNames = new Set(configs.storage.map(c => c.instance.name));
  const validSourceNames = new Set(configs.sources.map(c => c.instance.name));

  // Validate Enrichers
  configs.enrichers.forEach(({ instance }) => {
    const name = instance.name || instance.constructor.name;
    if (instance.params?.provider && !validAiNames.has(instance.params.provider)) {
      logger.warning(`[Config Validation] Enricher '${name}' requires provider '${instance.params.provider}', but it was not found in AI configurations.`);
      validationIssues++;
    }
     // Enrichers might optionally use storage, add check if needed
  });

  // Validate Generators
  configs.generators.forEach(({ instance }) => {
    const name = instance.name || instance.constructor.name;
    if (instance.params?.provider && !validAiNames.has(instance.params.provider)) {
      logger.warning(`[Config Validation] Generator '${name}' requires provider '${instance.params.provider}', but it was not found in AI configurations.`);
      validationIssues++;
    }
    if (instance.params?.storage && !validStorageNames.has(instance.params.storage)) {
      logger.warning(`[Config Validation] Generator '${name}' requires storage '${instance.params.storage}', but it was not found in Storage configurations.`);
      validationIssues++;
    }
    if (instance.params?.source && !validSourceNames.has(instance.params.source)) {
      logger.warning(`[Config Validation] Generator '${name}' requires source '${instance.params.source}', but it was not found in Source configurations.`);
      validationIssues++;
    }
  });

  // Validate Sources (they might use providers or storage)
  configs.sources.forEach(({ instance }) => {
    const name = instance.name || instance.constructor.name;
    if (instance.params?.provider && !validAiNames.has(instance.params.provider)) {
      logger.warning(`[Config Validation] Source '${name}' requires provider '${instance.params.provider}', but it was not found in AI configurations.`);
      validationIssues++;
    }
    if (instance.params?.storage && !validStorageNames.has(instance.params.storage)) {
      logger.warning(`[Config Validation] Source '${name}' requires storage '${instance.params.storage}', but it was not found in Storage configurations.`);
      validationIssues++;
    }
  });

  if (validationIssues === 0) {
    logger.success("Configuration validation passed.");
  } else {
    logger.warning(`Configuration validation completed with ${validationIssues} potential issues.`);
  }
};