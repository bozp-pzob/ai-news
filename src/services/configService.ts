import fs from 'fs';
import path from 'path';

export interface Config {
  sources: any[];
  ai: any[];
  enrichers: any[];
  generators: any[];
  storage: any[];
  settings?: {
    runOnce?: boolean;
    onlyFetch?: boolean;
  };
}

export class ConfigService {
  private configDir: string;

  constructor() {
    this.configDir = path.join(__dirname, "../../config");
  }

  private validateConfig(config: Config): void {
    const requiredFields: (keyof Config)[] = ['sources', 'ai', 'enrichers', 'generators', 'storage'];
    for (const field of requiredFields) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  async listConfigs(): Promise<string[]> {
    const files = await fs.promises.readdir(this.configDir);
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''));
  }

  async getConfig(name: string): Promise<Config> {
    const configPath = path.join(this.configDir, `${name}.json`);
    const config = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(config);
  }

  async saveConfig(name: string, config: Config): Promise<void> {
    this.validateConfig(config);
    const configPath = path.join(this.configDir, `${name}.json`);
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  async deleteConfig(name: string): Promise<void> {
    const configPath = path.join(this.configDir, `${name}.json`);
    await fs.promises.unlink(configPath);
  }
} 