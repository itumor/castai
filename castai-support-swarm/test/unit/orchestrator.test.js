// Chunk 15 acceptance tests — orchestrator state machine, runCase API, CLI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { Orchestrator, InvalidTransitionError, TRANSITIONS } from '../../src/core/orchestrator.js';
import { runCase, runCaseFromFile, parseEmailText } from '../../src/index.js';
import { ScriptedBrain } from '../../src/brains/scripted-brain.js';
import { SupervisorAgent } from '../../src/agents/supervisor.js';
import { createLedger } from '../../src/core/ledger.js';
import { KbReader } from '../../src/adapters/kb/kb-reader.js';
import { SimulatedSandbox } from '../../src/adapters/sandbox/simulated-sandbox.js';
import { MockCastaiTools } from '../../src/adapters/castai/mock-castai-tools.js';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLUSTER_ID = '11111111-1111-4111-8111-111111111111';

const EMAIL_TEXT =
  'From: Samuel Rivera <samuel@acme.io>\n' +
  'Subject: Nodes stuck NotReady after scale-up\n\n' +
  'Hi,\n' +
  'After a scale-up our Kubernetes nodes stay NotReady and never join.\n' +
  `Cluster id: ${CLUSTER_ID}\n` +
  'Can you help?\n';

const TRIAGE_JSON = JSON.stringify({
  orgId: null,
  clusterId: CLUSTER_ID,
  provider: 'eks',
  castaiMode: 'full',
  components: ['castai-agent'],
  issueCategory: 'node_upscale',
  severity: 'P2',
  expected: 'nodes join the cluster',
  actual: 'nodes stay NotReady',
  missingInfo: [],
});

const DRAFT_BODY =
  'Hi Samuel, we checked your cluster and found the nodes were failing to join because ' +
  'the node IAM role lacks a required policy. We reproduced the failure in a sandbox and ' +
  'our tests pass after attaching the policy. Per the documentation, attach the managed ' +
  'policy to the role and the nodes will join.';

const KB_DOC =
  '# Node join failures\n\n' +
  'Nodes fail to join the cluster when the instance profile lacks the required IAM\n' +
  'policy. Attach the managed policy to the node role so the kubelet can register.\n';

