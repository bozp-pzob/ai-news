import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Config, PluginInfo, JobStatus } from '../types';
import { PluginParamDialog } from './PluginParamDialog';
import { ConfigDialog } from './ConfigDialog';
import { PluginPalette } from './PluginPalette';
import { drawNode, drawGrid, drawConnection, drawConnectionLine } from '../utils/nodeRenderer';
import { findPortAtCoordinates, isPointInNode, removeNodeConnection, handleNodeConnection, findNodeAtCoordinates, findNodeRecursive, isPointInCollapseButton, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';
import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { configStateManager } from '../services/ConfigStateManager';
import { pluginRegistry } from '../services/PluginRegistry';
import { animateCenterView } from '../utils/animation/centerViewAnimation';
import { ResetDialog } from './ResetDialog';
import { getConfig } from '../services/api';
import { websocketService } from '../services/websocket';
import { useWebSocket } from '../hooks/useWebSocket';
import { JobStatusDisplay } from './JobStatusDisplay';
import { useToast } from './ToastProvider';
import ReactDOM from 'react-dom';

// Add type constants to represent the pipeline flow steps
const PIPELINE_STEPS = ['sources', 'enrichers', 'generators'] as const;
type PipelineStep = typeof PIPELINE_STEPS[number];

// Add type for historical date settings
interface HistoricalDateSettings {
  enabled: boolean;
  mode?: "single" | "range";
  startDate?: string;
  endDate?: string;
}

interface NodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config, isReset?: boolean) => void;
  saveConfiguration?: () => Promise<boolean>;
  runAggregation?: () => Promise<void>;
}

