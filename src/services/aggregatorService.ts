import { ContentAggregator } from "../aggregator/ContentAggregator";
import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from "../helpers/configHelper";
import { Config } from "./configService";
import { AggregationStatus, AiProvider, AiUsageStats, JobStatus, GeneratorPlugin, GeneratorInstanceConfig, ExporterPlugin, ExporterInstanceConfig } from "../types";
import EventEmitter from "events";
import { HistoricalAggregator } from "../aggregator/HistoricalAggregator";
import { runGeneratorsForDate, runGeneratorsForRange, runExportersForDate, runExportersForRange } from "../helpers/generatorHelper";
import { jobService, AggregationJob, JobType } from "./jobService";
import { userService } from "./userService";
import { licenseService } from "./licenseService";

/**
 * In-memory tracking for active jobs
 * We need to keep intervals in memory since NodeJS.Timeout can't be serialized
 */
interface ActiveJobState {
  intervals: NodeJS.Timeout[];
  aggregator: ContentAggregator;
  configName: string;
  userId?: string;
}

export class AggregatorService {
  private static instance: AggregatorService | null = null;
  
  private activeAggregators: { [key: string]: ContentAggregator } = {};
  private eventEmitter: EventEmitter = new EventEmitter();
  
  // In-memory tracking for active jobs (for intervals that can't be persisted)
  private activeJobStates: Map<string, ActiveJobState> = new Map();

  constructor() {
    // Set maximum listeners to avoid warnings (since we might have many configs)
    this.eventEmitter.setMaxListeners(100);
    
    // Store as singleton instance
    if (!AggregatorService.instance) {
      AggregatorService.instance = this;
    }
  }
  
  /**
   * Get the singleton instance of AggregatorService
   * Creates one if it doesn't exist
   */
  public static getInstance(): AggregatorService {
    if (!AggregatorService.instance) {
      AggregatorService.instance = new AggregatorService();
    }
    return AggregatorService.instance;
  }

