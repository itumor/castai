import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/nodepools', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns 2 fixtures', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/nodepools');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((p: any) => p.name).sort();
    expect(names).toEqual(['default', 'gpu-spot']);
    for (const p of res.body) {
      expect(p.name).toBeTruthy();
      expect(p.namespace).toBe('karpenter');
      expect(p.uid).toBeTruthy();
      expect(Array.isArray(p.requirements)).toBe(true);
    }
  });
});
