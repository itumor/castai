// Shared helpers for the eval cases (chunk 18).
//
// Mirrors test/e2e/helpers.js (same mock adapter wiring, same ALL_EVIDENCE_IDS
// superset trick) but loads email/brain material from a case directory
// (evals/cases/<id>/{input.md, brain.json}) instead of test/e2e/fixtures/.
// The KbReader is the REAL one jailed to the repo root, so documentation
// evidence is genuinely grounded in .kimchi/docs/* KB files.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ScriptedBrain } from '../src/brains/scripted-brain.js';
import { MockCastaiTools } from '../src/adapters/castai/mock-castai-tools.js';
import { MockK8sClient } from '../src/adapters/k8s/mock-k8s-client.js';
import { KbReader } from '../src/adapters/kb/kb-reader.js';
import { SimulatedSandbox } from '../src/adapters/sandbox/simulated-sandbox.js';

/** Repo root for the real KbReader (KB jail). */
export const REPO_ROOT = '/Users/eramadan/castai';

/** Superset of ledger evidence ids — unresolved ids are harmless (see e2e helpers). */
export const ALL_EVIDENCE_IDS = Array.from({ length: 40 }, (_, i) => `E${i + 1}`);

/** Read a file inside a case directory. */
export function readCaseFile(caseDir, name) {
  return readFile(path.join(caseDir, name), 'utf8');
}

/** Load and parse a case's brain.json. */
export async function loadBrainScript(caseDir) {
  return JSON.parse(await readCaseFile(caseDir, 'brain.json'));
}

/** Build a ScriptedBrain from a script object. */
export function makeBrain(script) {
  return new ScriptedBrain(script);
}

/**
 * MockCastaiTools fixtures for the case cluster (same shape as the e2e
 * helper; get_cluster_nodes is deliberately slow so the sre hypothesis vote
 * runs after the other specialists appended their evidence).
 * `extra` merges additional read-only tool fixtures (e.g. get_cluster_savings).
 */
export function makeCastaiFixtures(clusterId, extra = {}) {
  return {
    get_cluster_nodes: async () => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      return { clusterId, nodes: [{ id: 'node-1', name: 'ip-10-0-0-1.eu-west-1', status: 'Ready' }] };
    },
    get_cluster_utilization: { clusterId, cpuCores: 16, memoryGb: 64, avgCpuPercent: 31 },
    get_workload_autoscaler_status: { clusterId, enabled: false },
    get_recent_optimization_actions: [],
    get_cluster_details: { id: clusterId, name: 'siemenstest-siemenstest-1', region: 'eu-west-1' },
    ...extra,
  };
}

/**
 * SimulatedSandbox scenarios. The reproduction-engineer scenario key is the
 * triage issueCategory; qa-engineer consumes the four fixed qa-* ids
 * (a QA scenario counts as passed when reproduced === false).
 * `reproScenario` replaces the reproduction scenario content per case.
 */
export function makeSandboxScenarios(reproKey, reproScenario) {
  const qaPass = {
    reproduced: false,
    triggerConditions: [],
    before: 'fix applied',
    after: 'no failure observed',
    logs: ['qa scenario: fix holds'],
  };
  return {
    [reproKey]: reproScenario ?? {
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

/** All-mock adapter set used by every eval case (kb is real, read-only). */
export function makeAdapters({ clusterId, reproKey, reproScenario, castaiFixtures }) {
  return {
    castai: new MockCastaiTools(makeCastaiFixtures(clusterId, castaiFixtures)),
    k8s: new MockK8sClient({
      get: (kind) => (kind === 'pods'
        ? [{ name: 'castai-agent', status: 'Running' }, { name: 'castai-cluster-controller', status: 'Running' }]
        : []),
    }),
    kb: new KbReader({ repoRoot: REPO_ROOT }),
    sandbox: new SimulatedSandbox(makeSandboxScenarios(reproKey, reproScenario)),
  };
}
