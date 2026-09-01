import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { beforeMockApp, afterMockApp } from './_helpers.js';

describe('GET /api/topology', () => {
  beforeEach(beforeMockApp);
  afterEach(afterMockApp);

  it('links nodeClaims to nodePools, nodes to nodeClaims, and pods to nodes', async () => {
    const { createApp } = await import('../../../src/backend/server.js');
    const app = createApp();
    const res = await request(app).get('/api/topology');
    expect(res.status).toBe(200);

    const body = res.body;

    // NodePool summaries
    expect(Array.isArray(body.nodePools)).toBe(true);
    expect(body.nodePools.length).toBe(2);

    // NodeClaim summaries linked to pools
    expect(Array.isArray(body.nodeClaims)).toBe(true);
    expect(body.nodeClaims.length).toBe(2);
    const claimPoolMap = Object.fromEntries(
      body.nodeClaims.map((c: any) => [c.name, c.nodePool]),
    );
    expect(claimPoolMap['default-abc12']).toBe('default');
    expect(claimPoolMap['gpu-spot-xyz34']).toBe('gpu-spot');

    // Capacity type and instance type present
    for (const c of body.nodeClaims) {
      expect(['spot', 'on-demand', 'unknown']).toContain(c.capacityType);
      expect(typeof c.instanceType).toBe('string');
    }

    // Nodes linked to NodeClaims (and via NodeClaim to NodePool)
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(body.nodes.length).toBe(2);
    const nodeClaimToNodes: Record<string, string[]> = {};
    for (const n of body.nodes) {
      expect(typeof n.nodeClaim).toBe('string');
      nodeClaimToNodes[n.nodeClaim] = nodeClaimToNodes[n.nodeClaim] ?? [];
      nodeClaimToNodes[n.nodeClaim].push(n.name);
    }
    // Each NodeClaim has exactly one matching Node in the fixture set.
    expect(Object.keys(nodeClaimToNodes).length).toBeGreaterThanOrEqual(2);

    // Pods linked to nodes
    expect(Array.isArray(body.pods)).toBe(true);
    expect(body.pods.length).toBe(4);
    const podsByNode = new Map<string, any[]>();
    for (const p of body.pods) {
      if (!p.nodeName) continue;
      const arr = podsByNode.get(p.nodeName) ?? [];
      arr.push(p);
      podsByNode.set(p.nodeName, arr);
    }
    expect(podsByNode.size).toBeGreaterThanOrEqual(2);

    // Cluster summary present
    expect(body.cluster).toBeTruthy();
    expect(body.cluster.nodePoolCount).toBe(2);
    expect(body.cluster.nodeClaimCount).toBe(2);
    expect(body.cluster.nodeCount).toBe(2);
    expect(typeof body.cluster.spotCount).toBe('number');
    expect(typeof body.cluster.onDemandCount).toBe('number');
    expect(typeof body.cluster.totalCpu).toBe('string');
    expect(typeof body.cluster.totalMemory).toBe('string');

    // Events present
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(2);
  });
});
