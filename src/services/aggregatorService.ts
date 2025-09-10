import { ContentAggregator } from "../aggregator/ContentAggregator";
import { loadDirectoryModules, loadItems, loadProviders, loadStorage } from "../helpers/configHelper";
import { Config } from "./configService";
import { AggregationStatus, JobStatus } from "../types";
import EventEmitter from "events";
// import { v4 as uuidv4 } from 'uuid';
import { HistoricalAggregator } from "../aggregator/HistoricalAggregator";
import { callbackDateRangeLogic } from "../helpers/dateHelper";

export class AggregatorService {
  private activeAggregators: { [key: string]: ContentAggregator } = {};
  private eventEmitter: EventEmitter = new EventEmitter();
  private jobs: Map<string, JobStatus> = new Map();

  constructor() {
    // Set maximum listeners to avoid warnings (since we might have many configs)
    this.eventEmitter.setMaxListeners(100);
  }

  // Event emitter methods
  public on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  private emitStatusUpdate(configName: string, jobId?: string): void {
    if (this.activeAggregators[configName]) {
      const status = this.activeAggregators[configName].getStatus();

      this.eventEmitter.emit(`status:${configName}`, status);
      
      // If there's a job ID, update and emit job status too
      if (jobId && this.jobs.has(jobId)) {
        const jobStatus = this.jobs.get(jobId)!;
        
        // Only update the status if the job isn't already marked as completed or failed
        // This prevents a completed job from going back to "running"
        if (jobStatus.status !== 'completed' && jobStatus.status !== 'failed') {
          jobStatus.status = status.status === 'running' ? 'running' : 'completed';
          
          // Calculate progress based on current phase
          if (status.currentPhase === 'fetching') {
            jobStatus.progress = 25;
          } else if (status.currentPhase === 'enriching') {
            jobStatus.progress = 50;
          } else if (status.currentPhase === 'generating') {
            jobStatus.progress = 75;
          } else if (status.currentPhase === 'idle' && status.status === 'running') {
            // Only set progress to 100% if the job is actually complete
            // If status is running, maintain the previous progress value instead of jumping to 100%
            // This prevents the progress bar from prematurely jumping to 100%
            // Do nothing here to maintain the previous progress value
          }
        }
        
        // Always update aggregation status details regardless of job status
        // This allows monitoring even for completed jobs
        jobStatus.aggregationStatus = {
          currentSource: status.currentSource,
          currentPhase: status.currentPhase,
          errors: status.errors,
          stats: status.stats
        };
        
        this.jobs.set(jobId, jobStatus);
        this.eventEmitter.emit(`job:${jobId}`, jobStatus);
      }
    }
  }

  // New method to update source status before fetching
  private updateSourceStatus(configName: string, sourceName?: string, jobId?: string): void {
    if (this.activeAggregators[configName]) {
      // Manually set the current source in the aggregator's status
      const aggregator = this.activeAggregators[configName];
      const status = aggregator.getStatus();
      status.currentSource = sourceName;
      status.currentPhase = 'fetching';
      status.lastUpdated = Date.now();
      
      this.eventEmitter.emit(`status:${configName}`, status);
      
      // If there's a job ID, update and emit job status too
      if (jobId && this.jobs.has(jobId)) {
        const jobStatus = this.jobs.get(jobId)!;
        
        if (jobStatus.status !== 'completed' && jobStatus.status !== 'failed') {
          jobStatus.status = 'running';
          jobStatus.progress = 25; // fetching phase
        }
        
        // Always update aggregation status
        jobStatus.aggregationStatus = {
          currentSource: sourceName,
          currentPhase: 'fetching',
          errors: status.errors,
          stats: status.stats
        };
        
        this.jobs.set(jobId, jobStatus);
        this.eventEmitter.emit(`job:${jobId}`, jobStatus);
      }
    }
  }

  // Method to emit job status updates
  private emitJobStatusUpdate(jobId: string): void {
    if (this.jobs.has(jobId)) {
      const jobStatus = this.jobs.get(jobId)!;
      this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    }
  }

  // Register a polling timer for status updates
  public registerStatusPolling(configName: string, interval: number = 1000): NodeJS.Timeout {
    return setInterval(() => {
      this.emitStatusUpdate(configName);
    }, interval);
  }

