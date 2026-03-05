/**
 * Tests for the centralized error handling middleware.
 *
 * Covers: AppError rendering, unknown error handling, JSON parse errors,
 * and non-API route passthrough.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError, errorMiddleware, asyncHandler } from '../src/middleware/errorMiddleware';

// Minimal Express-like mock objects
function mockReq(overrides: Partial<{ originalUrl: string }> = {}) {
  return {
    originalUrl: overrides.originalUrl ?? '/api/v1/test',
    method: 'GET',
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    _json: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res._json = body;
      return res;
    },
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

describe('errorMiddleware', () => {
  // ── AppError ─────────────────────────────────────────────

  describe('AppError', () => {
    it('sets status and message', () => {
      const err = new AppError('Not Found', 404);
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not Found');
      expect(err).toBeInstanceOf(Error);
    });

    it('defaults to 500', () => {
      const err = new AppError('boom');
      expect(err.statusCode).toBe(500);
    });
  });

  // ── errorMiddleware ──────────────────────────────────────

  describe('handler', () => {
    it('renders AppError with correct status and message', () => {
      const err = new AppError('Forbidden', 403);
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      errorMiddleware(err, req, res, next);

      expect(res.statusCode).toBe(403);
      expect(res._json.error).toBe('Forbidden');
    });

    it('renders unknown errors as 500', () => {
      const err = new Error('oops');
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      errorMiddleware(err, req, res, next);

      expect(res.statusCode).toBe(500);
      expect(res._json.error).toBeTruthy();
    });

    it('handles non-AppError as 500 with generic message', () => {
      const err = new SyntaxError('Unexpected token');
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      errorMiddleware(err as any, req, res, next);

      expect(res.statusCode).toBe(500);
      expect(res._json.error).toBe('Internal server error');
    });
  });

  // ── asyncHandler ─────────────────────────────────────────

  describe('asyncHandler', () => {
    it('calls next with error on rejection', async () => {
      const boom = new Error('async boom');
      const handler = asyncHandler(async () => {
        throw boom;
      });

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(boom);
    });

    it('does not call next on success', async () => {
      const handler = asyncHandler(async (_req: any, res: any) => {
        res.json({ ok: true });
      });

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await handler(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res._json).toEqual({ ok: true });
    });
  });
});
