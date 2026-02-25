import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { ConfigService, Config } from './services/configService';
import { AggregatorService } from './services/aggregatorService';
import { PluginService } from './services/pluginService';
import { WebSocketService } from './services/websocketService';
import { databaseService } from './services/databaseService';
import { externalConnectionService } from './services/externalConnections';
import { jobService } from './services/jobService';
import { userService } from './services/userService';
import { licenseService } from './services/licenseService';
import { cronService } from './services/cronService';
import v1Routes from './routes/v1';

// Import pop402 payment middleware
// @ts-ignore - package may not have types
import { paymentMiddleware } from '@pop402/x402-express';
import { PRO_PLANS } from './services/licenseService';

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// pop402 configuration
const FACILITATOR_URL = process.env.POP402_FACILITATOR_URL || 'https://facilitator.pop402.com';
const NETWORK = process.env.POP402_NETWORK || 'solana';
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || '';
const MOCK_MODE = process.env.POP402_MOCK_MODE === 'true';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Configure pop402 protected routes for license purchases
// Each plan has its own endpoint with its specific price
const protectedRoutes: Record<string, any> = {};
for (const [planId, plan] of Object.entries(PRO_PLANS)) {
  protectedRoutes[`/api/v1/me/license/purchase/${planId}`] = {
    price: `$${plan.priceDisplay}`,
    network: NETWORK,
    config: {
      description: `Pro License - ${plan.name}`,
      mimeType: 'application/json',
    }
  };
}

// Debug middleware to log payment headers
app.use((req, res, next) => {
  if (req.path.includes('/license/purchase/')) {
    console.log('[pop402] Request to protected route:', {
      path: req.path,
      method: req.method,
      hasXPayment: !!req.headers['x-payment'],
      hasXPaymentMeta: !!req.headers['x-payment-meta'],
      xPaymentMetaPreview: req.headers['x-payment-meta'] 
        ? Buffer.from(req.headers['x-payment-meta'] as string, 'base64').toString().slice(0, 200) + '...'
        : null,
    });
  }
  next();
});

// Apply pop402 payment middleware at app level (only if configured and not mock mode)
if (!MOCK_MODE && PLATFORM_WALLET) {
  console.log('[pop402] Payment middleware enabled:', {
    platformWallet: PLATFORM_WALLET.slice(0, 8) + '...',
    facilitatorUrl: FACILITATOR_URL,
    network: NETWORK,
    protectedRoutes: Object.keys(protectedRoutes),
  });
  
  app.use(paymentMiddleware(PLATFORM_WALLET, protectedRoutes, { url: FACILITATOR_URL }));
} else if (MOCK_MODE) {
  console.log('[pop402] Mock mode - payment middleware disabled');
} else {
  console.warn('[pop402] PLATFORM_WALLET_ADDRESS not set - payment middleware disabled');
}

// Serve static files from the frontend build directory
app.use(express.static(path.join(__dirname, '../frontend/build')));

// API v1 routes (multi-tenant platform)
app.use('/api/v1', v1Routes);

// Initialize services
const configService = new ConfigService();
const aggregatorService = AggregatorService.getInstance();
const pluginService = new PluginService();

// Initialize WebSocket service
const webSocketService = new WebSocketService(server, aggregatorService);

// GET /plugins - Get all available plugins
app.get('/plugins', async (req, res) => {
  try {
    const plugins = await pluginService.getAvailablePlugins();
    res.json(plugins);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load plugins' });
  }
});

// GET /configs - List all available configurations
app.get('/configs', async (req, res) => {
  try {
    const configs = await configService.listConfigs();
    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list configurations' });
  }
});

// GET /config/:name - Get a specific configuration
app.get('/config/:name', async (req, res) => {
  try {
    const config = await configService.getConfig(req.params.name);
    res.json(config);
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Configuration not found' });
  }
});

// POST /config/:name - Create or update a configuration
app.post('/config/:name', async (req, res) => {
  try {
    
    await configService.saveConfig(req.params.name, req.body);
    
    // Notify websocket clients that the config has changed
    webSocketService.notifyConfigChange(req.params.name);
    
    res.json({ message: 'Configuration saved successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to save configuration' });
  }
});

// DELETE /config/:name - Delete a configuration
app.delete('/config/:name', async (req, res) => {
  try {
    await configService.deleteConfig(req.params.name);
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Configuration not found' });
  }
});

