import { Node, Connection, PortInfo } from '../types/nodeTypes';

// Draw a connection between two nodes
export const drawConnection = (
  ctx: CanvasRenderingContext2D,
  fromNode: Node,
  toNode: Node,
  connection: Connection
) => {
  // Find the actual target node if it's a child node
  let actualToNode = toNode;
  if (toNode.isParent && toNode.children) {
    const childNode = toNode.children.find(child => child.id === connection.to.nodeId);
    if (childNode) {
      actualToNode = childNode;
    }
  }

  // Find the actual source node if it's a child node
  let actualFromNode = fromNode;
  if (fromNode.isParent && fromNode.children) {
    const childNode = fromNode.children.find(child => child.id === connection.from.nodeId);
    if (childNode) {
      actualFromNode = childNode;
    }
  }

  // Calculate port positions
  const fromPort = actualFromNode.outputs.find(output => output.name === connection.from.output);
  const toPort = actualToNode.inputs.find(input => input.name === connection.to.input);

  if (!fromPort || !toPort) {
    console.warn(`Cannot find ports for connection: ${connection.from.nodeId}.${connection.from.output} → ${connection.to.nodeId}.${connection.to.input}`);
    return;
  }

  const fromPortIndex = actualFromNode.outputs.indexOf(fromPort);
  const toPortIndex = actualToNode.inputs.indexOf(toPort);

  if (fromPortIndex === -1 || toPortIndex === -1) {
    console.warn(`Invalid port indices for connection: ${connection.from.nodeId}.${connection.from.output} → ${connection.to.nodeId}.${connection.to.input}`);
    return;
  }

  const startX = actualFromNode.position.x + 200;
  const startY = actualFromNode.position.y + 25 + fromPortIndex * 20;
  const endX = actualToNode.position.x;
  const endY = actualToNode.position.y + 25 + toPortIndex * 20;
  
  // Set connection line color based on type
  ctx.strokeStyle = fromPort.type === 'storage' ? '#10b981' : '#4f46e5';
  ctx.lineWidth = 2;
  
  // Draw connection line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  // Create a curved path
  const controlPoint1X = startX + (endX - startX) / 2;
  const controlPoint1Y = startY;
  const controlPoint2X = startX + (endX - startX) / 2;
  const controlPoint2Y = endY;
  
  ctx.bezierCurveTo(
    controlPoint1X, controlPoint1Y,
    controlPoint2X, controlPoint2Y,
    endX, endY
  );
  
  ctx.stroke();

  // Draw arrow with the same strokeStyle
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowSize = 10;
  ctx.beginPath();
  ctx.moveTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
};

// Draw a temporary connection line
export const drawConnectionLine = (
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  portType?: string
) => {
  // Set color based on port type
  const color = portType === 'storage' ? '#10b981' : '#4f46e5';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  // Draw connection line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  
  // Create a curved path
  const controlPoint1X = startX + (endX - startX) / 2;
  const controlPoint1Y = startY;
  const controlPoint2X = startX + (endX - startX) / 2;
  const controlPoint2Y = endY;
  
  ctx.bezierCurveTo(
    controlPoint1X, controlPoint1Y,
    controlPoint2X, controlPoint2Y,
    endX, endY
  );
  
  ctx.stroke();

  // Draw arrow with the same color
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowSize = 10;
  ctx.beginPath();
  ctx.moveTo(endX - arrowSize * Math.cos(angle - Math.PI / 6), endY - arrowSize * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX - arrowSize * Math.cos(angle + Math.PI / 6), endY - arrowSize * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
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

  // Draw node background
  ctx.beginPath();
  ctx.roundRect(
    node.position.x,
    node.position.y,
    nodeWidth,
    node.isParent ? 80 : 50,
    8
  );
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(
    node.position.x,
    node.position.y,
    node.position.x,
    node.position.y + (node.isParent ? 80 : 50)
  );
  gradient.addColorStop(0, selectedNode === node.id ? '#374151' : '#1f2937');
  gradient.addColorStop(1, selectedNode === node.id ? '#1f2937' : '#111827');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Node border
  ctx.strokeStyle = selectedNode === node.id ? '#4f46e5' : '#374151';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Node title
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(node.name, node.position.x + nodeWidth / 2, node.position.y + 30);
  
  // Show a small indicator if the node has params
  if (node.params && Object.keys(node.params).length > 0) {
    ctx.beginPath();
    ctx.arc(node.position.x + nodeWidth - 15, node.position.y + 15, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#4f46e5';
    ctx.fill();
    
    // Show the number of parameters
    const paramCount = Object.keys(node.params).length;
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(paramCount.toString(), node.position.x + nodeWidth - 15, node.position.y + 15);
  }

  // Draw ports based on node type
  if (node.type === 'provider' && node.isProvider) {
    // For provider nodes, only draw the provider output port on the right
    const output = node.outputs[0];
    const portY = node.position.y + 25;
    
    // Port border and hover effect
    const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
    
    if (isHovered) {
      // Draw outer glow effect
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.fill();
      
      // Draw inner glow effect
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      ctx.fill();
    }
    
    // Port background
    ctx.beginPath();
    ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#374151';
    ctx.fill();
    
    // Port border
    ctx.strokeStyle = isHovered ? '#6366f1' : (output.connectedTo ? '#4f46e5' : '#666');
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Port label
    ctx.fillStyle = isHovered ? '#60a5fa' : '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(output.name, node.position.x + nodeWidth + 8, portY + 4);
  } else if (!node.isParent) {
    // For all other non-parent nodes, draw their input and output ports
    node.inputs.forEach((input, index) => {
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === input.name && !hoveredPort?.isOutput;
      
      if (isHovered) {
        // Draw outer glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // Port background
      ctx.beginPath();
      ctx.arc(node.position.x, portY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border
      ctx.strokeStyle = isHovered ? '#6366f1' : (input.connectedTo ? '#4f46e5' : '#666');
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#60a5fa' : '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(input.name, node.position.x - 8, portY + 4);
    });

    node.outputs.forEach((output, index) => {
      const portY = node.position.y + 25 + index * 20;
      
      // Port border and hover effect
      const isHovered = hoveredPort?.nodeId === node.id && hoveredPort?.port === output.name && hoveredPort?.isOutput;
      
      if (isHovered) {
        // Draw outer glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // Port background
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border
      ctx.strokeStyle = isHovered ? '#6366f1' : (output.connectedTo ? '#4f46e5' : '#666');
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#60a5fa' : '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(output.name, node.position.x + nodeWidth + 8, portY + 4);
    });
  }

  // Draw child nodes if parent is expanded
  if (node.isParent && node.expanded && node.children) {
    // Draw connection lines from parent to children
    node.children.forEach((child, index) => {
      const parentBottom = node.position.y + (node.isParent ? 80 : 50);
      const childTop = child.position.y;
      
      // // Draw vertical line from parent to child
      // ctx.beginPath();
      // ctx.moveTo(node.position.x + nodeWidth / 2, parentBottom);
      // ctx.lineTo(node.position.x + nodeWidth / 2, childTop);
      // ctx.strokeStyle = '#374151';
      // ctx.lineWidth = 2;
      // ctx.stroke();

      // // Draw horizontal line to child
      // ctx.beginPath();
      // ctx.moveTo(node.position.x + nodeWidth / 2, childTop);
      // ctx.lineTo(child.position.x, childTop);
      // ctx.stroke();
    });

    // Draw child nodes
    node.children.forEach(child => {
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
  ctx.strokeStyle = '#1f2937';
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