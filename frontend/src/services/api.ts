import { Config, PluginInfo, AggregationStatus, JobStatus } from '../types';
import { websocketService } from './websocket';

const API_BASE_URL = 'http://localhost:3000';

// Flag to enable WebSocket usage for real-time updates
const USE_WEBSOCKET = true;

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

export const startAggregation = async (configName: string, config: Config): Promise<string> => {
  // Always use REST API for starting aggregation
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  
  if (!response.ok) {
    throw new Error('Failed to start aggregation');
  }
  
  const result = await response.json();
  return result.jobId;
};

export const runAggregation = async (configName: string, config: Config): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  
  if (!response.ok) {
    throw new Error('Failed to run aggregation');
  }
  
  const result = await response.json();
  return result.jobId;
};

export const stopAggregation = async (configName: string): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/aggregate/${configName}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error('Failed to stop aggregation');
  }
};

export const getAggregationStatus = async (configName: string): Promise<AggregationStatus> => {
  if (USE_WEBSOCKET) {
    // Connect to WebSocket if needed and use the hook instead
    console.warn('Using WebSocket for status updates. You should use useWebSocket hook instead of getAggregationStatus for real-time updates.');
    
    // If WebSocket is not connected, fallback to REST API
    if (!websocketService.isConnected()) {
      try {
        websocketService.connect(configName);
        websocketService.getStatus();
        
        // Return a temporary status until the WebSocket receives updates
        return {
          status: 'running',
          currentPhase: 'connecting',
          lastUpdated: Date.now()
        };
      } catch (error) {
        console.error('Failed to connect to WebSocket, falling back to REST API:', error);
      }
    } else {
      // WebSocket is connected, request a status update
      websocketService.getStatus();
      
      // Return a temporary status until the WebSocket receives updates
      return {
        status: 'running',
        currentPhase: 'waiting',
        lastUpdated: Date.now()
      };
    }
  }

  // Fallback to REST API
  const response = await fetch(`${API_BASE_URL}/status/${configName}`);
  if (!response.ok) {
    throw new Error('Failed to fetch aggregation status');
  }
  return response.json();
};

export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const response = await fetch(`${API_BASE_URL}/job/${jobId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch job status');
  }
  return response.json();
};

// Type for the cleanup function
type CleanupFunction = () => void;

export const useJobStatus = (
  jobId: string, 
  onStatusChange?: (status: JobStatus) => void
): null | CleanupFunction => {
  if (!jobId) return null;
  
  // This implementation assumes this function is used within a React component
  // with appropriate hooks to track state, similar to a useWebSocket hook
  
  if (USE_WEBSOCKET) {
    try {
      // Connect to the job's WebSocket
      websocketService.connectToJob(jobId);
      
      // Set up a listener for job status updates
      if (onStatusChange) {
        websocketService.addJobStatusListener(onStatusChange);
        
        // Clean up listener when component unmounts (caller should handle this)
        // Return a cleanup function that the calling component can use 
        const cleanup = () => {
          websocketService.removeJobStatusListener(onStatusChange);
          websocketService.disconnect();
        };
        
        return cleanup;
      }
    } catch (error) {
      console.error('Failed to connect to WebSocket for job:', error);
    }
  }
  
  // Fallback: caller should use getJobStatus in a polling pattern if WebSocket isn't working
  return null;
}; 