/**
 * Node Renderer
 * 
 * Provides utilities for rendering graph nodes, connections, and related UI elements
 * in the canvas-based graph editor. Implements visual styling for different node types,
 * port connectivity, status indicators, and interactive elements.
 * 
 * Design: Minimal outline style with circuit-diagram connections
 */

import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { shouldShowPort } from './nodeHandlers';

// ============================================================================
// DESIGN CONSTANTS
// ============================================================================

// Color palette - refined amber theme
const COLORS = {
  // Backgrounds - differentiated by node type
  nodeBg: '#0c0c0c',
  nodeBgAi: '#1c1408',        // Dark amber tint for AI providers
  nodeBgStorage: '#0c1416',   // Dark cyan tint for storage
  nodeBgParent: '#0a0908',    // Almost black for parent groups
  
  // Borders
  borderDefault: '#44403c',
  borderSelected: '#f59e0b',
  borderHover: '#78716c',
  borderAi: '#92400e',        // Amber border for AI
  borderStorage: '#155e75',   // Cyan border for storage
  
  // Text
  textPrimary: '#e5e5e5',
  textSecondary: '#a8a29e',
  textSelected: '#fbbf24',
  
  // Port colors by type
  portProvider: '#f59e0b',  // Amber
  portStorage: '#06b6d4',   // Cyan
  portData: '#a8a29e',      // Stone/gray
  
  // Status colors
  statusRunning: '#f59e0b',
  statusSuccess: '#22c55e',
  statusFailed: '#ef4444',
  statusIdle: '#57534e',
  
  // Grid
  gridDot: 'rgba(68, 64, 60, 0.4)',
  
  // Shadows
  shadowDefault: 'rgba(0, 0, 0, 0.4)',
  shadowSelected: 'rgba(245, 158, 11, 0.15)',
};

// Dimensions
const NODE_WIDTH = 200;
const NODE_HEIGHT_MIN = 50;
const NODE_HEADER_HEIGHT = 30;  // Space for title
const NODE_RADIUS = 6;
const PORT_RADIUS = 5;
const PORT_RING_WIDTH = 2;
const PORT_OFFSET_Y = 25;
const PORT_SPACING = 20;
const NODE_PADDING_BOTTOM = 12;  // Padding below last port
const CONNECTION_LINE_WIDTH = 1.5;
const CIRCUIT_CORNER_RADIUS = 8;
const MIN_HORIZONTAL_EXIT = 40;

// ============================================================================
// NODE HEIGHT CALCULATION
// ============================================================================

/**
 * Calculate the height of a node based on visible ports
 */
const calculateNodeHeight = (node: Node): number => {
  if (node.isParent) {
    return node.expanded && node.children && node.children.length > 0 ? 80 : 50;
  }
  
  // Count visible input ports
  let visibleInputs = 0;
  if (node.inputs) {
    for (const input of node.inputs) {
      if (shouldShowPort(node, input.name, true)) {
        visibleInputs++;
      }
    }
  }
  
  // Count visible output ports
  let visibleOutputs = 0;
  if (node.outputs) {
    // Check if this node type should show outputs
    const shouldDrawOutputs = node.type === 'storage' || node.type === 'ai' || node.isProvider ||
                             !(node.id && (node.id.includes('source-') || node.id.includes('enricher-') || 
                               node.id.includes('generator-')));
    
    if (shouldDrawOutputs) {
      for (const output of node.outputs) {
        if (shouldShowPort(node, output.name, false)) {
          visibleOutputs++;
        }
      }
    }
  }
  
  // Use the maximum of inputs or outputs to determine height
  const maxPorts = Math.max(visibleInputs, visibleOutputs);
  
  // Calculate height: header + ports + padding
  if (maxPorts === 0) {
    return NODE_HEIGHT_MIN;
  }
  
  const portsHeight = PORT_OFFSET_Y + (maxPorts - 1) * PORT_SPACING + NODE_PADDING_BOTTOM;
  return Math.max(NODE_HEIGHT_MIN, portsHeight);
};

