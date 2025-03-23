import { useState, useRef, useEffect, useCallback } from 'react';
import { Config, PluginConfig, PluginType } from '../types';
import { Node, Connection, PortInfo, NodeCoordinates, ViewSettings, NodePort } from '../types/nodeTypes';
import { findNodeRecursive } from '../utils/nodeHandlers';

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
  handlePluginSave: (params: Record<string, any>, interval?: number) => void;
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
    
    // X position for left column (storage)
    const leftColumnX = 50;
    
    // X position for center column (AI)
    const centerColumnX = 350;
    
    // X position for right column (Sources, Enrichers, Generators)
    const rightColumnX = 650;
    
    // Add Storage nodes
    if (config.storage && config.storage.length > 0) {
      config.storage.forEach((storage, index) => {
        newNodes.push({
          id: `storage-${index}`,
          type: 'storage',
          name: storage.name,
          position: { x: leftColumnX, y: 100 + index * nodeSpacing },
          inputs: [],
          outputs: [createNodeOutput('storage', 'storage')],
          params: storage.params, // Add params from config
        });
      });
    }
    
    // Add AI Provider nodes
    if (config.ai && config.ai.length > 0) {
      config.ai.forEach((ai, index) => {
        newNodes.push({
          id: `ai-${index}`,
          type: 'ai',
          name: ai.name,
          position: { x: centerColumnX, y: 100 + index * nodeSpacing },
          inputs: [],
          outputs: [createNodeOutput('provider', 'provider')],
          isProvider: true,
          params: ai.params, // Add params from config
        });
      });
    }
    
    // Starting Y position for right column
    if (config.sources && config.sources.length > 0) {
      const sourceChildren = config.sources.map((source, index) => {
        // Create node
        const node = {
          id: `source-${index}`,
          type: 'source',
          name: source.name,
          position: { x: rightColumnX, y: 100 + index * nodeSpacing },
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
    
    // Add Enrichers
    if (config.enrichers && config.enrichers.length > 0) {
      const enricherChildren = config.enrichers.map((enricher, index) => {
        // Create node
        const node = {
          id: `enricher-${index}`,
          type: 'enricher',
          name: enricher.name,
          position: { x: rightColumnX, y: 300 + index * nodeSpacing },
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
        position: { x: rightColumnX, y: 250 },
        inputs: [],
        outputs: [],
        isParent: true,
        expanded: true,
        children: enricherChildren
      });
    }
    
    // Add Generators
    if (config.generators && config.generators.length > 0) {
      const generatorChildren = config.generators.map((generator, index) => {
        // Create node
        const node = {
          id: `generator-${index}`,
          type: 'generator',
          name: generator.name,
          position: { x: rightColumnX, y: 500 + index * nodeSpacing },
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
        position: { x: rightColumnX, y: 450 },
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

  // Handle saving a plugin's configuration
  const handlePluginSave = useCallback((plugin: any) => {
    console.log('Saving plugin:', plugin);
    // Clone the current configuration
    const updatedConfig = { ...config };
    
    // Get the node ID parts to determine type and index
    const idParts = plugin.id.split('-');
    const type = idParts[0];
    const index = parseInt(idParts[1]);
    
    // Determine if this is a child node
    const isChild = plugin.isChild === true;
    
    // Update the configuration based on type
    if (isChild && plugin.parentId) {
      // For child nodes, update the parent's children array
      const parentIdParts = plugin.parentId.split('-');
      const parentType = parentIdParts[0];
      const parentIndex = parseInt(parentIdParts[1]);
      
      // Find the child index within the parent
      const childNode = findNodeRecursive(nodes, plugin.id);
      const parentNode = findNodeRecursive(nodes, plugin.parentId);
      
      if (parentNode && parentNode.children && childNode) {
        const childIndex = parentNode.children.findIndex(child => child.id === plugin.id);
        
        if (childIndex !== -1) {
          // Update parameters in the config
          switch (parentType) {
            case 'source':
            case 'sources':
              if (updatedConfig.sources && updatedConfig.sources[parentIndex]) {
                // Initialize the children array if it doesn't exist
                if (!updatedConfig.sources[parentIndex].params) {
                  updatedConfig.sources[parentIndex].params = {};
                }
                if (!updatedConfig.sources[parentIndex].params.children) {
                  updatedConfig.sources[parentIndex].params.children = [];
                }
                
                // Ensure there's an entry for this child index
                while (updatedConfig.sources[parentIndex].params.children.length <= childIndex) {
                  updatedConfig.sources[parentIndex].params.children.push({});
                }
                
                // Update the child's params
                updatedConfig.sources[parentIndex].params.children[childIndex] = plugin.params;
              }
              break;
            case 'enricher':
            case 'enrichers':
              if (updatedConfig.enrichers && updatedConfig.enrichers[parentIndex]) {
                // Initialize the children array if it doesn't exist
                if (!updatedConfig.enrichers[parentIndex].params) {
                  updatedConfig.enrichers[parentIndex].params = {};
                }
                if (!updatedConfig.enrichers[parentIndex].params.children) {
                  updatedConfig.enrichers[parentIndex].params.children = [];
                }
                
                // Ensure there's an entry for this child index
                while (updatedConfig.enrichers[parentIndex].params.children.length <= childIndex) {
                  updatedConfig.enrichers[parentIndex].params.children.push({});
                }
                
                // Update the child's params
                updatedConfig.enrichers[parentIndex].params.children[childIndex] = plugin.params;
              }
              break;
            case 'generator':
            case 'generators':
              if (updatedConfig.generators && updatedConfig.generators[parentIndex]) {
                // Initialize the children array if it doesn't exist
                if (!updatedConfig.generators[parentIndex].params) {
                  updatedConfig.generators[parentIndex].params = {};
                }
                if (!updatedConfig.generators[parentIndex].params.children) {
                  updatedConfig.generators[parentIndex].params.children = [];
                }
                
                // Ensure there's an entry for this child index
                while (updatedConfig.generators[parentIndex].params.children.length <= childIndex) {
                  updatedConfig.generators[parentIndex].params.children.push({});
                }
                
                // Update the child's params
                updatedConfig.generators[parentIndex].params.children[childIndex] = plugin.params;
              }
              break;
          }
          
          // Also update the node's params in the state
          if (childNode) {
            childNode.params = plugin.params;
          }
        }
      }
    } else {
      // Handle regular nodes
      switch (type) {
        case 'source':
        case 'sources':
          if (updatedConfig.sources && updatedConfig.sources[index]) {
            updatedConfig.sources[index].params = plugin.params;
          }
          break;
        case 'enricher':
        case 'enrichers':
          if (updatedConfig.enrichers && updatedConfig.enrichers[index]) {
            updatedConfig.enrichers[index].params = plugin.params;
          }
          break;
        case 'generator':
        case 'generators':
          if (updatedConfig.generators && updatedConfig.generators[index]) {
            updatedConfig.generators[index].params = plugin.params;
          }
          break;
        case 'ai':
          if (updatedConfig.ai && updatedConfig.ai[index]) {
            updatedConfig.ai[index].params = plugin.params;
          }
          break;
        case 'storage':
          if (updatedConfig.storage && updatedConfig.storage[index]) {
            updatedConfig.storage[index].params = plugin.params;
          }
          break;
      }
      
      // Also update the node's params in the state
      const node = findNodeRecursive(nodes, plugin.id);
      if (node) {
        node.params = plugin.params;
      }
    }
    
    // Update the configuration
    onConfigUpdate(updatedConfig);
    
    // Force a re-render of the nodes
    setNodes([...nodes]);
  }, [config, nodes, onConfigUpdate]);

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