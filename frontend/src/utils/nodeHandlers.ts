import { Node, Connection, PortInfo, NodeCoordinates, NodePort } from '../types/nodeTypes';
import { Config } from '../types';

// Check if point is within a node
export const isPointInNode = (
  x: number,
  y: number,
  node: Node
): boolean => {
  const nodeHeight = node.isParent ? 80 : 50;
  
  return (
    x >= node.position.x &&
    x <= node.position.x + 200 &&
    y >= node.position.y &&
    y <= node.position.y + nodeHeight
  );
};

// Check if point is near a port
export const isPointNearPort = (
  x: number,
  y: number,
  portX: number,
  portY: number,
  radius: number = 15
): boolean => {
  const distance = Math.sqrt(Math.pow(x - portX, 2) + Math.pow(y - portY, 2));
  return distance <= radius;
};

// Connect two nodes
export function handleNodeConnection(
  nodes: Node[],
  connection: Connection,
  config: Config,
  onConfigUpdate: (config: Config) => void
): [Node[], Connection[], Config | undefined] | undefined {
  const connectingFrom = {
    nodeId: connection.from.nodeId,
    port: connection.from.output,
    isOutput: true
  };
  
  const targetNodeId = connection.to.nodeId;
  const targetPortName = connection.to.input;
  
  // Validate connection: Must be connecting from output to input
  if (!connectingFrom.isOutput) {
    return undefined;
  }
  
  // Find the source node and port type
  const sourceNode = findNodeRecursive(nodes, connectingFrom.nodeId);
  if (!sourceNode) {
    return undefined;
  }
  
  const sourcePort = sourceNode.outputs.find(o => o.name === connectingFrom.port);
  if (!sourcePort) {
    return undefined;
  }
  
  // Find the target node
  const targetNode = findNodeRecursive(nodes, targetNodeId);
  if (!targetNode) {
    return undefined;
  }
  
  // Find the target port
  const targetPort = targetNode.inputs.find(i => i.name === targetPortName);
  if (!targetPort) {
    return undefined;
  }
  
  // Make sure the port types are compatible
  if (sourcePort.type !== targetPort.type) {
    return undefined;
  }
  
  // Find all existing connections
  const existingConnections = findAllConnections(nodes);
  let updatedConnections = [...existingConnections];
  let updatedNodes = [...nodes];
  let updatedConfig = undefined;

  // Check if this input already has a connection
  const existingConnection = existingConnections.find(
    conn => conn.to.nodeId === targetNodeId && conn.to.input === targetPortName
  );
  
  if (existingConnection) {
    // Remove existing connection
    const [nodesAfterRemoval, connectionsAfterRemoval] = removeNodeConnection(
      updatedNodes,
      existingConnection
    );
    updatedNodes = nodesAfterRemoval;
    updatedConnections = connectionsAfterRemoval;
  }

  // Create new connection
  const newConnection: Connection = {
    from: { nodeId: connectingFrom.nodeId, output: connectingFrom.port },
    to: { nodeId: targetNodeId, input: targetPortName }
  };

  // Add new connection
  updatedConnections = [...updatedConnections, newConnection];

  // Update nodes to reflect connection
  updatedNodes = updateNodesWithNewConnection(
    nodes,
    connectingFrom.nodeId,
    connectingFrom.port,
    targetNodeId,
    targetPortName
  );

  // Update config if this is a storage connection
  if (targetPort.type === 'storage' || targetPort.type === 'provider') {
    const updatedConfig = { ...config };
    let configUpdated = false;
    
    // ... existing storage handling code ...
    
    // Handle provider connections
    if (targetPort.type === 'provider') {
      const targetNodeIndex = parseInt(targetNodeId.split('-')[1]);
      const sourceNodeIndex = parseInt(connectingFrom.nodeId.split('-')[1]);
      
      if (sourceNode.type === 'ai') {
        if (targetNode.type === 'source') {
          if (updatedConfig.sources && updatedConfig.sources[targetNodeIndex]) {
            updatedConfig.sources[targetNodeIndex].params = {
              ...updatedConfig.sources[targetNodeIndex].params,
              provider: `ai-${sourceNodeIndex}`
            };
            configUpdated = true;
          }
        } else if (targetNode.type === 'enricher') {
          if (updatedConfig.enrichers && updatedConfig.enrichers[targetNodeIndex]) {
            updatedConfig.enrichers[targetNodeIndex].params = {
              ...updatedConfig.enrichers[targetNodeIndex].params,
              provider: `ai-${sourceNodeIndex}`
            };
            configUpdated = true;
          }
        } else if (targetNode.type === 'generator') {
          if (updatedConfig.generators && updatedConfig.generators[targetNodeIndex]) {
            updatedConfig.generators[targetNodeIndex].params = {
              ...updatedConfig.generators[targetNodeIndex].params,
              provider: `ai-${sourceNodeIndex}`
            };
            configUpdated = true;
          }
        }
      }
    }
    
    if (configUpdated) {
      onConfigUpdate(updatedConfig);
      return [updatedNodes, updatedConnections, updatedConfig];
    }
  }
  
  return [updatedNodes, updatedConnections, undefined];
}

