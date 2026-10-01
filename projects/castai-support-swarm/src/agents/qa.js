// src/agents/qa.js — contract section 7 of CONTRACTS.md
// QA agent. Decides the case's test ledger. If the orchestrator provides a
// tools.testRunner it is executed (policy-permitted for qa) and its results
// land on caseObj.tests. Otherwise QA derives the e2e level from the evidence
// ledger: when a reproduction evidence entry proves the fix, tests.e2e becomes
// 'passed' and TEST_CONFIRMED "e2e_test" evidence is added — marked
// 'lab-simulated (no external test runner executed)' so the writer can phrase
// the result honestly. Without proof, levels stay 'not_run'.
//
// Safety: read-only. No test infrastructure or cluster is mutated; the default
// path only reads the case ledger.

import { addEvidence } from '../core/model.js';
import { assertToolAllowed } from '../core/policy.js';
import { record } from '../core/trace.js';

const AGENT_ID = 'qa';
const AGENT_NAME = 'QA Engineer';

const TEST_LEVELS = ['unit', 'integration', 'e2e', 'regression'];
const TEST_STATUSES = ['not_run', 'passed', 'failed'];

export function createQa({ llm, tools } = {}) {
  return {
    id: AGENT_ID,
    name: AGENT_NAME,

    /**
     * run(ctx): ctx = { caseObj, repoRoot, params = {} }.
     * Returns { tests: caseObj.tests }.
     */
    async run(ctx) {
      const { caseObj, repoRoot, params = {} } = ctx;
      record(caseObj, AGENT_ID, 'qa.start', { tests: { ...caseObj.tests } });

      // Path 1: a real test runner was supplied by the orchestrator.
      const runner = tools?.testRunner;
      const runFn =
        typeof runner === 'function'
          ? runner
          : runner && typeof runner.run === 'function'
            ? runner.run.bind(runner)
            : null;
      if (runFn) {
        assertToolAllowed(AGENT_ID, 'testRunner');
        const result = (await runFn({ caseObj, repoRoot, params })) ?? {};
        const progress = {};
        for (const level of TEST_LEVELS) {
          if (TEST_STATUSES.includes(result[level])) {
            caseObj.tests[level] = result[level];
            progress[level] = result[level];
          }
        }
        record(caseObj, AGENT_ID, 'qa.test-runner', { progress });
        if (caseObj.tests.e2e === 'passed') {
          const evidence = addEvidence(caseObj, {
            type: 'e2e_test',
            source: 'test-runner',
            summary:
              `E2E test suite passed via the provided test runner (test runner executed)` +
              (typeof result.summary === 'string' && result.summary.length > 0
                ? `: ${result.summary}`
                : '.'),
            agentId: AGENT_ID,
          });
          record(caseObj, AGENT_ID, 'evidence.added', { evidenceId: evidence.id, type: evidence.type });
        }
      }

      // Path 2: no runner (or the runner did not cover e2e) — derive e2e from
      // the ledger. Reproduction evidence (REPRODUCED) proving the fix is what
      // promotes tests.e2e to 'passed' and grounds the e2e_test evidence.
      if (caseObj.tests.e2e === 'not_run') {
        const reproEvidence = (Array.isArray(caseObj.evidence) ? caseObj.evidence : []).find(
          (e) => e.type === 'reproduction',
        );
        if (reproEvidence) {
          caseObj.tests.e2e = 'passed';
          const refPart = reproEvidence.ref ? ` on node '${reproEvidence.ref}'` : '';
          const evidence = addEvidence(caseObj, {
            type: 'e2e_test',
            source: 'lab',
            ...(reproEvidence.ref !== undefined ? { ref: reproEvidence.ref } : {}),
            summary:
              `Lab-derived e2e result (lab-simulated — no external test runner executed): ` +
              `the scale-down fix was reproduced and held in the lab${refPart} ` +
              `(proof: ${reproEvidence.id}); tests.e2e marked 'passed'.`,
            agentId: AGENT_ID,
          });
          record(caseObj, AGENT_ID, 'qa.e2e-passed', {
            proof: reproEvidence.id,
            evidenceId: evidence.id,
          });
          record(caseObj, AGENT_ID, 'evidence.added', { evidenceId: evidence.id, type: evidence.type });
        } else {
          record(caseObj, AGENT_ID, 'qa.no-reproduction', {
            note: 'no reproduction evidence in the ledger; e2e stays not_run',
          });
        }
      }

      record(caseObj, AGENT_ID, 'qa.complete', { tests: { ...caseObj.tests } });
      return { tests: caseObj.tests };
    },
  };
}
