/**
 * Minimal Express application for integration tests.
 *
 * Creates a lightweight server that mounts specific route modules against a
 * SQLite in-memory database.  The caller controls which test user is injected
 * as `req.user` — Privy verification is bypassed entirely in test mode.
 *
 * Usage (in a test file that has already called vi.mock for databaseService
 * and authMiddleware):
 *
 *   const { app, setTestUser } = createTestApp();
 *   const res = await request(app).get('/api/v1/health');
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import type { AuthUser } from '../../src/middleware/authMiddleware';

export interface TestAppContext {
  app: Express;
  /** Set the user that will be attached to req.user on every request */
  setTestUser: (user: AuthUser | null) => void;
  /** Convenience: current injected user */
  currentUser: () => AuthUser | null;
}

/** Default free-tier test user */
export const FREE_USER: AuthUser = {
  id: 'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa',
  privyId: 'privy-free-user',
  email: 'free@test.example',
  tier: 'free',
};

export const PAID_USER: AuthUser = {
  id: 'bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb',
  privyId: 'privy-paid-user',
  email: 'paid@test.example',
  tier: 'paid',
};

export const ADMIN_USER: AuthUser = {
  id: 'cccccccc-0000-4000-8000-cccccccccccc',
  privyId: 'privy-admin-user',
  email: 'admin@test.example',
  tier: 'admin',
};

/**
 * Build a self-contained test Express app.
 *
 * @param routes - Optional map of path → router to mount.  Defaults to an
 *                 empty app with just the health endpoint.
 */
export function createTestApp(
  routes?: Record<string, express.Router>
): TestAppContext {
  let _user: AuthUser | null = FREE_USER;

  const app = express();
  app.use(express.json());

  // ── Auth-inject middleware ─────────────────────────────────────────────
  // Replaces Privy token verification: just copies _user onto req.user.
  // Tests that specifically verify auth-rejection behaviour bypass this by
  // using the real authMiddleware in isolation (see test/api/auth.test.ts).
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.user = _user ?? undefined;
    next();
  });

  // ── Built-in health route ──────────────────────────────────────────────
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV ?? 'test',
    });
  });

  // ── Mount caller-supplied routes ───────────────────────────────────────
  if (routes) {
    for (const [path, router] of Object.entries(routes)) {
      app.use(path, router);
    }
  }

  // ── Generic error handler ──────────────────────────────────────────────
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode ?? err.status ?? 500;
    res.status(status).json({ error: err.message ?? 'Internal server error' });
  });

  return {
    app,
    setTestUser: (u) => { _user = u; },
    currentUser: () => _user,
  };
}
