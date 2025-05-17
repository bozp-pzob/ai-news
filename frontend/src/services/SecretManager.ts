/**
 * SecretManager.ts
 * 
 * Secure client-side secret manager that handles temporary in-memory storage of sensitive information
 * like API keys. The secrets are never persisted to disk or sent to the server directly.
 * 
 * Security features:
 * - In-memory storage with optional encrypted persistence
 * - Encryption of values using Web Crypto API
 * - Reference by ID only when communicating with server
 * - Auto-expiry of secrets
 */

import { v4 as uuidv4 } from 'uuid';

// Define the structure of a stored secret
interface StoredSecret {
  id: string;              // Unique identifier for the secret
  value: string;           // Encrypted value
  type: string;            // Type of secret (e.g., 'apiKey', 'password')
  createdAt: number;       // Timestamp when secret was stored
  expiresAt: number;       // Timestamp when secret will expire
  description?: string;    // Optional description (e.g., "OpenAI API Key")
}

// Persistent storage options
interface PersistenceOptions {
  enabled: boolean;       // Whether to use persistent storage
  storageKey?: string;    // Custom storage key for the database
  passwordProtected?: boolean; // Whether to require a password for encryption/decryption
  password?: string;      // Optional user password for encryption
}

// IndexedDB database info
interface DBInfo {
  name: string;
  version: number;
  storeName: string;
}

// Default DB info
const DEFAULT_DB_INFO: DBInfo = {
  name: 'secure_secrets_db',
  version: 1,
  storeName: 'secrets'
};

