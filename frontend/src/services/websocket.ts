import { 
  AggregationStatus, 
  Config, 
  JobStatus,
  WebSocketAction,
  WebSocketStartAction,
  WebSocketRunAction,
  WebSocketStopAction,
  WebSocketGetStatusAction,
  WebSocketConfigChangedMessage, 
  WebSocketErrorMessage, 
  WebSocketMessage, 
  WebSocketStatusMessage,
  WebSocketJobStatusMessage,
  WebSocketJobStartedMessage
} from '../types';

export class WebSocketService {
  private socket: WebSocket | null = null;
  private configName: string | null = null;
  private jobId: string | null = null;
  private statusListeners: ((status: AggregationStatus) => void)[] = [];
  private errorListeners: ((error: string) => void)[] = [];
  private configChangeListeners: (() => void)[] = [];
  private jobStatusListeners: Map<string, ((jobStatus: JobStatus) => void)[]> = new Map();
  private globalJobStatusListeners: ((jobStatus: JobStatus) => void)[] = [];
  private jobStartedListeners: ((jobId: string) => void)[] = [];
  private isConnecting: boolean = false;
  private reconnectTimeout: number | null = null;
  private readonly API_WS_URL = `ws://${window.location.hostname}:3000`;

  private createWebSocket(configName: string, jobId?: string): WebSocket {
    this.configName = configName;
    this.jobId = jobId || null;
    
    // Set up websocket URL based on whether we're connecting to a job or config
    let wsUrl = `${this.API_WS_URL}?`;
    if (jobId) {
      wsUrl += `jobId=${encodeURIComponent(jobId)}`;
    } else if (configName) {
      wsUrl += `config=${encodeURIComponent(configName)}`;
    }
    
    console.log(`Creating WebSocket connection to: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      console.log(`WebSocket connected for ${jobId ? `job: ${jobId}` : `config: ${configName}`}`);
      this.isConnecting = false;
      
      // For jobs, request status immediately to avoid missing updates
      if (jobId) {
        console.log(`Requesting initial status for job: ${jobId}`);
        // Use setTimeout to ensure the request is sent after the connection is fully established
        setTimeout(() => {
          this.sendAction({ action: 'getStatus' });
        }, 100);
      }
      // For configs, also request initial status
      else if (configName) {
        this.sendAction({ action: 'getStatus' });
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    socket.onclose = () => {
      console.log('WebSocket connection closed');
      this.socket = null;
      
      // Attempt to reconnect after a delay
      if (!this.isConnecting && (this.configName || this.jobId)) {
        this.isConnecting = true;
        this.reconnectTimeout = window.setTimeout(() => {
          if (this.jobId) {
            console.log(`Attempting to reconnect WebSocket for job: ${this.jobId}`);
            this.connectToJob(this.jobId);
          }
        }, 3000);
      }
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.notifyErrorListeners('WebSocket connection error');
    };
    
    return socket;
  }
  
  public connect(configName: string): void {
    return;
  }
  
  public connectToJob(jobId: string): void {
    console.log(`Attempting to connect to job: ${jobId}. Current job: ${this.jobId}`);
    
    // If already connected to this job ID, don't reconnect
    if (this.socket?.readyState === WebSocket.OPEN && this.jobId === jobId) {
      console.log(`Already connected to job ${jobId}, reusing connection`);
      return;
    }
    
    // If connected to a different job, disconnect first
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log(`Disconnecting from current job ${this.jobId} to connect to job ${jobId}`);
      this.disconnect();
    }
    
    console.log(`Creating new WebSocket connection for job ${jobId}`);
    this.isConnecting = true;
    this.socket = this.createWebSocket('', jobId);
  }
  
  public disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.socket) {
      this.socket.onclose = null; // Prevent the reconnection attempt
      this.socket.close();
      this.socket = null;
    }
    
    this.configName = null;
    this.jobId = null;
    this.isConnecting = false;
  }
  
  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
  
  public sendAction(action: WebSocketAction): void {
    if (!this.isConnected()) {
      console.warn('Cannot send action: WebSocket not connected');
      return;
    }
    
    this.socket?.send(JSON.stringify(action));
  }
  
  private handleMessage(message: WebSocketMessage): void {
    console.log("WebSocket received message:", message);
    
    switch (message.type) {
      case 'status':
        this.handleStatusMessage(message as WebSocketStatusMessage);
        break;
        
      case 'error':
        this.handleErrorMessage(message as WebSocketErrorMessage);
        break;
        
      case 'configChanged':
        this.handleConfigChangedMessage(message as WebSocketConfigChangedMessage);
        break;
        
      case 'jobStatus':
        console.log("WebSocket received job status message:", message);
        this.handleJobStatusMessage(message as WebSocketJobStatusMessage);
        break;
        
      case 'jobStarted':
        console.log("WebSocket received job started message:", message);
        this.handleJobStartedMessage(message as WebSocketJobStartedMessage);
        break;
        
      default:
        console.warn(`Unknown WebSocket message type: ${(message as any).type}`);
    }
  }
  
  private handleStatusMessage(message: WebSocketStatusMessage): void {
    this.notifyStatusListeners(message.status);
  }
  
  private handleErrorMessage(message: WebSocketErrorMessage): void {
    this.notifyErrorListeners(message.error);
  }
  
  private handleConfigChangedMessage(message: WebSocketConfigChangedMessage): void {
    this.notifyConfigChangeListeners();
  }
  
  private handleJobStatusMessage(message: WebSocketJobStatusMessage): void {
    console.log("Processing job status update:", message.jobStatus);
    this.handleJobStatusUpdate(message.jobStatus);
  }
  
  private handleJobStartedMessage(message: WebSocketJobStartedMessage): void {
    console.log("Processing job started:", message.jobId);
    this.notifyJobStartedListeners(message.jobId);
  }
  
  private handleJobStatusUpdate(jobStatus: JobStatus): void {
    console.log("Processing job status update:", jobStatus);
    
    // Special handling for continuous operations
    // If the job is a continuous job (indicated by certain phases),
    // we should keep the WebSocket connection active even if the status is "completed"
    const isContinuousOperation = jobStatus.aggregationStatus?.currentPhase === 'idle' || 
                                 jobStatus.aggregationStatus?.currentPhase === 'waiting';
                                 
    // Determine if we should disconnect based on the job status
    let shouldDisconnect = false;
    
    if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
      // Only disconnect if this is NOT a continuous operation
      // For continuous operations, we want to keep the connection alive
      if (!isContinuousOperation) {
        console.log(`Job ${jobStatus.jobId} ${jobStatus.status}. Will disconnect WebSocket.`);
        shouldDisconnect = true;
      } else {
        console.log(`Job ${jobStatus.jobId} reported as ${jobStatus.status}, but is a continuous operation. Keeping connection active.`);
      }
    }
    
    // Notify all job status listeners
    this.notifyJobStatusListeners(jobStatus);
    
    // If job is completed or failed, clean up the connection
    if (shouldDisconnect) {
      // Use a timeout to ensure the status update is processed by all listeners
      setTimeout(() => {
        this.disconnect();
      }, 100);
    }
  }
  
  // Status listeners
  public addStatusListener(listener: (status: AggregationStatus) => void): void {
    this.statusListeners.push(listener);
  }
  
  public removeStatusListener(listener: (status: AggregationStatus) => void): void {
    this.statusListeners = this.statusListeners.filter(l => l !== listener);
  }
  
  private notifyStatusListeners(status: AggregationStatus): void {
    this.statusListeners.forEach(listener => listener(status));
  }
  
  // Error listeners
  public addErrorListener(listener: (error: string) => void): void {
    this.errorListeners.push(listener);
  }
  
  public removeErrorListener(listener: (error: string) => void): void {
    this.errorListeners = this.errorListeners.filter(l => l !== listener);
  }
  
  private notifyErrorListeners(error: string): void {
    this.errorListeners.forEach(listener => listener(error));
  }
  
  // Config change listeners
  public addConfigChangeListener(listener: () => void): void {
    this.configChangeListeners.push(listener);
  }
  
  public removeConfigChangeListener(listener: () => void): void {
    this.configChangeListeners = this.configChangeListeners.filter(l => l !== listener);
  }
  
  private notifyConfigChangeListeners(): void {
    this.configChangeListeners.forEach(listener => listener());
  }
  
  // Job status listeners
  public addJobStatusListener(listener: (jobStatus: JobStatus) => void, specificJobId?: string): void {
    console.log(`Adding job status listener ${specificJobId ? `for job ${specificJobId}` : 'globally'}`);
    
    if (specificJobId) {
      if (!this.jobStatusListeners.has(specificJobId)) {
        this.jobStatusListeners.set(specificJobId, []);
        console.log(`Created new listener array for job ${specificJobId}`);
      }
      this.jobStatusListeners.get(specificJobId)!.push(listener);
      
      // Log the count after adding
      const count = this.jobStatusListeners.get(specificJobId)?.length || 0;
      console.log(`After registration: ${count} listeners for job ${specificJobId}`);
      
      // Log all registered job IDs
      console.log("Currently tracking listeners for job IDs:", 
        Array.from(this.jobStatusListeners.keys()));
    } else {
      this.globalJobStatusListeners.push(listener);
      console.log(`After registration: ${this.globalJobStatusListeners.length} global listeners`);
    }
  }
  
  public removeJobStatusListener(listener: (jobStatus: JobStatus) => void, specificJobId?: string): void {
    if (specificJobId && this.jobStatusListeners.has(specificJobId)) {
      const listeners = this.jobStatusListeners.get(specificJobId)!;
      this.jobStatusListeners.set(specificJobId, listeners.filter(l => l !== listener));
      
      // Remove the key if there are no more listeners
      if (this.jobStatusListeners.get(specificJobId)!.length === 0) {
        this.jobStatusListeners.delete(specificJobId);
      }
    } else {
      // If no specificJobId provided, remove from global listeners
      this.globalJobStatusListeners = this.globalJobStatusListeners.filter(l => l !== listener);
    }
  }
  
  // Clear all listeners for a specific job ID
  public clearJobStatusListeners(jobId: string): void {
    this.jobStatusListeners.delete(jobId);
  }
  
  private notifyJobStatusListeners(jobStatus: JobStatus): void {
    console.log(`Notifying job status listeners for job: ${jobStatus.jobId}`);
    
    // Debug log registered job IDs
    const registeredJobIds = Array.from(this.jobStatusListeners.keys());
    console.log("All registered job IDs:", registeredJobIds);
    console.log("Looking for listeners specifically for:", jobStatus.jobId);
    
    // Check if the job ID is in the right format
    if (typeof jobStatus.jobId !== 'string') {
      console.error("Invalid job ID format:", jobStatus.jobId);
    }
    
    // Notify job-specific listeners
    const specificListeners = this.jobStatusListeners.get(jobStatus.jobId) || [];
    console.log(`Found ${specificListeners.length} specific listeners for job ${jobStatus.jobId}`);
    
    // If no listeners found, check if there's any issue with case sensitivity or formatting
    if (specificListeners.length === 0) {
      registeredJobIds.forEach(id => {
        if (id.toLowerCase() === jobStatus.jobId.toLowerCase() && id !== jobStatus.jobId) {
          console.warn(`Job ID case mismatch detected. Looking for '${jobStatus.jobId}' but found '${id}'`);
        }
      });
    }
    
    // Execute the listeners
    specificListeners.forEach((listener, index) => {
      console.log(`Calling specific listener #${index} for job ${jobStatus.jobId}`);
      try {
        listener(jobStatus);
      } catch (error) {
        console.error(`Error in job status listener for ${jobStatus.jobId}:`, error);
      }
    });
    
