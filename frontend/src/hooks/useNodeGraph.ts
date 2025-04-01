import { useState, useRef, useEffect, useCallback } from 'react';
import { Config, PluginConfig, PluginType } from '../types';
import { Node, Connection, PortInfo, NodeCoordinates, ViewSettings, NodePort } from '../types/nodeTypes';
import { findNodeRecursive, findPortAtCoordinates, findNodeAtCoordinates, isPointInCollapseButton } from '../utils/nodeHandlers';

interface UseNodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config) => void;
}

interface UseNodeGraphReturn {
  nodes: Node[];
  connections: Connection[];
  selectedNode: string | null;
  isDragging: boolean;
  dragStart: NodeCoordinates;
  connectingFrom: PortInfo | null;
  scale: number;
  offset: NodeCoordinates;
  isPanning: boolean;
  panStart: NodeCoordinates;
  targetScale: number;
  targetOffset: NodeCoordinates;
  mousePosition: NodeCoordinates | null;
  hoveredPort: PortInfo | null;
  viewMode: 'traditional' | 'comfyui';
  showPluginDialog: boolean;
  showConfigDialog: boolean;
  selectedPlugin: PluginConfig | null;
  animationFrameRef: React.MutableRefObject<number | null>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>;
  setSelectedNode: React.Dispatch<React.SetStateAction<string | null>>;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
  setDragStart: React.Dispatch<React.SetStateAction<NodeCoordinates>>;
  setConnectingFrom: React.Dispatch<React.SetStateAction<PortInfo | null>>;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  setOffset: React.Dispatch<React.SetStateAction<NodeCoordinates>>;
  setIsPanning: React.Dispatch<React.SetStateAction<boolean>>;
  setPanStart: React.Dispatch<React.SetStateAction<NodeCoordinates>>;
  setTargetScale: React.Dispatch<React.SetStateAction<number>>;
  setTargetOffset: React.Dispatch<React.SetStateAction<NodeCoordinates>>;
  setMousePosition: React.Dispatch<React.SetStateAction<NodeCoordinates | null>>;
  setHoveredPort: React.Dispatch<React.SetStateAction<PortInfo | null>>;
  setViewMode: React.Dispatch<React.SetStateAction<'traditional' | 'comfyui'>>;
  setShowPluginDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setShowConfigDialog: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedPlugin: React.Dispatch<React.SetStateAction<PluginConfig | null>>;
  findNodeById: (id: string) => Node | undefined;
  screenToCanvas: (x: number, y: number, canvasRect: DOMRect) => NodeCoordinates;
  handleWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  centerView: (canvasWidth: number, canvasHeight: number) => void;
  handlePluginSave: (plugin: any) => void;
  handleConfigSave: (name: string) => void;
}

// Create node with properly typed Node structure
interface PortWithTypedConnectedTo {
  name: string;
  type: string;
  connectedTo?: string | undefined;
}

const createNodeInput = (name: string, type: string): PortWithTypedConnectedTo => ({
  name,
  type,
  connectedTo: undefined
});

const createNodeOutput = (name: string, type: string): PortWithTypedConnectedTo => ({
  name,
  type,
  connectedTo: undefined
});

