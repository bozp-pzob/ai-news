/**
 * Vitest global setup.
 *
 * Sets environment variables needed by services under test (e.g., encryption key)
 * so they don't require a running database or external services.
 */

import crypto from 'crypto';

// Generate a random test encryption key (64 hex chars = 32 bytes)
process.env.SECRETS_ENCRYPTION_KEY =
  process.env.SECRETS_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// Prevent Privy client from complaining about missing env vars
process.env.PRIVY_APP_ID = process.env.PRIVY_APP_ID || 'test-app-id';
process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || 'test-app-secret';
