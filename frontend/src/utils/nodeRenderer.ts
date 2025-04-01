import { Node, Connection, PortInfo } from '../types/nodeTypes';
import { shouldShowPort } from './nodeHandlers';

// Draw a connection between two nodes
export const drawConnection = (ctx: CanvasRenderingContext2D, fromNode: Node, toNode: Node, connection: Connection) => {
  console.log("CRITICAL RENDER: Drawing connection:", JSON.stringify(connection));
  console.log(`CRITICAL RENDER: From node ID: ${fromNode.id}, To node ID: ${toNode.id}`);
  
  // Find the actual target node if it's a child node
  let actualToNode = toNode;
  let parentOffset = { x: 0, y: 0 };
  
  if (connection.to.nodeId !== toNode.id && toNode.isParent && toNode.children) {
    // Look for the target node in children
    const childNode = toNode.children.find(child => child.id === connection.to.nodeId);
    if (childNode) {
      console.log(`CRITICAL RENDER: Found actual child node ${connection.to.nodeId} inside parent ${toNode.id}`);
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
      console.log(`CRITICAL RENDER: Found actual child node ${connection.from.nodeId} inside parent ${fromNode.id}`);
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
    console.warn(`CRITICAL RENDER: Could not find output port ${connection.from.output} on node ${actualFromNode.id}`);
    console.log(`CRITICAL RENDER: Available output ports: ${JSON.stringify(actualFromNode.outputs.map(o => o.name))}`);
    
    // Try to recover by using the first available output port
    if (actualFromNode.outputs.length > 0) {
      console.log(`CRITICAL RENDER: Using first available output port instead: ${actualFromNode.outputs[0].name}`);
      fromPort = actualFromNode.outputs[0];
    } else {
      console.error(`CRITICAL RENDER: Node ${actualFromNode.id} has no output ports, cannot draw connection`);
      return; // Exit without drawing
    }
  }
  
  // Find the input port on the to node
  let toPort = actualToNode.inputs.find(input => input.name === connection.to.input);
  if (!toPort) {
    console.warn(`CRITICAL RENDER: Could not find input port ${connection.to.input} on node ${actualToNode.id}`);
    console.log(`CRITICAL RENDER: Available input ports: ${JSON.stringify(actualToNode.inputs.map(i => i.name))}`);
    
    // Try to recover by using the first available input port
    if (actualToNode.inputs.length > 0) {
      console.log(`CRITICAL RENDER: Using first available input port instead: ${actualToNode.inputs[0].name}`);
      toPort = actualToNode.inputs[0];
    } else {
      console.error(`CRITICAL RENDER: Node ${actualToNode.id} has no input ports, cannot draw connection`);
      return; // Exit without drawing
    }
  }
  
  // Calculate port positions (relative to node position)
  const fromPortIndex = actualFromNode.outputs.indexOf(fromPort);
  const toPortIndex = actualToNode.inputs.indexOf(toPort);
  
  // If either port index is -1, it means we didn't find the port
  if (fromPortIndex === -1 || toPortIndex === -1) {
    console.error(`CRITICAL RENDER: Invalid port index, from: ${fromPortIndex}, to: ${toPortIndex} - from node: ${actualFromNode.id}, to node: ${actualToNode.id}`);
    return; // Exit without drawing
  }

  // Log port details for debugging
  console.log('CRITICAL RENDER: From port:', fromPort.name, 'index:', fromPortIndex);
  console.log('CRITICAL RENDER: To port:', toPort.name, 'index:', toPortIndex);

  // CRITICAL FIX: Validate that both ports should be shown on their respective nodes
  if (!shouldShowPort(actualFromNode, fromPort.name, false)) {
    console.log(`CRITICAL RENDER: Output port ${fromPort.name} should not be shown on node ${actualFromNode.id}, skipping connection`);
    return; // Skip drawing this connection
  }
  
  if (!shouldShowPort(actualToNode, toPort.name, true)) {
    console.log(`CRITICAL RENDER: Input port ${toPort.name} should not be shown on node ${actualToNode.id}, skipping connection`);
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
  
  console.log(`CRITICAL RENDER: Drawing connection from ${actualFromNode.id} at (${startX},${startY}) to ${actualToNode.id} at (${endX},${endY})`);
  
  // Use the port type to determine the connection color
  const portType = fromPort.type || 'default';
  drawConnectionLine(ctx, startX, startY, endX, endY, portType);
  
  console.log(`CRITICAL RENDER: Successfully drew connection from ${actualFromNode.id}.${fromPort.name} to ${actualToNode.id}.${toPort.name}`);
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
  // Set color based on port type with a more yellow amber palette
  if (portType === 'provider') {
    ctx.strokeStyle = '#d97706'; // Darker yellow for provider connections
  } else if (portType === 'storage') {
    ctx.strokeStyle = '#fcd34d'; // Lighter amber for storage connections
  } else {
    ctx.strokeStyle = '#fcd34d'; // Pale amber for other connections
  }
  
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
  // Skip parent nodes as they're just containers
  if (node.isParent) return false;
  
  // Check for required provider connections
  if (node.params && 'provider' in node.params && node.params.provider) {
    const providerInput = node.inputs.find(input => input.name === 'provider');
    if (providerInput && !providerInput.connectedTo) {
      return true;
    }
  }
  
  // Check for required storage connections
  if (node.params && 'storage' in node.params && node.params.storage) {
    const storageInput = node.inputs.find(input => input.name === 'storage');
    if (storageInput && !storageInput.connectedTo) {
      return true;
    }
  }
  
  return false;
};

// Draw a node
export const drawNode = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  scale: number,
  hoveredPort: PortInfo | null,
  selectedNode: string | null
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
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(
    node.position.x,
    node.position.y,
    node.position.x,
    node.position.y + nodeHeight
  );
  
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
    ctx.fillStyle = selectedNode === node.id ? '#292524' : '#1c1917'; // Dark background
  }
  
  ctx.fill();

  // Check if node has required but unconnected ports
  const needsHighlight = hasMissingRequiredConnections(node);

  // Node border
  ctx.strokeStyle = needsHighlight ? '#dc2626' : // Red for nodes with missing required connections
                   (selectedNode === node.id ? '#fbbf24' : 
                   (node.isParent ? '#b45309' : 
                   (node.type === 'ai' || node.isProvider === true) ? '#d97706' : 
                   (node.type === 'storage') ? '#fcd34d' : '#f59e0b'));
  ctx.lineWidth = needsHighlight ? 3 : (node.isParent ? 3 : 2); // Thicker border for highlighted nodes
  ctx.stroke();

  // Node title
  ctx.fillStyle = node.isParent ? '#fcd34d' : '#fcd34d'; // Brighter color for parent nodes
  ctx.font = node.isParent ? 'bold 14px sans-serif' : '14px sans-serif'; // Bold text for parent nodes
  ctx.textAlign = 'center';
  ctx.fillText(node.name, node.position.x + nodeWidth / 2, node.position.y + 30);
  
  // Add warning indicator for nodes with missing required connections
  if (needsHighlight) {
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

  // Show a small indicator if the node has params
  if (node.params && Object.keys(node.params).length > 0) {
    ctx.beginPath();
    ctx.arc(node.position.x + nodeWidth - 15, node.position.y + 15, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24'; // Yellow amber indicator
    ctx.fill();
    
    // Show the number of parameters
    const paramCount = Object.keys(node.params).length;
    ctx.fillStyle = '#1c1917'; // Dark text on light amber
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(paramCount.toString(), node.position.x + nodeWidth - 15, node.position.y + 15);
  }

  // CRITICAL FIX: Handle parent nodes with special attention for their input ports
  // This ensures that input ports on parent nodes are always visible
  if (node.isParent) {
    console.log(`Drawing parent node ${node.id} with ${node.inputs.length} inputs`);
    
    // Draw parent node input ports at the top
    node.inputs.forEach((input, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      if (isHovered) {
        // Draw outer glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
        ctx.fill();
      }
      
      // CRITICAL FIX: Always draw the port with a special color based on type
      // This ensures all ports are visible even after disconnection
      let portColor = '#666'; // Default gray color
      
      // Use strong colors for parent node ports to ensure they're always visible
      if (input.type === 'provider') {
        portColor = input.connectedTo ? '#d97706' : '#f59e0b'; // Darker yellow for provider connections
      } else if (input.type === 'storage') {
        portColor = input.connectedTo ? '#fbbf24' : '#fcd34d'; // Lighter amber for storage connections
      } else if (input.type === 'data') {
        portColor = input.connectedTo ? '#f59e0b' : '#fcd34d'; // Yellow amber for data connections
      }
      
      // Port background with a larger size for parent nodes
      ctx.beginPath();
      ctx.arc(node.position.x, portY, 7, 0, Math.PI * 2); // Slightly larger for parent nodes
      ctx.fillStyle = '#292524'; // Dark background
      ctx.fill();
      
      // Port border with improved visibility for parent nodes
      ctx.strokeStyle = isHovered ? '#fbbf24' : portColor; // Amber highlight when hovered
      ctx.lineWidth = isHovered ? 3 : 2.5; // Thicker lines for parent nodes
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#fbbf24' : '#d1d5db'; // Amber text when hovered
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(input.name, node.position.x - 8, portY + 4);
    });
    
    // Also draw parent output ports
    node.outputs.forEach((output, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, output.name, false)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
      
      if (isHovered) {
        // Draw outer glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
        ctx.fill();
      }
      
      // CRITICAL FIX: Always draw the port with a special color based on type
      // This ensures all ports are visible even after disconnection
      let portColor = '#666'; // Default gray color
      
      // Use strong colors for parent node ports to ensure they're always visible
      if (output.type === 'provider') {
        portColor = output.connectedTo ? '#d97706' : '#f59e0b'; // Darker yellow for provider connections
      } else if (output.type === 'storage') {
        portColor = output.connectedTo ? '#fbbf24' : '#fcd34d'; // Lighter amber for storage connections
      } else if (output.type === 'data') {
        portColor = output.connectedTo ? '#f59e0b' : '#fcd34d'; // Yellow amber for data connections
      }
      
      // Port background with a larger size for parent nodes
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 7, 0, Math.PI * 2); // Slightly larger for parent nodes
      ctx.fillStyle = '#292524'; // Dark background
      ctx.fill();
      
      // Port border with improved visibility for parent nodes
      ctx.strokeStyle = isHovered ? '#fbbf24' : portColor; // Amber highlight when hovered
      ctx.lineWidth = isHovered ? 3 : 2.5; // Thicker lines for parent nodes
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#fbbf24' : '#d1d5db'; // Amber text when hovered
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(output.name, node.position.x + nodeWidth + 8, portY + 4);
    });
  }
  else if (node.type === 'provider' && node.isProvider) {
    // For provider nodes, only draw the provider output port on the right
    const output = node.outputs[0];
    const portY = node.position.y + 25;
    
    // Port border and hover effect
    const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
    
    if (isHovered) {
      // Draw outer glow effect
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
      ctx.fill();
      
      // Draw inner glow effect
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
      ctx.fill();
    }
    
    // CRITICAL FIX: Always use a distinct color for provider ports
    // This ensures the port is always visible with a consistent color
    const portColor = output.connectedTo ? '#d97706' : '#f59e0b'; // Darker yellow colors for consistency
    
    // Port background
    ctx.beginPath();
    ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#292524'; // Dark background
    ctx.fill();
    
    // Port border with improved visibility
    ctx.strokeStyle = isHovered ? '#fbbf24' : portColor;
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Port label with improved visibility
    ctx.fillStyle = isHovered ? '#fbbf24' : '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(output.name, node.position.x + nodeWidth + 8, portY + 4);
  } else if (!node.isParent) {
    // For all other non-parent nodes, draw their input and output ports
    node.inputs.forEach((input, index) => {
      // Only draw if this port should be shown for this node type
      if (!shouldShowPort(node, input.name, true)) return;
      
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      if (isHovered) {
        // Draw outer glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
        ctx.fill();
      }
      
      // CRITICAL FIX: Always draw the port with a special color based on type
      // This ensures all ports are visible even after disconnection
      let portColor = '#666'; // Default gray color
      
      // Use distinct colors for different port types to make them more visible
      if (input.type === 'provider') {
        portColor = input.connectedTo ? '#d97706' : '#f59e0b'; // Darker yellow for provider connections
      } else if (input.type === 'storage') {
        portColor = input.connectedTo ? '#fbbf24' : '#fcd34d'; // Lighter amber for storage connections
      } else if (input.type === 'data') {
        portColor = input.connectedTo ? '#f59e0b' : '#fcd34d'; // Yellow amber for data connections
      }
      
      // Port background
      ctx.beginPath();
      ctx.arc(node.position.x, portY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#292524'; // Dark background
      ctx.fill();
      
      // Port border - always visible with distinct color
      ctx.strokeStyle = isHovered ? '#fbbf24' : portColor; // Amber highlight when hovered
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#fbbf24' : '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(input.name, node.position.x - 8, portY + 4);
    });

    // Check if this is a child node of a parent - child nodes shouldn't have output ports
    const isChildNodeOfParent = node.id && (
      (node.id.includes('source-') && node.id !== 'sources-group') ||
      (node.id.includes('enricher-') && node.id !== 'enrichers-group') ||
      (node.id.includes('generator-') && node.id !== 'generators-group')
    );

    // Only draw output ports if this is not a child node or if it's a provider/storage node
    if (!isChildNodeOfParent || node.type === 'storage' || node.type === 'ai' || node.isProvider) {
      node.outputs.forEach((output, index) => {
        // Only draw if this port should be shown for this node type
        if (!shouldShowPort(node, output.name, false)) return;
        
        const portY = node.position.y + 25 + index * 20;
        
        // Port border and hover effect
        const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
        
        if (isHovered) {
          // Draw outer glow effect
          ctx.beginPath();
          ctx.arc(node.position.x + nodeWidth, portY, 12, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.15)'; // Yellow amber glow
          ctx.fill();
          
          // Draw inner glow effect
          ctx.beginPath();
          ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(251, 191, 36, 0.3)'; // Darker yellow amber glow
          ctx.fill();
        }
        
        // CRITICAL FIX: Always draw the port with a special color based on type
        // This ensures all ports are visible even after disconnection
        let portColor = '#666'; // Default gray color
        
        // Use distinct colors for different port types to make them more visible
        if (output.type === 'provider') {
          portColor = output.connectedTo ? '#d97706' : '#f59e0b'; // Darker yellow for provider connections
        } else if (output.type === 'storage') {
          portColor = output.connectedTo ? '#fbbf24' : '#fcd34d'; // Lighter amber for storage connections
        } else if (output.type === 'data') {
          portColor = output.connectedTo ? '#f59e0b' : '#fcd34d'; // Yellow amber for data connections
        }
        
        // Port background
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#292524'; // Dark background
        ctx.fill();
        
        // Port border - always visible with distinct color
        ctx.strokeStyle = isHovered ? '#fbbf24' : portColor; // Amber highlight when hovered
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.stroke();
        
        // Port label
        ctx.fillStyle = isHovered ? '#fbbf24' : '#9ca3af';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(output.name, node.position.x + nodeWidth + 8, portY + 4);
      });
    }
  }

  // Draw child nodes if parent is expanded and has children
  if (node.isParent && node.expanded && node.children && node.children.length > 0) {
    // Draw the child nodes recursively
    node.children.forEach((child) => {
      drawNode(ctx, child, scale, hoveredPort, selectedNode);
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