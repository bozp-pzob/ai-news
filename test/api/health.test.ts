/**
 * API — Health endpoint tests
 *
 * Tests the GET /api/v1/health route: status code, response shape, and that
 * the timestamp is a valid ISO-8601 string.  No database or auth required.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestApp } from './testApp';

const { app } = createTestApp();

describe('GET /api/v1/health', () => {
  it('returns HTTP 200', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('responds with { status: "ok" }', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.status).toBe('ok');
  });

  it('includes a valid ISO-8601 timestamp', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.timestamp).toBeDefined();
    const parsed = new Date(res.body.timestamp);
    expect(parsed.toString()).not.toBe('Invalid Date');
    // Should be within the last 5 seconds
    expect(Date.now() - parsed.getTime()).toBeLessThan(5_000);
  });

  it('sets Content-Type to application/json', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
