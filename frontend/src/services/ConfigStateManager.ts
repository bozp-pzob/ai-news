import { Config as ConfigType, PluginConfig } from '../types';
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
    return this.configData.getData();
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
                params: { ...targetNode.params }
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
                params: { ...targetNode.params }
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
        
        // Check if provider connection was removed
        if (prevState.provider) {
          const hasProviderConnection = node.inputs.some(input => 
            input.name === 'provider' && input.connectedTo !== undefined
          );
          
          if (!hasProviderConnection && node.params && 'provider' in node.params) {
            shouldEmitUpdate = true;
          }
        }
        
        // Check if storage connection was removed
        if (prevState.storage) {
          const hasStorageConnection = node.inputs.some(input => 
            input.name === 'storage' && input.connectedTo !== undefined
          );
          
          if (!hasStorageConnection && node.params && 'storage' in node.params) {
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
              params: { ...node.params }
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
      
      // Update node properties in the UI
      nodeToUpdate.name = plugin.name;
      nodeToUpdate.params = plugin.params || {};
      
      // Update the plugin in the config data
      const result = this.configData.updatePlugin(plugin);
      if (!result) {
        console.error(`Failed to update plugin in config data: ${plugin.id}`);
        return false;
      }
      
      // Mark that we have pending changes
      this.pendingChanges = true;
      
      // Notify listeners
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('config-updated', this.configData.getData());
      this.eventEmitter.emit('plugin-updated', {
        ...plugin,
        params: nodeToUpdate.params
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
          position: { x: leftColumnX, y: 100 + index * storageNodeSpacing },
          inputs: [],
          outputs: [this.createNodeOutput('storage', 'storage')],
          params: storage.params || {},
        });
      });
    } else {
      console.log('🏗️ No storage nodes to create');
    }
    
    // Add AI Provider nodes on left side of canvas with adequate spacing below storage
    if (config.ai && config.ai.length > 0) {
      console.log('🏗️ Creating AI provider nodes:', config.ai.length);
      
      // Use a consistent spacing for AI nodes too
      const aiNodeSpacing = 80;
      
      // Add extra padding between storage and AI sections
      const sectionPadding = 50;
      
      config.ai.forEach((ai, index) => {
        newNodes.push({
          id: `ai-${index}`,
          type: 'ai',
          name: ai.name,
          position: { x: leftColumnX, y: storageHeight + sectionPadding + index * aiNodeSpacing },
          inputs: [],
          outputs: [this.createNodeOutput('provider', 'provider')],
          isProvider: true,
          params: ai.params || {},
        });
      });
    } else {
      console.log('🏗️ No AI provider nodes to create');
    }
    
    // Define a consistent child node spacing
    const childNodeSpacing = 45;
    
    // Add Sources group - first parent node at the top
    if (config.sources && config.sources.length > 0) {
      console.log('🏗️ Creating source nodes:', config.sources.length);
      const sourceChildren = config.sources.map((source, index) => {
        // Create node
        const node = {
          id: `source-${index}`,
          type: 'source',
          name: source.name,
          position: { x: sourceColumnX, y: currentY + 50 + index * childNodeSpacing },
          inputs: [
            ...(source.params?.provider ? [this.createNodeInput('provider', 'provider')] : []),
            ...(source.params?.storage ? [this.createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: source.params || {},
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
      const enricherGroupHeight = 50 + (enricherChildren.length * childNodeSpacing);
      currentY += enricherGroupHeight + groupSpacing;
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
          position: { x: sourceColumnX, y: currentY + 50 + index * childNodeSpacing },
          inputs: [
            ...(generator.params?.provider ? [this.createNodeInput('provider', 'provider')] : []),
            ...(generator.params?.storage ? [this.createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: generator.params || {},
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
    
    // Create a deep copy of the config to avoid mutation
    const updatedConfig = JSON.parse(JSON.stringify(this.configData.getData()));
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
              updatedConfig.sources[index].params = { ...node.params };
              hasChanges = true;
            }
          }
          break;
        case 'enricher':
          if (updatedConfig.enrichers && updatedConfig.enrichers[index]) {
            if (JSON.stringify(updatedConfig.enrichers[index].params) !== JSON.stringify(node.params)) {
              updatedConfig.enrichers[index].params = { ...node.params };
              hasChanges = true;
            }
          }
          break;
        case 'generator':
          if (updatedConfig.generators && updatedConfig.generators[index]) {
            if (JSON.stringify(updatedConfig.generators[index].params) !== JSON.stringify(node.params)) {
              updatedConfig.generators[index].params = { ...node.params };
              hasChanges = true;
            }
          }
          break;
      }
    }
    
    // Only update if there were actual changes
    if (hasChanges) {
      this.configData.updateConfig(updatedConfig);
      this.notifyListeners();
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
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
      }

      // Find all connections involving this node
      const connectionsToRemove = this.connections.filter(conn => 
        conn.from.nodeId === nodeId || conn.to.nodeId === nodeId
      );

      // Remove connections
      this.connections = this.connections.filter(conn => 
        conn.from.nodeId !== nodeId && conn.to.nodeId !== nodeId
      );

      // If the selected node was removed, clear selection
      if (this.selectedNode === nodeId) {
        this.selectedNode = null;
        this.eventEmitter.emit('node-selected', null);
      }      
      // this.syncConfigWithNodes();

      // Mark that we have pending changes
      this.pendingChanges = true;
      
      // Emit events
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      this.eventEmitter.emit('config-updated', this.configData.getData());
      
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
      const config = this.configData.getData();
      
      // Make sure we have a config name
      if (!config.name || typeof config.name !== 'string') {
        console.error('Cannot save config without a name');
        return Promise.reject(new Error('Config must have a name'));
      }
      
      // Ensure the config is up-to-date with the current node state
      this.syncConfigWithNodes();
      
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
    this.eventEmitter.emit('config-updated', this.configData.getData());
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
}

// Create and export a singleton instance
export const configStateManager = new ConfigStateManager();

// Export for convenience
export default configStateManager; 