// Function to find all connections in the node graph
function findAllConnections(nodes: Node[]): Connection[] {
  const connections: Connection[] = [];
  
  // Process each node recursively, including children
  const processNode = (node: Node) => {
    // Check outputs for connections
    node.outputs.forEach(output => {
      if (output.connectedTo) {
        connections.push({
          from: { nodeId: node.id, output: output.name },
          to: { nodeId: output.connectedTo, input: 'unknown' } // We'll fix this below
        });
      }
    });
    
    // Process children if any
    if (node.isParent && node.children) {
      node.children.forEach(child => processNode(child));
    }
  };
  
  // Process all nodes to find connections
  nodes.forEach(node => processNode(node));
  
  // Update the 'input' property for each connection
  connections.forEach(conn => {
    // Find the target node
    const targetNode = findNodeRecursive(nodes, conn.to.nodeId);
    if (targetNode) {
      // Find the input port that's connected to the source node
      const inputPort = targetNode.inputs.find(input => 
        input.connectedTo === conn.from.nodeId
      );
      
      if (inputPort) {
        conn.to.input = inputPort.name;
      }
    }
  });
  
  return connections;
}

export function removeNodeConnection(nodes: Node[], connectionToRemove: Connection): [Node[], Connection[]] {
  // Find all connections
  const existingConnections = findAllConnections(nodes);
  
  // Filter out the connection we want to remove
  const updatedConnections = existingConnections.filter(
    (conn: Connection) => 
      !(conn.from.nodeId === connectionToRemove.from.nodeId && 
        conn.from.output === connectionToRemove.from.output && 
        conn.to.nodeId === connectionToRemove.to.nodeId && 
        conn.to.input === connectionToRemove.to.input)
  );
  
  // Create deep copy of nodes
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  
  // Remove connection info from nodes
  const sourceNodeId = connectionToRemove.from.nodeId;
  const sourcePortName = connectionToRemove.from.output;
  const targetNodeId = connectionToRemove.to.nodeId;
  const targetPortName = connectionToRemove.to.input;
  
  return [
    updateNodesWithRemovedConnection(
      updatedNodes,
      sourceNodeId,
      sourcePortName,
      targetNodeId,
      targetPortName
    ),
    updatedConnections
  ];
}

// Helper function to update nodes after removing a connection, supporting child nodes
function updateNodesWithRemovedConnection(
  nodes: Node[],
  sourceNodeId: string,
  sourcePortName: string,
  targetNodeId: string,
  targetPortName: string
): Node[] {
  // Clone the nodes array to avoid mutating the original
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  
  let sourceNodeUpdated = false;
  let targetNodeUpdated = false;
  
  // First check for main nodes
  for (let i = 0; i < updatedNodes.length; i++) {
    const node = updatedNodes[i];
    
    // Update source node if found
    if (node.id === sourceNodeId) {
      const outputIndex = node.outputs.findIndex((o: NodePort) => o.name === sourcePortName);
      if (outputIndex !== -1) {
        node.outputs[outputIndex].connectedTo = undefined;
        sourceNodeUpdated = true;
      }
    }
    
    // Update target node if found
    if (node.id === targetNodeId) {
      const inputIndex = node.inputs.findIndex((i: NodePort) => i.name === targetPortName);
      if (inputIndex !== -1) {
        node.inputs[inputIndex].connectedTo = undefined;
        targetNodeUpdated = true;
      }
    }
    
    // Check this node's children
    if (node.isParent && node.children) {
      for (let j = 0; j < node.children.length; j++) {
        const child = node.children[j];
        
        // Update source node if found in children
        if (!sourceNodeUpdated && child.id === sourceNodeId) {
          const outputIndex = child.outputs.findIndex((o: NodePort) => o.name === sourcePortName);
          if (outputIndex !== -1) {
            child.outputs[outputIndex].connectedTo = undefined;
            sourceNodeUpdated = true;
          }
        }
        
        // Update target node if found in children
        if (!targetNodeUpdated && child.id === targetNodeId) {
          const inputIndex = child.inputs.findIndex((i: NodePort) => i.name === targetPortName);
          if (inputIndex !== -1) {
            child.inputs[inputIndex].connectedTo = undefined;
            targetNodeUpdated = true;
          }
        }
      }
    }
    
    // If both nodes have been updated, stop searching
    if (sourceNodeUpdated && targetNodeUpdated) {
      break;
    }
  }
  
  return updatedNodes;
}

