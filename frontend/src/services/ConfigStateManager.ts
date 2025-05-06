import { Config as ConfigType, PluginConfig, AggregationStatus } from '../types';
import { Node, Connection, NodePort } from '../types/nodeTypes';
import { createEventEmitter } from '../utils/eventEmitter';
import { findNodeRecursive, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';
import { Config } from './Config';
import { saveConfig } from '../services/api';

// Event types that can be emitted by the state manager
export type ConfigStateEvent = 
  | 'config-updated'
  | 'nodes-updated'
  | 'connections-updated'
  | 'node-selected'
  | 'plugin-updated';

// The state manager is a singleton that manages application state
class ConfigStateManager {
  private configData: Config;
  private nodes: Node[] = [];
  private connections: Connection[] = [];
  private selectedNode: string | null = null;
  private eventEmitter = createEventEmitter<ConfigStateEvent>();
  private pendingChanges: boolean = false;

  constructor() {
    // Initialize the Config class
    this.configData = new Config();
  }

  // Get the current config
  getConfig(): ConfigType {
    // Make sure the config is up-to-date with any node/connection changes
    this.syncConfigWithNodes();
    
    // Create a deep copy helper to ensure arrays are properly handled
    const deepCopy = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
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
    
    // Return a deep copy to prevent direct reference modifications
    return deepCopy(this.configData.getData());
  }

  // Get the current nodes
  getNodes(): Node[] {
    return this.nodes;
  }

  // Get the current connections
  getConnections(): Connection[] {
    return this.connections;
  }

  // Get the currently selected node
  getSelectedNode(): string | null {
    return this.selectedNode;
  }

  // Check if there are pending changes
  hasPendingChanges(): boolean {
    return this.pendingChanges;
  }

  // Load a new configuration
  loadConfig(config: ConfigType): void {
    console.log('🔄 loadConfig called with:', config?.name || 'unnamed config');

    // First validate that we have a proper config object
    if (!config) {
      console.error('🔄 loadConfig received null or undefined config');
      return;
    }

    // Load the config into our Config class
    this.configData.loadConfig(config);
    
    // Reset selected node when loading a new config
    this.selectedNode = null;
    
    // Rebuild the node graph from the updated config
    this.rebuildNodesAndConnections();
    
    // Important: After rebuilding, sync connections with node ports
    this.updatePortConnectionsFromConnections();
    
    // Ensure node ports are in sync with parameters
    this.nodes = syncNodePortsWithParams(this.nodes);
    
    // Clean up any stale connections
    this.connections = cleanupStaleConnections(this.nodes, this.connections);
    
    // Update port connections again to maintain consistency
    this.updatePortConnectionsFromConnections();
    
    // Notify listeners
    this.eventEmitter.emit('config-updated', this.configData.getData());
    this.eventEmitter.emit('nodes-updated', this.nodes);
    this.eventEmitter.emit('connections-updated', this.connections);
    this.eventEmitter.emit('node-selected', this.selectedNode);
    
    // Reset pending changes flag when loading a new config
    this.pendingChanges = false;
    
    console.log('🔄 loadConfig complete, nodes:', this.nodes.length, 'connections:', this.connections.length);
  }

  // Set the nodes array directly
  setNodes(nodes: Node[]): void {
    // Ensure node ports are in sync with parameters
    this.nodes = syncNodePortsWithParams(nodes);
    
    // Ensure the config is updated with the new node state
    this.syncConfigWithNodes();
    
    // Mark that we have pending changes
    this.pendingChanges = true;
    
    // Emit the update event
    this.eventEmitter.emit('nodes-updated', this.nodes);
    
    // Also notify about the config update
    this.eventEmitter.emit('config-updated', this.configData.getData());
  }

  // Set the connections array directly
  setConnections(connections: Connection[]): void {
    this.connections = [...connections];
    
    // Update all node port connections to match the connections array
    this.updatePortConnectionsFromConnections();
    
    // Ensure node ports are in sync with connections
    this.nodes = syncNodePortsWithParams(this.nodes);
    
    // Clean up any stale connections
    this.connections = cleanupStaleConnections(this.nodes, this.connections);
    
    // Ensure the config is updated with the new connections state
    this.syncConfigWithNodes();
    
    // Mark that we have pending changes
    this.pendingChanges = true;
    
    // Emit the update event
    this.eventEmitter.emit('connections-updated', this.connections);
    this.eventEmitter.emit('nodes-updated', this.nodes);
    
    // Also notify about the config update
    this.eventEmitter.emit('config-updated', this.configData.getData());
  }

  // Helper method to update node port connections based on the connections array
  private updatePortConnectionsFromConnections(): void {
    console.log('🔄 Updating port connections from connections array');
    
    // Keep track of nodes that previously had provider/storage connections
    const nodesWithProviderStorage = new Map<string, {provider?: boolean, storage?: boolean}>();
    
    // Before clearing connections, record which nodes have provider/storage parameters
    const recordNodeParams = (node: Node) => {
      if (node.params) {
        if ('provider' in node.params || 'storage' in node.params) {
          nodesWithProviderStorage.set(node.id, {
            provider: 'provider' in node.params,
            storage: 'storage' in node.params
          });
        }
      }
      
      // Process children if this is a parent node
      if (node.isParent && node.children) {
        node.children.forEach(recordNodeParams);
      }
    };
    
    // Record existing provider/storage params
    this.nodes.forEach(recordNodeParams);
    
    // Clear existing port connections
    const clearNodeConnections = (node: Node) => {
      node.inputs.forEach(input => {
        input.connectedTo = undefined;
      });
      
      node.outputs.forEach(output => {
        output.connectedTo = undefined;
      });
      
      // Process children if this is a parent node
      if (node.isParent && node.children) {
        node.children.forEach(clearNodeConnections);
      }
    };
    
    // Clear all existing connections
    this.nodes.forEach(clearNodeConnections);
    
    // Set connections based on the connections array
    this.connections.forEach(connection => {
      // Find the source and target nodes
      const sourceNode = findNodeRecursive(this.nodes, connection.from.nodeId);
      const targetNode = findNodeRecursive(this.nodes, connection.to.nodeId);
      
      if (sourceNode && targetNode) {
        // Update source node output
        const sourceOutput = sourceNode.outputs.find(output => output.name === connection.from.output);
        if (sourceOutput) {
          sourceOutput.connectedTo = connection.to.nodeId;
        }
        
        // Update target node input
        const targetInput = targetNode.inputs.find(input => input.name === connection.to.input);
        if (targetInput) {
          targetInput.connectedTo = connection.from.nodeId;
          
          // For provider and storage connections, also update the node params
          if (connection.to.input === 'provider' && sourceNode.name) {
            if (!targetNode.params) targetNode.params = {};
            targetNode.params.provider = sourceNode.name;
            
            // Emit plugin update for this change
            setTimeout(() => {
              this.eventEmitter.emit('plugin-updated', {
                id: targetNode.id,
                type: targetNode.type,
                name: targetNode.name,
                params: { ...targetNode.params },
                interval: targetNode.interval
              });
            }, 0);
          }
          
          if (connection.to.input === 'storage' && sourceNode.name) {
            if (!targetNode.params) targetNode.params = {};
            targetNode.params.storage = sourceNode.name;
            
            // Emit plugin update for this change
            setTimeout(() => {
              this.eventEmitter.emit('plugin-updated', {
                id: targetNode.id,
                type: targetNode.type,
                name: targetNode.name,
                params: { ...targetNode.params },
                interval: targetNode.interval
              });
            }, 0);
          }
        }
      }
    });
    
    // Check for nodes that previously had provider/storage params but now don't have connections
    const checkForRemovedConnections = (node: Node) => {
      if (!node.id) return;
      
      const prevState = nodesWithProviderStorage.get(node.id);
      if (prevState) {
        let shouldEmitUpdate = false;
        
        // FIXED: Don't delete provider parameters when connections are removed
        // Only mark params as "disconnected" by setting to null but keeping the param
        
        // Check if provider connection was removed
        if (prevState.provider) {
          const hasProviderConnection = node.inputs.some(input => 
            input.name === 'provider' && input.connectedTo !== undefined
          );
          
          if (!hasProviderConnection && node.params && 'provider' in node.params) {
            // Instead of deleting the param, set it to null to indicate disconnection
            // but preserve the knowledge that this node can have a provider
            node.params.provider = null;
            shouldEmitUpdate = true;
          }
        }
        
        // Check if storage connection was removed
        if (prevState.storage) {
          const hasStorageConnection = node.inputs.some(input => 
            input.name === 'storage' && input.connectedTo !== undefined
          );
          
          if (!hasStorageConnection && node.params && 'storage' in node.params) {
            // Instead of deleting the param, set it to null to indicate disconnection
            // but preserve the knowledge that this node can have a storage
            node.params.storage = null;
            shouldEmitUpdate = true;
          }
        }
        
        // Emit plugin-updated event if needed
        if (shouldEmitUpdate) {
          setTimeout(() => {
            this.eventEmitter.emit('plugin-updated', {
              id: node.id,
              type: node.type,
              name: node.name,
              params: { ...node.params },
              interval: node.interval
            });
          }, 0);
        }
      }
      
      // Process children if this is a parent node
      if (node.isParent && node.children) {
        node.children.forEach(checkForRemovedConnections);
      }
    };
    
    // Check all nodes for removed connections
    this.nodes.forEach(checkForRemovedConnections);
    
    // Make sure to sync the updated node parameters to the config
    this.syncConfigWithNodes();
  }

  // Set the selected node
  setSelectedNode(nodeId: string | null): void {
    this.selectedNode = nodeId;
    this.eventEmitter.emit('node-selected', this.selectedNode);
  }

  // Find a node by its ID
  findNodeById(id: string): Node | undefined {
    return findNodeRecursive(this.nodes, id);
  }

  // Update a plugin's parameters
  updatePlugin(plugin: PluginConfig): boolean {
    try {
      console.log('🔄 Updating plugin:', JSON.stringify(plugin));
      
      // Deep copy helper to ensure arrays are preserved
      const deepCopy = (obj: any): any => {
        if (obj === null || obj === undefined) {
          return obj;
        }
        
        if (Array.isArray(obj)) {
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
      
      // Make sure we have a plugin id
      if (!plugin.id) {
        console.error('Plugin has no ID');
        return false;
      }
      
      // Find the node to update
      const nodeToUpdate = findNodeRecursive(this.nodes, plugin.id);
      if (!nodeToUpdate) {
        console.error(`Could not find node with ID ${plugin.id}`);
        return false;
      }
      
      // Store previous values to check for connection changes
      const prevParams = nodeToUpdate.params ? { ...nodeToUpdate.params } : {};
      
      // Deep copy the plugin params to avoid reference issues
      const paramsCopy = deepCopy(plugin.params || {});
      
      // Check for array parameters
      for (const key in paramsCopy) {
        if (Array.isArray(paramsCopy[key])) {
          console.log(`📊 Array parameter ${key} in plugin update:`, JSON.stringify(paramsCopy[key]));
        }
      }
      
      // Update node properties in the UI
      nodeToUpdate.name = plugin.name;
      nodeToUpdate.params = paramsCopy;
      
      // Update the interval if provided for source and generator nodes
      if ((plugin.type === 'source' || plugin.type === 'generator') && plugin.interval !== undefined) {
        nodeToUpdate.interval = plugin.interval;
      }
      
      // Create a deep copy of the plugin with our deep-copied params
      const pluginCopy = {
        ...plugin,
        params: paramsCopy
      };
      
      // FIXED: Handle the special case where a node is marked as isChild but needs to be updated directly
      // This fixes the issue with array parameters not being properly saved in the config
      if (plugin.isChild && plugin.type === 'source' && plugin.id.startsWith('source-')) {
        
        const [type, indexStr] = plugin.id.split('-');
        const index = parseInt(indexStr);
        
        if (!isNaN(index) && this.configData.getData().sources && this.configData.getData().sources[index]) {
          console.log(`📊 Direct update of source node with array params that was marked as isChild: ${plugin.id}`);
          
          // Update the source directly in the config with deep copied params
          this.configData.getData().sources[index].params = deepCopy(plugin.params);
          
          // Also update the name if needed
          if (this.configData.getData().sources[index].name !== plugin.name) {
            this.configData.getData().sources[index].name = plugin.name;
          }

          // Update interval if provided for source nodes
          if (plugin.interval !== undefined) {
            this.configData.getData().sources[index].interval = plugin.interval;
            nodeToUpdate.interval = plugin.interval;
          }
        }
      } else {
        // Normal update via the Config class
        const result = this.configData.updatePlugin(pluginCopy);
        if (!result) {
          console.error(`Failed to update plugin in config data: ${plugin.id}`);
          return false;
        }
      }
      
      // Check for provider/storage parameter changes that require connection updates
      if (nodeToUpdate.inputs && nodeToUpdate.inputs.length > 0) {
        // Track connection changes
        let connectionChanges = false;
        
        // Handle provider connection changes
        if (nodeToUpdate.inputs.some(input => input.name === 'provider')) {
          const nodeParams = nodeToUpdate.params || {};
          // Provider was removed
          if (prevParams.provider && !nodeParams.provider) {
            // Find and remove the connection
            this.connections = this.connections.filter(conn => 
              !(conn.to.nodeId === nodeToUpdate.id && conn.to.input === 'provider')
            );
            connectionChanges = true;
          }
          // Provider was changed or added
          else if (nodeParams.provider && 
                  (prevParams.provider !== nodeParams.provider || !prevParams.provider)) {
            // Remove existing provider connection if any
            this.connections = this.connections.filter(conn => 
              !(conn.to.nodeId === nodeToUpdate.id && conn.to.input === 'provider')
            );
            
            // Find provider node by name
            const providerName = nodeParams.provider;
            const providerNode = this.nodes.find(node => 
              node.type === 'ai' && node.name === providerName
            );
            
            if (providerNode) {
              // Add new connection
              this.connections.push({
                from: { nodeId: providerNode.id, output: 'provider' },
                to: { nodeId: nodeToUpdate.id, input: 'provider' }
              });
              connectionChanges = true;
            }
          }
        }
        
        // Handle storage connection changes
        if (nodeToUpdate.inputs.some(input => input.name === 'storage')) {
          const nodeParams = nodeToUpdate.params || {};
          // Storage was removed
          if (prevParams.storage && !nodeParams.storage) {
            // Find and remove the connection
            this.connections = this.connections.filter(conn => 
              !(conn.to.nodeId === nodeToUpdate.id && conn.to.input === 'storage')
            );
            connectionChanges = true;
          }
          // Storage was changed or added
          else if (nodeParams.storage && 
                  (prevParams.storage !== nodeParams.storage || !prevParams.storage)) {
            // Remove existing storage connection if any
            this.connections = this.connections.filter(conn => 
              !(conn.to.nodeId === nodeToUpdate.id && conn.to.input === 'storage')
            );
            
            // Find storage node by name
            const storageName = nodeParams.storage;
            const storageNode = this.nodes.find(node => 
              node.type === 'storage' && node.name === storageName
            );
            
            if (storageNode) {
              // Add new connection
              this.connections.push({
                from: { nodeId: storageNode.id, output: 'storage' },
                to: { nodeId: nodeToUpdate.id, input: 'storage' }
              });
              connectionChanges = true;
            }
          }
        }
        
        // If connections changed, update the connections in the UI
        if (connectionChanges) {
          // Update port connections to match the connections array
          this.updatePortConnectionsFromConnections();
        }
      }
      
      // Force sync to make sure all changes are applied
      this.forceSync();
      
      // Mark that we have pending changes
      this.pendingChanges = true;
      
      // Notify listeners
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      this.eventEmitter.emit('config-updated', this.configData.getData());
      this.eventEmitter.emit('plugin-updated', {
        ...plugin,
        params: nodeToUpdate.params,
        interval: nodeToUpdate.interval
      });
      
      return true;
    } catch (error) {
      console.error("Error in updatePlugin:", error);
      return false;
    }
  }

  // Subscribe to state changes
  subscribe(event: ConfigStateEvent, callback: (data?: any) => void): () => void {
    return this.eventEmitter.on(event, callback);
  }

  // Rebuild nodes and connections from the config
  private rebuildNodesAndConnections(): void {
    console.log('🏗️ rebuildNodesAndConnections: Starting node rebuild');
    
    const config = this.configData.getData();
    console.log('Config:', JSON.stringify(config));
    
    const newNodes: Node[] = [];
    const newConnections: Connection[] = [];
    
    // Base spacing between nodes
    const nodeSpacing = 45;
    const groupSpacing = 80; // Fixed spacing between parent groups
    const childNodeSpacing = 45; // Spacing for child nodes within parents
    
    // Use a larger spacing for storage nodes to prevent overlap
    const storageNodeSpacing = 100;
    
    // Define columns for better organization
    const leftColumnX = 50;    // Left side for Storage and AI/Provider nodes
    const sourceColumnX = 500; // Sources, Enrichers, Generators in middle
    
    // Calculate max height of storage nodes to position AI nodes below them
    const storageHeight = config.storage && config.storage.length > 0 
      ? 100 + (config.storage.length * storageNodeSpacing)
      : 100;
    
    // Track vertical positions for parent groups
    let currentY = 50; // Starting Y position
    
    // Add Storage nodes on left side of canvas (top) with increased spacing
    if (config.storage && config.storage.length > 0) {
      console.log('🏗️ Creating storage nodes:', config.storage.length);
      config.storage.forEach((storage, index) => {
        newNodes.push({
          id: `storage-${index}`,
          type: 'storage',
          name: storage.name,
          pluginName: storage.type || storage.name,
          position: { x: leftColumnX, y: 100 + index * storageNodeSpacing },
          inputs: [],
          outputs: [this.createNodeOutput('storage', 'storage')],
          params: storage.params || {},
        });
      });
    } else {
      console.log('🏗️ No storage nodes to create');
    }
    
    // Add AI/Provider nodes on left side of canvas (below storage)
    if (config.ai && config.ai.length > 0) {
      console.log('🏗️ Creating AI nodes:', config.ai.length);
      config.ai.forEach((ai, index) => {
        newNodes.push({
          id: `ai-${index}`,
          type: 'ai',
          name: ai.name,
          pluginName: ai.type || ai.name,
          position: { x: leftColumnX, y: storageHeight + 100 + index * storageNodeSpacing },
          inputs: [],
          outputs: [this.createNodeOutput('provider', 'provider')],
          params: ai.params || {},
        });
      });
    }
    
    // Add Sources group - first parent node at the top
    if (config.sources && config.sources.length > 0) {
      console.log('🏗️ Creating source nodes:', config.sources.length);
      const sourceChildren = config.sources.map((source, index) => {
        // Create node
        const node = {
          id: `source-${index}`,
          type: 'source',
          name: source.name,
          pluginName: source.type || source.name,
          position: { x: sourceColumnX, y: currentY + 50 + index * childNodeSpacing },
          inputs: [
            ...(source.params?.provider ? [this.createNodeInput('provider', 'provider')] : []),
            ...(source.params?.storage ? [this.createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: source.params || {},
          interval: source.interval !== undefined ? source.interval : 60000
        };
        
        // Add connections
        if (source.params?.provider) {
          this.addProviderConnection(node, source.params.provider, newConnections);
        }
        
        if (source.params?.storage) {
          this.addStorageConnection(node, source.params.storage, newConnections);
        }
        
        return node;
      });
      
      // Add the sources group
      newNodes.push({
        id: 'sources-group',
        type: 'group',
        name: 'Sources',
        position: { x: sourceColumnX, y: currentY },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: sourceChildren
      });
      
      // Update current Y position based on the height of this group
      const sourceGroupHeight = 50 + (sourceChildren.length * childNodeSpacing);
      currentY += sourceGroupHeight + groupSpacing;
    }
    
    // Add Enrichers group below Sources
    if (config.enrichers && config.enrichers.length > 0) {
      console.log('🏗️ Creating enricher nodes:', config.enrichers.length);
      const enricherChildren = config.enrichers.map((enricher, index) => {
        // Create node
        const node = {
          id: `enricher-${index}`,
          type: 'enricher',
          name: enricher.name,
          pluginName: enricher.type || enricher.name,
          position: { x: sourceColumnX, y: currentY + 50 + index * childNodeSpacing },
          inputs: [
            ...(enricher.params?.provider ? [this.createNodeInput('provider', 'provider')] : []),
            ...(enricher.params?.storage ? [this.createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: enricher.params || {},
        };
        
        // Add connections
        if (enricher.params?.provider) {
          this.addProviderConnection(node, enricher.params.provider, newConnections);
        }
        
        if (enricher.params?.storage) {
          this.addStorageConnection(node, enricher.params.storage, newConnections);
        }
        
        return node;
      });
      
      // Add the enrichers group
      newNodes.push({
        id: 'enrichers-group',
        type: 'group',
        name: 'Enrichers',
        position: { x: sourceColumnX, y: currentY },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: enricherChildren
      });
      
      // Update current Y position based on the height of this group
      const enrichersGroupHeight = 50 + (enricherChildren.length * childNodeSpacing);
      currentY += enrichersGroupHeight + groupSpacing;
    }
    
    // Add Generators group below Enrichers
    if (config.generators && config.generators.length > 0) {
      console.log('🏗️ Creating generator nodes:', config.generators.length);
      const generatorChildren = config.generators.map((generator, index) => {
        // Create node
        const node = {
          id: `generator-${index}`,
          type: 'generator',
          name: generator.name,
          pluginName: generator.type || generator.name,
          position: { x: sourceColumnX, y: currentY + 50 + index * childNodeSpacing },
          inputs: [
            ...(generator.params?.provider ? [this.createNodeInput('provider', 'provider')] : []),
            ...(generator.params?.storage ? [this.createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: generator.params || {},
          interval: generator.interval !== undefined ? generator.interval : 60000
        };
        
        // Add connections
        if (generator.params?.provider) {
          this.addProviderConnection(node, generator.params.provider, newConnections);
        }
        
        if (generator.params?.storage) {
          this.addStorageConnection(node, generator.params.storage, newConnections);
        }
        
        return node;
      });
      
      // Add the generators group
      newNodes.push({
        id: 'generators-group',
        type: 'group',
        name: 'Generators',
        position: { x: sourceColumnX, y: currentY },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: generatorChildren
      });
    }
    
    // Log the results before updating state
    console.log('🏗️ Rebuild complete - Created Nodes:', newNodes.length, 'Connections:', newConnections.length);
    
    // Update our state
    this.nodes = newNodes;
    this.connections = newConnections;
  }

  // Add a provider connection based on the provider name
  private addProviderConnection(node: any, providerName: string, connections: Connection[]): void {
    if (!providerName) return;
    
    const config = this.configData.getData();
    if (!config.ai) return;
    
    const providerIndex = config.ai.findIndex(p => p.name === providerName);
    if (providerIndex !== -1) {
      const providerId = `ai-${providerIndex}`;
      connections.push({
        from: { nodeId: providerId, output: 'provider' },
        to: { nodeId: node.id, input: 'provider' }
      });
      
      // Update connectedTo property
      const providerInput = node.inputs.find((i: any) => i.name === 'provider');
      if (providerInput) {
        providerInput.connectedTo = providerId;
      }
    }
  }
  
  // Add a storage connection based on the storage name
  private addStorageConnection(node: any, storageName: string, connections: Connection[]): void {
    if (!storageName) return;
    
    const config = this.configData.getData();
    if (!config.storage) return;
    
    const storageIndex = config.storage.findIndex(s => s.name === storageName);
    if (storageIndex !== -1) {
      const storageId = `storage-${storageIndex}`;
      connections.push({
        from: { nodeId: storageId, output: 'storage' },
        to: { nodeId: node.id, input: 'storage' }
      });
      
      // Update connectedTo property
      const storageInput = node.inputs.find((i: any) => i.name === 'storage');
      if (storageInput) {
        storageInput.connectedTo = storageId;
      }
    }
  }
  
  // Helper to create a node input port
  private createNodeInput(name: string, type: string): NodePort {
    return { name, type, connectedTo: undefined };
  }
  
  // Helper to create a node output port
  private createNodeOutput(name: string, type: string): NodePort {
    return { name, type, connectedTo: undefined };
  }

  // Synchronize the config object with the current nodes and connections
  private syncConfigWithNodes(): void {
    if (!this.configData) return;
    
    console.log('🔄 syncConfigWithNodes: Synchronizing node/connection state to config');
    
    // Create a deep copy of the config to avoid mutation
    // FIXED: Don't use JSON.parse(JSON.stringify()) as it doesn't handle array references correctly
    // const updatedConfig = JSON.parse(JSON.stringify(this.configData.getData()));
    
    // Helper function to deep copy objects with proper array handling
    const deepCopy = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      
      if (Array.isArray(obj)) {
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
    
    // Use our deepCopy function instead of JSON.parse/stringify
    const updatedConfig = deepCopy(this.configData.getData());
    let hasChanges = false;
    
    // Process each node to update the config
    for (const node of this.nodes) {
      // Skip nodes without parameters
      if (!node.params) continue;
      
      // Get the node type and index from the ID
      const [type, indexStr] = node.id.split('-');
      const index = parseInt(indexStr);
      
      // Skip invalid indices
      if (isNaN(index)) continue;
      
      // Update the appropriate section of the config
      switch (type) {
        case 'source':
          if (updatedConfig.sources && updatedConfig.sources[index]) {
            if (JSON.stringify(updatedConfig.sources[index].params) !== JSON.stringify(node.params)) {
              // Use deep copy to ensure arrays are properly cloned
              updatedConfig.sources[index].params = deepCopy(node.params);
              hasChanges = true;
            }
            
            // Also sync interval values for source nodes
            const sourceInterval = updatedConfig.sources[index].interval;
            if (sourceInterval !== undefined && node.interval !== sourceInterval) {
              console.log(`Updating source[${index}] interval from ${updatedConfig.sources[index].interval} to ${node.interval}`);
              updatedConfig.sources[index].interval = node.interval;
              hasChanges = true;
            }
          }
          break;
        case 'enricher':
          if (updatedConfig.enrichers && updatedConfig.enrichers[index]) {
            if (JSON.stringify(updatedConfig.enrichers[index].params) !== JSON.stringify(node.params)) {
              // Use deep copy to ensure arrays are properly cloned
              updatedConfig.enrichers[index].params = deepCopy(node.params);
              hasChanges = true;
            }
          }
          break;
        case 'generator':
          if (updatedConfig.generators && updatedConfig.generators[index]) {
            if (JSON.stringify(updatedConfig.generators[index].params) !== JSON.stringify(node.params)) {
              // Use deep copy to ensure arrays are properly cloned
              updatedConfig.generators[index].params = deepCopy(node.params);
              hasChanges = true;
            }
            
            // Also sync interval values for generator nodes
            const generatorInterval = updatedConfig.generators[index].interval;
            if (generatorInterval !== undefined && node.interval !== generatorInterval) {
              console.log(`Updating generator[${index}] interval from ${updatedConfig.generators[index].interval} to ${node.interval}`);
              updatedConfig.generators[index].interval = node.interval;
              hasChanges = true;
            }
          }
          break;
        case 'ai':
          if (updatedConfig.ai && updatedConfig.ai[index]) {
            if (JSON.stringify(updatedConfig.ai[index].params) !== JSON.stringify(node.params)) {
              // Use deep copy to ensure arrays are properly cloned
              updatedConfig.ai[index].params = deepCopy(node.params);
              hasChanges = true;
            }
          }
          break;
        case 'storage':
          if (updatedConfig.storage && updatedConfig.storage[index]) {
            if (JSON.stringify(updatedConfig.storage[index].params) !== JSON.stringify(node.params)) {
              // Use deep copy to ensure arrays are properly cloned
              updatedConfig.storage[index].params = deepCopy(node.params);
              hasChanges = true;
            }
          }
          break;
      }
    }
    
    // For parent nodes, also process their children
    for (const node of this.nodes) {
      if (node.isParent && node.children && node.children.length > 0) {
        const [parentType, parentIndexStr] = node.id.split('-');
        const parentIndex = parseInt(parentIndexStr);
        
        if (isNaN(parentIndex)) continue;
        
        // Process each child
        for (let i = 0; i < node.children.length; i++) {
          const childNode = node.children[i];
          if (!childNode.params) continue;
          
          // Get the parent array based on type
          let parentArray: PluginConfig[] | undefined;
          switch (parentType) {
            case 'sources':
              parentArray = updatedConfig.sources;
              break;
            case 'enrichers':
              parentArray = updatedConfig.enrichers;
              break;
            case 'generators':
              parentArray = updatedConfig.generators;
              break;
          }
          
          if (parentArray && parentArray[parentIndex]) {
            // Ensure params and children exist
            if (!parentArray[parentIndex].params) {
              parentArray[parentIndex].params = {};
              hasChanges = true;
            }
            
            if (!parentArray[parentIndex].params.children) {
              parentArray[parentIndex].params.children = [];
              hasChanges = true;
            }
            
            // Ensure there's a place for this child
            while (parentArray[parentIndex].params.children.length <= i) {
              parentArray[parentIndex].params.children.push({});
              hasChanges = true;
            }
            
            // Update the child params if different
            if (JSON.stringify(parentArray[parentIndex].params.children[i]) !== JSON.stringify(childNode.params)) {
              // Use deep copy to ensure arrays are properly cloned
              parentArray[parentIndex].params.children[i] = deepCopy(childNode.params);
              hasChanges = true;
            }
          }
        }
      }
    }
    
    // Ensure connection-based parameters are properly reflected
    // This handles provider/storage references
    for (const connection of this.connections) {
      const sourceNode = findNodeRecursive(this.nodes, connection.from.nodeId);
      const targetNode = findNodeRecursive(this.nodes, connection.to.nodeId);
      
      if (sourceNode && targetNode) {
        // Handle provider connections
        if (connection.to.input === 'provider' && 
            sourceNode.type === 'ai' && 
            sourceNode.name) {
          
          // Find the target node in the config
          const [targetType, targetIndexStr] = targetNode.id.split('-');
          const targetIndex = parseInt(targetIndexStr);
          
          if (!isNaN(targetIndex)) {
            let targetArray: PluginConfig[] | undefined;
            
            // Determine which array the target node belongs to
            switch (targetType) {
              case 'source':
                targetArray = updatedConfig.sources;
                break;
              case 'enricher':
                targetArray = updatedConfig.enrichers;
                break;
              case 'generator':
                targetArray = updatedConfig.generators;
                break;
            }
            
            // Update the provider parameter
            if (targetArray && targetArray[targetIndex]) {
              if (!targetArray[targetIndex].params) {
                targetArray[targetIndex].params = {};
              }
              
              if (targetArray[targetIndex].params.provider !== sourceNode.name) {
                targetArray[targetIndex].params.provider = sourceNode.name;
                hasChanges = true;
              }
            }
          }
        }
        
        // Handle storage connections
        if (connection.to.input === 'storage' && 
            sourceNode.type === 'storage' && 
            sourceNode.name) {
          
          // Find the target node in the config
          const [targetType, targetIndexStr] = targetNode.id.split('-');
          const targetIndex = parseInt(targetIndexStr);
          
          if (!isNaN(targetIndex)) {
            let targetArray: PluginConfig[] | undefined;
            
            // Determine which array the target node belongs to
            switch (targetType) {
              case 'source':
                targetArray = updatedConfig.sources;
                break;
              case 'enricher':
                targetArray = updatedConfig.enrichers;
                break;
              case 'generator':
                targetArray = updatedConfig.generators;
                break;
            }
            
            // Update the storage parameter
            if (targetArray && targetArray[targetIndex]) {
              if (!targetArray[targetIndex].params) {
                targetArray[targetIndex].params = {};
              }
              
              if (targetArray[targetIndex].params.storage !== sourceNode.name) {
                targetArray[targetIndex].params.storage = sourceNode.name;
                hasChanges = true;
              }
            }
          }
        }
      }
    }
    
    // Only update if there were actual changes
    if (hasChanges) {
      console.log('🔄 syncConfigWithNodes: Changes detected, updating config');
      this.configData.updateConfig(updatedConfig);
      this.notifyListeners();
    } else {
      console.log('🔄 syncConfigWithNodes: No changes detected');
    }
  }

  // Helper method to generate a child node ID for config operations
  private generateChildNodeId(parentNode: Node, childIndex: number): string {
    if (!parentNode.id) return '';
    
    const parentIdParts = parentNode.id.split('-');
    const parentType = parentIdParts[0];
    const parentIndex = parseInt(parentIdParts[1]);
    
    return `${parentType}-${parentIndex}-child-${childIndex}`;
  }

  // Helper method to reindex nodes after a deletion
  private reindexNodes(): void {
    console.log('Reindexing nodes to ensure IDs match array indices');
    
    const config = this.configData.getData();
    
    // Temporary map to store old-to-new ID mappings
    const idMappings = new Map<string, string>();
    
    // Reindex source nodes
    if (config.sources) {
      config.sources.forEach((source, index) => {
        const oldId = `source-${index}`;
        const newId = `source-${index}`;
        idMappings.set(oldId, newId);
      });
    }
    
    // Reindex enricher nodes
    if (config.enrichers) {
      config.enrichers.forEach((enricher, index) => {
        const oldId = `enricher-${index}`;
        const newId = `enricher-${index}`;
        idMappings.set(oldId, newId);
      });
    }
    
    // Reindex generator nodes
    if (config.generators) {
      config.generators.forEach((generator, index) => {
        const oldId = `generator-${index}`;
        const newId = `generator-${index}`;
        idMappings.set(oldId, newId);
      });
    }
    
    // Reindex AI nodes
    if (config.ai) {
      config.ai.forEach((ai, index) => {
        const oldId = `ai-${index}`;
        const newId = `ai-${index}`;
        idMappings.set(oldId, newId);
      });
    }
    
    // Reindex storage nodes
    if (config.storage) {
      config.storage.forEach((storage, index) => {
        const oldId = `storage-${index}`;
        const newId = `storage-${index}`;
        idMappings.set(oldId, newId);
      });
    }
    
    // Update node IDs in the connections
    this.connections = this.connections.map(conn => {
      const fromNodeId = idMappings.get(conn.from.nodeId) || conn.from.nodeId;
      const toNodeId = idMappings.get(conn.to.nodeId) || conn.to.nodeId;
      
      return {
        ...conn,
        from: { ...conn.from, nodeId: fromNodeId },
        to: { ...conn.to, nodeId: toNodeId }
      };
    });
    
    // Complete rebuild to ensure all references are updated
    this.rebuildNodesAndConnections();
  }

  // Remove a node from the configuration and graph
  removeNode(nodeId: string): boolean {
    try {
      console.log(`🗑️ Removing node: ${nodeId}`);

      // Find the node
      const node = this.findNodeById(nodeId);
      if (!node) {
        console.error(`Node with ID ${nodeId} not found`);
        return false;
      }
      
      // Remove the node from the config first
      const configResult = this.configData.removeNode(nodeId);
      if (!configResult) {
        console.error(`Failed to remove node from config: ${nodeId}`);
        return false;
      }

      // Check if this node is a child of a parent node
      let isChildNode = false;
      let parentNode: Node | undefined;
      let childIndex = -1;

      // Find if this is a child node by looking through all parent nodes
      for (const n of this.nodes) {
        if (n.isParent && n.children) {
          childIndex = n.children.findIndex(child => child.id === nodeId);
          if (childIndex !== -1) {
            isChildNode = true;
            parentNode = n;
            
            // Found the child node, remove it from the parent's children array
            console.log(`Found node ${nodeId} as child of parent ${n.id}, at child index ${childIndex}`);
            
            // Create updated nodes array with the child removed from the parent
            this.nodes = this.nodes.map(node => {
              if (node.id === parentNode!.id && node.children) {
                // Remove the child node
                const updatedChildren = node.children.filter(child => child.id !== nodeId);
                
                // Recalculate positions for remaining children
                const childNodeSpacing = 45; // Same spacing as used in rebuildNodesAndConnections
                updatedChildren.forEach((child, index) => {
                  child.position.y = node.position.y + 50 + index * childNodeSpacing;
                });
                
                return {
                  ...node,
                  children: updatedChildren
                };
              }
              return node;
            });
            
            // Generate child node ID for config operations
            const childNodeId = this.generateChildNodeId(parentNode, childIndex);
            console.log(`Constructed child node ID for config: ${childNodeId}`);
            
            // Remove from config data with the constructed child ID
            this.configData.removeNode(childNodeId);
            
            break;
          }
        }
      }

      // If it's not a child node, remove it from the main nodes array
      if (!isChildNode) {
        // Remove the node from our nodes array
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        
        // Remove any connections involving this node
        this.connections = this.connections.filter(conn => 
          conn.from.nodeId !== nodeId && conn.to.nodeId !== nodeId
        );
      }

      // If the selected node was removed, clear selection
      if (this.selectedNode === nodeId) {
        this.selectedNode = null;
        this.eventEmitter.emit('node-selected', null);
      }
      
      // Reindex nodes to ensure proper ID-to-index mapping
      this.reindexNodes();
      
      // Completely rebuild nodes and connections from the config
      // This ensures all node IDs are regenerated correctly after deletion
      this.rebuildNodesAndConnections();
      
      // Force sync to ensure all references are clean
      this.forceSync();

      // Mark that we have pending changes
      this.pendingChanges = true;
      
      // Emit events to update the UI
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      this.eventEmitter.emit('config-updated', this.configData.getData());
      
      console.log('Node removal complete. Nodes count:', this.nodes.length);
      return true;
    } catch (error) {
      console.error("Error in removeNode:", error);
      return false;
    }
  }

  // Save the current config to the server
  saveToServer(): Promise<boolean> {
    console.log('🔄 Saving config to server');
    try {
      // Ensure the config is up-to-date with the current node state
      this.syncConfigWithNodes();
      
      const config = this.configData.getData();

      console.log('CONFIG: ', config)
      
      // Make sure we have a config name
      if (!config.name || typeof config.name !== 'string') {
        console.error('Cannot save config without a name');
        return Promise.reject(new Error('Config must have a name'));
      }
      
      // Debug log the config that will be saved
      console.log('🔄 Config to be saved:', JSON.stringify(config));
      
      // Look for array parameters in the config nodes
      const nodeTypes = ['sources', 'enrichers', 'generators', 'ai', 'storage'] as const;
      for (const type of nodeTypes) {
        const configArray = config[type as keyof typeof config];
        if (configArray && Array.isArray(configArray)) {
          for (let i = 0; i < configArray.length; i++) {
            const node = configArray[i] as PluginConfig;
            if (node && node.params) {
              // Check if any params are arrays
              for (const paramKey in node.params) {
                if (Array.isArray(node.params[paramKey])) {
                  console.log(`📊 Found array parameter in ${type}[${i}].params.${paramKey}:`, 
                    JSON.stringify(node.params[paramKey]));
                }
              }
            }
          }
        }
      }
      
      // Use dynamic import to avoid circular dependencies
      return saveConfig(config.name as string, config)
        .then(() => {
          console.log(`🔄 Configuration ${config.name} saved to server`);
          
          // Reset pending changes flag after successful save
          this.pendingChanges = false;
          
          return true;
        })
        .catch(error => {
          console.error('🔄 Error saving config to server:', error);
            return false;
        });
    } catch (error) {
      console.error('Error in saveToServer:', error);
      return Promise.reject(error);
    }
  }

  // Update the full config and notify listeners
  updateConfig(config: ConfigType): void {
    this.configData.updateConfig(config);
    this.rebuildNodesAndConnections();
    
    // Ensure port connections are correctly updated
    this.updatePortConnectionsFromConnections();
    
    // Make sure nodes and connections are in sync
    this.nodes = syncNodePortsWithParams(this.nodes);
    this.connections = cleanupStaleConnections(this.nodes, this.connections);
    
    // Sync back to ensure config is fully updated
    this.syncConfigWithNodes();
    
    // Notify listeners about the changes
    this.eventEmitter.emit('config-updated', this.configData.getData());
    this.eventEmitter.emit('nodes-updated', this.nodes);
    this.eventEmitter.emit('connections-updated', this.connections);
  }

  // Force synchronization of state with config - maintained for backwards compatibility
  forceSync(): void {
    console.log('🔄 ForceSync called - Syncing config data and updating all subscribers');
    
    // Important: First update port connections from the connections array
    this.updatePortConnectionsFromConnections();
    
    // Ensure node ports are in sync with parameters
    this.nodes = syncNodePortsWithParams(this.nodes);
    
    // Clean up any stale connections
    this.connections = cleanupStaleConnections(this.nodes, this.connections);
    
    // Update port connections again to maintain consistency
    this.updatePortConnectionsFromConnections();
    
    // First synchronize the config with the current nodes and connections
    this.syncConfigWithNodes();
    
    // Force update all subscribers with the current state
    this.eventEmitter.emit('config-updated', this.configData.getData());
    this.eventEmitter.emit('nodes-updated', this.nodes);
    this.eventEmitter.emit('connections-updated', this.connections);
      
    // Mark that we have pending changes
    this.pendingChanges = true;
    
    console.log('🔄 ForceSync complete - All subscribers notified');
  }

  private updateNodes(newNodes: Node[]): void {
    // Only update if there are actual changes
    if (JSON.stringify(this.nodes) !== JSON.stringify(newNodes)) {
      this.nodes = newNodes;
      this.notifyListeners();
    }
  }

  private syncNodesWithConfig(): void {
    if (!this.configData) return;
    
    // Create a deep copy of the nodes to avoid mutation
    const updatedNodes = JSON.parse(JSON.stringify(this.nodes));
    let hasChanges = false;
    
    // Process each node to update its parameters
    for (const node of updatedNodes) {
      // Skip nodes that don't need parameters
      if (!node.params) continue;
      
      // Get the node type and index from the ID
      const [type, indexStr] = node.id.split('-');
      const index = parseInt(indexStr);
      
      // Skip invalid indices
      if (isNaN(index)) continue;
      
      // Update the node's parameters from the config
      switch (type) {
        case 'source':
          if (this.configData.getData().sources && this.configData.getData().sources[index]) {
            if (JSON.stringify(node.params) !== JSON.stringify(this.configData.getData().sources[index].params)) {
              node.params = { ...this.configData.getData().sources[index].params };
              hasChanges = true;
            }
            
            // Also sync interval values
            const sourceInterval = this.configData.getData().sources[index].interval;
            if (sourceInterval !== undefined && node.interval !== sourceInterval) {
              console.log(`Syncing source node[${index}] interval from config: ${sourceInterval}`);
              node.interval = sourceInterval;
              hasChanges = true;
            }
          }
          break;
        case 'enricher':
          if (this.configData.getData().enrichers && this.configData.getData().enrichers[index]) {
            if (JSON.stringify(node.params) !== JSON.stringify(this.configData.getData().enrichers[index].params)) {
              node.params = { ...this.configData.getData().enrichers[index].params };
              hasChanges = true;
            }
          }
          break;
        case 'generator':
          if (this.configData.getData().generators && this.configData.getData().generators[index]) {
            if (JSON.stringify(node.params) !== JSON.stringify(this.configData.getData().generators[index].params)) {
              node.params = { ...this.configData.getData().generators[index].params };
              hasChanges = true;
            }
            
            // Also sync interval values
            const generatorInterval = this.configData.getData().generators[index].interval;
            if (generatorInterval !== undefined && node.interval !== generatorInterval) {
              console.log(`Syncing generator node[${index}] interval from config: ${generatorInterval}`);
              node.interval = generatorInterval;
              hasChanges = true;
            }
          }
          break;
      }
    }
    
    // Only update if there were actual changes
    if (hasChanges) {
      this.configData.updateConfig(updatedNodes);
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    this.eventEmitter.emit('nodes-updated', this.nodes);
    this.eventEmitter.emit('connections-updated', this.connections);
    this.eventEmitter.emit('config-updated', this.configData.getData());
    this.eventEmitter.emit('node-selected', this.selectedNode);
  }

  // Update node status based on aggregation status
  updateNodeStatus(status: AggregationStatus): void {
    console.log('🔄 ConfigStateManager: updating node status from WebSocket status', status);
    
    if (!this.nodes || this.nodes.length === 0) {
      console.warn('No nodes available to update status');
      return;
    }

    let hasUpdates = false;
    const updatedNodes = [...this.nodes];

    // Helper function to find and update child nodes recursively
    const updateNodeStatusRecursively = (nodes: Node[]): void => {
      for (const node of nodes) {
        // Handle parent nodes with children
        if (node.isParent && node.children && node.children.length > 0) {
          // Update children recursively
          updateNodeStatusRecursively(node.children);
          continue;
        }

        // Reset status for nodes that aren't currently active
        if (node.status === 'running' && 
            status.currentSource !== node.name && 
            status.status !== 'running') {
          node.status = null;
          node.statusMessage = undefined;
          hasUpdates = true;
        }

        // Update source nodes specifically
        if (node.type === 'source' && node.name === status.currentSource) {
          console.log(`Updating source node ${node.name} with status`, status.status);
          // Set node status based on current phase and current source
          if (status.status === 'running' && status.currentPhase === 'fetching') {
            node.status = 'running';
            node.statusMessage = `Fetching data...`;
            hasUpdates = true;
          } else if (status.status === 'stopped' && status.errors?.some((err: { source?: string }) => err.source === node.name)) {
            // Find error for this source
            const error = status.errors.find((err: { source?: string; message: string }) => err.source === node.name);
            node.status = 'failed';
            node.statusMessage = error?.message || 'Failed to fetch data';
            hasUpdates = true;
          } else if (status.stats?.itemsPerSource && status.stats.itemsPerSource[node.name]) {
            // Update with success and count information
            node.status = 'success';
            node.statusData = status.stats.itemsPerSource[node.name];
            node.statusMessage = `Successfully fetched data`;
            hasUpdates = true;
          }
        }

        // Update enricher nodes
        if (node.type === 'enricher' && status.currentPhase === 'enriching') {
          console.log(`Updating enricher node ${node.name} status to running`);
          // Set node status based on current phase
          if (status.status === 'running') {
            node.status = 'running';
            node.statusMessage = `Enriching data...`;
            hasUpdates = true;
          }
        }

        // Update generator nodes
        if (node.type === 'generator' && status.currentPhase === 'generating') {
          console.log(`Updating generator node ${node.name} status to running`);
          // Set node status based on current phase
          if (status.status === 'running') {
            node.status = 'running';
            node.statusMessage = `Generating content...`;
            hasUpdates = true;
          }
        }
      }
    };

    // Start the recursive update process
    updateNodeStatusRecursively(updatedNodes);

    // Only update if we actually made changes
    if (hasUpdates) {
      this.nodes = updatedNodes;
      this.eventEmitter.emit('nodes-updated', this.nodes);
    }
  }
}

// Create and export a singleton instance
export const configStateManager = new ConfigStateManager();

// Export for convenience
export default configStateManager; 