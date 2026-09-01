import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/backend/server.js';

describe('GET /api/healthz', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp();

    const res = await request(app).get('/api/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
