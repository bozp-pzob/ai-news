/**
 * Vitest global setup.
 *
 * Sets environment variables consumed by services so they run in test mode
 * without requiring a live database, Privy account, or any external service.
 *
 * This file is listed as `setupFiles` in vitest.config.ts and runs once per
 * worker before any test files are executed.
 */

import crypto from 'crypto';

// ── Encryption ─────────────────────────────────────────────────────────────
// 32-byte hex key required by encryptionService
process.env.SECRETS_ENCRYPTION_KEY =
  process.env.SECRETS_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// ── Privy (auth) ───────────────────────────────────────────────────────────
// authMiddleware initialises a PrivyClient from these; tests mock out the
// actual verification so the values only need to be present (not valid).
process.env.PRIVY_APP_ID     = process.env.PRIVY_APP_ID     || 'test-app-id';
process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || 'test-app-secret';

// ── Database ───────────────────────────────────────────────────────────────
// Signals to any code that checks DATABASE_URL that we're in test mode.
// The actual DB connection is replaced with the SQLite test database via
// vi.mock('../../src/services/databaseService') in each test file.
process.env.DATABASE_URL = 'sqlite::memory:';
process.env.NODE_ENV     = 'test';

// ── Solana / payments ──────────────────────────────────────────────────────
// Prevents payment middleware from contacting external RPC endpoints.
process.env.VITE_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
process.env.POP402_MOCK_MODE    = 'true';

// ── AI providers ───────────────────────────────────────────────────────────
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';

// ── Redis (BullMQ) ─────────────────────────────────────────────────────────
// Leave REDIS_URL unset so queue-dependent code falls back to "no-redis" paths.
delete process.env.REDIS_URL;

// ── Discord / Telegram ─────────────────────────────────────────────────────
// Prevent any bot-init code from connecting during tests.
delete process.env.DISCORD_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