export const NodeGraph: React.FC<NodeGraphProps> = ({ config, onConfigUpdate, saveConfiguration, runAggregation }) => {
  const { showToast } = useToast();
  
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
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  // Add state to track if the job status display was manually closed by the user
  const [jobStatusDisplayClosed, setJobStatusDisplayClosed] = useState(false);
  // Add isAggregationRunning state to the component
  const [isAggregationRunning, setIsAggregationRunning] = useState(false);
  // Before the [showPipelineFlow, setShowPipelineFlow] state declaration, add:
  const [isRunOnceJob, setIsRunOnceJob] = useState(false);
  // Add new state for toggles
  const [onlyFetch, setOnlyFetch] = useState(false);
  const [onlyGenerate, setOnlyGenerate] = useState(false);
  // Add state for run mode selection
  const [selectedRunMode, setSelectedRunMode] = useState<"once" | "continuous">("once");
  // Add state for run options dropdown
  const [showRunOptions, setShowRunOptions] = useState(false);
  const [showRunOptionsDropdown, setShowRunOptionsDropdown] = useState(false);
  // Add state to track settings button position
  const [settingsButtonPosition, setSettingsButtonPosition] = useState<{top: number; right: number; bottom: number; left: number} | null>(null);
  // Add state for historical date options
  const [useHistoricalDates, setUseHistoricalDates] = useState(false);
  const [dateRangeMode, setDateRangeMode] = useState<"single" | "range">("single");
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  // After the other useRef declarations, add:
  const jobTypesRef = useRef<Map<string, boolean>>(new Map()); // Maps jobId -> isRunOnce

  // Add resetInProgress ref
  const resetInProgress = useRef(false);
  
  // Add a ref to track the previous config name to prevent reloading the same config
  const prevConfigNameRef = useRef<string | null>(null);

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
  
  // Add reference to track the last time we drew the canvas
  const lastDrawTimeRef = useRef<number>(0);
  
  // Add lastClickTime for tracking double clicks
  const lastClickTimeRef = useRef<number>(0);

  // Add a useRef to track animation
  const emptyStateAnimationRef = useRef<number | null>(null);
  const emptyStateOpacityRef = useRef(0.8);
  const emptyStateIncreasingRef = useRef(true);
  
  // Create a ref to store the pipeline flow function to break circular dependency
  const pipelineFlowFnRef = useRef<(ctx: CanvasRenderingContext2D) => void>(() => {});
  
  // Add a cleanup function ref for job status websocket
  const jobStatusCleanupRef = useRef<(() => void) | null>(null);

  // Use WebSocket for status updates - pass null if config doesn't have a name
  const status = useWebSocket(config?.name || null);

  // Create a reusable function for processing job status updates
  const createJobStatusHandler = useCallback((jobId: string) => (status: JobStatus) => {
    
    // Check if this is a stale update by comparing timestamps with current job status
    if (jobStatus && jobStatus.jobId === status.jobId) {
      // If we have a newer update already, ignore this one
      if (jobStatus.startTime > status.startTime) {
        return;
      }
    }
    
    // Reset the jobStatusDisplayClosed when a new job status is received
    // This ensures that the display will show again for a new job
    if (!jobStatus || jobStatus.jobId !== status.jobId) {
      setJobStatusDisplayClosed(false);
    }
    
    // Get the job type from our map - default to current state if not found
    const isJobRunOnce = jobTypesRef.current.has(jobId) 
      ? jobTypesRef.current.get(jobId)
      : isRunOnceJob;
    
    // For continuous jobs, special handling
    if (status.status === 'running') {
      // For continuous jobs, we force undefined progress to show indeterminate progress
      if (!isJobRunOnce) {
        // Create a modified status without progress field for continuous jobs
        status = {
          ...status,
          progress: undefined // Force undefined progress for indeterminate display
        };
      } 
      // For run-once jobs, ensure we have progress if not provided
      else if (status.progress === undefined && status.aggregationStatus?.stats?.totalItemsFetched) {
        // Calculate progress estimate for run-once jobs
        const startTime = status.startTime || Date.now();
        const elapsed = Date.now() - startTime;
        const estimatedProgress = Math.min(Math.round((elapsed / 30000) * 100), 95);
        
        status = {
          ...status,
          progress: estimatedProgress
        };
      }
    }
    // For continuous jobs, prevent "completed" status
    else if (status.status === 'completed' && !isJobRunOnce) {
      // Override the status to keep it as "running"
      status = {
        ...status,
        status: 'running',
        progress: undefined
      };
    }
    
    // Update job status display
    setJobStatus(status);
    
    // Update aggregation running state based on job status
    if (status.status === 'failed') {
      setIsAggregationRunning(false);
    } else if (status.status === 'completed') {
      // For run-once jobs, mark as no longer running when completed
      if (isJobRunOnce) {
        setIsAggregationRunning(false);
        // Don't set jobStatus to null - let the component display the completed state
      } else {
        // For continuous jobs, keep running
        setIsAggregationRunning(true);
      }
    } else if (status.status === 'running') {
      setIsAggregationRunning(true);
    }
    
    // Keep the isRunOnceJob state in sync with the current job
    if (currentJobId === jobId) {
      setIsRunOnceJob(!!isJobRunOnce);
    }
  }, [isRunOnceJob, currentJobId, jobStatus]);

  // Effect to listen for job status updates
  useEffect(() => {
    // Create a function to handle any job status updates globally
    const globalJobStatusHandler = (status: JobStatus) => {
      
      // Compare the current job ID with the incoming status
      if (currentJobId && status.jobId === currentJobId) {
        // Use our shared processor function
        createJobStatusHandler(status.jobId)(status);
      }
    };
    
    // Register global listener (without specific job ID)
    websocketService.addJobStatusListener(globalJobStatusHandler);
    
    // Set up job started listener
    const handleJobStarted = (jobId: string) => {
      setCurrentJobId(jobId);
      
      // For newly started jobs, check if we have config.runOnce information to determine type
      // Default to the current state if we don't know
      const currentConfig = configStateManager.getConfig();
      if (currentConfig && typeof currentConfig.runOnce === 'boolean') {
        jobTypesRef.current.set(jobId, currentConfig.runOnce);
        
        // Also update current state if this is becoming the current job
        setIsRunOnceJob(currentConfig.runOnce);
      } else if (!jobTypesRef.current.has(jobId)) {
        // If we don't have the jobType set yet, use the current state as default
        jobTypesRef.current.set(jobId, isRunOnceJob);
      }
      
      // Connect to the job's WebSocket for status updates
      websocketService.connectToJob(jobId);
    };
    
    // Add job started listener
    websocketService.addJobStartedListener(handleJobStarted);
    
    // Clean up on unmount
    return () => {
      websocketService.removeJobStartedListener(handleJobStarted);
      websocketService.removeJobStatusListener(globalJobStatusHandler);
    };
  }, [currentJobId, isRunOnceJob, createJobStatusHandler]);

  // Load plugins when component mounts
  useEffect(() => {
    // Subscribe to plugin loading events
    const unsubscribe = pluginRegistry.subscribe(() => {
      setPluginsLoaded(true);
    });

    // Load plugins if not already loaded
    if (!pluginRegistry.isPluginsLoaded()) {
      pluginRegistry.loadPlugins()
        .then(() => {})
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
    // Check if we're reloading the same config (prevent infinite loops)
    if (config?.name && prevConfigNameRef.current === config.name) {
      return;
    }
    
    // Save the current config name for future comparisons
    if (config?.name) {
      prevConfigNameRef.current = config.name;
    }
    
    // Check if config is valid - if not, create an empty graph for drag and drop
    if (!config || !config.name) {
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
      
      // Schedule auto-centering after the canvas and nodes are ready
      const nodesLoaded = configStateManager.getNodes().length > 0;
      if (nodesLoaded) {
        // Use timeout to ensure the component is fully rendered
        setTimeout(() => {
          if (canvasRef.current) {
            // Define a local function to handle centering
            const autoCenterOnLoad = () => {
              if (!canvasRef.current) return;
              
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
              // Calculate scale to fit nodes in view with padding
              const scaleX = canvasWidth / nodeWidth;
              const scaleY = canvasHeight / nodeHeight;
              const targetScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, 0.1), 2.0);
              
              // Calculate target offset to center the nodes
              const targetOffset = {
                x: (canvasWidth / 2) - (centerX * targetScale),
                y: (canvasHeight / 2) - (centerY * targetScale)
              };

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
      // Don't update mouse position for generator nodes when onlyFetch is true
      if (onlyFetch && connectingFrom.nodeId.startsWith('generator')) {
        setConnectingFrom(null);
        return;
      }
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

  // Restore the original drawPipelineFlow function
  const drawPipelineFlow = useCallback((ctx: CanvasRenderingContext2D) => {
    // Skip if pipeline flow is disabled
    if (!showPipelineFlow) return;
    
    // Skip drawing pipeline flow in Generate Only mode
    if (onlyGenerate) return;
    
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
        exists: nodesByType.sources.length > 0 && !onlyGenerate // Don't need to change this since we're skipping the whole function in onlyGenerate mode
      },
      enrichers: { 
        ...getNodeGroupCenter(nodesByType.enrichers),
        exists: nodesByType.enrichers.length > 0 && !onlyGenerate // Don't need to change this since we're skipping the whole function in onlyGenerate mode
      },
      generators: { 
        ...getNodeGroupCenter(nodesByType.generators),
        exists: nodesByType.generators.length > 0 && !onlyFetch
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
    
    // Enrichers → Generators connection - skip if onlyFetch is true
    if (groupCenters.enrichers.exists && groupCenters.generators.exists && !onlyFetch) {
      flowConnections.push({
        from: groupCenters.enrichers,
        to: groupCenters.generators
      });
    }
    
    // Direct Sources → Generators connection (if no enrichers) - skip if onlyFetch is true
    if (!groupCenters.enrichers.exists && groupCenters.sources.exists && groupCenters.generators.exists && !onlyFetch) {
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
  }, [nodes, showPipelineFlow, onlyFetch, onlyGenerate]);

  // Store the pipeline flow function in the ref to break circular dependency
  useEffect(() => {
    pipelineFlowFnRef.current = drawPipelineFlow;
  }, [drawPipelineFlow]);

  // In the drawToBackBuffer function, modify the line that calls the pipeline flow function
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
    // This is important because node statuses may have been updated externally
    const syncedNodes = syncNodePortsWithParams(nodes);

    // Filter nodes based on selected mode
    let visibleNodes = syncedNodes;
    if (onlyFetch) {
      // In Fetch Only mode, hide generator nodes
      visibleNodes = syncedNodes.filter(node => !node.id.startsWith('generator'));
    } else if (onlyGenerate) {
      // In Generate Only mode, hide sources and enrichers, but keep generators, storage, and AI
      visibleNodes = syncedNodes.filter(node => 
        !node.id.startsWith('source') && 
        !node.id.startsWith('enricher')
      );
    }

    // Draw the default pipeline flow in the background using the function from ref
    // Only if not in Generate Only mode (which doesn't need the flow visualization)
    if (pipelineFlowFnRef.current && !onlyGenerate) {
      pipelineFlowFnRef.current(ctx);
    }
    
    // Show help message if graph is empty
    if (visibleNodes.length === 0 && !draggedPlugin) {
      // Reset transformations to draw in screen coordinates
      ctx.restore();
      ctx.save();
      
      // Draw empty state message
      const centerX = backBufferRef.current.width / 2;
      const centerY = backBufferRef.current.height / 2;
      
      ctx.font = '18px Arial';
      ctx.fillStyle = `rgba(251, 191, 36, 1)`; // Brighter yellow amber color
      ctx.textAlign = 'center';
      
      let message = 'Drag plugins from the sidebar to build your graph';
      
      ctx.fillText(message, centerX, centerY);
      
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
        // Skip connections involving hidden nodes based on current mode
        const shouldSkipConnection = 
          (onlyFetch && (connection.from.nodeId.startsWith('generator') || connection.to.nodeId.startsWith('generator'))) ||
          (onlyGenerate && (
            (connection.from.nodeId.startsWith('source') || connection.from.nodeId.startsWith('enricher')) ||
            (connection.to.nodeId.startsWith('source') || connection.to.nodeId.startsWith('enricher'))
          ));
          
        if (shouldSkipConnection) {
          return;
        }
        
        const fromNode = findNodeRecursive(syncedNodes, connection.from.nodeId);
        const toNode = findNodeRecursive(syncedNodes, connection.to.nodeId);
        
        if (fromNode && toNode) {
          try {
            drawConnection(ctx, fromNode, toNode, connection);
          } catch (error) {
            // Error silently handled to prevent console logs
          }
        }
      });
    }
    
    // Draw nodes
    if (visibleNodes.length > 0) {
      visibleNodes.forEach(node => {
        // Draw the node with the current status
        drawNode(ctx, node, scale, hoveredPort, selectedNode);
      });
    }
    
    // Draw dragged plugin ghost/preview
    if (draggedPlugin && dragPosition) {
      // Skip drawing plugin previews that don't match the current mode
      if ((onlyFetch && draggedPlugin.type === 'generator') || 
          (onlyGenerate && (draggedPlugin.type === 'source' || draggedPlugin.type === 'enricher'))) {
        ctx.restore();
        return;
      }
      
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
      // Skip drawing connection lines that don't match the current mode
      if ((onlyFetch && connectingFrom.nodeId.startsWith('generator')) ||
          (onlyGenerate && (connectingFrom.nodeId.startsWith('source') || connectingFrom.nodeId.startsWith('enricher')))) {
        ctx.restore();
        return;
      }
      
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
  }, [nodes, connections, selectedNode, scale, offset, hoveredPort, connectingFrom, mousePosition, draggedPlugin, dragPosition, onlyFetch, onlyGenerate]);

  // Update the dependency array of useEffect to prevent any circular dependencies
  useEffect(() => {
    // Skip redrawing during animation to prevent interference
    if (isAnimatingRef.current) {
      return;
    }
    
    // Use our double buffer technique
    drawToBackBuffer();
    drawToScreen();
  }, [drawToBackBuffer, drawToScreen, isAnimatingRef]);

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
        if (!resetInProgress.current) {
          setHasUnsavedChanges(true);
        }
        
        // If nodes were removed and we had a selected node that no longer exists
        if (selectedNode && !findNodeRecursive(updatedNodes, selectedNode)) {
          // Clear the selection since that node is gone
          setSelectedNode(null);
        }
      });
    });
    
    const unsubscribeConnections = configStateManager.subscribe('connections-updated', (updatedConnections) => {
      // Schedule update instead of immediate state change
      scheduleUpdate(() => {
        setConnections(updatedConnections);
        if (!resetInProgress.current) {
          setHasUnsavedChanges(true);
        }
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
        if (!resetInProgress.current) {
          setHasUnsavedChanges(true);
        }
      });
    });
    
    const unsubscribePluginUpdated = configStateManager.subscribe('plugin-updated', (updatedPlugin) => {
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
  }, [onConfigUpdate, scheduleUpdate, selectedNode]);

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
    let resizeTimeout: NodeJS.Timeout;
    let resizeObserver: ResizeObserver | null = null;
    let lastWidth = 0;
    let lastHeight = 0;

    const updateCanvasSize = () => {
      if (canvasRef.current && containerRef.current) {
        const container = containerRef.current;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        
        // Only update if size has actually changed
        if (newWidth !== lastWidth || newHeight !== lastHeight) {
          lastWidth = newWidth;
          lastHeight = newHeight;
          
          // Update canvas dimensions to match container
          canvasRef.current.width = newWidth;
          canvasRef.current.height = newHeight;
          
          // Draw after resizing
          drawToBackBuffer();
          drawToScreen();
        }
      }
    };

    // Debounced version of updateCanvasSize
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateCanvasSize, 100);
    };

    // Run on the next tick to ensure the container has been rendered
    setTimeout(updateCanvasSize, 0);
    
    // Create a new ResizeObserver with debounced updates
    resizeObserver = new ResizeObserver((entries) => {
      // Only process if we have entries and the size has changed
      if (entries.length > 0) {
        const entry = entries[0];
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;
        
        if (newWidth !== lastWidth || newHeight !== lastHeight) {
          debouncedUpdate();
        }
      }
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    // Also listen for window resize
    window.addEventListener('resize', debouncedUpdate);
    
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', debouncedUpdate);
      clearTimeout(resizeTimeout);
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
          nodeParams = { ...latestNode.params }; // Make a deep copy to avoid reference issues
        } else {
          nodeParams = { ...(actualNode.params || {}) }; // Make a deep copy
        }
        // Create plugin info structure based on node type
        let plugin: any = {
          name: latestNode?.name || actualNode.name,
          pluginName: latestNode?.pluginName || latestNode?.name || actualNode.name,
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
        const pluginSchema = pluginRegistry.findPlugin(plugin.pluginName || plugin.name, plugin.type);
        if (pluginSchema) {
          // Add schema information to the plugin
          plugin.constructorInterface = pluginSchema.constructorInterface;
          plugin.configSchema = pluginSchema.configSchema;
          plugin.description = pluginSchema.description;
        }
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
      // Skip connecting from generator nodes if onlyFetch is true
      if (onlyFetch && portInfo.nodeId.startsWith('generator')) {
        return;
      }
      
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
    
    // Create a true deep copy of the updated plugin
    const pluginCopy = deepCopy(updatedPlugin);
    
    // Check if this is a new plugin (no ID) - typically from drag and drop
    if (!pluginCopy.id) {
      // Generate an ID based on plugin type
      let pluginType = pluginCopy.type;
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
          pluginType = pluginCopy.type;
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
      pluginCopy.id = `${pluginType}-${index}`;
      
      // Include position data from the drop location
      const pluginConfig = {
        name: pluginCopy.name,
        pluginName: pluginCopy.pluginName || pluginCopy.name,
        type: pluginType,
        params: deepCopy(pluginCopy.params) || {},
        position: pluginCopy.position || { x: 300, y: 300 },
      };

      const savedConfig = {
        name: pluginCopy.name,
        type: pluginCopy.pluginName,
        params: deepCopy(pluginCopy.params) || {},
        position: pluginCopy.position || { x: 300, y: 300 },
        interval: pluginCopy.interval || 60000,
      }
      // Add the new plugin to the config
      currentConfig[targetArray].push(savedConfig as any);
      
      // Update the config
      configStateManager.updateConfig(currentConfig);
      
      // Force a sync to rebuild nodes from the config
      configStateManager.forceSync();
      
      // Update local state directly for new plugins
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      
      // Update parent component's config
      onConfigUpdate(configStateManager.getConfig());
    }
    else {
      
      // Try to update the plugin in the config state manager
      const updated = configStateManager.updatePlugin(pluginCopy);
      
      if (!updated) {
        console.error("Failed to update plugin in state manager");
        return;
      }
      
      // Get the updated config and make sure our changes persisted
      const updatedConfig = configStateManager.getConfig();
      
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
    setHasUnsavedChanges(true);
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
      
      // Call the parent component's save function
      // This ensures we go through the same save path as the parent
      if (!saveConfiguration) {
        throw new Error('saveConfiguration function is not defined');
      }
      const success = await saveConfiguration();
      
      if (success) {
        // Show success message
        showToast(`Configuration ${configName} saved successfully`, 'success');
        
        // Reset unsaved changes flag
        setHasUnsavedChanges(false);
      } else {
        throw new Error('Save operation failed');
      }
    } catch (error) {
      console.error('Error saving config to server:', error);
      showToast('Failed to save configuration. Please try again.', 'error');
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
    
    // Check if the plugin is allowed in the current mode
    if (onlyFetch && draggedPlugin.type === 'generator') {
      showToast("Cannot add generator plugins in Fetch Only mode", "error");
      setDraggedPlugin(null);
      setDragPosition(null);
      return;
    }
    
    if (onlyGenerate && (draggedPlugin.type === 'source' || draggedPlugin.type === 'enricher')) {
      showToast("Source and enricher plugins cannot be added in Generate Only mode", "error");
      setDraggedPlugin(null);
      setDragPosition(null);
      return;
    }
    
    // Get drop position in canvas coordinates
    const rect = canvasRef.current!.getBoundingClientRect();
    const dropX = (e.clientX - rect.left - offset.x) / scale;
    const dropY = (e.clientY - rect.top - offset.y) / scale;
    
    // Create new plugin instance with the full schema from the draggedPlugin
    const newPlugin = {
      type: draggedPlugin.type,
      name: draggedPlugin.name,
      pluginName: draggedPlugin.pluginName || draggedPlugin.name,
      params: {},
      position: { x: dropX, y: dropY },
      // Include constructor interface and config schema from the original plugin definition
      constructorInterface: draggedPlugin.constructorInterface,
      configSchema: draggedPlugin.configSchema,
      description: draggedPlugin.description
    };
    
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

  // Handle reset to saved config
  const handleReset = async () => {
    try {
      // Set reset in progress flag
      resetInProgress.current = true;
      
      // Get the current config name
      const configName = config.name;
      if (!configName) {
        console.error('Cannot reset without a config name');
        return;
      }

      // Immediately set hasUnsavedChanges to false to prevent any state updates from enabling the button
      setHasUnsavedChanges(false);

      // Load the saved config from the server
      const savedConfig = await getConfig(configName);
      if (!savedConfig) {
        console.error('Failed to load saved config');
        return;
      }

      // Update the config state manager with the saved version
      configStateManager.loadConfig(savedConfig);
      
      // Force a sync to rebuild nodes and connections
      configStateManager.forceSync();
      
      // Update local state with the latest from state manager
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      
      // Update the parent component with the saved config
      onConfigUpdate(savedConfig);
      
      // Force a redraw to show the reset state
      drawToBackBuffer();
      drawToScreen();
      
      setShowResetDialog(false);
      
      // Clear reset in progress flag after a short delay to ensure all state updates are complete
      setTimeout(() => {
        resetInProgress.current = false;
      }, 100);
    } catch (error) {
      console.error('Error resetting config:', error);
      showToast('Failed to reset configuration. Please try again.', 'error');
      resetInProgress.current = false;
    }
  };

  // Add an effect to force redraw when nodes change, particularly when their status changes
  useEffect(() => {
    // This effect should trigger whenever nodes change, especially their status
    if (nodes.length > 0) {
      // Check if any node has a status
      const hasStatusNodes = nodes.some(node => node.status !== undefined && node.status !== null);
      
      
      // Force redraw on the next frame
      if (canvasRef.current) {
        requestAnimationFrame(() => {
          drawToBackBuffer();
          drawToScreen();
        });
      }
    }
  }, [nodes, drawToBackBuffer, drawToScreen]);

  // Handle custom run aggregation that uses job ID
  const handleRunAggregation = async () => {
    if (!config || !config.name) {
      console.error("Cannot run aggregation without a config name");
      return;
    }
    
    try {
      // Get the latest config from the state manager
      const currentConfig = configStateManager.getConfig();
      
      // Set runOnce to true - this is a one-time operation
      currentConfig.runOnce = true;
      
      // Set onlyFetch and onlyGenerate settings
      if (!currentConfig.settings) {
        currentConfig.settings = { runOnce: true, onlyFetch: false };
      }
      currentConfig.settings.onlyFetch = onlyFetch;
      currentConfig.settings.onlyGenerate = onlyGenerate;
      
      // Add historical date settings if enabled
      if (useHistoricalDates) {
        currentConfig.settings.historicalDate = {
          enabled: true,
          mode: dateRangeMode,
          startDate: startDate,
          endDate: dateRangeMode === "range" ? endDate : startDate
        };
      } else {
        // Clear historical date settings if disabled
        currentConfig.settings.historicalDate = {
          enabled: false
        };
      }
      
      // Reset the job status display closed state when starting a new job
      setJobStatusDisplayClosed(false);
      
      // Clear the old job status before starting a new job
      setJobStatus(null);
      setCurrentJobId(null);
      
      // Make sure websocket is disconnected to avoid stale data
      websocketService.disconnect();
      
      // If config has unsaved changes, save it first
      if (hasUnsavedChanges) {
        const shouldSave = window.confirm("The configuration has unsaved changes. Do you want to save before running?");
        if (shouldSave) {
          await handleSaveToServer();
        }
      }
      
      // Make a direct REST API call to run the aggregation
      const response = await fetch(`http://localhost:3000/aggregate/${config.name}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentConfig),
      });
      
      if (!response.ok) {
        throw new Error('Failed to run aggregation via REST API');
      }
      
      const result = await response.json();
      const jobId = result.jobId;
      
      // Set the current job ID and mark this as a run-once job
      setCurrentJobId(jobId);
      setIsRunOnceJob(true);
      jobTypesRef.current.set(jobId, true); // true = is run once
      
      // Connect to the job's WebSocket for status updates
      websocketService.disconnect();
      websocketService.connectToJob(jobId);
      
      // Set aggregation as running immediately
      setIsAggregationRunning(true);
    } catch (error) {
      console.error("Failed to run aggregation:", error);
      showToast("Failed to run aggregation. Please try again.", 'error');
    }
  };

  // Handle start/stop continuous aggregation
  const handleToggleAggregation = async () => {
    if (!config || !config.name) {
      console.error("Cannot run aggregation without a config name");
      return;
    }
    
    try {
      // If aggregation is already running, stop it
      if (isAggregationRunning) {
        // If we have a current job ID, use that to stop the job
        if (currentJobId) {
          // Stop the job directly using the job ID
          const response = await fetch(`http://localhost:3000/job/${currentJobId}/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error('Failed to stop job');
          }
          
          // Clear job-related state after stopping
          setCurrentJobId(null);
          setJobStatus(null);
        } else {
          // Fall back to the old method if we don't have a job ID for some reason
          const response = await fetch(`http://localhost:3000/aggregate/${config.name}/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error('Failed to stop aggregation');
          }
          
        }
        
        setIsAggregationRunning(false);
        return;
      }
      
      // Historical data can only work with run-once mode, so switch to handleRunAggregation
      if (useHistoricalDates) {
        showToast("Historical data mode requires using 'Run Once'. Switching to run once mode.", "info");
        setSelectedRunMode("once");
        await handleRunAggregation();
        return;
      }
      
      // This is for starting a CONTINUOUS job
      // Get the latest config from the state manager
      const currentConfig = configStateManager.getConfig();
      currentConfig.runOnce = false;
      
      // Set onlyFetch and onlyGenerate settings
      if (!currentConfig.settings) {
        currentConfig.settings = { runOnce: false, onlyFetch: false };
      }
      currentConfig.settings.onlyFetch = onlyFetch;
      currentConfig.settings.onlyGenerate = onlyGenerate;
      
      // Clear historical date settings for continuous jobs
      currentConfig.settings.historicalDate = {
        enabled: false
      };
      
      // Reset the job status display closed state when starting a new continuous job
      setJobStatusDisplayClosed(false);
      
      // Clear the old job status before starting a new job
      setJobStatus(null);
      setCurrentJobId(null);
      
      // Make sure websocket is disconnected to avoid stale data
      websocketService.disconnect();
      
      // If config has unsaved changes, save it first
      if (hasUnsavedChanges) {
        const shouldSave = window.confirm("The configuration has unsaved changes. Do you want to save before running?");
        if (shouldSave) {
          await handleSaveToServer();
        }
      }
      
      // Start the aggregation
      const response = await fetch(`http://localhost:3000/aggregate/${config.name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentConfig),
      });
      
      if (!response.ok) {
        throw new Error('Failed to start aggregation');
      }
      
      // Parse the response to get the job ID
      const result = await response.json();
      const jobId = result.jobId;
      
      // Set the current job ID and mark as continuous
      setCurrentJobId(jobId);
      setIsRunOnceJob(false);
      jobTypesRef.current.set(jobId, false); // false = continuous job
      
      
      // Connect to the job's WebSocket for status updates
      websocketService.disconnect();
      websocketService.connectToJob(jobId);
      
      // Set aggregation as running immediately
      setIsAggregationRunning(true);
    } catch (error) {
      console.error("Failed to toggle aggregation:", error);
      showToast("Failed to toggle aggregation. Please try again.", 'error');
    }
  };

  // Add cleanup effect for WebSocket connections
  useEffect(() => {
    // Return cleanup function to run when component unmounts or config changes
    return () => {
      // Clean up any WebSocket connections for the current job
      if (currentJobId) {
        try {
          // Disconnect the WebSocket
          websocketService.disconnect();
        } catch (error) {
          console.error('Error disconnecting WebSocket:', error);
        }
      }
    };
  }, [currentJobId, config.name]);

  // Add effect to make sure job status is cleared when config changes
  useEffect(() => {
    // Reset job-related state when config changes
    setCurrentJobId(null);
    setJobStatus(null);
    setIsAggregationRunning(false);
    setIsRunOnceJob(false);
    setJobStatusDisplayClosed(false);
    
    // Clear the job types map
    jobTypesRef.current.clear();
    
    // Clean up previous job status listeners
    if (jobStatusCleanupRef.current) {
      jobStatusCleanupRef.current();
      jobStatusCleanupRef.current = null;
    }
    
    // Reconnect to websocket if needed for the new config
    if (config?.name) {
      websocketService.disconnect();
      websocketService.connect(config.name);
    }
  }, [config.name]);

  return (
    <div className="relative w-full h-full">
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
        <PluginPalette 
          onDragPlugin={handleDragPlugin} 
          onlyFetch={onlyFetch} 
          onlyGenerate={onlyGenerate} 
        />
      </div>
      
      <div 
        className="flex-1 flex flex-col relative transition-all duration-300 ease-in-out h-full"
        style={{
          marginLeft: paletteVisible && paletteAnimation !== 'closing' ? '20rem' : '0'
        }}
      >
        <div className="absolute top-4 left-4 z-10 flex space-x-2">
          <button
            onClick={togglePalette}
            className="w-10 h-10 bg-stone-800/90 text-amber-300 border-stone-600/50 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30 transition-colors duration-300"
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
            className="w-10 h-10 bg-stone-800/90 text-amber-300 border-stone-600/50 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30"
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
            onClick={() => setShowConfigDialog(true)}
            className="w-10 h-10 bg-stone-800/90 text-amber-300 border-stone-600/50 rounded hover:bg-stone-700 focus:outline-none flex items-center justify-center border border-amber-400/30"
            title="Configure node graph"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
            </svg>
          </button>
          <button
            onClick={() => setShowResetDialog(true)}
            className={`w-10 h-10 rounded focus:outline-none flex items-center justify-center ${
              hasUnsavedChanges 
                ? 'bg-stone-800/90 text-amber-300 border-stone-600/50 hover:bg-stone-600 border-amber-400/30 border' 
                : 'bg-stone-900 text-gray-300 cursor-not-allowed'
            }`}
            title="Reset to saved configuration"
            disabled={!hasUnsavedChanges}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M480-80q-75 0-140.5-28.5t-114-77q-48.5-48.5-77-114T120-440h80q0 117 81.5 198.5T480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720h-6l62 62-56 58-160-160 160-160 56 58-62 62h6q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-440q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-80Z"/></svg>
          </button>
          <button
            onClick={handleSaveToServer}
            className={`px-4 h-10 rounded focus:outline-none flex items-center justify-center shadow-md ${
              hasUnsavedChanges 
                ? 'text-black bg-amber-300 hover:bg-amber-400' 
                : 'bg-stone-900 text-gray-300 cursor-not-allowed'
            }`}
            title={hasUnsavedChanges ? "Save configuration to server" : "No changes to save"}
            disabled={!hasUnsavedChanges}
          >
            Save Config
          </button>
        </div>
        <div className="absolute top-4 right-4 z-10 flex space-x-2">
          {/* Completely redesigned run control panel */}
          <div className="flex items-center space-x-1.5">
            <div className="relative">
              {isAggregationRunning ? (
                <button
                  onClick={handleToggleAggregation}
                  className="h-10 px-4 rounded-md bg-stone-800 border border-red-500/70 text-white hover:bg-stone-700 hover:border-red-500 focus:outline-none flex items-center justify-center transition-colors duration-200 shadow-md"
                  title="Stop aggregation"
                >
                  <span className="flex items-center">
                    <span className="relative flex h-2.5 w-2.5 mr-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                    <span className="font-medium">Stop</span>
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {/* Run control panel with toggle switch */}
                  <div className="flex items-center bg-stone-800/90 border-stone-600/50 rounded-md shadow-md overflow-hidden border">
                    {/* Mode toggle switch - removed from here */}
                    
                    {/* Run button */}
                    <button
                      onClick={() => {
                        // Always use handleRunAggregation with historical data
                        if (useHistoricalDates || selectedRunMode === "once") {
                          handleRunAggregation();
                        } else {
                          handleToggleAggregation();
                        }
                      }}
                      className={`
                        h-10 px-4 focus:outline-none flex items-center justify-center transition-colors duration-200
                        ${useHistoricalDates 
                          ? "bg-stone-800 text-purple-300 hover:bg-stone-700 border-l border-purple-500/30" 
                          : selectedRunMode === "once" 
                            ? "bg-stone-800 text-amber-300 hover:bg-stone-700" 
                            : "bg-stone-800 text-green-400 hover:bg-stone-700"}
                      `}
                      title={
                        useHistoricalDates 
                          ? `Run with historical data: ${dateRangeMode === "single" 
                              ? `Single date ${startDate}` 
                              : `Date range ${startDate} to ${endDate}`}` 
                          : (selectedRunMode === "once" ? "Run once and stop when complete" : "Run continuously until stopped")
                      }
                    >
                      <span className="text-sm font-medium flex items-center">
                        {useHistoricalDates && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                        {selectedRunMode === "continuous" && !useHistoricalDates && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        Run
                      </span>
                    </button>
                    {/* Settings button */}
                    <div className="flex items-center">
                      <button
                        id="settings-button"
                        onClick={() => {
                          if (!showRunOptions) {
                            const buttonElement = document.getElementById('settings-button');
                            if (buttonElement) {
                              const rect = buttonElement.getBoundingClientRect();
                              setSettingsButtonPosition({
                                top: rect.top,
                                right: rect.right,
                                bottom: rect.bottom,
                                left: rect.left
                              });
                            }
                          }
                          setShowRunOptions(!showRunOptions);
                        }}
                        className={`h-10 px-3 flex items-center justify-center transition-all duration-200 ${
                          showRunOptions 
                            ? 'text-amber-300 bg-stone-700 shadow-inner' 
                            : 'text-stone-300 hover:text-amber-300 hover:bg-stone-700/50'
                        }`}
                        title={
                          useHistoricalDates
                            ? `Historical data enabled: ${dateRangeMode === "single" 
                                ? `Single date ${startDate}` 
                                : `Date range ${startDate} to ${endDate}`}`
                            : "Process mode settings"
                        }
                        aria-expanded={showRunOptions}
                        aria-controls="process-mode-dropdown"
                      >
                        <div className="relative">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <circle cx="10" cy="4" r="1.75" />
                            <circle cx="10" cy="10" r="1.75" />
                            <circle cx="10" cy="16" r="1.75" />
                          </svg>
                          {(showRunOptions || useHistoricalDates) && (
                            <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${
                              useHistoricalDates ? "bg-purple-400" : "bg-amber-400"
                            }`}></span>
                          )}
                        </div>
                      </button>
                      
                      {/* Collapsible Process Mode Panel with improved visibility */}
                      {showRunOptions && ReactDOM.createPortal(
                        <div 
                          id="process-mode-dropdown"
                          className="fixed bg-stone-800 border border-stone-600 rounded-md shadow-xl z-[9999] transition-all duration-300 ease-in-out overflow-visible"
                          style={{
                            width: '220px',
                            top: settingsButtonPosition?.bottom ? `${settingsButtonPosition.bottom + 4}px` : 'auto',
                            left: settingsButtonPosition?.left ? `${settingsButtonPosition.left - 175}px` : 'auto',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(251, 191, 36, 0.1)'
                          }}
                        >
                          <div className="p-3">
                            <div className="flex flex-col">
                              <h3 className="text-xs text-stone-300 mb-2 font-medium">Run Mode</h3>
                              <div className="flex items-center mb-3 justify-between">
                                <div className="flex items-center gap-2 mr-2">
                                  <button
                                    onClick={() => {
                                      if (!useHistoricalDates) {
                                        setSelectedRunMode("once");
                                      }
                                    }}
                                    className={`text-xs px-3 py-1 rounded ${
                                      selectedRunMode === "once"
                                        ? "bg-amber-500/20 text-amber-300 font-medium"
                                        : "bg-stone-700/50 text-stone-400 hover:bg-stone-700"
                                    }`}
                                    disabled={useHistoricalDates && selectedRunMode === "once"}
                                  >
                                    <span className="flex items-center">
                                      <span className={`w-2 h-2 rounded-full mr-1.5 ${selectedRunMode === "once" ? "bg-amber-400" : "bg-stone-600"}`}></span>
                                      Run Once
                                    </span>
                                  </button>
                                  
                                  <button
                                    onClick={() => {
                                      if (!useHistoricalDates) {
                                        setSelectedRunMode("continuous");
                                      }
                                    }}
                                    className={`text-xs px-3 py-1 rounded ${
                                      selectedRunMode === "continuous"
                                        ? "bg-green-500/20 text-green-300 font-medium"
                                        : "bg-stone-700/50 text-stone-400 hover:bg-stone-700"
                                    } ${useHistoricalDates ? "opacity-50 cursor-not-allowed" : ""}`}
                                    disabled={useHistoricalDates}
                                    title={useHistoricalDates ? "Historical data mode only works with 'Run Once'" : "Run continuously until stopped"}
                                  >
                                    <span className="flex items-center">
                                      <span className={`w-2 h-2 rounded-full mr-1.5 ${selectedRunMode === "continuous" ? "bg-green-400" : "bg-stone-600"}`}></span>
                                      Stream
                                    </span>
                                  </button>
                                </div>
                              </div>
                              
                              <div className="h-px bg-stone-700 mb-3 w-full"></div>
                              
                              <h3 className="text-xs text-stone-300 mb-2 font-medium">Process Mode</h3>
                              <div className="flex flex-col space-y-1.5">
                                <button
                                  onClick={() => {
                                    setOnlyFetch(false);
                                    setOnlyGenerate(false);
                                    setShowRunOptions(false); // Close after selection
                                  }}
                                  className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                                    !onlyFetch && !onlyGenerate
                                      ? 'bg-amber-500/20 text-amber-300 font-medium'
                                      : 'bg-stone-700/50 text-stone-400 hover:bg-stone-700'
                                  }`}
                                  title="Run complete pipeline with fetch and generate phases"
                                >
                                  <span className={`w-3 h-3 rounded-full mr-2 ${!onlyFetch && !onlyGenerate ? 'bg-amber-400' : 'bg-stone-600'}`}></span>
                                  Complete Pipeline
                                </button>
                                <button
                                  onClick={() => {
                                    setOnlyFetch(true);
                                    setOnlyGenerate(false);
                                    setShowRunOptions(false); // Close after selection
                                  }}
                                  className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                                    onlyFetch
                                      ? 'bg-blue-500/20 text-blue-400 font-medium'
                                      : 'bg-stone-700/50 text-stone-400 hover:bg-stone-700'
                                  }`}
                                  title="Only fetch data from sources - skip generation phase"
                                >
                                  <span className={`w-3 h-3 rounded-full mr-2 ${onlyFetch ? 'bg-blue-400' : 'bg-stone-600'}`}></span>
                                  Fetch Data Only
                                </button>
                                <button
                                  onClick={() => {
                                    setOnlyFetch(false);
                                    setOnlyGenerate(true);
                                    setShowRunOptions(false); // Close after selection
                                  }}
                                  className={`px-2 py-1.5 text-xs rounded text-left transition-colors flex items-center ${
                                    onlyGenerate
                                      ? 'bg-purple-500/20 text-purple-400 font-medium'
                                      : 'bg-stone-700/50 text-stone-400 hover:bg-stone-700'
                                  }`}
                                  title="Only generate content from existing data - skip fetch phase"
                                >
                                  <span className={`w-3 h-3 rounded-full mr-2 ${onlyGenerate ? 'bg-purple-400' : 'bg-stone-600'}`}></span>
                                  Generate Content Only
                                </button>
                              </div>
                              
                              {/* Historical date range selector */}
                              <div className="mt-3 border-t border-stone-600 pt-3">
                                <div className="flex items-center justify-between mb-2">
                                  <h3 className="text-xs text-stone-300 font-medium">Historical Data</h3>
                                  <button 
                                    onClick={() => {
                                      const newHistoricalState = !useHistoricalDates;
                                      setUseHistoricalDates(newHistoricalState);
                                      // If enabling historical data, force run mode to "once"
                                      if (newHistoricalState) {
                                        setSelectedRunMode("once");
                                      }
                                    }}
                                    className="relative inline-flex items-center h-4 rounded-full w-8 transition-colors focus:outline-none"
                                    aria-pressed={useHistoricalDates}
                                  >
                                    <span 
                                      className={`
                                        inline-block w-8 h-4 rounded-full transition-colors duration-200 ease-in-out
                                        ${useHistoricalDates ? "bg-purple-600/60" : "bg-stone-600"}
                                      `}
                                    />
                                    <span 
                                      className={`
                                        absolute inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out
                                        ${useHistoricalDates ? "translate-x-4" : "translate-x-1"}
                                      `}
                                    />
                                  </button>
                                </div>
                                
                                {useHistoricalDates && (
                                  <div className="mt-2 space-y-2">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <div className="flex space-x-3">
                                        <button
                                          onClick={() => setDateRangeMode("single")}
                                          className={`text-xs px-2 py-0.5 rounded ${
                                            dateRangeMode === "single" 
                                              ? "bg-purple-500/20 text-purple-300 font-medium" 
                                              : "bg-stone-700 text-stone-400 hover:bg-stone-600"
                                          }`}
                                        >
                                          Single Date
                                        </button>
                                        <button
                                          onClick={() => setDateRangeMode("range")}
                                          className={`text-xs px-2 py-0.5 rounded ${
                                            dateRangeMode === "range" 
                                              ? "bg-purple-500/20 text-purple-300 font-medium" 
                                              : "bg-stone-700 text-stone-400 hover:bg-stone-600"
                                          }`}
                                        >
                                          Date Range
                                        </button>
                                      </div>
                                    </div>
                                    
                                    <div className="flex flex-col space-y-2">
                                      <div className="flex items-center">
                                        <label className="text-xs text-stone-400 w-16">{dateRangeMode === "single" ? "Date:" : "Start:"}</label>
                                        <input
                                          type="date"
                                          value={startDate}
                                          onChange={(e) => setStartDate(e.target.value)}
                                          className="bg-stone-700 text-stone-200 text-xs p-1 rounded w-full border border-stone-600 focus:border-purple-500 focus:outline-none"
                                        />
                                      </div>
                                      
                                      {dateRangeMode === "range" && (
                                        <div className="flex items-center">
                                          <label className="text-xs text-stone-400 w-16">End:</label>
                                          <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="bg-stone-700 text-stone-200 text-xs p-1 rounded w-full border border-stone-600 focus:border-purple-500 focus:outline-none"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-hidden w-full h-full" ref={containerRef}>
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDragOver={handleDragOver}
            onDrop={handleDropPlugin}
            onDragLeave={handleDragLeave}
          ></canvas>
          
          {/* Display Job Status */}
          {jobStatus && !jobStatusDisplayClosed && (
            <div className="absolute bottom-4 right-4 z-50 w-96 shadow-xl">
              <div className="bg-red-500 absolute top-0 right-0 h-3 w-3 rounded-full animate-ping"></div>
              <JobStatusDisplay 
                key={jobStatus.jobId}
                jobStatus={jobStatus}
                runMode={isRunOnceJob ? "once" : "continuous"}
                onClose={() => setJobStatusDisplayClosed(true)}
              />
            </div>
          )}
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

      {showResetDialog && (
        <ResetDialog
          onClose={() => setShowResetDialog(false)}
          onConfirm={handleReset}
        />
      )}
    </div>
  );
};