// Find port information at given coordinates
export const findPortAtCoordinates = (
  x: number,
  y: number,
  nodes: Node[]
): PortInfo | null => {
  // Check all nodes
  for (const node of nodes) {
    // Check input ports
    for (let i = 0; i < node.inputs.length; i++) {
      const input = node.inputs[i];
      const portY = node.position.y + 25 + i * 20;
      const portX = node.position.x;
      
      if (isPointNearPort(x, y, portX, portY)) {
        return { 
          nodeId: node.id, 
          port: input.name, 
          isOutput: false,
          portType: input.type
        };
      }
    }
    
    // Check output ports
    for (let i = 0; i < node.outputs.length; i++) {
      const output = node.outputs[i];
      const portY = node.position.y + 25 + i * 20;
      const portX = node.position.x + 200;
      
      if (isPointNearPort(x, y, portX, portY)) {
        return { 
          nodeId: node.id, 
          port: output.name, 
          isOutput: true,
          portType: output.type 
        };
      }
    }

    // Check child nodes if parent is expanded
    if (node.isParent && node.expanded && node.children) {
      for (const child of node.children) {
        // Check input ports
        for (let i = 0; i < child.inputs.length; i++) {
          const input = child.inputs[i];
          const portY = child.position.y + 25 + i * 20;
          const portX = child.position.x;
          
          if (isPointNearPort(x, y, portX, portY)) {
            return { nodeId: child.id, port: input.name, isOutput: false, portType: input.type };
          }
        }

        // Check output ports
        for (let i = 0; i < child.outputs.length; i++) {
          const output = child.outputs[i];
          const portY = child.position.y + 25 + i * 20;
          const portX = child.position.x + 200; // Node width
          
          if (isPointNearPort(x, y, portX, portY)) {
            return { nodeId: child.id, port: output.name, isOutput: true, portType: output.type };
          }
        }
      }
    }
  }
  
  return null;
};

// Check if point is within a node's collapse button
export const isPointInCollapseButton = (
  x: number,
  y: number,
  node: Node
): boolean => {
  if (!node.isParent) return false;
  
  const buttonSize = 20;
  const buttonX = node.position.x + 200 - 30; // nodeWidth - 30
  const buttonY = node.position.y + 10;
  
  const distance = Math.sqrt(Math.pow(x - buttonX, 2) + Math.pow(y - buttonY, 2));
  return distance <= buttonSize / 2;
};

// Find node at coordinates
export const findNodeAtCoordinates = (
  x: number,
  y: number,
  nodes: Node[]
): Node | null => {
  // First check child nodes of expanded parents
  for (const node of nodes) {
    if (node.isParent && node.expanded && node.children) {
      for (const child of node.children) {
        if (isPointInNode(x, y, child)) {
          return child;
        }
      }
    }
  }

  // Then check parent nodes
  for (const node of nodes) {
    if (isPointInNode(x, y, node)) {
      // Check if clicking on a collapse button (but don't return this as a node click)
      if (isPointInCollapseButton(x, y, node)) {
        return null;
      }
      return node;
    }
  }
  return null;
};

// Helper function to find a node recursively, including in child nodes
export function findNodeRecursive(nodes: Node[], nodeId: string): Node | undefined {
  // First check top-level nodes
  const node = nodes.find(n => n.id === nodeId);
  if (node) return node;
  
  // Then check children of parent nodes
  for (const parentNode of nodes) {
    if (parentNode.isParent && parentNode.children) {
      const childNode = parentNode.children.find(child => child.id === nodeId);
      if (childNode) return childNode;
    }
  }
  
  return undefined;
}

// Helper function to update nodes with a new connection, supporting child nodes
function updateNodesWithNewConnection(
  nodes: Node[],
  sourceNodeId: string,
  sourcePortName: string,
  targetNodeId: string,
  targetPortName: string
): Node[] {
  // Clone the nodes array to avoid mutating the original
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  
  let sourceNodeUpdated = false;
  let targetNodeUpdated = false;
  
  // First check for main nodes
  for (let i = 0; i < updatedNodes.length; i++) {
    const node = updatedNodes[i];
    
    // Update source node if found
    if (node.id === sourceNodeId) {
      const outputIndex = node.outputs.findIndex((o: NodePort) => o.name === sourcePortName);
      if (outputIndex !== -1) {
        node.outputs[outputIndex].connectedTo = targetNodeId;
        sourceNodeUpdated = true;
      }
    }
    
    // Update target node if found
    if (node.id === targetNodeId) {
      const inputIndex = node.inputs.findIndex((i: NodePort) => i.name === targetPortName);
      if (inputIndex !== -1) {
        node.inputs[inputIndex].connectedTo = sourceNodeId;
        targetNodeUpdated = true;
      }
    }
    
    // Check this node's children
    if (node.isParent && node.children) {
      for (let j = 0; j < node.children.length; j++) {
        const child = node.children[j];
        
        // Update source node if found in children
        if (!sourceNodeUpdated && child.id === sourceNodeId) {
          const outputIndex = child.outputs.findIndex((o: NodePort) => o.name === sourcePortName);
          if (outputIndex !== -1) {
            child.outputs[outputIndex].connectedTo = targetNodeId;
            sourceNodeUpdated = true;
          }
        }
        
        // Update target node if found in children
        if (!targetNodeUpdated && child.id === targetNodeId) {
          const inputIndex = child.inputs.findIndex((i: NodePort) => i.name === targetPortName);
          if (inputIndex !== -1) {
            child.inputs[inputIndex].connectedTo = sourceNodeId;
            targetNodeUpdated = true;
          }
        }
      }
    }
    
    // If both nodes have been updated, stop searching
    if (sourceNodeUpdated && targetNodeUpdated) {
      break;
    }
  }
  
  return updatedNodes;
} 