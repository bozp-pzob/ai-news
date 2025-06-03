import fs from 'fs';
import path from 'path';

export interface PluginInfo {
  name: string;
  pluginName: string;
  type: 'source' | 'ai' | 'enricher' | 'generator' | 'storage';
  description?: string;
  configSchema?: any;
  constructorInterface?: {
    parameters: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
    }>;
  };
}

export class PluginService {
  private pluginDirs = {
    source: 'sources',
    ai: 'ai',
    enricher: 'enrichers',
    generator: 'generators',
    storage: 'storage'
  };

  async getAvailablePlugins(): Promise<{ [key: string]: PluginInfo[] }> {
    const plugins: { [key: string]: PluginInfo[] } = {};
    
    for (const [type, dir] of Object.entries(this.pluginDirs)) {
      const pluginDir = path.join(__dirname, `../../src/plugins/${dir}`);
      try {
        const files = await fs.promises.readdir(pluginDir);
        plugins[type] = await Promise.all(
          files
            .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
            .map(async file => {
              const module = await import(path.join(pluginDir, file));
              const pluginClass : any = Object.values(module)[0];
              
              // Extract constructor interface information
              let constructorInterface;
              if (pluginClass?.constructorInterface) {
                constructorInterface = {
                  parameters: pluginClass.constructorInterface.parameters || []
                };
              }
              
              return {
                name: file.replace('.ts', ''),
                pluginName: file.replace('.ts', ''),
                type: type as PluginInfo['type'],
                description: pluginClass?.description || '',
                configSchema: pluginClass?.configSchema || {},
                constructorInterface
              };
            })
        );
      } catch (error) {
        console.error(`Error loading plugins from ${dir}:`, error);
        plugins[type] = [];
      }
    }
    
    return plugins;
  }
} 