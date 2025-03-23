import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ConfigService, Config } from './services/configService';
import { AggregatorService } from './services/aggregatorService';
import { PluginService } from './services/pluginService';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize services
const configService = new ConfigService();
const aggregatorService = new AggregatorService();
const pluginService = new PluginService();

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
    await aggregatorService.startAggregation(req.params.configName, config);
    res.json({ message: 'Content aggregation started successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to start content aggregation' });
  }
});

// DELETE /aggregate/:configName - Stop content aggregation for a specific config
app.delete('/aggregate/:configName', async (req, res) => {
  try {
    aggregatorService.stopAggregation(req.params.configName);
    res.json({ message: 'Content aggregation stopped successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to stop content aggregation' });
  }
});

// GET /status/:configName - Get status of content aggregation for a specific config
app.get('/status/:configName', (req, res) => {
  const status = aggregatorService.getAggregationStatus(req.params.configName);
  res.json({ status });
});

// Start the server
app.listen(port, () => {
  console.log(`API server running on port ${port}`);
}); 