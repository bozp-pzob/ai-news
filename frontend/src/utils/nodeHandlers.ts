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
    console.error(`Source node not found: ${connectingFrom.nodeId}`);
    return undefined;
  }
  
  const sourcePort = sourceNode.outputs.find(o => o.name === connectingFrom.port);
  if (!sourcePort) {
    console.error(`Source port ${connectingFrom.port} not found on node ${connectingFrom.nodeId}`);
    return undefined;
  }
  
  // Find the target node
  const targetNode = findNodeRecursive(nodes, targetNodeId);
  if (!targetNode) {
    console.error(`Target node not found: ${targetNodeId}`);
    return undefined;
  }
  
  // Find the target port
  const targetPort = targetNode.inputs.find(i => i.name === targetPortName);
  if (!targetPort) {
    console.error(`Target port ${targetPortName} not found on node ${targetNodeId}`);
    return undefined;
  }
  
  // VALIDATION: Check that both ports should exist on their respective nodes
  if (!shouldShowPort(sourceNode, connectingFrom.port, false)) {
    console.error(`Source port ${connectingFrom.port} should not exist on node ${connectingFrom.nodeId}`);
    return undefined;
  }
  
  if (!shouldShowPort(targetNode, targetPortName, true)) {
    console.error(`Target port ${targetPortName} should not exist on node ${targetNodeId}`);
    return undefined;
  }
  
  console.log(`Connecting ${sourceNode.type} (${sourceNode.name}) to ${targetNode.type} (${targetNode.name})`);
  console.log(`Port types: ${sourcePort.type} -> ${targetPort.type}`);
  
  // Make sure the port types are compatible
  if (sourcePort.type !== targetPort.type) {
    console.error(`Port types don't match: ${sourcePort.type} vs ${targetPort.type}`);
    return undefined;
  }
  
  // Find all existing connections
  const existingConnections = findAllConnections(nodes);
  let updatedConnections = [...existingConnections];
  let updatedNodes = [...nodes];
  let updatedConfig = { ...config };
  let configUpdated = false;

  // Check if this input already has a connection
  const existingConnection = existingConnections.find(
    conn => conn.to.nodeId === targetNodeId && conn.to.input === targetPortName
  );
  
  if (existingConnection) {
    console.log(`Removing existing connection to ${targetNodeId}.${targetPortName}`);
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

  // Update config if this is a storage or provider connection
  if (targetPort.type === 'storage' || targetPort.type === 'provider') {
    // Special handling for provider connections
    if (targetPort.type === 'provider' && sourceNode.type === 'ai') {
      console.log(`Setting provider parameter for ${targetNode.type} node ${targetNode.name}`);
      
      // Get the actual provider name from the source node
      const providerName = sourceNode.name;
      
      // Handle different target node types
      const targetIdParts = targetNodeId.split('-');
      const targetType = targetIdParts[0];
      let targetIndex = parseInt(targetIdParts[1]);
      
      // Check if this is a child node in a group
      let isChildNode = false;
      let childIndex = 0;
      let parentIndex = 0;
      
      // If we can't find the node directly in the config arrays, it might be a child
      for (const node of nodes) {
        if (node.isParent && node.children) {
          const childIdx = node.children.findIndex(child => child.id === targetNodeId);
          if (childIdx !== -1) {
            isChildNode = true;
            childIndex = childIdx;
            parentIndex = parseInt(node.id.split('-')[1]);
            break;
          }
        }
      }
      
      // Update the config based on the target node type
      switch (targetType) {
        case 'source':
        case 'sources':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.sources && updatedConfig.sources[parentIndex]) {
              if (!updatedConfig.sources[parentIndex].params) {
                updatedConfig.sources[parentIndex].params = {};
              }
              if (!updatedConfig.sources[parentIndex].params.children) {
                updatedConfig.sources[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.sources[parentIndex].params.children.length <= childIndex) {
                updatedConfig.sources[parentIndex].params.children.push({});
              }
              
              updatedConfig.sources[parentIndex].params.children[childIndex] = {
                ...updatedConfig.sources[parentIndex].params.children[childIndex],
                provider: providerName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.sources && updatedConfig.sources[targetIndex]) {
            updatedConfig.sources[targetIndex].params = {
              ...updatedConfig.sources[targetIndex].params,
              provider: providerName
            };
            configUpdated = true;
          }
          break;
          
        case 'enricher':
        case 'enrichers':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.enrichers && updatedConfig.enrichers[parentIndex]) {
              if (!updatedConfig.enrichers[parentIndex].params) {
                updatedConfig.enrichers[parentIndex].params = {};
              }
              if (!updatedConfig.enrichers[parentIndex].params.children) {
                updatedConfig.enrichers[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.enrichers[parentIndex].params.children.length <= childIndex) {
                updatedConfig.enrichers[parentIndex].params.children.push({});
              }
              
              updatedConfig.enrichers[parentIndex].params.children[childIndex] = {
                ...updatedConfig.enrichers[parentIndex].params.children[childIndex],
                provider: providerName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.enrichers && updatedConfig.enrichers[targetIndex]) {
            updatedConfig.enrichers[targetIndex].params = {
              ...updatedConfig.enrichers[targetIndex].params,
              provider: providerName
            };
            configUpdated = true;
          }
          break;
          
        case 'generator':
        case 'generators':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.generators && updatedConfig.generators[parentIndex]) {
              if (!updatedConfig.generators[parentIndex].params) {
                updatedConfig.generators[parentIndex].params = {};
              }
              if (!updatedConfig.generators[parentIndex].params.children) {
                updatedConfig.generators[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.generators[parentIndex].params.children.length <= childIndex) {
                updatedConfig.generators[parentIndex].params.children.push({});
              }
              
              updatedConfig.generators[parentIndex].params.children[childIndex] = {
                ...updatedConfig.generators[parentIndex].params.children[childIndex],
                provider: providerName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.generators && updatedConfig.generators[targetIndex]) {
            updatedConfig.generators[targetIndex].params = {
              ...updatedConfig.generators[targetIndex].params,
              provider: providerName
            };
            configUpdated = true;
          }
          break;
      }
    }
    
    // Handle storage connections similarly
    if (targetPort.type === 'storage' && sourceNode.type === 'storage') {
      // Get the actual storage name from the source node
      const storageName = sourceNode.name;
      
      // Handle different target node types
      const targetIdParts = targetNodeId.split('-');
      const targetType = targetIdParts[0];
      let targetIndex = parseInt(targetIdParts[1]);
      
      // Check if this is a child node in a group
      let isChildNode = false;
      let childIndex = 0;
      let parentIndex = 0;
      
      // If we can't find the node directly in the config arrays, it might be a child
      for (const node of nodes) {
        if (node.isParent && node.children) {
          const childIdx = node.children.findIndex(child => child.id === targetNodeId);
          if (childIdx !== -1) {
            isChildNode = true;
            childIndex = childIdx;
            parentIndex = parseInt(node.id.split('-')[1]);
            break;
          }
        }
      }
      
      console.log(`Setting storage parameter for ${targetNode.type} node ${targetNode.name}`);
      
      // Update the config based on the target node type
      switch (targetType) {
        case 'source':
        case 'sources':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.sources && updatedConfig.sources[parentIndex]) {
              if (!updatedConfig.sources[parentIndex].params) {
                updatedConfig.sources[parentIndex].params = {};
              }
              if (!updatedConfig.sources[parentIndex].params.children) {
                updatedConfig.sources[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.sources[parentIndex].params.children.length <= childIndex) {
                updatedConfig.sources[parentIndex].params.children.push({});
              }
              
              updatedConfig.sources[parentIndex].params.children[childIndex] = {
                ...updatedConfig.sources[parentIndex].params.children[childIndex],
                storage: storageName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.sources && updatedConfig.sources[targetIndex]) {
            updatedConfig.sources[targetIndex].params = {
              ...updatedConfig.sources[targetIndex].params,
              storage: storageName
            };
            configUpdated = true;
          }
          break;
          
        case 'enricher':
        case 'enrichers':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.enrichers && updatedConfig.enrichers[parentIndex]) {
              if (!updatedConfig.enrichers[parentIndex].params) {
                updatedConfig.enrichers[parentIndex].params = {};
              }
              if (!updatedConfig.enrichers[parentIndex].params.children) {
                updatedConfig.enrichers[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.enrichers[parentIndex].params.children.length <= childIndex) {
                updatedConfig.enrichers[parentIndex].params.children.push({});
              }
              
              updatedConfig.enrichers[parentIndex].params.children[childIndex] = {
                ...updatedConfig.enrichers[parentIndex].params.children[childIndex],
                storage: storageName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.enrichers && updatedConfig.enrichers[targetIndex]) {
            updatedConfig.enrichers[targetIndex].params = {
              ...updatedConfig.enrichers[targetIndex].params,
              storage: storageName
            };
            configUpdated = true;
          }
          break;
          
        case 'generator':
        case 'generators':
          if (isChildNode) {
            // Handle child node in group
            if (updatedConfig.generators && updatedConfig.generators[parentIndex]) {
              if (!updatedConfig.generators[parentIndex].params) {
                updatedConfig.generators[parentIndex].params = {};
              }
              if (!updatedConfig.generators[parentIndex].params.children) {
                updatedConfig.generators[parentIndex].params.children = [];
              }
              
              // Ensure there's a place for this child
              while (updatedConfig.generators[parentIndex].params.children.length <= childIndex) {
                updatedConfig.generators[parentIndex].params.children.push({});
              }
              
              updatedConfig.generators[parentIndex].params.children[childIndex] = {
                ...updatedConfig.generators[parentIndex].params.children[childIndex],
                storage: storageName
              };
              configUpdated = true;
            }
          } else if (updatedConfig.generators && updatedConfig.generators[targetIndex]) {
            updatedConfig.generators[targetIndex].params = {
              ...updatedConfig.generators[targetIndex].params,
              storage: storageName
            };
            configUpdated = true;
          }
          break;
      }
    }
    
    if (configUpdated) {
      console.log("Updating config with new connection:", updatedConfig);
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
    console.log(`Finding connections for node: ${node.id}`);
    
    // Check outputs for connections
    node.outputs.forEach(output => {
      if (output.connectedTo) {
        console.log(`Found connection from ${node.id}.${output.name} to ${output.connectedTo}`);
        connections.push({
          from: { nodeId: node.id, output: output.name },
          to: { nodeId: output.connectedTo, input: 'unknown' } // We'll fix this below
        });
      }
    });
    
    // Check inputs for connections - this is an alternate way to find connections
    node.inputs.forEach(input => {
      if (input.connectedTo) {
        console.log(`Found connection TO ${node.id}.${input.name} FROM ${input.connectedTo}`);
        
        // Check if we already added this connection from the output side
        const existingConnection = connections.find(conn => 
          conn.from.nodeId === input.connectedTo && conn.to.nodeId === node.id
        );
        
        if (!existingConnection) {
          console.log(`Adding missing connection from ${input.connectedTo} to ${node.id}.${input.name}`);
          connections.push({
            from: { nodeId: input.connectedTo, output: 'unknown' }, // We'll try to fix this below
            to: { nodeId: node.id, input: input.name }
          });
        }
      }
    });
    
    // Process children if any
    if (node.isParent && node.children) {
      node.children.forEach(child => processNode(child));
    }
  };
  
  // Process all nodes to find connections
  nodes.forEach(node => processNode(node));
  
  // Update the 'input' property for each connection where it's unknown
  connections.forEach(conn => {
    if (conn.to.input === 'unknown') {
    // Find the target node
    const targetNode = findNodeRecursive(nodes, conn.to.nodeId);
    if (targetNode) {
      // Find the input port that's connected to the source node
      const inputPort = targetNode.inputs.find(input => 
        input.connectedTo === conn.from.nodeId
      );
      
      if (inputPort) {
        conn.to.input = inputPort.name;
          console.log(`Updated connection: ${conn.from.nodeId}.${conn.from.output} -> ${conn.to.nodeId}.${conn.to.input}`);
        }
      }
    }
  });
  
  // Update the 'output' property for each connection where it's unknown
  connections.forEach(conn => {
    if (conn.from.output === 'unknown') {
      // Find the source node
      const sourceNode = findNodeRecursive(nodes, conn.from.nodeId);
      if (sourceNode) {
        // Find the output port that's connected to the target node
        const outputPort = sourceNode.outputs.find(output => 
          output.connectedTo === conn.to.nodeId
        );
        
        if (outputPort) {
          conn.from.output = outputPort.name;
          console.log(`Updated connection: ${conn.from.nodeId}.${conn.from.output} -> ${conn.to.nodeId}.${conn.to.input}`);
        } else {
          // Infer output port by matching type with input port
          const targetNode = findNodeRecursive(nodes, conn.to.nodeId);
          if (targetNode) {
            const inputPort = targetNode.inputs.find(input => input.name === conn.to.input);
            if (inputPort) {
              // Find a matching output port by type
              const matchingOutput = sourceNode.outputs.find(output => output.type === inputPort.type);
              if (matchingOutput) {
                conn.from.output = matchingOutput.name;
                console.log(`Inferred connection: ${conn.from.nodeId}.${conn.from.output} -> ${conn.to.nodeId}.${conn.to.input}`);
              }
            }
          }
        }
      }
    }
  });
  
  // Filter out connections with unknown ports
  const validConnections = connections.filter(conn => 
    conn.from.output !== 'unknown' && conn.to.input !== 'unknown'
  );
  
  if (validConnections.length !== connections.length) {
    console.log(`Filtered out ${connections.length - validConnections.length} incomplete connections`);
  }
  
  console.log(`Found ${validConnections.length} valid connections in total`);
  return validConnections;
}

// Remove a connection between nodes
export function removeNodeConnection(
  nodes: Node[],
  connection: Connection
): [Node[], Connection[]] {
  console.log(`CRITICAL PORT FIX: Clearing connection from ${connection.from.nodeId}.${connection.from.output} to ${connection.to.nodeId}.${connection.to.input}`);
  
  // Create deep copy of nodes
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  
  // Find all connections
  let connections = findAllConnections(updatedNodes);
  
  // Find the connection to remove
  const connectionIndex = connections.findIndex(
    c => c.from.nodeId === connection.from.nodeId && 
         c.from.output === connection.from.output &&
         c.to.nodeId === connection.to.nodeId &&
         c.to.input === connection.to.input
  );
  
  if (connectionIndex === -1) {
    console.error(`Connection not found: ${connection.from.nodeId}.${connection.from.output} -> ${connection.to.nodeId}.${connection.to.input}`);
    return [updatedNodes, connections];
  }
  
  // Remove connection from array
  connections = connections.filter((_, index) => index !== connectionIndex);
  
  // Update nodes with removed connection
  const nodesWithRemovedConnection = updateNodesWithRemovedConnection(
      updatedNodes,
    connection.from.nodeId,
    connection.from.output,
    connection.to.nodeId,
    connection.to.input
  );
  
  // CRITICAL FIX: Make sure ports are preserved
  // Verify that ports still exist on both nodes
  const fromNode = findNodeRecursive(nodesWithRemovedConnection, connection.from.nodeId);
  const toNode = findNodeRecursive(nodesWithRemovedConnection, connection.to.nodeId);
  
  if (fromNode) {
    const hasOutputPort = fromNode.outputs.some(port => port.name === connection.from.output);
    if (!hasOutputPort) {
      console.error(`Output port ${connection.from.output} is missing from ${connection.from.nodeId}`);
      
      // Try to find the original port type from the connection
      const origFromNode = findNodeRecursive(nodes, connection.from.nodeId);
      if (origFromNode) {
        const origPort = origFromNode.outputs.find(port => port.name === connection.from.output);
        if (origPort) {
          console.log(`CRITICAL PORT FIX: Restoring output port ${connection.from.output} on ${connection.from.nodeId}`);
          fromNode.outputs.push({
            name: connection.from.output,
            type: origPort.type,
            connectedTo: undefined
          });
        }
      }
    }
  }
  
  if (toNode) {
    const hasInputPort = toNode.inputs.some(port => port.name === connection.to.input);
    if (!hasInputPort) {
      console.error(`Input port ${connection.to.input} is missing from ${connection.to.nodeId}`);
      
      // Try to find the original port type from the connection
      const origToNode = findNodeRecursive(nodes, connection.to.nodeId);
      if (origToNode) {
        const origPort = origToNode.inputs.find(port => port.name === connection.to.input);
        if (origPort) {
          console.log(`CRITICAL PORT FIX: Restoring input port ${connection.to.input} on ${connection.to.nodeId}`);
          toNode.inputs.push({
            name: connection.to.input,
            type: origPort.type,
            connectedTo: undefined
          });
        }
      }
    }
  }
  
  return [nodesWithRemovedConnection, connections];
}

// Helper function to update nodes with a removed connection
function updateNodesWithRemovedConnection(
  nodes: Node[],
  sourceNodeId: string,
  sourcePortName: string,
  targetNodeId: string,
  targetPortName: string
): Node[] {
  // Process source node
  const updateSourceNode = (node: Node) => {
    if (node.id === sourceNodeId) {
      // Find the output port that should be disconnected
      const outputPort = node.outputs.find(o => o.name === sourcePortName);
      if (outputPort && outputPort.connectedTo === targetNodeId) {
        console.log(`CRITICAL PORT FIX: Disconnecting output port ${sourcePortName} on ${sourceNodeId}`);
        outputPort.connectedTo = undefined;
      }
      return true;
    }
    
    // Check children if this is a parent node
    if (node.isParent && node.children) {
      for (const child of node.children) {
        if (updateSourceNode(child)) {
          return true;
        }
      }
    }
    
    return false;
  };
  
  // Process target node
  const updateTargetNode = (node: Node) => {
    if (node.id === targetNodeId) {
      // Find the input port that should be disconnected
      const inputPort = node.inputs.find(i => i.name === targetPortName);
      if (inputPort && inputPort.connectedTo === sourceNodeId) {
        console.log(`CRITICAL PORT FIX: Disconnecting input port ${targetPortName} on ${targetNodeId}`);
        inputPort.connectedTo = undefined;
      }
      return true;
    }
    
    // Check children if this is a parent node
    if (node.isParent && node.children) {
      for (const child of node.children) {
        if (updateTargetNode(child)) {
          return true;
        }
      }
    }
    
    return false;
  };
  
  // Process all nodes
  for (const node of nodes) {
    updateSourceNode(node);
    updateTargetNode(node);
  }
  
  return nodes;
}

// CRITICAL FIX: Function to ensure a node has all its standard ports
function ensureStandardPorts(node: Node) {
  console.log(`CRITICAL PORT FIX: Ensuring standard ports for node ${node.id} of type ${node.type}`);
  
  // Check node type to determine standard ports
  if (node.type.includes('source') || node.type.includes('enricher') || node.type.includes('generator')) {
    // These nodes should always have provider and storage ports
    const hasProviderPort = node.inputs.some(input => input.name === 'provider');
    if (!hasProviderPort) {
      console.log(`CRITICAL PORT FIX: Adding missing provider port to ${node.id}`);
      node.inputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo: undefined
      });
    }
    
    const hasStoragePort = node.inputs.some(input => input.name === 'storage');
    if (!hasStoragePort) {
      console.log(`CRITICAL PORT FIX: Adding missing storage port to ${node.id}`);
      node.inputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo: undefined
      });
    }
  }
  
  // Enrichers and generators should have input ports
  if (node.type.includes('enricher') || node.type.includes('generator')) {
    const hasInputPort = node.inputs.some(input => input.name === 'input');
    if (!hasInputPort) {
      console.log(`CRITICAL PORT FIX: Adding missing input port to ${node.id}`);
      node.inputs.push({
        name: 'input',
        type: 'data',
        connectedTo: undefined
      });
    }
  }
  
  // Child nodes may have inherited types from their parents
  // Use ID to determine node type if needed
  if (node.id.includes('source-') || node.id.includes('enricher-') || node.id.includes('generator-')) {
    // These nodes should always have provider and storage ports
    const hasProviderPort = node.inputs.some(input => input.name === 'provider');
    if (!hasProviderPort) {
      console.log(`CRITICAL PORT FIX: Adding missing provider port to child node ${node.id}`);
      node.inputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo: undefined
      });
    }
    
    const hasStoragePort = node.inputs.some(input => input.name === 'storage');
    if (!hasStoragePort) {
      console.log(`CRITICAL PORT FIX: Adding missing storage port to child node ${node.id}`);
      node.inputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo: undefined
      });
    }
    
    // Enrichers and generators should have input ports
    if (node.id.includes('enricher-') || node.id.includes('generator-')) {
      const hasInputPort = node.inputs.some(input => input.name === 'input');
      if (!hasInputPort) {
        console.log(`CRITICAL PORT FIX: Adding missing input port to child node ${node.id}`);
        node.inputs.push({
          name: 'input',
          type: 'data',
          connectedTo: undefined
        });
      }
    }
  }
  
  // If this is a parent node, ensure all children have their standard ports too
    if (node.isParent && node.children) {
    for (const child of node.children) {
      ensureStandardPorts(child);
    }
  }
}

