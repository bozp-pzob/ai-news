/**
 * @fileoverview Shared helper functions for running generators and exporters.
 *
 * Provides the shared loop that all three entry points (index.ts, historical.ts,
 * aggregatorService.ts) call instead of directly invoking generators.
 *
 * Responsibilities:
 * - Sorts generators by dependsOn (topological sort)
 * - Loops generators: budget check → generate() → save summaryItems → write fileOutputs → record usage
 * - Accumulates upstream summaries for generator chaining
 * - Runs exporters after generators
 */

import fs from "fs";
import path from "path";
import {
  GeneratorPlugin,
  GeneratorResult,
  GeneratorContext,
  GeneratorInstanceConfig,
  ExporterPlugin,
  ExporterInstanceConfig,
  ExporterResult,
  SummaryItem,
  FileOutput,
  BudgetExhaustedError,
} from "../types";
import { StoragePlugin } from "../plugins/storage/StoragePlugin";
import { logger } from "./cliHelper";

// ============================================
// Types
// ============================================

/**
 * Options for running generators on a single date.
 */
export interface RunGeneratorsOptions {
  /** Generator instances with dependency info */
  generators: GeneratorInstanceConfig[];
  /** Storage to save generated SummaryItems into */
  storage: StoragePlugin;
  /** Base output directory for file outputs (e.g., "./output/elizaos") */
  outputPath?: string;
  /** Force regeneration even if content hash is unchanged */
  force?: boolean;
  /** User ID for token budget tracking (platform mode only, requires userService) */
  userId?: string;
  /** Maximum token budget for this entire run across all generators */
  tokenBudget?: number;
  /** Callback after each generator completes (for status updates) */
  onGeneratorComplete?: (generatorName: string, result: GeneratorResult) => void | Promise<void>;
}

/**
 * Options for running exporters on a single date.
 */
export interface RunExportersOptions {
  /** Exporter instances to run */
  exporters: ExporterInstanceConfig[];
  /** Callback after each exporter completes (for status updates) */
  onExporterComplete?: (exporterName: string, result: ExporterResult) => void | Promise<void>;
}

/**
 * Result from running all generators for a date.
 */
export interface RunGeneratorsResult {
  /** All generated summary items across all generators */
  summaryItems: SummaryItem[];
  /** Total tokens used across all generators */
  totalTokensUsed: number;
  /** Total estimated cost across all generators */
  totalEstimatedCostUsd: number;
  /** Per-generator results */
  generatorResults: Map<string, GeneratorResult>;
  /** Whether any generator was skipped */
  anySkipped: boolean;
  /** Whether any generator failed */
  anyFailed: boolean;
  /** Errors from failed generators */
  errors: string[];
}

// ============================================
// Topological sort for generator dependencies
// ============================================

/**
 * Sort generators by their dependsOn field using topological sort.
 * Generators with no dependencies come first, followed by those that depend on them.
 *
 * @param generators - Generator configs with optional dependsOn
 * @returns Sorted array of generator configs
 * @throws Error if circular dependency is detected
 */
