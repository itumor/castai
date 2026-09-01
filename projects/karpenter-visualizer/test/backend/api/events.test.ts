import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/events', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns event fixtures referencing Karpenter objects', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const involved = res.body.map((e: any) => e.involvedObject.kind).sort();
    expect(involved).toContain('NodeClaim');
    expect(involved).toContain('Pod');
    for (const e of res.body) {
      expect(typeof e.reason).toBe('string');
      expect(typeof e.message).toBe('string');
      expect(['Normal', 'Warning']).toContain(e.type);
      expect(e.involvedObject).toBeTruthy();
      expect(e.involvedObject.name).toBeTruthy();
    }
  });
});