  /**
   * Collect and sum usage stats from all AI provider instances, then reset them.
   * This avoids double-counting across ticks.
   */
  private collectAndResetAiUsage(aiConfigs: any[]): AiUsageStats {
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

  // Event emitter methods
  public on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  private async emitStatusUpdate(configName: string, jobId?: string): Promise<void> {
    if (this.activeAggregators[configName]) {
      const status = this.activeAggregators[configName].getStatus();

      this.eventEmitter.emit(`status:${configName}`, status);
      
      // If there's a job ID and it's a DB job (UUID), emit job status update
      if (jobId && jobId.length === 36) {
        const job = await jobService.getJob(jobId);
        if (job) {
          const jobStatus = this.jobToJobStatus(job);
          jobStatus.aggregationStatus = {
            currentSource: status.currentSource,
            currentPhase: status.currentPhase,
            errors: status.errors,
            stats: status.stats
          };
          this.eventEmitter.emit(`job:${jobId}`, jobStatus);
        }
      }
    }
  }

  /**
   * Convert AggregationJob to JobStatus for backwards compatibility
   */
  private jobToJobStatus(job: AggregationJob): JobStatus {
    // Determine cancel reason from logs if the job was cancelled
    let cancelReason: string | undefined;
    if (job.status === 'cancelled' && job.logs?.length) {
      const hasLicenseExpiredLog = job.logs.some(
        (log) => log.message?.includes('Pro license expired')
      );
      if (hasLicenseExpiredLog) {
        cancelReason = 'license_expired';
      }
    }

    return {
      jobId: job.id,
      configName: '', // Will need to look this up if needed
      startTime: job.startedAt?.getTime() || job.createdAt.getTime(),
      status: job.status as JobStatus['status'],
      progress: job.status === 'completed' ? 100 : job.status === 'running' ? 50 : 0,
      error: job.errorMessage,
      cancelReason,
      intervals: this.activeJobStates.get(job.id)?.intervals,
      aggregationStatus: {
        stats: {
          totalItemsFetched: job.itemsFetched,
          totalPromptTokens: job.totalPromptTokens,
          totalCompletionTokens: job.totalCompletionTokens,
          totalAiCalls: job.totalAiCalls,
          estimatedCostUsd: job.estimatedCostUsd,
        }
      }
    };
  }

  // New method to update source status before fetching
  private async updateSourceStatus(configName: string, sourceName?: string, jobId?: string): Promise<void> {
    if (this.activeAggregators[configName]) {
      // Manually set the current source in the aggregator's status
      const aggregator = this.activeAggregators[configName];
      const status = aggregator.getStatus();
      status.currentSource = sourceName;
      status.currentPhase = 'fetching';
      status.lastUpdated = Date.now();
      
      this.eventEmitter.emit(`status:${configName}`, status);
      
      // If there's a job ID and it's a DB job (UUID), emit job status update
      if (jobId && jobId.length === 36) {
        const job = await jobService.getJob(jobId);
        if (job) {
          const jobStatus = this.jobToJobStatus(job);
          jobStatus.aggregationStatus = {
            currentSource: sourceName,
            currentPhase: 'fetching',
            errors: status.errors,
            stats: status.stats
          };
          this.eventEmitter.emit(`job:${jobId}`, jobStatus);
        }
      }
    }
  }

  // Method to emit job status updates
  private async emitJobStatusUpdate(jobId: string): Promise<void> {
    const job = await jobService.getJob(jobId);
    if (job) {
      const jobStatus = this.jobToJobStatus(job);
      this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    }
  }

  // Register a polling timer for status updates
  public registerStatusPolling(configName: string, interval: number = 1000): NodeJS.Timeout {
    return setInterval(() => {
      this.emitStatusUpdate(configName);
    }, interval);
  }

  /**
   * Start a continuous aggregation job (for pro users)
   */
  async startContinuousJob(
    configId: string,
    userId: string,
    configName: string,
    config: Config,
    settings: any,
    secrets: any,
    globalInterval?: number,
    existingJobId?: string
  ): Promise<string> {
    // Create a job in the database (or use existing for resume)
    // When creating a new job, store the encrypted resolved config/secrets
    // so the job can be resumed after a server restart
    const jobId = existingJobId || await jobService.createJob({
      configId,
      userId,
      jobType: 'continuous',
      globalInterval,
      resolvedConfig: config,
      resolvedSecrets: secrets,
    });
    
    // Start the continuous aggregation process in the background
    this.startContinuousAggregationProcess(jobId, configName, config, settings, secrets, globalInterval, userId).catch(async error => {
      console.error(`Error in continuous aggregation process for job ${jobId}:`, error);
      await jobService.failJob(jobId, error.message || 'Unknown error');
      await jobService.addJobLog(jobId, 'error', error.message || 'Unknown error');
    });
    
    return jobId;
  }

  /**
   * Legacy method for backwards compatibility
   */
  async startAggregation(configName: string, config: Config, settings: any, secrets: any): Promise<string> {
    // For legacy API calls without configId/userId, generate a temporary job ID
    // This maintains backwards compatibility with the old in-memory system
    const jobId = Math.random().toString(36).substr(2, 9);
    
    // Initialize legacy job status (for backwards compatibility)
    const jobStatus: JobStatus = {
      jobId,
      configName,
      startTime: Date.now(),
      status: 'pending',
      progress: 0
    };
    
    this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    
    // Start the continuous aggregation process
    this.startContinuousAggregationProcess(jobId, configName, config, settings, secrets).catch(error => {
      console.error(`Error in background continuous aggregation process for job ${jobId}:`, error);
    });
    
    return jobId;
  }

  private async startContinuousAggregationProcess(
    jobId: string,
    configName: string,
    config: Config,
    settings: any,
    secrets: any,
    globalInterval?: number,
    userId?: string
  ): Promise<void> {
    // Check if this is a DB-backed job (UUIDs are 36 chars)
    const isDbJob = jobId.length === 36;
    
    // Initialize active job state for interval tracking
    const activeState: ActiveJobState = {
      intervals: [],
      aggregator: null as any,
      configName,
      userId,
    };
    this.activeJobStates.set(jobId, activeState);
    
    // Ensure settings exists
    if (!settings) {
      settings = {
        runOnce: false,
        onlyFetch: false,
        onlyGenerate: false
      };
    }
    
    try {
      // Load all necessary modules
      const sourceClasses = await loadDirectoryModules("sources");
      const aiClasses = await loadDirectoryModules("ai");
      const enricherClasses = await loadDirectoryModules("enrichers");
      const generatorClasses = await loadDirectoryModules("generators");
      const storageClasses = await loadDirectoryModules("storage");

      if (isDbJob) {
        await jobService.addJobLog(jobId, 'info', 'Loading configurations...');
      }

      // Load configurations
      let aiConfigs = await loadItems(config.ai, aiClasses, "ai", secrets);
      let sourceConfigs = await loadItems(config.sources, sourceClasses, "source", secrets);
      let enricherConfigs = await loadItems(config.enrichers, enricherClasses, "enrichers", secrets);
      let generatorConfigs = await loadItems(config.generators, generatorClasses, "generators", secrets);
      let storageConfigs = await loadItems(config.storage, storageClasses, "storage", secrets);

      // Set up dependencies
      sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
      sourceConfigs = await loadStorage(sourceConfigs, storageConfigs);
      enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
      generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
      generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);

      // Create and initialize aggregator
      const aggregator = new ContentAggregator();
      sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));
      enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
      
