// src/services/queueService.ts

import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from 'bullmq';
import { databaseService } from './databaseService';
import { userService } from './userService';
import { logger } from '../helpers/cliHelper';

/**
 * Queue names
 */
export const QUEUES = {
  AGGREGATION: 'aggregation',
  RETENTION_RETRY: 'retention-retry',
  EMBEDDING_BACKFILL: 'embedding-backfill',
} as const;

/**
 * Job types
 */
export interface AggregationJobData {
  configId: string;
  userId: string;
  runType: 'scheduled' | 'manual' | 'historical' | 'continuous-tick';
  /** DB job ID for continuous jobs — ticks record progress against this parent job */
  continuousJobId?: string;
  options?: {
    onlyFetch?: boolean;
    onlyGenerate?: boolean;
    historicalDate?: string;
  };
}

export interface RetentionRetryJobData {
  configId: string;
  retentionItemId: string;
}

export interface EmbeddingBackfillJobData {
  configId: string;
  batchSize?: number;
  startId?: number;
}

/**
 * Redis connection options
 */
export function getRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);
  
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
  };
}

/**
 * Queue instances
 */
let aggregationQueue: Queue<AggregationJobData> | null = null;
let retentionRetryQueue: Queue<RetentionRetryJobData> | null = null;
let embeddingBackfillQueue: Queue<EmbeddingBackfillJobData> | null = null;

/**
 * Queue event handlers
 */
let aggregationEvents: QueueEvents | null = null;

/**
 * Initialize all queues
 */
export async function initQueues(): Promise<void> {
  const connection = getRedisConnection();

  // Create queues
  aggregationQueue = new Queue<AggregationJobData>(QUEUES.AGGREGATION, { connection });
  retentionRetryQueue = new Queue<RetentionRetryJobData>(QUEUES.RETENTION_RETRY, { connection });
  embeddingBackfillQueue = new Queue<EmbeddingBackfillJobData>(QUEUES.EMBEDDING_BACKFILL, { connection });

  // Create event listeners
  aggregationEvents = new QueueEvents(QUEUES.AGGREGATION, { connection });

  logger.info('QueueService: Queues initialized');
}

/**
 * Get the aggregation queue
 */
export function getAggregationQueue(): Queue<AggregationJobData> {
  if (!aggregationQueue) {
    throw new Error('Queues not initialized. Call initQueues() first.');
  }
  return aggregationQueue;
}

/**
 * Get the retention retry queue
 */
export function getRetentionRetryQueue(): Queue<RetentionRetryJobData> {
  if (!retentionRetryQueue) {
    throw new Error('Queues not initialized. Call initQueues() first.');
  }
  return retentionRetryQueue;
}

/**
 * Get the embedding backfill queue
 */
export function getEmbeddingBackfillQueue(): Queue<EmbeddingBackfillJobData> {
  if (!embeddingBackfillQueue) {
    throw new Error('Queues not initialized. Call initQueues() first.');
  }
  return embeddingBackfillQueue;
}

/**
 * Add an aggregation job
 */
export async function addAggregationJob(
  data: AggregationJobData,
  options?: {
    delay?: number;
    priority?: number;
    jobId?: string;
  }
): Promise<Job<AggregationJobData>> {
  const queue = getAggregationQueue();
  
  return queue.add(`aggregation:${data.configId}`, data, {
    delay: options?.delay,
    priority: options?.priority,
    jobId: options?.jobId || `agg:${data.configId}:${Date.now()}`,
    // Don't retry at BullMQ level — each attempt creates a new DB job record,
    // causing duplicate DB jobs. Application-level failure handling (jobService.failJob)
    // already records the error. Users can manually re-trigger if needed.
    attempts: 1,
    removeOnComplete: {
      age: 24 * 60 * 60, // Keep completed jobs for 24 hours
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
    },
  });
}

/**
 * Schedule recurring aggregation for a config
 */
export async function scheduleRecurringAggregation(
  configId: string,
  userId: string,
  cronExpression: string,
  timezone: string = 'UTC'
): Promise<void> {
  const queue = getAggregationQueue();
  
  // Remove any existing repeatable job for this config
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `scheduled:${configId}`) {
      await queue.removeRepeatableByKey(job.key);
    }
  }
  
  // Add new repeatable job
  await queue.add(
    `scheduled:${configId}`,
    { configId, userId, runType: 'scheduled' },
    {
      repeat: { pattern: cronExpression, tz: timezone },
      jobId: `scheduled:${configId}`,
      removeOnComplete: { age: 24 * 60 * 60, count: 100 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 200 },
    }
  );
  
  logger.info(`QueueService: Scheduled recurring aggregation for config ${configId}: ${cronExpression} (${timezone})`);
}

/**
 * Schedule continuous aggregation for a config using a fixed interval.
 * Each tick runs as a separate BullMQ job processed by the worker.
 */
export async function scheduleContinuousAggregation(
  configId: string,
  userId: string,
  intervalMs: number,
  continuousJobId: string,
): Promise<void> {
  const queue = getAggregationQueue();

  // Remove any existing continuous repeatable job for this config
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `continuous:${configId}`) {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  // Add repeatable job with a fixed interval (every N milliseconds)
  await queue.add(
    `continuous:${configId}`,
    { configId, userId, runType: 'continuous-tick' as const, continuousJobId },
    {
      repeat: { every: intervalMs },
      jobId: `continuous:${configId}`,
    }
  );

  logger.info(`QueueService: Scheduled continuous aggregation for config ${configId} every ${intervalMs}ms`);
}

/**
 * Cancel recurring aggregation for a config (both scheduled cron and continuous interval)
 */