// POST /aggregate/:configName/run - Run aggregation once without starting continuous process
app.post('/aggregate', async (req, res) => {
  try {
    const _config: any = req.body?.config || {};
    // SECRETS PASSED IN FROM CLIENT. NEVER LOG. NEVER SAVE
    const secrets: any = req.body?.secrets || {};

    const configName: string = _config?.name || '';
    const runOnce: boolean = _config?.settings?.runOnce === true;
    const onlyGenerate: boolean = _config?.settings?.onlyGenerate === true;
    const onlyFetch: boolean = _config?.settings?.onlyFetch === true;
    const historicalDate = _config?.settings?.historicalDate;

    // Use the config from request body if it has the required fields,
    // otherwise fall back to loading from file (for backwards compatibility)
    let config: Config;
    if (_config.sources && _config.ai && _config.storage) {
      // Config was sent in the request body - use it directly
      config = _config;
    } else if (configName) {
      // Only config name provided - load from file
      config = await configService.getConfig(configName);
    } else {
      throw new Error('Either a full config or a config name must be provided');
    }

    const runtimeSettings = {
      runOnce,
      onlyGenerate,
      onlyFetch,
      historicalDate
    }

    let jobId: string;
    if (runOnce) {
      jobId = await aggregatorService.runAggregationOnce(configName, config, runtimeSettings, secrets);
    } else {
      jobId = await aggregatorService.startAggregation(configName, config, runtimeSettings, secrets);
    }
    
    // Broadcast the updated status to all WebSocket clients
    webSocketService.broadcastStatus(configName);
    // Also broadcast the initial job status
    webSocketService.broadcastJobStatus(jobId);
    
    res.json({ 
      message: 'Content aggregation executed successfully',
      jobId
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to execute content aggregation' });
  }
});

// POST /aggregate/:configName/stop - Stop content aggregation for a specific config
app.post('/aggregate/:configName/stop', async (req, res) => {
  try {
    aggregatorService.stopAggregation(req.params.configName);
    
    // Broadcast the updated status to all WebSocket clients
    webSocketService.broadcastStatus(req.params.configName);
    
    res.json({ message: 'Content aggregation stopped successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to stop content aggregation' });
  }
});

// GET /status/:configName - Get status of content aggregation for a specific config
app.get('/status/:configName', (req, res) => {
  const status = aggregatorService.getAggregationStatus(req.params.configName);
  res.json(status);
});

// GET /job/:jobId - Get status of a specific job
app.get('/job/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const jobStatus = aggregatorService.getJobStatus(jobId);
  
  if (!jobStatus) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  
  res.json(jobStatus);
});

// GET /jobs - Get all jobs
app.get('/jobs', (req, res) => {
  const jobs = aggregatorService.getAllJobs();
  res.json(jobs);
});

// GET /jobs/:configName - Get all jobs for a specific config
app.get('/jobs/:configName', (req, res) => {
  const jobs = aggregatorService.getJobsByConfig(req.params.configName);
  res.json(jobs);
});

// POST /job/:jobId/stop - Stop a specific job by ID
app.post('/job/:jobId/stop', (req, res) => {
  try {
    const jobId = req.params.jobId;
    const success = aggregatorService.stopJob(jobId);
    
    if (!success) {
      res.status(404).json({ error: 'Job not found or not in a stoppable state' });
      return;
    }
    
    // Get the updated job status to include in the response
    const jobStatus = aggregatorService.getJobStatus(jobId);
    
    // Broadcast job status update to WebSocket clients
    webSocketService.broadcastJobStatus(jobId);
    
    res.json({ 
      message: 'Job stopped successfully',
      jobStatus
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to stop job' });
  }
});

// Serve the React app for any other routes (catch-all)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// Local server key for encrypted config execution
// The key is generated once on startup (or loaded from env) and used to decrypt
// configs sent from the hosted UI via the relay endpoint.
let _localServerKey: string | null = null;

export function getLocalServerKey(): string | null {
  return _localServerKey;
}

// Initialize database and start server
async function start() {
  try {
    // Generate or load local server key for encrypted config execution
    _localServerKey = process.env.LOCAL_SERVER_KEY || crypto.randomBytes(32).toString('base64');
    if (!process.env.LOCAL_SERVER_KEY) {
      console.log('');
      console.log('  Local Server Key (paste this into the platform UI):');
      console.log(`  ${_localServerKey}`);
      console.log('');
      console.log('  Set LOCAL_SERVER_KEY env var to use a fixed key.');
      console.log('');
    } else {
      console.log('Local server key loaded from LOCAL_SERVER_KEY env var');
    }

    // Initialize platform database if DATABASE_URL is set
    if (process.env.DATABASE_URL) {
      await databaseService.initPlatformDatabase();
      console.log('Platform database initialized');
      
      // Initialize external connection service (Discord bot, Telegram bot, etc.)
      // This starts the bots so they can receive events
      await externalConnectionService.initialize();
      console.log('External connection service initialized');
      
      // Resume running continuous jobs
      await resumeRunningJobs();
      
      // Start cron jobs (job pruning, pro validation)
      cronService.startCronJobs();
    }

    // Start the server
    server.listen(port, () => {
      console.log(`API server running on port ${port}`);
      console.log(`Frontend served at http://localhost:${port}`);
      console.log(`API v1 available at http://localhost:${port}/api/v1`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Resume running continuous jobs on server startup
 * Also validates that users still have pro licenses
 */
async function resumeRunningJobs() {
  try {
    const runningJobs = await jobService.getRunningJobs();
    console.log(`[Startup] Found ${runningJobs.length} running jobs to process`);
    
    for (const job of runningJobs) {
      if (job.jobType === 'continuous') {
        // Verify user still has pro license
        let hasProLicense = false;
        
        try {
          const user = await userService.getUserById(job.userId);
          if (user?.tier === 'admin') {
            hasProLicense = true;
          } else if (user?.walletAddress) {
            const license = await licenseService.verifyLicense(user.walletAddress);
            hasProLicense = license.isActive;
          }
        } catch (error) {
          console.error(`[Startup] Error checking user ${job.userId}:`, error);
        }
        
        if (!hasProLicense) {
          // User lost pro, stop the continuous job
          console.log(`[Startup] User ${job.userId} no longer has pro license, cancelling job ${job.id}`);
          await jobService.cancelJob(job.id);
          await jobService.addJobLog(job.id, 'warn', 'Continuous job cancelled - Pro license no longer active');
          continue;
        }
        
        // Resume the continuous job
        console.log(`[Startup] Resuming continuous job ${job.id} for config ${job.configId}`);
        
        try {
          // Load config metadata (needed for name, storageType, etc.)
          const config = await userService.getConfigById(job.configId);
          if (!config) {
            console.error(`[Startup] Config ${job.configId} not found for job ${job.id}`);
            await jobService.failJob(job.id, 'Config not found during resume');
            continue;
          }
          
          // Try to load the encrypted resolved config/secrets from the job record first.
          // These contain the fully-resolved config (with all $SECRET:uuid$ references and
          // platform credentials already injected) from when the job was originally started.
          const resolvedConfig = await jobService.getJobResolvedConfig(job.id);
          const resolvedSecrets = await jobService.getJobResolvedSecrets(job.id);
          
          let configJson: any;
          let secrets: Record<string, string>;
          
          if (resolvedConfig && resolvedSecrets) {
            // Use the encrypted resolved config — all secrets are already baked in.
            // Re-inject platform credentials since env vars may have rotated since last start.
            console.log(`[Startup] Using encrypted resolved config for job ${job.id}`);
            configJson = resolvedConfig;
            secrets = resolvedSecrets;
            
            const user = await userService.getUserById(job.userId);
            const isAdmin = user?.tier === 'admin';
            
            // Re-inject platform AI credentials (env vars may have changed)
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

            // Re-inject platform storage credentials (env vars may have changed)
            const usesPlatformStorage = configJson.storage?.some((s: any) => s.params?.usePlatformStorage === true);
            if (config.storageType === 'platform' || isAdmin || usesPlatformStorage) {
              const platformDbUrl = process.env.DATABASE_URL;
              configJson.storage = configJson.storage?.map((storage: any) => {
                if (storage.params?.usePlatformStorage || config.storageType === 'platform' || isAdmin) {
                  return {
                    ...storage,
                    params: {
                      ...storage.params,
                      configId: job.configId,
                      connectionString: platformDbUrl,
                    }
                  };
                }
                return storage;
              }) || [];
            }
          } else {
            // Legacy fallback: no encrypted resolved config on the job.
            // Load from configs table and re-inject platform credentials.
            // NOTE: $SECRET:uuid$ references in config_json won't resolve correctly,
            // but ALL_CAPS and process.env.X references will work.
            console.log(`[Startup] No encrypted resolved config for job ${job.id}, using legacy fallback`);
            secrets = await userService.getConfigSecrets(job.configId) || {};
            configJson = config.configJson as any;

            const user = await userService.getUserById(job.userId);
            const isAdmin = user?.tier === 'admin';

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

            // Inject platform storage credentials (configId for multi-tenant isolation)
            const usesPlatformStorage = configJson.storage?.some((s: any) => s.params?.usePlatformStorage === true);
            if (config.storageType === 'platform' || isAdmin || usesPlatformStorage) {
              const platformDbUrl = process.env.DATABASE_URL;
              configJson.storage = configJson.storage?.map((storage: any) => {
                if (storage.params?.usePlatformStorage || config.storageType === 'platform' || isAdmin) {
                  return {
                    ...storage,
                    params: {
                      ...storage.params,
                      configId: job.configId,
                      connectionString: platformDbUrl,
                    }
                  };
                }
                return storage;
              }) || [];
            }
          }
          
          // Start the continuous job (using existing job ID to resume)
          await aggregatorService.startContinuousJob(
            job.configId,
            job.userId,
            config.name,
            configJson,
            { runOnce: false },
            secrets,
            job.globalInterval,
            job.id // Pass existing job ID to resume
          );
          
          await jobService.addJobLog(job.id, 'info', 'Continuous job resumed after server restart');
          console.log(`[Startup] Successfully resumed job ${job.id}`);
        } catch (error) {
          console.error(`[Startup] Error resuming job ${job.id}:`, error);
          await jobService.failJob(job.id, `Failed to resume after restart: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        // One-time job was interrupted - mark as failed
        console.log(`[Startup] Marking interrupted one-time job ${job.id} as failed`);
        await jobService.failJob(job.id, 'Server restarted during execution');
      }
    }
    
    console.log('[Startup] Finished processing running jobs');
  } catch (error) {
    console.error('[Startup] Error resuming running jobs:', error);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  cronService.stopCronJobs();
  await externalConnectionService.shutdown();
  await databaseService.closeAllConnections();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});