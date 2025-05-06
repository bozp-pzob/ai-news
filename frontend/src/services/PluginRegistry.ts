import { PluginInfo } from '../types';
import { getPlugins } from './api';

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
      console.log('🔌 PluginRegistry: Fetching plugins from API');
      const plugins = await getPlugins();
      this.plugins = plugins;
      this.isLoaded = true;
      console.log('🔌 PluginRegistry: Plugins loaded successfully', Object.keys(plugins));
      
      // Notify all listeners that plugins have been loaded
      this.notifyListeners();
    } catch (error) {
      console.error('🔌 PluginRegistry: Error fetching plugins:', error);
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
   * Find a plugin by name and type
   */
  findPlugin(name: string, type?: string | undefined): PluginInfo | null {
    console.log("PASSED IN NAME", name, type )
    let foundPlugin: PluginInfo | null = null;
    
    // Search through all plugin categories
    Object.values(this.plugins).forEach(categoryPlugins => {
      categoryPlugins.forEach(plugin => {
        console.log('🔌 PluginRegistry: Checking plugin', plugin);
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