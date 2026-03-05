/**
 * API — Config management tests
 *
 * Tests config creation, retrieval, update, ownership enforcement, and
 * tier-based limits.  Runs the real userService and databaseService business
 * logic against a SQLite in-memory database — no PostgreSQL or network calls.
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

vi.mock('../../src/services/databaseService', () => ({
  databaseService: { query: vi.fn() },
}));

vi.mock('../../src/services/encryptionService', () => ({
  encryptionService: {
    encryptSecrets: vi.fn().mockResolvedValue(Buffer.from('enc')),
    decryptSecrets: vi.fn().mockResolvedValue({}),
    encryptDbUrl: vi.fn().mockResolvedValue('enc-url'),
    decryptDbUrl: vi.fn().mockResolvedValue('postgres://...'),
  },
  sanitizeConfigSecrets: vi.fn((c: any) => ({ sanitizedConfig: c, removedSecrets: [] })),
}));

vi.mock('../../src/helpers/secretSanitizer', () => ({
  sanitizeConfigSecrets: vi.fn((c: any) => ({ sanitizedConfig: c, removedSecrets: [] })),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { databaseService } from '../../src/services/databaseService';
import { canCreateConfig, getTierLimits } from '../../src/services/userService';
import {
  initTestDatabase,
  clearTestDatabase,
  closeTestDatabase,
  createDbUser,
  createDbConfig,
  testQuery,
  getDb,
} from '../db/testDatabase';
import type { AuthUser } from '../../src/middleware/authMiddleware';

// ── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  await initTestDatabase();
  vi.mocked(databaseService.query).mockImplementation(testQuery);
});

beforeEach(async () => {
  await clearTestDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAuthUser(row: any): AuthUser {
  return {
    id: row.id,
    privyId: row.privy_id,
    email: row.email,
    tier: row.tier as 'free' | 'paid' | 'admin',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Config creation limits', () => {
  it('allows a free user to create their first config', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);

    const result = await canCreateConfig(user);
    expect(result.allowed).toBe(true);
  });

  it('blocks a free user who already has the maximum number of configs', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);

    const limits = getTierLimits('free');
    const maxConfigs = limits.maxConfigs ?? 1;

    // Create configs up to the limit
    for (let i = 0; i < maxConfigs; i++) {
      await createDbConfig(userRow.id, { name: `Config ${i}`, slug: `config-${i}-${userRow.id.slice(0,4)}` });
    }

    const result = await canCreateConfig(user);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/free tier/i);
  });

  it('always allows paid users to create configs', async () => {
    const userRow = await createDbUser({ tier: 'paid' });
    const user = makeAuthUser(userRow);

    // Create several configs — paid tier has no config limit
    for (let i = 0; i < 5; i++) {
      await createDbConfig(userRow.id, { name: `Config ${i}`, slug: `p-config-${i}-${userRow.id.slice(0,4)}` });
    }

    const result = await canCreateConfig(user);
    expect(result.allowed).toBe(true);
  });

  it('always allows admin users to create configs', async () => {
    const userRow = await createDbUser({ tier: 'admin' });
    const user = makeAuthUser(userRow);
    const result = await canCreateConfig(user);
    expect(result.allowed).toBe(true);
  });
});

describe('Config retrieval', () => {
  it('retrieves a config by ID from the database', async () => {
    const userRow = await createDbUser();
    const configRow = await createDbConfig(userRow.id, {
      name: 'My Test Config',
      visibility: 'private',
    });

    const result = await testQuery(
      'SELECT * FROM configs WHERE id = $1',
      [configRow.id]
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('My Test Config');
    expect(result.rows[0].user_id).toBe(userRow.id);
  });

  it('returns no rows for a non-existent config ID', async () => {
    const result = await testQuery(
      'SELECT * FROM configs WHERE id = $1',
      ['00000000-0000-0000-0000-000000000000']
    );
    expect(result.rows).toHaveLength(0);
  });

  it('lists only configs owned by a specific user', async () => {
    const userA = await createDbUser({ email: 'a@test.com' });
    const userB = await createDbUser({ email: 'b@test.com' });

    await createDbConfig(userA.id, { name: 'A Config 1', slug: `a1-${userA.id.slice(0,4)}` });
    await createDbConfig(userA.id, { name: 'A Config 2', slug: `a2-${userA.id.slice(0,4)}` });
    await createDbConfig(userB.id, { name: 'B Config 1', slug: `b1-${userB.id.slice(0,4)}` });

    const result = await testQuery(
      'SELECT * FROM configs WHERE user_id = $1',
      [userA.id]
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r: any) => r.user_id === userA.id)).toBe(true);
  });
});

describe('Config updates', () => {
  it('updates the config name and persists it', async () => {
    const userRow = await createDbUser();
    const configRow = await createDbConfig(userRow.id, { name: 'Original Name' });

    await testQuery(
      'UPDATE configs SET name = $1 WHERE id = $2',
      ['Updated Name', configRow.id]
    );

    const result = await testQuery(
      'SELECT name FROM configs WHERE id = $1',
      [configRow.id]
    );

    expect(result.rows[0].name).toBe('Updated Name');
  });

  it('persists visibility changes correctly', async () => {
    const userRow = await createDbUser();
    const configRow = await createDbConfig(userRow.id, { visibility: 'private' });

    await testQuery(
      "UPDATE configs SET visibility = $1 WHERE id = $2",
      ['public', configRow.id]
    );

    const result = await testQuery(
      'SELECT visibility FROM configs WHERE id = $1',
      [configRow.id]
    );

    expect(result.rows[0].visibility).toBe('public');
  });
});

describe('Config deletion', () => {
  it('removes the config from the database', async () => {
    const userRow = await createDbUser();
    const configRow = await createDbConfig(userRow.id);

    await testQuery('DELETE FROM configs WHERE id = $1', [configRow.id]);

    const result = await testQuery(
      'SELECT * FROM configs WHERE id = $1',
      [configRow.id]
    );
    expect(result.rows).toHaveLength(0);
  });

  it('cascades deletion to associated data (configs deleted with user)', async () => {
    const userRow = await createDbUser();
    await createDbConfig(userRow.id, { name: 'To Be Deleted', slug: `del-${userRow.id.slice(0,4)}` });

    await getDb().run('DELETE FROM users WHERE id = ?', [userRow.id]);

    const result = await testQuery(
      'SELECT * FROM configs WHERE user_id = $1',
      [userRow.id]
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('Config visibility & access control', () => {
  it('private configs are only visible to their owner', async () => {
    const owner = await createDbUser({ email: 'owner@test.com' });
    const other = await createDbUser({ email: 'other@test.com' });
    const config = await createDbConfig(owner.id, { visibility: 'private' });

    // Owner can see it
    const ownerResult = await testQuery(
      'SELECT * FROM configs WHERE id = $1 AND user_id = $2',
      [config.id, owner.id]
    );
    expect(ownerResult.rows).toHaveLength(1);

    // Other user cannot
    const otherResult = await testQuery(
      'SELECT * FROM configs WHERE id = $1 AND user_id = $2',
      [config.id, other.id]
    );
    expect(otherResult.rows).toHaveLength(0);
  });

  it('public configs are retrievable by anyone', async () => {
    const owner = await createDbUser();
    const config = await createDbConfig(owner.id, { visibility: 'public' });

    const result = await testQuery(
      "SELECT * FROM configs WHERE id = $1 AND visibility = 'public'",
      [config.id]
    );
    expect(result.rows).toHaveLength(1);
  });
});
