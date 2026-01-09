// src/services/encryptionService.ts

import crypto from 'crypto';

/**
 * Encryption service for securely storing sensitive data like API keys,
 * Discord tokens, and database URLs.
 * 
 * Uses AES-256-GCM for authenticated encryption with a per-record salt.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits recommended for GCM
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the platform encryption key from environment
 */
function getPlatformKey(): Buffer {
  const key = process.env.SECRETS_ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('SECRETS_ENCRYPTION_KEY environment variable is not set');
  }
  
  // Key should be 64 hex characters (32 bytes)
  if (key.length !== 64) {
    throw new Error('SECRETS_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  
  return Buffer.from(key, 'hex');
}

/**
 * Derive a unique key for a specific context (e.g., configId)
 * This adds an additional layer of isolation between configs
 */
function deriveKey(masterKey: Buffer, salt: Buffer, context: string): Buffer {
  return crypto.pbkdf2Sync(
    Buffer.concat([masterKey, Buffer.from(context)]),
    salt,
    100000, // iterations
    KEY_LENGTH,
    'sha256'
  );
}

/**
 * Encrypt data with optional context for key derivation
 * 
 * @param data - The data to encrypt (will be JSON stringified if object)
 * @param context - Optional context for key derivation (e.g., configId)
 * @returns Base64 encoded encrypted data with salt, IV, and auth tag
 */
export function encrypt(data: string | object, context?: string): string {
  const masterKey = getPlatformKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key with context if provided
  const key = context 
    ? deriveKey(masterKey, salt, context)
    : crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');
  
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Format: salt (16) + iv (12) + authTag (16) + encrypted (variable)
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Decrypt data with optional context for key derivation
 * 
 * @param encryptedData - Base64 encoded encrypted data
 * @param context - Optional context for key derivation (must match encryption context)
 * @returns Decrypted data as string or parsed JSON object
 */
export function decrypt<T = any>(encryptedData: string, context?: string): T {
  const masterKey = getPlatformKey();
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  // Derive key with context if provided
  const key = context 
    ? deriveKey(masterKey, salt, context)
    : crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString('utf8');
  
  // Try to parse as JSON, return string if it fails
  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return decrypted as T;
  }
}

/**
 * Encrypt secrets object for a specific config
 * 
 * @param secrets - Object containing secrets (Discord tokens, API keys, etc.)
 * @param configId - Config ID for context-based key derivation
 * @returns Encrypted secrets as base64 string
 */
export function encryptSecrets(secrets: Record<string, string>, configId: string): string {
  return encrypt(secrets, configId);
}

/**
 * Decrypt secrets object for a specific config
 * 
 * @param encryptedSecrets - Base64 encoded encrypted secrets
 * @param configId - Config ID for context-based key derivation
 * @returns Decrypted secrets object
 */
export function decryptSecrets(encryptedSecrets: string, configId: string): Record<string, string> {
  return decrypt<Record<string, string>>(encryptedSecrets, configId);
}

/**
 * Encrypt a database URL for storage
 * 
 * @param dbUrl - PostgreSQL connection URL
 * @param configId - Config ID for context-based key derivation
 * @returns Encrypted URL as base64 string
 */
export function encryptDbUrl(dbUrl: string, configId: string): string {
  return encrypt(dbUrl, configId);
}

/**
 * Decrypt a database URL
 * 
 * @param encryptedUrl - Base64 encoded encrypted URL
 * @param configId - Config ID for context-based key derivation
 * @returns Decrypted PostgreSQL connection URL
 */
export function decryptDbUrl(encryptedUrl: string, configId: string): string {
  return decrypt<string>(encryptedUrl, configId);
}

/**
 * Generate a new encryption key (for initial setup)
 * 
 * @returns 64-character hex string suitable for SECRETS_ENCRYPTION_KEY
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Hash a value for comparison (e.g., checking if a wallet address exists)
 * 
 * @param value - Value to hash
 * @returns SHA-256 hash as hex string
 */
export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a secure random token (for API keys, etc.)
 * 
 * @param length - Length in bytes (default 32)
 * @returns Random hex string (2x length characters)
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Validate that the encryption key is properly configured
 * 
 * @returns True if key is valid, throws error otherwise
 */
export function validateEncryptionKey(): boolean {
  try {
    const key = getPlatformKey();
    
    // Test encryption/decryption
    const testData = 'encryption-test-' + Date.now();
    const encrypted = encrypt(testData);
    const decrypted = decrypt<string>(encrypted);
    
    if (decrypted !== testData) {
      throw new Error('Encryption validation failed: decrypted data does not match');
    }
    
    return true;
  } catch (error) {
    throw new Error(`Encryption key validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const encryptionService = {
  encrypt,
  decrypt,
  encryptSecrets,
  decryptSecrets,
  encryptDbUrl,
  decryptDbUrl,
  generateEncryptionKey,
  generateToken,
  hash,
  validateEncryptionKey
};
