/**
 * Node Renderer
 * 
 * Provides utilities for rendering graph nodes, connections, and related UI elements
 * in the canvas-based graph editor. Implements visual styling for different node types,
 * port connectivity, status indicators, and interactive elements.
 */

import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { shouldShowPort } from './nodeHandlers';

// Draw a connection between two nodes
export const drawConnection = (ctx: CanvasRenderingContext2D, fromNode: Node, toNode: Node, connection: Connection) => {
  // Find the actual target node if it's a child node
  let actualToNode = toNode;
  let parentOffset = { x: 0, y: 0 };
  
  if (connection.to.nodeId !== toNode.id && toNode.isParent && toNode.children) {
    // Look for the target node in children
    const childNode = toNode.children.find(child => child.id === connection.to.nodeId);
    if (childNode) {
      actualToNode = childNode;
      
      // For child nodes, we need to add the parent's position as an offset
      parentOffset = {
        x: toNode.position.x,
        y: toNode.position.y + 40 // Add header height offset
      };
    }
  }

  // Find the actual source node if it's a child node
  let actualFromNode = fromNode;
  let fromParentOffset = { x: 0, y: 0 };
  
  if (connection.from.nodeId !== fromNode.id && fromNode.isParent && fromNode.children) {
    // Look for the source node in children
    const childNode = fromNode.children.find(child => child.id === connection.from.nodeId);
    if (childNode) {
      actualFromNode = childNode;
      
      // For child nodes, we need to add the parent's position as an offset
      fromParentOffset = {
        x: fromNode.position.x,
        y: fromNode.position.y + 40 // Add header height offset
      };
    }
  }
  
  // Find the output port on the from node
  let fromPort = actualFromNode.outputs.find(output => output.name === connection.from.output);
  if (!fromPort) {
    // Try to recover by using the first available output port
    if (actualFromNode.outputs.length > 0) {
      fromPort = actualFromNode.outputs[0];
    } else {
      return; // Exit without drawing
    }
  }
  
  // Find the input port on the to node
  let toPort = actualToNode.inputs.find(input => input.name === connection.to.input);
  if (!toPort) {
    // Try to recover by using the first available input port
    if (actualToNode.inputs.length > 0) {
      toPort = actualToNode.inputs[0];
    } else {
      return; // Exit without drawing
    }
  }
  
  // Calculate port positions (relative to node position)
  const fromPortIndex = actualFromNode.outputs.indexOf(fromPort);
  const toPortIndex = actualToNode.inputs.indexOf(toPort);
  
  // If either port index is -1, it means we didn't find the port
  if (fromPortIndex === -1 || toPortIndex === -1) {
    return; // Exit without drawing
  }

  // Validate that both ports should be shown on their respective nodes
  if (!shouldShowPort(actualFromNode, fromPort.name, false)) {
    return; // Skip drawing this connection
  }
  
  if (!shouldShowPort(actualToNode, toPort.name, true)) {
    return; // Skip drawing this connection
  }

  // Calculate actual coordinates including parent offsets
  const nodeWidth = 200; // Standard width of nodes
  const portOffsetY = 25; // Y offset of first port from node top
  const portSpacing = 20; // Spacing between ports
  
  // Calculate the positions including parent offsets
  const startX = (actualFromNode.position.x + fromParentOffset.x) + nodeWidth; // right side of from node
  const startY = (actualFromNode.position.y + fromParentOffset.y) + portOffsetY + (fromPortIndex * portSpacing);
  const endX = (actualToNode.position.x + parentOffset.x); // left side of to node
  const endY = (actualToNode.position.y + parentOffset.y) + portOffsetY + (toPortIndex * portSpacing);
  
  // Use the port type to determine the connection color
  const portType = fromPort.type || 'default';
  drawConnectionLine(ctx, startX, startY, endX, endY, portType);
};

