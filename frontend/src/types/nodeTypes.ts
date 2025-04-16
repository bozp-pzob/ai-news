export interface NodePort {
  name: string;
  type: string;
  connectedTo?: string | undefined;
}

export interface Node {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  inputs: NodePort[];
  outputs: NodePort[];
  isParent?: boolean;
  children?: Node[];
  expanded?: boolean;
  isProvider?: boolean;
  params?: Record<string, any>;
  status?: 'running' | 'success' | 'failed' | null;
  statusMessage?: string;
  statusData?: number | { count: number } | any;
}

export interface Connection {
  from: { nodeId: string; output: string };
  to: { nodeId: string; input: string };
}

export interface PortInfo {
  nodeId: string;
  port: string;
  isOutput: boolean;
  portType?: string;
}

export interface NodeCoordinates {
  x: number;
  y: number;
}

export interface ViewSettings {
  scale: number;
  offset: NodeCoordinates;
} 