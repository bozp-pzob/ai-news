import { Config as ConfigType, PluginConfig } from '../types';

/**
 * Class to hold and manage the configuration data
 */
export class Config {
  private data: ConfigType;

  constructor() {
    // Initialize with a default empty config
    this.data = { 
      name: 'Default Config',
      sources: [],
      enrichers: [],
      generators: [],
      ai: [],
      storage: [],
      providers: [],
      settings: {
        runOnce: false,
        onlyFetch: false
      }
    };
  }

  /**
   * Get the current config data
   */
  getData(): ConfigType {
    return this.data;
  }

  /**
   * Load a new configuration
   */
  loadConfig(config: ConfigType): void {
    if (!config) {
      console.error('Config.loadConfig received null or undefined config');
      return;
    }

    // Create a deep copy of the config to avoid reference issues
    let configCopy: ConfigType;
    try {
      configCopy = JSON.parse(JSON.stringify(config));
    } catch (error) {
      console.error('Failed to clone config:', error);
      // Fallback to a simple shallow copy
      configCopy = { ...config };
    }
    
    // Ensure the config has a name
    if (!configCopy.name) {
      console.warn('Config has no name, setting to "default"');
      configCopy.name = 'default';
    }
    
    // Ensure all required arrays exist and are arrays
    configCopy.sources = Array.isArray(configCopy.sources) ? configCopy.sources : [];
    configCopy.enrichers = Array.isArray(configCopy.enrichers) ? configCopy.enrichers : [];
    configCopy.generators = Array.isArray(configCopy.generators) ? configCopy.generators : [];
    configCopy.ai = Array.isArray(configCopy.ai) ? configCopy.ai : [];
    configCopy.storage = Array.isArray(configCopy.storage) ? configCopy.storage : [];
    configCopy.providers = Array.isArray(configCopy.providers) ? configCopy.providers : [];
    
    // Ensure settings object exists
    configCopy.settings = configCopy.settings || {
      runOnce: false,
      onlyFetch: false
    };
    
    // For backward compatibility, ensure providers matches ai content
    if (configCopy.ai && configCopy.ai.length > 0 && configCopy.providers.length === 0) {
      console.log('Setting providers to match AI array');
      configCopy.providers = [...configCopy.ai];
    }
    
    // Save the updated config
    this.data = configCopy;
  }

  /**
   * Update the config data with a new value
   */
  updateConfig(config: ConfigType): void {
    this.data = { ...config };
  }

  /**
   * Update a specific plugin's configuration
   */
  updatePlugin(plugin: PluginConfig): boolean {
    try {
      console.log('Updating plugin:', JSON.stringify(plugin));
      
      // Ensure params is an object
      if (!plugin.params || typeof plugin.params !== 'object') {
        console.error('Invalid plugin params:', plugin.params);
        plugin.params = {};
      }
      
      // Make sure we have a plugin id
      if (!plugin.id) {
        console.error('Plugin has no ID');
        return false;
      }
      
      // Get the node ID parts to determine type and index
      const idParts = plugin.id.split('-');
      const type = idParts[0];
      const index = parseInt(idParts[1]);
      
      // Determine if this is a child node
      const isChild = plugin.isChild === true;
      
      // Update the plugin in the appropriate array
      switch (type) {
        case 'source':
        case 'sources':
          this.updatePluginInArray('sources', plugin, isChild, index);
          break;
        case 'enricher':
        case 'enrichers':
          this.updatePluginInArray('enrichers', plugin, isChild, index);
          break;
        case 'generator':
        case 'generators':
          this.updatePluginInArray('generators', plugin, isChild, index);
          break;
        case 'ai':
          this.updatePluginInArray('ai', plugin, isChild, index);
          break;
        case 'storage':
          this.updatePluginInArray('storage', plugin, isChild, index);
          break;
        default:
          console.error(`Unknown plugin type: ${type}`);
          return false;
      }
      
      return true;
    } catch (error) {
      console.error("Error in updatePlugin:", error);
      return false;
    }
  }

