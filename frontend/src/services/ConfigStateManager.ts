import { Config, PluginConfig } from '../types';
import { Node, Connection, PortInfo, NodePort } from '../types/nodeTypes';
import { createEventEmitter } from '../utils/eventEmitter';
import { findNodeRecursive, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';

// Event types that can be emitted by the state manager
export type ConfigStateEvent = 
  | 'config-updated'
  | 'nodes-updated'
  | 'connections-updated'
  | 'node-selected'
  | 'plugin-updated';

// The state manager is a singleton that manages all application state
class ConfigStateManager {
  private config: Config;
  private nodes: Node[] = [];
  private connections: Connection[] = [];
  private selectedNode: string | null = null;
  private eventEmitter = createEventEmitter<ConfigStateEvent>();

  constructor() {
    // Initialize with a default empty config
    this.config = { 
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

  // Get the current config
  getConfig(): Config {
    // Make sure the config is up-to-date with any node/connection changes
    this.syncConfigWithNodes();
    return this.config;
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

  // Load a new configuration
  loadConfig(config: Config): void {
    console.log('🔄 loadConfig called with:', config?.name || 'unnamed config');

    // First validate that we have a proper config object
    if (!config) {
      console.error('🔄 loadConfig received null or undefined config');
      return;
    }

    // Create a deep copy of the config to avoid reference issues
    let configCopy: Config;
    try {
      configCopy = JSON.parse(JSON.stringify(config));
    } catch (error) {
      console.error('🔄 Failed to clone config:', error);
      // Fallback to a simple shallow copy
      configCopy = { ...config };
    }
    
    // Ensure the config has a name
    if (!configCopy.name) {
      console.warn('🔄 Config has no name, setting to "default"');
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
      console.log('🔄 Setting providers to match AI array');
      configCopy.providers = [...configCopy.ai];
    }
    
    // Save the updated config
    this.config = configCopy;
    
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
    this.eventEmitter.emit('config-updated', this.config);
    this.eventEmitter.emit('nodes-updated', this.nodes);
    this.eventEmitter.emit('connections-updated', this.connections);
    this.eventEmitter.emit('node-selected', this.selectedNode);
    
    // Immediately sync to ensure consistency
    setTimeout(() => {
      this.syncConfigWithNodes();
    }, 50);
    
    console.log('🔄 loadConfig complete, nodes:', this.nodes.length, 'connections:', this.connections.length);
  }

  // Update the full config and notify listeners
  updateConfig(config: Config): void {
    this.config = { ...config };
    this.rebuildNodesAndConnections();
    this.eventEmitter.emit('config-updated', this.config);
  }

  // Set the nodes array directly
  setNodes(nodes: Node[]): void {
    // Ensure node ports are in sync with parameters
    this.nodes = syncNodePortsWithParams(nodes);
    
    // Ensure the config is updated with the new node state
    this.syncConfigWithNodes();
    
    // Emit the update event
    this.eventEmitter.emit('nodes-updated', this.nodes);
    
    // Also notify about the config update
    this.eventEmitter.emit('config-updated', this.config);
    
    // Save to server if the config has a name
    this.saveToServer();
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
    
    // Emit the update event
    this.eventEmitter.emit('connections-updated', this.connections);
    this.eventEmitter.emit('nodes-updated', this.nodes);
    
    // Also notify about the config update
    this.eventEmitter.emit('config-updated', this.config);
    
    // Save to server if the config has a name
    this.saveToServer();
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
    // This ensures we emit plugin-updated events for nodes whose connections were removed
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
          
          // Don't delete the parameter, just emit an update if the connection changed
          if (!hasProviderConnection && node.params && 'provider' in node.params) {
            // Mark that we need to emit an update because the connection changed
            console.log(`🔄 Connection to provider removed for node ${node.id} - will emit update`);
            shouldEmitUpdate = true;
          }
        }
        
        // Check if storage connection was removed
        if (prevState.storage) {
          const hasStorageConnection = node.inputs.some(input => 
            input.name === 'storage' && input.connectedTo !== undefined
          );
          
          // Don't delete the parameter, just emit an update if the connection changed
          if (!hasStorageConnection && node.params && 'storage' in node.params) {
            // Mark that we need to emit an update because the connection changed
            console.log(`🔄 Connection to storage removed for node ${node.id} - will emit update`);
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
      
      // Create deep copies to work with
      const updatedConfig = JSON.parse(JSON.stringify(this.config));
      const updatedNodes = JSON.parse(JSON.stringify(this.nodes));
      const updatedConnections = JSON.parse(JSON.stringify(this.connections));
      
      // Get the node ID parts to determine type and index
      const idParts = plugin.id.split('-');
      const type = idParts[0];
      const index = parseInt(idParts[1]);
      
      // Determine if this is a child node
      const isChild = plugin.isChild === true;
      
      // Find the node to update
      const nodeToUpdate = findNodeRecursive(updatedNodes, plugin.id);
      if (!nodeToUpdate) {
        console.error(`Could not find node with ID ${plugin.id}`);
        return false;
      }
      
      // Track connections to add and remove
      const connectionsToRemove: Connection[] = [];
      const connectionsToAdd: Connection[] = [];
      
      // Update node properties
      nodeToUpdate.name = plugin.name;
      nodeToUpdate.params = plugin.params || {};
      
      // Handle provider connections
      if ('provider' in plugin.params) {
        this.handleProviderConnection(
          plugin, 
          nodeToUpdate, 
          updatedNodes, 
          updatedConnections, 
          connectionsToAdd, 
          connectionsToRemove
        );
      }
      
      // Handle storage connections
      if ('storage' in plugin.params) {
        this.handleStorageConnection(
          plugin, 
          nodeToUpdate, 
          updatedNodes, 
          updatedConnections, 
          connectionsToAdd, 
          connectionsToRemove
        );
      }
      
      // Update the node configuration in the config object
      this.updateConfigWithPluginChanges(plugin, updatedConfig, isChild, type, index);
      
      // Update our internal state
      this.config = updatedConfig;
      this.nodes = updatedNodes;
      this.connections = updatedConnections;
      
      // Create a complete, updated object for the plugin-updated event
      // that includes both the user-provided changes and any side effects
      const updatedPlugin = {
        ...plugin,
        // Ensure any side-effect changes are included
        params: nodeToUpdate.params
      };
      
      // Notify listeners in specific order to ensure proper update sequence
      this.eventEmitter.emit('config-updated', this.config);
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      
      // Fire plugin-updated event last to ensure subscribers have latest state
      setTimeout(() => {
        this.eventEmitter.emit('plugin-updated', updatedPlugin);
        console.log("🔄 Plugin update event emitted for:", updatedPlugin.id);
      }, 0);
      
      console.log("Plugin updates applied. Nodes:", updatedNodes.length, "Connections:", updatedConnections.length);
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
    console.log('Config:', JSON.stringify(this.config));
    
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
    const storageHeight = this.config.storage && this.config.storage.length > 0 
      ? 100 + (this.config.storage.length * storageNodeSpacing)
      : 100;
    
    // Track vertical positions for parent groups
    let currentY = 50; // Starting Y position
    
    // Add Storage nodes on left side of canvas (top) with increased spacing
    if (this.config.storage && this.config.storage.length > 0) {
      console.log('🏗️ Creating storage nodes:', this.config.storage.length);
      this.config.storage.forEach((storage, index) => {
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
    if (this.config.ai && this.config.ai.length > 0) {
      console.log('🏗️ Creating AI provider nodes:', this.config.ai.length);
      
      // Use a consistent spacing for AI nodes too
      const aiNodeSpacing = 80;
      
      // Add extra padding between storage and AI sections
      const sectionPadding = 50;
      
      this.config.ai.forEach((ai, index) => {
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
    if (this.config.sources && this.config.sources.length > 0) {
      console.log('🏗️ Creating source nodes:', this.config.sources.length);
      const sourceChildren = this.config.sources.map((source, index) => {
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
    if (this.config.enrichers && this.config.enrichers.length > 0) {
      console.log('🏗️ Creating enricher nodes:', this.config.enrichers.length);
      const enricherChildren = this.config.enrichers.map((enricher, index) => {
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
    if (this.config.generators && this.config.generators.length > 0) {
      console.log('🏗️ Creating generator nodes:', this.config.generators.length);
      const generatorChildren = this.config.generators.map((generator, index) => {
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
    if (!providerName || !this.config.ai) return;
    
    const providerIndex = this.config.ai.findIndex(p => p.name === providerName);
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
    if (!storageName || !this.config.storage) return;
    
    const storageIndex = this.config.storage.findIndex(s => s.name === storageName);
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
  
  // Handle provider connection updates
  private handleProviderConnection(
    plugin: PluginConfig,
    nodeToUpdate: Node,
    updatedNodes: Node[],
    updatedConnections: Connection[],
    connectionsToAdd: Connection[],
    connectionsToRemove: Connection[]
  ): void {
    if (!plugin.id) return;
    
    console.log('🔌 Processing PROVIDER parameter:', plugin.params.provider);
    console.log('🔌 Node being updated:', nodeToUpdate);
    
    // Find the current provider connection if any
    const currentProviderConn = this.connections.find(conn => 
      conn.to.nodeId === plugin.id && conn.to.input === 'provider'
    );
    
    // If there's no provider in params, ensure any existing connection is removed
    if (!plugin.params.provider) {
      console.log('🔌 No provider specified in params, removing any existing connection');
      if (currentProviderConn) {
        connectionsToRemove.push(currentProviderConn);
        
        // Remove from updatedConnections
        const connIndex = updatedConnections.findIndex(conn => 
          conn.to.nodeId === plugin.id && conn.to.input === 'provider'
        );
        if (connIndex !== -1) {
          updatedConnections.splice(connIndex, 1);
        }
        
        // Clear the connectedTo property
        const providerInput = nodeToUpdate.inputs.find(input => input.name === 'provider');
        if (providerInput) {
          console.log('🔌 Clearing provider input connection');
          providerInput.connectedTo = undefined;
        }
      }
      return;
    }
    
    // Remove current provider connection if it exists
    if (currentProviderConn) {
      console.log('🔌 Current provider connection:', currentProviderConn);
      
      // Get the current connected provider node
      const currentProviderNode = findNodeRecursive(this.nodes, currentProviderConn.from.nodeId);
      
      if (currentProviderNode) {
        console.log('🔌 Current provider node:', currentProviderNode.name);
        
        // Check if the provider has changed
        if (currentProviderNode.name !== plugin.params.provider) {
          console.log(`🔌 Provider changed from ${currentProviderNode.name} to ${plugin.params.provider}`);
          
          // Add the connection to our removal list
          connectionsToRemove.push(currentProviderConn);
          
          // Remove the connection from our updated connections
          const connIndex = updatedConnections.findIndex(conn => 
            conn.to.nodeId === plugin.id && conn.to.input === 'provider'
          );
          if (connIndex !== -1) {
            updatedConnections.splice(connIndex, 1);
          }
          
          // Clear the connectedTo property on the input port
          const providerInput = nodeToUpdate.inputs.find(input => input.name === 'provider');
          if (providerInput) {
            console.log('🔌 Clearing provider input connection');
            providerInput.connectedTo = undefined;
          }
          
          // Find the provider node in the updated nodes
          const currentProviderNodeInUpdated = updatedNodes.find(n => n.id === currentProviderConn.from.nodeId);
          
          // Clear the connection on the provider's output port
          if (currentProviderNodeInUpdated) {
            const providerOutput = currentProviderNodeInUpdated.outputs.find(output => 
              output.name === 'provider' && output.connectedTo === plugin.id
            );
            if (providerOutput) {
              console.log('🔌 Clearing provider output connection');
              providerOutput.connectedTo = undefined;
            }
          }
        } else {
          console.log('🔌 Provider unchanged, keeping existing connection');
        }
      }
    } else {
      console.log('🔌 No existing provider connection found');
    }
    
    // Find the new provider node if provider has changed or there was no connection
    if (!currentProviderConn || 
        (currentProviderConn && findNodeRecursive(this.nodes, currentProviderConn.from.nodeId)?.name !== plugin.params.provider)) {
      
      const newProviderNode = updatedNodes.find(node => 
        node.type === 'ai' && node.name === plugin.params.provider
      );
      
      if (newProviderNode) {
        console.log('🔌 Found new provider node:', newProviderNode.name);
        
        // Check if we don't already have this connection
        const existingConnection = updatedConnections.find(conn => 
          conn.from.nodeId === newProviderNode.id && 
          conn.to.nodeId === plugin.id && 
          conn.to.input === 'provider'
        );
        
        if (!existingConnection) {
          console.log('🔌 Adding new provider connection');
          
          // Create the new connection
          const newConnection: Connection = {
            from: { nodeId: newProviderNode.id, output: 'provider' },
            to: { nodeId: plugin.id, input: 'provider' }
          };
          
          connectionsToAdd.push(newConnection);
          updatedConnections.push(newConnection);
          
          // Update the input port on the node
          const providerInput = nodeToUpdate.inputs.find(input => input.name === 'provider');
          if (providerInput) {
            console.log('🔌 Updating existing provider input port');
            providerInput.connectedTo = newProviderNode.id;
          } else {
            console.log('🔌 Creating new provider input port');
            // If the input doesn't exist yet, create it
            nodeToUpdate.inputs.push({
              name: 'provider',
              type: 'provider',
              connectedTo: newProviderNode.id
            });
          }
          
          // Update the output port on the provider
          const providerOutput = newProviderNode.outputs.find(output => output.name === 'provider');
          if (providerOutput) {
            console.log('🔌 Updating provider output port');
            providerOutput.connectedTo = plugin.id;
          }
        } else {
          console.log('🔌 Connection already exists, no need to add');
        }
      } else {
        console.error('🔌 Could not find provider node with name:', plugin.params.provider);
      }
    }
  }
  
  // Handle storage connection updates
  private handleStorageConnection(
    plugin: PluginConfig,
    nodeToUpdate: Node,
    updatedNodes: Node[],
    updatedConnections: Connection[],
    connectionsToAdd: Connection[],
    connectionsToRemove: Connection[]
  ): void {
    if (!plugin.id) return;
    
    console.log('🔌 Processing STORAGE parameter:', plugin.params.storage);
    console.log('🔌 Node being updated:', nodeToUpdate);
    
    // Find the current storage connection if any
    const currentStorageConn = this.connections.find(conn => 
      conn.to.nodeId === plugin.id && conn.to.input === 'storage'
    );
    
    // If there's no storage in params, ensure any existing connection is removed
    if (!plugin.params.storage) {
      console.log('🔌 No storage specified in params, removing any existing connection');
      if (currentStorageConn) {
        connectionsToRemove.push(currentStorageConn);
        
        // Remove from updatedConnections
        const connIndex = updatedConnections.findIndex(conn => 
          conn.to.nodeId === plugin.id && conn.to.input === 'storage'
        );
        if (connIndex !== -1) {
          updatedConnections.splice(connIndex, 1);
        }
        
        // Clear the connectedTo property
        const storageInput = nodeToUpdate.inputs.find(input => input.name === 'storage');
        if (storageInput) {
          storageInput.connectedTo = undefined;
        }
      }
      return;
    }
    
    if (currentStorageConn) {
      console.log('🔌 Current storage connection:', currentStorageConn);
      
      // Get the current connected storage node
      const currentStorageNode = findNodeRecursive(this.nodes, currentStorageConn.from.nodeId);
      
      if (currentStorageNode) {
        console.log('🔌 Current storage node:', currentStorageNode.name);
        
        // Check if the storage has changed
        if (currentStorageNode.name !== plugin.params.storage) {
          console.log(`🔌 Storage changed from ${currentStorageNode.name} to ${plugin.params.storage}`);
          
          // Add the connection to our removal list
          connectionsToRemove.push(currentStorageConn);
          
          // Remove the connection from our updated connections
          const connIndex = updatedConnections.findIndex(conn => 
            conn.to.nodeId === plugin.id && conn.to.input === 'storage'
          );
          if (connIndex !== -1) {
            updatedConnections.splice(connIndex, 1);
          }
          
          // Clear the connectedTo property on the input port
          const storageInput = nodeToUpdate.inputs.find(input => input.name === 'storage');
          if (storageInput) {
            console.log('🔌 Clearing storage input connection');
            storageInput.connectedTo = undefined;
          }
          
          // Find the storage node in the updated nodes
          const currentStorageNodeInUpdated = updatedNodes.find(n => n.id === currentStorageConn.from.nodeId);
          
          // Clear the connection on the storage's output port
          if (currentStorageNodeInUpdated) {
            const storageOutput = currentStorageNodeInUpdated.outputs.find(output => 
              output.name === 'storage' && output.connectedTo === plugin.id
            );
            if (storageOutput) {
              console.log('🔌 Clearing storage output connection');
              storageOutput.connectedTo = undefined;
            }
          }
        } else {
          console.log('🔌 Storage unchanged, keeping existing connection');
        }
      }
    } else {
      console.log('🔌 No existing storage connection found');
    }
    
    // Find the new storage node if storage has changed or there was no connection
    if (!currentStorageConn || 
        (currentStorageConn && findNodeRecursive(this.nodes, currentStorageConn.from.nodeId)?.name !== plugin.params.storage)) {
        
      const newStorageNode = updatedNodes.find(node => 
        node.type === 'storage' && node.name === plugin.params.storage
      );
      
      if (newStorageNode) {
        console.log('🔌 Found new storage node:', newStorageNode.name);
        
        // Check if we don't already have this connection
        const existingConnection = updatedConnections.find(conn => 
          conn.from.nodeId === newStorageNode.id && 
          conn.to.nodeId === plugin.id && 
          conn.to.input === 'storage'
        );
        
        if (!existingConnection) {
          console.log('🔌 Adding new storage connection');
          
          // Create the new connection
          const newConnection: Connection = {
            from: { nodeId: newStorageNode.id, output: 'storage' },
            to: { nodeId: plugin.id, input: 'storage' }
          };
          
          connectionsToAdd.push(newConnection);
          updatedConnections.push(newConnection);
          
          // Update the input port on the node
          const storageInput = nodeToUpdate.inputs.find(input => input.name === 'storage');
          if (storageInput) {
            console.log('🔌 Updating existing storage input port');
            storageInput.connectedTo = newStorageNode.id;
          } else {
            console.log('🔌 Creating new storage input port');
            // If the input doesn't exist yet, create it
            nodeToUpdate.inputs.push({
              name: 'storage',
              type: 'storage',
              connectedTo: newStorageNode.id
            });
          }
          
          // Update the output port on the storage
          const storageOutput = newStorageNode.outputs.find(output => output.name === 'storage');
          if (storageOutput) {
            console.log('🔌 Updating storage output port');
            storageOutput.connectedTo = plugin.id;
          }
        } else {
          console.log('🔌 Connection already exists, no need to add');
        }
      } else {
        console.error('🔌 Could not find storage node with name:', plugin.params.storage);
      }
    }
  }

  // Update the config object with plugin changes
  private updateConfigWithPluginChanges(
    plugin: PluginConfig, 
    updatedConfig: Config, 
    isChild: boolean, 
    type: string, 
    index: number
  ): void {
    if (!plugin.id) return;
    
    switch (type) {
      case 'source':
      case 'sources':
        if (isChild && plugin.parentId) {
          // Handle child node of a parent
          const parentIdParts = plugin.parentId.split('-');
          const parentIndex = parseInt(parentIdParts[1]);
          
          // Find the index of the child within its parent
          const parentNode = this.findNodeById(plugin.parentId);
          if (parentNode && parentNode.children) {
            const childIndex = parentNode.children.findIndex(c => c.id === plugin.id);
            if (childIndex !== -1 && updatedConfig.sources && updatedConfig.sources[parentIndex]) {
              // Ensure the children params array exists
              if (!updatedConfig.sources[parentIndex].params) {
                updatedConfig.sources[parentIndex].params = {};
              }
              if (!updatedConfig.sources[parentIndex].params.children) {
                updatedConfig.sources[parentIndex].params.children = [];
              }
              
              // Ensure the child index exists in the array
              while (updatedConfig.sources[parentIndex].params.children.length <= childIndex) {
                updatedConfig.sources[parentIndex].params.children.push({});
              }
              
              // Update child params
              updatedConfig.sources[parentIndex].params.children[childIndex] = {
                ...updatedConfig.sources[parentIndex].params.children[childIndex],
                ...plugin.params
              };
            }
          }
        } else if (updatedConfig.sources && updatedConfig.sources[index]) {
          // Update params
          updatedConfig.sources[index].params = plugin.params;
          // Update name if it's changed
          if (updatedConfig.sources[index].name !== plugin.name) {
            updatedConfig.sources[index].name = plugin.name;
          }
        }
        break;
      case 'enricher':
      case 'enrichers':
        if (isChild && plugin.parentId) {
          // Handle child node of a parent
          const parentIdParts = plugin.parentId.split('-');
          const parentIndex = parseInt(parentIdParts[1]);
          
          // Find the index of the child within its parent
          const parentNode = this.findNodeById(plugin.parentId);
          if (parentNode && parentNode.children) {
            const childIndex = parentNode.children.findIndex(c => c.id === plugin.id);
            if (childIndex !== -1 && updatedConfig.enrichers && updatedConfig.enrichers[parentIndex]) {
              // Ensure the children params array exists
              if (!updatedConfig.enrichers[parentIndex].params) {
                updatedConfig.enrichers[parentIndex].params = {};
              }
              if (!updatedConfig.enrichers[parentIndex].params.children) {
                updatedConfig.enrichers[parentIndex].params.children = [];
              }
              
              // Ensure the child index exists in the array
              while (updatedConfig.enrichers[parentIndex].params.children.length <= childIndex) {
                updatedConfig.enrichers[parentIndex].params.children.push({});
              }
              
              // Update child params
              updatedConfig.enrichers[parentIndex].params.children[childIndex] = {
                ...updatedConfig.enrichers[parentIndex].params.children[childIndex],
                ...plugin.params
              };
            }
          }
        } else if (updatedConfig.enrichers && updatedConfig.enrichers[index]) {
          // Update params
          updatedConfig.enrichers[index].params = plugin.params;
          // Update name if it's changed
          if (updatedConfig.enrichers[index].name !== plugin.name) {
            updatedConfig.enrichers[index].name = plugin.name;
          }
        }
        break;
      case 'generator':
      case 'generators':
        if (isChild && plugin.parentId) {
          // Handle child node of a parent
          const parentIdParts = plugin.parentId.split('-');
          const parentIndex = parseInt(parentIdParts[1]);
          
          // Find the index of the child within its parent
          const parentNode = this.findNodeById(plugin.parentId);
          if (parentNode && parentNode.children) {
            const childIndex = parentNode.children.findIndex(c => c.id === plugin.id);
            if (childIndex !== -1 && updatedConfig.generators && updatedConfig.generators[parentIndex]) {
              // Ensure the children params array exists
              if (!updatedConfig.generators[parentIndex].params) {
                updatedConfig.generators[parentIndex].params = {};
              }
              if (!updatedConfig.generators[parentIndex].params.children) {
                updatedConfig.generators[parentIndex].params.children = [];
              }
              
              // Ensure the child index exists in the array
              while (updatedConfig.generators[parentIndex].params.children.length <= childIndex) {
                updatedConfig.generators[parentIndex].params.children.push({});
              }
              
              // Update child params
              updatedConfig.generators[parentIndex].params.children[childIndex] = {
                ...updatedConfig.generators[parentIndex].params.children[childIndex],
                ...plugin.params
              };
            }
          }
        } else if (updatedConfig.generators && updatedConfig.generators[index]) {
          // Update params
          updatedConfig.generators[index].params = plugin.params;
          // Update name if it's changed
          if (updatedConfig.generators[index].name !== plugin.name) {
            updatedConfig.generators[index].name = plugin.name;
          }
        }
        break;
      // Add cases for other node types as needed
    }
  }

  // Force synchronization of state with config
  public forceSync(): void {
    console.log('🔄 ForceSync called - Broadcasting current state to all subscribers');
    
    // Important: First update port connections from the connections array
    // This ensures the ports reflect the actual connections
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
    // Use setTimeout to ensure this happens asynchronously
    setTimeout(() => {
      // Emit events in a specific order to ensure proper update sequence
      this.eventEmitter.emit('config-updated', this.config);
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      
      // Also emit individual plugin updates for any dialogs that might be open
      // This will ensure PluginParamDialog displays the latest state
      for (const node of this.nodes) {
        this.emitNodeUpdateEvents(node);
      }
      
      // If the config has a name, also sync with the server
      if (this.config.name && typeof this.config.name === 'string') {
        // Dynamic import to avoid circular dependencies
        import('../services/api').then(({ saveConfig }) => {
          saveConfig(this.config.name as string, this.config)
            .then(() => {
              console.log(`🔄 ForceSync: Configuration ${this.config.name} saved to server`);
            })
            .catch(error => {
              console.error('🔄 ForceSync: Error saving config to server:', error);
            });
        });
      }
      
      console.log('🔄 ForceSync complete - All subscribers notified');
    }, 50); // Increased delay to ensure all operations complete before notifying
  }

  // Helper method to emit update events for a node and its children
  private emitNodeUpdateEvents(node: Node): void {
    if (node.id) {
      const plugin = {
        id: node.id,
        name: node.name,
        type: node.type,
        params: node.params || {} // Ensure params is never undefined
      };
      
      // Log what we're emitting for debugging
      console.log(`🔄 Emitting plugin-updated event for ${node.id}:`, JSON.stringify(plugin.params));
      
      this.eventEmitter.emit('plugin-updated', plugin);
    }
    
    // Recursively emit events for children
    if (node.isParent && node.children) {
      for (const child of node.children) {
        this.emitNodeUpdateEvents(child);
      }
    }
  }

  // Synchronize the config object with the current nodes and connections
  private syncConfigWithNodes(): void {
    try {
      console.log('🔄 Synchronizing config with current nodes and connections');
      
      // Create a deep copy of the current config as a starting point
      const updatedConfig = JSON.parse(JSON.stringify(this.config));
      
      // Create mappings of connections for easier lookup
      const connectionMap = new Map<string, Connection[]>();
      for (const connection of this.connections) {
        const toNodeId = connection.to.nodeId;
        if (!connectionMap.has(toNodeId)) {
          connectionMap.set(toNodeId, []);
        }
        connectionMap.get(toNodeId)?.push(connection);
      }
      
      // Create a set of existing node IDs for quick lookup
      const existingNodeIds = new Set(this.nodes.map(node => node.id));
      
      // Process all nodes to ensure their data is reflected in the config
      for (const node of this.nodes) {
        if (!node.id) continue;
        
        const idParts = node.id.split('-');
        const type = idParts[0];
        const index = parseInt(idParts[1]);
        
        // Skip non-numeric indices or group nodes
        if (isNaN(index) || node.isParent) continue;
        
        // Update the config based on node type
        switch (type) {
          case 'source':
          case 'sources':
            if (updatedConfig.sources && updatedConfig.sources[index]) {
              // Update params and name
              updatedConfig.sources[index].params = node.params || {};
              updatedConfig.sources[index].name = node.name;
              // Update connections (provider and storage)
              this.updateNodeConnections(node, updatedConfig.sources[index], connectionMap);
              
              // Handle children if this is a parent node
              if (node.isParent && node.children) {
                if (!updatedConfig.sources[index].params) {
                  updatedConfig.sources[index].params = {};
                }
                if (!updatedConfig.sources[index].params.children) {
                  updatedConfig.sources[index].params.children = [];
                }
                
                // Update each child
                for (let i = 0; i < node.children.length; i++) {
                  const child = node.children[i];
                  if (child && existingNodeIds.has(child.id)) {
                    // Ensure space for this child
                    while (updatedConfig.sources[index].params.children.length <= i) {
                      updatedConfig.sources[index].params.children.push({});
                    }
                    
                    // Update the child params
                    updatedConfig.sources[index].params.children[i] = {
                      ...updatedConfig.sources[index].params.children[i],
                      ...child.params
                    };
                  }
                }
                
                // Clean up any deleted children
                if (updatedConfig.sources[index].params.children) {
                  updatedConfig.sources[index].params.children = updatedConfig.sources[index].params.children.filter((_: Record<string, any>, i: number) => {
                    const child = node.children?.[i];
                    return child && existingNodeIds.has(child.id);
                  });
                }
              }
            }
            break;
          case 'enricher':
          case 'enrichers':
            if (updatedConfig.enrichers && updatedConfig.enrichers[index]) {
              updatedConfig.enrichers[index].params = node.params || {};
              updatedConfig.enrichers[index].name = node.name;
              // Update connections (provider and storage)
              this.updateNodeConnections(node, updatedConfig.enrichers[index], connectionMap);
              
              // Handle children if this is a parent node
              if (node.isParent && node.children) {
                if (!updatedConfig.enrichers[index].params) {
                  updatedConfig.enrichers[index].params = {};
                }
                if (!updatedConfig.enrichers[index].params.children) {
                  updatedConfig.enrichers[index].params.children = [];
                }
                
                // Update each child
                for (let i = 0; i < node.children.length; i++) {
                  const child = node.children[i];
                  if (child && existingNodeIds.has(child.id)) {
                    // Ensure space for this child
                    while (updatedConfig.enrichers[index].params.children.length <= i) {
                      updatedConfig.enrichers[index].params.children.push({});
                    }
                    
                    // Update the child params
                    updatedConfig.enrichers[index].params.children[i] = {
                      ...updatedConfig.enrichers[index].params.children[i],
                      ...child.params
                    };
                  }
                }
                
                // Clean up any deleted children
                if (updatedConfig.enrichers[index].params.children) {
                  updatedConfig.enrichers[index].params.children = updatedConfig.enrichers[index].params.children.filter((_: Record<string, any>, i: number) => {
                    const child = node.children?.[i];
                    return child && existingNodeIds.has(child.id);
                  });
                }
              }
            }
            break;
          case 'generator':
          case 'generators':
            if (updatedConfig.generators && updatedConfig.generators[index]) {
              updatedConfig.generators[index].params = node.params || {};
              updatedConfig.generators[index].name = node.name;
              // Update connections (provider and storage)
              this.updateNodeConnections(node, updatedConfig.generators[index], connectionMap);
              
              // Handle children if this is a parent node
              if (node.isParent && node.children) {
                if (!updatedConfig.generators[index].params) {
                  updatedConfig.generators[index].params = {};
                }
                if (!updatedConfig.generators[index].params.children) {
                  updatedConfig.generators[index].params.children = [];
                }
                
                // Update each child
                for (let i = 0; i < node.children.length; i++) {
                  const child = node.children[i];
                  if (child && existingNodeIds.has(child.id)) {
                    // Ensure space for this child
                    while (updatedConfig.generators[index].params.children.length <= i) {
                      updatedConfig.generators[index].params.children.push({});
                    }
                    
                    // Update the child params
                    updatedConfig.generators[index].params.children[i] = {
                      ...updatedConfig.generators[index].params.children[i],
                      ...child.params
                    };
                  }
                }
                
                // Clean up any deleted children
                if (updatedConfig.generators[index].params.children) {
                  updatedConfig.generators[index].params.children = updatedConfig.generators[index].params.children.filter((_: Record<string, any>, i: number) => {
                    const child = node.children?.[i];
                    return child && existingNodeIds.has(child.id);
                  });
                }
              }
            }
            break;
          case 'ai':
            if (updatedConfig.ai && updatedConfig.ai[index]) {
              updatedConfig.ai[index].params = node.params || {};
              updatedConfig.ai[index].name = node.name;
            }
            break;
          case 'storage':
            if (updatedConfig.storage && updatedConfig.storage[index]) {
              updatedConfig.storage[index].params = node.params || {};
              updatedConfig.storage[index].name = node.name;
            }
            break;
        }
      }
      
      // Update our internal config
      this.config = updatedConfig;
      
      console.log('🔄 Config synchronized successfully');
    } catch (error) {
      console.error('Error synchronizing config with nodes:', error);
    }
  }
  
  // Helper method to update a node's connections in the config
  private updateNodeConnections(
    node: Node, 
    configNode: any, 
    connectionMap: Map<string, Connection[]>
  ): void {
    if (!node.id || !configNode.params) return;
    
    const nodeConnections = connectionMap.get(node.id) || [];
    
    // Update provider connection
    const providerConnection = nodeConnections.find(conn => conn.to.input === 'provider');
    if (providerConnection) {
      const providerNode = this.findNodeById(providerConnection.from.nodeId);
      if (providerNode) {
        configNode.params.provider = providerNode.name;
      }
    } else if (configNode.params.provider) {
      // If there's no connection but the param exists in the config, remove it from config only
      // This is critical: we remove it from the config but NOT from the node.params in memory
      console.log(`Clearing provider param from config for node ${node.id}`);
      delete configNode.params.provider;
    }
    
    // Update storage connection
    const storageConnection = nodeConnections.find(conn => conn.to.input === 'storage');
    if (storageConnection) {
      const storageNode = this.findNodeById(storageConnection.from.nodeId);
      if (storageNode) {
        configNode.params.storage = storageNode.name;
      }
    } else if (configNode.params.storage) {
      // If there's no connection but the param exists in the config, remove it from config only
      // This is critical: we remove it from the config but NOT from the node.params in memory
      console.log(`Clearing storage param from config for node ${node.id}`);
      delete configNode.params.storage;
    }
  }

  // Helper method that previously saved to server - now disabled to only save on explicit user action
  private saveToServer(): void {
    // No longer automatically saving to server
    console.log('🔄 Configuration updated locally but not saved to server (awaiting explicit save action)');
  }

  // Remove a node from the configuration and graph
  removeNode(nodeId: string): boolean {
    try {
      console.log(`🗑️ Removing node: ${nodeId}`);

      // Parse the node ID to determine its type and index
      const idParts = nodeId.split('-');
      const nodeType = idParts[0];
      const nodeIndex = parseInt(idParts[1]);

      // Determine if this is a child node
      const node = this.findNodeById(nodeId);
      if (!node) {
        console.error(`Node with ID ${nodeId} not found`);
        return false;
      }

      // Check if this is a child node (part of a parent)
      let isChildNode = false;
      let parentNode: Node | undefined;
      let parentId: string | undefined;

      // Look for a parent node that contains this child
      for (const n of this.nodes) {
        if (n.isParent && n.children) {
          const childIndex = n.children.findIndex(child => child.id === nodeId);
          if (childIndex !== -1) {
            isChildNode = true;
            parentNode = n;
            parentId = n.id;
            break;
          }
        }
      }

      // Create deep copies of the current state
      const updatedConfig = JSON.parse(JSON.stringify(this.config));
      let updatedNodes = JSON.parse(JSON.stringify(this.nodes));
      
      // Find all connections involving this node
      const connectionsToRemove = this.connections.filter(conn => 
        conn.from.nodeId === nodeId || conn.to.nodeId === nodeId
      );

      // Remove connections
      let updatedConnections = this.connections.filter(conn => 
        conn.from.nodeId !== nodeId && conn.to.nodeId !== nodeId
      );

      // Handle node removal based on its type
      if (isChildNode && parentNode && parentId) {
        // Handle child node removal
        
        // 1. Get parent ID parts
        const parentIdParts = parentId.split('-');
        const parentType = parentIdParts[0]; 
        const parentIndex = parseInt(parentIdParts[1]);
        
        // 2. Find child index in parent
        const childIndex = parentNode.children!.findIndex(child => child.id === nodeId);
        
        // 3. Remove from config's appropriate array's params.children
        if (parentType === 'sources' || parentType === 'source') {
          if (updatedConfig.sources && updatedConfig.sources[parentIndex]) {
            // Initialize params if they don't exist
            if (!updatedConfig.sources[parentIndex].params) {
              updatedConfig.sources[parentIndex].params = {};
            }
            // Initialize children array if it doesn't exist
            if (!updatedConfig.sources[parentIndex].params.children) {
              updatedConfig.sources[parentIndex].params.children = [];
            }
            // Remove the child from the children array
            updatedConfig.sources[parentIndex].params.children.splice(childIndex, 1);
            
            // If it was the last child, remove the children array
            if (updatedConfig.sources[parentIndex].params.children.length === 0) {
              delete updatedConfig.sources[parentIndex].params.children;
            }
          }
        } else if (parentType === 'enrichers' || parentType === 'enricher') {
          if (updatedConfig.enrichers && updatedConfig.enrichers[parentIndex]) {
            // Initialize params if they don't exist
            if (!updatedConfig.enrichers[parentIndex].params) {
              updatedConfig.enrichers[parentIndex].params = {};
            }
            // Initialize children array if it doesn't exist
            if (!updatedConfig.enrichers[parentIndex].params.children) {
              updatedConfig.enrichers[parentIndex].params.children = [];
            }
            // Remove the child from the children array
            updatedConfig.enrichers[parentIndex].params.children.splice(childIndex, 1);
            
            // If it was the last child, remove the children array
            if (updatedConfig.enrichers[parentIndex].params.children.length === 0) {
              delete updatedConfig.enrichers[parentIndex].params.children;
            }
          }
        } else if (parentType === 'generators' || parentType === 'generator') {
          if (updatedConfig.generators && updatedConfig.generators[parentIndex]) {
            // Initialize params if they don't exist
            if (!updatedConfig.generators[parentIndex].params) {
              updatedConfig.generators[parentIndex].params = {};
            }
            // Initialize children array if it doesn't exist
            if (!updatedConfig.generators[parentIndex].params.children) {
              updatedConfig.generators[parentIndex].params.children = [];
            }
            // Remove the child from the children array
            updatedConfig.generators[parentIndex].params.children.splice(childIndex, 1);
            
            // If it was the last child, remove the children array
            if (updatedConfig.generators[parentIndex].params.children.length === 0) {
              delete updatedConfig.generators[parentIndex].params.children;
            }
          }
        }
        
        // 4. Remove from parent node's children array
        updatedNodes = updatedNodes.map((n: Node) => {
          if (n.id === parentId && n.children) {
            return {
              ...n,
              children: n.children.filter((child: Node) => child.id !== nodeId)
            };
          }
          return n;
        });

        // 5. Update internal state
        this.config = updatedConfig;
        this.nodes = updatedNodes;
        this.connections = updatedConnections;
        
        // 6. Force sync to ensure all state is consistent
        this.forceSync();
        
        // 7. Emit events to notify all listeners
        this.eventEmitter.emit('config-updated', this.config);
        this.eventEmitter.emit('nodes-updated', this.nodes);
        this.eventEmitter.emit('connections-updated', this.connections);
        
        // 8. Save to server if the config has a name
        if (this.config.name && typeof this.config.name === 'string') {
          import('../services/api').then(({ saveConfig }) => {
            saveConfig(this.config.name as string, this.config)
              .then(() => {
                console.log(`🔄 Node removal saved to server for config ${this.config.name}`);
              })
              .catch(error => {
                console.error('🔄 Error saving node removal to server:', error);
              });
          });
        }
        
        return true;
      } else {
        // Handle main node removal
        switch(nodeType) {
          case 'storage':
            // Remove from storage array
            updatedConfig.storage.splice(nodeIndex, 1);
            
            // Clear storage references in other nodes
            const storageNodeGroups = ['sources', 'enrichers', 'generators'] as const;
            storageNodeGroups.forEach((nodeGroup) => {
              updatedConfig[nodeGroup].forEach((plugin: PluginConfig) => {
                if (plugin.params?.storage === node.name) {
                  delete plugin.params.storage;
                }
                // Also check children
                if (plugin.params?.children) {
                  plugin.params.children.forEach((child: Record<string, any>) => {
                    if (child.storage === node.name) {
                      delete child.storage;
                    }
                  });
                }
              });
            });
            break;
          
          case 'ai':
            // Remove from AI array
            updatedConfig.ai.splice(nodeIndex, 1);
            
            // Clear provider references in other nodes
            const providerNodeGroups = ['sources', 'enrichers', 'generators'] as const;
            providerNodeGroups.forEach((nodeGroup) => {
              updatedConfig[nodeGroup].forEach((plugin: PluginConfig) => {
                if (plugin.params?.provider === node.name) {
                  delete plugin.params.provider;
                }
                // Also check children
                if (plugin.params?.children) {
                  plugin.params.children.forEach((child: Record<string, any>) => {
                    if (child.provider === node.name) {
                      delete child.provider;
                    }
                  });
                }
              });
            });
            break;
          
          case 'source':
          case 'sources':
            if (nodeType === 'sources') {
              // Remove the entire group
              updatedConfig.sources.splice(nodeIndex, 1);
            } else {
              // Handle individual source
              for (let i = 0; i < updatedConfig.sources.length; i++) {
                if (updatedConfig.sources[i].name === node.name) {
                  updatedConfig.sources.splice(i, 1);
                  break;
                }
              }
            }
            break;
          
          case 'enricher':
          case 'enrichers':
            if (nodeType === 'enrichers') {
              // Remove the entire group
              updatedConfig.enrichers.splice(nodeIndex, 1);
            } else {
              // Handle individual enricher
              for (let i = 0; i < updatedConfig.enrichers.length; i++) {
                if (updatedConfig.enrichers[i].name === node.name) {
                  updatedConfig.enrichers.splice(i, 1);
                  break;
                }
              }
            }
            break;
          
          case 'generator':
          case 'generators':
            if (nodeType === 'generators') {
              // Remove the entire group
              updatedConfig.generators.splice(nodeIndex, 1);
            } else {
              // Handle individual generator
              for (let i = 0; i < updatedConfig.generators.length; i++) {
                if (updatedConfig.generators[i].name === node.name) {
                  updatedConfig.generators.splice(i, 1);
                  break;
                }
              }
            }
            break;
          
          default:
            console.error(`Unknown node type: ${nodeType}`);
            return false;
        }
        
        // Remove the node from nodes array
        updatedNodes = updatedNodes.filter((n: Node) => n.id !== nodeId);
      }

      // Update internal state
      this.config = updatedConfig;
      this.nodes = updatedNodes;
      this.connections = updatedConnections;
      
      // If the selected node was removed, clear selection
      if (this.selectedNode === nodeId) {
        this.selectedNode = null;
        this.eventEmitter.emit('node-selected', null);
      }
      
      // Emit events
      this.eventEmitter.emit('config-updated', this.config);
      this.eventEmitter.emit('nodes-updated', this.nodes);
      this.eventEmitter.emit('connections-updated', this.connections);
      
      // Force sync to ensure all state is consistent
      this.forceSync();
      
      // Save to server if the config has a name
      if (this.config.name && typeof this.config.name === 'string') {
        import('../services/api').then(({ saveConfig }) => {
          saveConfig(this.config.name as string, this.config)
            .then(() => {
              console.log(`🔄 Node removal saved to server for config ${this.config.name}`);
            })
            .catch(error => {
              console.error('🔄 Error saving node removal to server:', error);
            });
        });
      }
      
      return true;
    } catch (error) {
      console.error("Error in removeNode:", error);
      return false;
    }
  }
}

// Create and export a singleton instance
export const configStateManager = new ConfigStateManager();

// Export for convenience
export default configStateManager; 