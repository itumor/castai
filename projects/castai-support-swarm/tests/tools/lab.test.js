// tests/tools/lab.test.js — simulated cluster lab (contract section 6):
// blocker matrix, applyFix round-trips, simulateScaleDown.

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFix, createCluster, findScaleDownBlockers, simulateScaleDown } from '../../src/tools/lab.js';

const reasonsFor = (cluster, node) =>
  findScaleDownBlockers(cluster).find((b) => b.node === node)?.reasons ?? [];

test('createCluster applies the contract defaults', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }],
    pods: [{ name: 'p1', node: 'n1' }],
  });
  assert.deepEqual(cluster.nodes, [{ name: 'n1', managed: true, doNotEvict: false }]);
  assert.deepEqual(cluster.pods, [
    { name: 'p1', node: 'n1', pdbProtected: false, localStorage: false, managed: true, canMove: true },
  ]);
});

test('a clean managed node is removable', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }],
    pods: [{ name: 'p1', node: 'n1' }],
  });
  assert.deepEqual(findScaleDownBlockers(cluster), []);
  assert.deepEqual(simulateScaleDown(cluster), { removable: ['n1'], blocked: [] });
});

test('blocker matrix: pdb / localStorage / unmanaged pod / doNotEvict / unmanaged node', () => {
  const cluster = createCluster({
    nodes: [
      { name: 'pdb-node' },
      { name: 'storage-node' },
      { name: 'unmanaged-pod-node' },
      { name: 'dne-node', doNotEvict: true },
      { name: 'external-node', managed: false },
      { name: 'clean-node' },
    ],
    pods: [
      { name: 'pdb-pod', node: 'pdb-node', pdbProtected: true },
      { name: 'storage-pod', node: 'storage-node', localStorage: true },
      { name: 'bare-pod', node: 'unmanaged-pod-node', managed: false },
      { name: 'regular-pod', node: 'dne-node' },
    ],
  });

  const blockers = findScaleDownBlockers(cluster);
  const byNode = Object.fromEntries(blockers.map((b) => [b.node, b.reasons]));
  assert.deepEqual(byNode['pdb-node'], ['pdb-blocks-eviction']);
  assert.deepEqual(byNode['storage-node'], ['pod-has-local-storage']);
  assert.deepEqual(byNode['unmanaged-pod-node'], ['pod-not-managed-by-controller']);
  assert.deepEqual(byNode['dne-node'], ['node-marked-do-not-evict']);
  assert.deepEqual(byNode['external-node'], ['node-not-castai-managed']);
  assert.equal(byNode['clean-node'], undefined);

  const sim = simulateScaleDown(cluster);
  assert.deepEqual(sim.removable, ['clean-node']);
  assert.equal(sim.blocked.length, 5);
});

test('reasons accumulate and de-duplicate per node', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1', doNotEvict: true }],
    pods: [
      { name: 'p1', node: 'n1', pdbProtected: true, localStorage: true, canMove: false },
      { name: 'p2', node: 'n1', pdbProtected: true },
    ],
  });
  assert.deepEqual(reasonsFor(cluster, 'n1'), [
    'node-marked-do-not-evict',
    'pdb-blocks-eviction',
    'pod-has-local-storage',
    'pod-cannot-move',
  ]);
});

test('pods on other nodes do not block this node', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }, { name: 'n2' }],
    pods: [{ name: 'p1', node: 'n2', pdbProtected: true }],
  });
  assert.deepEqual(reasonsFor(cluster, 'n1'), []);
  assert.deepEqual(simulateScaleDown(cluster).removable, ['n1']);
});

test('applyFix remove-pdb clears the blocker without mutating the input', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }],
    pods: [{ name: 'p1', node: 'n1', pdbProtected: true }],
  });
  const fixed = applyFix(cluster, { kind: 'remove-pdb', pod: 'p1' });
  assert.notEqual(fixed, cluster);
  assert.equal(cluster.pods[0].pdbProtected, true, 'input cluster unchanged');
  assert.equal(fixed.pods[0].pdbProtected, false);
  assert.deepEqual(findScaleDownBlockers(fixed), []);
  assert.deepEqual(simulateScaleDown(fixed).removable, ['n1']);
});

test('applyFix remove-local-storage clears the blocker', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }],
    pods: [{ name: 'p1', node: 'n1', localStorage: true }],
  });
  const fixed = applyFix(cluster, { kind: 'remove-local-storage', pod: 'p1' });
  assert.equal(cluster.pods[0].localStorage, true, 'input cluster unchanged');
  assert.deepEqual(findScaleDownBlockers(fixed), []);
});

test('applyFix adopt-pod clears the unmanaged-pod blocker', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }],
    pods: [{ name: 'p1', node: 'n1', managed: false }],
  });
  const fixed = applyFix(cluster, { kind: 'adopt-pod', pod: 'p1' });
  assert.equal(cluster.pods[0].managed, false, 'input cluster unchanged');
  assert.equal(fixed.pods[0].managed, true);
  assert.equal(fixed.pods[0].canMove, true);
  assert.deepEqual(findScaleDownBlockers(fixed), []);
});

test('applyFix can target every pod on a node', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }, { name: 'n2' }],
    pods: [
      { name: 'p1', node: 'n1', pdbProtected: true },
      { name: 'p2', node: 'n1', pdbProtected: true },
      { name: 'p3', node: 'n2', pdbProtected: true },
    ],
  });
  const fixed = applyFix(cluster, { kind: 'remove-pdb', node: 'n1' });
  assert.deepEqual(findScaleDownBlockers(fixed).map((b) => b.node), ['n2']);
  assert.equal(fixed.pods.find((p) => p.name === 'p3').pdbProtected, true);
});

test('node-level blockers have no automatic fix', () => {
  const dne = createCluster({ nodes: [{ name: 'n1', doNotEvict: true }], pods: [] });
  assert.deepEqual(reasonsFor(applyFix(dne, { kind: 'remove-pdb' }), 'n1'), ['node-marked-do-not-evict']);

  const external = createCluster({ nodes: [{ name: 'n2', managed: false }], pods: [] });
  assert.deepEqual(reasonsFor(applyFix(external, { kind: 'adopt-pod' }), 'n2'), ['node-not-castai-managed']);
});

test('applyFix validates kind and selector', () => {
  const cluster = createCluster({ nodes: [{ name: 'n1' }], pods: [{ name: 'p1', node: 'n1' }] });
  assert.throws(() => applyFix(cluster, { kind: 'nuke-the-node' }));
  assert.throws(() => applyFix(cluster, { kind: 'remove-pdb', pod: 'no-such-pod' }));
  assert.throws(() => applyFix(cluster, { kind: 'remove-pdb', node: 'no-such-node' }));
  assert.throws(() => applyFix(cluster, {}));
});

test('simulateScaleDown reports removable and blocked together', () => {
  const cluster = createCluster({
    nodes: [{ name: 'n1' }, { name: 'n2', doNotEvict: true }],
    pods: [{ name: 'p1', node: 'n1' }],
  });
  assert.deepEqual(simulateScaleDown(cluster), {
    removable: ['n1'],
    blocked: [{ node: 'n2', reasons: ['node-marked-do-not-evict'] }],
  });
});