// ============================================================================
// PORT COLOR HELPERS
// ============================================================================

/**
 * Get port color based on type
 */
const getPortColor = (type: string): string => {
  switch (type) {
    case 'provider':
      return COLORS.portProvider;
    case 'storage':
      return COLORS.portStorage;
    case 'data':
    default:
      return COLORS.portData;
  }
};

/**
 * Legacy helper for compatibility
 */
const getPortColorByType = (type: string, isConnected: boolean | string | undefined): string => {
  return getPortColor(type);
};

// ============================================================================
// CONNECTION DRAWING - CIRCUIT DIAGRAM STYLE
// ============================================================================

/**
 * Draw a circuit-diagram style connection line with rounded corners
 */
export const drawConnectionLine = (
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  portType: string
) => {
  const color = getPortColor(portType);
  ctx.strokeStyle = color;
  ctx.lineWidth = CONNECTION_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Calculate routing
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  
  // If target is to the left of source, we need a more complex route
  const goingBackward = deltaX < MIN_HORIZONTAL_EXIT * 2;
  
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  if (goingBackward) {
    // Complex routing: go right, down/up, left, then to target
    const exitX = startX + MIN_HORIZONTAL_EXIT;
    const midY = startY + (deltaY > 0 ? 50 : -50);
    const entryX = endX - MIN_HORIZONTAL_EXIT;
    
    // Horizontal exit from start
    ctx.lineTo(exitX - CIRCUIT_CORNER_RADIUS, startY);
    
    // Corner down/up
    ctx.arcTo(exitX, startY, exitX, startY + (deltaY > 0 ? CIRCUIT_CORNER_RADIUS : -CIRCUIT_CORNER_RADIUS), CIRCUIT_CORNER_RADIUS);
    
    // Vertical to mid
    ctx.lineTo(exitX, midY - (deltaY > 0 ? CIRCUIT_CORNER_RADIUS : -CIRCUIT_CORNER_RADIUS));
    
    // Corner to go left
    ctx.arcTo(exitX, midY, exitX - CIRCUIT_CORNER_RADIUS, midY, CIRCUIT_CORNER_RADIUS);
    
    // Horizontal across
    ctx.lineTo(entryX + CIRCUIT_CORNER_RADIUS, midY);
    
    // Corner to go down/up to target
    ctx.arcTo(entryX, midY, entryX, midY + (endY > midY ? CIRCUIT_CORNER_RADIUS : -CIRCUIT_CORNER_RADIUS), CIRCUIT_CORNER_RADIUS);
    
    // Vertical to target Y
    ctx.lineTo(entryX, endY - (endY > midY ? CIRCUIT_CORNER_RADIUS : -CIRCUIT_CORNER_RADIUS));
    
    // Corner to target
    ctx.arcTo(entryX, endY, entryX + CIRCUIT_CORNER_RADIUS, endY, CIRCUIT_CORNER_RADIUS);
    
    // Final horizontal to target
    ctx.lineTo(endX, endY);
  } else {
    // Simple routing: horizontal, vertical, horizontal
    const midX = startX + Math.max(MIN_HORIZONTAL_EXIT, deltaX / 2);
    
    // Horizontal from start
    ctx.lineTo(midX - CIRCUIT_CORNER_RADIUS, startY);
    
    // First corner
    if (Math.abs(deltaY) > CIRCUIT_CORNER_RADIUS * 2) {
      const cornerDir = deltaY > 0 ? 1 : -1;
      ctx.arcTo(midX, startY, midX, startY + CIRCUIT_CORNER_RADIUS * cornerDir, CIRCUIT_CORNER_RADIUS);
      
      // Vertical segment
      ctx.lineTo(midX, endY - CIRCUIT_CORNER_RADIUS * cornerDir);
      
      // Second corner
      ctx.arcTo(midX, endY, midX + CIRCUIT_CORNER_RADIUS, endY, CIRCUIT_CORNER_RADIUS);
    } else {
      // Nearly straight line, minimal corners
      ctx.lineTo(midX, startY);
      ctx.lineTo(midX, endY);
    }
    
    // Horizontal to end
    ctx.lineTo(endX, endY);
  }
  
  ctx.stroke();
  
  // Draw small chevron arrow at the end
  const arrowSize = 6;
  ctx.beginPath();
  ctx.moveTo(endX - arrowSize, endY - arrowSize / 2);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX - arrowSize, endY + arrowSize / 2);
  ctx.stroke();
};

