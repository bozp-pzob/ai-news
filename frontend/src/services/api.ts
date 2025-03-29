import { Config, PluginInfo } from '../types';

const API_BASE_URL = 'http://localhost:3000';

export const getPlugins = async (): Promise<{ [key: string]: PluginInfo[] }> => {
  const response = await fetch(`${API_BASE_URL}/plugins`);
  if (!response.ok) {
    throw new Error('Failed to fetch plugins');
  }
  return response.json();
};

export const getConfigs = async (): Promise<string[]> => {
  const response = await fetch(`${API_BASE_URL}/configs`);
  if (!response.ok) {
    throw new Error('Failed to fetch configs');
  }
  return response.json();
};

export const getConfig = async (name: string): Promise<Config> => {
  console.log(`Getting config with name: ${name}`);
  
  if (!name) {
    console.error("getConfig called with empty name");
    throw new Error("Config name is required");
  }
  
  // Maximum number of retry attempts
  const maxRetries = 2;
  let retryCount = 0;
  let lastError: any;
  
  while (retryCount <= maxRetries) {
    try {
      const url = `${API_BASE_URL}/config/${encodeURIComponent(name)}`;
      console.log(`Fetching from URL: ${url} (attempt ${retryCount + 1}/${maxRetries + 1})`);
      
      const response = await fetch(url);
      console.log(`Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error fetching config: ${errorText}`);
        throw new Error(`Failed to fetch config: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Validate that we received a proper config object
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid config data received");
      }
      
      // Ensure the config has a name property matching the requested name
      data.name = name;
      
      console.log(`Successfully fetched config data for ${name}`);
      return data;
    } catch (error) {
      lastError = error;
      console.error(`Error in getConfig for ${name} (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
      
      // If we've reached max retries, don't wait
      if (retryCount === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff: 1s, 2s)
      const waitTime = 1000 * Math.pow(2, retryCount);
      console.log(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      retryCount++;
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error(`Failed to fetch config after ${maxRetries + 1} attempts`);
};

export const saveConfig = async (name: string, config: Config): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/config/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error('Failed to save config');
  }
};

export const deleteConfig = async (name: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/config/${name}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete config');
  }
};

export const startAggregation = async (configName: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}/start`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to start aggregation');
  }
};

export const stopAggregation = async (configName: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}/stop`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to stop aggregation');
  }
};

export const getAggregationStatus = async (configName: string): Promise<'running' | 'stopped'> => {
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}/status`);
  if (!response.ok) {
    throw new Error('Failed to fetch aggregation status');
  }
  return response.json();
}; 