// Draw a temporary connection line
export const drawConnectionLine = (
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  portType: string
) => {
  // Set color based on port type
  ctx.strokeStyle = getPortColorByType(portType, true);
  
  // Use thicker lines
  ctx.lineWidth = 3;
  
  // Draw connection line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  // Create a curved path with better control points
  const distance = Math.abs(endX - startX);
  const curvature = Math.min(distance * 0.5, 100); // Limit the curvature
  
  const controlPoint1X = startX + curvature;
  const controlPoint1Y = startY;
  const controlPoint2X = endX - curvature;
  const controlPoint2Y = endY;
  
  ctx.bezierCurveTo(
    controlPoint1X, controlPoint1Y,
    controlPoint2X, controlPoint2Y,
    endX, endY
  );
  
  ctx.stroke();
  
  // Draw arrow with the same strokeStyle
  const arrowSize = 12; // Larger arrow
  const angle = Math.atan2(endY - controlPoint2Y, endX - controlPoint2X);
  
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
};

// Helper function to check if node has missing required connections
const hasMissingRequiredConnections = (node: Node): boolean => {
  if (node.isParent) return false;
  
  // Check for required provider and storage connections
  if (node.params) {
    if ('provider' in node.params && node.params.provider) {
      const providerInput = node.inputs.find(input => input.name === 'provider');
      if (providerInput && !providerInput.connectedTo) return true;
    }
    
    if ('storage' in node.params && node.params.storage) {
      const storageInput = node.inputs.find(input => input.name === 'storage');
      if (storageInput && !storageInput.connectedTo) return true;
    }
  }
  
  return false;
};

// Draw status popup when hovering over status indicators
const drawStatusPopup = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  iconX: number,
  iconY: number,
  iconRadius: number,
  nodeWidth: number,
  nodeHeight: number,
  mousePosition: { x: number; y: number } | null
) => {
  if (!mousePosition || !node.id?.startsWith('source')) return;
  
  const distToIcon = Math.sqrt(
    Math.pow(mousePosition.x - iconX, 2) + 
    Math.pow(mousePosition.y - iconY, 2)
  );
  
  // Only show popup if hovering near the icon
  if (distToIcon <= iconRadius * 1.8) {
    let iconColor = '#57534e'; // Default gray
    
    switch (node.status) {
      case 'running': iconColor = '#f59e0b'; break; // Amber
      case 'success': iconColor = '#22c55e'; break; // Green
      case 'failed': iconColor = '#ef4444'; break; // Red
    }
    
    const popupWidth = 240;
    const popupHeight = node.statusMessage ? 100 : 70;
    
    // Position popup, adjusting if near screen edge
    let popupX = node.position.x;
    let popupY = node.position.y - popupHeight - 15;
    
    if (popupY < 10) {
      popupY = node.position.y + nodeHeight + 15;
    }
    
    // Draw popup
    ctx.save();
    
    // Background
    ctx.beginPath();
    ctx.roundRect(popupX, popupY, popupWidth, popupHeight, 10);
    ctx.fillStyle = 'rgba(15, 15, 15, 0.97)';
    ctx.fill();
    
    // Border
    ctx.strokeStyle = iconColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Title text
    let title = 'Status: Unknown';
    switch (node.status) {
      case 'running': title = 'Status: Running'; break;
      case 'success': title = 'Status: Success'; break;
      case 'failed': title = 'Status: Failed'; break;
    }
    
    ctx.fillText(title, popupX + popupWidth / 2, popupY + 10);
    
    // Status message if available
    if (node.statusMessage) {
      ctx.fillStyle = '#d1d5db';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      
      // Wrap text
      const maxWidth = popupWidth - 20;
      const words = node.statusMessage.split(' ');
      let line = '';
      let y = popupY + 30;
      
      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && i > 0) {
          ctx.fillText(line, popupX + popupWidth / 2, y);
          line = words[i] + ' ';
          y += 16;
        } else {
          line = testLine;
        }
      }
      
      ctx.fillText(line, popupX + popupWidth / 2, y);
    }
    
    // Status data for successful sources
    if (node.status === 'success' && node.statusData) {
      ctx.fillStyle = '#86efac'; // Light green
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      
      const dataCount = typeof node.statusData === 'number' ? 
                     node.statusData : 
                     (node.statusData?.count || 0);
      
      const itemText = `Fetched ${dataCount} item${dataCount !== 1 ? 's' : ''}`;
      ctx.fillText(itemText, popupX + popupWidth / 2, popupY + 50);
    }
    
    ctx.restore();
  }
};

