// src/services/jobService.ts

import { databaseService } from './databaseService';

/**
 * Job type
 */
export type JobType = 'one-time' | 'continuous';

/**
 * Job status
 */
export type JobStatusType = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Log entry for a job
 */
export interface JobLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
}

/**
 * Aggregation job entity
 */
export interface AggregationJob {
  id: string;
  configId: string;
  userId: string;
  jobType: JobType;
  globalInterval?: number;
  status: JobStatusType;
  startedAt?: Date;
  completedAt?: Date;
  itemsFetched: number;
  itemsProcessed: number;
  runCount: number;
  lastFetchAt?: Date;
  errorMessage?: string;
  logs: JobLogEntry[];
  createdAt: Date;
  // AI token usage and cost tracking
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalAiCalls: number;
  estimatedCostUsd: number;
}

/**
 * Job creation parameters
 */
export interface CreateJobParams {
  configId: string;
  userId: string;
  jobType: JobType;
  globalInterval?: number;
}

/**
 * Job update stats
 */
export interface JobUpdateStats {
  itemsFetched?: number;
  itemsProcessed?: number;
  promptTokens?: number;
  completionTokens?: number;
  aiCalls?: number;
  estimatedCostUsd?: number;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/**
 * Free run status
 */
export interface FreeRunStatus {
  available: boolean;
  usedAt: Date | null;
  resetAt: Date;
}

/**
 * Get current date in UTC (YYYY-MM-DD format)
 */
function getCurrentDateUTC(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get next midnight UTC as Date
 */
function getNextMidnightUTC(): Date {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return tomorrow;
}

/**
 * Convert database row to AggregationJob object
 */
function rowToJob(row: any): AggregationJob {
  return {
    id: row.id,
    configId: row.config_id,
    userId: row.user_id,
    jobType: row.job_type,
    globalInterval: row.global_interval,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    itemsFetched: row.items_fetched || 0,
    itemsProcessed: row.items_processed || 0,
    runCount: row.run_count || 1,
    lastFetchAt: row.last_fetch_at ? new Date(row.last_fetch_at) : undefined,
    errorMessage: row.error_message,
    logs: row.logs || [],
    createdAt: new Date(row.created_at),
    totalPromptTokens: row.total_prompt_tokens || 0,
    totalCompletionTokens: row.total_completion_tokens || 0,
    totalAiCalls: row.total_ai_calls || 0,
    estimatedCostUsd: parseFloat(row.estimated_cost_usd) || 0,
  };
}

/**
 * Create a new aggregation job
 */
export async function createJob(params: CreateJobParams): Promise<string> {
  const result = await databaseService.query(
    `INSERT INTO aggregation_jobs (config_id, user_id, job_type, global_interval, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW())
     RETURNING id`,
    [params.configId, params.userId, params.jobType, params.globalInterval || null]
  );
  
  const jobId = result.rows[0].id;
  
  // Update config's active_job_id if continuous
  if (params.jobType === 'continuous') {
    await databaseService.query(
      `UPDATE configs SET active_job_id = $1, status = 'running' WHERE id = $2`,
      [jobId, params.configId]
    );
  } else {
    await databaseService.query(
      `UPDATE configs SET status = 'running' WHERE id = $1`,
      [params.configId]
    );
  }
  
  return jobId;
}

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<AggregationJob | null> {
  const result = await databaseService.query(
    `SELECT * FROM aggregation_jobs WHERE id = $1`,
    [jobId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToJob(result.rows[0]);
}

/**
 * Get jobs for a config with pagination
 */
export async function getJobsByConfig(
  configId: string,
  pagination: PaginationParams
): Promise<{ jobs: AggregationJob[]; total: number; hasMore: boolean }> {
  const [jobsResult, countResult] = await Promise.all([
    databaseService.query(
      `SELECT * FROM aggregation_jobs 
       WHERE config_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [configId, pagination.limit, pagination.offset]
    ),
    databaseService.query(
      `SELECT COUNT(*) as count FROM aggregation_jobs WHERE config_id = $1`,
      [configId]
    ),
  ]);
  
  const total = parseInt(countResult.rows[0].count, 10);
  const jobs = jobsResult.rows.map(rowToJob);
  
  return {
    jobs,
    total,
    hasMore: pagination.offset + jobs.length < total,
  };
}

/**
 * Get jobs for a user with pagination
 */
export async function getJobsByUser(
  userId: string,
  pagination: PaginationParams
): Promise<{ jobs: AggregationJob[]; total: number; hasMore: boolean }> {
  const [jobsResult, countResult] = await Promise.all([
    databaseService.query(
      `SELECT * FROM aggregation_jobs 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [userId, pagination.limit, pagination.offset]
    ),
    databaseService.query(
      `SELECT COUNT(*) as count FROM aggregation_jobs WHERE user_id = $1`,
      [userId]
    ),
  ]);
  
  const total = parseInt(countResult.rows[0].count, 10);
  const jobs = jobsResult.rows.map(rowToJob);
  
  return {
    jobs,
    total,
    hasMore: pagination.offset + jobs.length < total,
  };
}

/**
 * Update job progress/stats
 */
export async function updateJobProgress(jobId: string, stats: JobUpdateStats): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  if (stats.itemsFetched !== undefined) {
    setClauses.push(`items_fetched = $${paramIndex}`);
    values.push(stats.itemsFetched);
    paramIndex++;
  }
  
  if (stats.itemsProcessed !== undefined) {
    setClauses.push(`items_processed = $${paramIndex}`);
    values.push(stats.itemsProcessed);
    paramIndex++;
  }

  if (stats.promptTokens !== undefined) {
    setClauses.push(`total_prompt_tokens = $${paramIndex}`);
    values.push(stats.promptTokens);
    paramIndex++;
  }

  if (stats.completionTokens !== undefined) {
    setClauses.push(`total_completion_tokens = $${paramIndex}`);
    values.push(stats.completionTokens);
    paramIndex++;
  }

  if (stats.aiCalls !== undefined) {
    setClauses.push(`total_ai_calls = $${paramIndex}`);
    values.push(stats.aiCalls);
    paramIndex++;
  }

  if (stats.estimatedCostUsd !== undefined) {
    setClauses.push(`estimated_cost_usd = $${paramIndex}`);
    values.push(stats.estimatedCostUsd);
    paramIndex++;
  }
  
  if (setClauses.length === 0) return;
  
  values.push(jobId);
  
  await databaseService.query(
    `UPDATE aggregation_jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
}

/**
 * Record a continuous job tick (update stats and increment run count)
 */
export async function recordContinuousTick(
  jobId: string,
  stats: {
    itemsFetched: number;
    itemsProcessed: number;
    promptTokens?: number;
    completionTokens?: number;
    aiCalls?: number;
    estimatedCostUsd?: number;
  }
): Promise<void> {
  await databaseService.query(
    `UPDATE aggregation_jobs 
     SET items_fetched = items_fetched + $1,
         items_processed = items_processed + $2,
         run_count = run_count + 1,
         last_fetch_at = NOW(),
         total_prompt_tokens = total_prompt_tokens + $4,
         total_completion_tokens = total_completion_tokens + $5,
         total_ai_calls = total_ai_calls + $6,
         estimated_cost_usd = estimated_cost_usd + $7
     WHERE id = $3`,
    [
      stats.itemsFetched,
      stats.itemsProcessed,
      jobId,
      stats.promptTokens || 0,
      stats.completionTokens || 0,
      stats.aiCalls || 0,
      stats.estimatedCostUsd || 0,
    ]
  );
}

/**
 * Add a log entry to a job
 */
export async function addJobLog(
  jobId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  source?: string
): Promise<void> {
  const logEntry: JobLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    source,
  };
  
  await databaseService.query(
    `UPDATE aggregation_jobs 
     SET logs = logs || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify([logEntry]), jobId]
  );
}

/**
 * Mark a job as completed
 */
export async function completeJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  
  await databaseService.query(
    `UPDATE aggregation_jobs 
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
  
  // Update config status
  await databaseService.query(
    `UPDATE configs 
     SET status = 'idle', 
         last_run_at = NOW(),
         active_job_id = CASE WHEN active_job_id = $1 THEN NULL ELSE active_job_id END
     WHERE id = $2`,
    [jobId, job.configId]
  );
}

/**
 * Mark a job as failed
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  
  await databaseService.query(
    `UPDATE aggregation_jobs 
     SET status = 'failed', completed_at = NOW(), error_message = $1
     WHERE id = $2`,
    [error, jobId]
  );
  
  // Update config status
  await databaseService.query(
    `UPDATE configs 
     SET status = 'error', 
         last_run_at = NOW(),
         last_error = $1,
         active_job_id = CASE WHEN active_job_id = $2 THEN NULL ELSE active_job_id END
     WHERE id = $3`,
    [error, jobId, job.configId]
  );
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  
  await databaseService.query(
    `UPDATE aggregation_jobs 
     SET status = 'cancelled', completed_at = NOW()
     WHERE id = $1`,
    [jobId]
  );
  
  // Update config status
  await databaseService.query(
    `UPDATE configs 
     SET status = 'idle',
         active_job_id = CASE WHEN active_job_id = $1 THEN NULL ELSE active_job_id END
     WHERE id = $2`,
    [jobId, job.configId]
  );
}

/**
 * Get all running jobs (for auto-resume on startup)
 */
export async function getRunningJobs(): Promise<AggregationJob[]> {
  const result = await databaseService.query(
    `SELECT * FROM aggregation_jobs WHERE status = 'running'`
  );
  return result.rows.map(rowToJob);
}

/**
 * Get running continuous jobs (for pro validation)
 */
export async function getRunningContinuousJobs(): Promise<AggregationJob[]> {
  const result = await databaseService.query(
    `SELECT * FROM aggregation_jobs WHERE job_type = 'continuous' AND status = 'running'`
  );
  return result.rows.map(rowToJob);
}

/**
 * Get the active continuous job for a config (if any)
 */
export async function getActiveContinuousJob(configId: string): Promise<AggregationJob | null> {
  const result = await databaseService.query(
    `SELECT * FROM aggregation_jobs 
     WHERE config_id = $1 AND job_type = 'continuous' AND status = 'running'
     LIMIT 1`,
    [configId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return rowToJob(result.rows[0]);
}

/**
 * Check if user can use their free run today
 */
export async function canUserRunFree(userId: string): Promise<boolean> {
  const result = await databaseService.query(
    `SELECT free_run_used_at FROM users WHERE id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return false;
  }
  
  const freeRunUsedAt = result.rows[0].free_run_used_at;
  
  // If never used or used on a previous day, allow
  if (!freeRunUsedAt) {
    return true;
  }
  
  const today = getCurrentDateUTC();
  const usedDate = new Date(freeRunUsedAt).toISOString().split('T')[0];
  
  return usedDate < today;
}

/**
 * Mark user's free run as used
 */
export async function markFreeRunUsed(userId: string): Promise<void> {
  await databaseService.query(
    `UPDATE users SET free_run_used_at = CURRENT_DATE WHERE id = $1`,
    [userId]
  );
}

/**
 * Get free run status for a user
 */
export async function getFreeRunStatus(userId: string): Promise<FreeRunStatus> {
  const result = await databaseService.query(
    `SELECT free_run_used_at FROM users WHERE id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return {
      available: false,
      usedAt: null,
      resetAt: getNextMidnightUTC(),
    };
  }
  
  const freeRunUsedAt = result.rows[0].free_run_used_at;
  const today = getCurrentDateUTC();
  
  let available = true;
  let usedAt: Date | null = null;
  
  if (freeRunUsedAt) {
    const usedDate = new Date(freeRunUsedAt).toISOString().split('T')[0];
    usedAt = new Date(freeRunUsedAt);
    available = usedDate < today;
  }
  
  return {
    available,
    usedAt,
    resetAt: getNextMidnightUTC(),
  };
}

/**
 * Prune old jobs based on retention policy
 */
export async function pruneOldJobs(retentionDays?: number): Promise<number> {
  const days = retentionDays || parseInt(process.env.RUN_RETENTION_DAYS || '90', 10);
  
  const result = await databaseService.query(
    `DELETE FROM aggregation_jobs 
     WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
       AND status != 'running'
     RETURNING id`,
    [days.toString()]
  );
  
  return result.rowCount || 0;
}

/**
 * Get job count for a user (for analytics)
 */
export async function getJobCountForUser(
  userId: string,
  since?: Date
): Promise<{ total: number; completed: number; failed: number }> {
  const whereClause = since
    ? `WHERE user_id = $1 AND created_at >= $2`
    : `WHERE user_id = $1`;
  
  const params = since ? [userId, since] : [userId];
  
  const result = await databaseService.query(
    `SELECT 
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       COUNT(*) FILTER (WHERE status = 'failed') as failed
     FROM aggregation_jobs
     ${whereClause}`,
    params
  );
  
  return {
    total: parseInt(result.rows[0].total, 10),
    completed: parseInt(result.rows[0].completed, 10),
    failed: parseInt(result.rows[0].failed, 10),
  };
}

export const jobService = {
  createJob,
  getJob,
  getJobsByConfig,
  getJobsByUser,
  updateJobProgress,
  recordContinuousTick,
  addJobLog,
  completeJob,
  failJob,
  cancelJob,
  getRunningJobs,
  getRunningContinuousJobs,
  getActiveContinuousJob,
  canUserRunFree,
  markFreeRunUsed,
  getFreeRunStatus,
  pruneOldJobs,
  getJobCountForUser,
};