// Helper function to determine port type from name
function getPortTypeFromName(portName: string): string {
  // Common port types
  switch (portName) {
    case 'provider':
      return 'provider';
    case 'storage':
      return 'storage';
    case 'input':
      return 'data';
    case 'output':
      return 'data';
    default:
      return 'any';
  }
}

// Helper function to determine which ports should be shown based on node type
export function shouldShowPort(node: Node, portName: string, isInput: boolean): boolean {
  // Debug logging to track port display issues
  const nodeTypeStr = `${node.id} (type: ${node.type})`;
  
  // Storage nodes only have output ports
  if (node.type === 'storage' || node.id.includes('storage-')) {
    if (isInput) {
      console.log(`PORT FILTER: ${nodeTypeStr} - rejecting input port ${portName} (storage nodes have no inputs)`);
      return false;
    }
    const shouldShow = portName === 'storage';
    if (!shouldShow) {
      console.log(`PORT FILTER: ${nodeTypeStr} - rejecting output port ${portName} (only 'storage' allowed)`);
    }
    return shouldShow;
  }
  
  // AI provider nodes only have output ports
  if (node.type === 'ai' || node.id.includes('ai-')) {
    if (isInput) {
      console.log(`PORT FILTER: ${nodeTypeStr} - rejecting input port ${portName} (AI nodes have no inputs)`);
      return false;
    }
    const shouldShow = portName === 'provider';
    if (!shouldShow) {
      console.log(`PORT FILTER: ${nodeTypeStr} - rejecting output port ${portName} (only 'provider' allowed)`);
    }
    return shouldShow;
  }
  
  // Source nodes
  if (node.type.includes('source') || node.id.includes('source-')) {
    if (isInput) {
      // Sources have provider and storage inputs only
      const shouldShow = portName === 'provider' || portName === 'storage';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting input port ${portName} (only provider/storage allowed)`);
      }
      return shouldShow;
    } else {
      // Sources have output port
      const shouldShow = portName === 'output';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting output port ${portName} (only 'output' allowed)`);
      }
      return shouldShow;
    }
  }
  
  // Enricher nodes
  if (node.type.includes('enricher') || node.id.includes('enricher-')) {
    if (isInput) {
      // Enrichers have provider, storage, and input ports
      const shouldShow = portName === 'provider' || portName === 'storage' || portName === 'input';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting input port ${portName} (only provider/storage/input allowed)`);
      }
      return shouldShow;
    } else {
      // Enrichers have output port
      const shouldShow = portName === 'output';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting output port ${portName} (only 'output' allowed)`);
      }
      return shouldShow;
    }
  }
  
  // Generator nodes
  if (node.type.includes('generator') || node.id.includes('generator-')) {
    if (isInput) {
      // Generators have provider, storage, and input ports
      const shouldShow = portName === 'provider' || portName === 'storage' || portName === 'input';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting input port ${portName} (only provider/storage/input allowed)`);
      }
      return shouldShow;
    } else {
      // Generators have output port
      const shouldShow = portName === 'output';
      if (!shouldShow) {
        console.log(`PORT FILTER: ${nodeTypeStr} - rejecting output port ${portName} (only 'output' allowed)`);
      }
      return shouldShow;
    }
  }
  
  // Default: show all ports (for custom/unknown node types)
  console.log(`PORT FILTER: Unknown node type ${nodeTypeStr} - showing port ${portName}`);
  return true;
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
      
      // Skip ports that shouldn't be shown for this node type
      if (!shouldShowPort(node, input.name, true)) continue;
      
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
      
      // Skip ports that shouldn't be shown for this node type
      if (!shouldShowPort(node, output.name, false)) continue;
      
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
          
          // Skip ports that shouldn't be shown for this node type
          if (!shouldShowPort(child, input.name, true)) continue;
          
          const portY = child.position.y + 25 + i * 20;
          const portX = child.position.x;
          
          if (isPointNearPort(x, y, portX, portY)) {
            return { nodeId: child.id, port: input.name, isOutput: false, portType: input.type };
          }
        }

        // Check output ports
        for (let i = 0; i < child.outputs.length; i++) {
          const output = child.outputs[i];
          
          // Skip ports that shouldn't be shown for this node type
          if (!shouldShowPort(child, output.name, false)) continue;
          
          const portY = child.position.y + 25 + i * 20;
          const portX = child.position.x + 200;
          
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

// Find node recursively (including child nodes)
export const findNodeRecursive = (nodes: Node[], id: string): Node | undefined => {
  console.log(`Looking for node with id: ${id}`);
  
  // Try to find the node at the top level first
  const node = nodes.find(n => n.id === id);
  if (node) {
    console.log(`Found node at top level: ${id}`);
    return node;
  }
  
  // Define a recursive search function to traverse the node tree
  const searchInNodes = (nodeList: Node[]): Node | undefined => {
    // First check directly in this list
    const directMatch = nodeList.find(n => n.id === id);
    if (directMatch) return directMatch;
    
    // Then check in all children of parent nodes
    for (const parentNode of nodeList) {
    if (parentNode.isParent && parentNode.children) {
        // Check direct children
        const childMatch = parentNode.children.find(child => child.id === id);
        if (childMatch) return childMatch;
        
        // Recursively check if any children are themselves parents
        const childParents = parentNode.children.filter(child => child.isParent && child.children);
        if (childParents.length > 0) {
          const nestedMatch = searchInNodes(childParents);
          if (nestedMatch) return nestedMatch;
        }
      }
    }
    
    return undefined;
  };
  
  // Search through all nodes recursively
  const result = searchInNodes(nodes);
  
  if (result) {
    console.log(`Found node ${id} through deep recursive search`);
    return result;
  }
  
  console.log(`Node not found: ${id}`);
  return undefined;
};

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

// Helper function to create a standard NodePort input
export function createNodeInput(name: string, type: string): NodePort {
  return {
    name,
    type,
    connectedTo: undefined
  };
}

// Helper function to create a standard NodePort output
export function createNodeOutput(name: string, type: string): NodePort {
  return {
    name,
    type,
    connectedTo: undefined
  };
}

// Synchronize node ports with their parameters to ensure connections match actual parameters
export function syncNodePortsWithParams(nodes: Node[]): Node[] {
  console.log('🔄 SYNC: Synchronizing node ports with parameters');
  
  // Create a deep copy of nodes to avoid mutation
  const updatedNodes = JSON.parse(JSON.stringify(nodes));
  
  // First, build an index of connections for easier lookup
  const connectionsByTarget = new Map<string, Map<string, string>>();
  const connectionsBySource = new Map<string, Map<string, string>>();
  
  // Process each node to find all connections
  updatedNodes.forEach((node: Node) => {
    // Add input port connections
    node.inputs.forEach((input: NodePort) => {
      if (input.connectedTo) {
        if (!connectionsByTarget.has(node.id)) {
          connectionsByTarget.set(node.id, new Map<string, string>());
        }
        connectionsByTarget.get(node.id)?.set(input.name, input.connectedTo);
      }
    });
    
    // Add output port connections
    node.outputs.forEach((output: NodePort) => {
      if (output.connectedTo) {
        if (!connectionsBySource.has(node.id)) {
          connectionsBySource.set(node.id, new Map<string, string>());
        }
        connectionsBySource.get(node.id)?.set(output.name, output.connectedTo);
      }
    });
    
    // Process children if this is a parent node
    if (node.isParent && node.children) {
      node.children.forEach((child: Node) => {
        // Add input port connections
        child.inputs.forEach((input: NodePort) => {
          if (input.connectedTo) {
            if (!connectionsByTarget.has(child.id)) {
              connectionsByTarget.set(child.id, new Map<string, string>());
            }
            connectionsByTarget.get(child.id)?.set(input.name, input.connectedTo);
          }
        });
        
        // Add output port connections
        child.outputs.forEach((output: NodePort) => {
          if (output.connectedTo) {
            if (!connectionsBySource.has(child.id)) {
              connectionsBySource.set(child.id, new Map<string, string>());
            }
            connectionsBySource.get(child.id)?.set(output.name, output.connectedTo);
          }
        });
      });
    }
  });
  
  // Now process each node to update its ports
  for (const node of updatedNodes) {
    // Process this node
    syncSingleNodePorts(node, connectionsByTarget, connectionsBySource);
    
    // Process children if this is a parent node
    if (node.isParent && node.children) {
      for (const child of node.children) {
        syncSingleNodePorts(child, connectionsByTarget, connectionsBySource);
      }
    }
  }
  
  return updatedNodes;
}

// Helper function to sync a single node's ports with its parameters
function syncSingleNodePorts(
  node: Node,
  connectionsByTarget: Map<string, Map<string, string>>,
  connectionsBySource: Map<string, Map<string, string>>
): void {
  if (!node.params) return;
  
  // Ensure the node has the required ports for its type
  ensureRequiredPorts(node);
  
  // Get connections for this node
  const targetConnections = connectionsByTarget.get(node.id) || new Map<string, string>();
  const sourceConnections = connectionsBySource.get(node.id) || new Map<string, string>();
  
  // Check provider parameter and port
  if ('provider' in node.params) {
    // Make sure the node has a provider input port
    const providerPort = node.inputs.find(input => input.name === 'provider');
    if (!providerPort) {
      // Add the port if it's missing
      const connectedTo = targetConnections.get('provider');
      node.inputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo
      });
    } else {
      // Port exists, update its connectedTo property from known connections
      providerPort.connectedTo = targetConnections.get('provider');
    }
  }
  
  // Check storage parameter and port
  if ('storage' in node.params) {
    // Make sure the node has a storage input port
    const storagePort = node.inputs.find(input => input.name === 'storage');
    if (!storagePort) {
      // Add the port if it's missing
      const connectedTo = targetConnections.get('storage');
      node.inputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo
      });
    } else {
      // Port exists, update its connectedTo property from known connections
      storagePort.connectedTo = targetConnections.get('storage');
    }
  }
  
  // For other inputs like 'input', make sure they exist and have connections
  if (node.type.includes('enricher') || node.type.includes('generator')) {
    const inputPort = node.inputs.find(input => input.name === 'input');
    if (!inputPort) {
      // Add the input port if it's missing
      const connectedTo = targetConnections.get('input');
      node.inputs.push({
        name: 'input',
        type: 'data',
        connectedTo
      });
    } else {
      // Port exists, update its connectedTo property from known connections
      inputPort.connectedTo = targetConnections.get('input');
    }
  }
  
  // Ensure all output ports have their connections
  node.outputs.forEach(output => {
    output.connectedTo = sourceConnections.get(output.name);
  });
}

// Helper function to ensure a node has all required ports based on its type
function ensureRequiredPorts(node: Node): void {
  // Source nodes need provider, storage inputs and output output
  if (node.type.includes('source') || node.id.includes('source-')) {
    // Check for required input ports
    if (!node.inputs.some(input => input.name === 'provider')) {
      node.inputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo: undefined
      });
    }
    
    if (!node.inputs.some(input => input.name === 'storage')) {
      node.inputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo: undefined
      });
    }
    
    // Check for required output port
    if (!node.outputs.some(output => output.name === 'output')) {
      node.outputs.push({
        name: 'output',
        type: 'data',
        connectedTo: undefined
      });
    }
  }
  
  // Enricher/Generator nodes need provider, storage, input inputs and output output
  if (node.type.includes('enricher') || node.type.includes('generator') || 
      node.id.includes('enricher-') || node.id.includes('generator-')) {
    // Check for required input ports
    if (!node.inputs.some(input => input.name === 'provider')) {
      node.inputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo: undefined
      });
    }
    
    if (!node.inputs.some(input => input.name === 'storage')) {
      node.inputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo: undefined
      });
    }
    
    if (!node.inputs.some(input => input.name === 'input')) {
      node.inputs.push({
        name: 'input',
        type: 'data',
        connectedTo: undefined
      });
    }
    
    // Check for required output port
    if (!node.outputs.some(output => output.name === 'output')) {
      node.outputs.push({
        name: 'output',
        type: 'data',
        connectedTo: undefined
      });
    }
  }
  
  // AI nodes need provider output
  if (node.type === 'ai' || node.id.includes('ai-')) {
    if (!node.outputs.some(output => output.name === 'provider')) {
      node.outputs.push({
        name: 'provider',
        type: 'provider',
        connectedTo: undefined
      });
    }
  }
  
  // Storage nodes need storage output
  if (node.type === 'storage' || node.id.includes('storage-')) {
    if (!node.outputs.some(output => output.name === 'storage')) {
      node.outputs.push({
        name: 'storage',
        type: 'storage',
        connectedTo: undefined
      });
    }
  }
}

// Clean up stale connections that don't match node port states
export function cleanupStaleConnections(nodes: Node[], connections: Connection[]): Connection[] {
  console.log('🧹 CLEANUP: Checking for stale connections');
  
  // Filter out connections that don't match node port states
  const validConnections = connections.filter(connection => {
    // Find the source node
    const sourceNode = findNodeRecursive(nodes, connection.from.nodeId);
    if (!sourceNode) {
      console.log(`🧹 CLEANUP: Removing connection - source node ${connection.from.nodeId} not found`);
      return false;
    }
    
    // Find the target node
    const targetNode = findNodeRecursive(nodes, connection.to.nodeId);
    if (!targetNode) {
      console.log(`🧹 CLEANUP: Removing connection - target node ${connection.to.nodeId} not found`);
      return false;
    }
    
    // Find the output port on the source node
    const outputPort = sourceNode.outputs.find(output => output.name === connection.from.output);
    if (!outputPort) {
      console.log(`🧹 CLEANUP: Removing connection - output port ${connection.from.output} not found on node ${connection.from.nodeId}`);
      return false;
    }
    
    // Find the input port on the target node
    const inputPort = targetNode.inputs.find(input => input.name === connection.to.input);
    if (!inputPort) {
      console.log(`🧹 CLEANUP: Removing connection - input port ${connection.to.input} not found on node ${connection.to.nodeId}`);
      return false;
    }
    
    // Check if the ports should be shown based on node type
    if (!shouldShowPort(sourceNode, connection.from.output, false)) {
      console.log(`🧹 CLEANUP: Removing connection - output port ${connection.from.output} should not be shown on node ${connection.from.nodeId}`);
      return false;
    }
    
    if (!shouldShowPort(targetNode, connection.to.input, true)) {
      console.log(`🧹 CLEANUP: Removing connection - input port ${connection.to.input} should not be shown on node ${connection.to.nodeId}`);
      return false;
    }
    
    // Don't check the connectedTo properties for now, as they'll be fixed by syncNodePortsWithParams
    // Instead, ensure the connection matches expected port types
    if (outputPort.type !== inputPort.type) {
      console.log(`🧹 CLEANUP: Removing connection - port types don't match: ${outputPort.type} vs ${inputPort.type}`);
      return false;
    }
    
    // Connection is valid
    return true;
  });
  
  if (validConnections.length !== connections.length) {
    console.log(`🧹 CLEANUP: Removed ${connections.length - validConnections.length} stale connections`);
  } else {
    console.log('🧹 CLEANUP: All connections are valid');
  }
  
  return validConnections;
} 