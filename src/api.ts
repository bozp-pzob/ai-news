import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import http from 'http';
import { ConfigService, Config } from './services/configService';
import { AggregatorService } from './services/aggregatorService';
import { PluginService } from './services/pluginService';
import { WebSocketService } from './services/websocketService';

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(bodyParser.json());

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

// POST /aggregate/:configName - Start content aggregation with a specific config
app.post('/aggregate/:configName', async (req, res) => {
  try {
    const config = await configService.getConfig(req.params.configName);
    const jobId = await aggregatorService.startAggregation(req.params.configName, config);
    
    // Broadcast the updated status to all WebSocket clients
    webSocketService.broadcastStatus(req.params.configName);
    
    res.json({ 
      message: 'Content aggregation started successfully',
      jobId
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to start content aggregation' });
  }
});

// POST /aggregate/:configName/run - Run aggregation once without starting continuous process
app.post('/aggregate/:configName/run', async (req, res) => {
  try {
    const config = await configService.getConfig(req.params.configName);
    const jobId = await aggregatorService.runAggregationOnce(req.params.configName, config);
    
    // Broadcast the updated status to all WebSocket clients
    webSocketService.broadcastStatus(req.params.configName);
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

// DELETE /aggregate/:configName - Stop content aggregation for a specific config
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

// Start the server
server.listen(port, () => {
  console.log(`API server running on port ${port}`);
}); 