// src/services/cronService.ts

import { jobService } from './jobService';
import { userService } from './userService';
import { licenseService } from './licenseService';
import { AggregatorService } from './aggregatorService';
import { logger } from '../helpers/cliHelper';

/**
 * Cron Service
 * Handles scheduled background tasks like job pruning and pro validation
 */

// Cron intervals
const JOB_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily
const PRO_VALIDATION_INTERVAL_MS = 60 * 60 * 1000; // Hourly

// Track interval IDs for cleanup
let pruneIntervalId: NodeJS.Timeout | null = null;
let proValidationIntervalId: NodeJS.Timeout | null = null;

/**
 * Prune old jobs based on retention policy
 * Runs daily at startup and every 24 hours
 */
export async function pruneOldJobs(): Promise<void> {
  const retentionDays = parseInt(process.env.RUN_RETENTION_DAYS || '90', 10);
  
  try {
    logger.info(`CronService: Pruning jobs older than ${retentionDays} days...`);
    const deletedCount = await jobService.pruneOldJobs(retentionDays);
    logger.info(`CronService: Pruned ${deletedCount} old jobs`);
  } catch (error) {
    logger.error('CronService: Error pruning old jobs', error);
  }
}

/**
 * Validate that users with running continuous jobs still have pro licenses
 * Stops continuous jobs for users who lost their pro subscription
 */
export async function validateContinuousJobsProStatus(): Promise<void> {
  try {
    logger.info('CronService: Validating pro status for continuous jobs...');
    
    const runningContinuousJobs = await jobService.getRunningContinuousJobs();
    const aggregatorService = AggregatorService.getInstance();
    
    let stoppedCount = 0;
    
    for (const job of runningContinuousJobs) {
      try {
        // Check if user still has pro license
        let hasProLicense = false;
        
        const user = await userService.getUserById(job.userId);
        if (user?.tier === 'admin') {
          hasProLicense = true;
        } else if (user?.walletAddress) {
          const license = await licenseService.verifyLicense(user.walletAddress);
          hasProLicense = license.isActive;
        }
        
        if (!hasProLicense) {
          logger.info(`CronService: User ${job.userId} no longer has pro license, stopping job ${job.id}`);
          
          // Stop the continuous job with license-expired status
          await aggregatorService.stopContinuousJobForExpiredLicense(job.id);
          
          stoppedCount++;
        }
      } catch (error) {
        logger.error(`CronService: Error validating job ${job.id}`, error);
      }
    }
    
    logger.info(`CronService: Pro validation complete. Stopped ${stoppedCount}/${runningContinuousJobs.length} jobs.`);
  } catch (error) {
    logger.error('CronService: Error validating continuous jobs', error);
  }
}

/**
 * Start all cron jobs
 */
export function startCronJobs(): void {
  logger.info('CronService: Starting cron jobs...');
  
  // Run initial prune immediately
  pruneOldJobs();
  
  // Schedule daily job pruning
  pruneIntervalId = setInterval(pruneOldJobs, JOB_PRUNE_INTERVAL_MS);
  logger.info('CronService: Job pruning scheduled (daily)');
  
  // Schedule hourly pro validation
  proValidationIntervalId = setInterval(validateContinuousJobsProStatus, PRO_VALIDATION_INTERVAL_MS);
  logger.info('CronService: Pro validation scheduled (hourly)');
}

/**
 * Stop all cron jobs (for graceful shutdown)
 */
export function stopCronJobs(): void {
  logger.info('CronService: Stopping cron jobs...');
  
  if (pruneIntervalId) {
    clearInterval(pruneIntervalId);
    pruneIntervalId = null;
  }
  
  if (proValidationIntervalId) {
    clearInterval(proValidationIntervalId);
    proValidationIntervalId = null;
  }
  
  logger.info('CronService: Cron jobs stopped');
}

export const cronService = {
  pruneOldJobs,
  validateContinuousJobsProStatus,
  startCronJobs,
  stopCronJobs,
};
