/**
 * API — Free run and aggregation limit tests
 *
 * Exercises the core daily free-run gate:
 *   • canUserRunFree()    — is the free slot available?
 *   • markFreeRunUsed()   — marks the slot consumed
 *   • getFreeRunStatus()  — returns detailed status for the UI
 *   • canRunAggregation() — tier-based daily run-count enforcement
 *
 * All database I/O goes through the SQLite test database.  The business logic
 * in jobService and userService runs unmodified; only databaseService.query is
 * swapped for the in-memory SQLite implementation.
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
import { canRunAggregation } from '../../src/services/userService';
import {
  canUserRunFree,
  markFreeRunUsed,
  getFreeRunStatus,
} from '../../src/services/jobService';
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
    tier: row.tier as 'free' | 'paid' | 'admin',
  };
}

/** Yesterday's date as an ISO date string */
function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

/** Today's date as an ISO date string */
function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ── canUserRunFree() ───────────────────────────────────────────────────────

describe('canUserRunFree()', () => {
  it('returns true for a fresh user who has never used their free run', async () => {
    const user = await createDbUser({ free_run_used_at: null });
    expect(await canUserRunFree(user.id)).toBe(true);
  });

  it('returns true if the free run was used on a previous day', async () => {
    const user = await createDbUser({ free_run_used_at: yesterday() });
    expect(await canUserRunFree(user.id)).toBe(true);
  });

  it('returns false if the free run was already used today', async () => {
    const user = await createDbUser({ free_run_used_at: today() });
    expect(await canUserRunFree(user.id)).toBe(false);
  });

  it('returns false for an unknown user ID', async () => {
    // No user exists with this ID
    expect(
      await canUserRunFree('00000000-dead-4000-8000-000000000000')
    ).toBe(false);
  });
});

// ── markFreeRunUsed() ──────────────────────────────────────────────────────

describe('markFreeRunUsed()', () => {
  it('sets free_run_used_at to today', async () => {
    const user = await createDbUser({ free_run_used_at: null });

    await markFreeRunUsed(user.id);

    const result = await testQuery(
      'SELECT free_run_used_at FROM users WHERE id = $1',
      [user.id]
    );
    expect(result.rows[0].free_run_used_at).toBe(today());
  });

  it('prevents a second free run on the same day', async () => {
    const user = await createDbUser({ free_run_used_at: null });

    // First use
    await markFreeRunUsed(user.id);
    expect(await canUserRunFree(user.id)).toBe(false);
  });

  it('allows another free run after the previous use was yesterday', async () => {
    // Pre-mark as yesterday
    const user = await createDbUser({ free_run_used_at: yesterday() });
    // Still available (yesterday)
    expect(await canUserRunFree(user.id)).toBe(true);
    // Use today
    await markFreeRunUsed(user.id);
    // No longer available
    expect(await canUserRunFree(user.id)).toBe(false);
  });
});

// ── getFreeRunStatus() ─────────────────────────────────────────────────────

describe('getFreeRunStatus()', () => {
  it('returns available:true and a future resetAt for a fresh user', async () => {
    const user = await createDbUser({ free_run_used_at: null });
    const status = await getFreeRunStatus(user.id);

    expect(status.available).toBe(true);
    expect(status.usedAt).toBeNull();
    expect(status.resetAt).toBeInstanceOf(Date);
    expect(status.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns available:false with usedAt set when free run was used today', async () => {
    const user = await createDbUser({ free_run_used_at: today() });
    const status = await getFreeRunStatus(user.id);

    expect(status.available).toBe(false);
    expect(status.usedAt).not.toBeNull();
    // resetAt should be future (next midnight)
    expect(status.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns available:true when usedAt is yesterday (daily reset)', async () => {
    const user = await createDbUser({ free_run_used_at: yesterday() });
    const status = await getFreeRunStatus(user.id);

    expect(status.available).toBe(true);
  });

  it('resetAt is always in the future (next UTC midnight)', async () => {
    const user = await createDbUser();
    const status = await getFreeRunStatus(user.id);
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    // resetAt should be roughly midnight tomorrow (±1 hour tolerance)
    const diff = Math.abs(status.resetAt.getTime() - tomorrow.getTime());
    expect(diff).toBeLessThan(60 * 60 * 1000);
  });
});

// ── canRunAggregation() ───────────────────────────────────────────────────

describe('canRunAggregation()', () => {
  it('always allows admin users', async () => {
    const userRow = await createDbUser({ tier: 'admin' });
    const user = makeAuthUser(userRow);
    const config = await createDbConfig(userRow.id);

    const result = await canRunAggregation(user, config.id);
    expect(result.allowed).toBe(true);
  });

  it('always allows paid users', async () => {
    const userRow = await createDbUser({ tier: 'paid' });
    const user = makeAuthUser(userRow);
    const config = await createDbConfig(userRow.id);

    const result = await canRunAggregation(user, config.id);
    expect(result.allowed).toBe(true);
  });

  it('allows a free user who has not hit their daily run limit', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);
    const config = await createDbConfig(userRow.id);

    // runs_today is 0 by default in the test schema
    const result = await canRunAggregation(user, config.id);
    expect(result.allowed).toBe(true);
  });

  it('blocks a free user at the daily run limit', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);
    const config = await createDbConfig(userRow.id);

    // Saturate the daily counter — use datetime('now') so the timestamp has
    // time-of-day info and survives timezone-based Date comparisons.
    const FREE_MAX = parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY ?? '3', 10);
    await getDb().run(
      `UPDATE configs SET runs_today = ?, runs_today_reset_at = datetime('now') WHERE id = ?`,
      [FREE_MAX, config.id]
    );

    const result = await canRunAggregation(user, config.id);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/free tier/i);
  });

  it('resets the counter and allows the run when reset_at is stale', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);
    const config = await createDbConfig(userRow.id);

    // Saturate counter but with yesterday's date → should reset
    const FREE_MAX = parseInt(process.env.FREE_TIER_MAX_RUNS_PER_DAY ?? '3', 10);
    await getDb().run(
      `UPDATE configs SET runs_today = ?, runs_today_reset_at = date('now', '-1 day') WHERE id = ?`,
      [FREE_MAX, config.id]
    );

    const result = await canRunAggregation(user, config.id);
    expect(result.allowed).toBe(true);
  });

  it('returns not-found reason for a non-existent config', async () => {
    const userRow = await createDbUser({ tier: 'free' });
    const user = makeAuthUser(userRow);

    const result = await canRunAggregation(user, '00000000-dead-4000-8000-000000000000');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });
});