/**
 * Draw a connection between two nodes
 */
export const drawConnection = (ctx: CanvasRenderingContext2D, fromNode: Node, toNode: Node, connection: Connection) => {
  // Find the actual target node if it's a child node
  let actualToNode = toNode;
  let parentOffset = { x: 0, y: 0 };
  
  if (connection.to.nodeId !== toNode.id && toNode.isParent && toNode.children) {
    const childNode = toNode.children.find(child => child.id === connection.to.nodeId);
    if (childNode) {
      actualToNode = childNode;
      parentOffset = {
        x: toNode.position.x,
        y: toNode.position.y + 40
      };
    }
  }

  // Find the actual source node if it's a child node
  let actualFromNode = fromNode;
  let fromParentOffset = { x: 0, y: 0 };
  
  if (connection.from.nodeId !== fromNode.id && fromNode.isParent && fromNode.children) {
    const childNode = fromNode.children.find(child => child.id === connection.from.nodeId);
    if (childNode) {
      actualFromNode = childNode;
      fromParentOffset = {
        x: fromNode.position.x,
        y: fromNode.position.y + 40
      };
    }
  }
  
  // Find ports
  let fromPort = actualFromNode.outputs.find(output => output.name === connection.from.output);
  if (!fromPort && actualFromNode.outputs.length > 0) {
    fromPort = actualFromNode.outputs[0];
  }
  if (!fromPort) return;
  
  let toPort = actualToNode.inputs.find(input => input.name === connection.to.input);
  if (!toPort && actualToNode.inputs.length > 0) {
    toPort = actualToNode.inputs[0];
  }
  if (!toPort) return;
  
  // Calculate port indices
  const fromPortIndex = actualFromNode.outputs.indexOf(fromPort);
  const toPortIndex = actualToNode.inputs.indexOf(toPort);
  
  if (fromPortIndex === -1 || toPortIndex === -1) return;

  // Validate ports should be shown
  if (!shouldShowPort(actualFromNode, fromPort.name, false)) return;
  if (!shouldShowPort(actualToNode, toPort.name, true)) return;

  // Calculate positions
  const startX = (actualFromNode.position.x + fromParentOffset.x) + NODE_WIDTH;
  const startY = (actualFromNode.position.y + fromParentOffset.y) + PORT_OFFSET_Y + (fromPortIndex * PORT_SPACING);
  const endX = (actualToNode.position.x + parentOffset.x);
  const endY = (actualToNode.position.y + parentOffset.y) + PORT_OFFSET_Y + (toPortIndex * PORT_SPACING);
  
  const portType = fromPort.type || 'default';
  drawConnectionLine(ctx, startX, startY, endX, endY, portType);
};

// ============================================================================
// PORT DRAWING - COLOR-CODED RINGS
// ============================================================================

/**
 * Draw a port with color-coded ring style
 */
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
  const color = getPortColor(portType);
  const connected = !!isConnected;
  const ringWidth = isHovered ? PORT_RING_WIDTH + 1 : PORT_RING_WIDTH;
  
  // Hover glow effect
  if (isHovered) {
    ctx.beginPath();
    ctx.arc(x, y, PORT_RADIUS + 6, 0, Math.PI * 2);
    ctx.fillStyle = color + '20'; // 12% opacity
    ctx.fill();
  }
  
  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, PORT_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = ringWidth;
  ctx.stroke();
  
  // Inner fill - filled if connected, dark if not
  ctx.beginPath();
  ctx.arc(x, y, PORT_RADIUS - ringWidth, 0, Math.PI * 2);
  ctx.fillStyle = connected ? color : '#1a1a1a';
  ctx.fill();
  
  // Port label
  ctx.fillStyle = isHovered ? color : COLORS.textSecondary;
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = isOutput ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + (isOutput ? -10 : 10), y);
};

