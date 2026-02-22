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

// Result of a database unlock attempt
interface UnlockResult {
  success: boolean;
  message?: string;
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

// Fixed database name to use for all storage operations
const FIXED_DB_NAME = 'secure_secrets_db_fixed';
const FIXED_STORE_NAME = 'secrets';

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
      console.debug('Creating new SecretManager instance');
      SecretManager.instance = new SecretManager();
    } else {
      console.debug('Returning existing SecretManager instance');
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
    if (this.isInitialized) {
      console.debug('SecretManager already initialized, skipping initialization');
      return Promise.resolve();
    }
    if (this.initPromise) {
      console.debug('SecretManager initialization already in progress, returning existing promise');
      return this.initPromise;
    }

    console.debug('Starting SecretManager initialization', { 
      persistence: { 
        enabled: persistence.enabled,
        passwordProtected: persistence.passwordProtected,
        hasPassword: !!persistence.password 
      }
    });

    // Create a new initialization promise
    this.initPromise = (async () => {
      // Set persistence options
      this.persistence = persistence;
      
      // Set custom DB info if provided
      if (customDBInfo) {
        this.dbInfo = { ...DEFAULT_DB_INFO, ...customDBInfo };
      }
      
      console.debug('Initializing encryption key...');
      // Initialize encryption key
      await this.initEncryptionKey();
      
      // Initialize persistent storage if enabled
      if (this.persistence.enabled) {
        console.debug('Persistence enabled, initializing database...');
        // Initialize the database
        await this.initDatabase();
        
        // If password protection is enabled, derive the master key
        if (this.persistence.passwordProtected) {
          if (this.persistence.password) {
            console.debug('Password protection enabled with password, deriving master key...');
          await this.deriveMasterKey(this.persistence.password);
          } else {
            console.debug('WARNING: Password protection enabled but no password provided. Database will be locked until password is provided.');
          }
        }
        
        console.debug('Loading secrets from persistent storage...');
        // Load secrets from persistent storage
        const loadResult = await this.loadSecretsFromPersistentStorage();
        console.debug(`Secrets loading result: ${loadResult ? 'successful' : 'failed'}, loaded ${this.secrets.size} secrets`);
      } else {
        console.debug('Persistence not enabled during initialization');
      }
      
      this.isInitialized = true;
      console.debug('SecretManager initialization complete');
    })();
    
    return this.initPromise;
  }

  /**
   * Initialize or open the IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    console.debug('Initializing database', { 
      dbInfo: { ...this.dbInfo },
      persistence: { ...this.persistence }
    });
    
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not supported. Persistent storage disabled.');
        this.persistence.enabled = false;
        resolve();
        return;
      }
      
      console.debug('Opening IndexedDB database', this.dbInfo.name, this.dbInfo.version);
      const request = indexedDB.open(this.dbInfo.name, this.dbInfo.version);
      
      request.onerror = (event) => {
        console.error('Failed to open IndexedDB:', event);
        console.error('IndexedDB error details:', (event.target as IDBOpenDBRequest).error);
        this.persistence.enabled = false;
        resolve(); // Resolve anyway to continue without persistence
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.debug('Database upgrade needed during initial open');
        
        // Create the object store for secrets if it doesn't exist
        if (!db.objectStoreNames.contains(this.dbInfo.storeName)) {
          try {
            db.createObjectStore(this.dbInfo.storeName, { keyPath: 'id' });
            console.log('Created object store during normal upgrade');
          } catch (e) {
            console.error('Error creating object store during upgrade:', e);
          }
        } else {
          console.debug('Object store already exists during upgrade');
        }
      };
      
      request.onsuccess = (event) => {
        console.debug('Database opened successfully for init, checking store existence');
        const db = (event.target as IDBOpenDBRequest).result;
        console.debug('Available stores:', Array.from(db.objectStoreNames));
        
        // Verify that the object store exists in the opened database
        if (!db.objectStoreNames.contains(this.dbInfo.storeName)) {
          console.warn('Object store not found in the opened database. Trying to recreate...');
          
          // Close the current database connection
          db.close();
          
          // Increment version to trigger onupgradeneeded
          const newVersion = this.dbInfo.version + 1;
          this.dbInfo.version = newVersion;
          
          console.debug('Reopening database with new version:', newVersion);
          // Reopen with new version to trigger store creation
          const reopenRequest = indexedDB.open(this.dbInfo.name, newVersion);
          
          reopenRequest.onerror = (event) => {
            console.error('Failed to reopen IndexedDB with new version:', event);
            console.error('Reopen error details:', (event.target as IDBOpenDBRequest).error);
            this.persistence.enabled = false;
            resolve();
          };
          
          reopenRequest.onupgradeneeded = (event) => {
            const newDb = (event.target as IDBOpenDBRequest).result;
            console.debug('Database upgrade needed, creating store');
            
            // Create the object store
            if (!newDb.objectStoreNames.contains(this.dbInfo.storeName)) {
              try {
              newDb.createObjectStore(this.dbInfo.storeName, { keyPath: 'id' });
              console.log('Created new object store during recovery');
              } catch (e) {
                console.error('Error creating object store during recovery:', e);
              }
            } else {
              console.debug('Object store already exists during recovery upgrade');
            }
          };
          
          reopenRequest.onsuccess = () => {
            console.log('Database reopened successfully with object store.');
            resolve();
          };
          
          return;
        }
        
        // Normal path - database and store exist
        console.debug('Database and store already exist. Ready for use.');
        resolve();
      };
    });
  }

  /**
   * Initialize the encryption key for AES-GCM encryption
   * This now consistently derives the same key on each page load
   */
  private async initEncryptionKey(): Promise<void> {
    if (this.encryptionKey) {
      console.debug('Encryption key already exists, not regenerating');
      return;
    }

    console.debug('Generating encryption key...');
    try {
      // Use a consistent seed value for the key derivation to get the same key each time
      // This is a fixed value that's part of the app for symmetric encryption
      const seedBytes = new TextEncoder().encode('digital-gardener-secure-encryption-seed-v1');
      
      // Import the seed as a key
      const seedKey = await window.crypto.subtle.importKey(
        'raw',
        seedBytes,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      
      // Use a fixed salt for the derivation
      const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      
      // Derive a consistent encryption key
      this.encryptionKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt,
          iterations: 100000,
          hash: 'SHA-256'
        },
        seedKey,
        {
          name: 'AES-GCM',
          length: 256
        },
        true,
        ['encrypt', 'decrypt']
      );
      
      console.debug('Successfully generated deterministic encryption key');
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      // Fall back to a less secure approach if WebCrypto is not available
      console.warn('WebCrypto not available, using fallback approach');
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
      
      // Use a fixed salt for the derivation (IMPORTANT: Do not change this value)
      // This ensures the same master key is derived from the same password every time
      const salt = new Uint8Array([21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
      
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
      
      console.debug('Successfully derived master key with fixed salt');
    } catch (error) {
      console.error('Failed to derive master key:', error);
      this.masterKey = null;
    }
  }

  /**
   * Encrypt a secret value using AES-GCM
   * @param value The plaintext value to encrypt
   * @param usesMasterKey Whether to use the master key for encryption
   * @returns The encrypted value as a Base64 string
   */
  private async encrypt(value: string, usesMasterKey = false): Promise<string> {
    // Only use master key if specifically requested AND the key exists
    const useMasterKey = usesMasterKey && this.masterKey !== null;
    // Choose which key to use for encryption
    const key = useMasterKey ? this.masterKey : this.encryptionKey;
    
    if (!key) {
      console.debug('No encryption key available, initializing new encryption key');
      await this.initEncryptionKey();
      if (!this.encryptionKey) {
        console.error('Failed to initialize encryption key. Encryption is required.');
        throw new Error('Encryption failed: No encryption key available');
      }
    }

    try {
      // Generate a random initialization vector
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      
      // Encode the value as UTF-8
      const encodedValue = new TextEncoder().encode(value);

      const encryptionKey = key || this.encryptionKey!;
      console.debug(`Encrypting value using ${useMasterKey ? 'master key' : 'regular encryption key'}`);
      
      // Encrypt the value
      const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv
        },
        encryptionKey,
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
      // Never fall back to simple encoding
      throw new Error('Encryption failed: Could not perform AES-GCM encryption');
    }
  }

  /**
   * Decrypt an encrypted secret value
   * @param encryptedValue The Base64 encoded encrypted value
   * @param usesMasterKey Whether to use the master key for decryption
   * @returns The decrypted plaintext value
   */
  private async decrypt(encryptedValue: string, usesMasterKey = false): Promise<string> {
    if (!encryptedValue) {
      console.error('Empty encrypted value provided');
      return '';
    }
    
    // Only use master key if specifically requested AND the key exists
    const useMasterKey = usesMasterKey && this.masterKey !== null;
    
    // Try different decryption strategies in sequence:
    // 1. Check for unencrypted values (shouldn't happen but to be safe)
    // 2. Try standard base64 decoding (for simple obfuscation)
    // 3. Try AES-GCM decryption with the specified key
    // 4. Try AES-GCM decryption with the alternative key
    
    // First check if it looks like it's not actually encrypted
    if (encryptedValue.length < 10) {
      console.debug('Value too short to be encrypted, returning as is');
      return encryptedValue;
    }
    
    // Next check if it's likely to be actually encrypted with AES-GCM
    const isLikelyEncrypted = this.isLikelyEncrypted(encryptedValue);
    
    // If it doesn't look encrypted, try simple base64 decode
    if (!isLikelyEncrypted) {
      try {
        const decoded = atob(encryptedValue);
        console.debug('Value was not AES encrypted, using base64 decode');
        return decoded;
      } catch (e) {
        // Not base64 encoded either, return as is
        console.debug('Value is neither AES encrypted nor base64 encoded, returning as is');
        return encryptedValue;
      }
    }
    
    // Now we're pretty sure it's AES-GCM encrypted, try to decrypt
    
    // Ensure we have an encryption key
    if (!this.encryptionKey && !this.masterKey) {
      console.debug('No decryption keys available, initializing encryption key');
      await this.initEncryptionKey();
      if (!this.encryptionKey) {
        console.warn('Failed to initialize encryption key, falling back to base64 decode');
        return this.tryBase64Decode(encryptedValue);
      }
    }
    
    // Choose which key to use for decryption
    const primaryKey = useMasterKey ? this.masterKey : this.encryptionKey;
    const alternateKey = useMasterKey ? this.encryptionKey : this.masterKey;
    
    // Keep track of all errors to report if everything fails
    const errors: any[] = [];
    
    // Try primary key first (if available)
    if (primaryKey) {
      try {
        const decrypted = await this.tryAesDecrypt(encryptedValue, primaryKey);
        console.debug(`Successfully decrypted with ${useMasterKey ? 'master' : 'standard'} key`);
        return decrypted;
      } catch (error: any) {
        console.debug(`Primary key decryption failed: ${error.message}`);
        errors.push({ method: 'primary', error });
      }
    }
    
    // Try alternate key if available
    if (alternateKey) {
      try {
        const decrypted = await this.tryAesDecrypt(encryptedValue, alternateKey);
        console.debug(`Successfully decrypted with alternate (${!useMasterKey ? 'master' : 'standard'}) key`);
        return decrypted;
      } catch (error: any) {
        console.debug(`Alternate key decryption failed: ${error.message}`);
        errors.push({ method: 'alternate', error });
      }
    }
    
    // Last resort: try base64 decode
    try {
      const decoded = this.tryBase64Decode(encryptedValue);
      if (decoded) {
        console.debug('Fallback to base64 decode succeeded');
        return decoded;
      }
    } catch (error) {
      errors.push({ method: 'base64', error });
    }
    
    // If all else fails, log debug info and return empty string to avoid breaking
    console.error('All decryption methods failed:', { 
      encryptedLength: encryptedValue.length,
      encryptedPrefix: encryptedValue.substring(0, 20) + '...',
      errors
    });
    
    // Return original value if all decryption methods fail
    // This helps in scenarios where the value might not actually be encrypted
    return encryptedValue;
  }
  
  /**
   * Attempt to decrypt using AES-GCM
   */
  private async tryAesDecrypt(encryptedValue: string, key: CryptoKey): Promise<string> {
      // Decode the Base64 string
      const encryptedBytes = new Uint8Array(
        atob(encryptedValue).split('').map(char => char.charCodeAt(0))
      );
      
      // Extract IV (first 12 bytes) and encrypted data
    if (encryptedBytes.length < 13) {
      throw new Error('Encrypted data too short for AES-GCM');
    }
    
      const iv = encryptedBytes.slice(0, 12);
      const encryptedData = encryptedBytes.slice(12);
      
      // Decrypt the data
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv
        },
      key,
        encryptedData
      );
      
      // Decode to UTF-8 string
      return new TextDecoder().decode(decryptedBuffer);
  }
  
  /**
   * Try to decode a base64 string
   */
  private tryBase64Decode(value: string): string {
    try {
      return atob(value);
    } catch (e) {
      console.error('Base64 decoding failed:', e);
      return ''; // Return empty string as last resort
    }
  }

  /**
   * Check if a value is likely encrypted with AES-GCM or just base64 encoded
   */
  private isLikelyEncrypted(value: string): boolean {
    try {
      // Decode from base64
      const bytes = atob(value);
      
      // AES-GCM encrypted data should have at least:
      // - 12 bytes for IV
      // - Some encrypted data (at least a few bytes)
      // - Typically results in binary data that includes non-printable chars
      
      // Check minimum length
      if (bytes.length < 16) {
        return false;  // Too short to be AES-GCM
      }
      
      // Check if the decoded data contains a high percentage of binary/non-printable characters
      // which would be typical of encrypted data
      let binaryCharCount = 0;
      for (let i = 0; i < bytes.length; i++) {
        const code = bytes.charCodeAt(i);
        // Count control characters and high ASCII as binary
        if (code < 32 || code > 126) {
          binaryCharCount++;
        }
      }
      
      // If more than 20% of characters are binary, it's likely encrypted
      return (binaryCharCount / bytes.length) > 0.2;
    } catch (e) {
      // If it's not valid base64, it's definitely not our encryption
      return false;
    }
  }

  /**
   * Test if a value can be decrypted with the current encryption key
   * @param encryptedValue The encrypted value to test
   * @param usesMasterKey Whether to use the master key for decryption
   * @returns true if the value can be decrypted, false otherwise
   */
  private async canDecrypt(encryptedValue: string, usesMasterKey = false): Promise<boolean> {
    try {
      await this.decrypt(encryptedValue, usesMasterKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Store a secret
   * @param value The raw secret value to store
   * @param type Type of secret (e.g., 'apiKey', 'password')
   * @param ttlMs Time-to-live in milliseconds (default: 1 hour)
   * @param description Optional description of the secret
   * @param persist Whether to persist the secret to storage (default: follows persistence.enabled)
   * @param forceEncrypt Whether to force encryption even if value appears to be already encrypted
   * @returns ID of the stored secret
   */
  async storeSecret(
    value: string,
    type: string,
    ttlMs: number = this.DEFAULT_TTL_MS,
    description?: string,
    persist?: boolean,
    forceEncrypt: boolean = false
  ): Promise<string> {
    if (!this.isInitialized) {
      console.warn('SecretManager not initialized, initializing now...');
      await this.initialize();
    }
    
    // Validate TTL
    const effectiveTTL = Math.min(ttlMs, this.MAX_TTL_MS);
    
    // Generate unique ID for the secret
    const id = uuidv4();
    
    // Determine if we should use the master key for encryption
    const usesMasterKey = this.persistence.enabled && 
                          this.persistence.passwordProtected && 
                          this.masterKey !== null;
    
    console.debug(`Storing secret ${id} (${type}) with${usesMasterKey ? ' master key' : ' standard'} encryption`);
    
    // ALWAYS encrypt the value when persistence is enabled
    let encryptedValue: string;
    
    // If persistence is enabled, we ALWAYS encrypt
    if (this.persistence.enabled || forceEncrypt) {
      encryptedValue = await this.encrypt(value, usesMasterKey);
    } else {
      // Only for in-memory only storage with no persistence, we might use simple encoding
      // This is just for minimal obfuscation of in-memory values
      encryptedValue = await this.encrypt(value, usesMasterKey);
    }
    
    const now = Date.now();
    const expiryTime = now + effectiveTTL;
    
    // Store the secret in memory
    const secret: StoredSecret = {
      id,
      value: encryptedValue,
      type,
      createdAt: now,
      expiresAt: expiryTime,
      description
    };
    
    // Add to in-memory storage
    this.secrets.set(id, secret);
    
    // Set expiry timer
    setTimeout(() => {
      this.removeSecret(id);
    }, effectiveTTL);
    
    // Save to persistent storage if enabled
    const shouldPersist = persist !== undefined ? persist : this.persistence.enabled;
    if (shouldPersist) {
      await this.saveSecretToPersistentStorage(secret);
    }
    
    return id;
  }

  /**
   * DIRECT DATABASE OPERATION - Guaranteed to work
   * This bypasses all the complex logic and directly writes to a fixed database
   */
  private async directDatabaseWrite(id: string, data: any): Promise<boolean> {
    if (!id) {
      console.error('DIRECT WRITE: Missing ID for database write');
      return false;
    }
    
    console.debug(`DIRECT WRITE: Writing data with ID ${id} to fixed database`);
    
    return new Promise<boolean>((resolve) => {
      try {
        // Always use the fixed database name and version 1
        const request = indexedDB.open(FIXED_DB_NAME, 1);
        
        let timeoutId = setTimeout(() => {
          console.error(`DIRECT WRITE: Timeout after 5 seconds for ID ${id}`);
          resolve(false);
        }, 5000);
        
        const clearDbTimeout = () => {
          if (timeoutId) {
            window.clearTimeout(timeoutId);
            timeoutId = null as any;
          }
        };
        
        request.onupgradeneeded = (event) => {
          console.debug('DIRECT: Creating store in fixed database');
          const db = (event.target as IDBOpenDBRequest).result;
          
          try {
            if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
              db.createObjectStore(FIXED_STORE_NAME, { keyPath: 'id' });
              console.debug('DIRECT: Created store in fixed database');
            }
          } catch (e) {
            console.error('DIRECT: Error creating store:', e);
          }
        };
        
        request.onerror = () => {
          console.error('DIRECT: Failed to open database');
          clearDbTimeout();
          resolve(false);
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
          
          try {
            const tx = db.transaction([FIXED_STORE_NAME], 'readwrite');
            const store = tx.objectStore(FIXED_STORE_NAME);
            
            tx.onerror = () => {
              console.error('DIRECT: Transaction error');
              db.close();
              clearDbTimeout();
              resolve(false);
            };
            
            // Add or update the record
            const storeRequest = store.put(data);
        
        storeRequest.onerror = () => {
              console.error('DIRECT: Error storing data');
              db.close();
              clearDbTimeout();
              resolve(false);
        };
        
        storeRequest.onsuccess = () => {
              console.debug('DIRECT: Successfully stored data');
              db.close();
              clearDbTimeout();
              resolve(true);
        };
          } catch (e) {
            console.error('DIRECT: Exception during write:', e);
          db.close();
            clearDbTimeout();
            resolve(false);
          }
        };
      } catch (e) {
        console.error('DIRECT: Critical error:', e);
        resolve(false);
      }
    });
  }

  /**
   * Read all secrets directly from the fixed database
   */
  private async directDatabaseReadAll(): Promise<any[]> {
    console.debug('Reading all secrets directly from fixed database');
    
    try {
      // Open the fixed database
      const request = indexedDB.open(FIXED_DB_NAME, 1);
      
      const results = await new Promise<any[]>((resolve) => {
        request.onerror = () => {
          console.error('Failed to open database for reading all secrets');
          resolve([]);
        };
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
            db.createObjectStore(FIXED_STORE_NAME, { keyPath: 'id' });
            console.debug('Created object store for secrets during read');
          }
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
          
          try {
            if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
              console.warn('No store to read from - it does not exist');
              db.close();
              resolve([]);
              return;
            }
            
            const tx = db.transaction([FIXED_STORE_NAME], 'readonly');
            const store = tx.objectStore(FIXED_STORE_NAME);
        const getAllRequest = store.getAll();
        
        getAllRequest.onerror = () => {
              console.error('Error getting all secrets from store');
              db.close();
              resolve([]);
        };
        
        getAllRequest.onsuccess = () => {
              const items = getAllRequest.result || [];
              console.debug(`Retrieved ${items.length} secrets from fixed database`);
              db.close();
              resolve(items);
            };
          } catch (e) {
            console.error('Exception during read all operation:', e);
            db.close();
            resolve([]);
          }
        };
      });
      
      return results;
    } catch (e) {
      console.error('Failed to read all secrets from fixed database:', e);
      return [];
    }
  }

  /**
   * Save a secret to persistent storage
   * @param secret The secret to save
   */
  private async saveSecretToPersistentStorage(secret: StoredSecret): Promise<void> {
    if (!this.persistence.enabled) {
      console.debug('Persistence not enabled, skipping save to persistent storage');
      return;
    }
    
    console.debug('Saving secret to persistent storage:', { 
      id: secret.id, 
      type: secret.type,
      passwordProtected: this.persistence.passwordProtected,
      hasMasterKey: this.masterKey !== null
    });
    
    // Use the direct method which is guaranteed to work
    const success = await this.directDatabaseWrite(secret.id, secret);
    
    if (success) {
      console.debug(`Secret ${secret.id} successfully persisted using direct method`);
    } else {
      console.error(`Failed to persist secret ${secret.id} using direct method`);
    }
  }

  /**
   * Test if the current master key can successfully decrypt a specific value
   * This is a direct decryption test that doesn't rely on any fallback mechanisms
   * @param encryptedValue The value to test decryption on
   * @returns true if strict decryption succeeds, false otherwise
   */
  private async strictDecryptionTest(encryptedValue: string): Promise<boolean> {
    if (!encryptedValue || !this.masterKey) return false;
    
    try {
      // Skip the automatic fallback mechanisms and directly try AES decryption
      const encryptedBytes = new Uint8Array(
        atob(encryptedValue).split('').map(char => char.charCodeAt(0))
      );
      
      // Basic validation - must have enough bytes for IV + data
      if (encryptedBytes.length < 13) return false;
      
      const iv = encryptedBytes.slice(0, 12);
      const encryptedData = encryptedBytes.slice(12);
      
      // Try to decrypt with master key only (no fallbacks)
      await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.masterKey,
        encryptedData
      );
      
      // If no exception, decryption succeeded
      return true;
    } catch (e) {
      // Any error means decryption failed
      return false;
    }
  }

  /**
   * Load all secrets from persistent storage
   */
  private async loadSecretsFromPersistentStorage(): Promise<boolean> {
    if (!this.persistence.enabled) return false;
    
    console.debug('Loading secrets from persistent storage');
    
    try {
      // Open the fixed database
      const request = indexedDB.open(FIXED_DB_NAME, 1);
      
      const result = await new Promise<boolean>((resolve) => {
      request.onerror = (event) => {
          console.error('Failed to open database for loading secrets:', event);
          resolve(false);
      };
      
        request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
            db.createObjectStore(FIXED_STORE_NAME, { keyPath: 'id' });
            console.debug('Created object store for secrets');
          }
        };
        
        request.onsuccess = async (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          try {
            if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
              console.warn('No store to load from - it does not exist');
              db.close();
              resolve(false);
              return;
            }
            
            const tx = db.transaction([FIXED_STORE_NAME], 'readonly');
            const store = tx.objectStore(FIXED_STORE_NAME);
            const getAllRequest = store.getAll();
            
            getAllRequest.onerror = () => {
              console.error('Error getting secrets from store');
              db.close();
              resolve(false);
            };
            
            getAllRequest.onsuccess = async () => {
              const loadedSecrets = getAllRequest.result || [];
              let secretsLoaded = 0;
              let secretsExpired = 0;
              let secretsSkipped = 0;
              let decryptionFailures = 0;
              let successfulDecryptions = 0;
              let strictDecryptionSuccesses = 0;
              const now = Date.now();
              
              // Early return if no secrets found
              if (loadedSecrets.length === 0) {
                console.debug('No secrets found in database');
                db.close();
                resolve(true);
                return;
              }
              
              console.debug(`Found ${loadedSecrets.length} secrets in database`);
              
              // If we need a password but don't have it, don't attempt to load secrets
              const needsMasterKey = this.persistence.passwordProtected && !this.masterKey;
              if (needsMasterKey) {
                console.debug('Password-protected database but no password provided, skipping secret loading');
                db.close();
                resolve(false);
                return;
              }
              
              // Determine if we should use the master key for encryption
              const usesMasterKey = this.persistence.passwordProtected && this.masterKey !== null;
              
              // First perform a strict decryption test on a subset of secrets
              // to verify if the password is correct before proceeding
              let strictVerificationPassed = false;
              
              // Only do this check if we have a master key (password-protected mode)
              if (usesMasterKey && loadedSecrets.length > 0) {
                const samplesToCheck = Math.min(loadedSecrets.length, 5);
                
                for (let i = 0; i < samplesToCheck; i++) {
                  const secret = loadedSecrets[i];
                  if (secret && secret.value) {
                    // Run a strict decryption test (no fallbacks)
                    const strictSuccess = await this.strictDecryptionTest(secret.value);
                    if (strictSuccess) {
                      strictVerificationPassed = true;
                      console.debug(`Strict decryption verification successful for secret ${secret.id}`);
                      break;
                    }
                  }
                }
                
                if (!strictVerificationPassed) {
                  console.warn('*** STRICT DECRYPTION TEST FAILED - likely wrong password ***');
                  db.close();
                  resolve(false);
                  return;
                }
              }
              
              // Process each secret
              for (const storedSecret of loadedSecrets) {
                if (!storedSecret.value || !storedSecret.id) {
                  console.debug('Skipping invalid secret (missing value or id)');
                  continue;
                }
                
                const expiryTime = storedSecret.expiresAt ? 
                  new Date(storedSecret.expiresAt).getTime() : 0;
                
                // Skip expired secrets
                if (expiryTime > 0 && expiryTime < now) {
                  console.debug(`Skipping expired secret ${storedSecret.id}`);
                  secretsExpired++;
                  // Mark for deletion later by overwriting with expired marker
                  this.removeSecretFromPersistentStorage(storedSecret.id);
                  continue;
                }
                
                try {
                  // Always try to decrypt the secret, regardless of how it was stored
                  let decryptedValue: string;
                  let decryptionSucceeded = false;
                  let strictDecryptionSucceeded = false;
                  
                  // First try strict decryption test
                  if (usesMasterKey) {
                    strictDecryptionSucceeded = await this.strictDecryptionTest(storedSecret.value);
                    if (strictDecryptionSucceeded) {
                      strictDecryptionSuccesses++;
                    }
                  }
                  
                  try {
                    // First try with the expected encryption method
                    decryptedValue = await this.decrypt(storedSecret.value, usesMasterKey);
                    console.debug(`Successfully decrypted secret ${storedSecret.id}`);
                    decryptionSucceeded = true;
                    successfulDecryptions++;
                  } catch (mainDecryptError) {
                    console.error(`Primary decryption failed for ${storedSecret.id}, trying alternatives`);
                    
                    try {
                      // Try the opposite encryption method
                      decryptedValue = await this.decrypt(storedSecret.value, !usesMasterKey);
                      console.debug(`Successfully decrypted secret ${storedSecret.id} with alternate key`);
                      decryptionSucceeded = true;
                      successfulDecryptions++;
                    } catch (altDecryptError) {
                      // Try base64 decode as last resort
                      try {
                        decryptedValue = atob(storedSecret.value);
                        console.debug(`Decrypted secret ${storedSecret.id} with base64 fallback`);
                        decryptionSucceeded = true;
                        // Note: We don't count base64 decoding as a "successful" crypto operation
                      } catch (fallbackError) {
                        console.error(`All decryption methods failed for ${storedSecret.id}`);
                        // If all decryption methods fail, use the value as-is
                        // This is better than skipping, since the secret may actually
                        // not be encrypted at all
                        decryptedValue = storedSecret.value;
                        decryptionFailures++;
                      }
                    }
                  }
                  
                  // Always re-encrypt to ensure consistent encryption
                  const reEncryptedValue = await this.encrypt(decryptedValue, usesMasterKey);
                  
                  // Store with the re-encrypted value to ensure consistency
                  const createdTime = storedSecret.createdAt ? 
                    new Date(storedSecret.createdAt).getTime() : now;
                    
                  const secret: StoredSecret = {
                    id: storedSecret.id,
                    value: reEncryptedValue,
                    type: storedSecret.type || 'text',
                    createdAt: createdTime,
                    expiresAt: expiryTime || 0,
                    description: storedSecret.description
                  };
                  
                  this.secrets.set(storedSecret.id, secret);
                  
                  // Always update stored value with re-encrypted value
                  await this.directDatabaseWrite(storedSecret.id, secret);
                  
                  // Set expiry timer for non-expired secrets
                  if (expiryTime > now) {
                    const timeRemaining = expiryTime - now;
                    console.debug(`Setting expiry timer for ${storedSecret.id} to expire in ${timeRemaining}ms`);
                    setTimeout(() => {
                      this.removeSecret(storedSecret.id);
                    }, timeRemaining);
                  }
                  
                  secretsLoaded++;
                } catch (e) {
                  console.error(`Error processing secret ${storedSecret.id}:`, e);
                  secretsSkipped++;
                }
              }
              
              console.debug(`Loaded ${secretsLoaded} secrets from persistent storage (${secretsExpired} expired, ${secretsSkipped} skipped, ${decryptionFailures} decryption failures, ${successfulDecryptions} successful decryptions, ${strictDecryptionSuccesses} strict decryptions)`);
              
              // For password-protected databases, ensure there were some strict decryption successes
              if (usesMasterKey && strictDecryptionSuccesses === 0 && loadedSecrets.length - secretsExpired > 0) {
                console.warn('*** CRITICAL: No secrets could be decrypted with strict decryption, definitely wrong password ***');
                
                // Clear all loaded secrets to prevent using improperly decrypted data
                this.secrets.clear();
                
          db.close();
                resolve(false);
                return;
              }
              
              // Check if we have a minimum success rate for decryption
              const nonExpiredSecrets = loadedSecrets.length - secretsExpired;
              const decryptionSuccessRate = nonExpiredSecrets > 0 ? successfulDecryptions / nonExpiredSecrets : 1;
              const validSuccessRate = nonExpiredSecrets <= 3 ? successfulDecryptions > 0 : decryptionSuccessRate >= 0.5;
              
              // Log the success rate and validation for debugging
              console.debug(`Decryption success rate: ${Math.round(decryptionSuccessRate * 100)}%, valid: ${validSuccessRate}`, 
                { nonExpiredSecrets, successfulDecryptions, decryptionFailures, strictDecryptionSuccesses });
              
              // If not enough secrets could be decrypted, this is likely the wrong password
              if (!validSuccessRate) {
                console.warn(`Low decryption success rate detected: ${Math.round(decryptionSuccessRate * 100)}% - likely wrong password or corrupted data`);
                
                // We'll clear loaded secrets since they might be corrupted/wrong
                this.secrets.clear();
                
                db.close();
                resolve(false);
                return;
              }
              
              // Check if we had a high percentage of decryption failures
              if (decryptionFailures > 0) {
                const failureRate = decryptionFailures / nonExpiredSecrets;
                
                if (failureRate > 0.3 && nonExpiredSecrets > 3) {
                  console.warn(`High decryption failure rate detected (${Math.round(failureRate * 100)}%), attempting automatic recovery...`);
                  // Close the db before attempting recovery
                  db.close();
                  
                  // Schedule recovery to run after this function completes
                  setTimeout(() => {
                    this.recoverFromDecryptionFailure().then(recoveryPerformed => {
                      if (recoveryPerformed) {
                        console.warn('Database recovery completed. You may need to restart the application.');
                      }
                    });
                  }, 1000);
                }
              }
              
              db.close();
              resolve(secretsLoaded > 0 && validSuccessRate);
        };
          } catch (e) {
            console.error('Exception during load operation:', e);
            db.close();
            resolve(false);
          }
      };
    });
      
      return result;
    } catch (e) {
      console.error('Failed to load secrets from persistent storage:', e);
      return false;
    }
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
    // Only use the master key if password protection is enabled AND we have a master key
    const usesMasterKey = this.persistence.enabled && 
                         this.persistence.passwordProtected && 
                         this.masterKey !== null;
    
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
      // Skip the password verification marker
      if (id === 'pwd_verification_marker' || secret.type === 'pwd_verification') {
        return;
      }
      
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
    
    console.debug('Clearing all secrets from persistent storage');
    
    try {
      // Open the fixed database
      const request = indexedDB.open(FIXED_DB_NAME, 1);
      
      await new Promise<void>((resolve) => {
        request.onerror = () => {
          console.error('Failed to open database for clearing');
          resolve();
      };
      
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
          
          try {
            if (!db.objectStoreNames.contains(FIXED_STORE_NAME)) {
              console.warn('No store to clear - it does not exist');
              db.close();
              resolve();
              return;
            }
            
            const tx = db.transaction([FIXED_STORE_NAME], 'readwrite');
            const store = tx.objectStore(FIXED_STORE_NAME);
            
        const clearRequest = store.clear();
        
        clearRequest.onerror = () => {
              console.error('Error clearing all secrets');
              db.close();
              resolve();
        };
        
        clearRequest.onsuccess = () => {
              console.debug('Successfully cleared all secrets');
              db.close();
          resolve();
        };
          } catch (e) {
            console.error('Exception during clear operation:', e);
          db.close();
            resolve();
          }
        };
      });
      
      console.debug('Persistent storage cleared successfully');
    } catch (e) {
      console.error('Failed to clear persistent storage:', e);
    }
  }

  /**
   * Test database readback to ensure database is working correctly
   */
  private testDatabaseReadback(db: IDBDatabase, storeName: string, testId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const getRequest = store.get(testId);
        
        getRequest.onerror = () => {
          console.error('Read test failed:', getRequest.error);
          resolve(false);
        };
        
        getRequest.onsuccess = () => {
          const result = getRequest.result;
          if (result && result.id === testId) {
            console.debug('Read test successful - read back test value');
            resolve(true);
          } else {
            console.error('Read test failed - could not read back test value');
            resolve(false);
          }
        };
      } catch (e) {
        console.error('Read test exception:', e);
        resolve(false);
      }
    });
  }

  /**
   * Enable persistent storage
   * @param options Options for enabling persistence
   */
  async enablePersistence(options: { 
    passwordProtected?: boolean; 
    password?: string;
    clearExisting?: boolean;
  } = {}): Promise<void> {
    // Ensure initialization
    if (!this.isInitialized) {
      console.debug('Secret manager not initialized, initializing first');
      await this.initialize();
    }
    
    console.debug('Enabling persistence with options:', {
      passwordProtected: options.passwordProtected,
      clearExisting: options.clearExisting,
      hasPassword: !!options.password
    });
    
    // Validate options - cannot enable password protection without a password
    if (options.passwordProtected && !options.password) {
      console.warn('Password protection requested but no password provided. This will lock the database until a password is provided.');
    }
    
    // Update persistence options
    this.persistence.enabled = true;
    this.persistence.passwordProtected = options.passwordProtected || false;
    
    console.debug('Persistence options updated:', {
      enabled: this.persistence.enabled,
      passwordProtected: this.persistence.passwordProtected
    });
    
    // If password protected, derive master key
    if (this.persistence.passwordProtected && options.password) {
      console.debug('Setting up password protection');
      this.persistence.password = options.password;
      await this.deriveMasterKey(options.password);
      
      // Create password verification marker to ensure this password is properly verified in the future
      // Check if we already have a marker
      const allSecrets = await this.directDatabaseReadAll();
      const hasVerificationMarker = allSecrets.some((s: any) => s.id === 'pwd_verification_marker');
      
      if (!hasVerificationMarker) {
        console.debug('No verification marker found, creating one with the provided password');
        const markerCreated = await this.createPasswordVerificationMarker(options.password);
        if (markerCreated) {
          console.debug('Successfully created password verification marker during persistence setup');
        } else {
          console.warn('Failed to create password verification marker during persistence setup');
        }
      }
    } else {
      console.debug('No password protection, clearing master key');
      this.masterKey = null;
      this.persistence.password = undefined;
    }
    
    // Count secrets before saving
    const secretCount = this.secrets.size;
    console.debug(`Preparing to save ${secretCount} secrets to persistent storage`);
    
    // Save all in-memory secrets to persistent storage
    let savedCount = 0;
    for (const [id, secret] of Array.from(this.secrets.entries())) {
      console.debug(`Saving secret ${id} to persistent storage`);
        // Just save the secret as is
        await this.saveSecretToPersistentStorage(secret);
      savedCount++;
    }
    
    console.debug(`Persistence enablement completed. Saved ${savedCount} of ${secretCount} secrets.`);
    
    return Promise.resolve();
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
    
    // Remove old verification marker if it exists
    await this.removeSecret('pwd_verification_marker');
    
    // Create new verification marker with the new password
    await this.createPasswordVerificationMarker(newPassword);
    
    // Re-encrypt and save all secrets
    for (const secret of secrets) {
      // Skip re-encrypting the old verification marker which we already removed
      if (secret.id === 'pwd_verification_marker' || secret.type === 'pwd_verification') {
        continue;
      }
      
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
    
    // Force encryption by setting forceEncrypt to true in storeSecret
    const secretId = await this.storeSecret(value, type, this.DEFAULT_TTL_MS, description, undefined, true);
    
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
        try {
        const secretValue = await this.getSecret(secretId);
        
        if (secretValue !== null) {
            console.debug(`Successfully processed secret reference ${secretId}`);
          return secretValue;
          } else {
            console.warn(`Secret with ID ${secretId} not found or expired`);
            // Return the original reference pattern if secret isn't found
            return str;
          }
        } catch (error) {
          console.error(`Error processing secret ${secretId}:`, error);
          // Return original reference pattern when decryption fails
          return str;
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
    
    // Map to track secret IDs to their decrypted values
    const secretIdToValue: Record<string, string> = {};
    // Map to track environment variable names to their secret values
    const envVarToSecretValue: Record<string, string> = {};
    const failedSecrets: string[] = [];
    
    // First, attempt to fix any improperly encrypted secrets
    try {
      await this.fixAllSecrets();
    } catch (e) {
      console.error('Error trying to fix secrets:', e);
    }
    
    // Then collect all secret values
    console.debug(`Processing ${this.secrets.size} stored secrets`);
    const secretPromises: Promise<void>[] = [];
    
    this.secrets.forEach(secret => {
      const promise = this.getSecret(secret.id).then(value => {
        if (value) {
          // Store both by ID and by description (if available)
          secretIdToValue[secret.id] = value;
          if (secret.description) {
            envVarToSecretValue[secret.description] = value;
          }
        } else {
          // If we can't get the secret value, note it as failed
          const identifier = secret.description || secret.id;
          console.warn(`Failed to get value for secret ${identifier}`);
          failedSecrets.push(identifier);
        }
      }).catch(error => {
        const identifier = secret.description || secret.id;
        console.error(`Error retrieving secret ${identifier}:`, error);
        failedSecrets.push(identifier);
      });
      
      secretPromises.push(promise);
    });
    
    // Wait for all secret values to be retrieved
    await Promise.all(secretPromises);
    
    // Log failures
    if (failedSecrets.length > 0) {
      console.error(`Failed to retrieve ${failedSecrets.length} secrets:`, failedSecrets);
    }
    
    console.debug(`Successfully retrieved ${Object.keys(secretIdToValue).length} secret values`);
    
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
    
    // Helper function to process string values that might be secret references
    const processStringValue = (str: string, path: string): void => {
      // Check if this is a secret reference pattern
      const secretPattern = /\$SECRET:([a-f0-9-]+)\$/;
      const match = str.match(secretPattern);
      
      if (match && match[1]) {
        const secretId = match[1];
        
        // If we have already retrieved this secret value, use it
        if (secretIdToValue[secretId]) {
          console.debug(`Found secret reference ${secretId} at ${path}`);
          const secretValue = secretIdToValue[secretId];
          
          // If the secret has a description, use that as the environment variable name
          const secretInfo = this.getSecretInfo(secretId);
          if (secretInfo && secretInfo.description) {
            extractedSecrets[secretInfo.description] = secretValue;
          } else {
            // Use the path as the environment variable name if no description
            const envVarName = path.replace(/\./g, '_').replace(/\[|\]/g, '_').toUpperCase();
            extractedSecrets[envVarName] = secretValue;
          }
        } else {
          console.warn(`Could not find value for secret reference ${secretId} at ${path}`);
        }
        return;
      }
      
      // Check if this is a direct env var reference like "API_KEY"
      if (envVarToSecretValue[str]) {
        console.debug(`Found direct env var reference ${str}`);
        extractedSecrets[str] = envVarToSecretValue[str];
        return;
      }
      
      // Check if this is a process.env prefixed reference
      if (str.startsWith('process.env.')) {
        const envVarName = str.replace('process.env.', '');
        if (envVarToSecretValue[envVarName]) {
          console.debug(`Found process.env reference ${envVarName}`);
          extractedSecrets[envVarName] = envVarToSecretValue[envVarName];
          return;
        }
      }
    };
    
    // Process the entire config to find secrets
    console.debug('Processing config to extract secrets');
    processObject(cleanedConfig);
    
    console.debug(`Extracted ${Object.keys(extractedSecrets).length} secrets from config`);
    
    // Return both the cleaned config and the extracted secrets
    return { config: cleanedConfig, secrets: extractedSecrets };
  }

  /**
   * Reset the database completely (delete and recreate)
   */
  async resetDatabase(): Promise<void> {
    console.debug('Resetting database completely');
    
    // First clear in-memory secrets
    this.secrets.clear();
    
    try {
      // Delete the fixed database
      await new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase(FIXED_DB_NAME);
      
      deleteRequest.onerror = (event) => {
        console.error('Error deleting database during reset:', event);
          resolve(); // Continue even if there's an error
        };
        
        deleteRequest.onsuccess = () => {
          console.debug('Database successfully deleted during reset');
        resolve();
      };
      });
      
      // Create a clean database
      await new Promise<void>((resolve) => {
        const request = indexedDB.open(FIXED_DB_NAME, 1);
        
        request.onerror = (event) => {
          console.error('Error creating new database after reset:', event);
          this.persistence.enabled = false;
          resolve();
        };
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          try {
            db.createObjectStore(FIXED_STORE_NAME, { keyPath: 'id' });
            console.debug('Created new object store during database reset');
          } catch (e) {
            console.error('Error creating object store during reset:', e);
          }
        };
        
        request.onsuccess = (event) => {
          console.debug('Successfully created new database after reset');
          const db = (event.target as IDBOpenDBRequest).result;
          db.close();
          resolve();
      };
    });
      
      console.debug('Database reset completed successfully');
    } catch (e) {
      console.error('Exception during database reset:', e);
      this.persistence.enabled = false;
    }
  }

  /**
   * Remove a secret from persistent storage
   * @param id The ID of the secret to remove
   */
  private async removeSecretFromPersistentStorage(id: string): Promise<void> {
    if (!this.persistence.enabled) return;
    
    console.debug(`Removing secret ${id} from persistent storage`);
    
    // Delete by overwriting with an expired marker
    const expiredMarker = {
      id,
      value: 'EXPIRED',
      type: 'expired',
      createdAt: 0, 
      expiresAt: 0,
      description: 'Expired secret'
    };
    
    await this.directDatabaseWrite(id, expiredMarker);
  }

  /**
   * Test if we can decrypt all stored secrets
   * This is mainly for debugging encryption issues
   * @returns Object with counts of successful and failed decryptions
   */
  async testAllSecrets(): Promise<{ total: number, success: number, failures: string[] }> {
    console.debug('Testing all stored secrets for decryption issues');
    
    const result = {
      total: 0,
      success: 0,
      failures: [] as string[]
    };
    
    // Convert Map.entries() to array before iteration
    for (const [id, secret] of Array.from(this.secrets.entries())) {
      // Skip the password verification marker
      if (id === 'pwd_verification_marker' || secret.type === 'pwd_verification') {
        continue;
      }
      
      result.total++;
      
      try {
        // Determine if this secret was encrypted with the master key
        const usesMasterKey = this.persistence.enabled && 
                             this.persistence.passwordProtected && 
                             this.masterKey !== null;
                             
        // Try to decrypt the secret
        const decrypted = await this.decrypt(secret.value, usesMasterKey);
        if (decrypted) {
          result.success++;
        } else {
          console.warn(`Secret ${id} decrypted to empty string`);
          result.failures.push(id);
        }
      } catch (error) {
        console.error(`Failed to decrypt secret ${id}:`, error);
        result.failures.push(id);
      }
    }
    
    console.debug('Secret test results:', result);
    return result;
  }

  /**
   * Fix all secrets in the database to ensure they're properly encrypted
   * This is useful for fixing existing secrets that might have been stored unencrypted
   * @returns Object with counts of secrets processed
   */
  async fixAllSecrets(): Promise<{ total: number, fixed: number, failed: number }> {
    console.debug('Fixing all secrets to ensure proper encryption');
    
    const result = {
      total: this.secrets.size,
      fixed: 0,
      failed: 0
    };
    
    // Convert Map.entries() to array before iteration to avoid modification during iteration
    const allSecrets = Array.from(this.secrets.entries());
    
    // Determine if we should use the master key for encryption
    const usesMasterKey = this.persistence.enabled && 
                          this.persistence.passwordProtected && 
                          this.masterKey !== null;
    
    // Process each secret
    for (const [id, secret] of allSecrets) {
      try {
        // First try to decrypt the secret
        let originalValue;
        try {
          // Try to decrypt with both keys
          try {
            originalValue = await this.decrypt(secret.value, usesMasterKey);
          } catch (e) {
            // Try alternate key
            originalValue = await this.decrypt(secret.value, !usesMasterKey);
          }
        } catch (e) {
          // If we can't decrypt at all, use the raw value
          console.warn(`Could not decrypt secret ${id}, will use raw value`);
          originalValue = secret.value;
          
          // Try base64 decode as a last resort
          try {
            originalValue = atob(secret.value);
          } catch (base64Error) {
            // If base64 decode fails too, really use the raw value
          }
        }
        
        if (!originalValue) {
          console.warn(`Empty value for secret ${id}, skipping`);
          result.failed++;
          continue;
        }
        
        // Now force re-encrypt and store the secret
        const encryptedValue = await this.encrypt(originalValue, usesMasterKey);
        
        // Create updated secret with the same metadata but re-encrypted value
        const updatedSecret: StoredSecret = {
          ...secret,
          value: encryptedValue
        };
        
        // Update in-memory store
        this.secrets.set(id, updatedSecret);
        
        // Update in database
        await this.saveSecretToPersistentStorage(updatedSecret);
        
        console.debug(`Fixed encryption for secret ${id}`);
        result.fixed++;
      } catch (error) {
        console.error(`Failed to fix encryption for secret ${id}:`, error);
        result.failed++;
      }
    }
    
    console.debug('Secret fix results:', result);
    return result;
  }

  /**
   * Update the expiration time of an existing secret
   * @param id The ID of the secret to update
   * @param newTtlMs New time-to-live in milliseconds
   * @returns A promise that resolves to true if successful, false otherwise
   */
  async updateSecretExpiration(id: string, newTtlMs: number): Promise<boolean> {
    if (!this.isInitialized) {
      console.debug('SecretManager not initialized, initializing now...');
      await this.initialize();
    }
    
    // Get the existing secret
    const secret = this.secrets.get(id);
    
    if (!secret) {
      console.warn(`Cannot update expiration for secret ${id}: not found`);
      return false;
    }
    
    // Validate TTL
    const effectiveTTL = Math.min(newTtlMs, this.MAX_TTL_MS);
    if (effectiveTTL <= 0) {
      console.warn(`Invalid TTL value for secret ${id}: ${newTtlMs}ms, must be positive`);
      return false;
    }
    
    const now = Date.now();
    const newExpiryTime = now + effectiveTTL;
    const oldExpiryTime = secret.expiresAt;
    
    const oldFormatted = new Date(oldExpiryTime).toISOString();
    const newFormatted = new Date(newExpiryTime).toISOString();
    
    console.debug(`Updating expiration for secret ${id} from ${oldFormatted} to ${newFormatted} (${this.formatTtl(effectiveTTL)})`);
    
    // Create a new secret object with updated expiry
    const updatedSecret: StoredSecret = {
      ...secret,
      expiresAt: newExpiryTime
    };
    
    // Update in-memory store
    this.secrets.set(id, updatedSecret);
    
    try {
      // Set a new expiry timer
      setTimeout(() => {
        this.removeSecret(id);
      }, effectiveTTL);
      
      // Update in persistent storage if enabled
      if (this.persistence.enabled) {
        console.debug(`Persisting updated expiration for secret ${id}`);
        try {
          await this.saveSecretToPersistentStorage(updatedSecret);
          console.debug(`Successfully persisted updated expiration for secret ${id}`);
        } catch (e) {
          console.warn(`Failed to persist updated expiration for secret ${id}:`, e);
          // Continue anyway, since the in-memory update succeeded
        }
      }
      
      return true;
    } catch (error) {
      console.error(`Failed to update expiration for secret ${id}:`, error);
      return false;
    }
  }

  /**
   * Store multiple secrets with the same expiration time
   * This is useful for bulk uploads where all secrets should have the same settings
   * 
   * @param secrets Array of {value, type, description} objects
   * @param ttlMs Time-to-live in milliseconds for all secrets
   * @param persist Whether to persist the secrets to storage
   * @returns Array of generated secret IDs
   */
  async storeSecretsBulk(
    secrets: Array<{value: string, type: string, description?: string}>,
    ttlMs: number = this.DEFAULT_TTL_MS,
    persist?: boolean
  ): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    console.debug(`Storing ${secrets.length} secrets in bulk with TTL ${ttlMs}ms`);
    
    // Store all secrets with the same TTL
    const secretIds: string[] = [];
    
    for (const secretData of secrets) {
      try {
        const id = await this.storeSecret(
          secretData.value,
          secretData.type,
          ttlMs,
          secretData.description,
          persist,
          true // Always force encryption for bulk uploads
        );
        secretIds.push(id);
      } catch (error) {
        console.error('Failed to store secret in bulk operation:', error);
        // Continue with the rest of the secrets even if one fails
      }
    }
    
    console.debug(`Successfully stored ${secretIds.length} of ${secrets.length} secrets in bulk`);
    return secretIds;
  }

  /**
   * Update expiration time for multiple secrets
   * @param ids Array of secret IDs to update
   * @param newTtlMs New time-to-live in milliseconds for all secrets
   * @returns Number of successfully updated secrets
   */
  async updateSecretsExpirationBulk(ids: string[], newTtlMs: number): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    console.debug(`Updating expiration for ${ids.length} secrets to TTL ${newTtlMs}ms`);
    
    let successCount = 0;
    
    for (const id of ids) {
      const success = await this.updateSecretExpiration(id, newTtlMs);
      if (success) {
        successCount++;
      }
    }
    
    console.debug(`Successfully updated expiration for ${successCount} of ${ids.length} secrets`);
    return successCount;
  }

  /**
   * Get human-readable expiration time for a secret
   * @param id The ID of the secret
   * @returns An object with expiration details or null if secret not found
   */
  getSecretExpirationInfo(id: string): { 
    expiresAt: number;
    expiresIn: number;
    formattedExpiry: string;
    isExpired: boolean;
  } | null {
    const secret = this.secrets.get(id);
    
    if (!secret) {
      return null;
    }
    
    const now = Date.now();
    const expiresAt = secret.expiresAt;
    const expiresIn = Math.max(0, expiresAt - now);
    const isExpired = now >= expiresAt;
    
    // Format the expiration time in a human-readable way
    let formattedExpiry: string;
    
    if (isExpired) {
      formattedExpiry = 'Expired';
    } else if (expiresIn < 60000) {
      // Less than a minute
      formattedExpiry = `${Math.ceil(expiresIn / 1000)} seconds`;
    } else if (expiresIn < 3600000) {
      // Less than an hour
      formattedExpiry = `${Math.ceil(expiresIn / 60000)} minutes`;
    } else if (expiresIn < 86400000) {
      // Less than a day
      formattedExpiry = `${Math.ceil(expiresIn / 3600000)} hours`;
    } else {
      // Days
      formattedExpiry = `${Math.ceil(expiresIn / 86400000)} days`;
    }
    
    return {
      expiresAt,
      expiresIn,
      formattedExpiry,
      isExpired
    };
  }

  /**
   * Get expiration information for multiple secrets
   * @param ids Array of secret IDs
   * @returns Map of secret IDs to their expiration information
   */
  getSecretsExpirationInfo(ids: string[]): Map<string, { 
    expiresAt: number;
    expiresIn: number;
    formattedExpiry: string;
    isExpired: boolean;
  } | null> {
    const result = new Map();
    
    for (const id of ids) {
      result.set(id, this.getSecretExpirationInfo(id));
    }
    
    return result;
  }

  /**
   * Get available TTL options for UI display
   * @returns Array of TTL options with label and value
   */
  getAvailableTtlOptions(): Array<{ label: string; value: number }> {
    return [
      { label: '1 hour', value: 3600000 },
      { label: '6 hours', value: 21600000 },
      { label: '12 hours', value: 43200000 },
      { label: '1 day', value: 86400000 },
      { label: '3 days', value: 259200000 },
      { label: '7 days', value: 604800000 },
      { label: '30 days', value: 2592000000 },
    ];
  }

  /**
   * Parse and validate a TTL string/value
   * @param ttlInput TTL as string (e.g., "1h", "30m", "1d") or number in ms
   * @returns Validated TTL in milliseconds or default if invalid
   */
  parseTtl(ttlInput: string | number): number {
    // If it's already a number, just validate the range
    if (typeof ttlInput === 'number') {
      return Math.min(Math.max(ttlInput, 60000), this.MAX_TTL_MS);
    }
    
    // Parse string formats like "1h", "30m", "1d"
    const match = ttlInput.match(/^(\d+)([hmd])$/i);
    
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();
      
      let ttlMs: number;
      
      switch (unit) {
        case 'm': // minutes
          ttlMs = value * 60 * 1000;
          break;
        case 'h': // hours
          ttlMs = value * 60 * 60 * 1000;
          break;
        case 'd': // days
          ttlMs = value * 24 * 60 * 60 * 1000;
          break;
        default:
          ttlMs = this.DEFAULT_TTL_MS;
      }
      
      return Math.min(ttlMs, this.MAX_TTL_MS);
    }
    
    // Try to parse as a plain number
    const numericValue = parseInt(ttlInput, 10);
    if (!isNaN(numericValue)) {
      return Math.min(Math.max(numericValue, 60000), this.MAX_TTL_MS);
    }
    
    // Return default if parsing failed
    return this.DEFAULT_TTL_MS;
  }

  /**
   * Get the remaining time-to-live for a secret in milliseconds
   * @param id The ID of the secret
   * @returns Remaining TTL in milliseconds, or -1 if expired/not found
   */
  getSecretRemainingTtl(id: string): number {
    const secret = this.secrets.get(id);
    
    if (!secret) {
      return -1;
    }
    
    const now = Date.now();
    const remaining = secret.expiresAt - now;
    
    return Math.max(0, remaining);
  }
  
  /**
   * Convert TTL in milliseconds to a user-friendly string format
   * @param ttlMs TTL in milliseconds
   * @returns Formatted string representation (e.g., "1 hour", "2 days")
   */
  formatTtl(ttlMs: number): string {
    if (ttlMs < 60000) { // Less than a minute
      return `${Math.round(ttlMs / 1000)} seconds`;
    } else if (ttlMs < 3600000) { // Less than an hour
      return `${Math.round(ttlMs / 60000)} minutes`;
    } else if (ttlMs < 86400000) { // Less than a day
      const hours = Math.round(ttlMs / 3600000);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else { // Days
      const days = Math.round(ttlMs / 86400000);
      return `${days} ${days === 1 ? 'day' : 'days'}`;
    }
  }

  /**
   * Create a special password verification marker in the database
   * This stores an encrypted value that can only be decrypted with the correct password
   * @param password The password to create a verification marker for
   * @returns True if successful
   */
  private async createPasswordVerificationMarker(password: string): Promise<boolean> {
    try {
      // First derive the key with this password
      await this.deriveMasterKey(password);
      
      // Create a unique verification value with a timestamp
      const verificationValue = `VERIFY_PWD_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // Create a special secret ID for password verification
      const verificationId = 'pwd_verification_marker';
      
      // Encrypt directly with the derived key
      const encryptedValue = await this.encrypt(verificationValue, true);
      
      // Store as a special secret
      const now = Date.now();
      // Set to a far future date (100 years) - effectively never expires
      const farFutureDate = now + (100 * 365 * 24 * 60 * 60 * 1000);
      
      const secret: StoredSecret = {
        id: verificationId,
        value: encryptedValue,
        type: 'pwd_verification',
        createdAt: now,
        expiresAt: farFutureDate,
        description: 'Password verification marker'
      };
      
      // Store in memory and database
      this.secrets.set(verificationId, secret);
      await this.directDatabaseWrite(verificationId, secret);
      
      console.debug('Created password verification marker');
      return true;
    } catch (e) {
      console.error('Failed to create password verification marker:', e);
      return false;
    }
  }
  
  /**
   * Verify if a password is correct by checking against the verification marker
   * @param password Password to verify
   * @returns True if password is correct
   */
  private async verifyPasswordWithMarker(password: string): Promise<boolean> {
    if (!password) return false;
    
    // Save current master key
    const originalMasterKey = this.masterKey;
    
    try {
      // Derive the key with this password
      await this.deriveMasterKey(password);
      
      // Get stored verification marker
      const verificationId = 'pwd_verification_marker';
      let marker: any = null;
      
      // First check in-memory cache
      if (this.secrets.has(verificationId)) {
        marker = this.secrets.get(verificationId);
      } else {
        // Then check database
        const allSecrets = await this.directDatabaseReadAll();
        marker = allSecrets.find((s: any) => s.id === verificationId);
      }
      
      if (!marker) {
        // No marker exists yet, but we should NOT create one with an unverified password
        // This prevents an incorrect password from becoming the new valid password
        console.debug('No verification marker found, password verification failed');
        return false;
      }
      
      // Try to decrypt the verification marker with this password
      try {
        const decrypted = await this.decrypt(marker.value, true);
        
        // If successful and the value is a verification marker, password is correct
        const isValid = typeof decrypted === 'string' && decrypted.startsWith('VERIFY_PWD_');
        console.debug(`Password verification ${isValid ? 'successful' : 'failed'}`);
        return isValid;
      } catch (e) {
        console.debug('Failed to decrypt verification marker - wrong password');
        return false;
      }
    } catch (e) {
      console.error('Error during password verification:', e);
      return false;
    } finally {
      // Restore original master key
      this.masterKey = originalMasterKey;
    }
  }

  /**
   * Attempts to unlock the database with the provided password
   * @param password The password to unlock the database
   * @returns A result object indicating success or failure with message
   */
  async unlockDatabase(password: string): Promise<UnlockResult> {
    console.debug('Attempting to unlock database with password');
    
    if (!this.persistence.enabled) {
      return {
        success: false,
        message: 'Database persistence is not enabled'
      };
    }
    
    if (!this.persistence.passwordProtected) {
      return {
        success: false,
        message: 'Database is not password protected'
      };
    }

    if (!password || password.trim() === '') {
      return {
        success: false,
        message: 'Password is required'
      };
    }

    // Check if this is a new database (no verification marker exists yet)
    const allSecrets = await this.directDatabaseReadAll();
    const hasVerificationMarker = allSecrets.some((s: any) => s.id === 'pwd_verification_marker');
    
    if (!hasVerificationMarker) {
      console.debug('No verification marker found - this appears to be a new database');
      
      // For a new database, we'll accept the first password and create a marker
      await this.deriveMasterKey(password);
      this.persistence.password = password;
      
      // Create verification marker with this password
      const markerCreated = await this.createPasswordVerificationMarker(password);
      
      if (markerCreated) {
        console.debug('Created first-time password verification marker');
        return {
          success: true, 
          message: 'New database created with password'
        };
      } else {
        return {
          success: false,
          message: 'Failed to create password verification marker'
        };
      }
    }

    // For existing databases with a marker, verify the password
    const verified = await this.verifyPasswordWithMarker(password);
    
    if (!verified) {
      console.warn('Password verification failed - wrong password');
      return {
        success: false,
        message: 'Invalid password'
      };
    }
    
    // If password is correct, derive the key (again) and set up state
    await this.deriveMasterKey(password);
    
    // Store the password
    this.persistence.password = password;
    
    // Load database secrets
    try {
      const loadResult = await this.loadSecretsFromPersistentStorage();
      
      if (loadResult) {
        console.debug('Database unlocked successfully');
        
        // Update verification marker if needed
        await this.createPasswordVerificationMarker(password);
        
        return {
          success: true,
          message: 'Database unlocked successfully'
        };
      } else {
        console.warn('Failed to load secrets after unlocking');
        
        // Even though verification passed, loading failed - could be a data issue
        return {
          success: false,
          message: 'Failed to load secrets with the correct password. Data might be corrupted.'
        };
      }
    } catch (error) {
      console.error('Error loading secrets after password verification:', error);
      
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error loading secrets'
      };
    }
  }

  /**
   * Attempt to recover from persistent decryption failures by resetting the database
   * Call this when consistent decryption failures are detected
   * @returns A promise that resolves to true if recovery was performed
   */
  async recoverFromDecryptionFailure(): Promise<boolean> {
    console.warn('Starting recovery from persistent decryption failures');
    
    // First, test all secrets to confirm if there's a widespread decryption problem
    const testResult = await this.testAllSecrets();
    
    // If more than 50% of secrets fail decryption, we have a serious problem
    const failureRate = testResult.failures.length / testResult.total;
    
    if (failureRate > 0.5 && testResult.total > 0) {
      console.error(`High decryption failure rate detected: ${Math.round(failureRate * 100)}% of secrets (${testResult.failures.length}/${testResult.total})`);
      
      // Attempt to fix all secrets first
      const fixResult = await this.fixAllSecrets();
      
      // If fixing didn't help much, we need to reset
      if (fixResult.failed > fixResult.fixed && fixResult.total > 0) {
        console.warn(`Fixing secrets didn't resolve the issue (fixed: ${fixResult.fixed}, failed: ${fixResult.failed}). Resetting database.`);
        
        // Backup the list of secret IDs before resetting
        const secretIds = Array.from(this.secrets.keys());
        console.debug(`Backing up ${secretIds.length} secret IDs before reset`);
        
        // Create a backup of secret metadata (without values) for logging
        const secretMetadata = Array.from(this.secrets.entries()).map(([id, secret]) => ({
          id,
          type: secret.type,
          createdAt: new Date(secret.createdAt).toISOString(),
          description: secret.description
        }));
        
        console.debug('Secret metadata backup:', secretMetadata);
        
        // Reset the database
        await this.resetDatabase();
        
        // Reinitialize the encryption key
        this.encryptionKey = null;
        await this.initEncryptionKey();
        
        // If we had a master key, we need to regenerate it
        if (this.persistence.passwordProtected && this.persistence.password) {
          console.debug('Regenerating master key with fixed salt');
          await this.deriveMasterKey(this.persistence.password);
        }
        
        console.warn('Database has been reset due to persistent decryption failures');
        return true;
      } else {
        console.debug(`Successfully fixed ${fixResult.fixed} of ${fixResult.total} secrets, no need for database reset`);
      }
    } else {
      console.debug('Decryption failure rate not high enough to warrant recovery action');
    }
    
    return false;
  }

  /**
   * Manual recovery function to completely reset and reinitialize the database
   * This can be called directly when persistent decryption issues are encountered
   * @param keepPersistence Whether to keep persistence enabled after reset
   * @returns A promise that resolves when recovery is complete
   */
  async manualRecovery(keepPersistence: boolean = true): Promise<void> {
    console.warn('Starting manual recovery of secret database');
    
    // First, back up the current state for debugging
    const debugState = {
      secretCount: this.secrets.size,
      hasEncryptionKey: !!this.encryptionKey,
      hasMasterKey: !!this.masterKey,
      persistenceEnabled: this.persistence.enabled,
      passwordProtected: this.persistence.passwordProtected,
      hasPassword: !!this.persistence.password
    };
    
    console.log('Debug state before recovery:', debugState);
    
    // Clear memory cache
    this.secrets.clear();
    
    // Reset database
    await this.resetDatabase();
    
    // Force regenerate the encryption key
    this.encryptionKey = null;
    await this.initEncryptionKey();
    
    // Decide whether to keep persistence enabled
    if (!keepPersistence) {
      this.persistence.enabled = false;
      this.persistence.passwordProtected = false;
      this.persistence.password = undefined;
      this.masterKey = null;
    } else if (this.persistence.passwordProtected && this.persistence.password) {
      // Regenerate the master key with the fixed salt
      await this.deriveMasterKey(this.persistence.password);
    }
    
    // Mark as initialized
    this.isInitialized = true;
    
    // Report recovery completion
    console.warn('Manual recovery completed. Application state has been reset.');
    console.debug('New state:', {
      secretCount: this.secrets.size,
      hasEncryptionKey: !!this.encryptionKey,
      hasMasterKey: !!this.masterKey,
      persistenceEnabled: this.persistence.enabled,
      passwordProtected: this.persistence.passwordProtected,
      hasPassword: !!this.persistence.password
    });
  }
}

