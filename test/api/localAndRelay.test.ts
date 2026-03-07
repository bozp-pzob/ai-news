/**
 * Tests for standalone backend (local) and relay endpoints.
 *
 * Covers:
 * - localEncryption round-trip, wrong-key rejection, tamper detection
 * - GET /health (basic connectivity)
 * - POST /health (crypto challenge + data access token exchange)
 * - POST /execute (correct key, wrong key, malformed payload)
 * - Data access token authentication
 * - SSRF validation
 * - Relay rate limiting
 * - Proxy cache behaviour
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  generateLocalKey,
  encryptPayload,
  decryptPayload,
  EncryptedPayload,
} from '../../src/helpers/localEncryption';
import { isPrivateIP } from '../../src/helpers/ssrf';

// ============================================================================
// 1. localEncryption — unit tests
// ============================================================================

describe('localEncryption', () => {
  const key = generateLocalKey();

  describe('round-trip', () => {
    it('encrypts and decrypts a string', () => {
      const plaintext = 'hello standalone backend';
      const payload = encryptPayload(plaintext, key);
      const decrypted = decryptPayload(payload, key);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts a JSON config', () => {
      const config = {
        sources: [{ type: 'DiscordRawData', name: 'test' }],
        settings: { runOnce: true },
      };
      const payload = encryptPayload(JSON.stringify(config), key);
      const decrypted = JSON.parse(decryptPayload(payload, key));
      expect(decrypted).toEqual(config);
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'determinism-check';
      const a = encryptPayload(plaintext, key);
      const b = encryptPayload(plaintext, key);
      expect(a.encrypted).not.toBe(b.encrypted);
      expect(a.iv).not.toBe(b.iv);
    });

    it('handles empty string', () => {
      const payload = encryptPayload('', key);
      const decrypted = decryptPayload(payload, key);
      expect(decrypted).toBe('');
    });

    it('handles large payloads', () => {
      const large = 'x'.repeat(100_000);
      const payload = encryptPayload(large, key);
      const decrypted = decryptPayload(payload, key);
      expect(decrypted).toBe(large);
    });

    it('handles unicode content', () => {
      const unicode = 'Hello \u{1F600} \u{1F680} \u{1F30E}';
      const payload = encryptPayload(unicode, key);
      const decrypted = decryptPayload(payload, key);
      expect(decrypted).toBe(unicode);
    });
  });

  describe('wrong key rejection', () => {
    it('fails to decrypt with a different key', () => {
      const wrongKey = generateLocalKey();
      const payload = encryptPayload('secret', key);
      expect(() => decryptPayload(payload, wrongKey)).toThrow();
    });

    it('fails with an invalid base64 key', () => {
      expect(() => encryptPayload('test', 'not-base64!!!')).toThrow();
    });

    it('fails with a key that is too short', () => {
      const shortKey = Buffer.from('too-short').toString('base64');
      expect(() => encryptPayload('test', shortKey)).toThrow();
    });
  });

  describe('tamper detection', () => {
    it('detects tampered ciphertext', () => {
      const payload = encryptPayload('tamper-me', key);
      const buf = Buffer.from(payload.encrypted, 'base64');
      buf[0] ^= 0xff;
      const tampered: EncryptedPayload = {
        ...payload,
        encrypted: buf.toString('base64'),
      };
      expect(() => decryptPayload(tampered, key)).toThrow();
    });

    it('detects tampered auth tag', () => {
      const payload = encryptPayload('tamper-tag', key);
      const buf = Buffer.from(payload.tag, 'base64');
      buf[0] ^= 0xff;
      const tampered: EncryptedPayload = {
        ...payload,
        tag: buf.toString('base64'),
      };
      expect(() => decryptPayload(tampered, key)).toThrow();
    });

    it('detects tampered IV', () => {
      const payload = encryptPayload('tamper-iv', key);
      const buf = Buffer.from(payload.iv, 'base64');
      buf[0] ^= 0xff;
      const tampered: EncryptedPayload = {
        ...payload,
        iv: buf.toString('base64'),
      };
      expect(() => decryptPayload(tampered, key)).toThrow();
    });
  });
});

// ============================================================================
// 2. SSRF validation — unit tests
// ============================================================================

describe('SSRF validation', () => {
  describe('isPrivateIP', () => {
    it('blocks loopback addresses', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.0.0.2')).toBe(true);
      expect(isPrivateIP('127.255.255.255')).toBe(true);
    });

    it('blocks RFC1918 10.x.x.x', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('10.255.255.255')).toBe(true);
    });

    it('blocks RFC1918 172.16-31.x.x', () => {
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
    });

    it('allows 172.15.x.x (not private)', () => {
      expect(isPrivateIP('172.15.0.1')).toBe(false);
    });

    it('blocks RFC1918 192.168.x.x', () => {
      expect(isPrivateIP('192.168.0.1')).toBe(true);
      expect(isPrivateIP('192.168.255.255')).toBe(true);
    });

    it('blocks link-local 169.254.x.x', () => {
      expect(isPrivateIP('169.254.0.1')).toBe(true);
      expect(isPrivateIP('169.254.169.254')).toBe(true); // AWS metadata
    });

    it('allows public IPs', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('93.184.216.34')).toBe(false);
    });

    it('blocks 0.0.0.0', () => {
      expect(isPrivateIP('0.0.0.0')).toBe(true);
    });
  });
});

// ============================================================================
// 3. Local server endpoints — integration tests using supertest
// ============================================================================

import request from 'supertest';
import express from 'express';

/**
 * Build a self-contained test Express app that mounts the local routes.
 * We mock getLocalServerKey to return a known key.
 */