  /**
   * Update a plugin in a specific array of the config
   */
  private updatePluginInArray(
    arrayName: 'sources' | 'enrichers' | 'generators' | 'ai' | 'storage',
    plugin: PluginConfig,
    isChild: boolean,
    index: number
  ): void {
    console.log(`updatePluginInArray: Updating plugin in ${arrayName} at index ${index}`, JSON.stringify(plugin));
    
    // Helper for proper deep copy with array handling
    const deepCopy = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
        // Special handling for arrays to ensure each element is properly copied
        console.log(`📊 Copying array with ${obj.length} elements:`, JSON.stringify(obj));
        return obj.map(item => deepCopy(item));
      }
      
      if (typeof obj === 'object') {
        const copy: any = {};
        for (const key in obj) {
          copy[key] = deepCopy(obj[key]);
        }
        return copy;
      }
      
      return obj;
    };
    
    if (isChild && plugin.parentId) {
      // Handle child node of a parent
      const parentIdParts = plugin.parentId.split('-');
      const parentIndex = parseInt(parentIdParts[1]);
      
      // Find the parent in the array
      if (this.data[arrayName] && this.data[arrayName][parentIndex]) {
        const parent = this.data[arrayName][parentIndex];
        
        // Ensure the parent has params and children array
        if (!parent.params) {
          parent.params = {};
        }
        if (!parent.params.children) {
          parent.params.children = [];
        }
        
        // Find the child index
        const childId = plugin.id;
        // If we know the exact child index
        if (plugin.childIndex !== undefined) {
          const childIndex = plugin.childIndex;
          // Ensure the child exists in the array
          while (parent.params.children.length <= childIndex) {
            parent.params.children.push({});
          }
          
          // Update the child with deep copy
          parent.params.children[childIndex] = {
            ...parent.params.children[childIndex],
            ...deepCopy(plugin.params)
          };
        } else {
          // We don't know the exact index, we need to search or append
          let found = false;
          for (let i = 0; i < parent.params.children.length; i++) {
            if (parent.params.children[i].id === childId) {
              parent.params.children[i] = {
                ...parent.params.children[i],
                ...deepCopy(plugin.params)
              };
              found = true;
              break;
            }
          }
          
          if (!found) {
            // Append as new child
            parent.params.children.push({
              id: childId,
              ...deepCopy(plugin.params)
            });
          }
        }
      }
    } else {
      // Handle regular node
      if (this.data[arrayName] && this.data[arrayName][index]) {
        // Make a deep copy of the plugin params to preserve array values
        const deepCopiedParams = deepCopy(plugin.params);
        
        // Log the parameters being updated
        console.log(`Updating ${arrayName}[${index}].params with:`, JSON.stringify(deepCopiedParams));
        
        // Check for arrays in parameters
        if (deepCopiedParams) {
          for (const key in deepCopiedParams) {
            if (Array.isArray(deepCopiedParams[key])) {
              console.log(`📊 Array parameter ${key} in ${arrayName}[${index}]:`, 
                JSON.stringify(deepCopiedParams[key]));
            }
          }
        }
        
        // Update the plugin params with the deep copy
        this.data[arrayName][index].params = deepCopiedParams;
        
        // Update name if it's changed
        if (this.data[arrayName][index].name !== plugin.name) {
          this.data[arrayName][index].name = plugin.name;
        }
        
        // Log the result of the update
        console.log(`Updated ${arrayName}[${index}]:`, JSON.stringify(this.data[arrayName][index]));
      }
    }
  }

  /**
   * Remove a node from the configuration
   */
  removeNode(nodeId: string): boolean {
    try {
      console.log(`Removing node: ${nodeId}`);

      // Parse the node ID to determine its type and index
      const idParts = nodeId.split('-');
      const nodeType = idParts[0];
      const nodeIndex = parseInt(idParts[1]);

      // Check if this is a child node ID format (like 'source-0-child-1')
      const isChildNodeFormat = idParts.length > 2 && idParts[2] === 'child';
      
      if (isChildNodeFormat) {
        // Handle child node removal
        const parentType = idParts[0];
        const parentIndex = parseInt(idParts[1]);
        const childIndex = parseInt(idParts[3]);
        
        // Get the parent array name based on type
        let arrayName: 'sources' | 'enrichers' | 'generators' | null = null;
        if (parentType === 'source' || parentType === 'sources') {
          arrayName = 'sources';
        } else if (parentType === 'enricher' || parentType === 'enrichers') {
          arrayName = 'enrichers';
        } else if (parentType === 'generator' || parentType === 'generators') {
          arrayName = 'generators';
        }
        
        if (arrayName && this.data[arrayName] && this.data[arrayName][parentIndex]) {
          // Get the parent node
          const parent = this.data[arrayName][parentIndex];
          
          // Ensure parent has params and children
          if (parent.params && parent.params.children && 
              Array.isArray(parent.params.children) && 
              parent.params.children.length > childIndex) {
            
            // Remove the child from the children array
            parent.params.children.splice(childIndex, 1);
            console.log(`Removed child node at index ${childIndex} from parent ${parentType}-${parentIndex}`);
            return true;
          }
        }
        
        console.error(`Could not find parent node or child configuration at specified indices`);
        return false;
      }

      // Standard node removal for non-child nodes
      switch(nodeType) {
        case 'storage':
          // Remove from storage array
          this.data.storage.splice(nodeIndex, 1);
          
          // Clear storage references in other nodes
          this.clearReferencesToNode(nodeId, 'storage');
          break;
        
        case 'ai':
          // Remove from AI array
          this.data.ai.splice(nodeIndex, 1);
          
          // Clear provider references in other nodes
          this.clearReferencesToNode(nodeId, 'provider');
          break;
        
        case 'source':
        case 'sources':
          // Remove from sources array
          this.data.sources.splice(nodeIndex, 1);
          break;
        
        case 'enricher':
        case 'enrichers':
          // Remove from enrichers array
          this.data.enrichers.splice(nodeIndex, 1);
          break;
        
        case 'generator':
        case 'generators':
          // Remove from generators array
          this.data.generators.splice(nodeIndex, 1);
          break;
        
        default:
          console.error(`Unknown node type: ${nodeType}`);
          return false;
      }
      
      return true;
    } catch (error) {
      console.error("Error in removeNode:", error);
      return false;
    }
  }

  /**
   * Clear references to a deleted node
   */
  private clearReferencesToNode(nodeId: string, referenceType: 'storage' | 'provider'): void {
    const nodeName = this.getNodeName(nodeId);
    if (!nodeName) return;
    
    // List of node groups to check
    const nodeGroups = ['sources', 'enrichers', 'generators'] as const;
    
    // Check each node group
    nodeGroups.forEach((nodeGroup) => {
      this.data[nodeGroup].forEach((plugin: PluginConfig) => {
        if (plugin.params?.[referenceType] === nodeName) {
          delete plugin.params[referenceType];
        }
        // Also check children
        if (plugin.params?.children) {
          plugin.params.children.forEach((child: Record<string, any>) => {
            if (child[referenceType] === nodeName) {
              delete child[referenceType];
            }
          });
        }
      });
    });
  }

  /**
   * Get a node's name by its ID
   */
  private getNodeName(nodeId: string): string | undefined {
    const idParts = nodeId.split('-');
    const nodeType = idParts[0];
    const nodeIndex = parseInt(idParts[1]);
    
    switch(nodeType) {
      case 'storage':
        return this.data.storage[nodeIndex]?.name;
      case 'ai':
        return this.data.ai[nodeIndex]?.name;
      case 'source':
      case 'sources':
        return this.data.sources[nodeIndex]?.name;
      case 'enricher':
      case 'enrichers':
        return this.data.enrichers[nodeIndex]?.name;
      case 'generator':
      case 'generators':
        return this.data.generators[nodeIndex]?.name;
      default:
        return undefined;
    }
  }
}

// Export the Config class
export default Config; 