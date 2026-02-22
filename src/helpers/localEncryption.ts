/**
 * localEncryption.ts
 *
 * AES-256-GCM encryption/decryption for the local server execution flow.
 * Uses a raw base64 key (no key derivation) — compatible with the browser's
 * SubtleCrypto implementation in frontend/src/services/configEncryption.ts.
 *
 * Wire format:
 *   { encrypted: base64, iv: base64, tag: base64 }
 *
 * The key is a 256-bit (32-byte) random value encoded as base64.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

export interface EncryptedPayload {
  encrypted: string; // base64
  iv: string; // base64
  tag: string; // base64
}

/**
 * Generate a new 256-bit AES key, returned as base64.
 */
export function generateLocalKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Encrypt a plaintext string with a base64-encoded AES-256 key.
 */
export function encryptPayload(plaintext: string, keyBase64: string): EncryptedPayload {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid key: must be 32 bytes (256 bits) base64-encoded');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt a payload with a base64-encoded AES-256 key.
 * Throws on invalid key, tampered data, or wrong key.
 */
export function decryptPayload(payload: EncryptedPayload, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Invalid key: must be 32 bytes (256 bits) base64-encoded');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const encrypted = Buffer.from(payload.encrypted, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV: expected ${IV_LENGTH} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag: expected ${TAG_LENGTH} bytes, got ${tag.length}`);
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
