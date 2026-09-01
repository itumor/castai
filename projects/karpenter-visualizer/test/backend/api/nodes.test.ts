import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/nodes', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns 2 fixtures (one spot, one on-demand)', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/nodes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const cap = res.body.map((n: any) => n.capacityType).sort();
    expect(cap).toEqual(['on-demand', 'spot']);
    for (const n of res.body) {
      expect(n.name).toBeTruthy();
      expect(n.uid).toBeTruthy();
      expect(typeof n.instanceType).toBe('string');
      expect(typeof n.zone).toBe('string');
      expect(n.architecture).toBe('amd64');
      expect(typeof n.nodePool).toBe('string');
      expect(typeof n.nodeClaim).toBe('string');
      expect(typeof n.cpuCapacity).toBe('string');
      expect(typeof n.memoryCapacity).toBe('string');
      expect(n.ready).toBe(true);
    }
  });
});
