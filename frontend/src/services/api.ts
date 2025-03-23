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
  const response = await fetch(`${API_BASE_URL}/config/${name}`);
  if (!response.ok) {
    throw new Error('Failed to fetch config');
  }
  return response.json();
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