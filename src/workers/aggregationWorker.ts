// src/workers/aggregationWorker.ts
// @ts-nocheck - BullMQ types will be available after npm install

import { Worker, Job } from 'bullmq';
import { QUEUES, AggregationJobData } from '../services/queueService';
import { databaseService } from '../services/databaseService';
import { userService } from '../services/userService';

/**
 * Redis connection options
 */
function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
  };
}

/**
 * Process an aggregation job
 */
async function processAggregationJob(job: Job<AggregationJobData>): Promise<{
  success: boolean;
  itemsProcessed: number;
  duration: number;
}> {
  const startTime = Date.now();
  const { configId, userId, runType, options } = job.data;

  console.log(`[AggregationWorker] Starting ${runType} aggregation for config ${configId}`);

  try {
    // Update job progress
    await job.updateProgress(10);

    // Get config from database
    const config = await userService.getConfigById(configId);
    if (!config) {
      throw new Error(`Config ${configId} not found`);
    }

    // Get secrets for the config
    const secrets = await userService.getConfigSecrets(configId);

    await job.updateProgress(20);

    // Update config status to running
    await userService.updateConfigRunStatus(configId, 'running');

    // Get storage for the config
    const storage = await databaseService.getStorageForConfig({
      id: configId,
      storage_type: config.storageType as 'platform' | 'external',
      external_db_url: config.externalDbUrl,
    });

    await job.updateProgress(30);

    // TODO: Dynamically load and execute the aggregation pipeline
    // For now, this is a placeholder that would integrate with ContentAggregator
    
    // The actual aggregation logic would:
    // 1. Load source plugins based on config.configJson
    // 2. Fetch content from each source
    // 3. Run enrichers (topics, images, embeddings)
    // 4. Store results in storage
    // 5. Generate summaries if configured

    await job.updateProgress(50);

    // Placeholder: Simulate aggregation work
    console.log(`[AggregationWorker] Processing config ${config.name}...`);
    
    // In real implementation:
    // const aggregator = new ContentAggregator(config.configJson, secrets, storage);
    // const result = await aggregator.run(options);

    await job.updateProgress(80);

    // Update config status
    const duration = Date.now() - startTime;
    await userService.updateConfigRunStatus(configId, 'idle', duration);

    await job.updateProgress(100);

    console.log(`[AggregationWorker] Completed aggregation for config ${configId} in ${duration}ms`);

    return {
      success: true,
      itemsProcessed: 0, // Would come from actual aggregation result
      duration,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[AggregationWorker] Error processing config ${configId}:`, error);

    // Update config status to error
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
    console.log(`[AggregationWorker] Job ${job.id} completed:`, result);
  });

  worker.on('failed', (job, error) => {
    console.error(`[AggregationWorker] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error) => {
    console.error('[AggregationWorker] Worker error:', error);
  });

  console.log('[AggregationWorker] Started');
}

/**
 * Stop the aggregation worker
 */
export async function stopAggregationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log('[AggregationWorker] Stopped');
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

export const aggregationWorker = {
  start: startAggregationWorker,
  stop: stopAggregationWorker,
  getStatus: getWorkerStatus,
};