// ============================================================================
// STATUS INDICATORS - REFINED BADGES
// ============================================================================

/**
 * Check if node has missing required connections
 */
const hasMissingRequiredConnections = (node: Node): boolean => {
  if (node.isParent) return false;
  
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

/**
 * Draw status badge in corner of node
 */
const drawStatusBadge = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  nodeWidth: number
) => {
  if (!node.status || node.isParent) return;
  
  const badgeRadius = 5;
  const badgeX = node.position.x + nodeWidth - 12;
  const badgeY = node.position.y + 12;
  
  let color: string;
  switch (node.status) {
    case 'running':
      color = COLORS.statusRunning;
      break;
    case 'success':
      color = COLORS.statusSuccess;
      break;
    case 'failed':
      color = COLORS.statusFailed;
      break;
    default:
      return;
  }
  
  // Draw badge with subtle glow
  ctx.save();
  
  // Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  
  // Badge circle
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  ctx.restore();
  
  // Running pulse animation
  if (node.status === 'running') {
    const pulse = Math.sin(Date.now() / 400) * 0.4 + 0.6;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeRadius + 4, 0, Math.PI * 2);
    ctx.fillStyle = `${color}${Math.round(pulse * 40).toString(16).padStart(2, '0')}`;
    ctx.fill();
  }
};

/**
 * Get border color based on node state
 */
const getNodeBorderColor = (node: Node, isSelected: boolean): string => {
  if (isSelected) return COLORS.borderSelected;
  
  // Status-based border tint
  if (node.status && !node.isParent) {
    switch (node.status) {
      case 'running':
        return COLORS.statusRunning;
      case 'failed':
        return COLORS.statusFailed;
      case 'success':
        // Brief green tint, could be animated
        return COLORS.statusSuccess;
    }
  }
  
  return COLORS.borderDefault;
};

