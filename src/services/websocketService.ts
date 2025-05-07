import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { AggregationStatus, JobStatus } from '../types';
import { AggregatorService } from './aggregatorService';

export class WebSocketService {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map();
  private jobClients: Map<string, Set<WebSocket>> = new Map();
  private aggregatorService: AggregatorService;
  private statusPollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private statusHandlers: Map<string, (status: AggregationStatus) => void> = new Map();
  private jobStatusHandlers: Map<string, (status: JobStatus) => void> = new Map();
  private static instance: WebSocketService;

  constructor(server: any, aggregatorService: AggregatorService) {
    this.wss = new WebSocketServer({ server });
    this.aggregatorService = aggregatorService;
    this.setupWebSocketServer();

    if (!WebSocketService.instance) {
      WebSocketService.instance = this;
    }
  }

  public static getInstance(): WebSocketService {
    return WebSocketService.instance;
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      // Parse URL to get config name from the query parameters
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const configName = url.searchParams.get('config');
      const jobId = url.searchParams.get('jobId');

      // Handle job ID based connections
      if (jobId) {
        this.setupJobConnection(ws, jobId);
        return;
      }

      // Handle config based connections (original functionality)
      if (!configName) {
        console.error('WebSocket connection attempted without config parameter or jobId');
        ws.close(1008, 'Config name or Job ID is required');
        return;
      }

      // Add client to the clients map for this config
      if (!this.clients.has(configName)) {
        this.clients.set(configName, new Set());
        
        // Setup event listener for status updates from AggregatorService
        const statusHandler = (status: AggregationStatus) => {
          this.sendStatusToClients(configName, status);
        };
        
        this.aggregatorService.on(`status:${configName}`, statusHandler);
        this.statusHandlers.set(configName, statusHandler);
        
        // Start polling for regular status updates if not already polling
        if (!this.statusPollingIntervals.has(configName)) {
          const interval = this.aggregatorService.registerStatusPolling(configName, 1000);
          this.statusPollingIntervals.set(configName, interval);
        }
      }
      
      this.clients.get(configName)?.add(ws);

      // Send initial status
      this.sendStatusToClient(ws, configName);

      // Handle client messages
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(configName, data, ws);
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        const clientsForConfig = this.clients.get(configName);
        if (clientsForConfig) {
          clientsForConfig.delete(ws);
          
          // If no clients left for this config, clear the polling interval
          if (clientsForConfig.size === 0) {
            const interval = this.statusPollingIntervals.get(configName);
            if (interval) {
              clearInterval(interval);
              this.statusPollingIntervals.delete(configName);
            }
            
            // Remove event listener using the stored handler
            const handler = this.statusHandlers.get(configName);
            if (handler) {
              this.aggregatorService.off(`status:${configName}`, handler);
              this.statusHandlers.delete(configName);
            }
          }
        }
      });
    });
  }

  private setupJobConnection(ws: WebSocket, jobId: string): void {
    // Add client to the job clients map
    if (!this.jobClients.has(jobId)) {
      this.jobClients.set(jobId, new Set());
      
      // Setup event listener for job status updates
      const jobStatusHandler = (status: JobStatus) => {
        this.sendJobStatusToClients(jobId, status);
      };
      
      this.aggregatorService.on(`job:${jobId}`, jobStatusHandler);
      this.jobStatusHandlers.set(jobId, jobStatusHandler);
    }
    
    this.jobClients.get(jobId)?.add(ws);

    // Send initial job status
    this.sendJobStatusToClient(ws, jobId);

    // Handle client disconnect
    ws.on('close', () => {
      const clientsForJob = this.jobClients.get(jobId);
      if (clientsForJob) {
        clientsForJob.delete(ws);
        
        // If no clients left for this job, remove the event handler
        if (clientsForJob.size === 0) {
          const handler = this.jobStatusHandlers.get(jobId);
          if (handler) {
            this.aggregatorService.off(`job:${jobId}`, handler);
            this.jobStatusHandlers.delete(jobId);
          }
        }
      }
    });
  }

  private async handleClientMessage(configName: string, data: any, ws: WebSocket): Promise<void> {
    try {
      if (!data.action) {
        return;
      }

      switch (data.action) {
        case 'start':
          const startJobId = await this.aggregatorService.startAggregation(configName, data.config);
          ws.send(JSON.stringify({
            type: 'jobStarted',
            jobId: startJobId
          }));
          break;
          
        case 'run':
          const runJobId = await this.aggregatorService.runAggregationOnce(configName, data.config);
          ws.send(JSON.stringify({
            type: 'jobStarted',
            jobId: runJobId
          }));
          break;
          
        case 'stop':
          this.aggregatorService.stopAggregation(configName);
          break;
          
        case 'getStatus':
          this.sendStatusToClient(ws, configName);
          break;
          
        default:
          console.warn(`Unknown WebSocket action: ${data.action}`);
      }
    } catch (error) {
      console.error(`Error handling WebSocket message for ${configName}:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  private async sendStatusToClient(ws: WebSocket, configName: string): Promise<void> {
    try {
      const status = this.aggregatorService.getAggregationStatus(configName);
      ws.send(JSON.stringify({
        type: 'status',
        status
      }));
    } catch (error) {
      console.error(`Error sending status for ${configName}:`, error);
    }
  }

  private async sendJobStatusToClient(ws: WebSocket, jobId: string): Promise<void> {
    try {
      const jobStatus = this.aggregatorService.getJobStatus(jobId);
      if (jobStatus) {
        // Sanitize the job status before sending
        const sanitizedJobStatus = this.sanitizeJobStatus(jobStatus);
        ws.send(JSON.stringify({
          type: 'jobStatus',
          jobStatus: sanitizedJobStatus
        }));
      }
    } catch (error) {
      console.error(`Error sending job status for ${jobId}:`, error);
    }
  }

  private sendStatusToClients(configName: string, status: AggregationStatus): void {
    const clientsForConfig = this.clients.get(configName);
    if (!clientsForConfig || clientsForConfig.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: 'status',
      status
    });

    clientsForConfig.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private sendJobStatusToClients(jobId: string, jobStatus: JobStatus): void {
    const clientsForJob = this.jobClients.get(jobId);
    if (!clientsForJob || clientsForJob.size === 0) {
      return;
    }

    // Sanitize the job status by creating a new object without the intervals property
    const sanitizedJobStatus = this.sanitizeJobStatus(jobStatus);

    const message = JSON.stringify({
      type: 'jobStatus',
      jobStatus: sanitizedJobStatus
    });

    clientsForJob.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Helper method to sanitize job status by removing non-serializable properties
  private sanitizeJobStatus(jobStatus: JobStatus): Omit<JobStatus, 'intervals'> {
    // Create a new object without the intervals property to avoid circular references
    const { intervals, ...sanitizedStatus } = jobStatus;
    return sanitizedStatus;
  }

  public broadcastStatus(configName: string): void {
    const status = this.aggregatorService.getAggregationStatus(configName);
    this.sendStatusToClients(configName, status);
  }

  public broadcastJobStatus(jobId: string): void {
    const jobStatus = this.aggregatorService.getJobStatus(jobId);
    if (jobStatus) {
      this.sendJobStatusToClients(jobId, jobStatus);
    }
  }

  public notifyConfigChange(configName: string): void {
    const clientsForConfig = this.clients.get(configName);
    if (!clientsForConfig || clientsForConfig.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type: 'configChanged'
    });

    clientsForConfig.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
} 