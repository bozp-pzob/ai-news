/**
 * configEncryption.ts
 *
 * Browser-side AES-256-GCM encryption/decryption using the Web Crypto API.
 * Wire-format compatible with the Node.js module at src/helpers/localEncryption.ts.
 *
 * Wire format:
 *   { encrypted: base64, iv: base64, tag: base64 }
 *
 * The key is a 256-bit (32-byte) random value encoded as base64.
 *
 * Note: Web Crypto's GCM implementation appends the auth tag to the ciphertext
 * automatically, so we split it back out to match the Node.js wire format.
 */

const IV_LENGTH = 12; // 96-bit IV
const TAG_LENGTH = 16; // 128-bit auth tag

export interface EncryptedPayload {
  encrypted: string; // base64
  iv: string; // base64
  tag: string; // base64
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Key Management ───────────────────────────────────────────────────────────

/**
 * Import a base64-encoded 256-bit key as a CryptoKey for AES-GCM.
 */
async function importKey(keyBase64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToBuffer(keyBase64);
  if (keyBuffer.byteLength !== 32) {
    throw new Error('Invalid key: must be 32 bytes (256 bits) base64-encoded');
  }
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// ── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt a config object (or any data) with a base64-encoded AES-256 key.
 * Returns the wire-format payload compatible with the Node.js decryptor.
 */
export async function encryptConfig(
  data: object | string,
  keyBase64: string
): Promise<EncryptedPayload> {
  const key = await importKey(keyBase64);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext =
    typeof data === 'string' ? data : JSON.stringify(data);
  const encoded = new TextEncoder().encode(plaintext);

  // Web Crypto appends the 16-byte auth tag to the ciphertext
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    key,
    encoded
  );

  // Split: ciphertext (all but last 16 bytes) + tag (last 16 bytes)
  const combined = new Uint8Array(ciphertextWithTag);
  const ciphertext = combined.slice(0, combined.length - TAG_LENGTH);
  const tag = combined.slice(combined.length - TAG_LENGTH);

  return {
    encrypted: bufferToBase64(ciphertext.buffer),
    iv: bufferToBase64(iv.buffer),
    tag: bufferToBase64(tag.buffer),
  };
}

// ── Decryption ───────────────────────────────────────────────────────────────

/**
 * Decrypt a wire-format payload with a base64-encoded AES-256 key.
 * Returns the plaintext string. Throws on invalid key or tampered data.
 */
export async function decryptConfig(
  payload: EncryptedPayload,
  keyBase64: string
): Promise<string> {
  const key = await importKey(keyBase64);

  const iv = new Uint8Array(base64ToBuffer(payload.iv));
  const ciphertext = new Uint8Array(base64ToBuffer(payload.encrypted));
  const tag = new Uint8Array(base64ToBuffer(payload.tag));

  // Web Crypto expects ciphertext + tag concatenated
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8 },
    key,
    combined.buffer
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Decrypt a wire-format payload and parse as JSON.
 */
export async function decryptConfigJson<T = any>(
  payload: EncryptedPayload,
  keyBase64: string
): Promise<T> {
  const plaintext = await decryptConfig(payload, keyBase64);
  return JSON.parse(plaintext) as T;
}
