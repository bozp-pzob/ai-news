/**
 * DependencyResolver Service
 * 
 * Analyzes plugin requirements and automatically resolves dependencies
 * by creating and connecting required AI providers and storage plugins.
 */

import { PluginInfo, Config } from '../types';
import { Node, Connection } from '../types/nodeTypes';
import { pluginRegistry } from './PluginRegistry';

// Types for dependency analysis
export interface DependencyRequirements {
  needsProvider: boolean;
  needsStorage: boolean;
}

export interface DependencyAnalysis {
  requirements: DependencyRequirements;
  existingProvider: Node | null;
  existingStorage: Node | null;
  missingProvider: boolean;
  missingStorage: boolean;
}

export interface AutoAddResult {
  nodesToAdd: Node[];
  connectionsToAdd: Connection[];
  providerName: string | null;
  storageName: string | null;
}

/**
 * DependencyResolver class that handles automatic dependency resolution
 * for plugins that require AI providers or storage plugins.
 */
class DependencyResolver {
  /**
   * Parse a plugin's constructorInterface to determine what dependencies it requires.
   * Looks for parameters with types like 'AiProvider', 'AIProvider', 'StoragePlugin'.
   */
  getRequiredDependencies(plugin: PluginInfo): DependencyRequirements {
    const requirements: DependencyRequirements = {
      needsProvider: false,
      needsStorage: false,
    };

    if (!plugin.constructorInterface?.parameters) {
      return requirements;
    }

    for (const param of plugin.constructorInterface.parameters) {
      const paramType = param.type?.toString().toLowerCase() || '';
      const paramName = param.name?.toLowerCase() || '';

      // Check for AI provider dependency
      if (
        paramType.includes('aiprovider') ||
        paramType.includes('provider') ||
        paramName === 'provider'
      ) {
        requirements.needsProvider = true;
      }

      // Check for storage dependency
      if (
        paramType.includes('storageplugin') ||
        paramType.includes('storage') ||
        paramName === 'storage'
      ) {
        requirements.needsStorage = true;
      }
    }

    return requirements;
  }

  /**
   * Find an existing AI provider node in the graph.
   */
  findExistingProvider(nodes: Node[]): Node | null {
    // First check top-level nodes
    const providerNode = nodes.find(node => node.type === 'ai');
    if (providerNode) return providerNode;

    // Then check children of parent nodes
    for (const node of nodes) {
      if (node.isParent && node.children) {
        const childProvider = node.children.find(child => child.type === 'ai');
        if (childProvider) return childProvider;
      }
    }

    return null;
  }

  /**
   * Find an existing storage node in the graph.
   */
  findExistingStorage(nodes: Node[]): Node | null {
    // First check top-level nodes
    const storageNode = nodes.find(node => node.type === 'storage');
    if (storageNode) return storageNode;

    // Then check children of parent nodes
    for (const node of nodes) {
      if (node.isParent && node.children) {
        const childStorage = node.children.find(child => child.type === 'storage');
        if (childStorage) return childStorage;
      }
    }

    return null;
  }

  /**
   * Analyze a plugin's dependencies against the current graph state.
   * Returns what exists, what's missing, and what needs to be created.
   */
  analyzeDependencies(
    plugin: PluginInfo,
    nodes: Node[],
    config: Config
  ): DependencyAnalysis {
    const requirements = this.getRequiredDependencies(plugin);
    const existingProvider = this.findExistingProvider(nodes);
    const existingStorage = this.findExistingStorage(nodes);

    return {
      requirements,
      existingProvider,
      existingStorage,
      missingProvider: requirements.needsProvider && !existingProvider,
      missingStorage: requirements.needsStorage && !existingStorage,
    };
  }

  /**
   * Get the count of existing nodes of a specific type.
   * Used to generate unique IDs for new nodes.
   */
  private getNodeCountByType(nodes: Node[], type: string): number {
    let count = 0;
    
    for (const node of nodes) {
      if (node.type === type) count++;
      if (node.isParent && node.children) {
        for (const child of node.children) {
          if (child.type === type) count++;
        }
      }
    }
    
    return count;
  }