    // Notify global listeners
    console.log(`Notifying ${this.globalJobStatusListeners.length} global job status listeners`);
    this.globalJobStatusListeners.forEach((listener, index) => {
      console.log(`Calling global listener #${index}`);
      try {
        listener(jobStatus);
      } catch (error) {
        console.error('Error in global job status listener:', error);
      }
    });
  }
  
  // Job started listeners
  public addJobStartedListener(listener: (jobId: string) => void): void {
    this.jobStartedListeners.push(listener);
  }
  
  public removeJobStartedListener(listener: (jobId: string) => void): void {
    this.jobStartedListeners = this.jobStartedListeners.filter(l => l !== listener);
  }
  
  private notifyJobStartedListeners(jobId: string): void {
    this.jobStartedListeners.forEach(listener => listener(jobId));
  }
  
  // WebSocket actions
  public startAggregation(config: Config): void {
    this.sendAction({
      action: 'start',
      config
    } as WebSocketStartAction);
  }
  
  public runAggregation(config: Config): void {
    this.sendAction({
      action: 'run',
      config
    } as WebSocketRunAction);
  }
  
  public stopAggregation(): void {
    this.sendAction({
      action: 'stop'
    } as WebSocketStopAction);
  }
  
  public getStatus(): void {
    this.sendAction({
      action: 'getStatus'
    } as WebSocketGetStatusAction);
  }
}

// Singleton instance
export const websocketService = new WebSocketService(); 