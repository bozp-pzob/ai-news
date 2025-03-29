import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Config } from '../types';
import { PluginParamDialog } from './PluginParamDialog';
import { ConfigDialog } from './ConfigDialog';
import { drawConnection, drawConnectionLine, drawNode, drawGrid } from '../utils/nodeRenderer';
import { findPortAtCoordinates, isPointInNode, removeNodeConnection, handleNodeConnection, findNodeAtCoordinates, findNodeRecursive, isPointInCollapseButton, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';
import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { configStateManager } from '../services/ConfigStateManager';
import { animateCenterView } from '../utils/animation/centerViewAnimation';

interface NodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config) => void;
}

export const NodeGraph: React.FC<NodeGraphProps> = ({ config, onConfigUpdate }) => {
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

  // Initialize ConfigStateManager with the current config
  useEffect(() => {
    console.log("🔄 NodeGraph: initializing with config", config);
    
    // First check if config is valid before trying to load it
    if (!config || !config.name) {
      console.log("🔄 NodeGraph: invalid config, skipping initialization");
      return;
    }
    
    try {
      // Load the config into the state manager
      configStateManager.loadConfig(config);
      
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
              const padding = 200;
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
              
              // Apply changes directly
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
        }, 500); // Give canvas time to initialize
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
    const padding = 200; // Padding around nodes to prevent them from being right at the edge
    
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
      
      // Update our local state first for immediate visual feedback
      setNodes(updatedNodes);
      
      // Use a faster rendering approach - skip backbuffer for drag operations
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          // Clear canvas and draw directly
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          // Save canvas state
          ctx.save();
          
          // Apply zoom and pan
          ctx.translate(offset.x, offset.y);
          ctx.scale(scale, scale);
          
          // Draw grid, connections, and nodes
          drawGrid(ctx, canvasRef.current.width, canvasRef.current.height, scale, offset);
          
          // Sync node ports with parameters to ensure we're not showing invalid connections
          const syncedNodes = syncNodePortsWithParams(updatedNodes);
          
          // Draw connections
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
          
          // Draw nodes
          syncedNodes.forEach(node => {
            drawNode(ctx, node, scale, hoveredPort, selectedNode);
          });
          
          ctx.restore();
        }
      } else {
        // Fallback to double buffering if direct rendering fails
        drawToBackBuffer();
        drawToScreen();
      }
      
      // Debounce updates to the config state manager
      if (!isUpdateScheduledRef.current) {
        isUpdateScheduledRef.current = true;
        
        // Use requestAnimationFrame to throttle updates
        requestAnimationFrame(() => {
          // Update the nodes state through the state manager
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

  // Improved drawing to implement double buffering
  const drawToBackBuffer = useCallback(() => {
    if (!backBufferRef.current || !canvasRef.current) return;
    
    // Set back buffer size
    backBufferRef.current.width = canvasRef.current.width;
    backBufferRef.current.height = canvasRef.current.height;
    
    const ctx = backBufferRef.current.getContext('2d');
    if (!ctx) return;
    
    // Clear the back buffer
    ctx.clearRect(0, 0, backBufferRef.current.width, backBufferRef.current.height);
    
    // Save canvas state for transformations
    ctx.save();
    
    // Apply zoom and pan
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    
    // Draw grid
    drawGrid(ctx, backBufferRef.current.width, backBufferRef.current.height, scale, offset);
    
    // Sync node ports with parameters to ensure we're not showing invalid connections
    const syncedNodes = syncNodePortsWithParams(nodes);
    
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
  }, [nodes, connections, selectedNode, scale, offset, hoveredPort, connectingFrom, mousePosition]);

  // Draw back buffer to the screen
  const drawToScreen = useCallback(() => {
    if (!canvasRef.current || !backBufferRef.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    // Draw the back buffer to the canvas in one operation to prevent flickering
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    ctx.drawImage(backBufferRef.current, 0, 0);
  }, []);

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
      // Schedule update instead of immediate state change
      scheduleUpdate(() => {
        setNodes(updatedNodes);
      });
    });
    
    const unsubscribeConnections = configStateManager.subscribe('connections-updated', (updatedConnections) => {
      // Schedule update instead of immediate state change
      scheduleUpdate(() => {
        setConnections(updatedConnections);
      });
    });
    
    const unsubscribeSelected = configStateManager.subscribe('node-selected', (nodeId) => {
      scheduleUpdate(() => {
        setSelectedNode(nodeId);
      });
    });
    
    const unsubscribeConfig = configStateManager.subscribe('config-updated', (updatedConfig) => {
      scheduleUpdate(() => {
        onConfigUpdate(updatedConfig);
      });
    });
    
    const unsubscribePluginUpdated = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
      console.log("🔌 Plugin updated in NodeGraph:", updatedPlugin);
      // Schedule redraw to show any visual changes
      scheduleUpdate(() => {
        // No direct state change needed, just redraw
      });
    });
    
    return () => {
      unsubscribeNodes();
      unsubscribeConnections();
      unsubscribeSelected();
      unsubscribeConfig();
      unsubscribePluginUpdated();
    };
  }, [onConfigUpdate, scheduleUpdate]);

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

  // Add a specific effect to handle scale and offset changes
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
        
        console.log('Opening plugin dialog for:', plugin);
        
        // Open dialog to edit params
        setSelectedPlugin(plugin);
        setShowPluginDialog(true);
      }, 200); // Increase timeout to ensure sync is complete
    }
  };

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
              // Start drawing to back buffer before making any state changes
              // This ensures we have a stable visual during the update
              drawToBackBuffer();
              
              // Remove the connection
              const result = removeNodeConnection(nodes, connectionToRemove);
              if (result) {
                const [updatedNodes, updatedConnections] = result;
                
                // First update our local state for immediate visual feedback
                setNodes(updatedNodes);
                setConnections(updatedConnections);
                
                // Redraw immediately to back buffer
                drawToBackBuffer();
                drawToScreen();
                
                // Then update the state via the state manager
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
        // Start drawing to back buffer before making any state changes
        drawToBackBuffer();
        
        // Toggle the expanded state
        const updatedNodes = nodes.map(n => {
          if (n.id === node.id) {
            return { ...n, expanded: !n.expanded };
          }
          return n;
        });
        
        // Update local state first for immediate feedback
        setNodes(updatedNodes);
        
        // Redraw immediately
        drawToBackBuffer();
        drawToScreen();
        
        // Then update via state manager
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
              
              // Then sync with server without disturbing the UI
              setTimeout(() => {
                configStateManager.forceSync();
                
                try {
                  const configName = config.name || 'default';
                  const currentConfig = configStateManager.getConfig();
                  
                  // Import the API function and save
                  import('../services/api').then(({ saveConfig }) => {
                    saveConfig(configName, currentConfig)
                      .then(() => {
                        onConfigUpdate(currentConfig);
                      })
                      .catch(error => {
                        console.error('Error saving config after connection update:', error);
                      });
                  });
                } catch (error) {
                  console.error('Error in save after connection update:', error);
                }
              }, 100);
            }
          } catch (error) {
            console.error("Error creating connection:", error);
          }
        }
      }

      setConnectingFrom(null);
    }

    handlePanEnd();
    setIsDragging(false);
    configStateManager.setSelectedNode(null);
  };

  // Handle adding/editing a plugin
  const handleAddPlugin = async (updatedPlugin: any) => {
    console.log('🔥 NodeGraph: RECEIVED PLUGIN UPDATE:', JSON.stringify(updatedPlugin));
    
    // First force ConfigStateManager to sync before applying the update
    configStateManager.forceSync();
    
    // Small delay to ensure sync is complete
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Update the state via ConfigStateManager
    const result = configStateManager.updatePlugin(updatedPlugin);
    console.log('🔥 NodeGraph: Plugin update result:', result);
    
    // Force sync again to propagate the change to all components
    configStateManager.forceSync();
    
    // Force redraw to show the changes
    forceRedraw();
    
    // Close the dialog after a short delay to ensure state is updated
    setTimeout(() => {
      setShowPluginDialog(false);
      setSelectedPlugin(null);
      
      // After the dialog is closed, save the config to the server
      try {
        const configName = config.name || 'default';
        const currentConfig = configStateManager.getConfig();
        
        // Get the saveConfig API function
        import('../services/api').then(({ saveConfig }) => {
          saveConfig(configName, currentConfig)
            .then(() => {
              console.log(`Configuration ${configName} saved after plugin update`);
              // Update the parent component's config state
              onConfigUpdate(currentConfig);
              
              // Force one final sync to ensure all components have the latest state
              setTimeout(() => {
                configStateManager.forceSync();
              }, 100);
            })
            .catch(error => {
              console.error('Error saving config after plugin update:', error);
            });
        });
      } catch (error) {
        console.error('Error in save after plugin update:', error);
      }
    }, 200); // Increased delay to ensure sync has time to complete
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
      // Force sync to ensure ConfigStateManager has the most up-to-date state
      configStateManager.forceSync();
      
      // Small delay to ensure sync has completed
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Get the current config name from the existing config
      const configName = config.name || 'default';
      
      // Get the latest state from ConfigStateManager - single source of truth
      const currentConfig = configStateManager.getConfig();
      
      // Call the API to save the config to the server
      const { saveConfig } = await import('../services/api');
      await saveConfig(configName, currentConfig);
      
      // Show success message
      alert(`Configuration ${configName} saved successfully`);
      
      // Notify parent about the config update
      onConfigUpdate(currentConfig);
    } catch (error) {
      console.error('Error saving config to server:', error);
      alert('Failed to save configuration. Please try again.');
    }
  };

  // Subscribe to node updates for debugging
  useEffect(() => {
    // Subscribe to node updates for debugging
    const unsubscribeNodes = configStateManager.subscribe('nodes-updated', (updatedNodes) => {
      console.log('🔍 NodeGraph: Nodes updated notification received');
      
      // If we have a selected plugin, check if its node was updated
      if (selectedPlugin && selectedPlugin.id) {
        const updatedNode = findNodeRecursive(updatedNodes, selectedPlugin.id);
        if (updatedNode) {
          console.log('🔍 NodeGraph: Selected node has been updated:', updatedNode.params);
          
          // Only update if params have actually changed to prevent unnecessary rerenders
          const currentParamsJson = JSON.stringify(selectedPlugin.params || {});
          const newParamsJson = JSON.stringify(updatedNode.params || {});
          
          if (currentParamsJson !== newParamsJson) {
            // Update the selectedPlugin with the latest params to ensure dialog stays in sync
            setSelectedPlugin((prevPlugin: any) => {
              if (prevPlugin && prevPlugin.id === updatedNode.id) {
                // Create a deep copy for the new plugin
                const updatedSelectedPlugin = { 
                  ...prevPlugin,
                  params: JSON.parse(JSON.stringify(updatedNode.params || {}))
                };
                
                console.log('🔍 NodeGraph: Updated selected plugin:', updatedSelectedPlugin);
                return updatedSelectedPlugin;
              }
              return prevPlugin;
            });
          } else {
            console.log('🔍 NodeGraph: No params change detected, skipping update');
          }
        }
      }
    });
    
    // Subscribe to plugin updates for debugging
    const unsubscribePlugins = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
      console.log('🔍 NodeGraph: Plugin update notification received:', updatedPlugin.id);
      
      // If this is our selected plugin, log the update
      if (selectedPlugin && selectedPlugin.id === updatedPlugin.id) {
        console.log('🔍 NodeGraph: Our selected plugin was updated:', updatedPlugin.params);
        
        // Only update if params have actually changed to prevent unnecessary rerenders
        const currentParamsJson = JSON.stringify(selectedPlugin.params || {});
        const newParamsJson = JSON.stringify(updatedPlugin.params || {});
        
        if (currentParamsJson !== newParamsJson) {
          // Update the selected plugin with the latest params
          setSelectedPlugin((prevPlugin: any) => {
            if (prevPlugin && prevPlugin.id === updatedPlugin.id) {
              // Create a deep copy for the new plugin
              const updatedSelectedPlugin = { 
                ...prevPlugin,
                params: JSON.parse(JSON.stringify(updatedPlugin.params || {}))
              };
              
              console.log('🔍 NodeGraph: Updated selected plugin:', updatedSelectedPlugin);
              return updatedSelectedPlugin;
            }
            return prevPlugin;
          });
        } else {
          console.log('🔍 NodeGraph: No params change detected, skipping update');
        }
        
        // If the dialog is open, manually trigger a re-sync
        // But only do it if we actually updated the plugin params
        if (showPluginDialog && currentParamsJson !== newParamsJson) {
          console.log('🔍 NodeGraph: Dialog is open, forcing sync...');
          configStateManager.forceSync();
        }
      }
    });
    
    return () => {
      unsubscribeNodes();
      unsubscribePlugins();
    };
  }, [selectedPlugin, showPluginDialog]);

  return (
    <div className="flex flex-col h-full w-full">
      <div 
        ref={containerRef} 
        className="flex-1 relative w-full h-full" 
        style={{ minHeight: '500px', border: '1px solid #2d3748' }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ 
            width: '100%', 
            height: '100%', 
            background: '#1a202c',
            cursor: isPanning ? 'grabbing' : hoveredPort ? 'pointer' : 'default' 
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <div className="absolute top-2 right-2 flex space-x-2">
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 shadow-md"
            onClick={handleSaveToServer}
          >
            Save
          </button>
          <button
            className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 shadow-md"
            onClick={() => {
              drawToBackBuffer();
              drawToScreen();
            }}
          >
            Refresh
          </button>
          <button
            className="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 shadow-md"
            onClick={() => {
              // First, sync node ports with parameters to ensure ports exist
              const syncedNodes = syncNodePortsWithParams(nodes);
              
              // Now update any connections we have 
              const cleanedConnections = cleanupStaleConnections(syncedNodes, connections);
              
              // Now repair the connections to ensure they match between nodes
              const repairedConnections = [...cleanedConnections];
              
              // For each connection, make sure both sides of the connection are properly connected
              repairedConnections.forEach(connection => {
                // Find the source and target nodes
                const sourceNode = findNodeRecursive(syncedNodes, connection.from.nodeId);
                const targetNode = findNodeRecursive(syncedNodes, connection.to.nodeId);
                
                if (sourceNode && targetNode) {
                  // Fix the source output port
                  const sourceOutput = sourceNode.outputs.find(output => output.name === connection.from.output);
                  if (sourceOutput) {
                    sourceOutput.connectedTo = connection.to.nodeId;
                  }
                  
                  // Fix the target input port
                  const targetInput = targetNode.inputs.find(input => input.name === connection.to.input);
                  if (targetInput) {
                    targetInput.connectedTo = connection.from.nodeId;
                  }
                }
              });
              
              // Update state with the fixed nodes and connections
              setNodes(syncedNodes);
              setConnections(repairedConnections);
              
              // Update state via ConfigStateManager
              configStateManager.setNodes(syncedNodes);
              configStateManager.setConnections(repairedConnections);
              
              // Force synchronization of state
              configStateManager.forceSync();
              
              // Force redraw
              drawToBackBuffer();
              drawToScreen();
              
              // User feedback
              console.log('🔧 Fixed connections');
              alert('Connections have been repaired');
            }}
          >
            Fix Connections
          </button>
        </div>
        <div className="absolute bottom-4 right-4">
          <button
            className="w-12 h-12 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 flex items-center justify-center shadow-lg"
            onClick={centerView}
            title="Center Nodes (Spacebar)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
            </svg>
          </button>
        </div>
      </div>
      {showPluginDialog && selectedPlugin && (
        <PluginParamDialog
          plugin={selectedPlugin}
          isOpen={showPluginDialog}
          onClose={() => {
            setShowPluginDialog(false);
            setSelectedPlugin(null);
          }}
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
