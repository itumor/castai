// Public API for castai-support-swarm (chunk 15).
//
// runCase() wires the brain factory → adapters (mock defaults) → DraftSink
// (FileDraftSink default), runs the Orchestrator state machine and persists
// the artifacts to <outDir>/<caseId>/:
//   - ledger.json + verdict.json: ALWAYS written directly (even without a
//     draft, and even when a custom draftSink is supplied).
//   - draft.md: written via the DraftSink when a draft was produced; the
//     draftPost handed to save() carries {ledger, verdict} so FileDraftSink
//     writes the full trio.
//   - escalation.json: written directly when the case escalated. If the case
//     ended escalated but the escalation agent itself failed, a minimal
//     package (reason, openQuestions, solution summary, redacted agent error)
//     is generated here so an escalated case never lacks its primary artifact.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createBrain } from './brains/brain.js';
import { ScriptedBrain } from './brains/scripted-brain.js';
import { Orchestrator } from './core/orchestrator.js';
import { MockCastaiTools } from './adapters/castai/mock-castai-tools.js';
import { MockK8sClient } from './adapters/k8s/mock-k8s-client.js';
import { KbReader } from './adapters/kb/kb-reader.js';
import { SimulatedSandbox } from './adapters/sandbox/simulated-sandbox.js';
import { FileDraftSink } from './adapters/gmail/file-draft-sink.js';

export { Orchestrator, InvalidTransitionError, TRANSITIONS } from './core/orchestrator.js';
export { ScriptedBrain };

/**
 * Normalize a raw email string into an EmailInput: "From:"/"Subject:" header
 * lines are extracted, the remainder is the body.
 * @param {string} raw
 * @returns {import('./core/types.js').EmailInput}
 */
export function parseEmailText(raw) {
  const from = raw.match(/^From:\s*(.+)$/im)?.[1]?.trim() ?? 'unknown@unknown';
  const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() ?? '(no subject)';
  const body = raw.replace(/^From:.*$/im, '').replace(/^Subject:.*$/im, '').trim();
  let fromName = '';
  const angled = from.match(/^"?(.+?)"?\s*<[^>]+>$/);
  if (angled) fromName = angled[1].trim();
  const fromFirstName = fromName ? (fromName.split(/\s+/)[0] ?? '') : '';
  return { from, fromName, fromFirstName, subject, body, thread: [] };
}

function defaultAdapters(overrides) {
  return {
    castai: new MockCastaiTools({}),
    k8s: new MockK8sClient({}),
    kb: new KbReader({}),
    sandbox: new SimulatedSandbox({}),
    ...(overrides ?? {}),
  };
}

/**
 * Run one support case end-to-end.
 *
 * @param {import('./core/types.js').EmailInput|string} emailInput EmailInput
 *   object, or a raw email string (From:/Subject: headers + body).
 * @param {{brain?: object, adapters?: object, maxLoops?: number,
 *          draftSink?: object, outDir?: string}} [options]
 * @returns {Promise<{caseRecord: object, ledger: object, verdict: object|null,
 *                     draftPost: object|null, artifacts: {dir: string, files: string[]}}>}
 */
export async function runCase(emailInput, {
  brain,
  adapters,
  maxLoops = 2,
  draftSink,
  outDir = 'out',
} = {}) {
  const resolvedBrain = brain ?? (await createBrain(process.env));
  const resolvedAdapters = defaultAdapters(adapters);
  const sink = draftSink ?? new FileDraftSink({ outDir });
  const caseId = randomUUID();

  const orchestrator = new Orchestrator({
    brain: resolvedBrain,
    adapters: resolvedAdapters,
    maxLoops,
    caseId,
  });
  const { caseRecord, ledger, verdict, draftPost } = await orchestrator.run(emailInput);

  // Persist artifacts — always <outDir>/<caseId>/.
  const caseDir = path.join(outDir, caseId);
  await mkdir(caseDir, { recursive: true });
  const files = [];
  await writeFile(path.join(caseDir, 'ledger.json'), JSON.stringify(ledger, null, 2), 'utf8');
  files.push(path.join(caseDir, 'ledger.json'));
  await writeFile(path.join(caseDir, 'verdict.json'), JSON.stringify(verdict ?? null, null, 2), 'utf8');
  files.push(path.join(caseDir, 'verdict.json'));

  if (caseRecord.escalation) {
    const escalationPath = path.join(caseDir, 'escalation.json');
    await writeFile(escalationPath, JSON.stringify(caseRecord.escalation, null, 2), 'utf8');
    files.push(escalationPath);
  } else if (caseRecord.escalationError) {
    // The case reached done via `escalated` but the escalation agent failed
    // (e.g. brain error): write a minimal package so the escalated case still
    // has its primary artifact. escalationError was recorded redacted.
    const openQuestions =
      verdict?.openQuestions ??
      (Array.isArray(caseRecord.plan?.missingInfoQuestions)
        ? caseRecord.plan.missingInfoQuestions
        : []);
    const minimalPackage = {
      reason: caseRecord.escalationReason ?? 'unspecified',
      openQuestions,
      solutionSummary: ledger.solution.summary,
      agentError: caseRecord.escalationError,
      note: 'escalation agent failed; minimal package generated by runCase',
    };
    const escalationPath = path.join(caseDir, 'escalation.json');
    await writeFile(escalationPath, JSON.stringify(minimalPackage, null, 2), 'utf8');
    files.push(escalationPath);
  }

  if (draftPost) {
    // The draft goes through the DraftSink; carrying ledger+verdict lets
    // FileDraftSink write the full trio alongside draft.md.
    await sink.save({ ...draftPost, ledger, verdict });
    files.push(path.join(caseDir, 'draft.md'));
  }

  return { caseRecord, ledger, verdict, draftPost, artifacts: { dir: caseDir, files } };
}

/**
 * Read an email file (raw text) and run it through runCase.
 * @param {string} emailPath
 * @param {object} [options] same options as runCase
 */
export async function runCaseFromFile(emailPath, options = {}) {
  const raw = await readFile(emailPath, 'utf8');
  return runCase(raw, options);
}
