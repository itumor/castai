// Eval runner (chunk 18).
//
// runEval(caseDir) loads a case directory (input.md, brain.json, expected.json),
// wires ScriptedBrain + all-mock adapters (real read-only KbReader), runs
// runCase() with per-run artifacts under evals/out/<caseId>/<runId>/ (gitignored),
// and returns the raw result for scoring.
//
// CLI mode (node evals/runner.js): runs every evals/cases/* directory, scores
// each with scoreEval, writes evals/report.json + evals/report.md, prints a
// one-line-per-case score table and exits 1 when any case total < 80.

import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { runCase } from '../src/index.js';
import { loadBrainScript, makeBrain, makeAdapters, readCaseFile } from './helpers.js';
import { scoreEval } from './scorer.js';
import { writeReport } from './report.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = path.join(HERE, 'cases');
export const OUT_ROOT = path.join(HERE, 'out');

/**
 * Run one eval case end-to-end.
 * @param {string} caseDir directory containing input.md, brain.json, expected.json
 * @param {{brainScript?: object, reproScenario?: object, castaiFixtures?: object,
 *          clusterId?: string, outDir?: string}} [options] overrides used by the
 *        self-test (corrupted brains / stripped scenarios)
 * @returns {Promise<{caseId: string, caseDir: string, expected: object,
 *          caseRecord: object, ledger: object, verdict: object|null,
 *          draftPost: object|null, artifactsDir: string}>}
 */
export async function runEval(caseDir, options = {}) {
  const rawEmail = await readCaseFile(caseDir, 'input.md');
  const expected = JSON.parse(await readCaseFile(caseDir, 'expected.json'));
  const script = options.brainScript ?? (await loadBrainScript(caseDir));

  // The mock cluster id: triage regex-extracts the cluster UUID from the email,
  // so reuse it when the caller does not pin one (corrupted-run self-test pins
  // the same id either way; the adapters only echo it back).
  const clusterId = options.clusterId ?? extractClusterId(rawEmail) ?? '00000000-0000-4000-8000-000000000000';
  const reproKey = script.steps
    ?.find((s) => s.match === 'Classify this support case')
    ?.response?.match(/"issueCategory":"([^"]+)"/)?.[1] ?? 'node_upscale';

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = options.outDir ?? path.join(OUT_ROOT, path.basename(caseDir), runId);
  await mkdir(outDir, { recursive: true });

  const { caseRecord, ledger, verdict, draftPost, artifacts } = await runCase(rawEmail, {
    brain: makeBrain(script),
    adapters: makeAdapters({
      clusterId,
      reproKey,
      reproScenario: options.reproScenario,
      castaiFixtures: options.castaiFixtures,
    }),
    outDir,
  });

  return {
    caseId: expected.id ?? path.basename(caseDir),
    caseDir,
    expected,
    caseRecord,
    ledger,
    verdict,
    draftPost,
    artifactsDir: artifacts.dir,
  };
}

/** List the eval case directories in deterministic order. */
export async function listCaseDirs() {
  const entries = await readdir(CASES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(CASES_DIR, e.name))
    .sort();
}

function extractClusterId(rawEmail) {
  const m = String(rawEmail).match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  );
  return m ? m[0].toLowerCase() : null;
}

/** Run, score and report all cases. Returns the per-case results. */
export async function runAllEvals() {
  const caseDirs = await listCaseDirs();
  const results = [];
  for (const caseDir of caseDirs) {
    const run = await runEval(caseDir);
    const score = scoreEval(run, run.expected);
    results.push({ ...run, score });
  }
  const report = await writeReport(results, HERE);
  return { results, report };
}

function printTable(results) {
  for (const r of results) {
    const d = r.score.dimensions;
    console.log(
      `${r.caseId.padEnd(34)} grounding=${String(d['evidence-grounding']).padStart(3)} ` +
      `honesty=${String(d['claim-honesty']).padStart(3)} style=${String(d.style).padStart(3)} ` +
      `routing=${String(d['routing-correctness']).padStart(3)} total=${String(r.score.total).padStart(3)} ` +
      `route=${r.draftPost?.route ?? '(escalated)'}`
    );
  }
}

// CLI mode.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { results, report } = await runAllEvals();
  printTable(results);
  console.log(
    `summary: avg ${report.summary.avg}, min ${report.summary.min}, ` +
    `passed ${report.summary.passed}/${report.summary.total}`
  );
  if (report.summary.passed < report.summary.total) process.exit(1);
}
