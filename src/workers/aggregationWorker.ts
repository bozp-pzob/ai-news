// src/workers/aggregationWorker.ts

import { Worker, Job } from 'bullmq';
import { QUEUES, AggregationJobData, getRedisConnection } from '../services/queueService';
import { ContentAggregator } from '../aggregator/ContentAggregator';
import { HistoricalAggregator } from '../aggregator/HistoricalAggregator';
import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from '../helpers/configHelper';
import { runGeneratorsForDate, runExportersForDate } from '../helpers/generatorHelper';
import { jobService } from '../services/jobService';
import { userService } from '../services/userService';
import { licenseService } from '../services/licenseService';
import { AiProvider, AiUsageStats, GeneratorPlugin, ExporterPlugin, GeneratorInstanceConfig, ExporterInstanceConfig } from '../types';
import { logger } from '../helpers/cliHelper';

/**
 * Collect AI usage stats from all AI provider instances and reset counters.
 */
function collectAndResetAiUsage(aiConfigs: any[]): AiUsageStats {
  const totals: AiUsageStats = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCalls: 0,
    estimatedCostUsd: 0,
  };

  for (const aiConfig of aiConfigs) {
    const provider = aiConfig.instance as AiProvider;
    if (provider.getUsageStats && provider.resetUsageStats) {
      const stats = provider.getUsageStats();
      totals.totalPromptTokens += stats.totalPromptTokens;
      totals.totalCompletionTokens += stats.totalCompletionTokens;
      totals.totalTokens += stats.totalTokens;
      totals.totalCalls += stats.totalCalls;
      totals.estimatedCostUsd += stats.estimatedCostUsd;
      provider.resetUsageStats();
    }
  }

  return totals;
}

/**
 * Separate generator configs into GeneratorPlugin and ExporterPlugin instances.
 */
function separatePlugins(configs: any[]): { generators: GeneratorInstanceConfig[]; exporters: ExporterInstanceConfig[] } {
  const generators: GeneratorInstanceConfig[] = [];
  const exporters: ExporterInstanceConfig[] = [];

  for (const config of configs) {
    if (typeof config.instance.generate === 'function') {
      generators.push({
        instance: config.instance as GeneratorPlugin,
        interval: config.interval,
        dependsOn: config.dependsOn,
      });
    } else if (typeof config.instance.export === 'function') {
      exporters.push({
        instance: config.instance as ExporterPlugin,
        interval: config.interval,
      });
    } else {
      logger.warn(`AggregationWorker: Plugin "${config.instance.name}" does not implement GeneratorPlugin or ExporterPlugin, skipping.`);
    }
  }

  return { generators, exporters };
}

/**
 * Resolve the config JSON and secrets for a job.
 * Handles platform credential injection (AI, storage).
 */
async function resolveConfigAndSecrets(
  configId: string,
  userId: string,
  configRecord: any,
  user?: { tier: string } | null,
): Promise<{ configJson: any; secrets: Record<string, string> }> {
  const secrets = await userService.getConfigSecrets(configId) || {};
  let configJson = configRecord.configJson as any;

  // Use provided user to avoid redundant DB lookup
  const resolvedUser = user ?? await userService.getUserById(userId);
  const isAdmin = resolvedUser?.tier === 'admin';

  // Inject platform AI credentials
  const usesPlatformAI = configJson.ai?.some((ai: any) => ai.params?.usePlatformAI === true);
  if (isAdmin || usesPlatformAI) {
    const model = process.env.PRO_TIER_AI_MODEL || 'openai/gpt-4o';
    const platformApiKey = process.env.OPENAI_API_KEY;
    const siteUrl = process.env.SITE_URL || '';
    const siteName = process.env.SITE_NAME || '';

    configJson.ai = configJson.ai?.map((ai: any) => {
      if (ai.params?.usePlatformAI || isAdmin) {
        return {
          ...ai,
          params: {
            ...ai.params,
            model,
            apiKey: platformApiKey,
            useOpenRouter: true,
            siteUrl,
            siteName,
          }
        };
      }
      return ai;
    }) || [];
  }

  // Inject platform storage credentials.
  // SQLiteStorage is always converted to PostgresStorage in platform mode — SQLite has no place
  // on a multi-tenant server.
  const usesPlatformStorage = configJson.storage?.some((s: any) => s.params?.usePlatformStorage === true);
  const hasSqliteStorage = configJson.storage?.some((s: any) => s.type === 'SQLiteStorage');
  if (configRecord.storageType === 'platform' || isAdmin || usesPlatformStorage || hasSqliteStorage) {
    const platformDbUrl = process.env.DATABASE_URL;
    configJson.storage = configJson.storage?.map((storage: any) => {
      if (storage.type === 'SQLiteStorage') {
        return {
          ...storage,
          type: 'PostgresStorage',
          params: {
            ...storage.params,
            configId,
            connectionString: platformDbUrl,
          }
        };
      }
      if (storage.params?.usePlatformStorage || configRecord.storageType === 'platform' || isAdmin) {
        return {
          ...storage,
          params: {
            ...storage.params,
            configId,
            connectionString: platformDbUrl,
          }
        };
      }
      return storage;
    }) || [];
  }

  return { configJson, secrets };
}