export const useNodeGraph = ({ config, onConfigUpdate }: UseNodeGraphProps): UseNodeGraphReturn => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<NodeCoordinates>({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<PortInfo | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<NodeCoordinates>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<NodeCoordinates>({ x: 0, y: 0 });
  const [targetScale, setTargetScale] = useState(1);
  const [targetOffset, setTargetOffset] = useState<NodeCoordinates>({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState<NodeCoordinates | null>(null);
  const [viewMode, setViewMode] = useState<'traditional' | 'comfyui'>('traditional');
  const [showPluginDialog, setShowPluginDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginConfig | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortInfo | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = (x: number, y: number, canvasRect: DOMRect): NodeCoordinates => {
    // Get position relative to canvas element
    const relativeX = x - canvasRect.left;
    const relativeY = y - canvasRect.top;
    
    // Apply pan offset and scale
    return {
      x: (relativeX - offset.x) / scale,
      y: (relativeY - offset.y) / scale
    };
  };

  // Handle zoom with mouse wheel
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    // Get the canvas and its dimensions
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    
    // Get the mouse position relative to the canvas
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate current position in world space
    const worldX = (mouseX - offset.x) / scale;
    const worldY = (mouseY - offset.y) / scale;
    
    // Determine zoom direction and calculate new scale
    const zoomDirection = e.deltaY < 0 ? 1 : -1;
    const zoomFactor = 0.1;
    const newScale = Math.max(0.1, Math.min(2, scale * (1 + zoomDirection * zoomFactor)));
    
    // Calculate new offset to keep the mouse position fixed
    const newOffsetX = mouseX - worldX * newScale;
    const newOffsetY = mouseY - worldY * newScale;
    
    // Update state
    setScale(newScale);
    setOffset({ x: newOffsetX, y: newOffsetY });
    
    // Update targets for animation (if needed)
    setTargetScale(newScale);
    setTargetOffset({ x: newOffsetX, y: newOffsetY });
  };

  // Find a node by ID, including in children
  const findNodeById = (id: string): Node | undefined => {
    // First check main nodes
    const mainNode = nodes.find(n => n.id === id);
    if (mainNode) return mainNode;

    // Then check children of parent nodes
    for (const node of nodes) {
      if (node.isParent && node.children) {
        const childNode = node.children.find(child => child.id === id);
        if (childNode) return childNode;
      }
    }
    return undefined;
  };

  // Effect to update nodes from config
  useEffect(() => {
    const newNodes: Node[] = [];
    const newConnections: Connection[] = [];
    
    // Interface for creating more strongly typed ports
    interface PortWithTypedConnectedTo extends NodePort {
      connectedTo?: string;
    }
    
    // Helper function to create node inputs
    const createNodeInput = (name: string, type: string): NodePort => ({
      name,
      type,
      connectedTo: undefined,
    });
    
    // Helper function to create node outputs
    const createNodeOutput = (name: string, type: string): NodePort => ({
      name,
      type,
      connectedTo: undefined,
    });
    
    // Base spacing between nodes
    const nodeSpacing = 45;
    
    // Use a larger spacing for storage nodes to prevent overlap
    const storageNodeSpacing = 100;
    
    // Use a consistent spacing for AI nodes too
    const aiNodeSpacing = 80;
    
    // X position for left column (storage)
    const leftColumnX = 50;
    
    // X position for center column (AI)
    const centerColumnX = 350;
    
    // X position for right column (Sources, Enrichers, Generators)
    const rightColumnX = 650;
    
    // Add Storage nodes with increased spacing
    if (config.storage && config.storage.length > 0) {
      config.storage.forEach((storage, index) => {
        newNodes.push({
          id: `storage-${index}`,
          type: 'storage',
          name: storage.name,
          position: { x: leftColumnX, y: 100 + index * storageNodeSpacing },
          inputs: [],
          outputs: [createNodeOutput('storage', 'storage')],
          params: storage.params, // Add params from config
        });
      });
    }
    
    // Calculate storage section height to position AI nodes below
    const storageHeight = config.storage && config.storage.length > 0 
      ? 100 + (config.storage.length * storageNodeSpacing)
      : 100;
    
    // Add AI Provider nodes with adequate spacing
    if (config.ai && config.ai.length > 0) {
      const sectionPadding = 50; // Extra padding between sections
      
      config.ai.forEach((ai, index) => {
        newNodes.push({
          id: `ai-${index}`,
          type: 'ai',
          name: ai.name,
          position: { x: centerColumnX, y: storageHeight + sectionPadding + index * aiNodeSpacing },
          inputs: [],
          outputs: [createNodeOutput('provider', 'provider')],
          isProvider: true,
          params: ai.params, // Add params from config
        });
      });
    }
    
    // Define a consistent child node spacing
    const childNodeSpacing = 45;

    // Starting Y position for right column
    if (config.sources && config.sources.length > 0) {
      const sourceChildren = config.sources.map((source, index) => {
        // Create node
        const node = {
          id: `source-${index}`,
          type: 'source',
          name: source.name,
          position: { x: rightColumnX, y: 100 + index * childNodeSpacing },
          inputs: [
            ...(source.params?.provider ? [createNodeInput('provider', 'provider')] : []),
            ...(source.params?.storage ? [createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [], // Removed 'content' output port
          params: source.params, // Add params from config
        };
        
        // Create connections
        if (source.params?.provider) {
          const providerId = `ai-${config.ai.findIndex(p => p.name === source.params.provider)}`;
          if (providerId !== 'ai--1') { // Provider exists
            newConnections.push({
              from: { nodeId: providerId, output: 'provider' },
              to: { nodeId: node.id, input: 'provider' }
            });
            
            // Update connectedTo property
            if (node.inputs[0]) {
              (node.inputs[0] as PortWithTypedConnectedTo).connectedTo = providerId;
            }
          }
        }
        
        if (source.params?.storage) {
          const storageId = `storage-${config.storage.findIndex(s => s.name === source.params.storage)}`;
          if (storageId !== 'storage--1') { // Storage exists
            newConnections.push({
              from: { nodeId: storageId, output: 'storage' },
              to: { nodeId: node.id, input: 'storage' }
            });
            
            // Update connectedTo property
            const storageInputIndex = node.inputs.findIndex(i => i.name === 'storage');
            if (storageInputIndex !== -1) {
              (node.inputs[storageInputIndex] as PortWithTypedConnectedTo).connectedTo = storageId;
            }
          }
        }
        
        return node;
      });
      
      newNodes.push({
        id: 'sources-group',
        type: 'group',
        name: 'Sources',
        position: { x: rightColumnX, y: 50 },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: sourceChildren
      });
    }
    
    // Calculate the Y position based on source nodes (if any)
    const sourceNodeHeight = config.sources && config.sources.length > 0
      ? 100 + (config.sources.length * childNodeSpacing) + 100 // add 100px padding between groups
      : 300;
    
    // Add Enrichers
    if (config.enrichers && config.enrichers.length > 0) {
      const enricherChildren = config.enrichers.map((enricher, index) => {
        // Create node
        const node = {
          id: `enricher-${index}`,
          type: 'enricher',
          name: enricher.name,
          position: { x: rightColumnX, y: sourceNodeHeight + index * childNodeSpacing },
          inputs: [
            ...(enricher.params?.provider ? [createNodeInput('provider', 'provider')] : []),
            ...(enricher.params?.storage ? [createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: enricher.params, // Add params from config
        };
        
        // Create connections
        if (enricher.params?.provider) {
          const providerId = `ai-${config.ai.findIndex(p => p.name === enricher.params.provider)}`;
          if (providerId !== 'ai--1') { // Provider exists
            newConnections.push({
              from: { nodeId: providerId, output: 'provider' },
              to: { nodeId: node.id, input: 'provider' }
            });
            
            // Update connectedTo property
            if (node.inputs[0]) {
              (node.inputs[0] as PortWithTypedConnectedTo).connectedTo = providerId;
            }
          }
        }
        
        if (enricher.params?.storage) {
          const storageId = `storage-${config.storage.findIndex(s => s.name === enricher.params.storage)}`;
          if (storageId !== 'storage--1') { // Storage exists
            newConnections.push({
              from: { nodeId: storageId, output: 'storage' },
              to: { nodeId: node.id, input: 'storage' }
            });
            
            // Update connectedTo property
            const storageInputIndex = node.inputs.findIndex(i => i.name === 'storage');
            if (storageInputIndex !== -1) {
              (node.inputs[storageInputIndex] as PortWithTypedConnectedTo).connectedTo = storageId;
            }
          }
        }
        
        return node;
      });
      
      newNodes.push({
        id: 'enrichers-group',
        type: 'group',
        name: 'Enrichers',
        position: { x: rightColumnX, y: sourceNodeHeight },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: enricherChildren
      });
    }
    
    // Add Generators
    if (config.generators && config.generators.length > 0) {
      // Calculate the Y position based on previous node groups
      const enricherNodeHeight = config.enrichers && config.enrichers.length > 0
        ? sourceNodeHeight + (config.enrichers.length * childNodeSpacing) + 100 // add 100px padding between groups
        : sourceNodeHeight + 100;

      const generatorChildren = config.generators.map((generator, index) => {
        // Create node
        const node = {
          id: `generator-${index}`,
          type: 'generator',
          name: generator.name,
          position: { x: rightColumnX, y: enricherNodeHeight + index * childNodeSpacing },
          inputs: [
            ...(generator.params?.provider ? [createNodeInput('provider', 'provider')] : []),
            ...(generator.params?.storage ? [createNodeInput('storage', 'storage')] : [])
          ],
          outputs: [],
          params: generator.params, // Add params from config
        };
        
        // Create connections
        if (generator.params?.provider) {
          const providerId = `ai-${config.ai.findIndex(p => p.name === generator.params.provider)}`;
          if (providerId !== 'ai--1') { // Provider exists
            newConnections.push({
              from: { nodeId: providerId, output: 'provider' },
              to: { nodeId: node.id, input: 'provider' }
            });
            
            // Update connectedTo property
            if (node.inputs[0]) {
              (node.inputs[0] as PortWithTypedConnectedTo).connectedTo = providerId;
            }
          }
        }
        
        if (generator.params?.storage) {
          const storageId = `storage-${config.storage.findIndex(s => s.name === generator.params.storage)}`;
          if (storageId !== 'storage--1') { // Storage exists
            newConnections.push({
              from: { nodeId: storageId, output: 'storage' },
              to: { nodeId: node.id, input: 'storage' }
            });
            
            // Update connectedTo property
            const storageInputIndex = node.inputs.findIndex(i => i.name === 'storage');
            if (storageInputIndex !== -1) {
              (node.inputs[storageInputIndex] as PortWithTypedConnectedTo).connectedTo = storageId;
            }
          }
        }
        
        return node;
      });
      
      newNodes.push({
        id: 'generators-group',
        type: 'group',
        name: 'Generators',
        position: { x: rightColumnX, y: enricherNodeHeight },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: generatorChildren
      });
    }
    
    setNodes(newNodes);
    setConnections(newConnections);
  }, [config]);

  // Function to center the view on all nodes
  const centerView = (canvasWidth: number, canvasHeight: number) => {
    if (nodes.length === 0) return;

    // Calculate the bounds of all nodes including their children
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const processNode = (node: Node) => {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + 200); // Node width
      maxY = Math.max(maxY, node.position.y + (node.isParent ? 80 : 50)); // Node height

      if (node.isParent && node.children) {
        node.children.forEach(processNode);
      }
    };

    nodes.forEach(processNode);

    // Calculate center of all nodes
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Calculate the canvas center
    const canvasCenterX = canvasWidth / 2;
    const canvasCenterY = canvasHeight / 2;

    // Calculate the dimensions of the node bounds
    const nodeWidth = maxX - minX;
    const nodeHeight = maxY - minY;

    // Add padding (20% on each side)
    const padding = 0.2;
    const paddedWidth = nodeWidth * (1 + padding * 2);
    const paddedHeight = nodeHeight * (1 + padding * 2);

    // Calculate scale to fit nodes in view
    const scaleX = canvasWidth / paddedWidth;
    const scaleY = canvasHeight / paddedHeight;
    const newScale = Math.min(scaleX, scaleY, 2); // Cap at 2x zoom

    // Set new scale and offset to center the nodes
    setScale(newScale);
    setOffset({
      x: canvasCenterX - centerX * newScale,
      y: canvasCenterY - centerY * newScale
    });
  };

  // Updated rebuildAllConnections to ensure proper connection synchronization
  const rebuildAllConnections = useCallback(() => {
    console.log("🔄 Rebuilding all connections from scratch");
    
    // Create a new array for the connections
    const newConnections: Connection[] = [];
    
    // This set will track connections we've already processed to avoid duplicates
    const processedConnections = new Set<string>();
    
    // Helper function to create a connection ID
    const getConnectionId = (fromId: string, outputName: string, toId: string, inputName: string) => {
      return `${fromId}:${outputName}-->${toId}:${inputName}`;
    };
    
    // Process all nodes and rebuild their connections
    // This is the most important part - we build connections from parameters first
    const processNodeParams = (node: any) => {
      if (!node.params) return;
      
      // Handle provider parameter
      if (node.params.provider) {
        const providerName = node.params.provider;
        console.log(`Node ${node.id} has provider: ${providerName}`);
        
        // Find provider node by name
        let providerId = '';
        for (let i = 0; i < config.ai.length; i++) {
          if (config.ai[i].name === providerName) {
            providerId = `ai-${i}`;
            break;
          }
        }
        
        if (providerId) {
          console.log(`Found provider ${providerId} for node ${node.id}`);
          // Create connection ID
          const connectionId = getConnectionId(providerId, 'provider', node.id, 'provider');
          
          // Add the connection if not already processed
          if (!processedConnections.has(connectionId)) {
            const connection = {
              from: { nodeId: providerId, output: 'provider' },
              to: { nodeId: node.id, input: 'provider' }
            };
            
            newConnections.push(connection);
            processedConnections.add(connectionId);
            
            console.log(`Added parameter connection: ${providerId}.provider -> ${node.id}.provider`);
          }
        }
      }
      
      // Handle storage parameter
      if (node.params.storage) {
        const storageName = node.params.storage;
        console.log(`Node ${node.id} has storage: ${storageName}`);
        
        // Find storage node by name
        let storageId = '';
        for (let i = 0; i < config.storage.length; i++) {
          if (config.storage[i].name === storageName) {
            storageId = `storage-${i}`;
            break;
          }
        }
        
        if (storageId) {
          console.log(`Found storage ${storageId} for node ${node.id}`);
          // Create connection ID
          const connectionId = getConnectionId(storageId, 'storage', node.id, 'storage');
          
          // Add the connection if not already processed
          if (!processedConnections.has(connectionId)) {
            const connection = {
              from: { nodeId: storageId, output: 'storage' },
              to: { nodeId: node.id, input: 'storage' }
            };
            
            newConnections.push(connection);
            processedConnections.add(connectionId);
            
            console.log(`Added parameter connection: ${storageId}.storage -> ${node.id}.storage`);
          }
        }
      }
    };
    
    // After processing params, we'll process any explicit connections for non-provider/storage inputs
    const processExplicitConnections = (node: any) => {
      if (!node.inputs) return;
      
      node.inputs.forEach((input: any) => {
        // Skip provider and storage inputs - we already handled those via params
        if (input.name === 'provider' || input.name === 'storage') return;
        
        if (input.connectedTo) {
          // Find the source node
          const sourceNode = findNodeRecursive(nodes, input.connectedTo);
          if (!sourceNode) {
            console.warn(`Source node ${input.connectedTo} not found for connection to ${node.id}`);
            return;
          }
          
          // Determine output name
          let outputName = 'default';
          // Add any special mappings here
          
          // Verify source node has this output
          const sourcePort = sourceNode.outputs?.find((o: any) => o.name === outputName);
          if (!sourcePort) {
            console.warn(`Source node ${sourceNode.id} does not have output '${outputName}'`);
            return;
          }
          
          // Create connection ID
          const connectionId = getConnectionId(sourceNode.id, outputName, node.id, input.name);
          
          // Add the connection if not already processed
          if (!processedConnections.has(connectionId)) {
            const connection = {
              from: { nodeId: sourceNode.id, output: outputName },
              to: { nodeId: node.id, input: input.name }
            };
            
            newConnections.push(connection);
            processedConnections.add(connectionId);
            
            console.log(`Added explicit connection: ${sourceNode.id}.${outputName} -> ${node.id}.${input.name}`);
          }
        }
      });
    };
    
    // Now process all nodes
    const processAllNodes = () => {
      // First pass: build connections based on parameters
      nodes.forEach((node: any) => {
        processNodeParams(node);
        
        if (node.isParent && node.children) {
          node.children.forEach((child: any) => {
            processNodeParams(child);
          });
        }
      });
      
      // Second pass: add explicit connections that aren't provider/storage
      nodes.forEach((node: any) => {
        processExplicitConnections(node);
        
        if (node.isParent && node.children) {
          node.children.forEach((child: any) => {
            processExplicitConnections(child);
          });
        }
      });
    };
    
    // Process all nodes
    processAllNodes();
    
    // Update port connectedTo properties to match our connections
    const updateNodePorts = () => {
      // First clear all port connections
      const clearConnections = (node: any) => {
        if (node.inputs) {
          node.inputs.forEach((input: any) => {
            input.connectedTo = undefined;
          });
        }
        if (node.outputs) {
          node.outputs.forEach((output: any) => {
            output.connectedTo = undefined;
          });
        }
      };
      
      // Clear all existing connections
      nodes.forEach((node: any) => {
        clearConnections(node);
        
        if (node.isParent && node.children) {
          node.children.forEach((child: any) => {
            clearConnections(child);
          });
        }
      });
      
      // Now set connections based on our new connection list
      newConnections.forEach((conn: Connection) => {
        const sourceNode = findNodeRecursive(nodes, conn.from.nodeId);
        const targetNode = findNodeRecursive(nodes, conn.to.nodeId);
        
        if (sourceNode && targetNode) {
          // Find the output port
          const outputPort = sourceNode.outputs?.find((o: any) => o.name === conn.from.output);
          if (outputPort) {
            outputPort.connectedTo = conn.to.nodeId;
          }
          
          // Find the input port
          const inputPort = targetNode.inputs?.find((i: any) => i.name === conn.to.input);
          if (inputPort) {
            inputPort.connectedTo = conn.from.nodeId;
          }
        }
      });
    };
    
    // Update port connections
    updateNodePorts();
    
    console.log(`✅ Rebuilt ${newConnections.length} connections:`, newConnections);
    return newConnections;
  }, [nodes, config]);
  
  // Modified version of handlePluginSave that works reliably
  const handlePluginSave = useCallback((plugin: any) => {
    console.log('🔄 ==========================================================');
    console.log('🔄 SAVING PLUGIN:', JSON.stringify(plugin));
    console.log('🔄 ==========================================================');
    
    try {
      console.log('Plugin ID:', plugin.id);
      console.log('Plugin Type:', plugin.type);
      console.log('Plugin Params:', JSON.stringify(plugin.params));
      
      // Debug log the config.ai
      console.log('Available AI providers in config:', JSON.stringify(config.ai));
      
      // Ensure params is an object
      if (!plugin.params || typeof plugin.params !== 'object') {
        console.error('Invalid plugin params:', plugin.params);
        plugin.params = {};
      }
      
      // Clone the current configuration to avoid modifying it directly
      const updatedConfig = JSON.parse(JSON.stringify(config));
      
      // Get the node ID parts to determine type and index
      const idParts = plugin.id.split('-');
      const type = idParts[0];
      const index = parseInt(idParts[1]);
      
      // Determine if this is a child node
      const isChild = plugin.isChild === true;
      
      // Create a deep copy of the nodes array to update safely
      const updatedNodes = JSON.parse(JSON.stringify(nodes));
      
      // Create a deep copy of connections to update
      const updatedConnections = JSON.parse(JSON.stringify(connections));
      
      // Find the node to update
      const nodeToUpdate = findNodeRecursive(updatedNodes, plugin.id);
      if (!nodeToUpdate) {
        console.error(`Could not find node with ID ${plugin.id}`);
        return false;
      }
      
      console.log('Found node to update:', nodeToUpdate);
      
      // Track connections to add and remove
      let connectionsToRemove: Connection[] = [];
      let connectionsToAdd: Connection[] = [];
      
      // Update node properties
      nodeToUpdate.name = plugin.name;
      nodeToUpdate.params = plugin.params || {};
      
      // Handle provider connections
      if ('provider' in plugin.params) {
        console.log('🔌 Processing PROVIDER parameter:', plugin.params.provider);
        
        // Find the current provider connection if any
        const currentProviderConn = connections.find((conn: Connection) => 
          conn.to.nodeId === plugin.id && conn.to.input === 'provider'
        );
        
        // Remove current provider connection if it exists
        if (currentProviderConn) {
          console.log('🔌 Current provider connection:', currentProviderConn);
          
          // Get the current connected provider node
          const currentProviderNode = findNodeRecursive(nodes, currentProviderConn.from.nodeId);
          
          if (currentProviderNode) {
            console.log('🔌 Current provider node:', currentProviderNode.name);
            
            // Check if the provider has changed
            if (currentProviderNode.name !== plugin.params.provider) {
              console.log(`🔌 Provider changed from ${currentProviderNode.name} to ${plugin.params.provider}`);
              
              // Add the connection to our removal list
              connectionsToRemove.push(currentProviderConn);
              
              // Remove the connection from our updated connections
              const connIndex = updatedConnections.findIndex((conn: Connection) => 
                conn.to.nodeId === plugin.id && conn.to.input === 'provider'
              );
              if (connIndex !== -1) {
                updatedConnections.splice(connIndex, 1);
              }
              
              // Clear the connectedTo property on the input port
              const providerInput = nodeToUpdate.inputs.find((input: NodePort) => input.name === 'provider');
              if (providerInput) {
                console.log('🔌 Clearing provider input connection');
                providerInput.connectedTo = undefined;
              }
              
              // Clear the connection on the provider's output port
              const providerOutput = currentProviderNode.outputs.find((output: NodePort) => 
                output.name === 'provider' && output.connectedTo === plugin.id
              );
              if (providerOutput) {
                console.log('🔌 Clearing provider output connection');
                providerOutput.connectedTo = undefined;
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
            (currentProviderConn && findNodeRecursive(nodes, currentProviderConn.from.nodeId)?.name !== plugin.params.provider)) {
          
          const newProviderNode = updatedNodes.find((node: Node) => 
            node.type === 'ai' && node.name === plugin.params.provider
          );
          
          if (newProviderNode) {
            console.log('🔌 Found new provider node:', newProviderNode.name);
            
            // Check if we don't already have this connection
            const existingConnection = updatedConnections.find((conn: Connection) => 
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
              const providerInput = nodeToUpdate.inputs.find((input: NodePort) => input.name === 'provider');
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
              const providerOutput = newProviderNode.outputs.find((output: NodePort) => output.name === 'provider');
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
      
      // Handle storage connections (similar to provider)
      if ('storage' in plugin.params) {
        console.log('🔌 Processing STORAGE parameter:', plugin.params.storage);
        
        // Find the current storage connection if any
        const currentStorageConn = connections.find((conn: Connection) => 
          conn.to.nodeId === plugin.id && conn.to.input === 'storage'
        );
        
        if (currentStorageConn) {
          console.log('Current storage connection:', currentStorageConn);
          
          // Get the current connected storage node
          const currentStorageNode = findNodeRecursive(nodes, currentStorageConn.from.nodeId);
          
          if (currentStorageNode) {
            // Check if the storage has changed
            if (currentStorageNode.name !== plugin.params.storage) {
              console.log(`Storage changed from ${currentStorageNode.name} to ${plugin.params.storage}`);
              
              // Add the connection to our removal list
              connectionsToRemove.push(currentStorageConn);
              
              // Remove the connection from our updated connections
              const connIndex = updatedConnections.findIndex((conn: Connection) => 
                conn.to.nodeId === plugin.id && conn.to.input === 'storage'
              );
              if (connIndex !== -1) {
                updatedConnections.splice(connIndex, 1);
              }
              
              // Clear the connectedTo property on the input port
              const storageInput = nodeToUpdate.inputs.find((input: NodePort) => input.name === 'storage');
              if (storageInput) {
                storageInput.connectedTo = undefined;
              }
              
              // Clear the connection on the storage's output port
              const storageOutput = currentStorageNode.outputs.find((output: NodePort) => 
                output.name === 'storage' && output.connectedTo === plugin.id
              );
              if (storageOutput) {
                storageOutput.connectedTo = undefined;
              }
            }
          }
        }
        
        // Find the new storage node if storage has changed or there was no connection
        if (!currentStorageConn || 
            (currentStorageConn && findNodeRecursive(nodes, currentStorageConn.from.nodeId)?.name !== plugin.params.storage)) {
            
          const newStorageNode = updatedNodes.find((node: Node) => 
            node.type === 'storage' && node.name === plugin.params.storage
          );
          
          if (newStorageNode) {
            console.log('Found new storage node:', newStorageNode);
            
            // Check if we don't already have this connection
            const existingConnection = updatedConnections.find((conn: Connection) => 
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
              const storageInput = nodeToUpdate.inputs.find((input: NodePort) => input.name === 'storage');
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
              const storageOutput = newStorageNode.outputs.find((output: NodePort) => output.name === 'storage');
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
        
      // Update the node configuration in the config object
      switch (type) {
        case 'source':
        case 'sources':
          if (isChild && plugin.parentId) {
            // Handle child node of a parent
            const parentIdParts = plugin.parentId.split('-');
            const parentIndex = parseInt(parentIdParts[1]);
            
            // Find the index of the child within its parent
            const parentNode = updatedNodes.find((n: Node) => n.id === plugin.parentId);
            if (parentNode && parentNode.children) {
              const childIndex = parentNode.children.findIndex((c: Node) => c.id === plugin.id);
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
            const parentNode = updatedNodes.find((n: Node) => n.id === plugin.parentId);
            if (parentNode && parentNode.children) {
              const childIndex = parentNode.children.findIndex((c: Node) => c.id === plugin.id);
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
            const parentNode = updatedNodes.find((n: Node) => n.id === plugin.parentId);
            if (parentNode && parentNode.children) {
              const childIndex = parentNode.children.findIndex((c: Node) => c.id === plugin.id);
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
        // Add cases for other node types (ai, storage) if needed
      }
      
      // Update the configurations if changed
      onConfigUpdate(updatedConfig);
      
      // Update the state with the new nodes and connections
      setNodes(updatedNodes);
      setConnections(updatedConnections);
      
      console.log("Plugin updates applied. Nodes:", updatedNodes.length, "Connections:", updatedConnections.length);
      return true;
    } catch (error) {
      console.error("Error in handlePluginSave:", error);
      return false;
    }
  }, [config, nodes, connections, findNodeRecursive]);

  const handleConfigSave = (name: string) => {
    const newConfig = { ...config, name };
    onConfigUpdate(newConfig);
    setShowConfigDialog(false);
  };

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      // No animation frames to clean up anymore
    };
  }, []);

  return {
    nodes,
    connections,
    selectedNode,
    isDragging,
    dragStart,
    connectingFrom,
    scale,
    offset,
    isPanning,
    panStart,
    targetScale,
    targetOffset,
    mousePosition,
    hoveredPort,
    viewMode,
    showPluginDialog,
    showConfigDialog,
    selectedPlugin,
    animationFrameRef,
    setNodes,
    setConnections,
    setSelectedNode,
    setIsDragging,
    setDragStart,
    setConnectingFrom,
    setScale,
    setOffset,
    setIsPanning,
    setPanStart,
    setTargetScale,
    setTargetOffset,
    setMousePosition,
    setHoveredPort,
    setViewMode,
    setShowPluginDialog,
    setShowConfigDialog,
    setSelectedPlugin,
    findNodeById,
    screenToCanvas,
    handleWheel,
    centerView,
    handlePluginSave,
    handleConfigSave
  };
}; 