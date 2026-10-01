// Eval report writer (chunk 18). Produces evals/report.json and report.md.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Score at or above this counts as a passing case (regression baseline). */
export const BASELINE = 80;

/**
 * Write report.json + report.md for a scored eval run.
 * @param {Array<{caseId: string, score: {dimensions: object, total: number},
 *                verdict: object|null, draftPost: object|null}>} results
 * @param {string} outDir directory to write report.json / report.md into
 */
export async function writeReport(results, outDir) {
  await mkdir(outDir, { recursive: true });

  const cases = results.map((r) => ({
    id: r.caseId,
    dimensions: r.score.dimensions,
    total: r.score.total,
    verdict: r.verdict?.pass ?? false,
    confidence: r.ledger?.confidence ?? null,
    route: r.draftPost?.route ?? null,
  }));

  const totals = cases.map((c) => c.total);
  const report = {
    ranAt: new Date().toISOString(),
    cases,
    summary: {
      avg: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
      min: totals.length ? Math.min(...totals) : 0,
      passed: totals.filter((t) => t >= BASELINE).length,
      total: totals.length,
    },
  };

  await writeFile(
    path.join(outDir, 'report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  const rows = cases.map(
    (c) =>
      `| ${c.id} | ${c.dimensions['evidence-grounding']} | ${c.dimensions['claim-honesty']} | ` +
      `${c.dimensions.style} | ${c.dimensions['routing-correctness']} | ${c.total} | ` +
      `${c.verdict ? 'pass' : 'fail'} | ${c.route ?? '(escalated)'} |`
  );
  const md = [
    '# Support swarm eval report',
    '',
    `Ran at: ${report.ranAt}`,
    '',
    `Summary: avg ${report.summary.avg}, min ${report.summary.min}, ` +
      `passed ${report.summary.passed}/${report.summary.total} (baseline ${BASELINE})`,
    '',
    '| case | evidence-grounding | claim-honesty | style | routing-correctness | total | verdict | route |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  await writeFile(path.join(outDir, 'report.md'), md, 'utf8');
  return report;
}
