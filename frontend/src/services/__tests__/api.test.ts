import { getPlugins, getConfigs, getConfig, saveConfig, deleteConfig, startAggregation, runAggregation, stopAggregation, getAggregationStatus, getJobStatus } from '../api';
import { Config } from '../../types';

// Mock fetch
global.fetch = jest.fn();

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
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/plugins'), expect.anything());
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Failed to fetch plugins' }),
      });

      await expect(getPlugins()).rejects.toThrow();
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
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/configs'), expect.anything());
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Failed to fetch configs' }),
      });

      await expect(getConfigs()).rejects.toThrow();
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
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/config/test-config'), expect.anything());
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
        status: 200,
        json: () => Promise.resolve({}),
      });

      await saveConfig('test-config', mockConfig);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/config/test-config'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw error when save fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Failed to save config' }),
      });

      await expect(saveConfig('test-config', mockConfig)).rejects.toThrow();
    });
  });

  describe('deleteConfig', () => {
    it('should delete config successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await deleteConfig('test-config');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/config/test-config'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should throw error when delete fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Failed to delete config' }),
      });

      await expect(deleteConfig('test-config')).rejects.toThrow();
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
        json: () => Promise.resolve({ jobId: mockJobId, message: 'Started' }),
      });

      const result = await startAggregation('test-config', mockConfig);
      expect(result).toBe(mockJobId);
      // Now calls /aggregate with config in body (not /aggregate/:configName)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/aggregate'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should throw error when start fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Failed to start aggregation' }),
      });

      await expect(startAggregation('test-config', mockConfig)).rejects.toThrow();
    });
  });

  describe('runAggregation', () => {
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

    it('should run aggregation successfully', async () => {
      const mockJobId = 'job-456';
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: mockJobId, message: 'Running' }),
      });

      const result = await runAggregation('test-config', mockConfig);
      expect(result).toBe(mockJobId);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/aggregate'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('getAggregationStatus', () => {
    it('should fetch status via REST API', async () => {
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
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/status/test-config'),
        expect.anything()
      );
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
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/job/job-123'),
        expect.anything()
      );
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'Job not found' }),
      });

      await expect(getJobStatus('job-123')).rejects.toThrow();
    });
  });

  describe('stopAggregation', () => {
    it('should stop aggregation successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await stopAggregation('test-config');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/aggregate/test-config/stop'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });
});
