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
  // Set color based on port type
  if (portType === 'provider') {
    ctx.strokeStyle = '#4f46e5'; // Brighter blue for provider connections
  } else if (portType === 'storage') {
    ctx.strokeStyle = '#ec4899'; // Light pink for storage connections
  } else {
    ctx.strokeStyle = '#d97706'; // Orange for other connections
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
  
  // Use darker shades for parent nodes to visually differentiate them
  if (node.isParent) {
    gradient.addColorStop(0, selectedNode === node.id ? '#1e293b' : '#0f172a'); // Even darker top for parent nodes
    gradient.addColorStop(1, selectedNode === node.id ? '#0f172a' : '#020617'); // Even darker bottom for parent nodes
    ctx.fillStyle = gradient;
  } else if (node.type === 'ai' || (node.isProvider === true)) {
    // Special color for provider nodes that matches connection line color
    ctx.fillStyle = selectedNode === node.id ? '#3730a3' : '#312e81'; // Darker indigo for more dim appearance
  } else if (node.type === 'storage') {
    // Special color for storage nodes that matches storage connection line color
    ctx.fillStyle = selectedNode === node.id ? '#db2777' : '#f472b6'; // Lighter pink for more visibility
  } else {
    // Solid color for child nodes instead of gradient
    ctx.fillStyle = selectedNode === node.id ? '#374151' : '#1f2937';
  }
  
  ctx.fill();

  // Node border
  ctx.strokeStyle = selectedNode === node.id ? '#4f46e5' : 
                   (node.isParent ? '#4b5563' : 
                   (node.type === 'ai' || node.isProvider === true) ? '#818cf8' : 
                   (node.type === 'storage') ? '#ec4899' : '#374151');
  ctx.lineWidth = node.isParent ? 2.5 : 2; // Slightly thicker border for parent nodes
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
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // PARENT NODE FIX: Make parent node ports extra visible
      let portColor = '#666'; // Default gray color
      
      // Use strong colors for parent node ports to ensure they're always visible
      if (input.type === 'provider') {
        portColor = input.connectedTo ? '#4338ca' : '#818cf8'; // Stronger blue for parent nodes
      } else if (input.type === 'storage') {
        portColor = input.connectedTo ? '#be185d' : '#ec4899'; // Stronger pink for parent nodes
      } else if (input.type === 'data') {
        portColor = input.connectedTo ? '#b45309' : '#f59e0b'; // Stronger orange for parent nodes
      }
      
      // Port background with a larger size for parent nodes
      ctx.beginPath();
      ctx.arc(node.position.x, portY, 7, 0, Math.PI * 2); // Slightly larger for parent nodes
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border with improved visibility for parent nodes
      ctx.strokeStyle = isHovered ? '#6366f1' : portColor;
      ctx.lineWidth = isHovered ? 3 : 2.5; // Thicker lines for parent nodes
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#60a5fa' : '#d1d5db'; // Brighter text color
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
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // PARENT NODE FIX: Make parent node ports extra visible
      let portColor = '#666'; // Default gray color
      
      // Use strong colors for parent node ports to ensure they're always visible
      if (output.type === 'provider') {
        portColor = output.connectedTo ? '#4338ca' : '#818cf8'; // Stronger blue for parent nodes
      } else if (output.type === 'storage') {
        portColor = output.connectedTo ? '#be185d' : '#ec4899'; // Stronger pink for parent nodes
      } else if (output.type === 'data') {
        portColor = output.connectedTo ? '#b45309' : '#f59e0b'; // Stronger orange for parent nodes
      }
      
      // Port background with a larger size for parent nodes
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 7, 0, Math.PI * 2); // Slightly larger for parent nodes
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border with improved visibility for parent nodes
      ctx.strokeStyle = isHovered ? '#6366f1' : portColor;
      ctx.lineWidth = isHovered ? 3 : 2.5; // Thicker lines for parent nodes
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#60a5fa' : '#d1d5db'; // Brighter text color
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
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.fill();
      
      // Draw inner glow effect
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
      ctx.fill();
    }
    
    // CRITICAL FIX: Always use a distinct color for provider ports
    // This ensures the port is always visible with a consistent color
    const portColor = output.connectedTo ? '#4f46e5' : '#6366f1'; // Connected vs. disconnected blue
    
    // Port background
    ctx.beginPath();
    ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#374151';
    ctx.fill();
    
    // Port border with improved visibility
    ctx.strokeStyle = isHovered ? '#6366f1' : portColor;
    ctx.lineWidth = isHovered ? 3 : 2;
    ctx.stroke();
    
    // Port label with improved visibility
    ctx.fillStyle = isHovered ? '#60a5fa' : '#9ca3af';
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
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // CRITICAL FIX: Always draw the port with a special color based on type
      // This ensures all ports are visible even after disconnection
      let portColor = '#666'; // Default gray color
      
      // Use distinct colors for different port types to make them more visible
      if (input.type === 'provider') {
        portColor = input.connectedTo ? '#4f46e5' : '#6366f1'; // Connected vs. disconnected blue
      } else if (input.type === 'storage') {
        portColor = input.connectedTo ? '#be185d' : '#ec4899'; // Connected vs. disconnected pink
      } else if (input.type === 'data') {
        portColor = input.connectedTo ? '#d97706' : '#f59e0b'; // Connected vs. disconnected orange
      }
      
      // Port background
      ctx.beginPath();
      ctx.arc(node.position.x, portY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border - always visible with distinct color
      ctx.strokeStyle = isHovered ? '#6366f1' : portColor;
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.stroke();
      
      // Port label
      ctx.fillStyle = isHovered ? '#60a5fa' : '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(input.name, node.position.x - 8, portY + 4);
    });

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
        ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
        ctx.fill();
        
        // Draw inner glow effect
        ctx.beginPath();
        ctx.arc(node.position.x + nodeWidth, portY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.fill();
      }
      
      // CRITICAL FIX: Always draw the port with a special color based on type
      // This ensures all ports are visible even after disconnection
      let portColor = '#666'; // Default gray color
      
      // Use distinct colors for different port types to make them more visible
      if (output.type === 'provider') {
        portColor = output.connectedTo ? '#4f46e5' : '#6366f1'; // Connected vs. disconnected blue
      } else if (output.type === 'storage') {
        portColor = output.connectedTo ? '#be185d' : '#ec4899'; // Connected vs. disconnected pink
      } else if (output.type === 'data') {
        portColor = output.connectedTo ? '#d97706' : '#f59e0b'; // Connected vs. disconnected orange
      }
      
      // Port background
      ctx.beginPath();
      ctx.arc(node.position.x + nodeWidth, portY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#374151';
      ctx.fill();
      
      // Port border - always visible with distinct color
      ctx.strokeStyle = isHovered ? '#6366f1' : portColor;
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
      
      // Special debug logging to understand child structure
      console.log(`Drawing child node ${child.id} of parent ${node.id}`);
      console.log(`Child inputs: ${child.inputs.map(i => i.name).join(', ')}`);
    });

    // Draw child nodes with special enhanced rendering
    node.children.forEach(child => {
      // CRITICAL FIX: Only add necessary ports that should be present
      // based on the node type, rather than adding all ports uniformly
      if (child.type.includes('enricher') || child.id.includes('enricher-')) {
        // Enrichers should have provider, storage, and input ports
        const hasProviderPort = child.inputs.some(input => input.name === 'provider');
        if (!hasProviderPort) {
          console.log(`CRITICAL RENDER FIX: Adding missing provider port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'provider',
            type: 'provider',
            connectedTo: undefined
          });
        }
        
        const hasStoragePort = child.inputs.some(input => input.name === 'storage');
        if (!hasStoragePort) {
          console.log(`CRITICAL RENDER FIX: Adding missing storage port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'storage',
            type: 'storage',
            connectedTo: undefined
          });
        }
        
        const hasInputPort = child.inputs.some(input => input.name === 'input');
        if (!hasInputPort) {
          console.log(`CRITICAL RENDER FIX: Adding missing input port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'input',
            type: 'data',
            connectedTo: undefined
          });
        }
      }
      else if (child.type.includes('generator') || child.id.includes('generator-')) {
        // Generators have the same ports as enrichers
        const hasProviderPort = child.inputs.some(input => input.name === 'provider');
        if (!hasProviderPort) {
          console.log(`CRITICAL RENDER FIX: Adding missing provider port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'provider',
            type: 'provider',
            connectedTo: undefined
          });
        }
        
        const hasStoragePort = child.inputs.some(input => input.name === 'storage');
        if (!hasStoragePort) {
          console.log(`CRITICAL RENDER FIX: Adding missing storage port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'storage',
            type: 'storage',
            connectedTo: undefined
          });
        }
        
        const hasInputPort = child.inputs.some(input => input.name === 'input');
        if (!hasInputPort) {
          console.log(`CRITICAL RENDER FIX: Adding missing input port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'input',
            type: 'data',
            connectedTo: undefined
          });
        }
      }
      else if (child.type.includes('source') || child.id.includes('source-')) {
        // Sources only have provider and storage inputs, but no 'input' port
        const hasProviderPort = child.inputs.some(input => input.name === 'provider');
        if (!hasProviderPort) {
          console.log(`CRITICAL RENDER FIX: Adding missing provider port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'provider',
            type: 'provider',
            connectedTo: undefined
          });
        }
        
        const hasStoragePort = child.inputs.some(input => input.name === 'storage');
        if (!hasStoragePort) {
          console.log(`CRITICAL RENDER FIX: Adding missing storage port to child ${child.id} for rendering`);
          child.inputs.push({
            name: 'storage',
            type: 'storage',
            connectedTo: undefined
          });
        }
        
        // Sources should NOT have an input port! Remove it if it exists
        const inputPortIndex = child.inputs.findIndex(input => input.name === 'input');
        if (inputPortIndex !== -1) {
          console.log(`CRITICAL RENDER FIX: Removing incorrect input port from source ${child.id}`);
          child.inputs.splice(inputPortIndex, 1);
        }
      }
      
      // Clean up any duplicate ports
      const seenPorts = new Set<string>();
      child.inputs = child.inputs.filter(input => {
        if (seenPorts.has(input.name)) {
          console.log(`CRITICAL RENDER FIX: Removing duplicate port ${input.name} from ${child.id}`);
          return false;
        }
        seenPorts.add(input.name);
        return true;
      });
      
      // Add a parent reference to the child to make the relationship explicit
      if (!('parentId' in child)) {
        // Use a type-safe approach to add parentId
        (child as any).parentId = node.id;
      }
      
      // Now draw the child node
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