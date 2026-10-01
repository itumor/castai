// QaEngineerAgent — investigation-side specialist (chunk 14a).
//
// Runs one SimulatedSandbox scenario per test level and records the outcome in
// ledger.tests (spec §5 chunk 14a):
//   unit        → scenario 'qa-unit'
//   integration → scenario 'qa-integration'
//   e2e         → scenario 'qa-e2e'
//   regression  → scenario 'qa-regression'
//
// A scenario outcome counts as `passed` when the attempted trigger does NOT
// reproduce the issue (result.reproduced === false — i.e. the fix holds) and
// `failed` otherwise. All four outcomes are written with a single
// setTests(ledger, ...) call. The e2e pass/fail additionally appends `test`
// evidence (source 'sandbox:qa-e2e') with the pass flag on toolRun.ok.
//
// Output: { tests: ledger.tests, ran: [{level, scenario, passed}] }

import { setTests } from '../core/ledger.js';
import { BaseAgent } from './base-agent.js';

const TEST_SCENARIOS = Object.freeze({
  unit: 'qa-unit',
  integration: 'qa-integration',
  e2e: 'qa-e2e',
  regression: 'qa-regression',
});

export class QaEngineerAgent extends BaseAgent {
  constructor(options = {}) {
    super({ ...options, key: 'qa-engineer' });
    this.rolePrompt =
      'You are the qa-engineer agent of the CAST AI support swarm. You validate fixes by ' +
      'running sandbox test scenarios at unit, integration, e2e and regression level.';
  }

  async _run(task, ctx) {
    const sandbox = ctx.adapters.sandbox;
    if (!sandbox) {
      // Nothing can run without the sandbox — leave every level not_run.
      return { tests: { ...ctx.ledger.tests }, ran: [] };
    }

    const ran = [];
    for (const [level, scenarioId] of Object.entries(TEST_SCENARIOS)) {
      const result = await sandbox.run(scenarioId);
      const passed = result.reproduced === false;
      ran.push({ level, scenario: scenarioId, passed });

      if (level === 'e2e') {
        ctx.addEvidence({
          type: 'test',
          source: `sandbox:${scenarioId}`,
          result: `e2e ${passed ? 'passed' : 'failed'}: ${result.before} -> ${result.after}`,
          reference: scenarioId,
          toolRun: { tool: 'sandbox.run', args: { id: scenarioId }, ok: passed },
        });
      }
    }

    const tests = { unit: 'not_run', integration: 'not_run', e2e: 'not_run', regression: 'not_run' };
    for (const r of ran) tests[r.level] = r.passed ? 'passed' : 'failed';
    setTests(ctx.ledger, tests);

    const failedLevels = ran.filter((r) => !r.passed).map((r) => r.level);
    ctx.audit('qa_complete', failedLevels.length === 0
      ? 'all 4 test levels passed'
      : `failed levels: ${failedLevels.join(', ')}`);

    return { tests: { ...ctx.ledger.tests }, ran };
  }
}
