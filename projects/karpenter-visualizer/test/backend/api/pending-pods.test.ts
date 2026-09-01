import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/pending-pods', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns only Pending pods with scheduling evidence', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/pending-pods');
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(2);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(2);

    for (const item of res.body.items) {
      expect(item.pod.phase).toBe('Pending');
      expect(item.evidence).toBeTruthy();
    }

    const advanced = res.body.items.find(
      (it: any) => it.pod.name === 'batch-processor-1',
    );
    expect(advanced).toBeTruthy();
    // Resource requests present
    expect(advanced.evidence.requests.cpu).toBeTruthy();
    expect(advanced.evidence.requests.memory).toBeTruthy();
    // nodeSelector captured
    expect(advanced.evidence.nodeSelector['karpenter.sh/capacity-type']).toBe('spot');
    // Affinity captured
    expect(advanced.evidence.affinity).toBeTruthy();
    expect(advanced.evidence.affinity.nodeAffinity).toBeTruthy();
    expect(advanced.evidence.affinity.podAntiAffinity).toBeTruthy();
    // Topology spread captured
    expect(Array.isArray(advanced.evidence.topologySpreadConstraints)).toBe(true);
    expect(advanced.evidence.topologySpreadConstraints.length).toBeGreaterThanOrEqual(2);
    // Tolerations captured
    expect(Array.isArray(advanced.evidence.tolerations)).toBe(true);
    expect(advanced.evidence.tolerations.length).toBeGreaterThanOrEqual(2);
    // Architecture / zone preferences captured
    expect(advanced.evidence.architecture).toBe('amd64');
    expect(Array.isArray(advanced.evidence.zonePreference)).toBe(true);
    expect(advanced.evidence.zonePreference).toContain('us-east-1a');

    const simple = res.body.items.find(
      (it: any) => it.pod.name === 'metrics-scraper',
    );
    expect(simple).toBeTruthy();
    expect(simple.evidence.requests.cpu).toBe('100m');
    expect(simple.evidence.requests.memory).toBe('128Mi');
    expect(simple.evidence.nodeSelector['kubernetes.io/os']).toBe('linux');
    expect(simple.evidence.tolerations.length).toBe(1);
    expect(simple.evidence.tolerations[0].key).toBe('dedicated');
  });
});