      for (const storage of storageConfigs) {
        await storage.instance.init();
        aggregator.registerStorage(storage.instance);
      }

      // Store the aggregator instance
      this.activeAggregators[configName] = aggregator;
      activeState.aggregator = aggregator;

      if (isDbJob) {
        await jobService.addJobLog(jobId, 'info', 'Starting continuous aggregation...');
      }

      // Start fetching and generating content
      if (!settings?.onlyGenerate) {
        for (const sourceConfig of sourceConfigs) {
          await this.updateSourceStatus(configName, sourceConfig.instance.name, jobId);
          await aggregator.fetchAndStore(sourceConfig.instance.name);
          await this.emitStatusUpdate(configName, jobId);
          
          // Use global interval if provided, otherwise use per-source interval
          const interval = globalInterval || sourceConfig.interval;
          
          // Track interval ID for cleanup
          const intervalId = setInterval(async () => {
            // Validate Pro license before doing work (DB-backed jobs only)
            if (isDbJob && activeState.userId) {
              const hasLicense = await this.checkUserProLicense(activeState.userId);
              if (!hasLicense) {
                await this.stopContinuousJobForExpiredLicense(jobId);
                return;
              }
            }
            
            await this.updateSourceStatus(configName, sourceConfig.instance.name, jobId);
            const itemsBefore = aggregator.getStatus().stats?.totalItemsFetched || 0;
            
            await aggregator.fetchAndStore(sourceConfig.instance.name);
            
            const itemsAfter = aggregator.getStatus().stats?.totalItemsFetched || 0;
            const newItems = itemsAfter - itemsBefore;
            
            // Collect AI usage from this tick
            const tickUsage = this.collectAndResetAiUsage(aiConfigs);
            
            // Record this tick in the database (only for DB-backed jobs)
            if (isDbJob) {
              await jobService.recordContinuousTick(jobId, {
                itemsFetched: newItems,
                itemsProcessed: newItems,
                promptTokens: tickUsage.totalPromptTokens,
                completionTokens: tickUsage.totalCompletionTokens,
                aiCalls: tickUsage.totalCalls,
                estimatedCostUsd: tickUsage.estimatedCostUsd,
              });
            }
            
            await this.emitStatusUpdate(configName, jobId);
          }, interval);
          
          activeState.intervals.push(intervalId);
        }
      }