export function sortByDependsOn(generators: GeneratorInstanceConfig[]): GeneratorInstanceConfig[] {
  if (generators.length <= 1) return [...generators];

  // Build adjacency graph
  const byName = new Map<string, GeneratorInstanceConfig>();
  for (const gen of generators) {
    byName.set(gen.instance.name, gen);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>(); // For cycle detection
  const sorted: GeneratorInstanceConfig[] = [];

  function visit(gen: GeneratorInstanceConfig) {
    const name = gen.instance.name;

    if (visited.has(name)) return;

    if (visiting.has(name)) {
      throw new Error(`Circular generator dependency detected involving "${name}"`);
    }

    visiting.add(name);

    // Visit dependency first
    if (gen.dependsOn) {
      const dep = byName.get(gen.dependsOn);
      if (dep) {
        visit(dep);
      } else {
        logger.warning(`Generator "${name}" depends on "${gen.dependsOn}" which was not found in the generator list.`);
      }
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(gen);
  }

  for (const gen of generators) {
    visit(gen);
  }

  return sorted;
}

// ============================================
// Main runner functions
// ============================================

/**
 * Run all generators for a single date.
 *
 * This is the shared function that replaces direct generator.generateContent() /
 * generator.generateAndStoreSummary() calls in all entry points.
 *
 * For each generator (in dependency order):
 * 1. Build context (upstream summaries from dependencies, token budget, force flag)
 * 2. Call generator.generate(dateStr, context)
 * 3. Save returned summaryItems to storage
 * 4. Write returned fileOutputs to disk (if outputPath is set)
 * 5. Accumulate results for downstream generators
 *
 * @param dateStr - ISO date string (YYYY-MM-DD)
 * @param options - Generator configs, storage, output path, etc.
 * @returns Aggregated results from all generators
 */
export async function runGeneratorsForDate(
  dateStr: string,
  options: RunGeneratorsOptions
): Promise<RunGeneratorsResult> {
  const {
    generators,
    storage,
    outputPath,
    force = false,
    tokenBudget,
    onGeneratorComplete,
  } = options;

  // Sort generators by dependency order
  const sortedGenerators = sortByDependsOn(generators);

  // Track results per generator (for chaining and reporting)
  const generatorResults = new Map<string, GeneratorResult>();
  const allSummaryItems: SummaryItem[] = [];
  let totalTokensUsed = 0;
  let totalEstimatedCostUsd = 0;
  let anySkipped = false;
  let anyFailed = false;
  const errors: string[] = [];

  // Remaining token budget (decremented as generators consume tokens)
  let remainingBudget = tokenBudget ?? undefined;

  for (const genConfig of sortedGenerators) {
    const generator = genConfig.instance;
    const generatorName = generator.name;

    try {
      // Build context
      const context: GeneratorContext = {
        force,
      };

      // Add upstream summaries if this generator depends on another
      if (genConfig.dependsOn) {
        const upstreamResult = generatorResults.get(genConfig.dependsOn);
        if (upstreamResult?.summaryItems && upstreamResult.summaryItems.length > 0) {
          context.upstreamSummaries = upstreamResult.summaryItems;
        }
      }

      // Set token budget for this generator
      if (remainingBudget !== undefined) {
        context.tokenBudget = remainingBudget;
      }

      logger.info(`[generatorHelper] Running generator "${generatorName}" for ${dateStr}`);

      // Run the generator
      const result = await generator.generate(dateStr, context);
      generatorResults.set(generatorName, result);

      if (result.skipped) {
        logger.info(`[generatorHelper] Generator "${generatorName}" skipped for ${dateStr}`);
        anySkipped = true;
      }

      if (!result.success) {
        logger.error(`[generatorHelper] Generator "${generatorName}" failed: ${result.error}`);
        anyFailed = true;
        if (result.error) {
          errors.push(`${generatorName}: ${result.error}`);
        }
        continue;
      }

      // Save summaryItems to storage
      if (result.summaryItems && result.summaryItems.length > 0) {
        for (const summaryItem of result.summaryItems) {
          try {
            await storage.saveSummaryItem(summaryItem);
            allSummaryItems.push(summaryItem);
          } catch (saveError) {
            const msg = saveError instanceof Error ? saveError.message : String(saveError);
            logger.error(`[generatorHelper] Error saving summary from "${generatorName}": ${msg}`);
          }
        }
      }

      // Write fileOutputs to disk
      if (result.fileOutputs && result.fileOutputs.length > 0 && outputPath) {
        for (const fileOutput of result.fileOutputs) {
          try {
            writeFileOutput(outputPath, fileOutput);
          } catch (writeError) {
            const msg = writeError instanceof Error ? writeError.message : String(writeError);
            logger.error(`[generatorHelper] Error writing file from "${generatorName}": ${msg}`);
          }
        }
      }

      // Track usage
      if (result.stats) {
        totalTokensUsed += result.stats.tokensUsed;
        totalEstimatedCostUsd += result.stats.estimatedCostUsd;

        // Decrement remaining budget
        if (remainingBudget !== undefined) {
          remainingBudget = Math.max(0, remainingBudget - result.stats.tokensUsed);
          if (remainingBudget <= 0) {
            logger.warning(`[generatorHelper] Token budget exhausted after generator "${generatorName}". Remaining generators will be skipped.`);
            break;
          }
        }
      }

      // Notify caller
      if (onGeneratorComplete) {
        await onGeneratorComplete(generatorName, result);
      }

      logger.success(`[generatorHelper] Generator "${generatorName}" completed for ${dateStr} (${result.stats?.tokensUsed || 0} tokens, $${(result.stats?.estimatedCostUsd || 0).toFixed(4)})`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[generatorHelper] Unexpected error running generator "${generatorName}": ${errorMsg}`);
      anyFailed = true;
      errors.push(`${generatorName}: ${errorMsg}`);

      // Record a failed result so downstream generators know
      generatorResults.set(generatorName, {
        success: false,
        summaryItems: [],
        error: errorMsg,
      });
    }
  }

  return {
    summaryItems: allSummaryItems,
    totalTokensUsed,
    totalEstimatedCostUsd,
    generatorResults,
    anySkipped,
    anyFailed,
    errors,
  };
}

/**
 * Run all generators for a date range (one date at a time).
 *
 * Iterates over each date in the range and calls runGeneratorsForDate().
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD), inclusive
 * @param options - Same as RunGeneratorsOptions
 * @returns Aggregated results across all dates
 */
export async function runGeneratorsForRange(
  startDate: string,
  endDate: string,
  options: RunGeneratorsOptions
): Promise<RunGeneratorsResult> {
  const allSummaryItems: SummaryItem[] = [];
  const generatorResults = new Map<string, GeneratorResult>();
  let totalTokensUsed = 0;
  let totalEstimatedCostUsd = 0;
  let anySkipped = false;
  let anyFailed = false;
  const errors: string[] = [];

  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);

    logger.info(`[generatorHelper] Processing date ${dateStr}`);
    const dateResult = await runGeneratorsForDate(dateStr, options);

    allSummaryItems.push(...dateResult.summaryItems);
    totalTokensUsed += dateResult.totalTokensUsed;
    totalEstimatedCostUsd += dateResult.totalEstimatedCostUsd;
    if (dateResult.anySkipped) anySkipped = true;
    if (dateResult.anyFailed) anyFailed = true;
    errors.push(...dateResult.errors);

    // Merge per-generator results (last date's results win for each generator name)
    for (const [name, result] of dateResult.generatorResults) {
      generatorResults.set(name, result);
    }

    current.setDate(current.getDate() + 1);
  }

  return {
    summaryItems: allSummaryItems,
    totalTokensUsed,
    totalEstimatedCostUsd,
    generatorResults,
    anySkipped,
    anyFailed,
    errors,
  };
}

/**
 * Run all exporters for a single date.
 *
 * @param dateStr - ISO date string (YYYY-MM-DD)
 * @param options - Exporter configs
 * @returns Array of ExporterResults
 */
export async function runExportersForDate(
  dateStr: string,
  options: RunExportersOptions
): Promise<ExporterResult[]> {
  const results: ExporterResult[] = [];

  for (const exporterConfig of options.exporters) {
    const exporter = exporterConfig.instance;
    try {
      logger.info(`[generatorHelper] Running exporter "${exporter.name}" for ${dateStr}`);
      const result = await exporter.export(dateStr);
      results.push(result);

      if (result.success) {
        logger.success(`[generatorHelper] Exporter "${exporter.name}" wrote ${result.filesWritten} files for ${dateStr}`);
      } else {
        logger.error(`[generatorHelper] Exporter "${exporter.name}" failed: ${result.error}`);
      }

      if (options.onExporterComplete) {
        await options.onExporterComplete(exporter.name, result);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[generatorHelper] Unexpected error in exporter "${exporter.name}": ${msg}`);
      results.push({ success: false, filesWritten: 0, error: msg });
    }
  }

  return results;
}

/**
 * Run all exporters for a date range.
 *
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD), inclusive
 * @param options - Exporter configs
 * @returns Array of ExporterResults (one per exporter per date)
 */
export async function runExportersForRange(
  startDate: string,
  endDate: string,
  options: RunExportersOptions
): Promise<ExporterResult[]> {
  const allResults: ExporterResult[] = [];

  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    const dateResults = await runExportersForDate(dateStr, options);
    allResults.push(...dateResults);
    current.setDate(current.getDate() + 1);
  }

  return allResults;
}

// ============================================
// Internal helpers
// ============================================

/**
 * Write a FileOutput to disk relative to the base output path.
 *
 * FileOutput.relativePath may contain subdirectories (e.g., "json/2026-01-15.json").
 * We join it with outputPath and ensure the parent directory exists.
 */
function writeFileOutput(outputPath: string, fileOutput: FileOutput): void {
  const fullPath = path.join(outputPath, fileOutput.relativePath);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, fileOutput.content);
  logger.debug(`[generatorHelper] Wrote file: ${fullPath}`);
}
