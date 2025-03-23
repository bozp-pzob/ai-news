import React, { useRef, useEffect, useCallback } from 'react';
import { Config } from '../types';
import { PluginParamDialog } from './PluginParamDialog';
import { ConfigDialog } from './ConfigDialog';
import { useNodeGraph } from '../hooks/useNodeGraph';
import { drawConnection, drawConnectionLine, drawNode, drawGrid } from '../utils/nodeRenderer';
import { findPortAtCoordinates, isPointInNode, removeNodeConnection, handleNodeConnection, findNodeAtCoordinates, findNodeRecursive, isPointInCollapseButton } from '../utils/nodeHandlers';
import { Node, Connection, PortInfo } from '../types/nodeTypes';

interface NodeGraphProps {
  config: Config;
  onConfigUpdate: (config: Config) => void;
}

export const NodeGraph: React.FC<NodeGraphProps> = ({ config, onConfigUpdate }) => {
  const {
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
  } = useNodeGraph({ config, onConfigUpdate });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Add lastClickTime for tracking double clicks
  const lastClickTimeRef = useRef<number>(0);

  // Create wheel event handler with useCallback
  const wheelHandler = useCallback((e: WheelEvent) => {
    e.preventDefault();
    handleWheel(e as unknown as React.WheelEvent<HTMLCanvasElement>);
  }, [handleWheel]);

  // Handle panning
  const handlePanStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handlePanMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPanning) return;

    // Calculate the movement in screen coordinates
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;

    // Apply the movement directly to the offset
    const newOffsetX = offset.x + dx;
    const newOffsetY = offset.y + dy;
    
    // Update immediately
    setOffset({ x: newOffsetX, y: newOffsetY });
    
    // Update pan start
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  // Update canvas size when container size changes
  useEffect(() => {
    const updateCanvasSize = () => {
      if (canvasRef.current && containerRef.current) {
        const container = containerRef.current;
        canvasRef.current.width = container.clientWidth;
        canvasRef.current.height = container.clientHeight;
      }
    };

    // Add wheel event listener with passive: false
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('wheel', wheelHandler, { passive: false });
    }

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => {
      window.removeEventListener('resize', updateCanvasSize);
      if (canvas) {
        canvas.removeEventListener('wheel', wheelHandler);
      }
    };
  }, [wheelHandler]);

  // Convert config to nodes
  useEffect(() => {
    // Only center the view once when the initial config is loaded
    if (nodes.length > 0 && canvasRef.current) {
      centerView(canvasRef.current.width, canvasRef.current.height);
    }
  }, [nodes.length]); // Only run when nodes count changes (initial load)

  // Draw nodes and connections
  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    
    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Save canvas state for transformations
    ctx.save();
    
    // Apply zoom and pan
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    
    // Draw grid
    drawGrid(ctx, canvasElement.width, canvasElement.height, scale, offset);
    
    // Draw connections
    connections.forEach(connection => {
      const fromNode = findNodeRecursive(nodes, connection.from.nodeId);
      const toNode = findNodeRecursive(nodes, connection.to.nodeId);
      
      if (fromNode && toNode) {
        try {
          drawConnection(ctx, fromNode, toNode, connection);
        } catch (error) {
          console.error("Error drawing connection:", error, connection);
        }
      }
    });
    
    // Draw nodes
    nodes.forEach(node => {
      drawNode(ctx, node, scale, hoveredPort, selectedNode);
    });
    
    // Draw connection line if currently connecting
    if (connectingFrom && mousePosition) {
      const fromNode = findNodeRecursive(nodes, connectingFrom.nodeId);
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
  }, [nodes, connections, selectedNode, scale, offset, hoveredPort, connectingFrom, mousePosition, findNodeById]);

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
      let parentNode = null;
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
      
      // Map the node type to the config to get actual params if they exist
      let params = actualNode.params || {};
      
      // For child nodes, get the params from the parent node in the config
      if (isChild && parentNode) {
        const parentType = parentNode.type;
        const parentIndex = parseInt(parentNode.id.split('-')[1]);
        
        // Get the child index within the parent
        const childIndex = parentNode.children?.findIndex(child => child.id === actualNode.id) || 0;
        
        if (config) {
          switch (parentType) {
            case 'source':
            case 'sources':
              if (config.sources && config.sources[parentIndex] && 
                  config.sources[parentIndex].params && config.sources[parentIndex].params.children) {
                params = config.sources[parentIndex].params.children[childIndex] || {};
              }
              break;
            case 'enricher':
            case 'enrichers':
              if (config.enrichers && config.enrichers[parentIndex] && 
                  config.enrichers[parentIndex].params && config.enrichers[parentIndex].params.children) {
                params = config.enrichers[parentIndex].params.children[childIndex] || {};
              }
              break;
            case 'generator':
            case 'generators':
              if (config.generators && config.generators[parentIndex] && 
                  config.generators[parentIndex].params && config.generators[parentIndex].params.children) {
                params = config.generators[parentIndex].params.children[childIndex] || {};
              }
              break;
          }
        }
      }
      // For regular nodes, get params directly from the config
      else if (config) {
        switch (nodeType) {
          case 'source':
          case 'sources':
            if (config.sources && config.sources[nodeIndex]) {
              params = config.sources[nodeIndex].params || {};
            }
            break;
          case 'enricher':
          case 'enrichers':
            if (config.enrichers && config.enrichers[nodeIndex]) {
              params = config.enrichers[nodeIndex].params || {};
            }
            break;
          case 'generator':
          case 'generators':
            if (config.generators && config.generators[nodeIndex]) {
              params = config.generators[nodeIndex].params || {};
            }
            break;
          case 'ai':
            if (config.ai && config.ai[nodeIndex]) {
              params = config.ai[nodeIndex].params || {};
            }
            break;
          case 'storage':
            if (config.storage && config.storage[nodeIndex]) {
              params = config.storage[nodeIndex].params || {};
            }
            break;
        }
      }
      
      // Create plugin info structure based on node type
      let plugin: any = {
        name: actualNode.name,
        params: params,
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
              // Remove the connection
              const [updatedNodes, updatedConnections] = removeNodeConnection(
                nodes,
                connectionToRemove
              );
              
              setNodes(updatedNodes);
              setConnections(updatedConnections);
            }
          }
        }
      }
      return;
    }

    // Check if clicking on a collapse button
    for (const node of nodes) {
      if (node.isParent && isPointInCollapseButton(x, y, node)) {
        // Toggle the expanded state
        const updatedNodes = nodes.map(n => {
          if (n.id === node.id) {
            return { ...n, expanded: !n.expanded };
          }
          return n;
        });
        setNodes(updatedNodes);
        return;
      }
    }

    // Check if clicking on a node
    const clickedNode = findNodeAtCoordinates(x, y, nodes);
    if (clickedNode) {
      setSelectedNode(clickedNode.id);
      setIsDragging(true);
      // Store the mouse position in canvas coordinates
      setDragStart({ x, y });
      return;
    }

    // Otherwise, start panning
    handlePanStart(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Update mouse position
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const canvasRect = canvasElement.getBoundingClientRect();
    const { x: mouseX, y: mouseY } = screenToCanvas(e.clientX, e.clientY, canvasRect);
    setMousePosition({ x: mouseX, y: mouseY });

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
      let parentNode : any = null;
      
      // Check if this is a child node
      if (!selectedNodeObj.isParent) {
        parentNode = nodes.find(n => 
          n.isParent && n.children && n.children.some(child => child.id === selectedNode)
        );
        isChild = !!parentNode;
      }

      // Create a new array of nodes with updated positions
      const updatedNodes = nodes.map(node => {
        // Case 1: This is the selected node
        if (node.id === selectedNode) {
          // Update node position
          const updatedNode = {
            ...node,
            position: { 
              x: node.position.x + dx, 
              y: node.position.y + dy 
            }
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
      
      // Update the nodes state
      setNodes(updatedNodes);
      
      // Update dragStart to the current position
      setDragStart(currentPos);
    }

    // Check for port hover
    const portInfo = findPortAtCoordinates(mouseX, mouseY, nodes);
    setHoveredPort(portInfo);
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
            
            // Use the handleNodeConnection function that properly handles child nodes
            const result = handleNodeConnection(
              nodes,
              newConnection,
              config,
              onConfigUpdate
            );
            
            if (result) {
              const [newNodes, newConnections, newConfig] = result;
              setNodes(newNodes);
              setConnections(newConnections);
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
    setSelectedNode(null);
  };

  // Trigger center view function
  const handleCenterView = () => {
    if (canvasRef.current) {
      centerView(canvasRef.current.width, canvasRef.current.height);
    }
  };

  // Handle adding/editing a plugin
  const handleAddPlugin = (updatedPlugin: any, interval?: number) => {
    handlePluginSave(updatedPlugin);
    setShowPluginDialog(false);
    setSelectedPlugin(null);
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div ref={containerRef} className="flex-1 relative w-full h-full">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ 
            width: '100%', 
            height: '100%', 
            cursor: isPanning ? 'grabbing' : hoveredPort ? 'pointer' : 'default' 
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <button
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          onClick={handleCenterView}
        >
          Center View
        </button>
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