export async function cancelRecurringAggregation(configId: string): Promise<void> {
  const queue = getAggregationQueue();
  
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `scheduled:${configId}` || job.name === `continuous:${configId}`) {
      await queue.removeRepeatableByKey(job.key);
      logger.info(`QueueService: Cancelled repeatable job ${job.name} for config ${configId}`);
    }
  }
}

/**
 * Cancel only the continuous repeatable job for a config (not the cron schedule)
 */
export async function cancelContinuousAggregation(configId: string): Promise<void> {
  const queue = getAggregationQueue();
  
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    if (job.name === `continuous:${configId}`) {
      await queue.removeRepeatableByKey(job.key);
      logger.info(`QueueService: Cancelled continuous aggregation for config ${configId}`);
    }
  }
}

/**
 * Check if queues are initialized and available
 */
export function isQueueAvailable(): boolean {
  return aggregationQueue !== null;
}

/**
 * Add a retention retry job
 */
export async function addRetentionRetryJob(
  data: RetentionRetryJobData
): Promise<Job<RetentionRetryJobData>> {
  const queue = getRetentionRetryQueue();
  
  return queue.add('retry', data, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute
    },
    removeOnComplete: true,
  });
}

/**
 * Add an embedding backfill job
 */
export async function addEmbeddingBackfillJob(
  data: EmbeddingBackfillJobData
): Promise<Job<EmbeddingBackfillJobData>> {
  const queue = getEmbeddingBackfillQueue();
  
  return queue.add('backfill', data, {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 30000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
    },
  });
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<{
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  progress?: number;
  data?: any;
  error?: string;
} | null> {
  const queue = getAggregationQueue();
  const job = await queue.getJob(jobId);
  
  if (!job) {
    return null;
  }
  
  const state = await job.getState();
  
  return {
    status: state as any,
    progress: job.progress as number,
    data: job.data,
    error: job.failedReason,
  };
}

/**
 * Get pending jobs for a config
 */
export async function getPendingJobsForConfig(configId: string): Promise<Job<AggregationJobData>[]> {
  const queue = getAggregationQueue();
  const waiting = await queue.getWaiting();
  const delayed = await queue.getDelayed();
  
  return [...waiting, ...delayed].filter(job => job.data.configId === configId);
}

/**
 * Cancel pending jobs for a config
 */
export async function cancelPendingJobsForConfig(configId: string): Promise<number> {
  const jobs = await getPendingJobsForConfig(configId);
  
  for (const job of jobs) {
    await job.remove();
  }
  
  return jobs.length;
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  aggregation: { waiting: number; active: number; completed: number; failed: number };
  retentionRetry: { waiting: number; active: number; completed: number; failed: number };
  embeddingBackfill: { waiting: number; active: number; completed: number; failed: number };
}> {
  const aggQueue = getAggregationQueue();
  const retryQueue = getRetentionRetryQueue();
  const backfillQueue = getEmbeddingBackfillQueue();
  
  const [aggCounts, retryCounts, backfillCounts] = await Promise.all([
    aggQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    retryQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    backfillQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
  ]);
  
  return {
    aggregation: aggCounts as { waiting: number; active: number; completed: number; failed: number },
    retentionRetry: retryCounts as { waiting: number; active: number; completed: number; failed: number },
    embeddingBackfill: backfillCounts as { waiting: number; active: number; completed: number; failed: number },
  };
}

/**
 * Clean up old jobs
 */
export async function cleanupOldJobs(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const queues = [
    getAggregationQueue(),
    getRetentionRetryQueue(),
    getEmbeddingBackfillQueue(),
  ];
  
  for (const queue of queues) {
    await queue.clean(olderThanMs, 1000, 'completed');
    await queue.clean(olderThanMs, 1000, 'failed');
  }
  
  logger.info('QueueService: Cleaned up old jobs');
}

/**
 * Close all queue connections
 */
export async function closeQueues(): Promise<void> {
  const queues = [aggregationQueue, retentionRetryQueue, embeddingBackfillQueue];
  
  for (const queue of queues) {
    if (queue) {
      await queue.close();
    }
  }
  
  if (aggregationEvents) {
    await aggregationEvents.close();
  }
  
  logger.info('QueueService: Queues closed');
}

/**
 * Subscribe to job completion events
 */
export function onJobCompleted(
  callback: (jobId: string, result: any) => void
): void {
  if (!aggregationEvents) {
    throw new Error('Queue events not initialized');
  }
  
  aggregationEvents.on('completed', (args: { jobId: string; returnvalue: any }) => {
    callback(args.jobId, args.returnvalue);
  });
}

/**
 * Subscribe to job failure events
 */
export function onJobFailed(
  callback: (jobId: string, error: string) => void
): void {
  if (!aggregationEvents) {
    throw new Error('Queue events not initialized');
  }
  
  aggregationEvents.on('failed', (args: { jobId: string; failedReason: string }) => {
    callback(args.jobId, args.failedReason);
  });
}

export const queueService = {
  initQueues,
  getAggregationQueue,
  getRetentionRetryQueue,
  getEmbeddingBackfillQueue,
  addAggregationJob,
  scheduleRecurringAggregation,
  scheduleContinuousAggregation,
  cancelRecurringAggregation,
  cancelContinuousAggregation,
  isQueueAvailable,
  addRetentionRetryJob,
  addEmbeddingBackfillJob,
  getJobStatus,
  getPendingJobsForConfig,
  cancelPendingJobsForConfig,
  getQueueStats,
  cleanupOldJobs,
  closeQueues,
  onJobCompleted,
  onJobFailed,
};
