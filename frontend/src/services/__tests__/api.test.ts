import { getPlugins, getConfigs, getConfig, saveConfig, deleteConfig, startAggregation, runAggregation, stopAggregation, getAggregationStatus, getJobStatus } from '../api';
import { Config } from '../../types';
import { websocketService } from '../websocket';

// Mock fetch
global.fetch = jest.fn();

// Mock websocket service
jest.mock('../websocket', () => ({
  websocketService: {
    isConnected: jest.fn(),
    connect: jest.fn(),
    getStatus: jest.fn(),
    connectToJob: jest.fn(),
    addJobStatusListener: jest.fn(),
    removeJobStatusListener: jest.fn(),
    disconnect: jest.fn(),
  },
}));

describe('API Service', () => {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    // Mock console methods
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    // Restore console methods after each test
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  describe('getPlugins', () => {
    it('should fetch plugins successfully', async () => {
      const mockPlugins = { 'plugin1': [{ name: 'test', version: '1.0.0' }] };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlugins),
      });

      const result = await getPlugins();
      expect(result).toEqual(mockPlugins);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/plugins');
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(getPlugins()).rejects.toThrow('Failed to fetch plugins');
    });
  });

  describe('getConfigs', () => {
    it('should fetch configs successfully', async () => {
      const mockConfigs = ['config1', 'config2'];
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfigs),
      });

      const result = await getConfigs();
      expect(result).toEqual(mockConfigs);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/configs');
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(getConfigs()).rejects.toThrow('Failed to fetch configs');
    });
  });

  describe('getConfig', () => {
    const mockConfig: Config = {
      name: 'test-config',
      sources: [],
      ai: [],
      enrichers: [],
      generators: [],
      providers: [],
      storage: [],
      settings: {
        runOnce: false,
        onlyFetch: false
      }
    };

    it('should fetch config successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      });

      const result = await getConfig('test-config');
      expect(result).toEqual(mockConfig);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/config/test-config');
    });

    it('should throw error when name is empty', async () => {
      await expect(getConfig('')).rejects.toThrow('Config name is required');
    });

    it('should retry on failure', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockConfig),
        });

      const result = await getConfig('test-config');
      expect(result).toEqual(mockConfig);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('saveConfig', () => {
    const mockConfig: Config = {
      name: 'test-config',
      sources: [],
      ai: [],
      enrichers: [],
      generators: [],
      providers: [],
      storage: [],
      settings: {
        runOnce: false,
        onlyFetch: false
      }
    };

    it('should save config successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      await saveConfig('test-config', mockConfig);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/config/test-config',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockConfig),
        })
      );
    });

    it('should throw error when save fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(saveConfig('test-config', mockConfig)).rejects.toThrow('Failed to save config');
    });
  });

  describe('deleteConfig', () => {
    it('should delete config successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      await deleteConfig('test-config');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/config/test-config',
        { method: 'DELETE' }
      );
    });

    it('should throw error when delete fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(deleteConfig('test-config')).rejects.toThrow('Failed to delete config');
    });
  });

  describe('startAggregation', () => {
    const mockConfig: Config = {
      name: 'test-config',
      sources: [],
      ai: [],
      enrichers: [],
      generators: [],
      providers: [],
      storage: [],
      settings: {
        runOnce: false,
        onlyFetch: false
      }
    };

    it('should start aggregation successfully', async () => {
      const mockJobId = 'job-123';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: mockJobId }),
      });

      const result = await startAggregation('test-config', mockConfig);
      expect(result).toBe(mockJobId);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/aggregate/test-config',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockConfig),
        })
      );
    });

    it('should throw error when start fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(startAggregation('test-config', mockConfig)).rejects.toThrow('Failed to start aggregation');
    });
  });

  describe('getAggregationStatus', () => {
    it('should fetch status via REST API when WebSocket is not connected', async () => {
      (websocketService.isConnected as jest.Mock).mockReturnValue(false);
      (websocketService.connect as jest.Mock).mockImplementation(() => {
        throw new Error('WebSocket connection failed');
      });
      const mockStatus = { 
        status: 'running', 
        currentPhase: 'processing'
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const result = await getAggregationStatus('test-config');
      expect(result).toEqual(mockStatus);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/status/test-config');
    });

    it('should use WebSocket when connected', async () => {
      (websocketService.isConnected as jest.Mock).mockReturnValue(true);
      const result = await getAggregationStatus('test-config');
      
      expect(result).toEqual({
        status: 'running',
        currentPhase: 'waiting',
        lastUpdated: expect.any(Number)
      });
      expect(websocketService.getStatus).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('should fetch job status successfully', async () => {
      const mockStatus = { status: 'completed', progress: 100 };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const result = await getJobStatus('job-123');
      expect(result).toEqual(mockStatus);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/job/job-123');
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      await expect(getJobStatus('job-123')).rejects.toThrow('Failed to fetch job status');
    });
  });
}); 