// Helper function to determine port color based on type and connection status
const getPortColorByType = (type: string, isConnected: boolean | string | undefined): string => {
  // Ensure isConnected is treated as a boolean
  const connected = !!isConnected;
  
  if (type === 'provider') {
    return connected ? '#d97706' : '#f59e0b'; // Darker yellow for provider connections
  } else if (type === 'storage') {
    return connected ? '#fbbf24' : '#fcd34d'; // Lighter amber for storage connections
  } else if (type === 'data') {
    return connected ? '#f59e0b' : '#fcd34d'; // Yellow amber for data connections
  }
  return '#666'; // Default gray color
};

// Helper function to draw a port
const drawPort = (
  ctx: CanvasRenderingContext2D,
  x: number, 
  y: number, 
  portType: string,
  isConnected: boolean | string | undefined,
  isHovered: boolean,
  isParent: boolean,
  label: string,
  isOutput: boolean
) => {
  // Draw hover effect if needed
  if (isHovered) {
    // Draw outer glow effect
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
    ctx.fill();
    
    // Draw inner glow effect
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
    ctx.fill();
  }
  
  // Get port color based on type and connection
  const portColor = getPortColorByType(portType, isConnected);
  
  // Port background size (slightly larger for parent nodes)
  const radius = isParent ? 7 : 6;
  
  // Draw port background
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#292524'; // Dark background
  ctx.fill();
  
  // Draw port border with correct style
  ctx.strokeStyle = isHovered ? '#fbbf24' : portColor;
  ctx.lineWidth = isHovered ? 3 : (isParent ? 2.5 : 2);
  ctx.stroke();
  
  // Draw port label
  ctx.fillStyle = isHovered ? '#fbbf24' : (isParent ? '#d1d5db' : '#9ca3af');
  ctx.font = '12px sans-serif';
  ctx.textAlign = isOutput ? 'left' : 'right';
  ctx.fillText(label, x + (isOutput ? 8 : -8), y + 4);
};