/**
 * Process an aggregation job.
 * This mirrors the logic in AggregatorService.runAggregationProcess but runs
 * inside a BullMQ worker, providing proper progress tracking and isolation.
 *
 * Supports:
 * - 'manual' / 'scheduled' / 'historical' — creates a new DB job per run
 * - 'continuous-tick' — records ticks against a parent continuous DB job
 */
async function processAggregationJob(job: Job<AggregationJobData>): Promise<{
  success: boolean;
  itemsProcessed: number;
  duration: number;
  aiUsage: AiUsageStats;
}> {
  const startTime = Date.now();
  const { configId, userId, runType, options, continuousJobId } = job.data;
  const isContinuousTick = runType === 'continuous-tick';
  let totalItemsFetched = 0;

  logger.info(`AggregationWorker: Starting ${runType} aggregation for config ${configId}`);

  // For continuous ticks, use the parent job ID. Otherwise, create a new DB job.
  let dbJobId: string;
  if (isContinuousTick && continuousJobId) {
    dbJobId = continuousJobId;
  } else {
    dbJobId = await jobService.createJob({
      configId,
      userId,
      jobType: 'one-time',
    });
  }

  try {
    await job.updateProgress(5);
    if (!isContinuousTick) {
      await jobService.addJobLog(dbJobId, 'info', `BullMQ worker processing ${runType} aggregation`);
    }

    // 1. Load config from database
    const configRecord = await userService.getConfigById(configId);
    if (!configRecord) {
      throw new Error(`Config ${configId} not found`);
    }

    // 2. Fetch user once (shared across license check + credential resolution)
    const user = await userService.getUserById(userId);

    // 3. Validate user still has appropriate access (scheduled + continuous require pro)
    if (runType === 'scheduled' || isContinuousTick) {
      if (!user) throw new Error(`User ${userId} not found`);

      if (user.tier !== 'admin' && user.tier !== 'paid') {
        if (user.walletAddress) {
          const license = await licenseService.verifyLicense(user.walletAddress);
          if (!license.isActive) {
            if (isContinuousTick && continuousJobId) {
              // Stop the continuous job entirely when license expires
              const { cancelContinuousAggregation } = await import('../services/queueService');
              await cancelContinuousAggregation(configId);
              await jobService.cancelJob(continuousJobId);
              await jobService.addJobLog(continuousJobId, 'warn', 'Continuous job stopped - Pro license expired');
            }
            throw new Error('Pro license expired - aggregation cancelled');
          }
        } else {
          throw new Error('No active pro license for aggregation');
        }
      }
    }

    await job.updateProgress(10);

    // 4. Resolve config JSON and secrets (inject platform credentials)
    const { configJson, secrets } = await resolveConfigAndSecrets(configId, userId, configRecord, user);

    await userService.updateConfigRunStatus(configId, 'running');
    await jobService.addJobLog(dbJobId, 'info', 'Loading plugin modules...');

    // 5. Load all plugin modules
    const sourceClasses = await loadDirectoryModules('sources');
    const aiClasses = await loadDirectoryModules('ai');
    const enricherClasses = await loadDirectoryModules('enrichers');
    const generatorClasses = await loadDirectoryModules('generators');
    const storageClasses = await loadDirectoryModules('storage');

    await job.updateProgress(15);

    // 6. Instantiate plugins
    let aiConfigs = await loadItems(configJson.ai, aiClasses, 'ai', secrets);
    let sourceConfigs = await loadItems(configJson.sources, sourceClasses, 'source', secrets);
    let enricherConfigs = await loadItems(configJson.enrichers, enricherClasses, 'enrichers', secrets);
    let generatorConfigs = await loadItems(configJson.generators, generatorClasses, 'generators', secrets);
    let storageConfigs = await loadItems(configJson.storage, storageClasses, 'storage', secrets);

    // Wire up dependencies
    sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
    sourceConfigs = await loadStorage(sourceConfigs, storageConfigs);
    enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
    generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
    generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);

    await job.updateProgress(20);

    // 7. Check if running historical mode
    const isHistoricalMode = options?.historicalDate !== undefined;
    const settings = {
      runOnce: true,
      onlyFetch: options?.onlyFetch ?? false,
      onlyGenerate: options?.onlyGenerate ?? false,
    };

    if (isHistoricalMode) {
      // --- Historical aggregation ---
      await jobService.addJobLog(dbJobId, 'info', `Running historical aggregation for ${options!.historicalDate}`);

      const aggregator = new HistoricalAggregator();
      sourceConfigs.forEach((config) => {
        if (config.instance?.fetchHistorical) {
          aggregator.registerSource(config.instance);
        }
      });
      enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
      for (const storage of storageConfigs) {
        await storage.instance.init();
        aggregator.registerStorage(storage.instance);
      }

      // Fetch
      if (!settings.onlyGenerate) {
        await job.updateProgress(30);
        for (const sourceConfig of sourceConfigs) {
          if (sourceConfig.instance?.fetchHistorical) {
            try {
              const items = await aggregator.fetchSource(sourceConfig.instance.name, options!.historicalDate!);
              await aggregator.saveItems(items, sourceConfig.instance.name);
              totalItemsFetched += items.length;
            } catch (sourceErr) {
              logger.error(`AggregationWorker: Error fetching/storing historical data from ${sourceConfig.instance.name}`, sourceErr);
            }
          }
        }
      }

      await job.updateProgress(60);

      // Generate
      if (!settings.onlyFetch) {
        for (const gen of generatorConfigs) {
          if (gen.instance.storage?.init) {
            await gen.instance.storage.init();
          }
        }

        const { generators: genInstances, exporters: expInstances } = separatePlugins(generatorConfigs);
        const primaryStorage = storageConfigs[0]?.instance;

        if (genInstances.length > 0 && primaryStorage) {
          await runGeneratorsForDate(options!.historicalDate!, {
            generators: genInstances,
            storage: primaryStorage,
          });
        }

        if (expInstances.length > 0) {
          await runExportersForDate(options!.historicalDate!, { exporters: expInstances });
        }
      }

      await job.updateProgress(90);

    } else {
      // --- Standard one-time aggregation ---
      const aggregator = new ContentAggregator();
      sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));
      enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));

      for (const storage of storageConfigs) {
        await storage.instance.init();
        aggregator.registerStorage(storage.instance);
      }

      // Fetch from all sources
      if (!settings.onlyGenerate) {
        await jobService.addJobLog(dbJobId, 'info', 'Fetching from sources...');
        const sourceCount = sourceConfigs.length;

        for (let i = 0; i < sourceConfigs.length; i++) {
          const sourceConfig = sourceConfigs[i];
          await aggregator.fetchAndStore(sourceConfig.instance.name);

          // Progress: 20-60% for fetching
          const fetchProgress = 20 + Math.round(((i + 1) / sourceCount) * 40);
          await job.updateProgress(fetchProgress);
        }

        totalItemsFetched = aggregator.getStatus().stats?.totalItemsFetched || 0;
        await jobService.addJobLog(dbJobId, 'info', `Fetched ${totalItemsFetched} items`);
      }

      // Generate summaries
      if (!settings.onlyFetch) {
        await jobService.addJobLog(dbJobId, 'info', 'Generating summaries...');
        await job.updateProgress(65);

        const { generators: genInstances, exporters: expInstances } = separatePlugins(generatorConfigs);
        const primaryStorage = storageConfigs[0]?.instance;

        if (genInstances.length > 0 && primaryStorage) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);

          await runGeneratorsForDate(dateStr, {
            generators: genInstances,
            storage: primaryStorage,
          });
        }

        await job.updateProgress(85);

        // Run exporters
        if (expInstances.length > 0) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);
          await runExportersForDate(dateStr, { exporters: expInstances });
        }
      }

      await job.updateProgress(90);
    }

    // 8. Clean up plugin resources (storage connections, etc.)
    for (const storage of storageConfigs) {
      try {
        if (typeof storage.instance.close === 'function') {
          await storage.instance.close();
        }
      } catch (cleanupErr) {
        logger.warn(`AggregationWorker: Error closing storage plugin ${storage.instance?.name}`, cleanupErr);
      }
    }

    // 9. Collect AI usage
    const aiUsage = collectAndResetAiUsage(aiConfigs);
    const duration = Date.now() - startTime;

    // 10. Update DB job record
    if (isContinuousTick && continuousJobId) {
      // Record a tick against the parent continuous job
      await jobService.recordContinuousTick(continuousJobId, {
        itemsFetched: totalItemsFetched,
        itemsProcessed: totalItemsFetched,
        promptTokens: aiUsage.totalPromptTokens,
        completionTokens: aiUsage.totalCompletionTokens,
        aiCalls: aiUsage.totalCalls,
        estimatedCostUsd: aiUsage.estimatedCostUsd,
      });
    } else {
      // Complete the one-time DB job
      await jobService.updateJobProgress(dbJobId, {
        itemsFetched: totalItemsFetched,
        itemsProcessed: totalItemsFetched,
        promptTokens: aiUsage.totalPromptTokens,
        completionTokens: aiUsage.totalCompletionTokens,
        aiCalls: aiUsage.totalCalls,
        estimatedCostUsd: aiUsage.estimatedCostUsd,
      });
      await jobService.completeJob(dbJobId);
      await jobService.addJobLog(
        dbJobId,
        'info',
        `Aggregation completed in ${duration}ms. Fetched ${totalItemsFetched} items. AI: ${aiUsage.totalCalls} calls, $${aiUsage.estimatedCostUsd.toFixed(4)} estimated cost.`
      );
      await userService.incrementRunCount(configId);
    }

    // Update config status
    await userService.updateConfigRunStatus(configId, 'idle', duration);

    await job.updateProgress(100);

    logger.info(`AggregationWorker: Completed ${runType} aggregation for config ${configId} in ${duration}ms (${totalItemsFetched} items)`);

    return {
      success: true,
      itemsProcessed: totalItemsFetched,
      duration,
      aiUsage,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`AggregationWorker: Error processing config ${configId}`, error);

    // Update DB records — for continuous ticks, log the error but don't fail the parent job
    // (the next tick will retry)
    if (isContinuousTick && continuousJobId) {
      await jobService.addJobLog(continuousJobId, 'error', `Tick failed: ${errorMessage}`);
    } else {
      await jobService.failJob(dbJobId, errorMessage);
      await jobService.addJobLog(dbJobId, 'error', errorMessage);
    }
    await userService.updateConfigRunStatus(configId, 'error', undefined, errorMessage);

    throw error;
  }
}

