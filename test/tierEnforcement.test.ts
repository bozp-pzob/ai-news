/**
 * Tests for tier enforcement logic.
 *
 * Tests the pure business logic functions from userService that determine
 * whether a user can perform actions based on their tier. These don't
 * require a database — they test the logic in isolation by mocking the
 * databaseService.query call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock databaseService before importing userService
vi.mock('../src/services/databaseService', () => ({
  databaseService: {
    query: vi.fn(),
    getClient: vi.fn(),
  },
}));

// Mock encryptionService (required by userService import chain)
vi.mock('../src/services/encryptionService', () => ({
  encryptionService: {
    encryptSecrets: vi.fn(() => 'encrypted'),
    decryptSecrets: vi.fn(() => ({})),
    encryptDbUrl: vi.fn(() => 'encrypted-url'),
    decryptDbUrl: vi.fn(() => 'postgres://...'),
  },
  sanitizeConfigSecrets: vi.fn((c: any) => ({ sanitizedConfig: c, removedSecrets: [] })),
}));

// Mock the secret sanitizer
vi.mock('../src/helpers/secretSanitizer', () => ({
  sanitizeConfigSecrets: vi.fn((c: any) => ({ sanitizedConfig: c, removedSecrets: [] })),
}));

import { canCreateConfig, canRunAggregation, getTierLimits } from '../src/services/userService';
import { databaseService } from '../src/services/databaseService';
import { AuthUser } from '../src/middleware/authMiddleware';

const mockQuery = vi.mocked(databaseService.query);

function makeUser(tier: 'free' | 'paid' | 'admin'): AuthUser {
  return { id: 'u-1', privyId: 'privy-1', tier };
}

describe('Tier enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── canCreateConfig ──────────────────────────────────────

  describe('canCreateConfig', () => {
    it('allows admin users always', async () => {
      const result = await canCreateConfig(makeUser('admin'));
      expect(result.allowed).toBe(true);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('allows paid users always', async () => {
      const result = await canCreateConfig(makeUser('paid'));
      expect(result.allowed).toBe(true);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('allows free users under the config limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as any);
      const result = await canCreateConfig(makeUser('free'));
      expect(result.allowed).toBe(true);
    });

    it('blocks free users at the config limit', async () => {
      // FREE_TIER_MAX_CONFIGS defaults to 1
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] } as any);
      const result = await canCreateConfig(makeUser('free'));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Free tier');
    });
  });

  // ── canRunAggregation ────────────────────────────────────

  describe('canRunAggregation', () => {
    it('allows admin users always', async () => {
      const result = await canRunAggregation(makeUser('admin'), 'cfg-1');
      expect(result.allowed).toBe(true);
    });

    it('allows paid users always', async () => {
      const result = await canRunAggregation(makeUser('paid'), 'cfg-1');
      expect(result.allowed).toBe(true);
    });

    it('allows free users under the daily run limit', async () => {
      // Use a reset_at that's definitely "today" in local time — matches
      // the setHours(0,0,0,0) comparison in canRunAggregation
      const todayLocal = new Date();
      todayLocal.setHours(12, 0, 0, 0); // noon today, safely after local midnight
      mockQuery.mockResolvedValueOnce({
        rows: [{ runs_today: 0, runs_today_reset_at: todayLocal.toISOString() }],
      } as any);

      const result = await canRunAggregation(makeUser('free'), 'cfg-1');
      expect(result.allowed).toBe(true);
    });

    it('blocks free users at the daily run limit', async () => {
      // FREE_TIER_MAX_RUNS_PER_DAY defaults to 3
      // Use a reset_at that's definitely "today" in local time — noon today
      // is always >= local midnight, so the counter won't be reset to 0
      const todayLocal = new Date();
      todayLocal.setHours(12, 0, 0, 0); // noon today, safely after local midnight
      mockQuery.mockResolvedValueOnce({
        rows: [{ runs_today: 3, runs_today_reset_at: todayLocal.toISOString() }],
      } as any);

      const result = await canRunAggregation(makeUser('free'), 'cfg-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Free tier');
    });

    it('resets counter when reset_at is stale', async () => {
      // Reset date is yesterday → effectively 0 runs today
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      mockQuery.mockResolvedValueOnce({
        rows: [{ runs_today: 999, runs_today_reset_at: yesterday.toISOString().split('T')[0] }],
      } as any);

      const result = await canRunAggregation(makeUser('free'), 'cfg-1');
      expect(result.allowed).toBe(true);
    });

    it('returns not-found reason if config missing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      const result = await canRunAggregation(makeUser('free'), 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── getTierLimits ────────────────────────────────────────

  describe('getTierLimits', () => {
    it('returns config limits for free tier', () => {
      const limits = getTierLimits('free');
      expect(limits.maxConfigs).toBeGreaterThanOrEqual(1);
      expect(limits.maxRunsPerDay).toBeGreaterThanOrEqual(1);
      expect(limits.aiModel).toBeTruthy();
    });

    it('returns AI/token limits for paid tier', () => {
      const limits = getTierLimits('paid');
      expect(limits.dailyAiCalls).toBeGreaterThan(0);
      expect(limits.dailyTokenBudget).toBeGreaterThan(0);
      expect(limits.aiModel).toBeTruthy();
    });

    it('returns unlimited for admin tier', () => {
      const limits = getTierLimits('admin');
      expect(limits.maxConfigs).toBeUndefined();
      expect(limits.maxRunsPerDay).toBeUndefined();
      expect(limits.aiModel).toBeTruthy();
    });
  });
});
