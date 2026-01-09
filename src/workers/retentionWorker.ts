// src/workers/retentionWorker.ts
// @ts-nocheck - BullMQ types will be available after npm install

import { Worker, Job } from 'bullmq';
import { QUEUES, RetentionRetryJobData } from '../services/queueService';
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
 * Process a retention retry job
 * 
 * This worker retries writing data to external databases that failed
 * during the main aggregation process. Data is temporarily stored in
 * the temp_retention table and retried periodically.
 */
async function processRetentionRetryJob(job: Job<RetentionRetryJobData>): Promise<{
  success: boolean;
  dataType: string;
}> {
  const { configId, retentionItemId } = job.data;

  console.log(`[RetentionWorker] Retrying item ${retentionItemId} for config ${configId}`);

  try {
    // Get the retention item
    const result = await databaseService.query(
      'SELECT * FROM temp_retention WHERE id = $1 AND config_id = $2',
      [retentionItemId, configId]
    );

    if (result.rows.length === 0) {
      console.log(`[RetentionWorker] Item ${retentionItemId} not found, may have been processed`);
      return { success: true, dataType: 'unknown' };
    }

    const item = result.rows[0];
    const data = item.data;
    const dataType = item.data_type;

    // Get config and external DB connection
    const config = await userService.getConfigById(configId);
    if (!config) {
      throw new Error(`Config ${configId} not found`);
    }

    if (config.storageType !== 'external' || !config.externalDbUrl) {
      // Config no longer uses external storage, delete retention item
      await databaseService.deleteTempRetentionItem(retentionItemId);
      console.log(`[RetentionWorker] Config ${configId} no longer uses external storage, cleaned up`);
      return { success: true, dataType };
    }

    // Get external storage
    const storage = await databaseService.getExternalStorage(
      configId,
      config.externalDbUrl
    );

    // Retry the write based on data type
    if (dataType === 'items') {
      // data should be an array of ContentItems
      const items = Array.isArray(data) ? data : [data];
      for (const contentItem of items) {
        await storage.storeContentItem(contentItem);
      }
    } else if (dataType === 'summary') {
      // data should be a SummaryItem
      await storage.storeSummary(data);
    } else {
      throw new Error(`Unknown data type: ${dataType}`);
    }

    // Success - delete the retention item
    await databaseService.deleteTempRetentionItem(retentionItemId);
    
    console.log(`[RetentionWorker] Successfully retried ${dataType} for config ${configId}`);
    
    return { success: true, dataType };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[RetentionWorker] Failed to retry item ${retentionItemId}:`, error);

    // Update retry count
    await databaseService.updateTempRetentionRetry(retentionItemId, errorMessage);

    // Check if we should give up
    const result = await databaseService.query(
      'SELECT retry_count FROM temp_retention WHERE id = $1',
      [retentionItemId]
    );

    if (result.rows.length > 0 && result.rows[0].retry_count >= 5) {
      console.error(`[RetentionWorker] Item ${retentionItemId} exceeded max retries, giving up`);
      // Could emit an alert or notification here
    }

    throw error;
  }
}

/**
 * Worker instance
 */
let worker: Worker<RetentionRetryJobData> | null = null;

/**
 * Start the retention worker
 */
export async function startRetentionWorker(): Promise<void> {
  const connection = getRedisConnection();

  worker = new Worker<RetentionRetryJobData>(
    QUEUES.RETENTION_RETRY,
    processRetentionRetryJob,
    {
      connection,
      concurrency: 1, // Process one at a time to avoid overwhelming external DBs
      limiter: {
        max: 5,
        duration: 60000, // Max 5 retries per minute
      },
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`[RetentionWorker] Job ${job.id} completed:`, result);
  });

  worker.on('failed', (job, error) => {
    console.error(`[RetentionWorker] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error) => {
    console.error('[RetentionWorker] Worker error:', error);
  });

  console.log('[RetentionWorker] Started');
}

/**
 * Stop the retention worker
 */
export async function stopRetentionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log('[RetentionWorker] Stopped');
  }
}

/**
 * Schedule retry jobs for all pending retention items
 */
export async function scheduleRetentionRetries(): Promise<number> {
  const { addRetentionRetryJob } = await import('../services/queueService');
  
  // Get all pending retention items
  const result = await databaseService.query(`
    SELECT id, config_id FROM temp_retention
    WHERE retry_count < 5
    AND (last_retry_at IS NULL OR last_retry_at < NOW() - INTERVAL '1 hour')
    ORDER BY created_at ASC
    LIMIT 100
  `);

  let scheduled = 0;
  for (const row of result.rows) {
    await addRetentionRetryJob({
      configId: row.config_id,
      retentionItemId: row.id,
    });
    scheduled++;
  }

  if (scheduled > 0) {
    console.log(`[RetentionWorker] Scheduled ${scheduled} retry jobs`);
  }

  return scheduled;
}

/**
 * Clean up old retention items that have exceeded retries
 */
export async function cleanupOldRetentionItems(): Promise<number> {
  const result = await databaseService.query(`
    DELETE FROM temp_retention
    WHERE retry_count >= 5
    AND created_at < NOW() - INTERVAL '7 days'
    RETURNING id
  `);

  if (result.rows.length > 0) {
    console.log(`[RetentionWorker] Cleaned up ${result.rows.length} expired retention items`);
  }

  return result.rows.length;
}

export const retentionWorker = {
  start: startRetentionWorker,
  stop: stopRetentionWorker,
  scheduleRetries: scheduleRetentionRetries,
  cleanupOld: cleanupOldRetentionItems,
};