/**
 * Worker instance
 */
let worker: Worker<AggregationJobData> | null = null;

/**
 * Start the aggregation worker
 */
export async function startAggregationWorker(): Promise<void> {
  const connection = getRedisConnection();

  worker = new Worker<AggregationJobData>(
    QUEUES.AGGREGATION,
    processAggregationJob,
    {
      connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
      limiter: {
        max: 10,
        duration: 60000, // Max 10 jobs per minute
      },
    }
  );

  worker.on('completed', (job, result) => {
    logger.info(`AggregationWorker: Job ${job.id} completed in ${result.duration}ms`);
  });

  worker.on('failed', (job, error) => {
    logger.error(`AggregationWorker: Job ${job?.id} failed: ${error.message}`);
  });

  worker.on('error', (error) => {
    logger.error('AggregationWorker: Worker error', error);
  });

  logger.info('AggregationWorker: Started');
}

/**
 * Stop the aggregation worker
 */
export async function stopAggregationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('AggregationWorker: Stopped');
  }
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  running: boolean;
  concurrency: number;
} {
  return {
    running: worker !== null,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
  };
}

/**
 * Check if the worker is running (queues are initialized)
 */
export function isWorkerAvailable(): boolean {
  return worker !== null;
}

export const aggregationWorker = {
  start: startAggregationWorker,
  stop: stopAggregationWorker,
  getStatus: getWorkerStatus,
  isAvailable: isWorkerAvailable,
};