/**
 * Draw status popup when hovering over status badge
 */
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
  if (!mousePosition || !node.status) return;
  
  const distToIcon = Math.sqrt(
    Math.pow(mousePosition.x - iconX, 2) + 
    Math.pow(mousePosition.y - iconY, 2)
  );
  
  if (distToIcon > iconRadius * 2) return;
  
  let statusColor = COLORS.statusIdle;
  switch (node.status) {
    case 'running': statusColor = COLORS.statusRunning; break;
    case 'success': statusColor = COLORS.statusSuccess; break;
    case 'failed': statusColor = COLORS.statusFailed; break;
  }
  
  const popupWidth = 200;
  const popupHeight = node.statusMessage ? 80 : 50;
  
  let popupX = node.position.x + nodeWidth + 10;
  let popupY = node.position.y;
  
  ctx.save();
  
  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  
  // Background
  ctx.beginPath();
  ctx.roundRect(popupX, popupY, popupWidth, popupHeight, 6);
  ctx.fillStyle = '#0c0c0c';
  ctx.fill();
  
  ctx.shadowColor = 'transparent';
  
  // Border
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  // Title
  ctx.fillStyle = COLORS.textPrimary;
  ctx.font = '600 12px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  const statusText = node.status.charAt(0).toUpperCase() + node.status.slice(1);
  ctx.fillText(statusText, popupX + 12, popupY + 12);
  
  // Status message
  if (node.statusMessage) {
    ctx.fillStyle = COLORS.textSecondary;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    
    // Truncate if too long
    let message = node.statusMessage;
    if (ctx.measureText(message).width > popupWidth - 24) {
      while (ctx.measureText(message + '...').width > popupWidth - 24 && message.length > 0) {
        message = message.slice(0, -1);
      }
      message += '...';
    }
    ctx.fillText(message, popupX + 12, popupY + 32);
  }
  
  // Data count for success
  if (node.status === 'success' && node.statusData) {
    const dataCount = typeof node.statusData === 'number' ? 
                     node.statusData : 
                     (node.statusData?.count || 0);
    
    ctx.fillStyle = COLORS.statusSuccess;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${dataCount} items`, popupX + 12, popupY + (node.statusMessage ? 52 : 32));
  }
  
  ctx.restore();
};

// ============================================================================
// NODE DRAWING - MINIMAL OUTLINE STYLE
// ============================================================================

/**
 * Draw a node with minimal outline style
 */
export const drawNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  hoveredPort: PortInfo | null,
  selectedNode: string | null,
  mousePosition: { x: number; y: number } | null = null,
  skipStatusPopups: boolean = false
) => {
  const isSelected = selectedNode === node.id;
  const nodeHeight = calculateNodeHeight(node);
  
  ctx.save();
  
  // ============================================================================
  // SHADOW
  // ============================================================================
  ctx.shadowColor = isSelected ? COLORS.shadowSelected : COLORS.shadowDefault;
  ctx.shadowBlur = isSelected ? 16 : 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  
  // ============================================================================
  // BACKGROUND - Differentiated by node type
  // ============================================================================
  ctx.beginPath();
  ctx.roundRect(
    node.position.x,
    node.position.y,
    NODE_WIDTH,
    nodeHeight,
    NODE_RADIUS
  );
  
  // Choose background color based on node type
  if (node.isParent) {
    ctx.fillStyle = COLORS.nodeBgParent;
  } else if (node.type === 'ai' || node.isProvider) {
    ctx.fillStyle = COLORS.nodeBgAi;
  } else if (node.type === 'storage') {
    ctx.fillStyle = COLORS.nodeBgStorage;
  } else {
    ctx.fillStyle = COLORS.nodeBg;
  }
  ctx.fill();
  
  // Reset shadow for border
  ctx.shadowColor = 'transparent';
  
  // ============================================================================
  // BORDER - Color varies by node type and status
  // ============================================================================
  ctx.beginPath();
  ctx.roundRect(
    node.position.x,
    node.position.y,
    NODE_WIDTH,
    nodeHeight,
    NODE_RADIUS
  );
  
  // Choose border color
  if (isSelected) {
    ctx.strokeStyle = COLORS.borderSelected;
    ctx.lineWidth = 2;
  } else if (node.status && !node.isParent) {
    // Status-based border
    switch (node.status) {
      case 'running':
        ctx.strokeStyle = COLORS.statusRunning;
        break;
      case 'failed':
        ctx.strokeStyle = COLORS.statusFailed;
        break;
      case 'success':
        ctx.strokeStyle = COLORS.statusSuccess;
        break;
      default:
        ctx.strokeStyle = COLORS.borderDefault;
    }
    ctx.lineWidth = 1.5;
  } else if (node.type === 'ai' || node.isProvider) {
    ctx.strokeStyle = COLORS.borderAi;
    ctx.lineWidth = 1.5;
  } else if (node.type === 'storage') {
    ctx.strokeStyle = COLORS.borderStorage;
    ctx.lineWidth = 1.5;
  } else {
    ctx.strokeStyle = COLORS.borderDefault;
    ctx.lineWidth = 1.5;
  }
  ctx.stroke();
  
  // ============================================================================
  // NODE TITLE
  // ============================================================================
  ctx.fillStyle = isSelected ? COLORS.textSelected : COLORS.textPrimary;
  ctx.font = node.isParent 
    ? '600 13px system-ui, -apple-system, sans-serif' 
    : '500 12px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Truncate name if too long
  let displayName = node.name;
  const maxTextWidth = NODE_WIDTH - 40;
  while (ctx.measureText(displayName).width > maxTextWidth && displayName.length > 0) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== node.name) {
    displayName += '...';
  }
  
  ctx.fillText(displayName, node.position.x + NODE_WIDTH / 2, node.position.y + 16);
  
  // ============================================================================
  // STATUS BADGE
  // ============================================================================
  drawStatusBadge(ctx, node, NODE_WIDTH);
  
  // ============================================================================
  // MISSING CONNECTION WARNING
  // ============================================================================
  if (hasMissingRequiredConnections(node)) {
    const warningX = node.position.x + 12;
    const warningY = node.position.y + 12;
    const warningRadius = 6;
    
    ctx.beginPath();
    ctx.arc(warningX, warningY, warningRadius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.statusFailed;
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', warningX, warningY);
  }
  
  // ============================================================================
  // PORTS
  // ============================================================================
  if (node.isParent) {
    // Parent node ports
    node.inputs.forEach((input, index) => {
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + PORT_OFFSET_Y + index * PORT_SPACING;
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x, portY, input.type, input.connectedTo, isHovered, true, input.name, false);
    });
    
    node.outputs.forEach((output, index) => {
      if (!shouldShowPort(node, output.name, false)) return;
      
      const portY = node.position.y + PORT_OFFSET_Y + index * PORT_SPACING;
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x + NODE_WIDTH, portY, output.type, output.connectedTo, isHovered, true, output.name, true);
    });
  } else {
    // Regular node ports
    node.inputs.forEach((input, index) => {
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + PORT_OFFSET_Y + index * PORT_SPACING;
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      drawPort(ctx, node.position.x, portY, input.type, input.connectedTo, isHovered, false, input.name, false);
    });

    // Output ports (only for storage/ai nodes, not for child nodes in groups)
    const shouldDrawOutputs = node.type === 'storage' || node.type === 'ai' || node.isProvider ||
                           !(node.id && (node.id.includes('source-') || node.id.includes('enricher-') || 
                             node.id.includes('generator-')));

    if (shouldDrawOutputs) {
      node.outputs.forEach((output, index) => {
        if (!shouldShowPort(node, output.name, false)) return;
        
        const portY = node.position.y + PORT_OFFSET_Y + index * PORT_SPACING;
        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
        
        drawPort(ctx, node.position.x + NODE_WIDTH, portY, output.type, output.connectedTo, isHovered, false, output.name, true);
      });
    }
  }

  // ============================================================================
  // CHILD NODES
  // ============================================================================
  if (node.isParent && node.expanded && node.children && node.children.length > 0) {
    node.children.forEach((child) => {
      drawNode(ctx, child, scale, hoveredPort, selectedNode, mousePosition, skipStatusPopups);
    });
  }

  // ============================================================================
  // STATUS POPUP (if hovering)
  // ============================================================================
  if (!skipStatusPopups && mousePosition && node.status && !node.isParent) {
    const badgeX = node.position.x + NODE_WIDTH - 12;
    const badgeY = node.position.y + 12;
    drawStatusPopup(ctx, node, badgeX, badgeY, 8, NODE_WIDTH, nodeHeight, mousePosition);
  }

  ctx.restore();
};

// ============================================================================
// GRID DRAWING - DOT PATTERN
// ============================================================================

/**
 * Draw a subtle dot grid
 */
export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  scale: number,
  offset: { x: number, y: number }
) => {
  const gridSize = 20;
  const dotRadius = 1;
  
  // Calculate grid boundaries
  const startX = Math.floor((-offset.x / scale) / gridSize) * gridSize;
  const startY = Math.floor((-offset.y / scale) / gridSize) * gridSize;
  const endX = (canvasWidth - offset.x) / scale;
  const endY = (canvasHeight - offset.y) / scale;
  
  ctx.fillStyle = COLORS.gridDot;
  
  // Draw dots
  for (let x = startX; x < endX; x += gridSize) {
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius / scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};