  /**
   * Check if a position would overlap with any existing nodes.
   */
  private wouldOverlap(
    position: { x: number; y: number },
    nodes: Node[],
    nodeWidth: number = 200,
    nodeHeight: number = 50
  ): boolean {
    const padding = 20;
    
    for (const node of nodes) {
      const nodeX = node.position.x;
      const nodeY = node.position.y;
      
      // Check for overlap with padding
      if (
        position.x < nodeX + nodeWidth + padding &&
        position.x + nodeWidth + padding > nodeX &&
        position.y < nodeY + nodeHeight + padding &&
        position.y + nodeHeight + padding > nodeY
      ) {
        return true;
      }
      
      // Also check children
      if (node.isParent && node.children) {
        for (const child of node.children) {
          const childX = node.position.x + child.position.x;
          const childY = node.position.y + child.position.y + 40; // Header offset
          
          if (
            position.x < childX + nodeWidth + padding &&
            position.x + nodeWidth + padding > childX &&
            position.y < childY + nodeHeight + padding &&
            position.y + nodeHeight + padding > childY
          ) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Find a clear position for a new node, avoiding overlaps.
   */
  private findClearPosition(
    basePosition: { x: number; y: number },
    nodes: Node[],
    offsetDirection: 'left' | 'up' = 'left'
  ): { x: number; y: number } {
    let position = { ...basePosition };
    const step = 60; // How much to offset on each iteration
    let attempts = 0;
    const maxAttempts = 10;
    
    while (this.wouldOverlap(position, nodes) && attempts < maxAttempts) {
      if (offsetDirection === 'left') {
        position.x -= step;
      } else {
        position.y -= step;
      }
      attempts++;
    }
    
    return position;
  }

  /**
   * Create nodes and connections for missing dependencies.
   * Positions new nodes relative to the drop position.
   */
  createMissingDependencies(
    analysis: DependencyAnalysis,
    dropPosition: { x: number; y: number },
    nodes: Node[],
    platformMode: boolean,
    isPlatformPro: boolean
  ): AutoAddResult {
    const result: AutoAddResult = {
      nodesToAdd: [],
      connectionsToAdd: [],
      providerName: null,
      storageName: null,
    };

    // If we have existing dependencies, use them
    if (analysis.existingProvider) {
      result.providerName = analysis.existingProvider.name;
    }
    if (analysis.existingStorage) {
      result.storageName = analysis.existingStorage.name;
    }

    // Create missing provider node
    if (analysis.missingProvider) {
      const providerIndex = this.getNodeCountByType(nodes, 'ai');
      const providerPosition = this.findClearPosition(
        { x: dropPosition.x - 300, y: dropPosition.y },
        nodes,
        'left'
      );

      const providerNode: Node = {
        id: `ai-${providerIndex}`,
        type: 'ai',
        name: 'OpenAIProvider',
        pluginName: 'OpenAIProvider',
        position: providerPosition,
        inputs: [],
        outputs: [{ name: 'provider', type: 'provider' }],
        params: {
          model: 'gpt-4o-mini',
        },
      };

      result.nodesToAdd.push(providerNode);
      result.providerName = providerNode.name;
    }

    // Create missing storage node
    if (analysis.missingStorage) {
      const storageIndex = this.getNodeCountByType(nodes, 'storage');
      const storagePosition = this.findClearPosition(
        { x: dropPosition.x - 300, y: dropPosition.y - 100 },
        [...nodes, ...result.nodesToAdd],
        'up'
      );

      // Determine storage type based on platform mode
      const storageType = platformMode ? 'PostgresStorage' : 'SQLiteStorage';
      
      const storageNode: Node = {
        id: `storage-${storageIndex}`,
        type: 'storage',
        name: storageType,
        pluginName: storageType,
        position: storagePosition,
        inputs: [],
        outputs: [{ name: 'storage', type: 'storage' }],
        params: platformMode ? {} : { dbPath: './data/content.db' },
      };

      result.nodesToAdd.push(storageNode);
      result.storageName = storageNode.name;
    }

    return result;
  }

  /**
   * Create connections between a new node and its dependencies.
   * This is called after the node is added to wire up the dependencies.
   */
  createDependencyConnections(
    nodeId: string,
    analysis: DependencyAnalysis,
    autoAddResult: AutoAddResult,
    existingNodes: Node[]
  ): Connection[] {
    const connections: Connection[] = [];

    // Connect to provider
    if (analysis.requirements.needsProvider) {
      let providerId: string | null = null;

      if (analysis.existingProvider) {
        providerId = analysis.existingProvider.id;
      } else {
        // Find the newly created provider
        const newProvider = autoAddResult.nodesToAdd.find(n => n.type === 'ai');
        if (newProvider) {
          providerId = newProvider.id;
        }
      }

      if (providerId) {
        connections.push({
          from: { nodeId: providerId, output: 'provider' },
          to: { nodeId: nodeId, input: 'provider' },
        });
      }
    }

    // Connect to storage
    if (analysis.requirements.needsStorage) {
      let storageId: string | null = null;

      if (analysis.existingStorage) {
        storageId = analysis.existingStorage.id;
      } else {
        // Find the newly created storage
        const newStorage = autoAddResult.nodesToAdd.find(n => n.type === 'storage');
        if (newStorage) {
          storageId = newStorage.id;
        }
      }

      if (storageId) {
        connections.push({
          from: { nodeId: storageId, output: 'storage' },
          to: { nodeId: nodeId, input: 'storage' },
        });
      }
    }

    return connections;
  }

  /**
   * Get default parameter values for a dependency-enabled plugin.
   * Pre-fills provider and storage names so the params are ready.
   */
  getDefaultDependencyParams(
    analysis: DependencyAnalysis,
    autoAddResult: AutoAddResult
  ): Record<string, any> {
    const params: Record<string, any> = {};

    if (analysis.requirements.needsProvider && autoAddResult.providerName) {
      params.provider = autoAddResult.providerName;
    }

    if (analysis.requirements.needsStorage && autoAddResult.storageName) {
      params.storage = autoAddResult.storageName;
    }

    return params;
  }
}

// Export singleton instance
export const dependencyResolver = new DependencyResolver();