/** ScriptedBrain script for the full happy path (issueCategory node_upscale). */
function happyPathScript() {
  return {
    steps: [
      { tag: 'seed-hypotheses', response: JSON.stringify(['The node instance profile lacks the IAM policy required to join the cluster']) },
      { tag: 'propose-solution', response: 'The nodes fail to join because the instance profile lacks the required IAM policy. Attaching the managed policy to the role lets the kubelet register. Cluster telemetry and the KB documentation confirm this.' },
      { tag: 'verifier:claims', response: JSON.stringify({ claims: [{ claim: 'Node join failure is caused by the missing IAM policy', evidenceIds: ['E1', 'E2', 'E3', 'E4', 'E5'] }] }) },
      { tag: 'support-writer:draft', response: JSON.stringify({ body: DRAFT_BODY }) },
      { tag: 'knowledge-agent:proposals', response: JSON.stringify({ proposals: [{ title: 'Node join IAM failure', text: 'Check the instance profile IAM policy when nodes stay NotReady.', targetPath: 'brain/notes/node-join-iam.md' }] }) },
      { tag: 'escalation-agent:steps', response: JSON.stringify({ suggestedNextSteps: ['Review CloudTrail for denied iam:PutRolePolicy calls'] }) },
      { match: 'Classify this support case', response: TRIAGE_JSON },
      { match: 'candidate claims', response: JSON.stringify({ claims: ['nodes fail to join the cluster'] }) },
      { match: 'Vote on each hypothesis', response: JSON.stringify({ votes: [{ id: 'H1', vote: 'confirmed', reason: 'telemetry shows registration failures', evidenceIds: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12'] }] }) },
      { match: 'Summarize the sandbox reproduction run', response: JSON.stringify({ summary: 'Reproduced the join failure in the sandbox' }) },
      { match: 'Review the proposed solution', response: JSON.stringify({ fit: 'ok', notes: 'Rollout is safe' }) },
    ],
  };
}

async function makeEnv({ kbDoc = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'swarm-chunk15-'));
  await mkdir(path.join(dir, 'kb'), { recursive: true });
  if (kbDoc) await writeFile(path.join(dir, 'kb', 'node-join.md'), KB_DOC, 'utf8');
  return dir;
}

function mockAdapters(dir, { sandbox } = {}) {
  return {
    kb: new KbReader({ roots: ['kb'], repoRoot: dir }),
    sandbox: sandbox ?? new SimulatedSandbox({}),
  };
}

/** MockCastaiTools fixture that delays the first sre tool call so the other
 *  specialists finish (and append evidence) before the sre brain vote runs. */
const slowCastaiFixtures = {
  get_cluster_nodes: async () => {
    await delay(250);
    return { nodes: [{ name: 'n1', status: 'NotReady' }] };
  },
};

// ---------------------------------------------------------------------------
// 1. Transition table: every legal transition succeeds, every illegal throws
// ---------------------------------------------------------------------------

const ALL_EVENTS = [...new Set(Object.values(TRANSITIONS).flatMap((row) => Object.keys(row)))];

describe('TRANSITIONS table', () => {
  function freshOrch(state) {
    const o = new Orchestrator({
      brain: { complete: async () => 'x' },
      adapters: {},
      maxLoops: 99, // high so the VERIFY_FAIL guard never fires in this test
      caseId: 'case-table',
    });
    o.state = state;
    o.case = { caseId: 'case-table', status: state, loopsUsed: 0, maxLoops: 99, lintRetries: 0 };
    o.ledger = createLedger('case-table', null);
    return o;
  }

  test('every legal transition succeeds and lands on the table target', async () => {
    for (const [from, row] of Object.entries(TRANSITIONS)) {
      for (const [event, expectedTo] of Object.entries(row)) {
        const o = freshOrch(from);
        const entry = await o._transition(event, 'table test');
        assert.equal(o.state, expectedTo, `${from} --${event}--> ${expectedTo}`);
        assert.equal(entry.from, from);
        assert.equal(entry.to, expectedTo);
        assert.equal(entry.event, event);
        assert.equal(typeof entry.at, 'string');
        assert.ok(!Number.isNaN(Date.parse(entry.at)));
        // VERIFY_FAIL/LINT_FAIL append the guard decision to the reason.
        assert.ok(entry.reason.startsWith('table test'));
      }
    }
  });

  test('every illegal event throws InvalidTransitionError naming state and event', async () => {
    for (const [from, row] of Object.entries(TRANSITIONS)) {
      for (const event of ALL_EVENTS) {
        if (row[event]) continue; // legal for this state
        const o = freshOrch(from);
        await assert.rejects(
          o._transition(event, 'illegal'),
          (err) => {
            assert.ok(err instanceof InvalidTransitionError);
            assert.ok(err.message.includes(`"${event}"`), `message names event: ${err.message}`);
            assert.ok(err.message.includes(`"${from}"`), `message names state: ${err.message}`);
            return true;
          }
        );
        assert.equal(o.state, from, 'state unchanged after illegal event');
      }
    }
  });

  test('transitions append to history and audit the ledger as orchestrator', async () => {
    const o = freshOrch('intake');
    await o._transition('TRIAGED', 'first');
    await o._transition('PLAN_READY', 'second');
    const { state, history } = o.getState();
    assert.equal(state, 'planning');
    assert.equal(history.length, 2);
    assert.deepEqual(
      history.map((h) => h.event),
      ['TRIAGED', 'PLAN_READY']
    );
    const audits = o.ledger.auditLog.filter((a) => a.agent === 'orchestrator');
    assert.equal(audits.length, 2);
    assert.equal(audits[0].action, 'TRIAGED');
    assert.equal(audits[1].action, 'PLAN_READY');
  });
});

// ---------------------------------------------------------------------------
// 2. VERIFY_FAIL loopsUsed guard: twice with maxLoops=2 ends escalated
// ---------------------------------------------------------------------------

describe('VERIFY_FAIL loops guard', () => {
  test('first FAIL re-plans, second FAIL escalates, third FAIL is illegal', async () => {
    const o = new Orchestrator({
      brain: { complete: async () => 'x' },
      adapters: {},
      maxLoops: 2,
      caseId: 'case-loops',
    });
    o.ledger = createLedger('case-loops', null);
    o.state = 'verifying';

    // First failure: loopsUsed=1 < 2 → planning.
    let entry = await o._transition('VERIFY_FAIL', 'claims unsupported');
    assert.equal(entry.event, 'VERIFY_FAIL');
    assert.equal(o.state, 'planning');
    assert.equal(o.case.loopsUsed, 1);
    assert.match(entry.reason, /loopsUsed=1 < maxLoops=2/);
    assert.match(entry.reason, /re-planning/);

    // Walk the table back to verifying (planning → investigating → verifying).
    await o._transition('PLAN_BUILT', 're-plan');
    await o._transition('INVESTIGATION_DONE', 're-investigated');

    // Second failure: loopsUsed=2, not < 2 → event becomes ESCALATE → escalated.
    entry = await o._transition('VERIFY_FAIL', 'claims unsupported again');
    assert.equal(entry.event, 'ESCALATE');
    assert.equal(o.state, 'escalated');
    assert.equal(o.case.loopsUsed, 2);
    assert.match(entry.reason, /loopsUsed=2 >= maxLoops=2/);
    assert.match(entry.reason, /escalating/);

    // Third failure path: from 'escalated' VERIFY_FAIL is now illegal.
    await assert.rejects(o._transition('VERIFY_FAIL', 'third'), InvalidTransitionError);
  });
});

// ---------------------------------------------------------------------------
// 3. LINT_FAIL retry counter: max 2 retries in writing, third forces ESCALATE
// ---------------------------------------------------------------------------

describe('LINT_FAIL retry counter', () => {
  test('two LINT_FAILs stay in writing, third becomes ESCALATE', async () => {
    const o = new Orchestrator({
      brain: { complete: async () => 'x' },
      adapters: {},
      caseId: 'case-lint',
    });
    o.ledger = createLedger('case-lint', null);
    o.state = 'writing';

    let entry = await o._transition('LINT_FAIL', 'cliché violation');
    assert.equal(entry.event, 'LINT_FAIL');
    assert.equal(o.state, 'writing');
    assert.equal(o.case.lintRetries, 1);

    entry = await o._transition('LINT_FAIL', 'cliché violation');
    assert.equal(entry.event, 'LINT_FAIL');
    assert.equal(o.state, 'writing');
    assert.equal(o.case.lintRetries, 2);

    entry = await o._transition('LINT_FAIL', 'cliché violation');
    assert.equal(entry.event, 'ESCALATE');
    assert.equal(o.state, 'escalated');
    assert.match(entry.reason, /lint retries exhausted/);
  });
});

// ---------------------------------------------------------------------------
// 4. Specialist failure tolerance: one ok:false does not block others
// ---------------------------------------------------------------------------

describe('investigating fan-out tolerance', () => {
  test('a throwing specialist is recorded ok:false while other evidence still lands', async () => {
    const dir = await makeEnv();
    try {
      const sandbox = new SimulatedSandbox({
        node_upscale: async () => {
          throw new Error('sandbox exploded');
        },
      });
      const { caseRecord, ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(happyPathScript()),
        adapters: { ...mockAdapters(dir), sandbox },
        outDir: path.join(dir, 'out'),
      });

      // reproduction-engineer failed, sre-investigator still added telemetry.
      assert.ok(
        ledger.evidence.some((e) => e.type === 'telemetry' && e.toolRun?.ok === true),
        'telemetry evidence present despite one specialist failing'
      );
      const failures = ledger.auditLog.filter((a) => a.agent === 'orchestrator' && a.action === 'specialist-failed');
      assert.ok(
        failures.some((f) => f.detail.includes('reproduction-engineer')),
        'failed specialist recorded: ' + JSON.stringify(failures)
      );
      const reproResult = caseRecord.investigation.results.find((r) => r.agent === 'reproduction-engineer');
      assert.equal(reproResult.ok, false);
      assert.match(reproResult.error, /sandbox exploded/);
      const sreResult = caseRecord.investigation.results.find((r) => r.agent === 'sre-investigator');
      assert.equal(sreResult.ok, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. Verification ladder: orchestrator appends the ladder to EVERY plan
// ---------------------------------------------------------------------------

// iam-category script: routed specialists are docs-researcher,
// cloud-security-engineer, product-engineer; the ladder must add
// sre-investigator, reproduction-engineer and qa-engineer on top.
function iamLadderScript() {
  return {
    steps: [
      { tag: 'seed-hypotheses', response: JSON.stringify(['The node instance profile lacks the IAM policy required to join the cluster']) },
      { tag: 'propose-solution', response: 'The nodes fail to join because the instance profile lacks the required IAM policy.' },
      { tag: 'verifier:claims', response: JSON.stringify({ claims: [{ claim: 'Node join failure is caused by the missing IAM policy', evidenceIds: ['E1', 'E2', 'E3', 'E4', 'E5'] }] }) },
      { tag: 'support-writer:draft', response: JSON.stringify({ body: DRAFT_BODY }) },
      { tag: 'knowledge-agent:proposals', response: JSON.stringify({ proposals: [] }) },
      { match: 'Classify this support case', response: TRIAGE_JSON.replace('"issueCategory":"node_upscale"', '"issueCategory":"iam"') },
      { match: 'candidate claims', response: JSON.stringify({ claims: ['the instance profile lacks the required IAM policy'] }) },
      { match: 'Analyze the reported permission issue', response: JSON.stringify({ analysis: 'missing IAM policy', requiredPermissions: ['iam:PutRolePolicy'], fixStatement: 'attach the managed policy', confirmed: false }) },
      { match: 'Answer each implementation question', response: JSON.stringify({ answers: [] }) },
      { match: 'Vote on each hypothesis', response: JSON.stringify({ votes: [{ id: 'H1', vote: 'confirmed', reason: 'telemetry shows registration failures' }] }) },
      { match: 'Summarize the sandbox reproduction run', response: JSON.stringify({ summary: 'Could not reproduce' }) },
    ],
  };
}

describe('verification ladder', () => {
  test('iam plan executes the routed specialists PLUS sre-investigator, reproduction-engineer and qa-engineer', async () => {
    const dir = await makeEnv();
    try {
      const { caseRecord, ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(iamLadderScript()),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });

      // plan.agentSubset: routed iam specialists + the deduplicated ladder.
      assert.deepEqual(caseRecord.plan.agentSubset, [
        'docs-researcher', 'cloud-security-engineer', 'product-engineer',
        'sre-investigator', 'reproduction-engineer', 'qa-engineer',
      ]);

      // All six were executed (audit 'execute' entries).
      const executed = ledger.auditLog.filter((a) => a.action === 'execute').map((a) => a.agent);
      for (const key of caseRecord.plan.agentSubset) {
        assert.ok(executed.includes(key), `expected executed agent: ${key}`);
      }

      // Ladder append is audited by the orchestrator.
      const ladderAudit = ledger.auditLog.find(
        (a) => a.agent === 'orchestrator' && a.action === 'verification-ladder'
      );
      assert.ok(ladderAudit, 'verification-ladder audit entry present');
      assert.match(ladderAudit.detail, /sre-investigator,reproduction-engineer,qa-engineer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a node_upscale plan already contains the ladder — no duplicates appended', async () => {
    const dir = await makeEnv();
    try {
      const { caseRecord, ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(happyPathScript()),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });
      const subset = caseRecord.plan.agentSubset;
      assert.equal(new Set(subset).size, subset.length, 'agentSubset has no duplicates');
      for (const key of ['sre-investigator', 'reproduction-engineer', 'qa-engineer']) {
        assert.ok(subset.includes(key));
      }
      const ladderAudit = ledger.auditLog.find(
        (a) => a.agent === 'orchestrator' && a.action === 'verification-ladder'
      );
      assert.match(ladderAudit.detail, /ladder already present/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4c. Failure-path escalation: triage/planning brain failures escalate with an
// escalation package instead of crashing runCase with an InvalidTransitionError
// ---------------------------------------------------------------------------

describe('failure-path escalation', () => {
  test('triage brain failure -> escalated with an escalation package, not a throw', async () => {
    const dir = await makeEnv({ kbDoc: false });
    try {
      // No 'Classify this support case' rule -> the triage brain call throws.
      const { caseRecord, ledger, artifacts } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain({
          steps: [
            { tag: 'escalation-agent:steps', response: JSON.stringify({ suggestedNextSteps: ['Re-run triage manually'] }) },
          ],
        }),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.equal(caseRecord.escalationReason, 'triage-failed');
      assert.ok(caseRecord.escalation, 'escalation package built after triage failure');
      assert.ok(
        ledger.auditLog.some((a) => a.agent === 'orchestrator' && a.action === 'ESCALATE' && /triage failed/.test(a.detail)),
        'ESCALATE from triage audited'
      );
      const escalation = JSON.parse(
        await readFile(path.join(artifacts.dir, 'escalation.json'), 'utf8')
      );
      assert.ok(escalation, 'escalation.json artifact written');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('supervisor (planning) failure -> escalated with an escalation package, not a throw', async () => {
    const dir = await makeEnv({ kbDoc: false });
    // The supervisor is deterministic (no brain call), so simulate a planning
    // failure (brain outage) by making _run throw; BaseAgent.execute converts
    // it to ok:false, exactly like a brain failure in the planning state.
    const originalRun = SupervisorAgent.prototype._run;
    SupervisorAgent.prototype._run = async () => {
      throw new Error('supervisor brain outage');
    };
    try {
      const { caseRecord, ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain({
          steps: [
            { match: 'Classify this support case', response: TRIAGE_JSON },
            { tag: 'escalation-agent:steps', response: JSON.stringify({ suggestedNextSteps: ['Retry planning with a fixed brain'] }) },
          ],
        }),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.equal(caseRecord.escalationReason, 'planning-failed');
      assert.ok(caseRecord.escalation, 'escalation package built after planning failure');
      assert.ok(
        ledger.auditLog.some((a) => a.agent === 'orchestrator' && a.action === 'ESCALATE' && /supervisor failed/.test(a.detail)),
        'ESCALATE from planning audited'
      );
    } finally {
      SupervisorAgent.prototype._run = originalRun;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. runCase happy path: all mocks complete, trio written to <outDir>/<caseId>
// ---------------------------------------------------------------------------

describe('runCase happy path', () => {
  test('completes with draft, confidence 75 and the artifact trio', async () => {
    const dir = await makeEnv();
    try {
      const { caseRecord, ledger, verdict, draftPost, artifacts } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(happyPathScript()),
        adapters: {
          ...mockAdapters(dir, {
            sandbox: new SimulatedSandbox({
              node_upscale: {
                reproduced: true,
                triggerConditions: ['role without policy'],
                before: 'nodes NotReady',
                after: 'nodes Ready',
                logs: [],
              },
            }),
          }),
          castai: new MockCastaiTools(slowCastaiFixtures),
        },
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.equal(caseRecord.source, 'email');
      assert.equal(caseRecord.triage.issueCategory, 'node_upscale');
      assert.equal(caseRecord.loopsUsed, 0);
      assert.ok(Array.isArray(caseRecord.knowledgeProposals));

      assert.equal(verdict.pass, true);
      assert.equal(ledger.confidence, 75); // docs 20 + reproduction 25 + e2e 20 + telemetry 10
      assert.equal(ledger.solution.status, 'proposed');
      assert.equal(draftPost.route, 'answer_with_uncertainty');
      assert.match(draftPost.body, /Samuel/);

      // Artifact trio in <outDir>/<caseId>/.
      const caseDir = artifacts.dir;
      const draft = await readFile(path.join(caseDir, 'draft.md'), 'utf8');
      assert.equal(draft, draftPost.body);
      const storedLedger = JSON.parse(await readFile(path.join(caseDir, 'ledger.json'), 'utf8'));
      assert.equal(storedLedger.caseId, ledger.caseId);
      const storedVerdict = JSON.parse(await readFile(path.join(caseDir, 'verdict.json'), 'utf8'));
      assert.equal(storedVerdict.pass, true);
      await assert.rejects(readFile(path.join(caseDir, 'escalation.json'), 'utf8'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Confidence gate: verifier passes but score < 60 → escalated, no draft
// ---------------------------------------------------------------------------

// Low-confidence scenario: node_upscale route, but NO KB doc (no documentation
// evidence) and no reproduction (default sandbox → reproduced:false). Only the
// sre telemetry (10) + passed e2e tests (20) support the confirmed hypothesis
// → score 30 < 60 → the confidence gate escalates after a passing verdict.
function lowConfidenceScript() {
  return {
    steps: [
      { tag: 'seed-hypotheses', response: JSON.stringify(['The nodes stay NotReady because of a cluster-side networking problem']) },
      { tag: 'propose-solution', response: 'The nodes fail to register with the control plane. The cluster telemetry shows the join requests timing out.' },
      { tag: 'verifier:claims', response: JSON.stringify({ claims: [{ claim: 'The nodes fail to register with the control plane', evidenceIds: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'] }] }) },
      { tag: 'escalation-agent:steps', response: JSON.stringify({ suggestedNextSteps: ['Collect kubelet logs from a NotReady node'] }) },
      {
        match: 'Classify this support case',
        response: JSON.stringify({
          orgId: null,
          clusterId: CLUSTER_ID,
          provider: 'eks',
          castaiMode: 'full',
          components: [],
          issueCategory: 'node_upscale',
          severity: 'P3',
          expected: 'nodes join the cluster',
          actual: 'nodes stay NotReady',
          missingInfo: ['Which node group was scaled up?'],
        }),
      },
      { match: 'candidate claims', response: JSON.stringify({ claims: ['nodes fail to join the cluster'] }) },
      { match: 'Vote on each hypothesis', response: JSON.stringify({ votes: [{ id: 'H1', vote: 'confirmed', reason: 'telemetry shows registration timeouts' }] }) },
      { match: 'Summarize the sandbox reproduction run', response: JSON.stringify({ summary: 'Could not reproduce' }) },
      { match: 'Review the proposed solution', response: JSON.stringify({ fit: 'ok', notes: 'Needs more evidence' }) },
    ],
  };
}

describe('confidence gate', () => {
  test('verifier PASS with score < 60 escalates, folds open questions, writes no draft', async () => {
    const dir = await makeEnv({ kbDoc: false }); // no documentation evidence
    try {
      const { caseRecord, ledger, verdict, draftPost, artifacts } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(lowConfidenceScript()),
        adapters: mockAdapters(dir), // default sandbox: reproduction never reproduces
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.equal(verdict.pass, true, 'verifier itself passed');
      assert.equal(ledger.confidence, 30, 'only telemetry (10) + passed e2e (20) support the confirmed hypothesis');
      assert.equal(ledger.solution.status, 'escalated');
      assert.equal(draftPost, null, 'no draft when the confidence gate escalates');
      assert.equal(caseRecord.draftPost, null);

      // escalation package carries the plan's missingInfoQuestions
      assert.ok(caseRecord.escalation, 'escalation package built');
      assert.ok(
        caseRecord.escalation.openQuestions.includes('Which node group was scaled up?'),
        'missingInfoQuestions folded into the escalation package'
      );

      // Artifacts: ledger + verdict + escalation, but NO draft.md.
      const caseDir = artifacts.dir;
      await readFile(path.join(caseDir, 'ledger.json'), 'utf8');
      await readFile(path.join(caseDir, 'verdict.json'), 'utf8');
      const escalation = JSON.parse(await readFile(path.join(caseDir, 'escalation.json'), 'utf8'));
      assert.ok(escalation.openQuestions.includes('Which node group was scaled up?'));
      await assert.rejects(readFile(path.join(caseDir, 'draft.md'), 'utf8'), /ENOENT/);

      const escalateEvents = ledger.auditLog.filter((a) => a.agent === 'orchestrator' && a.action === 'ESCALATE');
      assert.ok(escalateEvents.some((e) => /low-confidence/.test(e.detail)));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6b. Escalated case must always produce escalation.json — even when the
// escalation agent itself fails (ok:false, e.g. brain error).
// ---------------------------------------------------------------------------

describe('escalation.json artifact guarantee', () => {
  test('escalation agent ok:true -> escalation.json carries the agent package', async () => {
    const dir = await makeEnv({ kbDoc: false });
    try {
      // No triage rule -> triage fails -> escalated; the escalation agent
      // itself succeeds and its package is what gets written.
      const { caseRecord, artifacts } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain({
          steps: [
            { tag: 'escalation-agent:steps', response: JSON.stringify({ suggestedNextSteps: ['Re-run triage manually'] }) },
          ],
        }),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.ok(caseRecord.escalation, 'agent package stored on the case record');
      const pkg = JSON.parse(await readFile(path.join(artifacts.dir, 'escalation.json'), 'utf8'));
      assert.equal(pkg.suggestedNextSteps[0], 'Re-run triage manually');
      assert.equal(pkg.note, undefined, 'agent package written, not the minimal fallback');
      assert.equal(pkg.agentError, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('escalation agent ok:false -> escalation.json still written with reason + redacted agentError + note', async () => {
    const dir = await makeEnv({ kbDoc: false });
    try {
      // No triage rule -> triage fails -> 'triage-failed' escalation. The
      // escalation brain step returns non-JSON embedding a secret, so
      // _brainNextSteps throws with the secret inside the error string.
      const { caseRecord, ledger, artifacts } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain({
          steps: [
            { tag: 'escalation-agent:steps', response: 'brain outage while holding castai_v1_SKSECRET123 credentials' },
          ],
        }),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });

      assert.equal(caseRecord.status, 'done');
      assert.equal(caseRecord.escalation, null, 'agent produced no package');
      assert.equal(caseRecord.escalationReason, 'triage-failed');
      assert.match(caseRecord.escalationError, /brain outage/);

      const raw = await readFile(path.join(artifacts.dir, 'escalation.json'), 'utf8');
      const pkg = JSON.parse(raw);
      assert.equal(pkg.note, 'escalation agent failed; minimal package generated by runCase');
      assert.equal(pkg.reason, 'triage-failed');
      assert.match(pkg.agentError, /brain outage/, 'agent error string preserved');
      assert.match(pkg.agentError, /castai_v1_\[REDACTED\]/, 'token masked in agentError');
      assert.ok(!raw.includes('SKSECRET123'), 'no plaintext secret anywhere in escalation.json');
      assert.equal(pkg.solutionSummary, ledger.solution.summary);
      assert.ok(Array.isArray(pkg.openQuestions));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Score derivation sanity for the fixtures used above
// ---------------------------------------------------------------------------

describe('orchestrator ledger wiring', () => {
  test('triage facts are mirrored onto the ledger for the confidence scorer', async () => {
    const dir = await makeEnv({ kbDoc: false });
    try {
      const { ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(lowConfidenceScript()),
        adapters: mockAdapters(dir),
        outDir: path.join(dir, 'out'),
      });
      assert.equal(ledger.provider, 'eks');
      assert.equal(ledger.triage.clusterId, CLUSTER_ID);
      assert.equal(ledger.customerFirstName, 'Samuel');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('seed-hypotheses tolerates a non-array brain response with a fallback hypothesis', async () => {
    const dir = await makeEnv({ kbDoc: false });
    try {
      const script = lowConfidenceScript();
      script.steps.find((s) => s.tag === 'seed-hypotheses').response = 'not json at all';
      const { ledger } = await runCase(EMAIL_TEXT, {
        brain: new ScriptedBrain(script),
        adapters: mockAdapters(dir),
        maxLoops: 1, // single investigation round
        outDir: path.join(dir, 'out'),
      });
      assert.deepEqual(ledger.hypotheses.map((h) => h.statement), ['pending investigation']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. runCaseFromFile + raw email string parsing
// ---------------------------------------------------------------------------

describe('runCaseFromFile and email parsing', () => {
  test('parses From:/Subject: headers and runs the case from a file', async () => {
    const dir = await makeEnv();
    try {
      const emailPath = path.join(dir, 'email.txt');
      await writeFile(emailPath, EMAIL_TEXT, 'utf8');
      const { caseRecord, draftPost } = await runCaseFromFile(emailPath, {
        brain: new ScriptedBrain(happyPathScript()),
        adapters: {
          ...mockAdapters(dir, {
            sandbox: new SimulatedSandbox({
              node_upscale: {
                reproduced: true,
                triggerConditions: [],
                before: 'nodes NotReady',
                after: 'nodes Ready',
                logs: [],
              },
            }),
          }),
          castai: new MockCastaiTools(slowCastaiFixtures),
        },
        outDir: path.join(dir, 'out'),
      });
      assert.equal(caseRecord.email.from, 'Samuel Rivera <samuel@acme.io>');
      assert.equal(caseRecord.email.fromName, 'Samuel Rivera');
      assert.equal(caseRecord.email.fromFirstName, 'Samuel');
      assert.equal(caseRecord.email.subject, 'Nodes stuck NotReady after scale-up');
      assert.match(caseRecord.email.body, /never join/);
      assert.deepEqual(caseRecord.email.thread, []);
      assert.equal(draftPost.to, 'Samuel Rivera <samuel@acme.io>');
      assert.equal(draftPost.subject, 'Re: Nodes stuck NotReady after scale-up');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('parseEmailText handles bare-address From and missing headers', () => {
    const parsed = parseEmailText('Subject: help\n\nplease help');
    assert.equal(parsed.from, 'unknown@unknown');
    assert.equal(parsed.fromFirstName, '');
    assert.equal(parsed.subject, 'help');
    assert.equal(parsed.body, 'please help');

    const bare = parseEmailText('From: bob@example.com\nSubject: s\n\nb');
    assert.equal(bare.fromName, '');
    assert.equal(bare.fromFirstName, '');
    assert.equal(bare.from, 'bob@example.com');
  });
});

// ---------------------------------------------------------------------------
// 9. CLI smoke test
// ---------------------------------------------------------------------------

describe('cli', () => {
  test('case --email runs to completion and prints transitions (exit 0)', async () => {
    const dir = await makeEnv();
    try {
      const emailPath = path.join(dir, 'email.txt');
      const scriptPath = path.join(dir, 'brain.json');
      await writeFile(emailPath, EMAIL_TEXT, 'utf8');
      await writeFile(scriptPath, JSON.stringify(happyPathScript()), 'utf8');

      const { stdout, stderr } = await execFileP(
        process.execPath,
        [
          path.join(HERE, '..', '..', 'src', 'cli.js'),
          'case',
          '--email', emailPath,
          '--script', scriptPath,
          '--outdir', path.join(dir, 'out'),
        ],
        { cwd: dir, timeout: 30000 }
      );
      assert.equal(stderr, '');
      assert.match(stdout, /TRIAGED/);
      assert.match(stdout, /verdict: (PASS|FAIL)/);
      assert.match(stdout, /confidence: \d+/);
      assert.match(stdout, /artifacts:/);
      assert.match(stdout, /draft\.md|ledger\.json/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('missing --email exits 2', async () => {
    await assert.rejects(
      execFileP(process.execPath, [path.join(HERE, '..', '..', 'src', 'cli.js'), 'case'], { timeout: 15000 }),
      (err) => {
        assert.equal(err.code, 2);
        assert.match(err.stderr, /--email/);
        return true;
      }
    );
  });
});
