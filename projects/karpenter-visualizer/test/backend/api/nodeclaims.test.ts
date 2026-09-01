import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/nodeclaims', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns 2 fixtures with pool/instance info', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/nodeclaims');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    for (const c of res.body) {
      expect(c.name).toBeTruthy();
      expect(c.namespace).toBe('karpenter');
      expect(c.uid).toBeTruthy();
      expect(['spot', 'on-demand', 'unknown']).toContain(c.capacityType);
      expect(typeof c.instanceType).toBe('string');
    }
    const poolNames = res.body.map((c: any) => c.nodePool).sort();
    expect(poolNames).toEqual(['default', 'gpu-spot']);
  });
});
