// frontend/src/services/localConfigStorage.ts

/**
 * LocalConfigStorage - browser localStorage-based config storage for anonymous users.
 * Configs stored here can be loaded into the builder without authentication.
 *
 * Also provides LocalServerSettings — per-config local server connection info
 * (URL + encryption key) stored ONLY in the browser. Never sent to the hosted DB.
 */

const STORAGE_KEY = 'digital-gardener-local-configs';
const LOCAL_SERVER_PREFIX = 'digital-gardener-local-server:';

export interface LocalConfig {
  id: string;
  name: string;
  description: string;
  configJson: any;
  createdAt: string;
  updatedAt: string;
}

function readAll(): LocalConfig[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(configs: LocalConfig[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export const localConfigStorage = {
  list(): LocalConfig[] {
    return readAll();
  },

  get(id: string): LocalConfig | null {
    return readAll().find((c) => c.id === id) || null;
  },

  create(data: { name: string; description: string; configJson: any }): LocalConfig {
    const configs = readAll();
    const now = new Date().toISOString();
    const config: LocalConfig = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description,
      configJson: data.configJson,
      createdAt: now,
      updatedAt: now,
    };
    configs.push(config);
    writeAll(configs);
    return config;
  },

  update(id: string, updates: Partial<Pick<LocalConfig, 'name' | 'description' | 'configJson'>>): LocalConfig | null {
    const configs = readAll();
    const idx = configs.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    configs[idx] = {
      ...configs[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    writeAll(configs);
    return configs[idx];
  },

  delete(id: string): void {
    const configs = readAll().filter((c) => c.id !== id);
    writeAll(configs);
  },
};

// ── Local Server Settings (browser-only) ─────────────────────────────────────

/**
 * Per-config local server connection settings.
 * Stored in localStorage only — never sent to the hosted API.
 */
export interface LocalServerSettings {
  /** Local server URL, e.g. "http://192.168.1.100:3000" or "http://localhost:3000" */
  url: string;
  /** Base64-encoded AES-256 encryption key from the local server */
  key: string;
}

export const localServerSettings = {
  get(configId: string): LocalServerSettings | null {
    try {
      const raw = window.localStorage.getItem(`${LOCAL_SERVER_PREFIX}${configId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set(configId: string, settings: LocalServerSettings): void {
    window.localStorage.setItem(
      `${LOCAL_SERVER_PREFIX}${configId}`,
      JSON.stringify(settings)
    );
  },

  clear(configId: string): void {
    window.localStorage.removeItem(`${LOCAL_SERVER_PREFIX}${configId}`);
  },

  /** Check if a config has local server settings configured */
  hasSettings(configId: string): boolean {
    const settings = this.get(configId);
    return !!(settings?.url && settings?.key);
  },
};
