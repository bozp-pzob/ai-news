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
    }
    
    const socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      console.log(`WebSocket connected for ${jobId ? `job: ${jobId}` : `config: ${configName}`}`);
      this.isConnecting = false;
      
      // Request initial status if not connecting to a job
      if (!jobId) {
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
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (this.jobId === jobId) {
        return;
      }
      this.disconnect();
    }
    
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
        this.handleJobStatusMessage(message as WebSocketJobStatusMessage);
        break;
        
      case 'jobStarted':
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
    this.notifyJobStatusListeners(message.jobStatus);
  }
  
  private handleJobStartedMessage(message: WebSocketJobStartedMessage): void {
    this.notifyJobStartedListeners(message.jobId);
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
    if (specificJobId) {
      if (!this.jobStatusListeners.has(specificJobId)) {
        this.jobStatusListeners.set(specificJobId, []);
      }
      this.jobStatusListeners.get(specificJobId)!.push(listener);
    } else {
      this.globalJobStatusListeners.push(listener);
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
    // Notify job-specific listeners
    const specificListeners = this.jobStatusListeners.get(jobStatus.jobId) || [];
    specificListeners.forEach(listener => listener(jobStatus));
    
    // Notify global listeners
    this.globalJobStatusListeners.forEach(listener => listener(jobStatus));
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