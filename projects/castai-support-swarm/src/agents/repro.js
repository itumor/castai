// src/agents/repro.js — contract section 7 of CONTRACTS.md
// Reproduction agent. Uses the deterministic lab simulation to prove the
// scale-down story end to end: simulateScaleDown finds the top blocker,
// applyFix applies the matching fix, and a second simulation proves the node
// becomes removable. Adds REPRODUCED "reproduction" evidence and flips
// hypothesis statuses (confirmed for the proven blocker, rejected for
// hypothesised causes the simulation shows are not blockers).
//
// Safety: read-only. Everything happens in the local lab simulation.

import { addEvidence, setHypothesisStatus } from '../core/model.js';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

const AGENT_ID = 'repro';
const AGENT_NAME = 'Reproduction Engineer';

// Same trivial healthy default as the SRE agent: one managed node, no pods.
const DEFAULT_SIM_SPEC = { nodes: [{ name: 'node-1' }], pods: [] };

const MAX_FIX_STEPS = 20; // hard bound so the fix loop can never spin

// Stable blocker reasons -> lab fix kinds (contract section 6: applyFix
// accepts { kind: 'remove-pdb'|'remove-local-storage'|'adopt-pod', pod?, node? }).
// Node-level blockers have no lab fix kind; they are reported but not fixable.
const REASON_INFO = {
  'pdb-blocks-eviction': { fix: 'remove-pdb', matchPods: (pods) => pods.filter((p) => p.pdbProtected) },
  'pod-has-local-storage': { fix: 'remove-local-storage', matchPods: (pods) => pods.filter((p) => p.localStorage) },
  'pod-not-managed-by-controller': { fix: 'adopt-pod', matchPods: (pods) => pods.filter((p) => p.managed === false) },
  'pod-cannot-move': { fix: null, matchPods: (pods) => pods.filter((p) => p.canMove === false) },
  'node-marked-do-not-evict': { fix: null, matchPods: () => [] },
  'node-not-castai-managed': { fix: null, matchPods: () => [] },
};

// Applies the documented lab defaults; also gives us a deterministic pod list
// for mapping blocker reasons to concrete pods.
function normalizeSpec(spec) {
  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
  const pods = Array.isArray(spec?.pods) ? spec.pods : [];
  return {
    nodes: nodes.map((n) => ({ managed: true, doNotEvict: false, ...n })),
    pods: pods.map((p) => ({ pdbProtected: false, localStorage: false, managed: true, canMove: true, ...p })),
  };
}

// Hypotheses opened by the SRE agent follow the stable format
//   Node '<node>' cannot scale down: <phrase> (<reason>)
// so the repro agent can match ledger hypotheses back to simulation reasons
// without any shared state. Returns { node, reason } or null.
function parseScaleDownHypothesis(statement) {
  if (typeof statement !== 'string') return null;
  const nodeMatch = statement.match(/^Node '([^']+)' cannot scale down:/);
  const reasonMatch = statement.match(/\(([a-z0-9-]+)\)\s*$/);
  if (!nodeMatch || !reasonMatch) return null;
  return { node: nodeMatch[1], reason: reasonMatch[1] };
}

function podsOn(cluster, spec, node) {
  const pods = Array.isArray(cluster?.pods) ? cluster.pods : spec.pods;
  return pods.filter((p) => p.node === node);
}

