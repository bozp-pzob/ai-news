/**
 * Tests for the encryption service.
 *
 * Covers: encrypt/decrypt round-trip, context isolation,
 * secrets encryption, DB URL encryption, key validation,
 * and tamper detection.
 */

import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptSecrets,
  decryptSecrets,
  encryptDbUrl,
  decryptDbUrl,
  generateEncryptionKey,
  generateToken,
  hash,
  validateEncryptionKey,
} from '../src/services/encryptionService';

describe('encryptionService', () => {
  // ── Basic encrypt / decrypt ──────────────────────────────

  it('round-trips a plain string', () => {
    const plaintext = 'hello world';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt<string>(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('round-trips a JSON object', () => {
    const obj = { apiKey: 'sk-test-123', token: 'xoxb-abc' };
    const encrypted = encrypt(obj);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toEqual(obj);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'determinism-check';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  // ── Context isolation ────────────────────────────────────

  it('decryption fails with wrong context', () => {
    const encrypted = encrypt('secret', 'config-A');
    expect(() => decrypt(encrypted, 'config-B')).toThrow();
  });

  it('decryption succeeds with correct context', () => {
    const encrypted = encrypt('secret', 'config-A');
    const decrypted = decrypt<string>(encrypted, 'config-A');
    expect(decrypted).toBe('secret');
  });

  // ── Secrets helpers ──────────────────────────────────────

  it('encrypts and decrypts secrets per config', () => {
    const secrets = { DISCORD_TOKEN: 'tok-123', OPENAI_API_KEY: 'sk-abc' };
    const configId = 'c0c0-cafe-babe';

    const encrypted = encryptSecrets(secrets, configId);
    const decrypted = decryptSecrets(encrypted, configId);

    expect(decrypted).toEqual(secrets);
  });

  it('fails to decrypt secrets with wrong configId', () => {
    const secrets = { key: 'value' };
    const encrypted = encryptSecrets(secrets, 'config-1');
    expect(() => decryptSecrets(encrypted, 'config-2')).toThrow();
  });

  // ── DB URL helpers ───────────────────────────────────────

  it('encrypts and decrypts a database URL', () => {
    const url = 'postgresql://user:pass@host:5432/db';
    const configId = 'db-cfg-id';

    const encrypted = encryptDbUrl(url, configId);
    const decrypted = decryptDbUrl(encrypted, configId);

    expect(decrypted).toBe(url);
  });

  // ── Tamper detection ─────────────────────────────────────

  it('detects tampered ciphertext (GCM auth tag)', () => {
    const encrypted = encrypt('tamper-me');
    // Flip a byte in the middle of the base64-decoded buffer
    const buf = Buffer.from(encrypted, 'base64');
    buf[buf.length - 5] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => decrypt(tampered)).toThrow();
  });

  // ── Utility functions ────────────────────────────────────

  it('generateEncryptionKey returns a 64-char hex string', () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it('generateToken returns a hex string of the expected length', () => {
    const tok16 = generateToken(16);
    expect(tok16).toHaveLength(32); // 16 bytes = 32 hex chars

    const tok32 = generateToken();
    expect(tok32).toHaveLength(64); // default 32 bytes = 64 hex chars
  });

  it('hash returns a consistent SHA-256 hex digest', () => {
    const h1 = hash('test');
    const h2 = hash('test');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('validateEncryptionKey succeeds when key is configured', () => {
    expect(validateEncryptionKey()).toBe(true);
  });
});
