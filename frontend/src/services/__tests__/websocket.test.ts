import { WebSocketService } from '../websocket';
import { 
  AggregationStatus, 
  Config, 
  JobStatus,
  WebSocketAction,
  WebSocketActionType,
  WebSocketStatusMessage,
  WebSocketErrorMessage,
  WebSocketJobStatusMessage,
  WebSocketConfigChangedMessage,
  WebSocketJobStartedMessage,
  WebSocketStartAction
} from '../../types';

// WebSocket readyState constants
const WebSocketStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  public readyState: number = MockWebSocket.CONNECTING;
  public onopen: ((event: any) => void) | null = null;
  public onclose: ((event: any) => void) | null = null;
  public onmessage: ((event: any) => void) | null = null;
  public onerror: ((event: any) => void) | null = null;
  public send: jest.Mock = jest.fn();
  public close: jest.Mock = jest.fn();
  public url: string;

  constructor(url: string) {
    this.url = url;
    // Simulate connection success
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen({});
      }
    }, 0);
  }

  simulateMessage(data: any) {
    if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({} as CloseEvent);
    }
  }

  simulateError(error: Error) {
    if (this.onerror && this.readyState === MockWebSocket.OPEN) {
      this.onerror(error);
    }
  }
}

// Mock window.location
const mockLocation = {
  hostname: 'localhost'
};

