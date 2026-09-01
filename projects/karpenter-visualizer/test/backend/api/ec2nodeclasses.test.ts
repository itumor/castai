import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/ec2nodeclasses', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns 1 fixture', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/ec2nodeclasses');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const enc = res.body[0];
    expect(enc.name).toBe('default');
    expect(enc.namespace).toBe('karpenter');
    expect(enc.uid).toBeTruthy();
    expect(typeof enc.amiFamily).toBe('string');
    expect(typeof enc.subnetSelectorTerms).toBe('number');
    expect(typeof enc.securityGroupSelectorTerms).toBe('number');
  });
});
