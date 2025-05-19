import { useEffect, useState } from 'react';
import { websocketService } from '../services/websocket';
import { AggregationStatus, Config } from '../types';
import { startAggregation as apiStartAggregation, runAggregation as apiRunAggregation, stopAggregation as apiStopAggregation } from '../services/api';

export const useWebSocket = (configName: string | null) => {
  const [status, setStatus] = useState<AggregationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    // Status listener
    const handleStatus = (status: AggregationStatus) => {
      setStatus(status);
      setError(null);
    };

    // Error listener
    const handleError = (error: string) => {
      setError(error);
    };

    // Config change listener
    const handleConfigChange = () => {
      // Refresh status when config changes
      websocketService.getStatus();
    };

    // Add listeners
    websocketService.addStatusListener(handleStatus);
    websocketService.addErrorListener(handleError);
    websocketService.addConfigChangeListener(handleConfigChange);

    // Connect to WebSocket if configName is provided
    if (configName) {
      websocketService.connect(configName);
      setIsConnected(true);
    } else {
      websocketService.disconnect();
      setIsConnected(false);
      setStatus(null);
    }

    // Check connection status periodically
    const connectionCheckInterval = setInterval(() => {
      setIsConnected(websocketService.isConnected());
    }, 2000);

    // Cleanup function
    return () => {
      websocketService.removeStatusListener(handleStatus);
      websocketService.removeErrorListener(handleError);
      websocketService.removeConfigChangeListener(handleConfigChange);
      
      clearInterval(connectionCheckInterval);
      
      // Don't disconnect when unmounting - the service should maintain connection
      // for other components, and disconnect when config changes
    };
  }, [configName]);

  // Methods to control aggregation using REST API
  const startAggregation = async (config: Config) => {
    if (!configName) return;
    
    try {
      await apiStartAggregation(configName, config);
      // Refresh status after starting
      websocketService.getStatus();
    } catch (error) {
      console.error('Error starting aggregation:', error);
      setError(error instanceof Error ? error.message : 'Unknown error starting aggregation');
    }
  };

  const runAggregation = async (config: Config) => {
    if (!configName) return;
    
    try {
      await apiRunAggregation(configName, config);
      // Refresh status after running
      websocketService.getStatus();
    } catch (error) {
      console.error('Error running aggregation:', error);
      setError(error instanceof Error ? error.message : 'Unknown error running aggregation');
    }
  };

  const stopAggregation = async () => {
    if (!configName) return;
    
    try {
      await apiStopAggregation(configName);
      // Refresh status after stopping
      websocketService.getStatus();
    } catch (error) {
      console.error('Error stopping aggregation:', error);
      setError(error instanceof Error ? error.message : 'Unknown error stopping aggregation');
    }
  };

  const refreshStatus = () => {
    websocketService.getStatus();
  };

  return {
    status,
    error,
    isConnected,
    startAggregation,
    runAggregation,
    stopAggregation,
    refreshStatus
  };
}; 