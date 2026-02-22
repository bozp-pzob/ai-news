import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Config, PluginInfo, JobStatus } from '../types';
import { PluginParamDialog } from './PluginParamDialog';
import { drawNode, drawGrid, drawConnection, drawConnectionLine } from '../utils/nodeRenderer';
import { findPortAtCoordinates, isPointInNode, removeNodeConnection, handleNodeConnection, findNodeAtCoordinates, findNodeRecursive, isPointInCollapseButton, syncNodePortsWithParams, cleanupStaleConnections } from '../utils/nodeHandlers';
import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { deepCopy } from '../utils/deepCopy';
import { configStateManager } from '../services/ConfigStateManager';
import { pluginRegistry } from '../services/PluginRegistry';
import { dependencyResolver, DependencyAnalysis, AutoAddResult } from '../services/DependencyResolver';
import { animateCenterView } from '../utils/animation/centerViewAnimation';
import { getConfig, configApi, runApi, runsApi, API_BASE } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { websocketService } from '../services/websocket';
import { useWebSocket } from '../hooks/useWebSocket';
import { JobStatusDisplay } from './JobStatusDisplay';
import { useToast } from './ToastProvider';
import { secretManager } from '../services/SecretManager';
import { ConfigJsonEditor } from './ConfigJsonEditor';
import { useRunOptions } from '../hooks/useRunOptions';
import { useJobStatus } from '../hooks/useJobStatus';
import { RunControls } from './RunControls';

// Add type constants to represent the pipeline flow steps
const PIPELINE_STEPS = ['sources', 'enrichers', 'generators'] as const;
type PipelineStep = typeof PIPELINE_STEPS[number];

// Update the NodeGraphProps interface to include hasUnsavedChanges
interface NodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config, isReset?: boolean) => void;
  saveConfiguration?: () => Promise<boolean>;
  runAggregation?: () => Promise<void>;
  viewMode?: 'graph' | 'json';
  hasUnsavedChanges?: boolean;
  // Platform mode props for PostgresStorage handling
  platformMode?: boolean;
  isPlatformPro?: boolean;
  platformConfigId?: string;
}

export const NodeGraph = forwardRef<
  { handleDragPlugin: (plugin: PluginInfo, clientX: number, clientY: number) => void },
  NodeGraphProps