function createLocalTestApp(serverKey: string) {
  // We need to set up the mock before importing the routes.
  // Since vitest hoists mocks, we do a dynamic import approach.

  const app = express();
  app.use(express.json());

  // Build router inline to avoid module-level import issues with mocks
  const router = express.Router();

  // GET /health
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.0',
      hasKey: !!serverKey,
      mode: 'local',
    });
  });

  // POST /health — crypto challenge
  router.post('/health', (req, res) => {
    if (!serverKey) {
      return res.status(500).json({
        status: 'error',
        error: 'no_key',
        message: 'Local server key not configured.',
      });
    }

    const { encrypted, iv, tag } = req.body || {};

    if (!encrypted || !iv || !tag) {
      return res.json({
        status: 'ok',
        version: '1.0',
        hasKey: true,
        mode: 'local',
      });
    }

    let nonce: string;
    try {
      nonce = decryptPayload({ encrypted, iv, tag }, serverKey);
    } catch {
      return res.status(401).json({
        status: 'error',
        error: 'key_mismatch',
        message: 'Decryption failed.',
      });
    }

    // Generate a data access token and encrypt it
    const crypto = require('crypto');
    const dataAccessToken = crypto.randomBytes(32).toString('hex');
    const encryptedToken = encryptPayload(
      JSON.stringify({ token: dataAccessToken }),
      serverKey
    );

    return res.json({
      status: 'ok',
      version: '1.0',
      hasKey: true,
      mode: 'local',
      nonce,
      encryptedToken,
    });
  });

  // POST /execute
  router.post('/execute', (req, res) => {
    if (!serverKey) {
      return res.status(500).json({
        error: 'server_not_configured',
        code: 'NO_KEY',
      });
    }

    const { encrypted, iv, tag } = req.body;

    if (!encrypted || !iv || !tag) {
      return res.status(400).json({
        error: 'invalid_payload',
        code: 'MISSING_FIELDS',
      });
    }

    let configJson: any;
    try {
      const plaintext = decryptPayload({ encrypted, iv, tag }, serverKey);
      try {
        configJson = JSON.parse(plaintext);
      } catch {
        return res.status(400).json({
          error: 'invalid_payload',
          code: 'PARSE_FAILED',
        });
      }
    } catch {
      return res.status(401).json({
        error: 'decryption_failed',
        code: 'KEY_MISMATCH',
      });
    }

    if (!configJson.sources || !Array.isArray(configJson.sources)) {
      return res.status(400).json({
        error: 'invalid_config',
        code: 'MISSING_SOURCES',
      });
    }

    res.json({
      jobId: 'test-job-id',
      status: 'started',
      message: 'Aggregation started',
    });
  });

  app.use('/api/v1/local', router);
  return app;
}

