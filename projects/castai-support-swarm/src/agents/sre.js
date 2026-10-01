// src/agents/sre.js — contract section 7 of CONTRACTS.md
// SRE investigation agent. Runs a category-driven checklist against the
// deterministic lab simulation cluster (built from ctx.params.simSpec, which
// the orchestrator supplies). Emits ENV_CONFIRMED "environment" evidence with
// concrete node/pod names and opens hypotheses for the blockers it finds.
//
// Safety: read-only. The lab is a local simulation — no real cluster, API or
// kubectl is touched here.

import { addEvidence, addHypothesis } from '../core/model.js';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

const AGENT_ID = 'sre';
const AGENT_NAME = 'SRE Investigator';

// Trivial healthy lab cluster used when the orchestrator supplies no simSpec:
// one CAST AI-managed node, no pods — nothing can block scale-down.
const DEFAULT_SIM_SPEC = { nodes: [{ name: 'node-1' }], pods: [] };

// Category-driven checklists (categories come from src/agents/registry.js
// ISSUE_CATEGORIES). Only scale-related categories run the blocker checklist;
// everything else gets an honest environment inventory.
const CHECKLISTS = {
  node_downscale: ['environment-inventory', 'scale-down-blockers'],
  node_upscale: ['environment-inventory'],
};
const DEFAULT_CHECKLIST = ['environment-inventory'];

// Stable blocker reason strings emitted by tools.lab.findScaleDownBlockers
// (contract section 6). `phrase` feeds hypothesis/evidence wording and
// `matchPods` identifies the concrete offending pods so evidence can name
// them. Unknown future reasons are still reported, just without pod detail.
const REASON_INFO = {
  'pdb-blocks-eviction': {
    phrase: 'a PodDisruptionBudget blocks pod eviction',
    matchPods: (pods) => pods.filter((p) => p.pdbProtected),
  },
  'pod-has-local-storage': {
    phrase: 'the pod uses local storage that cannot move with it',
    matchPods: (pods) => pods.filter((p) => p.localStorage),
  },
  'pod-not-managed-by-controller': {
    phrase: 'the pod is not managed by a controller, so the autoscaler will not evict it',
    matchPods: (pods) => pods.filter((p) => p.managed === false),
  },
  'pod-cannot-move': {
    phrase: 'the pod cannot be rescheduled to another node',
    matchPods: (pods) => pods.filter((p) => p.canMove === false),
  },
  'node-marked-do-not-evict': {
    phrase: 'the node is marked do-not-evict (safe-to-evict: false)',
    matchPods: () => [],
  },
  'node-not-castai-managed': {
    phrase: 'the node is not managed by CAST AI, so the autoscaler will not remove it',
    matchPods: () => [],
  },
};

// Applies the documented lab defaults (contract section 6) so pod/node lookups
// are deterministic regardless of which fields the orchestrator omitted.
function normalizeSpec(spec) {
  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
  const pods = Array.isArray(spec?.pods) ? spec.pods : [];
  return {
    nodes: nodes.map((n) => ({ managed: true, doNotEvict: false, ...n })),
    pods: pods.map((p) => ({ pdbProtected: false, localStorage: false, managed: true, canMove: true, ...p })),
  };
}

function quoted(names) {
  return names.map((n) => `'${n}'`).join(', ');
}