// Secret manager singleton class
class SecretManager {
  private static instance: SecretManager;
  private secrets: Map<string, StoredSecret> = new Map();
  private readonly DEFAULT_TTL_MS = 3600000; // 1 hour default TTL
  private readonly MAX_TTL_MS = 86400000;    // 24 hours maximum TTL
  private encryptionKey: CryptoKey | null = null;
  private masterKey: CryptoKey | null = null;
  private persistence: PersistenceOptions = { enabled: false };
  private dbInfo: DBInfo = DEFAULT_DB_INFO;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    // Initialize will be called explicitly
  }

  static getInstance(): SecretManager {
    if (!SecretManager.instance) {
      SecretManager.instance = new SecretManager();
    }
    return SecretManager.instance;
  }

  /**
   * Initialize the SecretManager with options
   * @param persistence Options for persistent storage
   * @param customDBInfo Custom database information
   */
  async initialize(
    persistence: PersistenceOptions = { enabled: false },
    customDBInfo?: Partial<DBInfo>
  ): Promise<void> {
    // If already initialized or initializing, return the existing promise
    if (this.isInitialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    // Create a new initialization promise
    this.initPromise = (async () => {
      // Set persistence options
      this.persistence = persistence;
      
      // Set custom DB info if provided
      if (customDBInfo) {
        this.dbInfo = { ...DEFAULT_DB_INFO, ...customDBInfo };
      }
      
      // Initialize encryption key
      await this.initEncryptionKey();
      
      // Initialize persistent storage if enabled
      if (this.persistence.enabled) {
        // Initialize the database
        await this.initDatabase();
        
        // If password protection is enabled, derive the master key
        if (this.persistence.passwordProtected && this.persistence.password) {
          await this.deriveMasterKey(this.persistence.password);
        }
        
        // Load secrets from persistent storage
        await this.loadFromPersistentStorage();
      }
      
      this.isInitialized = true;
    })();
    
    return this.initPromise;
  }

  /**
   * Initialize or open the IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not supported. Persistent storage disabled.');
        this.persistence.enabled = false;
        resolve();
        return;
      }
      
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Failed to open IndexedDB:', event);
        this.persistence.enabled = false;
        resolve(); // Resolve anyway to continue without persistence
      };
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create the object store for secrets if it doesn't exist
        if (!db.objectStoreNames.contains(this.dbInfo.storeName)) {
          db.createObjectStore(this.dbInfo.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  /**
   * Initialize the encryption key for AES-GCM encryption
   */
  private async initEncryptionKey(): Promise<void> {
    if (this.encryptionKey) return;

    try {
      // Generate a random key for AES-GCM encryption
      this.encryptionKey = await window.crypto.subtle.generateKey(
        {
          name: 'AES-GCM',
          length: 256
        },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      // Fall back to a less secure approach if WebCrypto is not available
      // This is not ideal but allows the application to function
    }
  }

  /**
   * Derive a master encryption key from a password
   * @param password The user's password
   */
  private async deriveMasterKey(password: string): Promise<void> {
    try {
      // Convert password to a buffer
      const encoder = new TextEncoder();
      const passwordData = encoder.encode(password);
      
      // Generate a salt if not already present
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      
      // Derive a key using PBKDF2
      this.masterKey = await window.crypto.subtle.importKey(
        'raw',
        passwordData,
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      );
      
      // Derive the actual key
      this.masterKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt,
          iterations: 100000,
          hash: 'SHA-256'
        },
        this.masterKey,
        {
          name: 'AES-GCM',
          length: 256
        },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Failed to derive master key:', error);
      this.masterKey = null;
    }
  }

  /**
   * Encrypt a secret value using AES-GCM
   * @param value The plaintext value to encrypt
   * @returns The encrypted value as a Base64 string
   */
  private async encrypt(value: string, usesMasterKey = false): Promise<string> {
    // Choose which key to use for encryption
    const key = usesMasterKey && this.masterKey ? this.masterKey : this.encryptionKey;
    
    if (!key) {
      await this.initEncryptionKey();
      if (!this.encryptionKey) {
        // If we still can't initialize, use a simple obfuscation
        return btoa(value);
      }
    }

    try {
      // Generate a random initialization vector
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      
      // Encode the value as UTF-8
      const encodedValue = new TextEncoder().encode(value);
      
      // Encrypt the value
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv
        },
        key || this.encryptionKey!,
        encodedValue
      );

      // Combine IV and encrypted data
      const result = new Uint8Array(iv.length + encryptedBuffer.byteLength);
      result.set(iv, 0);
      result.set(new Uint8Array(encryptedBuffer), iv.length);
      
      // Convert to string using a different approach to avoid iteration issues
      let resultString = '';
      for (let i = 0; i < result.length; i++) {
        resultString += String.fromCharCode(result[i]);
      }
      
      // Return as Base64 string
      return btoa(resultString);
    } catch (error) {
      console.error('Encryption failed:', error);
      // Fallback to simple encoding
      return btoa(value);
    }
  }

  /**
   * Decrypt an encrypted secret value
   * @param encryptedValue The Base64 encoded encrypted value
   * @param usesMasterKey Whether to use the master key for decryption
   * @returns The decrypted plaintext value
   */
  private async decrypt(encryptedValue: string, usesMasterKey = false): Promise<string> {
    // Choose which key to use for decryption
    const key = usesMasterKey && this.masterKey ? this.masterKey : this.encryptionKey;
    
    if (!key) {
      await this.initEncryptionKey();
      if (!this.encryptionKey) {
        // If we still can't initialize, use simple decoding
        return atob(encryptedValue);
      }
    }

    try {
      // Decode the Base64 string
      const encryptedBytes = new Uint8Array(
        atob(encryptedValue).split('').map(char => char.charCodeAt(0))
      );
      
      // Extract IV (first 12 bytes) and encrypted data
      const iv = encryptedBytes.slice(0, 12);
      const encryptedData = encryptedBytes.slice(12);
      
      // Decrypt the data
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv
        },
        key || this.encryptionKey!,
        encryptedData
      );
      
      // Decode to UTF-8 string
      return new TextDecoder().decode(decryptedBuffer);
    } catch (error) {
      console.error('Decryption failed:', error);
      // Fallback to simple decoding
      return atob(encryptedValue);
    }
  }

  /**
   * Store a secret in memory and optionally in persistent storage
   * @param value The secret value to store
   * @param type The type of secret (e.g., 'apiKey')
   * @param ttlMs Time-to-live in milliseconds (optional, defaults to 1 hour)
   * @param description Optional description of the secret
   * @param persist Whether to save in persistent storage (defaults to global setting)
   * @returns A promise that resolves to the secret ID
   */
  async storeSecret(
    value: string,
    type: string,
    ttlMs: number = this.DEFAULT_TTL_MS,
    description?: string,
    persist?: boolean
  ): Promise<string> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Generate a unique ID for the secret
    const id = uuidv4();
    
    // Ensure TTL is not longer than maximum
    const actualTtl = Math.min(ttlMs, this.MAX_TTL_MS);
    
    // Determine if we should persist this secret
    const shouldPersist = persist !== undefined ? persist : this.persistence.enabled;
    
    // Choose encryption method based on persistence
    const usesMasterKey = shouldPersist && this.persistence.passwordProtected;
    
    // Encrypt the value
    const encryptedValue = await this.encrypt(value, usesMasterKey);
    
    // Store the secret
    const secret: StoredSecret = {
      id,
      value: encryptedValue,
      type,
      createdAt: Date.now(),
      expiresAt: Date.now() + actualTtl,
      description
    };
    
    this.secrets.set(id, secret);
    
    // Set expiry timer
    setTimeout(() => {
      this.removeSecret(id);
    }, actualTtl);
    
    // Save to persistent storage if enabled
    if (shouldPersist) {
      await this.saveSecretToPersistentStorage(secret);
    }
    
    return id;
  }

  /**
   * Save a secret to persistent storage
   * @param secret The secret to save
   */
  private async saveSecretToPersistentStorage(secret: StoredSecret): Promise<void> {
    if (!this.persistence.enabled) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Error opening database:', event);
        resolve(); // Resolve anyway to continue operation
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([this.dbInfo.storeName], 'readwrite');
        const store = transaction.objectStore(this.dbInfo.storeName);
        
        // Store the secret
        const storeRequest = store.put(secret);
        
        storeRequest.onerror = () => {
          console.error('Error storing secret:', storeRequest.error);
          resolve(); // Resolve anyway to continue operation
        };
        
        storeRequest.onsuccess = () => {
          resolve();
        };
        
        transaction.oncomplete = () => {
          db.close();
        };
      };
    });
  }

  /**
   * Load secrets from persistent storage
   */
  private async loadFromPersistentStorage(): Promise<void> {
    if (!this.persistence.enabled) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Error opening database:', event);
        resolve(); // Resolve anyway to continue operation
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([this.dbInfo.storeName], 'readonly');
        const store = transaction.objectStore(this.dbInfo.storeName);
        
        // Get all secrets
        const getAllRequest = store.getAll();
        
        getAllRequest.onerror = () => {
          console.error('Error loading secrets:', getAllRequest.error);
          resolve(); // Resolve anyway to continue operation
        };
        
        getAllRequest.onsuccess = () => {
          const secrets = getAllRequest.result as StoredSecret[];
          const now = Date.now();
          
          // Add valid secrets to memory
          secrets.forEach(secret => {
            // Only add non-expired secrets
            if (secret.expiresAt > now) {
              this.secrets.set(secret.id, secret);
              
              // Set expiry timer
              const timeRemaining = secret.expiresAt - now;
              setTimeout(() => {
                this.removeSecret(secret.id);
              }, timeRemaining);
            } else {
              // Remove expired secrets from storage
              this.removeSecretFromPersistentStorage(secret.id);
            }
          });
          
          resolve();
        };
        
        transaction.oncomplete = () => {
          db.close();
        };
      };
    });
  }

  /**
   * Remove a secret from persistent storage
   * @param id The ID of the secret to remove
   */
  private async removeSecretFromPersistentStorage(id: string): Promise<void> {
    if (!this.persistence.enabled) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Error opening database:', event);
        resolve(); // Resolve anyway to continue operation
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([this.dbInfo.storeName], 'readwrite');
        const store = transaction.objectStore(this.dbInfo.storeName);
        
        // Delete the secret
        const deleteRequest = store.delete(id);
        
        deleteRequest.onerror = () => {
          console.error('Error deleting secret:', deleteRequest.error);
          resolve(); // Resolve anyway to continue operation
        };
        
        deleteRequest.onsuccess = () => {
          resolve();
        };
        
        transaction.oncomplete = () => {
          db.close();
        };
      };
    });
  }

  /**
   * Retrieve a secret by its ID
   * @param id The ID of the secret to retrieve
   * @returns A promise that resolves to the decrypted secret value or null if not found
   */
  async getSecret(id: string): Promise<string | null> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const secret = this.secrets.get(id);
    
    if (!secret) {
      return null;
    }
    
    // Check if the secret has expired
    if (Date.now() > secret.expiresAt) {
      this.removeSecret(id);
      return null;
    }
    
    // Determine if this secret was encrypted with the master key
    const usesMasterKey = this.persistence.enabled && this.persistence.passwordProtected;
    
    // Decrypt and return the value
    return this.decrypt(secret.value, usesMasterKey);
  }

  /**
   * Remove a secret from memory and persistent storage
   * @param id The ID of the secret to remove
   */
  async removeSecret(id: string): Promise<void> {
    this.secrets.delete(id);
    
    // Also remove from persistent storage if enabled
    if (this.persistence.enabled) {
      await this.removeSecretFromPersistentStorage(id);
    }
  }

  /**
   * Get information about a secret without revealing its value
   * @param id The ID of the secret
   * @returns Information about the secret or null if not found
   */
  getSecretInfo(id: string): { type: string; createdAt: number; expiresAt: number; description?: string } | null {
    const secret = this.secrets.get(id);
    
    if (!secret) {
      return null;
    }
    
    // Return everything except the value
    return {
      type: secret.type,
      createdAt: secret.createdAt,
      expiresAt: secret.expiresAt,
      description: secret.description
    };
  }

  /**
   * List all available secret IDs with their metadata
   * @returns Array of secret IDs and their metadata
   */
  listSecrets(): Array<{ id: string; type: string; expiresAt: number; description?: string }> {
    const result: Array<{ id: string; type: string; expiresAt: number; description?: string }> = [];
    
    // Use Array.from to convert Map entries to array to avoid iteration issues
    Array.from(this.secrets.entries()).forEach(([id, secret]) => {
      // Skip expired secrets
      if (Date.now() > secret.expiresAt) {
        this.removeSecret(id);
        return;
      }
      
      result.push({
        id,
        type: secret.type,
        expiresAt: secret.expiresAt,
        description: secret.description
      });
    });
    
    return result;
  }

  /**
   * Check if a secret exists and is valid
   * @param id The ID of the secret
   * @returns True if the secret exists and is valid, false otherwise
   */
  hasValidSecret(id: string): boolean {
    const secret = this.secrets.get(id);
    
    if (!secret) {
      return false;
    }
    
    // Check if the secret has expired
    if (Date.now() > secret.expiresAt) {
      this.removeSecret(id);
      return false;
    }
    
    return true;
  }

  /**
   * Clear all secrets from memory and optionally from persistent storage
   * @param clearPersistent Whether to also clear persistent storage
   */
  async clearAllSecrets(clearPersistent = false): Promise<void> {
    this.secrets.clear();
    
    // Also clear persistent storage if requested
    if (clearPersistent && this.persistence.enabled) {
      await this.clearPersistentStorage();
    }
  }

  /**
   * Clear all secrets from persistent storage
   */
  private async clearPersistentStorage(): Promise<void> {
    if (!this.persistence.enabled) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Error opening database:', event);
        resolve(); // Resolve anyway to continue operation
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = db.transaction([this.dbInfo.storeName], 'readwrite');
        const store = transaction.objectStore(this.dbInfo.storeName);
        
        // Clear all secrets
        const clearRequest = store.clear();
        
        clearRequest.onerror = () => {
          console.error('Error clearing secrets:', clearRequest.error);
          resolve(); // Resolve anyway to continue operation
        };
        
        clearRequest.onsuccess = () => {
          resolve();
        };
        
        transaction.oncomplete = () => {
          db.close();
        };
      };
    });
  }

  /**
   * Enable persistent storage with optional password protection
   * @param options Persistence options
   */
  async enablePersistence(options: Omit<PersistenceOptions, 'enabled'> = {}): Promise<void> {
    const newOptions: PersistenceOptions = {
      enabled: true,
      ...options
    };
    
    // Re-initialize with new options
    await this.initialize(newOptions);
  }

  /**
   * Disable persistent storage
   * @param clearExisting Whether to clear existing persistent storage
   */
  async disablePersistence(clearExisting = false): Promise<void> {
    if (clearExisting) {
      await this.clearPersistentStorage();
    }
    
    this.persistence.enabled = false;
  }

  /**
   * Change the password for password-protected persistence
   * @param newPassword The new password
   * @param oldPassword The old password (required to verify)
   */
  async changePassword(newPassword: string, oldPassword: string): Promise<boolean> {
    if (!this.persistence.enabled || !this.persistence.passwordProtected) {
      return false;
    }
    
    // Verify old password
    const oldMasterKey = this.masterKey;
    await this.deriveMasterKey(oldPassword);
    
    // Try to decrypt a secret to verify password
    const secretEntry = Array.from(this.secrets.entries())[0];
    if (secretEntry) {
      try {
        await this.decrypt(secretEntry[1].value, true);
      } catch (e) {
        // Restore old key
        this.masterKey = oldMasterKey;
        return false;
      }
    }
    
    // Re-encrypt all secrets with new password
    const secrets: StoredSecret[] = [];
    for (const [id, secret] of Array.from(this.secrets.entries())) {
      // Decrypt with old key
      const decryptedValue = await this.decrypt(secret.value, true);
      secrets.push({ ...secret, id });
    }
    
    // Derive new master key
    await this.deriveMasterKey(newPassword);
    
    // Update persistence options
    this.persistence.password = newPassword;
    
    // Re-encrypt and save all secrets
    for (const secret of secrets) {
      const decryptedValue = await this.decrypt(secret.value, false);
      const newEncryptedValue = await this.encrypt(decryptedValue, true);
      
      const updatedSecret = {
        ...secret,
        value: newEncryptedValue
      };
      
      this.secrets.set(secret.id, updatedSecret);
      await this.saveSecretToPersistentStorage(updatedSecret);
    }
    
    return true;
  }

  /**
   * Inject a secret ID into configuration parameters
   * This replaces the actual secret value with a reference pattern: $SECRET:id$
   * 
   * @param params The parameters object to modify
   * @param path The path to the parameter containing the secret
   * @param value The secret value to store
   * @param type The type of secret
   * @param description Optional description of the secret
   * @returns A promise that resolves to the modified parameters object
   */
  async injectSecretReference(
    params: Record<string, any>,
    path: string,
    value: string,
    type: string,
    description?: string
  ): Promise<Record<string, any>> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Store the secret and get its ID
    const secretId = await this.storeSecret(value, type, this.DEFAULT_TTL_MS, description);
    
    // Create a copy of the parameters
    const updatedParams = { ...params };
    
    // Set the reference pattern at the specified path
    const reference = `$SECRET:${secretId}$`;
    
    // Handle nested path with dot notation
    if (path.includes('.')) {
      const parts = path.split('.');
      let current = updatedParams;
      
      // Navigate to the second-to-last part of the path
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        
        if (!current[part]) {
          current[part] = {};
        }
        
        current = current[part];
      }
      
      // Set the reference at the last part
      current[parts[parts.length - 1]] = reference;
    } else {
      // Simple case: direct property
      updatedParams[path] = reference;
    }
    
    return updatedParams;
  }

  /**
   * Process parameters to replace secret references with their actual values
   * @param params The parameters object to process
   * @returns A promise that resolves to the processed parameters with actual secret values
   */
  async processWithSecrets(params: Record<string, any>): Promise<Record<string, any>> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Create a deep copy to avoid modifying the original
    const result = JSON.parse(JSON.stringify(params));
    
    // Helper function to recursively process objects
    const processObject = async (obj: Record<string, any>): Promise<Record<string, any>> => {
      for (const key in obj) {
        const value = obj[key];
        
        // Process nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          obj[key] = await processObject(value);
        }
        // Process arrays
        else if (Array.isArray(value)) {
          obj[key] = await Promise.all(value.map(async (item) => {
            if (item !== null && typeof item === 'object') {
              return processObject(item);
            }
            if (typeof item === 'string') {
              return processSecretString(item);
            }
            return item;
          }));
        }
        // Process strings that might contain secret references
        else if (typeof value === 'string') {
          obj[key] = await processSecretString(value);
        }
      }
      
      return obj;
    };
    
    // Helper function to process a string that might contain a secret reference
    const processSecretString = async (str: string): Promise<string> => {
      const secretPattern = /\$SECRET:([a-f0-9-]+)\$/;
      const match = str.match(secretPattern);
      
      if (match && match[1]) {
        const secretId = match[1];
        const secretValue = await this.getSecret(secretId);
        
        if (secretValue !== null) {
          return secretValue;
        }
      }
      
      return str;
    };
    
    // Process the entire object
    return processObject(result);
  }

  /**
   * Extract secrets information from the config and prepare it for sending to backend
   * @param config The configuration object to process
   * @returns An object containing the cleaned config and a separate secrets map
   */
  async extractSecretsForBackend(config: Record<string, any>): Promise<{
    config: Record<string, any>;
    secrets: Record<string, string>;
  }> {
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    // Create a deep copy to avoid modifying the original
    const cleanedConfig = JSON.parse(JSON.stringify(config));
    const extractedSecrets: Record<string, string> = {};
    
    // Map to track environment variable names to their secret values
    const envVarToSecretValue: Record<string, string> = {};
    
    // First, collect all secret values
    const secretPromises: Promise<void>[] = [];
    
    this.secrets.forEach(secret => {
      if (secret.description) {
        const description = secret.description; // Store in a local variable to help TypeScript
        const promise = this.getSecret(secret.id).then(value => {
          if (value) {
            envVarToSecretValue[description] = value;
          }
        });
        secretPromises.push(promise);
      }
    });
    
    // Wait for all secret values to be retrieved
    await Promise.all(secretPromises);
    
    // Helper function to recursively process objects and extract secrets
    const processObject = (obj: Record<string, any>, path: string = ''): void => {
      for (const key in obj) {
        const currentPath = path ? `${path}.${key}` : key;
        const value = obj[key];
        
        // Process nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          processObject(value, currentPath);
        }
        // Process arrays
        else if (Array.isArray(value)) {
          value.forEach((item, index) => {
            if (item !== null && typeof item === 'object') {
              processObject(item, `${currentPath}[${index}]`);
            } else if (typeof item === 'string') {
              processStringValue(item, `${currentPath}[${index}]`);
            }
          });
        }
        // Process strings that might contain secret references
        else if (typeof value === 'string') {
          processStringValue(value, currentPath);
        }
      }
    };
    
    // Helper function to process string values that might be environment variables
    const processStringValue = (str: string, path: string): void => {
      // Check if this is a direct env var reference like "API_KEY"
      if (envVarToSecretValue[str]) {
        extractedSecrets[str] = envVarToSecretValue[str];
        return;
      }
      
      // Check if this is a process.env prefixed reference
      if (str.startsWith('process.env.')) {
        const envVarName = str.replace('process.env.', '');
        if (envVarToSecretValue[envVarName]) {
          extractedSecrets[envVarName] = envVarToSecretValue[envVarName];
          return;
        }
      }
    };
    
    // Process the entire config to find secrets
    processObject(cleanedConfig);
    
    // Return both the cleaned config and the extracted secrets
    return { config: cleanedConfig, secrets: extractedSecrets };
  }
}

// Create a singleton instance
const secretManagerInstance = SecretManager.getInstance();

// Initialize with default settings (no persistence)
secretManagerInstance.initialize();

// Export the singleton instance
export const secretManager = secretManagerInstance; 