      if (!settings?.onlyFetch) {
        // Separate generators from exporters
        const { generators: genInstances, exporters: expInstances } = this.separatePlugins(generatorConfigs);
        const primaryStorage = storageConfigs[0]?.instance;

        // Helper to run generators for yesterday's date
        const runGeneratorsOnce = async () => {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);

          if (genInstances.length > 0 && primaryStorage) {
            const result = await runGeneratorsForDate(dateStr, {
              generators: genInstances,
              storage: primaryStorage,
            });
            return result;
          }
          return null;
        };

        // Initial generation run
        await runGeneratorsOnce();
        await this.emitStatusUpdate(configName, jobId);

        // Run exporters once
        if (expInstances.length > 0) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);
          await runExportersForDate(dateStr, { exporters: expInstances });
        }

        // Schedule recurring generator runs
        const genIntervals = genInstances.map(g => g.interval).filter((i): i is number => !!i);
        const interval = globalInterval || (genIntervals.length > 0 ? Math.min(...genIntervals) : 3600000);

        const intervalId = setInterval(async () => {
          // Validate Pro license before doing work (DB-backed jobs only)
          if (isDbJob && activeState.userId) {
            const hasLicense = await this.checkUserProLicense(activeState.userId);
            if (!hasLicense) {
              await this.stopContinuousJobForExpiredLicense(jobId);
              return;
            }
          }

          const result = await runGeneratorsOnce();

          // Collect AI usage from generator tick
          const genUsage = this.collectAndResetAiUsage(aiConfigs);
          if (isDbJob && genUsage.totalCalls > 0) {
            await jobService.recordContinuousTick(jobId, {
              itemsFetched: 0,
              itemsProcessed: 0,
              promptTokens: genUsage.totalPromptTokens,
              completionTokens: genUsage.totalCompletionTokens,
              aiCalls: genUsage.totalCalls,
              estimatedCostUsd: genUsage.estimatedCostUsd,
            });
          }

          await this.emitStatusUpdate(configName, jobId);
        }, interval);

        activeState.intervals.push(intervalId);
      }
      
      if (isDbJob) {
        await jobService.addJobLog(jobId, 'info', `Continuous aggregation started with ${activeState.intervals.length} intervals`);
      }
      
    } catch (error: any) {
      // Handle errors
      if (isDbJob) {
        await jobService.failJob(jobId, error.message || 'Unknown error during aggregation');
        await jobService.addJobLog(jobId, 'error', error.message || 'Unknown error');
      }
      
      // Clean up
      this.cleanupJobState(jobId);
    }
  }

  /**
   * Run a one-time aggregation job
   */
  async runOneTimeJob(
    configId: string,
    userId: string,
    configName: string,
    config: Config,
    settings: any,
    secrets: any
  ): Promise<string> {
    // Create a job in the database
    const jobId = await jobService.createJob({
      configId,
      userId,
      jobType: 'one-time',
    });
    
    // Start the aggregation process in the background
    this.runAggregationProcess(jobId, configName, config, settings, secrets).catch(async error => {
      console.error(`Error in aggregation process for job ${jobId}:`, error);
      await jobService.failJob(jobId, error.message || 'Unknown error');
      await jobService.addJobLog(jobId, 'error', error.message || 'Unknown error');
    });
    
    return jobId;
  }

  /**
   * Legacy method for backwards compatibility
   */
  async runAggregationOnce(configName: string, config: Config, settings: any, secrets: any): Promise<string> {
    // For legacy API calls without configId/userId, generate a temporary job ID
    const jobId = Math.random().toString(36).substr(2, 9);
    
    // Initialize legacy job status
    const jobStatus: JobStatus = {
      jobId,
      configName,
      startTime: Date.now(),
      status: 'pending',
      progress: 0
    };
    
    this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    
    // Start the aggregation process
    this.runAggregationProcess(jobId, configName, config, settings, secrets).catch(error => {
      console.error(`Error in background aggregation process for job ${jobId}:`, error);
    });
    
    return jobId;
  }

  private async runAggregationProcess(jobId: string, configName: string, config: Config, settings: any, secrets: any): Promise<void> {
    // Check if this is a DB-backed job
    const isDbJob = jobId.length === 36; // UUIDs are 36 chars
    
    // Log config summary
    console.log('[AggregatorService] Received config:', {
      storageCount: config.storage?.length || 0,
      generatorCount: config.generators?.length || 0,
      sourceCount: config.sources?.length || 0,
      aiCount: config.ai?.length || 0,
      enricherCount: config.enrichers?.length || 0,
    });
    
    // Ensure settings exists
    if (!settings) {
      settings = {
        runOnce: true,
        onlyFetch: false,
        onlyGenerate: false
      };
    }
    
    try {
      // Load all necessary modules
      const sourceClasses = await loadDirectoryModules("sources");
      const aiClasses = await loadDirectoryModules("ai");
      const enricherClasses = await loadDirectoryModules("enrichers");
      const generatorClasses = await loadDirectoryModules("generators");
      const storageClasses = await loadDirectoryModules("storage");

      if (isDbJob) {
        await jobService.addJobLog(jobId, 'info', 'Loading configurations...');
      }

      // Load configurations
      let aiConfigs = await loadItems(config.ai, aiClasses, "ai", secrets);
      let sourceConfigs = await loadItems(config.sources, sourceClasses, "source", secrets);
      let enricherConfigs = await loadItems(config.enrichers, enricherClasses, "enrichers", secrets);
      let generatorConfigs = await loadItems(config.generators, generatorClasses, "generators", secrets);
      let storageConfigs = await loadItems(config.storage, storageClasses, "storage", secrets);

      // Set up dependencies
      sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
      sourceConfigs = await loadStorage(sourceConfigs, storageConfigs);
      enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
      generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
      generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
      
      // Check if we're running in historical mode
      const isHistoricalMode = settings?.historicalDate?.enabled === true;

      if (isHistoricalMode) {
        // Use HistoricalAggregator for historical data
        console.log('Running in historical mode with settings:', settings.historicalDate);
        const aggregator = new HistoricalAggregator();
        
        // Register sources that support historical fetching
        sourceConfigs.forEach((config) => {
          if (config.instance?.fetchHistorical) {
            aggregator.registerSource(config.instance);
          } else {
            console.warn(`Source ${config.instance.name} does not support historical data fetching`);
          }
        });
        
        // Register enrichers and storage
        enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
        
        for (const storage of storageConfigs) {
          await storage.instance.init();
          aggregator.registerStorage(storage.instance);
        }
        
        // Set up date filter based on historicalDate settings
        const dateFilter: any = {};
        const { mode, startDate, endDate } = settings.historicalDate;
        
        if (mode === 'range') {
          dateFilter.after = startDate;
          dateFilter.before = endDate;
        } else {
          dateFilter.filterType = 'during';
          dateFilter.date = startDate;
        }
        
        // Fetch historical data if not in generate-only mode
        if (!settings?.onlyGenerate) {
          for (const sourceConfig of sourceConfigs) {
            if (sourceConfig.instance?.fetchHistorical) {
              await this.updateSourceStatus(configName, sourceConfig.instance.name, jobId);
              
              if (mode === 'range') {
                await aggregator.fetchAndStoreRange(sourceConfig.instance.name, dateFilter);
              } else {
                await aggregator.fetchAndStore(sourceConfig.instance.name, startDate);
              }
              
              await this.emitStatusUpdate(configName, jobId);
            }
          }
        }
        
        // Generate content if not in fetch-only mode
        if (!settings?.onlyFetch) {
          // Ensure storage is initialized
          for (const gen of generatorConfigs) {
            if (gen.instance.storage?.init) {
              await gen.instance.storage.init();
            }
          }

          const { generators: histGenInstances, exporters: histExpInstances } = this.separatePlugins(generatorConfigs);
          const histPrimaryStorage = storageConfigs[0]?.instance;

          if (histGenInstances.length > 0 && histPrimaryStorage) {
            if (mode === 'range') {
              const result = await runGeneratorsForRange(startDate, endDate, {
                generators: histGenInstances,
                storage: histPrimaryStorage,
              });
              console.log(`[AggregatorService] Historical range generation complete: ${result.summaryItems.length} summaries, ${result.totalTokensUsed} tokens`);
            } else {
              const result = await runGeneratorsForDate(startDate, {
                generators: histGenInstances,
                storage: histPrimaryStorage,
              });
              console.log(`[AggregatorService] Historical generation complete: ${result.summaryItems.length} summaries, ${result.totalTokensUsed} tokens`);
            }
            await this.emitStatusUpdate(configName, jobId);
          }

          // Run exporters
          if (histExpInstances.length > 0) {
            if (mode === 'range') {
              await runExportersForRange(startDate, endDate, { exporters: histExpInstances });
            } else {
              await runExportersForDate(startDate, { exporters: histExpInstances });
            }
          }
        }
        
        // Collect AI usage and complete the job
        const historicalAiUsage = this.collectAndResetAiUsage(aiConfigs);
        if (isDbJob) {
          if (historicalAiUsage.totalCalls > 0) {
            await jobService.updateJobProgress(jobId, {
              promptTokens: historicalAiUsage.totalPromptTokens,
              completionTokens: historicalAiUsage.totalCompletionTokens,
              aiCalls: historicalAiUsage.totalCalls,
              estimatedCostUsd: historicalAiUsage.estimatedCostUsd,
            });
          }
          await jobService.completeJob(jobId);
          await jobService.addJobLog(jobId, 'info', `Historical aggregation completed. AI: ${historicalAiUsage.totalCalls} calls, $${historicalAiUsage.estimatedCostUsd.toFixed(4)} estimated cost.`);
        }
        
        return;
      }
      
      // Standard non-historical aggregation
      const aggregator = new ContentAggregator();
      sourceConfigs.forEach((config) => aggregator.registerSource(config.instance));
      enricherConfigs.forEach((config) => aggregator.registerEnricher(config.instance));
      
      for (const storage of storageConfigs) {
        await storage.instance.init();
        aggregator.registerStorage(storage.instance);
      }
      
      // Store it temporarily
      const previousAggregator = this.activeAggregators[configName];
      this.activeAggregators[configName] = aggregator;

      let totalItemsFetched = 0;

      // Run all sources once
      if (!settings?.onlyGenerate) {
        if (isDbJob) {
          await jobService.addJobLog(jobId, 'info', 'Fetching from sources...');
        }
        
        for (const sourceConfig of sourceConfigs) {
          await this.updateSourceStatus(configName, sourceConfig.instance.name, jobId);
          await aggregator.fetchAndStore(sourceConfig.instance.name);
          await this.emitStatusUpdate(configName, jobId);
        }
        
        totalItemsFetched = aggregator.getStatus().stats?.totalItemsFetched || 0;
      }

      // Run all generators once
      if (!settings?.onlyFetch) {
        if (isDbJob) {
          await jobService.addJobLog(jobId, 'info', 'Generating summaries...');
        }

        const { generators: otGenInstances, exporters: otExpInstances } = this.separatePlugins(generatorConfigs);
        const otPrimaryStorage = storageConfigs[0]?.instance;

        if (otGenInstances.length > 0 && otPrimaryStorage) {
          // Generate for yesterday's date (standard one-time behavior)
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);

          const result = await runGeneratorsForDate(dateStr, {
            generators: otGenInstances,
            storage: otPrimaryStorage,
          });
          await this.emitStatusUpdate(configName, jobId);
        }

        // Run exporters
        if (otExpInstances.length > 0) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const dateStr = yesterday.toISOString().slice(0, 10);
          await runExportersForDate(dateStr, { exporters: otExpInstances });
          await this.emitStatusUpdate(configName, jobId);
        }
      }
      
      // Restore previous aggregator or clean up
      if (previousAggregator && this.isAggregationRunning(configName)) {
        setTimeout(() => {
          this.activeAggregators[configName] = previousAggregator;
          this.eventEmitter.emit(`status:${configName}`, previousAggregator.getStatus());
        }, 1000);
      } else {
        setTimeout(() => {
          if (this.activeAggregators[configName] === aggregator) {
            delete this.activeAggregators[configName];
            this.eventEmitter.emit(`status:${configName}`, {
              status: 'stopped',
              lastUpdated: Date.now()
            });
          }
        }, 30000);
      }
      
      // Collect final AI usage stats
      const aiUsage = this.collectAndResetAiUsage(aiConfigs);
      
      // Update job stats and complete
      if (isDbJob) {
        await jobService.updateJobProgress(jobId, {
          itemsFetched: totalItemsFetched,
          itemsProcessed: totalItemsFetched,
          promptTokens: aiUsage.totalPromptTokens,
          completionTokens: aiUsage.totalCompletionTokens,
          aiCalls: aiUsage.totalCalls,
          estimatedCostUsd: aiUsage.estimatedCostUsd,
        });
        await jobService.completeJob(jobId);
        await jobService.addJobLog(jobId, 'info', `Aggregation completed. Fetched ${totalItemsFetched} items. AI: ${aiUsage.totalCalls} calls, ${aiUsage.totalPromptTokens + aiUsage.totalCompletionTokens} tokens, $${aiUsage.estimatedCostUsd.toFixed(4)} estimated cost.`);
      }
      
    } catch (error: any) {
      // Handle errors
      if (isDbJob) {
        await jobService.failJob(jobId, error.message || 'Unknown error during aggregation');
        await jobService.addJobLog(jobId, 'error', error.message || 'Unknown error');
      }
      throw error;
    }
  }

  /**
   * Stop a continuous job
   */
  async stopContinuousJob(jobId: string): Promise<boolean> {
    const job = await jobService.getJob(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }
    
    // Clean up intervals and aggregator
    this.cleanupJobState(jobId);
    
    // Mark job as completed (not failed, since it was intentionally stopped)
    await jobService.completeJob(jobId);
    await jobService.addJobLog(jobId, 'info', 'Continuous job stopped by user');
    
    return true;
  }

  /**
   * Stop a continuous job because the user's Pro license has expired.
   * Uses 'cancelled' status (not 'completed') to distinguish from user-initiated stops,
   * and emits a WebSocket update so the frontend can notify the user.
   */
  async stopContinuousJobForExpiredLicense(jobId: string): Promise<boolean> {
    const job = await jobService.getJob(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }
    
    // Clean up intervals and aggregator
    this.cleanupJobState(jobId);
    
    // Mark job as cancelled (distinct from user-initiated 'completed')
    await jobService.cancelJob(jobId);
    await jobService.addJobLog(jobId, 'warn', 'Continuous job stopped — Pro license expired. Renew your subscription to restart.');
    
    // Emit a final job status update via WebSocket so the frontend is notified immediately
    await this.emitJobStatusUpdate(jobId);
    
    console.log(`[AggregatorService] Stopped continuous job ${jobId} due to expired Pro license`);
    return true;
  }

  /**
   * Check if a user still has a valid Pro license.
   * Used by per-tick validation in continuous jobs.
   */
  private async checkUserProLicense(userId: string): Promise<boolean> {
    try {
      const user = await userService.getUserById(userId);
      if (!user) return false;
      if (user.tier === 'admin') return true;
      if (user.walletAddress) {
        const license = await licenseService.verifyLicense(user.walletAddress);
        return license.isActive;
      }
      return false;
    } catch (error) {
      console.error(`[AggregatorService] Error checking Pro license for user ${userId}:`, error);
      // On error, don't stop the job — let the next tick or cron handle it
      return true;
    }
  }

  /**
   * Separate loaded plugin configs into GeneratorPlugin and ExporterPlugin instances.
   * Plugins that implement neither are logged as warnings and skipped.
   */
  private separatePlugins(configs: any[]): { generators: GeneratorInstanceConfig[]; exporters: ExporterInstanceConfig[] } {
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
        console.warn(`[AggregatorService] Plugin "${config.instance.name}" does not implement GeneratorPlugin or ExporterPlugin, skipping.`);
      }
    }

    return { generators, exporters };
  }

  /**
   * Clean up job state (intervals and aggregator)
   */
  private cleanupJobState(jobId: string): void {
    const activeState = this.activeJobStates.get(jobId);
    if (activeState) {
      // Clear all intervals
      activeState.intervals.forEach(intervalId => clearInterval(intervalId));
      
      // Remove aggregator
      if (activeState.configName && this.activeAggregators[activeState.configName]) {
        delete this.activeAggregators[activeState.configName];
      }
      
      // Remove from active states
      this.activeJobStates.delete(jobId);
    }
  }

  /**
   * Resume running jobs on server startup.
   * Marks interrupted one-time jobs as failed and cancels orphaned continuous
   * jobs that cannot be resumed (no in-memory state / config / secrets).
   */
  async resumeRunningJobs(): Promise<void> {
    try {
      const runningJobs = await jobService.getRunningJobs();
      console.log(`[AggregatorService] Found ${runningJobs.length} running jobs to clean up`);
      
      for (const job of runningJobs) {
        if (job.jobType === 'continuous') {
          // Continuous jobs cannot be auto-resumed without config/secrets.
          // Cancel them so they don't appear as phantom "active" jobs in the UI.
          console.log(`[AggregatorService] Cancelling orphaned continuous job ${job.id} for config ${job.configId}`);
          await jobService.cancelJob(job.id);
          await jobService.addJobLog(job.id, 'info', 'Server restarted — continuous job cancelled. Please restart it manually.');
        } else {
          // One-time job was interrupted - mark as failed
          console.log(`[AggregatorService] Marking interrupted one-time job ${job.id} as failed`);
          await jobService.failJob(job.id, 'Server restarted during execution');
        }
      }
    } catch (error) {
      console.error('[AggregatorService] Error resuming running jobs:', error);
    }
  }

  /**
   * Stop aggregation by config name (legacy method)
   */
  stopAggregation(configName: string): void {
    // Find any active jobs for this config and stop them
    for (const [jobId, state] of this.activeJobStates.entries()) {
      if (state.configName === configName) {
        this.cleanupJobState(jobId);
      }
    }
    
    // Remove the aggregator instance
    if (this.activeAggregators[configName]) {
      delete this.activeAggregators[configName];
      this.emitStatusUpdate(configName);
    }
  }

  /**
   * Stop a job by its ID (legacy method)
   */
  stopJob(jobId: string): boolean {
    // Check if it's an active job
    if (this.activeJobStates.has(jobId)) {
      this.cleanupJobState(jobId);
      return true;
    }
    return false;
  }

  isAggregationRunning(configName: string): boolean {
    return !!this.activeAggregators[configName];
  }

  getAggregationStatus(configName: string): AggregationStatus {
    if (this.activeAggregators[configName]) {
      return this.activeAggregators[configName].getStatus();
    }
    
    return {
      status: 'stopped',
      lastUpdated: Date.now()
    };
  }
  
  /**
   * Get job status (from database)
   */
  async getJobStatus(jobId: string): Promise<JobStatus | null> {
    // Check if it's a UUID (DB job) or short ID (legacy)
    if (jobId.length === 36) {
      const job = await jobService.getJob(jobId);
      return job ? this.jobToJobStatus(job) : null;
    }
    
    // Legacy in-memory check - not supported anymore
    return null;
  }
  
  /**
   * Get all jobs (from database)
   */
  async getAllJobs(): Promise<AggregationJob[]> {
    const result = await jobService.getJobsByUser('', { limit: 100, offset: 0 });
    return result.jobs;
  }
  
  /**
   * Get jobs by config (from database)
   */
  async getJobsByConfigId(configId: string): Promise<AggregationJob[]> {
    const result = await jobService.getJobsByConfig(configId, { limit: 100, offset: 0 });
    return result.jobs;
  }

  /**
   * Legacy method - get jobs by config name
   * @deprecated Use getJobsByConfigId instead
   */
  getJobsByConfig(configName: string): JobStatus[] {
    // This is a legacy method that returns in-memory jobs
    // For DB-backed jobs, use getJobsByConfigId
    return [];
  }
}