>(({ config, onConfigUpdate, saveConfiguration, runAggregation, viewMode = 'graph', hasUnsavedChanges = false, platformMode = false, isPlatformPro = false, platformConfigId }, ref) => {
  const { showToast } = useToast();
  const { authToken } = useAuth();
  
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
  const [showPipelineFlow, setShowPipelineFlow] = useState(true);

  // Job status state (extracted to hook)
  const jobState = useJobStatus();
  const {
    currentJobId, setCurrentJobId,
    jobStatus, setJobStatus,
    jobStatusDisplayClosed, setJobStatusDisplayClosed,
    isAggregationRunning, setIsAggregationRunning,
    isRunOnceJob, setIsRunOnceJob,
    currentJobIdRef, jobTypesRef, completedJobsRef,
    resetForNewRun, startJob, markCompleted,
  } = jobState;

  // Run options state (extracted to hook)
  const runOptions = useRunOptions();
  const {
    onlyFetch, onlyGenerate,
    selectedRunMode, setSelectedRunMode,
    useHistoricalDates,
    dateRangeMode,
    startDate, endDate,
  } = runOptions;
  // State for auto-add dependencies feature
  const [pendingDependencyAnalysis, setPendingDependencyAnalysis] = useState<DependencyAnalysis | null>(null);
  const [pendingAutoAddResult, setPendingAutoAddResult] = useState<AutoAddResult | null>(null);
  
  // Add a ref for preventing config update loops
  const preventConfigUpdateLoopRef = useRef(false);
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
    
    // Check if this job has already completed (run-once jobs only)
    // This prevents stale 'running' status updates from reverting the UI state
    const jobAlreadyCompleted = completedJobsRef.current.has(jobId);
    
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
      completedJobsRef.current.add(jobId); // Mark as completed to prevent future running updates
      setIsAggregationRunning(false);
    } else if (status.status === 'completed') {
      // For run-once jobs, mark as no longer running when completed
      if (isJobRunOnce) {
        completedJobsRef.current.add(jobId); // Mark as completed to prevent future running updates
        setIsAggregationRunning(false);
        // Don't set jobStatus to null - let the component display the completed state
      } else {
        // For continuous jobs, keep running
        setIsAggregationRunning(true);
      }
    } else if (status.status === 'running') {
      // Only set to running if this job hasn't already completed
      // This prevents stale WebSocket updates from reverting the state
      if (!jobAlreadyCompleted) {
        setIsAggregationRunning(true);
      }
    }
    
    // Keep the isRunOnceJob state in sync with the current job
    if (currentJobId === jobId) {
      setIsRunOnceJob(!!isJobRunOnce);
    }
  }, [isRunOnceJob, currentJobId, jobStatus]);

  // Store the latest createJobStatusHandler in a ref so the listener always has access to it
  const createJobStatusHandlerRef = useRef(createJobStatusHandler);
  useEffect(() => {
    createJobStatusHandlerRef.current = createJobStatusHandler;
  }, [createJobStatusHandler]);

  // Effect to listen for job status updates - only runs once on mount
  useEffect(() => {
    // Create a STABLE function that doesn't change - it accesses the latest handler via ref
    const globalJobStatusHandler = (status: JobStatus) => {
      // Compare the current job ID with the incoming status
      // Use ref for immediate access to avoid React state async timing issues
      if (currentJobIdRef.current && status.jobId === currentJobIdRef.current) {
        // Use the latest handler via ref
        createJobStatusHandlerRef.current(status.jobId)(status);
      }
    };
    
    // Register global listener (without specific job ID)
    websocketService.addJobStatusListener(globalJobStatusHandler);
    
    // Set up job started listener
    const handleJobStarted = (jobId: string) => {
      currentJobIdRef.current = jobId; // Update ref immediately
      setCurrentJobId(jobId);
      completedJobsRef.current.clear(); // Clear completed jobs tracking for new job
      
      // For newly started jobs, check if we have config.runOnce information to determine type
      // Default to the current state if we don't know
      const currentConfig = configStateManager.getConfig();
      if (currentConfig && typeof currentConfig.runOnce === 'boolean') {
        jobTypesRef.current.set(jobId, currentConfig.runOnce);
        
        // Also update current state if this is becoming the current job
        setIsRunOnceJob(currentConfig.runOnce);
      } else if (!jobTypesRef.current.has(jobId)) {
        // If we don't have the jobType set yet, use the current state as default
        // Note: isRunOnceJob might be stale here, but jobTypesRef should be set correctly
        // by handleRunAggregation before this is called
        jobTypesRef.current.set(jobId, true); // Default to run-once if unknown
      }
      
      // Connect to the job's WebSocket for status updates
      websocketService.connectToJob(jobId);
    };
    
    // Add job started listener
    websocketService.addJobStartedListener(handleJobStarted);
    
    // Clean up on unmount only
    return () => {
      websocketService.removeJobStartedListener(handleJobStarted);
      websocketService.removeJobStatusListener(globalJobStatusHandler);
    };
  }, []); // Empty dependency array - listener is stable and accesses latest via refs

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
    
    // Check if config is valid - if not, create appropriate default config
    if (!config || !config.name) {
      let defaultConfig: Config;
      
      if (platformMode) {
        // Platform mode: Start with default storage and AI plugins pre-configured
        defaultConfig = {
          name: 'new-config',
          sources: [],
          enrichers: [],
          generators: [],
          ai: [{
            type: 'OpenAIProvider',
            name: 'OpenAIProvider',
            pluginName: 'OpenAIProvider',
            params: {
              usePlatformAI: true,
            }
          }],
          storage: [{
            type: 'PostgresStorage',
            name: 'PostgresStorage',
            pluginName: 'PostgresStorage',
            params: {
              usePlatformStorage: true,
            }
          }],
          providers: [],
          settings: {
            runOnce: false,
            onlyFetch: false
          }
        };
      } else {
        // Legacy mode: Empty config
        defaultConfig = {
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
      }
      
      // Initialize state manager with default config
      configStateManager.loadConfig(defaultConfig);
      configStateManager.forceSync();
      
      // Update local state with nodes from the config
      setNodes(configStateManager.getNodes());
      setConnections(configStateManager.getConnections());
      setSelectedNode(null);
      
      // Force a redraw to show the graph
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
                // Invalid node bounds, skip centering
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

  // Redraw when draw functions change (avoids isAnimatingRef in deps - refs don't trigger re-renders)
  useEffect(() => {
    // Skip redrawing during animation to prevent interference
    if (isAnimatingRef.current) {
      return;
    }
    
    // Use our double buffer technique
    drawToBackBuffer();
    drawToScreen();
  }, [drawToBackBuffer, drawToScreen]);

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
      // Cannot center view without nodes or canvas
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
      // Invalid node bounds, skip centering
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
        // Instead of updating local state, notify parent of config change
        const currentConfig = configStateManager.getConfig();
        onConfigUpdate(currentConfig);
        
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
        // Instead of updating local state, notify parent of config change
        const currentConfig = configStateManager.getConfig();
        onConfigUpdate(currentConfig);
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
      
      // AUTO-ADD DEPENDENCIES: Add dependency nodes before the main plugin
      if (pendingAutoAddResult && pendingAutoAddResult.nodesToAdd.length > 0) {
        for (const depNode of pendingAutoAddResult.nodesToAdd) {
          if (depNode.type === 'ai') {
            // Ensure ai array exists
            if (!Array.isArray(currentConfig.ai)) {
              currentConfig.ai = [];
            }
            currentConfig.ai.push({
              name: depNode.name,
              type: depNode.pluginName || depNode.name,
              params: deepCopy(depNode.params) || {},
              position: depNode.position,
            } as any);
          } else if (depNode.type === 'storage') {
            // Ensure storage array exists
            if (!Array.isArray(currentConfig.storage)) {
              currentConfig.storage = [];
            }
            currentConfig.storage.push({
              name: depNode.name,
              type: depNode.pluginName || depNode.name,
              params: deepCopy(depNode.params) || {},
              position: depNode.position,
            } as any);
          }
        }
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
      
      // AUTO-ADD DEPENDENCIES: Create connections for the newly added plugin
      if (pendingDependencyAnalysis && pendingAutoAddResult) {
        const updatedNodes = configStateManager.getNodes();
        const updatedConnections = [...configStateManager.getConnections()];
        
        // Create dependency connections
        const newConnections = dependencyResolver.createDependencyConnections(
          pluginCopy.id,
          pendingDependencyAnalysis,
          pendingAutoAddResult,
          updatedNodes
        );
        
        // Add the new connections
        if (newConnections.length > 0) {
          updatedConnections.push(...newConnections);
          configStateManager.setConnections(updatedConnections);
        }
        
        // Clear pending dependency state
        setPendingDependencyAnalysis(null);
        setPendingAutoAddResult(null);
      }
      
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
    
    // Clear pending dependency state (in case it wasn't cleared in the if branch)
    setPendingDependencyAnalysis(null);
    setPendingAutoAddResult(null);
    
    // Ensure the changes are immediately visible
    drawToBackBuffer();
    drawToScreen();
  };

  // Handle saving config to server
  const handleSaveToServer = async () => {
    try {
      // Make sure the config is up to date with current node state
      const currentConfig = configStateManager.getConfig();
      
      // If the configuration is missing a name, prompt for it
      let configName = currentConfig.name || '';
      if (!configName || configName.trim() === '') {
        const userInput = prompt('Please enter a name for this configuration:', 'my-config');
        if (!userInput || userInput.trim() === '') {
          return false; // User cancelled or provided empty name
        }
        configName = userInput.trim();
        currentConfig.name = configName;
        configStateManager.updateConfig(currentConfig);
      }
      
      // Call the parent component's save function
      // This ensures we go through the same save path as the parent
      if (!saveConfiguration) {
        throw new Error('saveConfiguration function is not defined');
      }
      const result = await saveConfiguration();
      
      // Consider it successful if result is true or undefined (void Promise that completed)
      if (result === false) {
        showToast('Failed to save configuration. Please try again.', 'error');
        return false;
      } else {
        // Show success message
        showToast(`Configuration ${configName} saved successfully`, 'success');
        return true;
      }
    } catch (error) {
      console.error('Error saving config to server:', error);
      showToast('Failed to save configuration. Please try again.', 'error');
      return false;
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
    
    // Analyze dependencies for this plugin
    const analysis = dependencyResolver.analyzeDependencies(
      draggedPlugin,
      nodes,
      config
    );
    
    // Create missing dependency nodes if needed
    const autoAddResult = dependencyResolver.createMissingDependencies(
      analysis,
      { x: dropX, y: dropY },
      nodes,
      platformMode,
      isPlatformPro
    );
    
    // Get default params with pre-filled provider/storage names
    const defaultDependencyParams = dependencyResolver.getDefaultDependencyParams(
      analysis,
      autoAddResult
    );
    
    // Create new plugin instance with the full schema from the draggedPlugin
    const newPlugin = {
      type: draggedPlugin.type,
      name: draggedPlugin.name,
      pluginName: draggedPlugin.pluginName || draggedPlugin.name,
      params: { ...defaultDependencyParams }, // Pre-fill with dependency params
      position: { x: dropX, y: dropY },
      // Include constructor interface and config schema from the original plugin definition
      constructorInterface: draggedPlugin.constructorInterface,
      configSchema: draggedPlugin.configSchema,
      description: draggedPlugin.description
    };
    
    // Store dependency analysis for use when the plugin is added
    setPendingDependencyAnalysis(analysis);
    setPendingAutoAddResult(autoAddResult);
    
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
          // Clear pending dependency state
          setPendingDependencyAnalysis(null);
          setPendingAutoAddResult(null);
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

  // Force redraw when nodes change (e.g., status updates)
  useEffect(() => {
    if (nodes.length > 0 && canvasRef.current) {
      requestAnimationFrame(() => {
        drawToBackBuffer();
        drawToScreen();
      });
    }
  }, [nodes, drawToBackBuffer, drawToScreen]);

  // Handle custom run aggregation that uses job ID
  const handleRunAggregation = async () => {
    if (!config || !config.name) {
      console.error("Cannot run aggregation without a config name");
      return;
    }
    
    try {
      // Reset all job state for a fresh run
      resetForNewRun();
      
      // Make sure websocket is disconnected to avoid stale data
      websocketService.disconnect();
      
      // If config has unsaved changes, save it first
      if (hasUnsavedChanges) {
        const shouldSave = window.confirm("The configuration has unsaved changes. Do you want to save before running?");
        if (shouldSave) {
          await handleSaveToServer();
        }
      }
      
      let jobId: string;
      
      // Use v1 API for platform mode, legacy endpoint for local mode
      if (platformMode && platformConfigId && authToken) {
        // Platform mode: Use v1 API which handles free tier AI/storage injection
        const result = await configApi.run(authToken, platformConfigId);
        jobId = result.jobId;
      } else {
        // Local mode: Use legacy /aggregate endpoint with full config
        // Get the latest config from the state manager
        const currentConfig = configStateManager.getConfig();
        
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
        
        // Extract secrets from the configuration instead of replacing them directly
        // This keeps references like "process.env.API_KEY" in the config but sends the actual values separately
        const { config: cleanConfig, secrets } = await secretManager.extractSecretsForBackend(currentConfig);
        
        // Make a direct REST API call to run the aggregation
        const response = await fetch(`${API_BASE}/aggregate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config: cleanConfig,
            secrets: secrets // Pass secrets as a separate object
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to run aggregation via REST API');
        }
        
        const result = await response.json();
        jobId = result.jobId;
      }
      
      // Set the current job ID and mark this as a run-once job
      // startJob updates refs BEFORE state to avoid race conditions
      startJob(jobId, true);
      
      // Set an initial job status immediately so the panel shows right away
      const initialJobStatus: JobStatus = {
        jobId,
        configName: config.name,
        startTime: Date.now(),
        status: 'running',
        progress: 0,
        aggregationStatus: {
          currentPhase: 'connecting',
          stats: {
            totalItemsFetched: 0,
            itemsPerSource: {}
          }
        }
      };
      setJobStatus(initialJobStatus);
      
      // Connect to the job's WebSocket for status updates
      websocketService.disconnect();
      websocketService.connectToJob(jobId);
      
      // Poll for job status updates - this provides real-time updates
      // regardless of WebSocket connectivity
      const pollForStatus = async () => {
        const maxPolls = 300; // Poll for up to 5 minutes
        let pollCount = 0;
        
        const poll = async () => {
          pollCount++;
          if (pollCount > maxPolls) return;
          
          // Check if job is still the current one
          if (currentJobIdRef.current !== jobId) return;
          
          // Check if already marked as completed
          if (completedJobsRef.current.has(jobId)) return;
          
          try {
            const status = await runApi.getJobStatus(jobId);
            
            // Always update the job status to show real-time progress
            setJobStatus(status);
            
            if (status.status === 'completed' || status.status === 'failed') {
              // Job finished - update UI
              markCompleted(jobId);
              return;
            }
          } catch (e) {
            // Job might not exist anymore or network error - ignore and continue polling
          }
          
          // Continue polling - faster while running for real-time feel
          setTimeout(poll, 500);
        };
        
        // Start polling immediately
        setTimeout(poll, 500);
      };
      
      pollForStatus();
    } catch (error) {
      console.error("Failed to run aggregation:", error);
      showToast(error instanceof Error ? error.message : "Failed to run aggregation. Please try again.", 'error');
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
        if (platformMode && platformConfigId && authToken) {
          // Platform mode: Use v1 API to stop continuous job
          await runsApi.stopContinuous(authToken, platformConfigId);
        } else if (currentJobId) {
          // Local mode: Stop the job directly using the job ID
          const response = await fetch(`${API_BASE}/job/${currentJobId}/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error('Failed to stop job');
          }
        } else {
          // Fall back to the old method if we don't have a job ID for some reason
          const response = await fetch(`${API_BASE}/aggregate/${config.name}/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error('Failed to stop aggregation');
          }
        }
        
        // Clear job-related state after stopping
        currentJobIdRef.current = null;
        setCurrentJobId(null);
        setJobStatus(null);
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
      // Reset all job state for a fresh continuous run
      resetForNewRun();
      
      // Make sure websocket is disconnected to avoid stale data
      websocketService.disconnect();
      
      // If config has unsaved changes, save it first
      if (hasUnsavedChanges) {
        const shouldSave = window.confirm("The configuration has unsaved changes. Do you want to save before running?");
        if (shouldSave) {
          await handleSaveToServer();
        }
      }
      
      let jobId: string;
      
      if (platformMode && platformConfigId && authToken) {
        // Platform mode: Use v1 API which handles configId injection for storage
        const result = await runsApi.runContinuous(authToken, platformConfigId);
        jobId = result.jobId;
      } else {
        // Local mode: Use legacy /aggregate endpoint with full config
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
        
        // Extract secrets from the configuration instead of replacing them directly
        const { config: cleanConfig, secrets } = await secretManager.extractSecretsForBackend(currentConfig);
        
        // Start the aggregation
        const response = await fetch(`${API_BASE}/aggregate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config: cleanConfig,
            secrets: secrets
          }),
        });
        
        if (!response.ok) {
          throw new Error('Failed to start aggregation');
        }
        
        const result = await response.json();
        jobId = result.jobId;
      }
      
      // Set the current job ID and mark as continuous
      // startJob updates refs BEFORE state to avoid race conditions
      startJob(jobId, false);
      
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
    currentJobIdRef.current = null;
    setCurrentJobId(null);
    setJobStatus(null);
    setIsAggregationRunning(false);
    setIsRunOnceJob(false);
    setJobStatusDisplayClosed(false);
    
    // Clear the job types map and completed jobs tracking
    jobTypesRef.current.clear();
    completedJobsRef.current.clear();
    
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

  // Expose methods to the parent component via ref
  useImperativeHandle(ref, () => ({
    handleDragPlugin
  }));

  // Add effect to ensure ConfigStateManager is synced when in JSON view
  useEffect(() => {
    if (viewMode === 'json') {
      // Make sure the ConfigStateManager has the latest state
      configStateManager.forceSync();
    }
  }, [viewMode, nodes, connections]);

  // Add event listeners for custom events
  useEffect(() => {
    // Event handler for centering the graph view
    const handleCenterGraph = () => {
      if (viewMode === 'graph') {
        centerView();
      }
    };

    // Event handler for formatting JSON
    const handleFormatJson = () => {
      if (viewMode === 'json') {
        // Find and dispatch an event to the ConfigJsonEditor's format button
        const formatJsonButton = document.querySelector('.json-editor-format-button');
        if (formatJsonButton) {
          formatJsonButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }
    };

    // Add event listeners
    window.addEventListener('centerGraph', handleCenterGraph);
    window.addEventListener('formatJson', handleFormatJson);

    // Cleanup function
    return () => {
      window.removeEventListener('centerGraph', handleCenterGraph);
      window.removeEventListener('formatJson', handleFormatJson);
    };
  }, [viewMode]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div 
        className="flex-1 flex flex-col relative transition-all duration-300 ease-in-out h-full"
      >
        <div className="absolute top-4 left-4 z-10 flex space-x-2">
          {viewMode === 'graph' && (
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
          )}
          {viewMode === 'json' && (
            <button
              onClick={() => {
                const formatJsonButton = document.querySelector('.json-editor-format-button');
                if (formatJsonButton) {
                  formatJsonButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                }
              }}
              className="w-10 h-10 bg-stone-800/90 text-amber-300 border-stone-600/50 rounded hover:bg-stone-600 focus:outline-none flex items-center justify-center border border-amber-400/30"
              title="Format JSON"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
          )}
        </div>
        <div className="absolute top-4 right-4 z-10 flex space-x-2">
          <RunControls
            isAggregationRunning={isAggregationRunning}
            onRunOnce={handleRunAggregation}
            onToggleAggregation={handleToggleAggregation}
            runOptions={runOptions}
            platformMode={platformMode}
          />
        </div>
        
        {/* Conditionally render either the graph canvas or the JSON editor based on viewMode */}
        {viewMode === 'graph' ? (
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
              <div className="absolute bottom-4 right-4 z-50 w-96">
                <JobStatusDisplay 
                  key={jobStatus.jobId}
                  jobStatus={jobStatus}
                  runMode={isRunOnceJob ? "once" : "continuous"}
                  onClose={() => setJobStatusDisplayClosed(true)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 w-full h-full">
            {/* Force synchronization before rendering the JSON editor */}
            {(() => {
              // Immediately synchronize the state
              configStateManager.forceSync();
              
              return (
                <ConfigJsonEditor 
                  config={configStateManager.getConfig()}
                  onConfigUpdate={(updatedConfig: Config) => {
                    // Prevent duplicate updates by checking if we're already in an update
                    if (preventConfigUpdateLoopRef.current) return;
                    
                    // Create a string representation for comparison
                    const updatedConfigString = JSON.stringify(updatedConfig);
                    
                    // Set the flag to prevent recursive updates
                    preventConfigUpdateLoopRef.current = true;
                    
                    try {
                      // Check if this update represents a substantive change
                      const currentConfig = configStateManager.getConfig();
                      const hasSubstantiveChanges = configStateManager.isSubstantiveChange(
                        currentConfig, updatedConfig
                      );
                      
                      // Only process meaningful changes
                      if (hasSubstantiveChanges) {
                        // Update the config via ConfigStateManager to ensure consistency
                        configStateManager.loadConfig(updatedConfig);
                        configStateManager.forceSync();
                        
                        // Update local state
                        setNodes(configStateManager.getNodes());
                        setConnections(configStateManager.getConnections());
                        
                        // Update parent
                        onConfigUpdate(updatedConfig);
                      }
                    } finally {
                      // Reset the flag after a short delay to ensure all updates have completed
                      setTimeout(() => {
                        preventConfigUpdateLoopRef.current = false;
                      }, 50); // Increase timeout to ensure all updates have time to complete
                    }
                  }}
                  saveConfig={handleSaveToServer}
                />
              );
            })()}
          </div>
        )}
      </div>
      
      {showPluginDialog && selectedPlugin && (
        <PluginParamDialog
          plugin={selectedPlugin}
          isOpen={showPluginDialog}
          onClose={() => {
            setShowPluginDialog(false);
            // Clear pending dependency state on close/cancel
            setPendingDependencyAnalysis(null);
            setPendingAutoAddResult(null);
          }}
          onAdd={handleAddPlugin}
          platformMode={platformMode}
          isPlatformPro={isPlatformPro}
        />
      )}
    </div>
  );
});
