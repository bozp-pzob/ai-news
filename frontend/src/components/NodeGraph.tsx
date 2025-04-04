import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Config, PluginInfo } from '../types';
import { PluginParamDialog } from './PluginParamDialog';
import { ConfigDialog } from './ConfigDialog';
import { PluginPalette } from './PluginPalette';
import { drawConnection, drawConnectionLine, drawNode, drawGrid } from '../utils/nodeRenderer';
import { findPortAtCoordinates, isPointInNode, removeNodeConnection, handleNodeConnection, findNodeAtCoordinates, findNodeRecursive, isPointInCollapseButton, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';
import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { configStateManager } from '../services/ConfigStateManager';
import { pluginRegistry } from '../services/PluginRegistry';
import { animateCenterView } from '../utils/animation/centerViewAnimation';

// Add type constants to represent the pipeline flow steps
const PIPELINE_STEPS = ['sources', 'enrichers', 'generators'] as const;
type PipelineStep = typeof PIPELINE_STEPS[number];

interface NodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config) => void;
  saveConfiguration?: () => Promise<boolean>;
}

export const NodeGraph: React.FC<NodeGraphProps> = ({ config, onConfigUpdate, saveConfiguration }) => {
  // Get the initial state from the ConfigStateManager
  const [nodes, setNodes] = useState<Node[]>(configStateManager.getNodes());
  const [connections, setConnections] = useState<Connection[]>(configStateManager.getConnections());
  const [selectedNode, setSelectedNode] = useState<string | null>(configStateManager.getSelectedNode());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<PortInfo | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mousePosition, setMousePosition] = useState<{ x: number, y: number } | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortInfo | null>(null);
  const [showPluginDialog, setShowPluginDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<any>(null);
  const [isRedrawing, setIsRedrawing] = useState(false);
  const [autoAdjustViewport, setAutoAdjustViewport] = useState(true);
  const [canvasBounds, setCanvasBounds] = useState({ 
    minX: -1000, maxX: 1000, 
    minY: -1000, maxY: 1000
  });
  const [pluginsLoaded, setPluginsLoaded] = useState(pluginRegistry.isPluginsLoaded());
  const [draggedPlugin, setDraggedPlugin] = useState<PluginInfo | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number, y: number } | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const [paletteAnimation, setPaletteAnimation] = useState<'opening' | 'closing' | 'idle'>('idle');
  const [paletteVisible, setPaletteVisible] = useState(true);
  const [showPipelineFlow, setShowPipelineFlow] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backBufferRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const updateQueueRef = useRef<(() => void)[]>([]);
  const isUpdateScheduledRef = useRef(false);
  const dragNodeRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const lastNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const animationStartTimeRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);
  
  // Add lastClickTime for tracking double clicks
  const lastClickTimeRef = useRef<number>(0);

  // Add a useRef to track animation
  const emptyStateAnimationRef = useRef<number | null>(null);
  const emptyStateOpacityRef = useRef(0.8);
  const emptyStateIncreasingRef = useRef(true);
  
  // Create a ref to store the pipeline flow function to break circular dependency
  const pipelineFlowFnRef = useRef<(ctx: CanvasRenderingContext2D) => void>(() => {});

  // Load plugins when component mounts
  useEffect(() => {
    // Subscribe to plugin loading events
    const unsubscribe = pluginRegistry.subscribe(() => {
      setPluginsLoaded(true);
    });

    // Load plugins if not already loaded
    if (!pluginRegistry.isPluginsLoaded()) {
      pluginRegistry.loadPlugins()
        .then(() => {
          console.log("NodeGraph: Plugins loaded successfully");
        })
        .catch(error => {
          console.error("NodeGraph: Error loading plugins:", error);
        });
    }

    return () => {
      // Clean up subscription
      unsubscribe();
    };
  }, []);

  // Initialize ConfigStateManager with the current config
  useEffect(() => {
    console.log("🔄 NodeGraph: initializing with config", config);
    
    // Check if config is valid - if not, create an empty graph for drag and drop
    if (!config || !config.name) {
      console.log("🔄 NodeGraph: invalid config, initializing empty graph for drag and drop");
      
      // Create a minimal default config that satisfies the Config type
      const emptyConfig: Config = {
        name: 'new-config',
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
      
      // Initialize state manager with empty config
      configStateManager.loadConfig(emptyConfig);
      configStateManager.forceSync();
      
      // Update local state
      setNodes([]);
      setConnections([]);
      setSelectedNode(null);
      
      // Always show palette when starting with empty graph
      setShowPalette(true);
      
      // Force a redraw to show empty graph
      setTimeout(() => {
        if (canvasRef.current) {
          drawToBackBuffer();
          drawToScreen();
        }
      }, 0);
      
      return;
    }
    
    try {
      // Load the config into the state manager
      configStateManager.loadConfig(config);
      
      // Force immediate cleanup of connections and synchronization of node ports
      configStateManager.forceSync();
      
      // Immediately update our local state with the latest from the state manager
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      setSelectedNode(configStateManager.getSelectedNode());
      
      console.log("🔄 NodeGraph: nodes after initialization:", configStateManager.getNodes().length);
      
      // Schedule auto-centering after the canvas and nodes are ready
      const nodesLoaded = configStateManager.getNodes().length > 0;
      if (nodesLoaded) {
        console.log("Scheduling auto-center after config load");
        
        // Use timeout to ensure the component is fully rendered
        setTimeout(() => {
          if (canvasRef.current) {
            console.log("Auto-centering after config load");
            // Define a local function to handle centering
            const autoCenterOnLoad = () => {
              if (!canvasRef.current) return;
              
              console.log("Running auto-center calculation");
              
              // Calculate the bounds of all nodes
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              
              const nodesToProcess = configStateManager.getNodes();
              
              // Helper function to process each node
              const processNode = (node: Node) => {
                const nodeWidth = 200;
                const nodeHeight = node.isParent ? 
                  (node.expanded ? (25 + node.inputs.length * 20) : 80) : 
                  (25 + Math.max(node.inputs.length, node.outputs.length) * 20);
                
                minX = Math.min(minX, node.position.x);
                minY = Math.min(minY, node.position.y);
                maxX = Math.max(maxX, node.position.x + nodeWidth);
                maxY = Math.max(maxY, node.position.y + nodeHeight);
                
                if (node.isParent && node.children && node.expanded) {
                  node.children.forEach(processNode);
                }
              };
              
              nodesToProcess.forEach(processNode);
              
              if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
                console.warn('Invalid node bounds calculated');
                return;
              }
              
              // Add padding to the bounds
              const padding = 75;
              minX -= padding;
              minY -= padding;
              maxX += padding;
              maxY += padding;
              
              // Calculate the dimensions and center of the node bounds
              const nodeWidth = maxX - minX;
              const nodeHeight = maxY - minY;
              const centerX = (minX + maxX) / 2;
              const centerY = (minY + maxY) / 2;
              
              // Get canvas dimensions
              const canvasWidth = canvasRef.current.width;
              const canvasHeight = canvasRef.current.height;
              
              console.log(`Canvas dimensions: ${canvasWidth}x${canvasHeight}`);
              console.log(`Node bounds: (${minX},${minY}) to (${maxX},${maxY})`);
              
              // Calculate scale to fit nodes in view with padding
              const scaleX = canvasWidth / nodeWidth;
              const scaleY = canvasHeight / nodeHeight;
              const targetScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, 0.1), 2.0);
              
              // Calculate target offset to center the nodes
              const targetOffset = {
                x: (canvasWidth / 2) - (centerX * targetScale),
                y: (canvasHeight / 2) - (centerY * targetScale)
              };
              
              console.log(`Setting scale=${targetScale}, offset=(${targetOffset.x},${targetOffset.y})`);
              
              // Apply changes directly without animation
              setScale(targetScale);
              setOffset(targetOffset);
              
              // Force immediate redraw
              drawToBackBuffer();
              drawToScreen();
            };
            
            // Make sure canvas size is set before centering
            if (canvasRef.current.width === 0 || canvasRef.current.height === 0) {
              const updateCanvasAndCenter = () => {
                if (canvasRef.current && containerRef.current) {
                  canvasRef.current.width = containerRef.current.clientWidth;
                  canvasRef.current.height = containerRef.current.clientHeight;
                  autoCenterOnLoad();
                }
              };
              
              // Try to update canvas size and then center
              updateCanvasAndCenter();
            } else {
              // Canvas already has size, just center
              autoCenterOnLoad();
            }
          }
        }, 0); // Reduced timeout to 0 to prevent initial zoom
      }
    } catch (error) {
      console.error("Error initializing ConfigStateManager:", error);
    }
  }, [config.name]); // Only re-initialize when the config name changes

  // Initialize back buffer canvas
  useEffect(() => {
    // Create back buffer for double buffering
    backBufferRef.current = document.createElement('canvas');
    
    return () => {
      backBufferRef.current = null;
    };
  }, []);

  // Schedule updates to be processed in batches
  const scheduleUpdate = useCallback((updateFn: () => void) => {
    updateQueueRef.current.push(updateFn);
    
    if (!isUpdateScheduledRef.current) {
      isUpdateScheduledRef.current = true;
      
      // Process all updates in the next animation frame
      requestAnimationFrame(() => {
        const updates = [...updateQueueRef.current];
        updateQueueRef.current = [];
        
        // Apply all updates
        updates.forEach(update => update());
        
        // Reset flag
        isUpdateScheduledRef.current = false;
        
        // Draw to screen
        drawToScreen();
      });
    }
  }, []);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((x: number, y: number, canvasRect: DOMRect) => {
    // Calculate relative position in the canvas
    const relativeX = x - canvasRect.left;
    const relativeY = y - canvasRect.top;
    
    // Apply zoom and pan transformations
    return {
      x: (relativeX - offset.x) / scale,
      y: (relativeY - offset.y) / scale
    };
  }, [offset, scale]);

  // Check if node is outside current canvas bounds and expand if needed
  const checkAndExpandCanvasBounds = useCallback((nodePosition: { x: number, y: number }, nodeWidth = 200, nodeHeight = 80) => {
    const padding = 75; // Padding around nodes to prevent them from being right at the edge
    
    // Only check bounds without immediately updating state for smoother performance
    let needsUpdate = false;
    let newBounds = { ...canvasBounds };
    
    // Check left bound
    if (nodePosition.x < canvasBounds.minX + padding) {
      newBounds.minX = nodePosition.x - padding;
      needsUpdate = true;
    }
    
    // Check right bound
    if (nodePosition.x + nodeWidth > canvasBounds.maxX - padding) {
      newBounds.maxX = nodePosition.x + nodeWidth + padding;
      needsUpdate = true;
    }
    
    // Check top bound
    if (nodePosition.y < canvasBounds.minY + padding) {
      newBounds.minY = nodePosition.y - padding;
      needsUpdate = true;
    }
    
    // Check bottom bound
    if (nodePosition.y + nodeHeight > canvasBounds.maxY - padding) {
      newBounds.maxY = nodePosition.y + nodeHeight + padding;
      needsUpdate = true;
    }
    
    // Batch updates to bounds with throttling for better performance
    if (needsUpdate && !isUpdateScheduledRef.current) {
      isUpdateScheduledRef.current = true;
      requestAnimationFrame(() => {
        setCanvasBounds(newBounds);
        isUpdateScheduledRef.current = false;
      });
    }
    
    return needsUpdate;
  }, [canvasBounds]);

  // Smoothly adjust viewport to include node with less aggressive behavior
  const smoothlyAdjustViewport = useCallback((nodePosition: { x: number, y: number }) => {
    if (!canvasRef.current) return;
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const nodeScreenX = nodePosition.x * scale + offset.x;
    const nodeScreenY = nodePosition.y * scale + offset.y;
    
    // Use more responsive padding
    const padding = 120; 
    
    // Increased adjustment factor for more responsiveness without jerkiness
    const adjustmentFactor = 0.03;
    
    // Apply directly to offset using functional updates for smoother experience
    setOffset(prev => {
      let newX = prev.x;
      let newY = prev.y;
      
      // Only adjust if node is outside visible area
      if (nodeScreenX < padding) {
        // More responsive adjustment while still smooth
        newX += (padding - nodeScreenX) * adjustmentFactor;
      } else if (nodeScreenX > canvasRect.width - padding) {
        newX -= (nodeScreenX - (canvasRect.width - padding)) * adjustmentFactor;
      }
      
      if (nodeScreenY < padding) {
        newY += (padding - nodeScreenY) * adjustmentFactor;
      } else if (nodeScreenY > canvasRect.height - padding) {
        newY -= (nodeScreenY - (canvasRect.height - padding)) * adjustmentFactor;
      }
      
      return { x: newX, y: newY };
    });
  }, [scale, offset]);

  // Enhanced version of handleWheel
  const handleWheelZoom = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    console.log("Wheel event detected", e.deltaY);
    e.preventDefault();
    
    if (!canvasRef.current) return;
    
    // Calculate zoom factor
    const zoomFactor = -0.001;
    const delta = e.deltaY;
    
    // Get mouse position in canvas coordinates
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;
    
    // Calculate new scale
    let newScale = scale + delta * zoomFactor * scale;
    
    // Clamp the scale to reasonable values
    newScale = Math.max(0.1, Math.min(newScale, 5.0));
    
    // Calculate how to adjust the offset to zoom into/out of the mouse position
    const scaleChange = newScale / scale;
    
    const offsetX = offset.x - (mouseX - offset.x) * (scaleChange - 1);
    const offsetY = offset.y - (mouseY - offset.y) * (scaleChange - 1);
    
    console.log(`Zooming: delta=${delta}, new scale=${newScale}, new offset=(${offsetX}, ${offsetY})`);
    
    // Update the scale and offset 
    setScale(newScale);
    setOffset({ x: offsetX, y: offsetY });
  }, [scale, offset]);

  // Handle panning with more direct control
  const handlePanStart = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePanMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanning) return;

    // Calculate the movement in screen coordinates
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;

    // Update pan start to current position
    setPanStart({ x: e.clientX, y: e.clientY });
    
    // Apply the movement directly to the offset - using functional update
    setOffset(prev => ({
      x: prev.x + dx,
      y: prev.y + dy
    }));
  }, [isPanning, panStart]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Handle mouse movement with optimized dragging
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Update mouse position
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const canvasRect = canvasElement.getBoundingClientRect();
    const { x: mouseX, y: mouseY } = screenToCanvas(e.clientX, e.clientY, canvasRect);
    
    // Only update mouse position if needed for drawing connections
    if (connectingFrom) {
      setMousePosition({ x: mouseX, y: mouseY });
    }

    if (isPanning) {
      handlePanMove(e);
      return;
    }

    if (isDragging && selectedNode) {
      // Get current mouse position in canvas coordinates
      const currentPos = screenToCanvas(e.clientX, e.clientY, canvasRect);
      
      // Calculate the delta movement in canvas coordinates
      const dx = currentPos.x - dragStart.x;
      const dy = currentPos.y - dragStart.y;

      // Find the selected node
      const selectedNodeObj = nodes.find(n => n.id === selectedNode);
      if (!selectedNodeObj) return;
      
      // Variable to track if this is a child of a parent node
      let isChild = false;
      let parentNode: any = null;
      
      // Check if this is a child node
      if (!selectedNodeObj.isParent) {
        parentNode = nodes.find(n => 
          n.isParent && n.children && n.children.some(child => child.id === selectedNode)
        );
        isChild = !!parentNode;
      }

      // Calculate new position once
      const newX = selectedNodeObj.position.x + dx;
      const newY = selectedNodeObj.position.y + dy;
      
      // Check if the node is near the edge of the canvas bounds
      // Only check occasionally for performance
      if (Math.random() < 0.1) { // 10% chance to check
        if (newX < canvasBounds.minX + 300 || 
            newX > canvasBounds.maxX - 300 ||
            newY < canvasBounds.minY + 300 ||
            newY > canvasBounds.maxY - 300) {
          
          // Expand canvas bounds with a large padding
          const padding = 700;
          // Update canvas bounds
          setCanvasBounds({
            minX: Math.min(canvasBounds.minX, newX - padding),
            maxX: Math.max(canvasBounds.maxX, newX + padding),
            minY: Math.min(canvasBounds.minY, newY - padding),
            maxY: Math.max(canvasBounds.maxY, newY + padding)
          });
        }
      }
      
      // Always adjust viewport for smooth scrolling when dragging
      smoothlyAdjustViewport({ x: newX, y: newY });
      
      // Create a new array of nodes with updated positions
      const updatedNodes = nodes.map(node => {
        // Case 1: This is the selected node
        if (node.id === selectedNode) {
          // Update node position
          const updatedNode = {
            ...node,
            position: { x: newX, y: newY }
          };
          
          // If it's a parent node, also update all its children
          if (node.isParent && node.children) {
            updatedNode.children = node.children.map(child => ({
              ...child,
              position: {
                x: child.position.x + dx,
                y: child.position.y + dy
              }
            }));
          }
          
          return updatedNode;
        }
        
        // Case 2: This is a parent node of the selected node
        if (isChild && parentNode && node.id === parentNode.id) {
          return node; // Don't move the parent when moving a child
        }
        
        // Case 3: Node is not related to the selection
        return node;
      });
      
      // For dragging, we'll use local state for temporary smooth updates
      // but throttle updates to ConfigStateManager to avoid excessive processing
      setNodes(updatedNodes);
      
      // Use our double buffering for smoother rendering
      drawToBackBuffer();
      drawToScreen();
      
      // Debounce updates to the config state manager for better performance
      if (!isUpdateScheduledRef.current) {
        isUpdateScheduledRef.current = true;
        
        // Use requestAnimationFrame to throttle updates to ConfigStateManager
        requestAnimationFrame(() => {
          configStateManager.setNodes(updatedNodes);
          isUpdateScheduledRef.current = false;
        });
      }
      
      // Update dragStart to the current position
      setDragStart(currentPos);
    }

    // Check for port hover - only if not dragging for performance
    if (!isDragging) {
      const portInfo = findPortAtCoordinates(mouseX, mouseY, nodes);
      setHoveredPort(portInfo);
    }
  };

  // Draw back buffer to the screen
  const drawToScreen = useCallback(() => {
    if (!canvasRef.current || !backBufferRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Draw the back buffer to the canvas in one operation to prevent flickering
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(backBufferRef.current, 0, 0);
  }, []);

  // Draw the default pipeline flow in the background
  const drawPipelineFlow = useCallback((ctx: CanvasRenderingContext2D) => {
    // Skip if pipeline flow is disabled
    if (!showPipelineFlow) return;
    
    // Group nodes by type (sources, enrichers, generators)
    const nodesByType = {
      sources: nodes.filter(node => node.id.startsWith('source')),
      enrichers: nodes.filter(node => node.id.startsWith('enricher')),
      generators: nodes.filter(node => node.id.startsWith('generator'))
    };
    
    // Function to calculate the center position of a node group
    const getNodeGroupCenter = (nodes: Node[]): {x: number, y: number} => {
      if (nodes.length === 0) return { x: 0, y: 0 };
      
      // Get bounding box of all nodes in the group
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      
      nodes.forEach(node => {
        // Node width is fixed at 200px
        const nodeWidth = 200;
        
        // Calculate node height based on inputs/outputs
        const nodeHeight = node.isParent ? 
          (node.expanded ? (25 + node.inputs.length * 20) : 80) : 
          (25 + Math.max(node.inputs.length, node.outputs.length) * 20);
        
        // Update bounds
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + nodeWidth);
        maxY = Math.max(maxY, node.position.y + nodeHeight);
      });
      
      // Return center point of the bounding box
      return {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
      };
    };
    
    // Get positions of each node group with existence flag
    const groupCenters = {
      sources: { 
        ...getNodeGroupCenter(nodesByType.sources),
        exists: nodesByType.sources.length > 0
      },
      enrichers: { 
        ...getNodeGroupCenter(nodesByType.enrichers),
        exists: nodesByType.enrichers.length > 0
      },
      generators: { 
        ...getNodeGroupCenter(nodesByType.generators),
        exists: nodesByType.generators.length > 0
      }
    };
    
    // Calculate which connections to draw
    const flowConnections = [];
    
    // Sources → Enrichers connection
    if (groupCenters.sources.exists && groupCenters.enrichers.exists) {
      flowConnections.push({
        from: groupCenters.sources,
        to: groupCenters.enrichers
      });
    }
    
    // Enrichers → Generators connection
    if (groupCenters.enrichers.exists && groupCenters.generators.exists) {
      flowConnections.push({
        from: groupCenters.enrichers,
        to: groupCenters.generators
      });
    }
    
    // Direct Sources → Generators connection (if no enrichers)
    if (!groupCenters.enrichers.exists && groupCenters.sources.exists && groupCenters.generators.exists) {
      flowConnections.push({
        from: groupCenters.sources,
        to: groupCenters.generators
      });
    }
    
    // Skip if no valid connections
    if (flowConnections.length === 0) return;
    
    // Save context before making changes
    ctx.save();
    
    // Draw the pipeline flow connections with simple dashed lines
    flowConnections.forEach(connection => {
      const { from, to } = connection;
      
      // Set up simple line style
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)'; // Gold with moderate opacity
      ctx.lineWidth = 10; // Medium thickness
      ctx.setLineDash([25, 20]); // Clear dashed pattern
      ctx.lineCap = 'round'; // Rounded ends of dashes
      
      // Add a subtle glow
      ctx.shadowColor = 'rgba(255, 165, 0, 0.3)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      // Draw the simple flow line
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    });
    
    // Restore the original context
    ctx.restore();
  }, [nodes, showPipelineFlow]);

  // Store the pipeline flow function in the ref to break circular dependency
  useEffect(() => {
    pipelineFlowFnRef.current = drawPipelineFlow;
  }, [drawPipelineFlow]);

  // Improved drawing to implement double buffering
  const drawToBackBuffer = useCallback(() => {
    if (!backBufferRef.current || !canvasRef.current) return;
    
    // Set back buffer size
    backBufferRef.current.width = canvasRef.current.width;
    backBufferRef.current.height = canvasRef.current.height;
    
    const ctx = backBufferRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear the back buffer with a dark background
    ctx.fillStyle = '#121212'; // Very dark background
    ctx.fillRect(0, 0, backBufferRef.current.width, backBufferRef.current.height);
    
    // Save canvas state for transformations
    ctx.save();
    
    // Apply zoom and pan
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    
    // Draw grid
    drawGrid(ctx, backBufferRef.current.width, backBufferRef.current.height, scale, offset);
    
    // Sync node ports with parameters to ensure we're not showing invalid connections
    const syncedNodes = syncNodePortsWithParams(nodes);

    // Draw the default pipeline flow in the background using the function from ref
    if (pipelineFlowFnRef.current) {
      pipelineFlowFnRef.current(ctx);
    }
    
    // Show help message if graph is empty
    if (syncedNodes.length === 0 && !draggedPlugin) {
      // Reset transformations to draw in screen coordinates
      ctx.restore();
      ctx.save();
      
      // Draw empty state message
      const centerX = backBufferRef.current.width / 2;
      const centerY = backBufferRef.current.height / 2;
      
      ctx.font = '18px Arial';
      ctx.fillStyle = `rgba(251, 191, 36, ${emptyStateOpacityRef.current})`; // Brighter yellow amber color
      ctx.textAlign = 'center';
      
      ctx.fillText('Drag plugins from the sidebar to build your graph', centerX, centerY);
      
      // Restore transformations for further drawing
      ctx.restore();
      ctx.save();
      
      // Re-apply zoom and pan for subsequent drawing
      ctx.translate(offset.x, offset.y);
      ctx.scale(scale, scale);
    }
    
    // Draw connections
    if (connections.length > 0) {
      connections.forEach(connection => {
        const fromNode = findNodeRecursive(syncedNodes, connection.from.nodeId);
        const toNode = findNodeRecursive(syncedNodes, connection.to.nodeId);
        
        if (fromNode && toNode) {
          try {
            drawConnection(ctx, fromNode, toNode, connection);
          } catch (error) {
            console.error("Error drawing connection:", error, connection);
          }
        }
      });
    }
    
    // Draw nodes
    if (syncedNodes.length > 0) {
      syncedNodes.forEach(node => {
        drawNode(ctx, node, scale, hoveredPort, selectedNode);
      });
    }
    
    // Draw dragged plugin ghost/preview
    if (draggedPlugin && dragPosition) {
      // Create a simple temporary node object for the dragged plugin
      const tempNode: Node = {
        id: 'temp-dragged-node',
        name: draggedPlugin.name,
        type: draggedPlugin.type,
        position: { x: dragPosition.x, y: dragPosition.y },
        inputs: [],
        outputs: [],
        params: {}
      };
      
      // Draw a semi-transparent node to indicate it's being dragged
      ctx.globalAlpha = 0.7;
      drawNode(ctx, tempNode, scale, null, null);
      ctx.globalAlpha = 1.0;
    }
    
    // Draw connection line if currently connecting
    if (connectingFrom && mousePosition) {
      const fromNode = findNodeRecursive(syncedNodes, connectingFrom.nodeId);
      if (fromNode) {
        const fromPort = connectingFrom.isOutput ? 
          fromNode.outputs.find(o => o.name === connectingFrom.port) :
          fromNode.inputs.find(i => i.name === connectingFrom.port);

        if (fromPort) {
          const fromPortIndex = connectingFrom.isOutput ? 
            fromNode.outputs.indexOf(fromPort) :
            fromNode.inputs.indexOf(fromPort);

          const startX = connectingFrom.isOutput ? 
            fromNode.position.x + 200 :
            fromNode.position.x;
          const startY = fromNode.position.y + 25 + fromPortIndex * 20;

          drawConnectionLine(ctx, startX, startY, mousePosition.x, mousePosition.y, fromPort.type);
        }
      }
    }
    
    ctx.restore();
  }, [nodes, connections, selectedNode, scale, offset, hoveredPort, connectingFrom, mousePosition, draggedPlugin, dragPosition]);

  // Update the dependency array of drawToBackBuffer to fix the circular dependency
  useEffect(() => {
    // Skip redrawing during animation to prevent interference
    if (isAnimatingRef.current) {
      return;
    }
    
    // Cancel any existing animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    // Schedule a new frame to apply changes and force a complete redraw
    animationFrameRef.current = requestAnimationFrame(() => {
      drawToBackBuffer();
      drawToScreen();
    });
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [scale, offset, drawToBackBuffer, drawToScreen]);

  // Add a forceRedraw function using useCallback to clear and redraw the canvas
  const forceRedraw = useCallback(() => {
    if (isRedrawing || !canvasRef.current) return;
    
    setIsRedrawing(true);
    
    // Use our double buffer technique
    drawToBackBuffer();
    drawToScreen();
    
    setIsRedrawing(false);
  }, [drawToBackBuffer, drawToScreen, isRedrawing]);
  
  // Enhanced centering function with proper padding and smooth animation
  const centerView = useCallback(() => {
    console.log("Center view clicked");
    
    if (nodes.length === 0 || !canvasRef.current) {
      console.warn('Cannot center view: no nodes or canvas not available');
      return;
    }
    
    // Calculate the bounds of all nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    // Helper function to process each node
    const processNode = (node: Node) => {
      const nodeWidth = 200;
      const nodeHeight = node.isParent ? 
        (node.expanded ? (25 + node.inputs.length * 20) : 80) : 
        (25 + Math.max(node.inputs.length, node.outputs.length) * 20);
      
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + nodeWidth);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
      
      if (node.isParent && node.children && node.expanded) {
        node.children.forEach(processNode);
      }
    };
    
    nodes.forEach(processNode);
    
    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      console.warn('Invalid node bounds calculated');
      return;
    }
    
    // Add padding to the bounds
    const padding = 75;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;
    
    // Calculate the dimensions and center of the node bounds
    const nodeWidth = maxX - minX;
    const nodeHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Get canvas dimensions
    const canvasWidth = canvasRef.current.width;
    const canvasHeight = canvasRef.current.height;
    
    // Calculate scale to fit nodes in view with padding
    const scaleX = canvasWidth / nodeWidth;
    const scaleY = canvasHeight / nodeHeight;
    const targetScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, 0.1), 2.0);
    
    // Calculate target offset to center the nodes
    const targetOffset = {
      x: (canvasWidth / 2) - (centerX * targetScale),
      y: (canvasHeight / 2) - (centerY * targetScale)
    };
    
    // Cancel any existing animation
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Apply changes directly for the first click
    setScale(targetScale);
    setOffset(targetOffset);
    
    // Force immediate redraw
    requestAnimationFrame(() => {
      drawToBackBuffer();
      drawToScreen();
    });
  }, [nodes, canvasRef, drawToBackBuffer, drawToScreen]);

  // Subscribe to state changes from ConfigStateManager
  useEffect(() => {
    const unsubscribeNodes = configStateManager.subscribe('nodes-updated', (updatedNodes) => {
      console.log('🔄 NodeGraph: Received nodes-updated event, nodes count:', updatedNodes.length);
      
      // Schedule update instead of immediate state change
      scheduleUpdate(() => {
        setNodes(updatedNodes);
        
        // If nodes were removed and we had a selected node that no longer exists
        if (selectedNode && !findNodeRecursive(updatedNodes, selectedNode)) {
          // Clear the selection since that node is gone
          setSelectedNode(null);
        }
      });
    });
    
    const unsubscribeConnections = configStateManager.subscribe('connections-updated', (updatedConnections) => {
      console.log('🔄 NodeGraph: Received connections-updated event, connections count:', updatedConnections.length);
      
      // Schedule update instead of immediate state change
      scheduleUpdate(() => {
        setConnections(updatedConnections);
      });
    });
    
    const unsubscribeSelected = configStateManager.subscribe('node-selected', (nodeId) => {
      console.log('🔄 NodeGraph: Received node-selected event:', nodeId);
      
      scheduleUpdate(() => {
        setSelectedNode(nodeId);
      });
    });
    
    const unsubscribeConfig = configStateManager.subscribe('config-updated', (updatedConfig) => {
      console.log('🔄 NodeGraph: Received config-updated event');
      
      scheduleUpdate(() => {
        onConfigUpdate(updatedConfig);
      });
    });
    
    const unsubscribePluginUpdated = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
      console.log("🔌 NodeGraph: Received plugin-updated event:", updatedPlugin);
      
      // Force a redraw to ensure UI reflects the latest state
      scheduleUpdate(() => {
        // If this is a node removal event, we want to make sure our local state is up-to-date
        // The nodes-updated event should handle this, but we'll force a redraw anyway
        drawToBackBuffer();
        drawToScreen();
      });
    });
    
    return () => {
      unsubscribeNodes();
      unsubscribeConnections();
      unsubscribeSelected();
      unsubscribeConfig();
      unsubscribePluginUpdated();
    };
  }, [onConfigUpdate, scheduleUpdate, selectedNode, drawToBackBuffer, drawToScreen]);

  // Use a dedicated mouseWheel handler instead of the hook's
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const wheelListener = (e: WheelEvent) => {
        e.preventDefault();
        handleWheelZoom(e as unknown as React.WheelEvent<HTMLCanvasElement>);
      };
      
      // Add wheel event listener with passive: false to allow preventDefault
      canvas.addEventListener('wheel', wheelListener, { passive: false });
      
      // Clean up
      return () => {
        canvas.removeEventListener('wheel', wheelListener);
      };
    }
  }, [handleWheelZoom]);

  // Add keyboard shortcut listener for centering (spacebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Use Space key as a shortcut for centering the view
      if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        centerView();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [centerView]);

  // Update canvas size when container size changes
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasRef.current && containerRef.current) {
        const container = containerRef.current;
        
        // Update canvas dimensions to match container
        canvasRef.current.width = container.clientWidth;
        canvasRef.current.height = container.clientHeight;
        
        // Draw after resizing
        drawToBackBuffer();
        drawToScreen();
      }
    };

    // Run on the next tick to ensure the container has been rendered
    setTimeout(updateCanvasSize, 0);
    
    // Add resize observer for more reliable size detection
    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    // Also listen for window resize
    window.addEventListener('resize', updateCanvasSize);
    
    return () => {
      if (containerRef.current) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [drawToBackBuffer, drawToScreen]);

  // Handle double click on node to edit params
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    
    const canvasRect = canvasElement.getBoundingClientRect();
    const { x, y } = screenToCanvas(e.clientX, e.clientY, canvasRect);
    
    // Check if clicking on a node
    const clickedNode = findNodeAtCoordinates(x, y, nodes);
    if (clickedNode) {
      // For parent nodes without params, don't open the dialog
      if (clickedNode.isParent && (!clickedNode.params || Object.keys(clickedNode.params).length === 0)) {
        return;
      }
      
      // Get the actual node, which might be a child of a parent
      let actualNode = clickedNode;
      let parentNode: Node | null = null;
      let isChild = false;
      
      // Check if this is directly a child node
      if (!clickedNode.isParent) {
        // It might be a child node of a parent, check all parents
        for (const node of nodes) {
          if (node.isParent && node.children) {
            const foundChild = node.children.find(child => child.id === clickedNode.id);
            if (foundChild) {
              actualNode = foundChild;
              parentNode = node;
              isChild = true;
              break;
            }
          }
        }
      }
      
      // Get node type and index for setting up the plugin dialog
      const nodeParts = actualNode.id.split('-');
      const nodeType = nodeParts[0];
      const nodeIndex = parseInt(nodeParts[1]);
      
      // Force a synchronization before opening the dialog
      configStateManager.forceSync();
      
      // Wait longer to ensure sync has completed
      setTimeout(() => {
        // Ensure we get the most up-to-date state for the node
        const latestNode = configStateManager.findNodeById(actualNode.id);
        let nodeParams = {};
        
        if (latestNode && latestNode.params) {
          console.log('🔍 Using latest node state from ConfigStateManager for dialog');
          nodeParams = { ...latestNode.params }; // Make a deep copy to avoid reference issues
        } else {
          console.log('🔍 Using state from node object for dialog');
          nodeParams = { ...(actualNode.params || {}) }; // Make a deep copy
        }
        
        // Create plugin info structure based on node type
        let plugin: any = {
          name: latestNode?.name || actualNode.name,
          params: nodeParams,
          id: actualNode.id,
          isChild: isChild,
          parentId: parentNode?.id
        };
        
        // Map node type to plugin type (handle both singular and plural forms)
        switch (nodeType) {
          case 'source':
          case 'sources':
            plugin.type = 'source';
            break;
          case 'enricher':
          case 'enrichers':
            plugin.type = 'enricher';
            break;
          case 'generator':
          case 'generators':
            plugin.type = 'generator';
            break;
          case 'ai':
            plugin.type = 'ai';
            break;
          case 'storage':
            plugin.type = 'storage';
            break;
          default:
            plugin.type = nodeType;
        }
        
        // Get plugin schema from the registry based on the node's plugin name and type
        const pluginSchema = pluginRegistry.findPlugin(plugin.name, plugin.type);
        if (pluginSchema) {
          console.log('Found plugin schema from registry:', pluginSchema);
          // Add schema information to the plugin
          plugin.constructorInterface = pluginSchema.constructorInterface;
          plugin.configSchema = pluginSchema.configSchema;
          plugin.description = pluginSchema.description;
        } else {
          console.log('Plugin schema not found in registry for:', plugin.name, plugin.type);
        }
        
        console.log('Opening plugin dialog for:', plugin);
        
        // Open dialog to edit params
        setSelectedPlugin(plugin);
        setShowPluginDialog(true);
      }, 200); // Increase timeout to ensure sync is complete
    }
  };

  // Update handleMouseDown to handle clicks on the delete button:

  // Update handleMouseDown to handle single vs double clicks
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    
    const now = Date.now();
    const timeDiff = now - lastClickTimeRef.current;
    
    // Check if this is a double-click (less than 300ms between clicks)
    if (timeDiff < 300) {
      handleDoubleClick(e);
      lastClickTimeRef.current = 0; // Reset timer after double click
      return;
    }
    
    // Update last click time
    lastClickTimeRef.current = now;
    
    const canvasRect = canvasElement.getBoundingClientRect();
    const { x, y } = screenToCanvas(e.clientX, e.clientY, canvasRect);
    
    // Check if clicking on a port
    const portInfo = findPortAtCoordinates(x, y, nodes);
    
    if (portInfo) {
      // Starting a connection from an output port
      if (portInfo.isOutput) {
        setConnectingFrom({
          nodeId: portInfo.nodeId,
          port: portInfo.port,
          portType: portInfo.portType,
          isOutput: true
        });
      }
      // Clicking on an input port - check if it has a connection to remove
      else {
        const node = findNodeRecursive(nodes, portInfo.nodeId);
        if (node) {
          const input = node.inputs.find(i => i.name === portInfo.port);
          
          if (input && input.connectedTo) {
            // Find the connection to remove
            const connectionToRemove = connections.find(conn => 
              conn.to.nodeId === portInfo.nodeId && conn.to.input === portInfo.port
            );
            
            if (connectionToRemove) {
              // Instead of updating state directly, let ConfigStateManager handle the updates
              const result = removeNodeConnection(nodes, connectionToRemove);
              if (result) {
                const [updatedNodes, updatedConnections] = result;
                
                // Update the state through the ConfigStateManager
                // This will trigger the appropriate events
                configStateManager.setNodes(updatedNodes);
                configStateManager.setConnections(updatedConnections);
              }
            }
          }
        }
      }
      return;
    }

    // Check if clicking on a collapse button
    for (const node of nodes) {
      if (node.isParent && isPointInCollapseButton(x, y, node)) {
        // Toggle the expanded state through ConfigStateManager
        const updatedNodes = nodes.map(n => {
          if (n.id === node.id) {
            return { ...n, expanded: !n.expanded };
          }
          return n;
        });
        
        // Update via state manager, don't set state directly
        configStateManager.setNodes(updatedNodes);
        return;
      }
    }

    // Check if clicking on a node
    const clickedNode = findNodeAtCoordinates(x, y, nodes);
    if (clickedNode) {
      configStateManager.setSelectedNode(clickedNode.id);
      setIsDragging(true);
      // Store the mouse position in canvas coordinates
      setDragStart({ x, y });
      return;
    }

    // Otherwise, start panning
    handlePanStart(e);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (connectingFrom) {
      const canvasElement = canvasRef.current;
      if (!canvasElement) return;
      
      const canvasRect = canvasElement.getBoundingClientRect();
      const { x, y } = screenToCanvas(e.clientX, e.clientY, canvasRect);
      
      // Find if we're dropping on a valid port
      const targetPortInfo = findPortAtCoordinates(x, y, nodes);
      
      if (targetPortInfo && !targetPortInfo.isOutput) {
        // Make sure we're not trying to connect a node to itself
        if (connectingFrom.nodeId !== targetPortInfo.nodeId) {
          try {
            // Create a connection object
            const newConnection: Connection = {
              from: { nodeId: connectingFrom.nodeId, output: connectingFrom.port },
              to: { nodeId: targetPortInfo.nodeId, input: targetPortInfo.port }
            };
            
            // Start drawing to back buffer before making any state changes
            // This ensures we have a stable visual during the update
            drawToBackBuffer();
            
            // Use the handleNodeConnection function that properly handles child nodes
            const result = handleNodeConnection(
              nodes,
              newConnection,
              config,
              onConfigUpdate
            );
            
            if (result) {
              const [newNodes, newConnections, newConfig] = result;
              
              // Update state in batch to prevent multiple renders
              if (newConfig) {
                configStateManager.updateConfig(newConfig);
              } else {
                // Just update nodes and connections if no config update
                configStateManager.setNodes(newNodes);
                configStateManager.setConnections(newConnections);
              }
              
              // Draw the result immediately to back buffer
              setNodes(newNodes);
              setConnections(newConnections);
              drawToBackBuffer();
              drawToScreen();
              
              // Then sync without saving to server
              setTimeout(() => {
                configStateManager.forceSync();
                
                // Update the parent component with the latest config
                onConfigUpdate(configStateManager.getConfig());
              }, 100);
            }
          } catch (error) {
            console.error("Error creating connection:", error);
          }
        }
      }

      setConnectingFrom(null);
      setMousePosition(null);
    }

    handlePanEnd();
    setIsDragging(false);
    configStateManager.setSelectedNode(null);
  };

  // Handle adding/editing a plugin
  const handleAddPlugin = async (updatedPlugin: any) => {
    // Update with the modified plugin
    console.log("Adding/Updating plugin:", updatedPlugin);
    
    // Check if this is a new plugin (no ID) - typically from drag and drop
    if (!updatedPlugin.id) {
      // Generate an ID based on plugin type
      let pluginType = updatedPlugin.type;
      let targetArray: keyof Config;
      
      // Map the plugin type to the appropriate config array
      switch (pluginType) {
        case 'source':
          pluginType = 'source';
          targetArray = 'sources';
          break;
        case 'enricher':
          pluginType = 'enricher';
          targetArray = 'enrichers';
          break;
        case 'generator':
          pluginType = 'generator';
          targetArray = 'generators';
          break;
        case 'ai':
          pluginType = 'ai';
          targetArray = 'ai';
          break;
        case 'storage':
          pluginType = 'storage';
          targetArray = 'storage';
          break;
        default:
          pluginType = updatedPlugin.type;
          // Default to a known config key
          targetArray = 'sources';
      }
      
      // Get updated config to add the new plugin
      const currentConfig = configStateManager.getConfig();
      
      // If we're working with an empty config, make sure it has a temporary name
      if (!currentConfig.name) {
        currentConfig.name = 'new-config';
      }
      
      // Ensure the target array exists in the config
      if (!Array.isArray(currentConfig[targetArray])) {
        currentConfig[targetArray] = [];
      }
      
      // Generate index based on current array length
      const index = currentConfig[targetArray].length;
      
      // Generate ID for the new plugin
      updatedPlugin.id = `${pluginType}-${index}`;
      
      // Include position data from the drop location
      const pluginConfig = {
        name: updatedPlugin.name,
        type: pluginType,
        params: updatedPlugin.params || {},
        position: updatedPlugin.position || { x: 300, y: 300 },
      };
      
      // Add the new plugin to the config
      currentConfig[targetArray].push(pluginConfig as any);
      
      // Update the config
      configStateManager.updateConfig(currentConfig);
      
      // Force a sync to rebuild nodes from the config
      configStateManager.forceSync();
      
      console.log(`Added new plugin "${updatedPlugin.name}" to ${targetArray}`, pluginConfig);
      
      // Update local state directly for new plugins
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      
      // Update parent component's config
      onConfigUpdate(configStateManager.getConfig());
    }
    else {
      // For existing plugins, use updatePlugin
      // Try to update the plugin in the config state manager
      const updated = configStateManager.updatePlugin(updatedPlugin);
      
      if (!updated) {
        console.error("Failed to update plugin in state manager");
        return;
      }
      
      console.log("Plugin updated successfully in state manager");
      
      // Update local state
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      
      // Update parent component's config
      onConfigUpdate(configStateManager.getConfig());
    }
    
    // Close the plugin dialog
    setShowPluginDialog(false);
    setSelectedPlugin(null);
    
    // Ensure the changes are immediately visible
    drawToBackBuffer();
    drawToScreen();
  };

  // Handle config save
  const handleConfigSave = (name: string) => {
    const updatedConfig = { ...config, name };
    configStateManager.updateConfig(updatedConfig);
    setShowConfigDialog(false);
  };

  // Handle saving config to server
  const handleSaveToServer = async () => {
    try {
      // Make sure everything is in sync before saving
      configStateManager.forceSync();
      
      // Get the current config from ConfigStateManager
      const currentConfig = configStateManager.getConfig();
      
      // If the config doesn't have a name or has the default empty name, prompt for a name
      let configName = currentConfig.name;
      if (!configName || configName === 'new-config') {
        const userProvidedName = prompt('Please enter a name for this configuration', 'my-configuration');
        // If user cancels the prompt, abort saving
        if (!userProvidedName) {
          return;
        }
        configName = userProvidedName;
        
        // Update the config with the new name
        currentConfig.name = configName;
        configStateManager.updateConfig(currentConfig);
      }
      
      // Call the state manager's saveToServer method
      const success = await configStateManager.saveToServer();
      
      if (success) {
        // Show success message
        alert(`Configuration ${configName} saved successfully`);
        
        // Notify parent about the config update
        onConfigUpdate(currentConfig);
      } else {
        throw new Error('Save operation failed');
      }
    } catch (error) {
      console.error('Error saving config to server:', error);
      alert('Failed to save configuration. Please try again.');
    }
  };

  // Handle plugin drag from palette
  const handleDragPlugin = (plugin: PluginInfo, clientX: number, clientY: number) => {
    setDraggedPlugin(plugin);
    
    // Convert client coordinates to canvas coordinates
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (clientX - rect.left - offset.x) / scale;
      const y = (clientY - rect.top - offset.y) / scale;
      setDragPosition({ x, y });
    }
  };
  
  // Handle drop of a plugin from palette
  const handleDropPlugin = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    if (!draggedPlugin) return;
    
    // Get drop position in canvas coordinates
    const rect = canvasRef.current!.getBoundingClientRect();
    const dropX = (e.clientX - rect.left - offset.x) / scale;
    const dropY = (e.clientY - rect.top - offset.y) / scale;
    
    // Create new plugin instance with the full schema from the draggedPlugin
    const newPlugin = {
      type: draggedPlugin.type,
      name: draggedPlugin.name,
      params: {},
      position: { x: dropX, y: dropY },
      // Include constructor interface and config schema from the original plugin definition
      constructorInterface: draggedPlugin.constructorInterface,
      configSchema: draggedPlugin.configSchema,
      description: draggedPlugin.description
    };
    
    console.log('Creating new plugin from drag and drop:', newPlugin);
    
    // Set as selected plugin
    setSelectedPlugin(newPlugin);
    
    // Show plugin dialog for configuration
    setShowPluginDialog(true);
    
    // Clear drag state
    setDraggedPlugin(null);
    setDragPosition(null);
  };
  
  // Allow dropping on canvas
  const handleDragOver = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    // Update drag position for visual feedback
    if (draggedPlugin && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - offset.x) / scale;
      const y = (e.clientY - rect.top - offset.y) / scale;
      setDragPosition({ x, y });
    }
  };
  
  // Handle drag leaving canvas
  const handleDragLeave = () => {
    // Clear drag position but keep dragged plugin
    setDragPosition(null);
  };
  
  // Toggle palette visibility with animation
  const togglePalette = () => {
    if (paletteAnimation === 'idle') {
      if (paletteVisible) {
        // Start closing animation
        setPaletteAnimation('closing');
        setShowPalette(false);
        // After animation completes, hide palette completely
        setTimeout(() => {
          setPaletteVisible(false);
          setPaletteAnimation('idle');
        }, 300); // Match animation duration
      } else {
        // Make palette visible but start with animation
        setPaletteVisible(true);
        setShowPalette(true);
        setPaletteAnimation('opening');
        // After animation completes, set to idle
        setTimeout(() => {
          setPaletteAnimation('idle');
        }, 300); // Match animation duration
      }
    }
  };

  // Add animation effect for empty state
  useEffect(() => {
    // Only animate when graph is empty and not dragging
    if (nodes.length === 0 && !draggedPlugin) {
      let animationFrameId: number | null = null;
      
      const animateEmptyState = () => {
        // Update opacity value for pulsing effect
        if (emptyStateIncreasingRef.current) {
          emptyStateOpacityRef.current += 0.005;
          if (emptyStateOpacityRef.current >= 0.95) {
            emptyStateIncreasingRef.current = false;
          }
        } else {
          emptyStateOpacityRef.current -= 0.005;
          if (emptyStateOpacityRef.current <= 0.6) {
            emptyStateIncreasingRef.current = true;
          }
        }
        
        // Redraw with updated opacity
        drawToBackBuffer();
        drawToScreen();
        
        // Continue animation
        animationFrameId = requestAnimationFrame(animateEmptyState);
      };
      
      // Start animation
      animationFrameId = requestAnimationFrame(animateEmptyState);
      emptyStateAnimationRef.current = animationFrameId;
      
      // Clean up animation on unmount or when nodes are added
      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }
  }, [nodes.length, draggedPlugin, drawToBackBuffer, drawToScreen]);

  // Add a button to toggle pipeline flow visibility
  const togglePipelineFlow = useCallback(() => {
    setShowPipelineFlow(prev => !prev);
  }, []);

  // Add useEffect to keep the plugin dialog in sync with node updates
  useEffect(() => {
    // Only subscribe if we have a plugin dialog open
    if (showPluginDialog && selectedPlugin && selectedPlugin.id) {
      const unsubscribeNodeUpdates = configStateManager.subscribe('nodes-updated', (updatedNodes) => {
        // If we have a selected plugin, check if its node was updated
        const updatedNode = findNodeRecursive(updatedNodes, selectedPlugin.id);
        if (updatedNode) {
          // Only update if params have actually changed to prevent unnecessary rerenders
          const currentParamsJson = JSON.stringify(selectedPlugin.params || {});
          const newParamsJson = JSON.stringify(updatedNode.params || {});
          
          if (currentParamsJson !== newParamsJson) {
            // Update the selectedPlugin with the latest params to ensure dialog stays in sync
            setSelectedPlugin((prevPlugin: any) => {
              if (prevPlugin && prevPlugin.id === updatedNode.id) {
                // Create a deep copy for the new plugin
                return { 
                  ...prevPlugin,
                  params: JSON.parse(JSON.stringify(updatedNode.params || {}))
                };
              }
              return prevPlugin;
            });
          }
        } else {
          // If the node was removed, close the dialog
          setShowPluginDialog(false);
        }
      });
      
      const unsubscribePluginUpdates = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
        // If this is our selected plugin, update the dialog
        if (selectedPlugin.id === updatedPlugin.id) {
          // Only update if params have actually changed
          const currentParamsJson = JSON.stringify(selectedPlugin.params || {});
          const newParamsJson = JSON.stringify(updatedPlugin.params || {});
          
          if (currentParamsJson !== newParamsJson) {
            // Update the selected plugin with the latest params
            setSelectedPlugin((prevPlugin: any) => {
              if (prevPlugin && prevPlugin.id === updatedPlugin.id) {
                return { 
                  ...prevPlugin,
                  params: JSON.parse(JSON.stringify(updatedPlugin.params || {}))
                };
              }
              return prevPlugin;
            });
          }
        }
      });
      
      return () => {
        unsubscribeNodeUpdates();
        unsubscribePluginUpdates();
      };
    }
    
    return () => {};
  }, [showPluginDialog, selectedPlugin]);

  return (
    <div className="w-full h-full flex relative">
      <div 
        className={`${paletteVisible ? 'block' : 'hidden'} absolute top-0 left-0 bottom-0 z-10 transition-all duration-300 ease-in-out ${
          paletteAnimation === 'opening' ? 'animate-slide-in-left' : 
          paletteAnimation === 'closing' ? 'animate-slide-out-left' : ''
        }`}
        style={{
          width: '20rem', // 320px same as w-80
          transform: paletteAnimation === 'closing' ? 'translateX(-100%)' : 
                     paletteAnimation === 'opening' ? 'translateX(0)' : '',
          transition: 'transform 300ms ease-in-out',
          boxShadow: '5px 0 15px rgba(0, 0, 0, 0.5)'
        }}
      >
        <PluginPalette onDragPlugin={handleDragPlugin} />
      </div>
      
      <div 
        className="flex-1 flex flex-col relative transition-all duration-300 ease-in-out"
        style={{
          marginLeft: paletteVisible && paletteAnimation !== 'closing' ? '20rem' : '0'
        }}
      >
        <div className="absolute top-4 left-4 z-10 flex space-x-2">
          <button
            onClick={togglePalette}
            className="w-10 h-10 bg-stone-700 text-amber-300 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30 transition-colors duration-300"
            title={paletteVisible ? "Hide plugin palette" : "Show plugin palette"}
            disabled={paletteAnimation !== 'idle'}
          >
            {paletteVisible ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 4 16 16" stroke="currentColor" className="transition-transform duration-300">
                <rect x="3" y="4" width="2" height="16" rx="1" fill="currentColor" />
                <polyline points="14,8 10,12 14,16" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 4 16 16" stroke="currentColor" className="transition-transform duration-300">
                <rect x="3" y="4" width="2" height="16" rx="1" fill="currentColor" />
                <polyline points="10,8 14,12 10,16" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </button>
          
          <button
            onClick={centerView}
            className="w-10 h-10 bg-stone-700 text-amber-300 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30"
            title="Center view"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <line x1="12" y1="3" x2="12" y2="6" stroke="currentColor" strokeWidth="2" />
              <line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
              <line x1="3" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="2" />
              <line x1="18" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </button>
          
          <button
            onClick={togglePipelineFlow}
            className={`w-10 h-10 ${showPipelineFlow ? 'bg-stone-700' : 'bg-stone-800'} text-amber-300 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30`}
            title={showPipelineFlow ? "Hide pipeline flow" : "Show pipeline flow"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </button>
          
          <button
            onClick={() => setShowConfigDialog(true)}
            className="w-10 h-10 bg-stone-700 text-amber-300 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30"
            title="Configure node graph"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
            </svg>
          </button>
          
          <button
            onClick={handleSaveToServer}
            className="w-10 h-10 bg-amber-500 text-gray-900 rounded hover:bg-amber-400 focus:outline-none flex items-center justify-center shadow-md"
            title="Save configuration to server"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H2z"/>
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDragOver={handleDragOver}
            onDrop={handleDropPlugin}
            onDragLeave={handleDragLeave}
          ></canvas>
        </div>
      </div>
      
      {showPluginDialog && selectedPlugin && (
        <PluginParamDialog
          plugin={selectedPlugin}
          isOpen={showPluginDialog}
          onClose={() => setShowPluginDialog(false)}
          onAdd={handleAddPlugin}
        />
      )}
      
      {showConfigDialog && (
        <ConfigDialog
          config={config}
          onClose={() => setShowConfigDialog(false)}
          onSave={handleConfigSave}
        />
      )}
    </div>
  );
};
