// Shared helpers for the chunk-16 end-to-end flows.
//
// Wires runCase() with ScriptedBrain fixtures loaded from test/e2e/fixtures/,
// mock adapters (MockCastaiTools / MockK8sClient), the REAL KbReader against
// the repo root (so KB fixtures like 'brain/notes/PutRolePolicy 403 Case.md'
// and '.kimchi/docs/token-rotation-e2e-status.md' are genuinely found), and a
// SimulatedSandbox registered with the scenario keys the specialists derive.
//
// NOTE on routing + the verification ladder (spec §4 "Capability routing
// table"): routeToAgents() maps issueCategory -> specialist subsets; the
// orchestrator additionally appends the verification ladder
// (sre-investigator, reproduction-engineer, qa-engineer) to EVERY plan before
// fan-out, so documentation/code evidence can always be paired with
// reproduction/test/telemetry evidence and 'fully_verified' (score 100) is
// reachable in any category. Case 1 (iam) exercises exactly that path.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runCase } from '../../src/index.js';
import { TRANSITIONS } from '../../src/core/orchestrator.js';
import { ScriptedBrain } from '../../src/brains/scripted-brain.js';
import { MockCastaiTools } from '../../src/adapters/castai/mock-castai-tools.js';
import { MockK8sClient } from '../../src/adapters/k8s/mock-k8s-client.js';
import { KbReader } from '../../src/adapters/kb/kb-reader.js';
import { SimulatedSandbox } from '../../src/adapters/sandbox/simulated-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');

/** Repo root for the real KbReader (KB jail). */
export const REPO_ROOT = '/Users/eramadan/castai';

/**
 * Superset of ledger evidence ids. ScriptedBrain consumers (sre hypothesis
 * votes, verifier claims) cite these; both filter against the ledger, so
 * unresolved ids are harmless and parallel fan-out ordering cannot break the
 * fixtures.
 */
export const ALL_EVIDENCE_IDS = Array.from({ length: 40 }, (_, i) => `E${i + 1}`);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read an email fixture (raw text with From:/Subject: headers). */
export function readEmail(name) {
  return readFile(path.join(FIXTURES_DIR, name), 'utf8');
}

/** Load a brain-script fixture into a fresh ScriptedBrain. */
export async function loadBrain(name) {
  const raw = await readFile(path.join(FIXTURES_DIR, name), 'utf8');
  return new ScriptedBrain(JSON.parse(raw));
}

/**
 * MockCastaiTools fixtures for the case cluster. get_cluster_nodes is
 * deliberately slow: the sre-investigator brain vote runs after its telemetry
 * calls, so the delay lets the other (fast, fs-bound) specialists finish
 * appending evidence first — making the confirmed hypothesis's evidenceIds
 * deterministic (same pattern as test/unit/orchestrator.test.js).
 */
export function makeCastaiFixtures(clusterId) {
  return {
    get_cluster_nodes: async () => {
      await delay(750);
      return { clusterId, nodes: [{ id: 'node-1', name: 'ip-10-0-0-1.eu-west-1', status: 'Ready' }] };
    },
    get_cluster_utilization: { clusterId, cpuCores: 16, memoryGb: 64, avgCpuPercent: 31 },
    get_workload_autoscaler_status: { clusterId, enabled: false },
    get_recent_optimization_actions: [],
    get_cluster_details: { id: clusterId, name: 'siemenstest-siemenstest-1', region: 'eu-west-1' },
  };
}

/**
 * SimulatedSandbox scenarios. The reproduction-engineer scenario key is the
 * triage issueCategory (buildSpecialistTask passes scenario = issueCategory);
 * qa-engineer consumes the four fixed qa-* scenario ids. A QA scenario counts
 * as `passed` when reproduced === false (the fix holds).
 */
export function makeSandboxScenarios(reproKey) {
  const qaPass = {
    reproduced: false,
    triggerConditions: [],
    before: 'fix applied',
    after: 'no failure observed',
    logs: ['qa scenario: fix holds'],
  };
  return {
    [reproKey]: {
      reproduced: true,
      triggerConditions: ['role policy lacks iam:PutRolePolicy'],
      before: '403 AccessDenied on iam:PutRolePolicy',
      after: 'onboarding completes',
      logs: ['sandbox: connect run -> 403 AccessDenied before fix', 'sandbox: onboarding completes after fix'],
    },
    'qa-unit': { ...qaPass },
    'qa-integration': { ...qaPass },
    'qa-e2e': { ...qaPass },
    'qa-regression': { ...qaPass },
  };
}

/** All-mock adapter set used by every e2e case (kb is real, read-only). */
export function makeAdapters({ clusterId, reproKey, sandboxScenarios }) {
  return {
    castai: new MockCastaiTools(makeCastaiFixtures(clusterId)),
    k8s: new MockK8sClient({
      get: (kind) => (kind === 'pods'
        ? [{ name: 'castai-agent', status: 'Running' }, { name: 'castai-cluster-controller', status: 'Running' }]
        : []),
    }),
    kb: new KbReader({ repoRoot: REPO_ROOT }),
    sandbox: new SimulatedSandbox(sandboxScenarios ?? makeSandboxScenarios(reproKey)),
  };
}

/**
 * Run one e2e case end-to-end.
 * @param {string} emailFile fixture file name under test/e2e/fixtures/
 * @param {string} brainFile brain-script fixture file name
 * @param {{clusterId: string|null, reproKey: string, outDir: string,
 *          sandboxScenarios?: object}} options (sandboxScenarios replaces the
 *          default scenario registry wholesale, e.g. for the thin
 *          confidence-gate case)
 */
export async function runE2eCase(emailFile, brainFile, { clusterId, reproKey, outDir, sandboxScenarios }) {
  return runCase(await readEmail(emailFile), {
    brain: await loadBrain(brainFile),
    adapters: makeAdapters({ clusterId, reproKey, sandboxScenarios }),
    outDir,
  });
}

/**
 * Orchestrator transition audit entries (the durable state-history record).
 * The orchestrator also audits non-transition actions (fan-out-settled,
 * specialist-failed) under the same agent name — keep only real transitions.
 */
const TRANSITION_EVENTS = new Set(
  Object.values(TRANSITIONS).flatMap((row) => Object.keys(row))
);
export function orchestratorEvents(ledger) {
  return ledger.auditLog
    .filter((a) => a.agent === 'orchestrator' && TRANSITION_EVENTS.has(a.action))
    .map((a) => a.action);
}
