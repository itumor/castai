import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  beforeMockApp,
  afterMockApp,
} from './_helpers.js';

describe('GET /api/pods', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('returns 4 fixtures with running and pending phases', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/pods');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(4);
    const phases = res.body.map((p: any) => p.phase).sort();
    expect(phases).toEqual(['Pending', 'Pending', 'Running', 'Running']);
    for (const p of res.body) {
      expect(p.name).toBeTruthy();
      expect(p.namespace).toBeTruthy();
      expect(p.uid).toBeTruthy();
    }
  });

  it('filters pods by ?namespace=batch and returns only matching fixtures', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/pods?namespace=batch');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].namespace).toBe('batch');
    expect(res.body[0].name).toBe('batch-processor-1');
    for (const p of res.body) {
      expect(p.namespace).toBe('batch');
    }
  });
});

describe('GET /api/pods error handling', () => {
  beforeEach(() => {
    process.env.MOCK_K8S = 'true';
  });

  afterEach(() => {
    delete process.env.MOCK_K8S;
    vi.resetModules();
  });

  it('returns HTTP 500 with { error: ... } when the mock client throws', async () => {
    // Set up empty mock state, then break listPods to throw.
    const clientModule = await import('../../../src/backend/k8s/client.js');
    clientModule.resetK8sClient();
    clientModule.setMockClusterData(undefined);

    // Import the server, then replace the cached client to force an error.
    const serverModule = await import('../../../src/backend/server.js');
    const app = serverModule.createApp();

    // Force the underlying service to throw by mocking listPods.
    const resourcesModule = await import('../../../src/backend/services/resources.js');
    const spy = vi
      .spyOn(resourcesModule, 'fetchAllPods')
      .mockRejectedValueOnce(new Error('simulated k8s client failure'));

    const res = await request(app).get('/api/pods');

    expect(spy).toHaveBeenCalled();
    expect(res.status).toBe(500);
    expect(res.body).toBeTruthy();
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);

    spy.mockRestore();
  });
});
