import { PluginInfo } from '../types';
import { getPlugins, PlatformType } from './api';

// Static plugin file path
const STATIC_PLUGINS_PATH = '/static/plugins.json';

/**
 * Options for filtering plugins based on user context
 */
export interface PluginFilterOptions {
  /** Whether in platform mode (hides SQLiteStorage) */
  platformMode: boolean;
  /** Set of platform types the user has active connections for */
  connectedPlatforms?: Set<PlatformType>;
}

/**
 * A registry service that fetches and stores plugin information from the backend.
 * This is used to provide plugin schemas for the node graph drag and drop experience
 * and for the plugin parameter dialog.
 */
class PluginRegistry {
  private plugins: Record<string, PluginInfo[]> = {};
  private isLoading: boolean = false;
  private isLoaded: boolean = false;
  private listeners: Set<() => void> = new Set();
  private useStaticPlugins: boolean = false;

  /**
   * Reset the registry state (for testing purposes)
   */
  reset(): void {
    this.plugins = {};
    this.isLoading = false;
    this.isLoaded = false;
    this.listeners.clear();
    this.useStaticPlugins = false;
  }

  /**
   * Load plugins from the static JSON file
   */
  private async loadStaticPlugins(): Promise<boolean> {
    try {
      const response = await fetch(STATIC_PLUGINS_PATH);
      
      // If the file doesn't exist or fails to load, return false
      if (!response.ok) {
        console.info('Static plugins file not found, falling back to API');
        return false;
      }
      
      // Parse the JSON data
      const plugins = await response.json();
      
      // Validate the plugins data
      if (!plugins || typeof plugins !== 'object') {
        console.warn('Invalid static plugins file format');
        return false;
      }
      
      this.plugins = plugins;
      this.isLoaded = true;
      this.useStaticPlugins = true;
      
      // Notify all listeners that plugins have been loaded
      this.notifyListeners();
      
      return true;
    } catch (error) {
      console.info('Error loading static plugins:', error);
      return false;
    }
  }

  /**
   * Fetch plugins from the API if they haven't been loaded yet
   */
  async loadPlugins(): Promise<void> {
    // If already loading or loaded, don't fetch again
    if (this.isLoading || this.isLoaded) {
      return;
    }

    try {
      this.isLoading = true;
      
      // First try to load from static file
      const staticLoaded = await this.loadStaticPlugins();
      
      // If static loading succeeded, we're done
      if (staticLoaded) {
        return;
      }
      
      // If static loading failed, try API with a timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const plugins = await Promise.race([
          getPlugins(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error('Plugin fetch timed out'));
            });
          })
        ]);
        
        clearTimeout(timeoutId);
        this.plugins = plugins;
        this.isLoaded = true;
        
        // Notify all listeners that plugins have been loaded
        this.notifyListeners();
      } catch (apiError) {
        console.warn('🔌 PluginRegistry: API fetch failed or timed out, plugins may be unavailable:', apiError);
        // Mark as loaded anyway to prevent infinite retries
        this.isLoaded = true;
        this.notifyListeners();
      }
    } catch (error) {
      console.error('🔌 PluginRegistry: Error fetching plugins:', error);
      // Mark as loaded to prevent infinite retries
      this.isLoaded = true;
      this.notifyListeners();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Get all available plugins
   */
  getPlugins(): Record<string, PluginInfo[]> {
    return this.plugins;
  }

  /**
   * Get plugins filtered for platform mode
   * Hides SQLiteStorage in platform mode since platform uses PostgreSQL
   * @deprecated Use getPluginsFiltered instead for full filtering support
   */
  getPluginsForMode(platformMode: boolean): Record<string, PluginInfo[]> {
    return this.getPluginsFiltered({ platformMode });
  }

  /**
   * Get plugins filtered based on user context
   * - In platform mode: Hides SQLiteStorage
   * - Hides plugins that require a platform connection if user doesn't have one
   */
  getPluginsFiltered(options: PluginFilterOptions): Record<string, PluginInfo[]> {
    const { platformMode, connectedPlatforms } = options;
    
    if (!platformMode) {
      return this.plugins;
    }
    
    const filtered: Record<string, PluginInfo[]> = {};
    
    for (const [category, plugins] of Object.entries(this.plugins)) {
      filtered[category] = plugins.filter(plugin => {
        // Filter out hidden plugins (deprecated or replaced by unified alternatives)
        if (plugin.hidden) {
          return false;
        }
        
        // If plugin requires a platform connection, check if user has one
        if (plugin.requiresPlatform && connectedPlatforms) {
          return connectedPlatforms.has(plugin.requiresPlatform);
        }
        
        // If plugin requires a platform but we don't have connection info,
        // hide it in platform mode (user needs to connect first)
        if (plugin.requiresPlatform && !connectedPlatforms) {
          return false;
        }
        
        return true;
      });
    }
    
    return filtered;
  }

  /**
   * Find a plugin by name and type
   */
  findPlugin(name: string, type?: string | undefined): PluginInfo | null {
    let foundPlugin: PluginInfo | null = null;
    
    // Search through all plugin categories
    Object.values(this.plugins).forEach(categoryPlugins => {
      categoryPlugins.forEach(plugin => {
        // Match by pluginName instead of name
        if (plugin.pluginName.toLowerCase() === name.toLowerCase()) {
          // If type is specified, check that too
          if (!type || plugin.type === type) {
            foundPlugin = plugin;
          }
        }
      });
    });
    
    return foundPlugin;
  }

  /**
   * Check if plugins have been loaded
   */
  isPluginsLoaded(): boolean {
    return this.isLoaded;
  }

  /**
   * Check if plugins were loaded from static file
   */
  isUsingStaticPlugins(): boolean {
    return this.useStaticPlugins;
  }

  /**
   * Register a listener for plugin loading events
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners that plugins have been updated
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('🔌 PluginRegistry: Error notifying listener:', error);
      }
    });
  }
}

// Create a singleton instance of the registry
export const pluginRegistry = new PluginRegistry(); 