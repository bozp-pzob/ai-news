import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import http from 'http';
import path from 'path';
import { ConfigService, Config } from './services/configService';
import { AggregatorService } from './services/aggregatorService';
import { PluginService } from './services/pluginService';
import { WebSocketService } from './services/websocketService';
import { CookieService } from './services/cookieService';

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serve static files from the frontend build directory
app.use(express.static(path.join(__dirname, '../frontend/build')));

// Initialize services
const configService = new ConfigService();
const aggregatorService = new AggregatorService();
const cookiesService = new CookieService();
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

    const config = await configService.getConfig(configName);

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

// DELETE /aggregate/:configName - Stop content aggregation for a specific config (keeping for backward compatibility)
app.delete('/aggregate/:configName', async (req, res) => {
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

// POST /extract-cookies - Get Cookies from URL for advanced anti botting
app.post('/cookies/extract', async (req, res) => {
  const url = req.body?.url || undefined;
    
  if ( url ) {
    const cookies = await cookiesService.getCookies(url);

    res.json(cookies);
    return
  }

  res.status(404).json({ error: 'Job not found' });
  return;
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

// Serve the React app for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// Start the server
server.listen(port, () => {
  console.log(`API server running on port ${port}`);
  console.log(`Frontend served at http://localhost:${port}`);
}); 