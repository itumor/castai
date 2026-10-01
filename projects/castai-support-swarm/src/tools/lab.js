// src/tools/lab.js — simulated cluster lab (contract section 6).
//
// Deterministic reproduction sandbox: no real cluster is ever touched.
// A node can be removed iff it is managed && !doNotEvict && every pod on it
// can move. Pod-level blockers: PDB protection, local storage, unmanaged
// (no controller), cannot-move. applyFix never mutates its input and covers
// the pod-level blockers; node-level blockers have no automatic fix.

/**
 * createCluster(spec)
 * spec: { nodes: [{ name, managed=true, doNotEvict=false }],
 *         pods:  [{ name, node, pdbProtected=false, localStorage=false,
 *                   managed=true, canMove=true }] }
 * Returns a normalized cluster { nodes, pods } with all defaults applied.
 */
export function createCluster(spec = {}) {
  const nodes = (spec.nodes ?? []).map((node) => ({
    name: node.name,
    managed: node.managed ?? true,
    doNotEvict: node.doNotEvict ?? false,
  }));
  const pods = (spec.pods ?? []).map((pod) => ({
    name: pod.name,
    node: pod.node,
    pdbProtected: pod.pdbProtected ?? false,
    localStorage: pod.localStorage ?? false,
    managed: pod.managed ?? true,
    canMove: pod.canMove ?? true,
  }));
  return { nodes, pods };
}

/** podBlockReasons(pod) -> stable reason strings for a single pod. */
function podBlockReasons(pod) {
  const reasons = [];
  if (pod.pdbProtected) reasons.push('pdb-blocks-eviction');
  if (pod.localStorage) reasons.push('pod-has-local-storage');
  if (!pod.managed) reasons.push('pod-not-managed-by-controller');
  if (!pod.canMove) reasons.push('pod-cannot-move');
  return reasons;
}

/**
 * findScaleDownBlockers(cluster) -> [{ node, reasons: string[] }]
 * Only blocked nodes appear. Reasons are stable, de-duplicated, node-level
 * reasons first (spec order of nodes and pods).
 */
export function findScaleDownBlockers(cluster) {
  const blockers = [];
  for (const node of cluster.nodes) {
    const reasons = [];
    if (!node.managed) reasons.push('node-not-castai-managed');
    if (node.doNotEvict) reasons.push('node-marked-do-not-evict');
    for (const pod of cluster.pods) {
      if (pod.node !== node.name) continue;
      reasons.push(...podBlockReasons(pod));
    }
    const deduped = [...new Set(reasons)];
    if (deduped.length > 0) {
      blockers.push({ node: node.name, reasons: deduped });
    }
  }
  return blockers;
}

/**
 * applyFix(cluster, fix) — fix: { kind: 'remove-pdb' |
 * 'remove-local-storage' | 'adopt-pod', pod?, node? }. Targets one pod by
 * name, all pods on a node, or all pods (neither selector given).
 * 'adopt-pod' makes the pod controller-managed and movable.
 * Returns a NEW cluster; the input is never mutated.
 */
export function applyFix(cluster, fix) {
  if (fix === null || typeof fix !== 'object' || typeof fix.kind !== 'string') {
    throw new Error('applyFix: fix.kind is required');
  }

  const next = {
    nodes: cluster.nodes.map((node) => ({ ...node })),
    pods: cluster.pods.map((pod) => ({ ...pod })),
  };

  const targets = next.pods.filter((pod) => {
    if (fix.pod !== undefined) return pod.name === fix.pod;
    if (fix.node !== undefined) return pod.node === fix.node;
    return true;
  });
  if ((fix.pod !== undefined || fix.node !== undefined) && targets.length === 0) {
    const selector = fix.pod !== undefined ? `pod '${fix.pod}'` : `node '${fix.node}'`;
    throw new Error(`applyFix: no pod matches ${selector}`);
  }

  switch (fix.kind) {
    case 'remove-pdb':
      for (const pod of targets) pod.pdbProtected = false;
      break;
    case 'remove-local-storage':
      for (const pod of targets) pod.localStorage = false;
      break;
    case 'adopt-pod':
      for (const pod of targets) {
        pod.managed = true;
        pod.canMove = true;
      }
      break;
    default:
      throw new Error(`applyFix: unknown fix kind '${fix.kind}'`);
  }

  return next;
}

/**
 * simulateScaleDown(cluster) -> { removable: string[], blocked: [{node, reasons}] }
 */
export function simulateScaleDown(cluster) {
  const blocked = findScaleDownBlockers(cluster);
  const blockedNodes = new Set(blocked.map((b) => b.node));
  const removable = cluster.nodes
    .filter((node) => !blockedNodes.has(node.name))
    .map((node) => node.name);
  return { removable, blocked };
}