export function createRepro({ llm, tools } = {}) {
  return {
    id: AGENT_ID,
    name: AGENT_NAME,

    /**
     * run(ctx): ctx = { caseObj, repoRoot, params = {} }.
     * Returns { reproduced: boolean, fix? }.
     */
    async run(ctx) {
      const { caseObj, params = {} } = ctx;
      record(caseObj, AGENT_ID, 'reproduction.start', {
        category: caseObj?.triage?.category ?? 'unknown',
      });

      assertToolAllowed(AGENT_ID, 'lab');
      const lab = tools?.lab;
      if (
        !lab ||
        typeof lab.createCluster !== 'function' ||
        typeof lab.simulateScaleDown !== 'function' ||
        typeof lab.applyFix !== 'function' ||
        typeof lab.findScaleDownBlockers !== 'function'
      ) {
        record(caseObj, AGENT_ID, 'reproduction.skipped', { reason: 'lab tool unavailable' });
        return { reproduced: false };
      }

      const spec = normalizeSpec(params.simSpec ?? DEFAULT_SIM_SPEC);
      const cluster = lab.createCluster(spec);
      const before = lab.simulateScaleDown(cluster);
      record(caseObj, AGENT_ID, 'reproduction.simulated', {
        removable: [...(before.removable ?? [])],
        blocked: (before.blocked ?? []).map((b) => ({ node: b.node, reasons: [...(b.reasons ?? [])] })),
      });

      const blocked = Array.isArray(before.blocked) ? before.blocked : [];
      if (blocked.length === 0) {
        record(caseObj, AGENT_ID, 'reproduction.no-blockers', {
          note: 'simulation shows every node is removable; nothing to reproduce',
        });
        return { reproduced: false };
      }

      // Top blocker: first blocked node reported by the simulation.
      const targetNode = blocked[0].node;
      const actualReasons = new Set(blocked.flatMap((b) => (Array.isArray(b.reasons) ? b.reasons : [])));

      // Iteratively apply the matching lab fix for every fixable reason on the
      // top node until it becomes removable (or no fix is left to try).
      let current = cluster;
      const applied = []; // [{ kind, pod?, node, reason }]
      for (let step = 0; step < MAX_FIX_STEPS; step += 1) {
        const blockers = lab.findScaleDownBlockers(current);
        const entry = (Array.isArray(blockers) ? blockers : []).find((b) => b.node === targetNode);
        if (!entry) break;
        let chosen = null;
        for (const reason of Array.isArray(entry.reasons) ? entry.reasons : []) {
          const info = REASON_INFO[reason];
          if (!info || !info.fix) continue;
          const candidate = info
            .matchPods(podsOn(current, spec, targetNode))
            .find((p) => p && p.name && !applied.some((f) => f.kind === info.fix && f.pod === p.name));
          if (!candidate) continue;
          chosen = { kind: info.fix, pod: candidate.name, node: targetNode, reason };
          break;
        }
        if (!chosen) break;
        current = lab.applyFix(current, { kind: chosen.kind, pod: chosen.pod, node: chosen.node });
        applied.push(chosen);
        record(caseObj, AGENT_ID, 'reproduction.fix-applied', {
          kind: chosen.kind,
          pod: chosen.pod,
          node: chosen.node,
          reason: chosen.reason,
        });
      }

      const after = lab.simulateScaleDown(current);
      const removableNow = Array.isArray(after.removable) && after.removable.includes(targetNode);
      record(caseObj, AGENT_ID, 'reproduction.re-simulated', {
        node: targetNode,
        removableNow,
        fixesApplied: applied.length,
      });

      if (applied.length === 0) {
        record(caseObj, AGENT_ID, 'reproduction.no-fixable-blocker', { node: targetNode });
      }

      let evidence = null;
      if (removableNow && applied.length > 0) {
        const fixDescriptions = applied
          .map((f) => `'${f.kind}' on pod '${f.pod}'`)
          .join(' then ');
        evidence = addEvidence(caseObj, {
          type: 'reproduction',
          source: 'lab',
          ref: targetNode,
          summary:
            `Reproduced: node '${targetNode}' was blocked by ` +
            `${applied.map((f) => `'${f.reason}'`).join(', ')}; applying ${fixDescriptions} ` +
            `makes the node removable in a repeat scale-down simulation.`,
          agentId: AGENT_ID,
        });
        record(caseObj, AGENT_ID, 'evidence.added', { evidenceId: evidence.id, type: evidence.type });
      }

      // Flip hypothesis statuses (only hypotheses this agent actually tested):
      //  - the proven blocker(s) on the fixed node            -> confirmed
      //  - hypothesised causes the simulation never reported  -> rejected
      //  - real blockers this run did not fix stay open (they may need a
      //    follow-up fix), and non-scale-down hypotheses are left untouched.
      const fixedReasons = new Set(applied.map((f) => f.reason));
      const evidenceIds = evidence ? [evidence.id] : [];
      for (const hypothesis of Array.isArray(caseObj.hypotheses) ? caseObj.hypotheses : []) {
        if (hypothesis.status !== 'open') continue;
        const parsed = parseScaleDownHypothesis(hypothesis.statement);
        if (!parsed) continue;
        if (removableNow && parsed.node === targetNode && fixedReasons.has(parsed.reason)) {
          setHypothesisStatus(caseObj, hypothesis.id, 'confirmed', evidenceIds);
          record(caseObj, AGENT_ID, 'hypothesis.confirmed', { hypothesisId: hypothesis.id });
        } else if (!actualReasons.has(parsed.reason)) {
          setHypothesisStatus(caseObj, hypothesis.id, 'rejected', evidenceIds);
          record(caseObj, AGENT_ID, 'hypothesis.rejected', { hypothesisId: hypothesis.id });
        }
      }

      record(caseObj, AGENT_ID, 'reproduction.complete', {
        reproduced: removableNow && applied.length > 0,
        node: targetNode,
      });

      if (removableNow && applied.length > 0) {
        const first = applied[0];
        return { reproduced: true, fix: { kind: first.kind, pod: first.pod, node: first.node } };
      }
      return { reproduced: false };
    },
  };
}
