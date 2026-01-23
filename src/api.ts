import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import http from 'http';
import path from 'path';
import { ConfigService, Config } from './services/configService';
import { AggregatorService } from './services/aggregatorService';
import { PluginService } from './services/pluginService';
import { WebSocketService } from './services/websocketService';
import { databaseService } from './services/databaseService';
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
const aggregatorService = new AggregatorService();
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
  const jobStatus = aggregatorService.getJobStatus(req.params.jobId);
  
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

// Initialize database and start server
async function start() {
  try {
    // Initialize platform database if DATABASE_URL is set
    if (process.env.DATABASE_URL) {
      await databaseService.initPlatformDatabase();
      console.log('Platform database initialized');
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

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await databaseService.closeAllConnections();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});