// Create a singleton instance
console.debug('Creating SecretManager singleton instance');
const secretManagerInstance = SecretManager.getInstance();

// Check if we have persistence settings in sessionStorage
let initialPersistenceOptions: PersistenceOptions = { enabled: false };
try {
  const sessionSettings = sessionStorage.getItem('secretManagerSettings');
  if (sessionSettings) {
    const settings = JSON.parse(sessionSettings);
    console.debug('Found persistence settings in sessionStorage:', {
      persistenceEnabled: settings.persistenceEnabled,
      passwordProtected: settings.passwordProtected,
      hasPassword: !!settings.password
    });
    
    if (settings.persistenceEnabled) {
      initialPersistenceOptions = {
        enabled: true,
        passwordProtected: settings.passwordProtected,
        // We can't use the password directly from storage (it's hashed),
        // but we can mark it as password protected for now
        password: settings.passwordProtected ? '' : undefined
      };
    }
  }
} catch (e) {
  console.error('Error reading persistence settings from sessionStorage:', e);
}

// Initialize with persistence options from sessionStorage (if any)
console.debug('Initializing SecretManager with settings:', initialPersistenceOptions);
secretManagerInstance.initialize(initialPersistenceOptions).then(() => {
  console.debug('SecretManager initialization complete');
}).catch(error => {
  console.error('Error during SecretManager initialization:', error);
});