describe('WebSocketService', () => {
  let service: WebSocketService;
  let originalWebSocket: any;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeAll(() => {
    // Increase Jest timeout to handle WebSocket reconnection delays
    jest.setTimeout(10000);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket as any;
    service = new WebSocketService();
    // Mock console.error and console.warn
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    global.WebSocket = originalWebSocket;
    service.disconnect();
    // Restore console mocks
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  afterAll(() => {
    // Reset Jest timeout
    jest.setTimeout(5000);
  });

  describe('connectToJob', () => {
    it('should create a new WebSocket connection for a job', () => {
      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0); // Wait for the WebSocket to be connected
      expect(service.isConnected()).toBe(true);
    });

    it('should not create a new connection if already connected to the same job', () => {
      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0); // Wait for the WebSocket to be connected
      expect(service.isConnected()).toBe(true);

      const socket = (service as any).socket;
      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      expect((service as any).socket).toBe(socket);
    });

    it('should disconnect from current job when connecting to a different job', () => {
      service.connectToJob('job-1');
      jest.advanceTimersByTime(0);
      const firstSocket = (service as any).socket;

      service.connectToJob('job-2');
      jest.advanceTimersByTime(0);
      const secondSocket = (service as any).socket;

      expect(firstSocket.close).toHaveBeenCalled();
      expect(secondSocket).not.toBe(firstSocket);
    });
  });

  describe('disconnect', () => {
    it('should close the WebSocket connection', () => {
      service.connectToJob('test-job-id');
      const socket = (service as any).socket;

      service.disconnect();
      expect(socket.close).toHaveBeenCalled();
      expect((service as any).socket).toBeNull();
    });

    it('should clear reconnection timeout when disconnecting', () => {
      const service = new WebSocketService();
      const mockSocket = new MockWebSocket('ws://localhost:3000?jobId=test-job-id');
      const webSocketSpy = jest.spyOn(window, 'WebSocket').mockImplementation(() => mockSocket as unknown as WebSocket);
      
      // Connect to a job
      service.connectToJob('test-job-id');
      
      // Simulate successful connection
      mockSocket.readyState = WebSocket.OPEN;
      mockSocket.onopen?.({} as Event);
      
      // Set isConnecting to false
      (service as any).isConnecting = false;
      
      // Clear any initial timers
      jest.clearAllTimers();
      
      // Simulate connection loss
      mockSocket.simulateClose();
      
      // Verify reconnection timer is set
      expect((service as any).reconnectTimeout).not.toBeNull();
      
      // Disconnect
      service.disconnect();
      
      // Verify timer is cleared
      expect((service as any).reconnectTimeout).toBeNull();
      
      // Clean up
      webSocketSpy.mockRestore();
    });
  });

  describe('sendAction', () => {
    it('should send an action when connected', () => {
      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);
      const socket = (service as any).socket;

      service.sendAction({ action: 'getStatus' });
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ action: 'getStatus' }));
    });

    it('should not send an action when not connected', () => {
      const consoleSpy = jest.spyOn(console, 'warn');
      service.sendAction({ action: 'getStatus' });
      expect(consoleSpy).toHaveBeenCalledWith('Cannot send action: WebSocket not connected');
    });
  });

  describe('event listeners', () => {
    it('should handle status messages', () => {
      const statusListener = jest.fn();
      service.addStatusListener(statusListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      const mockStatus: AggregationStatus = {
        status: 'running' as const,
        currentPhase: 'idle',
        lastUpdated: 1746664114075,
        stats: {
          totalItemsFetched: 0,
          itemsPerSource: {},
          lastFetchTimes: {}
        }
      };

      const message: WebSocketStatusMessage = {
        type: 'status',
        status: mockStatus
      };

      (service as any).socket.simulateMessage(message);
      expect(statusListener).toHaveBeenCalledWith(mockStatus);
    });

    it('should handle error messages', () => {
      const errorListener = jest.fn();
      service.addErrorListener(errorListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      const message: WebSocketErrorMessage = {
        type: 'error',
        error: 'Test error'
      };

      (service as any).socket.simulateMessage(message);
      expect(errorListener).toHaveBeenCalledWith('Test error');
    });

    it('should handle job status messages', () => {
      const jobStatusListener = jest.fn();
      service.addJobStatusListener(jobStatusListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      const mockJobStatus: JobStatus = {
        jobId: 'test-job-id',
        configName: 'test-config',
        status: 'running',
        startTime: 1746664114088,
        progress: 50,
        aggregationStatus: {
          currentPhase: 'idle',
          stats: {
            totalItemsFetched: 0,
            itemsPerSource: {},
            lastFetchTimes: {}
          }
        }
      };

      const message: WebSocketJobStatusMessage = {
        type: 'jobStatus',
        jobStatus: mockJobStatus
      };

      (service as any).socket.simulateMessage(message);
      expect(jobStatusListener).toHaveBeenCalledWith(mockJobStatus);
    });

    it('should handle config change messages', () => {
      const configChangeListener = jest.fn();
      service.addConfigChangeListener(configChangeListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      const message: WebSocketConfigChangedMessage = {
        type: 'configChanged'
      };

      (service as any).socket.simulateMessage(message);
      expect(configChangeListener).toHaveBeenCalled();
    });

    it('should handle job started messages', () => {
      const jobStartedListener = jest.fn();
      service.addJobStartedListener(jobStartedListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0);

      const message: WebSocketJobStartedMessage = {
        type: 'jobStarted',
        jobId: 'new-job-id'
      };

      (service as any).socket.simulateMessage(message);
      expect(jobStartedListener).toHaveBeenCalledWith('new-job-id');
    });
  });

  describe('reconnection', () => {
    it('should attempt to reconnect when connection is lost', () => {
      const service = new WebSocketService();
      const mockSocket = new MockWebSocket('ws://localhost:3000?jobId=test-job-id');
      const webSocketSpy = jest.spyOn(window, 'WebSocket').mockImplementation(() => mockSocket as unknown as WebSocket);
      
      // Connect to a job
      service.connectToJob('test-job-id');
      
      // Simulate successful connection
      mockSocket.readyState = WebSocket.OPEN;
      mockSocket.onopen?.({} as Event);
      
      // Set isConnecting to false
      (service as any).isConnecting = false;
      
      // Verify initial connection
      expect(service.isConnected()).toBe(true);
      
      // Clear the initial status request timer
      jest.clearAllTimers();
      
      // Simulate connection loss
      mockSocket.simulateClose();
      
      // Verify reconnection timer is set
      expect((service as any).reconnectTimeout).not.toBeNull();
      
      // Advance timers to trigger reconnection
      jest.advanceTimersByTime(3000);
      
      // Verify that a new WebSocket was created
      expect(webSocketSpy).toHaveBeenCalledTimes(2);
      
      // Clean up
      webSocketSpy.mockRestore();
    });

    it('should not attempt to reconnect if disconnected intentionally', async () => {
      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0); // Wait for initial connection
      expect(service.isConnected()).toBe(true);

      // Clear the initial status request timer
      jest.clearAllTimers();

      service.disconnect();
      expect(jest.getTimerCount()).toBe(0);
      expect(service.isConnected()).toBe(false);
    });

    it('should handle WebSocket errors', async () => {
      const errorListener = jest.fn();
      service.addErrorListener(errorListener);

      service.connectToJob('test-job-id');
      jest.advanceTimersByTime(0); // Wait for initial connection
      expect(service.isConnected()).toBe(true);

      (service as any).socket.simulateError(new Error('Connection error'));
      expect(errorListener).toHaveBeenCalledWith('WebSocket connection error');
    });
  });
}); 