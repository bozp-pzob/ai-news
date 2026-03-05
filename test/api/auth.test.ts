/**
 * API — Auth middleware tests
 *
 * Tests the requireAuth middleware in isolation: verifies that missing tokens,
 * malformed tokens, and invalid Privy tokens all return 401, and that once a
 * valid user is synthesised the middleware attaches it to req.user.
 *
 * The Privy SDK is mocked so no network calls are made.  databaseService is
 * mocked with the SQLite test database so user records can be persisted and
 * retrieved deterministically.
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// ── Module mocks (hoisted before any imports) ──────────────────────────────

vi.mock('../../src/services/databaseService', () => ({
  databaseService: { query: vi.fn() },
}));

vi.mock('../../src/services/licenseService', () => ({
  licenseService: {
    verifyLicense: vi.fn().mockResolvedValue({ isActive: false }),
  },
  RUN_PAYMENT: { amount: '0.10', currency: 'USDC' },
}));

vi.mock('../../src/services/adminService', () => ({
  adminService: {
    verifyImpersonationToken: vi.fn().mockReturnValue(null),
  },
}));

// Mock PrivyClient: verifyAuthToken rejects by default; specific tests
// override it to return a valid claims object.
const mockVerifyAuthToken = vi.fn();
const mockGetUser = vi.fn();
vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: vi.fn().mockImplementation(function () {
    return {
      verifyAuthToken: mockVerifyAuthToken,
      getUser: mockGetUser,
    };
  }),
}));

// ── Real imports (after mocks) ─────────────────────────────────────────────

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { databaseService } from '../../src/services/databaseService';
import { requireAuth } from '../../src/middleware/authMiddleware';
import {
  initTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
  createDbUser,
  testQuery,
} from '../db/testDatabase';

// ── Test app setup ─────────────────────────────────────────────────────────

// A tiny app that runs requireAuth then echoes req.user back as JSON.
const app = express();
app.use(express.json());
app.get(
  '/protected',
  requireAuth as any,
  (req: any, res: Response) => res.json({ user: req.user })
);

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initTestDatabase();
  vi.mocked(databaseService.query).mockImplementation(testQuery);
});

beforeEach(async () => {
  await clearTestDatabase();
  mockVerifyAuthToken.mockReset();
  mockGetUser.mockReset();
  // Default: token verification fails
  mockVerifyAuthToken.mockRejectedValue(new Error('invalid token'));
});

afterAll(async () => {
  await closeTestDatabase();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('requireAuth middleware', () => {
  describe('missing / malformed Authorization header', () => {
    it('returns 401 when no Authorization header is sent', async () => {
      const res = await request(app).get('/protected');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('returns 401 when header is not Bearer scheme', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(res.status).toBe(401);
    });

    it('returns 401 for empty Bearer token', async () => {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer ');
      // Either a Privy rejection or our own guard
      expect(res.status).toBe(401);
    });
  });

  describe('invalid / expired token', () => {
    it('returns 401 when Privy rejects the token', async () => {
      mockVerifyAuthToken.mockRejectedValue(new Error('Token expired'));
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer bad.token.here');
      expect(res.status).toBe(401);
    });

    it('returns 401 when verifiedClaims has no userId', async () => {
      mockVerifyAuthToken.mockResolvedValue({ userId: null });
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer no-user-id');
      expect(res.status).toBe(401);
    });
  });

  describe('valid token — new user', () => {
    it('creates a new user record and attaches it to req.user', async () => {
      const privyId = 'did:privy:test-new-user';
      mockVerifyAuthToken.mockResolvedValue({ userId: privyId });
      mockGetUser.mockResolvedValue({
        id: privyId,
        email: { address: 'newuser@example.com' },
        wallet: null,
        linkedAccounts: [],
      });

      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.privyId).toBe(privyId);
      expect(res.body.user.email).toBe('newuser@example.com');
      expect(res.body.user.tier).toBe('free');
    });
  });

  describe('valid token — returning user', () => {
    it('retrieves the existing user from the database', async () => {
      // Pre-insert a user
      const existing = await createDbUser({
        privy_id: 'did:privy:existing-user',
        email: 'existing@example.com',
        tier: 'paid',
      });

      mockVerifyAuthToken.mockResolvedValue({ userId: 'did:privy:existing-user' });
      mockGetUser.mockResolvedValue({
        id: 'did:privy:existing-user',
        email: { address: 'existing@example.com' },
        wallet: null,
        linkedAccounts: [],
      });

      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token-existing');

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(existing.id);
      // Tier should reflect what's in the DB
      expect(res.body.user.tier).toBe('paid');
    });
  });

  describe('banned user', () => {
    it('returns 403 when a non-admin user is banned', async () => {
      await createDbUser({
        privy_id: 'did:privy:banned-user',
        email: 'banned@example.com',
        tier: 'free',
      });
      // Mark as banned via raw SQLite
      const { getDb } = await import('../db/testDatabase');
      await getDb().run(
        `UPDATE users SET is_banned = 1 WHERE privy_id = 'did:privy:banned-user'`
      );

      mockVerifyAuthToken.mockResolvedValue({ userId: 'did:privy:banned-user' });
      mockGetUser.mockResolvedValue({
        id: 'did:privy:banned-user',
        email: { address: 'banned@example.com' },
        wallet: null,
        linkedAccounts: [],
      });

      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token-banned');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/suspended/i);
    });
  });
});