export function createSre({ llm, tools } = {}) {
  return {
    id: AGENT_ID,
    name: AGENT_NAME,

    /**
     * run(ctx): ctx = { caseObj, repoRoot, params = {} }.
     * Returns { hypothesesAdded, evidenceAdded }.
     */
    async run(ctx) {
      const { caseObj, params = {} } = ctx;
      const category = caseObj?.triage?.category ?? 'unknown';
      const checklist = CHECKLISTS[category] ?? DEFAULT_CHECKLIST;
      record(caseObj, AGENT_ID, 'investigation.start', { category, checklist });

      let hypothesesAdded = 0;
      let evidenceAdded = 0;

      // The 'lab' tool is the only one this checklist needs (policy: sre may
      // also use kube/castai, but the offline investigation is lab-driven).
      assertToolAllowed(AGENT_ID, 'lab');
      const lab = tools?.lab;
      if (!lab || typeof lab.createCluster !== 'function' || typeof lab.findScaleDownBlockers !== 'function') {
        record(caseObj, AGENT_ID, 'investigation.skipped', { reason: 'lab tool unavailable' });
        record(caseObj, AGENT_ID, 'investigation.complete', { hypothesesAdded, evidenceAdded });
        return { hypothesesAdded, evidenceAdded };
      }

      const spec = normalizeSpec(params.simSpec ?? DEFAULT_SIM_SPEC);
      const cluster = lab.createCluster(spec);
      const nodeNames = spec.nodes.map((n) => n.name);
      const podNames = spec.pods.map((p) => p.name);

      for (const step of checklist) {
        if (step === 'environment-inventory') {
          const managed = spec.nodes.filter((n) => n.managed !== false).length;
          const summary =
            `Lab environment: ${spec.nodes.length} node(s) [${quoted(nodeNames)}] ` +
            `(${managed}/${spec.nodes.length} CAST AI-managed), ` +
            `${spec.pods.length} pod(s)` +
            (podNames.length > 0 ? ` [${quoted(podNames)}]` : '') +
            '.';
          const evidence = addEvidence(caseObj, {
            type: 'environment',
            source: 'lab',
            summary,
            agentId: AGENT_ID,
          });
          evidenceAdded += 1;
          record(caseObj, AGENT_ID, 'checklist.environment-inventory', {
            nodes: nodeNames,
            pods: podNames,
            evidenceId: evidence.id,
          });
        }

        if (step === 'scale-down-blockers') {
          const blockers = lab.findScaleDownBlockers(cluster);
          record(caseObj, AGENT_ID, 'checklist.scale-down-blockers', {
            blockedNodes: blockers.map((b) => b.node),
          });

          if (!Array.isArray(blockers) || blockers.length === 0) {
            const evidence = addEvidence(caseObj, {
              type: 'environment',
              source: 'lab',
              summary:
                `Scale-down check: no blockers found; all ${spec.nodes.length} node(s) ` +
                `[${quoted(nodeNames)}] can be removed.`,
              agentId: AGENT_ID,
            });
            evidenceAdded += 1;
            record(caseObj, AGENT_ID, 'evidence.added', { evidenceId: evidence.id, type: evidence.type });
            continue;
          }

          for (const { node, reasons } of blockers) {
            const podsOnNode = spec.pods.filter((p) => p.node === node);
            for (const reason of Array.isArray(reasons) ? reasons : []) {
              const info = REASON_INFO[reason];
              const phrase = info ? info.phrase : `blocker '${reason}' was reported`;
              const suspects = info ? info.matchPods(podsOnNode).map((p) => p.name) : [];
              const podPart = suspects.length > 0 ? ` — pod(s): ${quoted(suspects)}` : '';

              const evidence = addEvidence(caseObj, {
                type: 'environment',
                source: 'lab',
                ref: node,
                summary: `Node '${node}' is blocked from scaling down: ${phrase}${podPart} (blocker '${reason}').`,
                agentId: AGENT_ID,
              });
              evidenceAdded += 1;
              record(caseObj, AGENT_ID, 'evidence.added', {
                evidenceId: evidence.id,
                type: evidence.type,
                node,
                reason,
              });

              const hypothesis = addHypothesis(caseObj, {
                statement: `Node '${node}' cannot scale down: ${phrase}${podPart} (${reason})`,
                evidenceIds: [evidence.id],
              });
              hypothesesAdded += 1;
              record(caseObj, AGENT_ID, 'hypothesis.opened', {
                hypothesisId: hypothesis.id,
                node,
                reason,
              });
            }
          }
        }
      }

      record(caseObj, AGENT_ID, 'investigation.complete', { hypothesesAdded, evidenceAdded });
      return { hypothesesAdded, evidenceAdded };
    },
  };
}