  async startAggregation(configName: string, config: Config, settings: any, secrets: any): Promise<string> {
    // Create a job ID
    const jobId = Math.random().toString(36).substr(2, 9);
    
    // Initialize job status
    const jobStatus: JobStatus = {
      jobId,
      configName,
      startTime: Date.now(),
      status: 'pending',
      progress: 0
    };
    
    this.jobs.set(jobId, jobStatus);
    this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    
    // Start the continuous aggregation process in the background without blocking
    this.startContinuousAggregationProcess(jobId, configName, config, settings, secrets).catch(error => {
      console.error(`Error in background continuous aggregation process for job ${jobId}:`, error);
      // Error handling is done inside startContinuousAggregationProcess, so no need to handle it here
    });
    
    // Return the job ID immediately
    return jobId;
  }

  private async startContinuousAggregationProcess(jobId: string, configName: string, config: Config, settings: any, secrets: any): Promise<void> {
    const jobStatus = this.jobs.get(jobId)!;
    
    // Initialize the intervals array
    jobStatus.intervals = [];
    
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

      // Update job status
      jobStatus.status = 'running';
      jobStatus.progress = 10;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Load configurations
      let aiConfigs = await loadItems(config.ai, aiClasses, "ai", secrets);
      let sourceConfigs = await loadItems(config.sources, sourceClasses, "source", secrets);
      let enricherConfigs = await loadItems(config.enrichers, enricherClasses, "enrichers", secrets);
      let generatorConfigs = await loadItems(config.generators, generatorClasses, "generators", secrets);
      let storageConfigs = await loadItems(config.storage, storageClasses, "storage", secrets);

      // Update job status
      jobStatus.progress = 20;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Set up dependencies
      sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
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

      // Update job status
      jobStatus.progress = 40;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Start fetching and generating content if not in generate-only mode
      if (!settings?.onlyGenerate) {
        for (const config of sourceConfigs) {
          this.updateSourceStatus(configName, config.instance.name, jobId); // Set source name before fetch
          await aggregator.fetchAndStore(config.instance.name);
          this.emitStatusUpdate(configName, jobId);
          
          // Initialize intervals array if it doesn't exist
          if (!jobStatus.intervals) {
            jobStatus.intervals = [];
          }
          
          // Track interval ID for cleanup
          const intervalId = setInterval(() => {
            this.updateSourceStatus(configName, config.instance.name, jobId); // Set source name before fetch
            aggregator.fetchAndStore(config.instance.name)
              .then(() => this.emitStatusUpdate(configName, jobId));
          }, config.interval);
          
          // Add the interval ID to the job for tracking
          if (!jobStatus.intervals) {
            jobStatus.intervals = [];
          }
          jobStatus.intervals.push(intervalId);
        }
      }

      // Update job status
      jobStatus.progress = 70;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      if (!settings?.onlyFetch) {
        for (const generator of generatorConfigs) {
          await generator.instance.generateContent();
          this.emitStatusUpdate(configName, jobId);
          
          // Track interval ID for cleanup
          const intervalId = setInterval(() => {
            generator.instance.generateContent()
              .then(() => this.emitStatusUpdate(configName, jobId));
          }, generator.interval);
          
          // Add the interval ID to the job for tracking
          jobStatus.intervals.push(intervalId);
        }
      }
      
      // Update job status to completed (continuous aggregation is now set up)
      // jobStatus.status = 'completed';
      // jobStatus.progress = 100;
      // this.jobs.set(jobId, jobStatus);
      // this.emitJobStatusUpdate(jobId);
    } catch (error: any) {
      // Handle errors
      jobStatus.status = 'failed';
      jobStatus.error = error.message || 'Unknown error during aggregation';
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);
    }
  }

  async runAggregationOnce(configName: string, config: Config, settings: any, secrets: any): Promise<string> {
    // Create a job ID
    const jobId = Math.random().toString(36).substr(2, 9);
    
    // Initialize job status
    const jobStatus: JobStatus = {
      jobId,
      configName,
      startTime: Date.now(),
      status: 'pending',
      progress: 0
    };
    
    this.jobs.set(jobId, jobStatus);
    this.eventEmitter.emit(`job:${jobId}`, jobStatus);
    
    // Start the aggregation process in the background without blocking
    this.runAggregationProcess(jobId, configName, config, settings, secrets).catch(error => {
      console.error(`Error in background aggregation process for job ${jobId}:`, error);
      // Error handling is done inside runAggregationProcess, so no need to handle it here
    });
    
    // Return the job ID immediately
    return jobId;
  }

  private async runAggregationProcess(jobId: string, configName: string, config: Config, settings: any, secrets: any): Promise<void> {
    const jobStatus = this.jobs.get(jobId)!;
    
    // Initialize the intervals array (even though one-time jobs don't use intervals)
    jobStatus.intervals = [];
    
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

      // Update job status
      jobStatus.status = 'running';
      jobStatus.progress = 10;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Load configurations
      let aiConfigs = await loadItems(config.ai, aiClasses, "ai", secrets);
      let sourceConfigs = await loadItems(config.sources, sourceClasses, "source", secrets);
      let enricherConfigs = await loadItems(config.enrichers, enricherClasses, "enrichers", secrets);
      let generatorConfigs = await loadItems(config.generators, generatorClasses, "generators", secrets);
      let storageConfigs = await loadItems(config.storage, storageClasses, "storage", secrets);

      // Update job status after loading configurations
      jobStatus.progress = 20;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Set up dependencies
      sourceConfigs = await loadProviders(sourceConfigs, aiConfigs);
      enricherConfigs = await loadProviders(enricherConfigs, aiConfigs);
      generatorConfigs = await loadProviders(generatorConfigs, aiConfigs);
      generatorConfigs = await loadStorage(generatorConfigs, storageConfigs);
      
      // Check if we're running in historical mode
      const isHistoricalMode = settings?.historicalDate?.enabled === true;
      
      // Update job status
      jobStatus.aggregationStatus = { 
        mode: isHistoricalMode ? 'historical' : 'standard',
        config: settings?.historicalDate || {}
      };
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

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
          // Date range mode
          dateFilter.after = startDate;
          dateFilter.before = endDate;
        } else {
          // Single date mode
          dateFilter.filterType = 'during';
          dateFilter.date = startDate;
        }
        
        // Update job status
        jobStatus.progress = 30;
        jobStatus.aggregationStatus = { 
          mode: 'historical',
          config: settings.historicalDate,
          filter: dateFilter
        };
        this.jobs.set(jobId, jobStatus);
        this.emitJobStatusUpdate(jobId);
        
        // Fetch historical data if not in generate-only mode
        if (!settings?.onlyGenerate) {
          for (const config of sourceConfigs) {
            if (config.instance?.fetchHistorical) {
              this.updateSourceStatus(configName, config.instance.name, jobId);
              
              if (mode === 'range') {
                await aggregator.fetchAndStoreRange(config.instance.name, dateFilter);
              } else {
                await aggregator.fetchAndStore(config.instance.name, startDate);
              }
              
              this.emitStatusUpdate(configName, jobId);
            }
          }
        }
        
        // Update job status
        jobStatus.progress = 60;
        this.jobs.set(jobId, jobStatus);
        this.emitJobStatusUpdate(jobId);
        
        // Generate content if not in fetch-only mode
        if (!settings?.onlyFetch) {
          if (mode === 'range') {
            for (const generator of generatorConfigs) {
              await generator.instance.storage.init();
              // Use callbackDateRangeLogic to process each date in the range
              await callbackDateRangeLogic(dateFilter, (dateStr: string) => 
                generator.instance.generateAndStoreSummary(dateStr)
              );
              this.emitStatusUpdate(configName, jobId);
            }
          } else {
            // Single date mode
            for (const generator of generatorConfigs) {
              await generator.instance.storage.init();
              await generator.instance.generateAndStoreSummary(startDate);
              this.emitStatusUpdate(configName, jobId);
            }
          }
        }
        
        // Update job status to completed
        jobStatus.status = 'completed';
        jobStatus.progress = 100;
        this.jobs.set(jobId, jobStatus);
        this.emitJobStatusUpdate(jobId);
        
        return; // Exit early, we're done with historical processing
      }
      
      // Standard non-historical aggregation continues below...
      // Always create a new aggregator for one-time runs to avoid cache issues
      // This ensures we get fresh data on each run
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

      for (const storage of storageConfigs) {
        await storage.instance.init();
      }

      // Update job status
      jobStatus.progress = 30;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Run all sources once without setting up intervals if not in generate-only mode
      if (!settings?.onlyGenerate) {
        for (const config of sourceConfigs) {
          this.updateSourceStatus(configName, config.instance.name, jobId); // Set source name before fetch
          await aggregator.fetchAndStore(config.instance.name);
          this.emitStatusUpdate(configName, jobId);
        }
      }

      // Update job status
      this.updateSourceStatus(configName, undefined, jobId);
      jobStatus.progress = 60;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);

      // Run all generators once if not in fetch-only mode
      if (!settings?.onlyFetch) {
        for (const generator of generatorConfigs) {
          await generator.instance.generateContent();
          this.emitStatusUpdate(configName, jobId);
        }
      }
      
      // If there was a previously running continuous aggregator, restore it
      // Otherwise, remove this temporary aggregator after a delay
      if (previousAggregator && this.isAggregationRunning(configName)) {
        setTimeout(() => {
          this.activeAggregators[configName] = previousAggregator;
          // Don't update job status here as it would overwrite the completed status
          // Just emit the aggregator status without the job ID
          this.eventEmitter.emit(`status:${configName}`, previousAggregator.getStatus());
        }, 1000); // Short delay to ensure status updates are processed
      } else {
        setTimeout(() => {
          if (this.activeAggregators[configName] === aggregator) {
            delete this.activeAggregators[configName];
            // Don't update job status here either
            this.eventEmitter.emit(`status:${configName}`, {
              status: 'stopped',
              lastUpdated: Date.now()
            });
          }
        }, 30000); // Keep the aggregator around for 30 seconds for status checks
      }
      
      // Update job status to completed
      jobStatus.status = 'completed';
      jobStatus.progress = 100;
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);
    } catch (error: any) {
      // Handle errors
      jobStatus.status = 'failed';
      jobStatus.error = error.message || 'Unknown error during aggregation';
      this.jobs.set(jobId, jobStatus);
      this.emitJobStatusUpdate(jobId);
    }
  }

  stopAggregation(configName: string): void {
    
    // Find any jobs associated with this config and mark them as stopped
    const configJobs = this.getJobsByConfig(configName);
    
    configJobs.forEach(job => {
      // Only stop jobs that are still running
      if (job.status === 'running' || job.status === 'pending') {
        // Clear intervals associated with this job
        if (job.intervals && job.intervals.length > 0) {
          job.intervals.forEach(interval => clearInterval(interval));
          job.intervals = [];
        }
        
        // Update job status
        job.status = 'failed';
        job.error = 'Aggregation was stopped';
        
        // Emit job status update
        this.emitJobStatusUpdate(job.jobId);
      }
    });
    
    // Remove the aggregator instance
    if (this.activeAggregators[configName]) {
      delete this.activeAggregators[configName];
      
      // Emit status update
      this.emitStatusUpdate(configName);
    }
  }

  // Add method to stop a job by its ID
  stopJob(jobId: string): boolean {
    // Check if job exists
    if (!this.jobs.has(jobId)) {
      return false;
    }
    
    const jobStatus = this.jobs.get(jobId)!;
    const configName = jobStatus.configName;
    
    // Only stop jobs that are still running
    if (jobStatus.status !== 'running' && jobStatus.status !== 'pending') {
      return false;
    }
    
    // Store reference to job's interval timers
    if (!jobStatus.intervals) {
      jobStatus.intervals = [];
    }
    
    // Clear all interval timers associated with this job
    if (jobStatus.intervals && jobStatus.intervals.length > 0) {
      jobStatus.intervals.forEach(intervalId => {
        clearInterval(intervalId);
      });
      jobStatus.intervals = [];
    }
    
    // Update job status to indicate it's been stopped
    jobStatus.status = 'failed';
    jobStatus.error = 'Job was manually stopped';
    this.jobs.set(jobId, jobStatus);
    
    // Emit job status update to notify clients
    this.emitJobStatusUpdate(jobId);
    
    // If this is the current running job for this config, stop the aggregator
    if (this.activeAggregators[configName]) {
      this.stopAggregation(configName);
    }
    
    return true;
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
  
  getJobStatus(jobId: string): JobStatus | null {
    return this.jobs.has(jobId) ? this.jobs.get(jobId)! : null;
  }
  
  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values());
  }
  
  getJobsByConfig(configName: string): JobStatus[] {
    return Array.from(this.jobs.values()).filter(job => job.configName === configName);
  }
} 