// Draw a node
export const drawNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  hoveredPort: PortInfo | null,
  selectedNode: string | null,
  mousePosition: { x: number; y: number } | null = null,
  skipStatusPopups: boolean = false
) => {
  const nodeWidth = 200;
  
  // Save canvas state
  ctx.save();

  // Calculate node height based on type and children
  const nodeHeight = node.isParent ? 
    (node.expanded && node.children && node.children.length > 0 ? 80 : 50) : 
    50;
    
  // Draw node background
  ctx.beginPath();
  ctx.roundRect(
    node.position.x,
    node.position.y,
    nodeWidth,
    nodeHeight,
    8
  );
  
  // Set node background color based on its status if it's not a parent node
  if (node.status && !node.isParent) {
    // Status-based colors - using more vibrant colors
    switch (node.status) {
      case 'running':
        // Brighter amber/yellow color for running nodes
        ctx.fillStyle = selectedNode === node.id ? '#d97706' : '#f59e0b';
        break;
      case 'success':
        // Brighter green color for successful nodes
        ctx.fillStyle = selectedNode === node.id ? '#16a34a' : '#22c55e';
        break;
      case 'failed':
        // Brighter red color for failed nodes
        ctx.fillStyle = selectedNode === node.id ? '#b91c1c' : '#ef4444';
        break;
      default:
        // Default colors based on node type (same as before)
        if (node.type === 'ai' || (node.isProvider === true)) {
          ctx.fillStyle = selectedNode === node.id ? '#854d0e' : '#713f12'; // Darker yellow for providers
        } else if (node.type === 'storage') {
          ctx.fillStyle = selectedNode === node.id ? '#92400e' : '#b45309'; // Lighter amber/yellow for storage
        } else {
          // Regular nodes
          ctx.fillStyle = selectedNode === node.id ? '#44403c' : '#292524'; // Dark color
        }
    }
  } else {
    // Use darker shades for parent nodes to visually differentiate them
    if (node.isParent) {
      // Use very dark solid color for parent nodes
      ctx.fillStyle = selectedNode === node.id ? '#0c0a09' : '#0a0908'; // Almost black background for parent nodes
    } else if (node.type === 'ai' || (node.isProvider === true)) {
      // Special color for provider nodes that matches connection line color - now darker yellow
      ctx.fillStyle = selectedNode === node.id ? '#854d0e' : '#713f12'; // Darker yellow for providers
    } else if (node.type === 'storage') {
      // Special color for storage nodes that matches storage connection line color - now using lighter amber
      ctx.fillStyle = selectedNode === node.id ? '#92400e' : '#b45309'; // Lighter amber/yellow for storage
    } else {
      // Solid color for child nodes instead of gradient
      ctx.fillStyle = selectedNode === node.id ? '#44403c' : '#292524'; // Dark color
    }
  }
  
  // Draw background
  ctx.fill();
  
  // Draw glowing effect for running nodes with increased glow
  if (node.status === 'running' && !node.isParent) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(
      node.position.x,
      node.position.y,
      nodeWidth,
      nodeHeight,
      8
    );
    ctx.strokeStyle = '#f59e0b'; // Brighter amber glow
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 15; // Increased blur
    ctx.lineWidth = 3; // Thicker line
    ctx.stroke();
    ctx.restore();
  }
  
  // Draw a thin border for the node
  ctx.beginPath();
  ctx.roundRect(
    node.position.x,
    node.position.y,
    nodeWidth,
    nodeHeight,
    8
  );
  
  // Determine border color 
  if (selectedNode === node.id) {
    // Always use a bright amber for selected nodes
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
  } else {
    // Use normal borders based on status
    if (node.status === 'running') {
      ctx.strokeStyle = '#f59e0b'; // Brighter yellow border for running
      ctx.lineWidth = 2;
    } else if (node.status === 'success') {
      ctx.strokeStyle = '#22c55e'; // Brighter green border for success
      ctx.lineWidth = 2;
    } else if (node.status === 'failed') {
      ctx.strokeStyle = '#ef4444'; // Brighter red border for failed
      ctx.lineWidth = 2;
    } else {
      // Standard border for normal nodes
      ctx.strokeStyle = '#57534e';
      ctx.lineWidth = 1;
    }
  }
  ctx.stroke();

  // Node title
  ctx.fillStyle = node.isParent ? '#fcd34d' : '#fcd34d'; // Brighter color for parent nodes
  ctx.font = node.isParent ? 'bold 14px sans-serif' : '14px sans-serif'; // Bold text for parent nodes
  ctx.textAlign = 'center';
  ctx.fillText(node.name, node.position.x + nodeWidth / 2, node.position.y + 20);
  
  // Add status indicator icon for any node with a status
  if (!node.isParent && node.status) {
    // Show status indicators for all node types, not just source nodes
    
    // Define the status icon position - more prominently positioned at top left corner
    const iconX = node.position.x + 20; // Left side position instead of right
    const iconY = node.position.y + 15;
    const iconRadius = 12; // Even larger size
    
    // Set icon color based on status - using bolder colors
    let iconColor = '#57534e'; // Default gray
    
    switch (node.status) {
      case 'running':
        iconColor = '#f59e0b'; // Bright amber for running
        break;
      case 'success':
        iconColor = '#22c55e'; // Bright green for success
        break;
      case 'failed':
        iconColor = '#ef4444'; // Bright red for failed
        break;
    }
    
    // Draw larger status indicator with glow
    ctx.save(); // Save context before applying shadow
    
    // Add glow effect
    ctx.shadowColor = iconColor;
    ctx.shadowBlur = 10;
    
    // Draw status icon with border
    ctx.beginPath();
    ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
    ctx.fillStyle = iconColor;
    ctx.fill();
    
    ctx.restore(); // Restore context to remove shadow
    
    // Add information icon (lowercase "i") instead of status initial
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px serif'; // Use serif font for more recognizable info icon
    ctx.textAlign = 'center';
    
    // Add status letter for clarity
    let statusLetter = '?';
    switch (node.status) {
      case 'running':
        statusLetter = 'R';
        break;
      case 'success':
        statusLetter = 'S';
        break;
      case 'failed':
        statusLetter = 'F';
        break;
    }
    ctx.fillText(statusLetter, iconX, iconY + 5);
    
    // Save status popup info for later drawing if not skipping popups
    if (!skipStatusPopups && mousePosition) {
      // Check if mouse is hovering over the status icon
      const dx = mousePosition.x - iconX;
      const dy = mousePosition.y - iconY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= iconRadius) {
        // Direct call to draw status popup if hovering over status icon
        if (!skipStatusPopups) {
          drawStatusPopup(ctx, node, iconX, iconY, iconRadius, nodeWidth, nodeHeight, mousePosition);
        }
      }
    }
  }
  
  // For source nodes, display a small indicator for successful data count
  if (node.id?.startsWith('source') && !node.isParent && node.status === 'success' && node.statusData) {
    // Subtle data count indicator at bottom of node
    const dataCount = typeof node.statusData === 'number' ? 
                     node.statusData : 
                     (node.statusData?.count || 0);
    
    if (dataCount > 0) {
      ctx.fillStyle = '#16a34a'; // Green background
      ctx.beginPath();
      ctx.roundRect(
        node.position.x + nodeWidth / 2 - 20,
        node.position.y + nodeHeight - 8,
        40,
        6,
        3
      );
      ctx.fill();
    }
  }
  
  // Show small warning indicator for failed nodes
  if (!node.isParent && node.status === 'failed') {
    // Draw error icon at bottom of node
    ctx.fillStyle = '#b91c1c'; // Red background
    ctx.beginPath();
    ctx.roundRect(
      node.position.x + nodeWidth / 2 - 20,
      node.position.y + nodeHeight - 8,
      40,
      6,
      3
    );
    ctx.fill();
  }
  
  // Add warning indicator for nodes with missing required connections
  if (hasMissingRequiredConnections(node)) {
    ctx.beginPath();
    ctx.arc(node.position.x + 15, node.position.y + 15, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626'; // Red warning indicator
    ctx.fill();
    
    // Add exclamation mark
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', node.position.x + 15, node.position.y + 15);
  }

  // Handle parent nodes with special attention for their input ports
  if (node.isParent) {
    // Draw parent node input ports at the top
    node.inputs.forEach((input, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x, portY, input.type, input.connectedTo, isHovered, true, input.name, false);
    });
    
    // Also draw parent output ports
    node.outputs.forEach((output, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, output.name, false)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x + nodeWidth, portY, output.type, output.connectedTo, isHovered, true, output.name, true);
    });
  }
  else if (node.type === 'provider' && node.isProvider) {
    // For provider nodes, only draw the provider output port on the right
    const output = node.outputs[0];
    const portY = node.position.y + 25;
    
    // Port border and hover effect
    const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
    
    drawPort(ctx, node.position.x + nodeWidth, portY, 'provider', output.connectedTo, isHovered, false, output.name, true);
  } else if (!node.isParent) {
    // For all other non-parent nodes, draw their input and output ports
    node.inputs.forEach((input, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x, portY, input.type, input.connectedTo, isHovered, false, input.name, false);
    });

    // Check if this is a child node of a parent - child nodes shouldn't have output ports
    const shouldDrawOutputs = node.type === 'storage' || node.type === 'ai' || node.isProvider ||
                           !(node.id && (node.id.includes('source-') || node.id.includes('enricher-') || 
                             node.id.includes('generator-')));

    // Only draw output ports if needed
    if (shouldDrawOutputs) {
      node.outputs.forEach((output, index) => {
        // Only draw if this port should be shown for this node type
        if (!shouldShowPort(node, output.name, false)) return;
        
        const portY = node.position.y + 25 + index * 20;
        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
        
        drawPort(ctx, node.position.x + nodeWidth, portY, output.type, output.connectedTo, isHovered, false, output.name, true);
      });
    }
  }

  // Draw child nodes if parent is expanded and has children
  if (node.isParent && node.expanded && node.children && node.children.length > 0) {
    // Draw the child nodes recursively
    node.children.forEach((child) => {
      drawNode(ctx, child, scale, hoveredPort, selectedNode, mousePosition, skipStatusPopups);
    });
  }

  // Restore canvas state
  ctx.restore();
};

// Draw the grid
export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  offset: { x: number, y: number }
) => {
  // Use subtle yellow amber grid color
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)'; // Subtle yellow amber color
  ctx.lineWidth = 1 / scale; // Adjust line width for zoom
  const gridSize = 20;
  
  // Calculate grid boundaries to cover the entire visible area
  const startX = -offset.x / scale;
  const startY = -offset.y / scale;
  const endX = (canvasWidth - offset.x) / scale;
  const endY = (canvasHeight - offset.y) / scale;
  
  // Draw vertical lines
  for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  
  // Draw horizontal lines
  for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }
}; 