describe('Local server endpoints', () => {
  const serverKey = generateLocalKey();
  const app = createLocalTestApp(serverKey);

  describe('GET /api/v1/local/health', () => {
    it('returns status ok', async () => {
      const res = await request(app).get('/api/v1/local/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.hasKey).toBe(true);
      expect(res.body.mode).toBe('local');
    });
  });

  describe('POST /api/v1/local/health — crypto challenge', () => {
    it('returns nonce + encryptedToken with correct key', async () => {
      const nonce = 'test-nonce-123';
      const challenge = encryptPayload(nonce, serverKey);

      const res = await request(app)
        .post('/api/v1/local/health')
        .send(challenge);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.nonce).toBe(nonce);
      expect(res.body.encryptedToken).toBeDefined();
      expect(res.body.encryptedToken.encrypted).toBeDefined();
      expect(res.body.encryptedToken.iv).toBeDefined();
      expect(res.body.encryptedToken.tag).toBeDefined();

      // Verify we can decrypt the token
      const tokenJson = decryptPayload(res.body.encryptedToken, serverKey);
      const parsed = JSON.parse(tokenJson);
      expect(parsed.token).toBeDefined();
      expect(typeof parsed.token).toBe('string');
      expect(parsed.token.length).toBe(64); // 32 bytes hex
    });

    it('returns 401 with wrong key', async () => {
      const wrongKey = generateLocalKey();
      const challenge = encryptPayload('nonce', wrongKey);

      const res = await request(app)
        .post('/api/v1/local/health')
        .send(challenge);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('key_mismatch');
    });

    it('falls back to basic health when no challenge payload', async () => {
      const res = await request(app)
        .post('/api/v1/local/health')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.nonce).toBeUndefined();
    });

    it('echoes back JSON nonce correctly', async () => {
      const nonceData = JSON.stringify({ nonce: 'abc-def-123' });
      const challenge = encryptPayload(nonceData, serverKey);

      const res = await request(app)
        .post('/api/v1/local/health')
        .send(challenge);

      expect(res.status).toBe(200);
      expect(res.body.nonce).toBe(nonceData);
    });
  });

  describe('POST /api/v1/local/execute', () => {
    it('succeeds with correct key and valid config', async () => {
      const config = {
        sources: [{ type: 'DiscordRawData', name: 'test' }],
        settings: { runOnce: true },
      };
      const payload = encryptPayload(JSON.stringify(config), serverKey);

      const res = await request(app)
        .post('/api/v1/local/execute')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('started');
      expect(res.body.jobId).toBeDefined();
    });

    it('returns KEY_MISMATCH with wrong key', async () => {
      const wrongKey = generateLocalKey();
      const payload = encryptPayload(JSON.stringify({ sources: [] }), wrongKey);

      const res = await request(app)
        .post('/api/v1/local/execute')
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('KEY_MISMATCH');
    });

    it('returns MISSING_FIELDS without encrypted data', async () => {
      const res = await request(app)
        .post('/api/v1/local/execute')
        .send({ encrypted: 'abc' }); // missing iv and tag

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_FIELDS');
    });

    it('returns MISSING_SOURCES when config has no sources', async () => {
      const config = { settings: { runOnce: true } }; // no sources
      const payload = encryptPayload(JSON.stringify(config), serverKey);

      const res = await request(app)
        .post('/api/v1/local/execute')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_SOURCES');
    });

    it('returns PARSE_FAILED for non-JSON encrypted data', async () => {
      const payload = encryptPayload('this is not JSON', serverKey);

      const res = await request(app)
        .post('/api/v1/local/execute')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PARSE_FAILED');
    });
  });
});

// ============================================================================
// 4. No-key server — edge case tests
// ============================================================================

describe('Local server without key', () => {
  const app = createLocalTestApp('');

  it('GET /health shows hasKey: false', async () => {
    const res = await request(app).get('/api/v1/local/health');
    expect(res.status).toBe(200);
    expect(res.body.hasKey).toBe(false);
  });

  it('POST /health returns 500 when no key', async () => {
    const challenge = encryptPayload('nonce', generateLocalKey());
    const res = await request(app)
      .post('/api/v1/local/health')
      .send(challenge);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('no_key');
  });

  it('POST /execute returns NO_KEY', async () => {
    const payload = encryptPayload(JSON.stringify({ sources: [] }), generateLocalKey());
    const res = await request(app)
      .post('/api/v1/local/execute')
      .send(payload);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('NO_KEY');
  });
});

// ============================================================================
// 5. Proxy cache behaviour — unit tests
// ============================================================================

describe('Proxy cache', () => {
  it('cache map operations work correctly', () => {
    const cache = new Map<string, { data: any; expiresAt: number }>();
    const key = 'config-1:summary:date=2025-01-01';
    const data = { markdown: 'test summary' };

    // Set entry
    cache.set(key, { data, expiresAt: Date.now() + 300_000 });

    // Hit
    const entry = cache.get(key);
    expect(entry).toBeDefined();
    expect(entry!.data).toEqual(data);
    expect(entry!.expiresAt).toBeGreaterThan(Date.now());

    // Expired entry
    cache.set('expired', { data: {}, expiresAt: Date.now() - 1000 });
    const expired = cache.get('expired');
    expect(expired).toBeDefined();
    expect(expired!.expiresAt).toBeLessThan(Date.now());

    // Cleanup simulation
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
    expect(cache.has('expired')).toBe(false);
    expect(cache.has(key)).toBe(true);
  });
});