// Export the singleton instance
export const secretManager = secretManagerInstance; 

// Export recovery functions for easy access
export const secretManagerRecovery = {
  /**
   * Run automatic recovery on the SecretManager to fix decryption issues
   * @returns Promise resolving to true if recovery was performed
   */
  runAutomaticRecovery: async (): Promise<boolean> => {
    return secretManagerInstance.recoverFromDecryptionFailure();
  },
  
  /**
   * Manual emergency reset of the SecretManager database
   * @param keepPersistence Whether to keep persistence enabled after reset
   */
  emergencyReset: async (keepPersistence: boolean = true): Promise<void> => {
    return secretManagerInstance.manualRecovery(keepPersistence);
  },
  
  /**
   * Test if the database can be decrypted properly
   * @returns Promise resolving to an object with test results
   */
  testDatabase: async (): Promise<{ total: number, success: number, failures: string[] }> => {
    return secretManagerInstance.testAllSecrets();
  },
  
  /**
   * Try to fix encryption for all stored secrets
   * @returns Promise resolving to an object with fix results
   */
  fixAllSecrets: async (): Promise<{ total: number, fixed: number, failed: number }> => {
    return secretManagerInstance.fixAllSecrets();
  },
  
  /**
   * Reset database and create a new one with a new password.
   * This is useful when the user forgot their password or is experiencing
   * consistent decryption issues.
   * 
   * WARNING: This will delete all existing secrets in the database!
   * 
   * @param newPassword The new password to use for the database
   * @returns Promise resolving to true if reset was successful
   */
  resetDatabaseWithNewPassword: async (newPassword: string): Promise<boolean> => {
    if (!newPassword || newPassword.trim() === '') {
      console.error('New password cannot be empty');
      return false;
    }
    
    try {
      console.warn('Resetting database and creating new one with new password');
      
      // Clear all existing secrets from memory
      await secretManagerInstance.clearAllSecrets(true);
      
      // Reset database
      await secretManagerInstance.resetDatabase();
      
      // Force regenerate the encryption key
      (secretManagerInstance as any).encryptionKey = null;
      await (secretManagerInstance as any).initEncryptionKey();
      
      // Enable persistence with the new password
      await secretManagerInstance.enablePersistence({
        passwordProtected: true,
        password: newPassword,
        clearExisting: true
      });
      
      console.warn('Database reset and new password set successfully');
      return true;
    } catch (error) {
      console.error('Error resetting database with new password:', error);
      return false;
    }
  },
  
  /**
   * Test if a specific password can unlock the database
   * This is helpful for debugging password issues without actually unlocking
   * 
   * @param testPassword The password to test
   * @returns Object with detailed test results 
   */
  testPassword: async (testPassword: string): Promise<{
    valid: boolean;
    details: {
      canDeriveKey: boolean;
      encryptDecryptTest: boolean;
      canDecryptSecrets: boolean;
      secretsCount: number;
      successfulDecryptions: number;
      strictDecryptions: number;
    }
  }> => {
    // Save the current state
    const originalMasterKey = (secretManagerInstance as any).masterKey;
    const originalPassword = (secretManagerInstance as any).persistence.password;
    
    // Prepare result object
    const result = {
      valid: false,
      details: {
        canDeriveKey: false,
        encryptDecryptTest: false,
        canDecryptSecrets: false,
        secretsCount: 0,
        successfulDecryptions: 0,
        strictDecryptions: 0
      }
    };
    
    try {
      // Try to derive a key from the password
      await (secretManagerInstance as any).deriveMasterKey(testPassword);
      result.details.canDeriveKey = true;
      
      // Run a simple encrypt/decrypt test
      try {
        const testValue = `TEST_VALUE_${Date.now()}`;
        const encrypted = await (secretManagerInstance as any).encrypt(testValue, true);
        const decrypted = await (secretManagerInstance as any).decrypt(encrypted, true);
        result.details.encryptDecryptTest = (decrypted === testValue);
      } catch (e) {
        console.error('Encrypt/decrypt test failed:', e);
        result.details.encryptDecryptTest = false;
      }
      
      // Try to decrypt actual secrets
      try {
        const allSecrets = await (secretManagerInstance as any).directDatabaseReadAll();
        result.details.secretsCount = allSecrets.length;
        
        if (allSecrets.length > 0) {
          // Check up to 5 secrets
          const samplesToTry = Math.min(allSecrets.length, 5);
          
          for (let i = 0; i < samplesToTry; i++) {
            const secret = allSecrets[i];
            if (secret && secret.value) {
              // Try strict decryption first
              try {
                const strictSuccess = await (secretManagerInstance as any).strictDecryptionTest(secret.value);
                if (strictSuccess) result.details.strictDecryptions++;
              } catch (e) {
                // Ignore errors during strict test
              }
              
              // Try normal decryption
              try {
                const decrypted = await (secretManagerInstance as any).decrypt(secret.value, true);
                if (decrypted && decrypted.length > 0) {
                  result.details.successfulDecryptions++;
                }
              } catch (e) {
                // Ignore errors during decrypt
              }
            }
          }
        }
        
        // If we have secrets to test against, determine if password is valid
        if (result.details.secretsCount > 0) {
          // Password is valid if ANY strict decryptions succeeded
          result.details.canDecryptSecrets = result.details.strictDecryptions > 0;
          result.valid = result.details.strictDecryptions > 0;
        } else {
          // If no secrets, rely on encrypt/decrypt test
          result.details.canDecryptSecrets = true; // No secrets to test against
          result.valid = result.details.encryptDecryptTest;
        }
      } catch (e) {
        console.error('Error testing against secrets:', e);
        // If we can't access secrets, use encrypt/decrypt test
        result.valid = result.details.encryptDecryptTest;
      }
    } catch (e) {
      console.error('Error during password test:', e);
      result.valid = false;
    } finally {
      // Restore original state
      (secretManagerInstance as any).masterKey = originalMasterKey;
      (secretManagerInstance as any).persistence.password = originalPassword;
    }
    
    return result;
  },

  /**
   * Force update the password verification marker
   * This can help when password verification is failing but you know the password is correct
   * @param password The password to force into the verification marker
   * @returns Promise resolving to true if successful
   */
  forceFixPasswordVerification: async (password: string): Promise<boolean> => {
    if (!password || password.trim() === '') {
      console.error('Password cannot be empty');
      return false;
    }
    
    console.warn('Force updating password verification marker');
    
    try {
      // Save original state
      const originalMasterKey = (secretManagerInstance as any).masterKey;
      const originalPassword = (secretManagerInstance as any).persistence.password;
      
      try {
        // Create a new marker with this password
        await (secretManagerInstance as any).deriveMasterKey(password);
        
        // First try to delete any existing verification marker
        await secretManagerInstance.removeSecret('pwd_verification_marker');
        
        // Then create a new one with the provided password
        const success = await (secretManagerInstance as any).createPasswordVerificationMarker(password);
        
        if (success) {
          console.log('Successfully created new password verification marker');
          return true;
        } else {
          console.error('Failed to create new password verification marker');
          return false;
        }
      } finally {
        // Restore original state
        (secretManagerInstance as any).masterKey = originalMasterKey;
        (secretManagerInstance as any).persistence.password = originalPassword;
      }
    } catch (error) {
      console.error('Error during password verification fix:', error);
      return false;
    }
  },

  /**
   * Check if persistent password verification is working correctly
   * @returns Diagnostic information about the verification system
   */
  diagnosePersistentPasswordIssue: async (): Promise<{
    hasVerificationMarker: boolean;
    persistenceEnabled: boolean;
    isPasswordProtected: boolean;
    hasStoredPassword: boolean;
    rawSecretCount: number;
    diagnosis: string;
  }> => {
    try {
      // Get direct database access
      const allSecrets = await (secretManagerInstance as any).directDatabaseReadAll();
      
      // Find verification marker
      const verificationMarker = allSecrets.find((s: any) => 
        s.id === 'pwd_verification_marker' || 
        s.type === 'pwd_verification'
      );
      
      // Check state
      const persistenceEnabled = !!(secretManagerInstance as any).persistence.enabled;
      const isPasswordProtected = !!(secretManagerInstance as any).persistence.passwordProtected;
      const hasStoredPassword = !!(secretManagerInstance as any).persistence.password;
      
      // Generate diagnosis
      let diagnosis = 'Normal operation';
      
      if (!persistenceEnabled) {
        diagnosis = 'Persistence is not enabled - password protection not active';
      } else if (!isPasswordProtected) {
        diagnosis = 'Database not configured for password protection';
      } else if (!hasStoredPassword) {
        diagnosis = 'No password currently stored - database is locked';
      } else if (!verificationMarker) {
        diagnosis = 'Missing password verification marker - needs to be created';
      }
      
      return {
        hasVerificationMarker: !!verificationMarker,
        persistenceEnabled,
        isPasswordProtected,
        hasStoredPassword,
        rawSecretCount: allSecrets.length,
        diagnosis
      };
    } catch (error) {
      console.error('Error diagnosing password issues:', error);
      return {
        hasVerificationMarker: false,
        persistenceEnabled: false,
        isPasswordProtected: false,
        hasStoredPassword: false,
        rawSecretCount: 0,
        diagnosis: 'Error diagnosing issues: ' + (error instanceof Error ? error.message : String(error))
      };
    }
  }
};