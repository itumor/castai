#!/usr/bin/env node
// CLI (chunk 15):
//
//   node src/cli.js case --email <path> [--script <brain-script.json>] [--outdir <dir>]
//
// Loads a ScriptedBrain from --script when given (otherwise the brain factory
// from the environment), runs the case, prints one summary line per state
// transition plus the final verdict/confidence and artifact paths.
// Exit code: 0 on a completed case, 2 on error.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createBrain } from './brains/brain.js';
import { ScriptedBrain } from './brains/scripted-brain.js';
import { routeFromScore } from './core/confidence.js';
import { runCaseFromFile } from './index.js';

const USAGE =
  'usage: node src/cli.js case --email <path> [--script <brain-script.json>] [--outdir <dir>]';

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email' || arg === '--script' || arg === '--outdir') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} requires a value\n${USAGE}`);
      }
      parsed[arg.slice(2)] = value;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args._[0] !== 'case') {
    console.error(USAGE);
    return 2;
  }
  if (!args.email) {
    console.error(`--email <path> is required\n${USAGE}`);
    return 2;
  }

  let brain;
  if (args.script) {
    const script = JSON.parse(readFileSync(args.script, 'utf8'));
    brain = new ScriptedBrain(script);
  } else {
    brain = await createBrain(process.env);
  }

  const outDir = args.outdir ?? 'out';
  const { caseRecord, ledger, verdict, artifacts } = await runCaseFromFile(args.email, {
    brain,
    outDir,
  });

  // One summary line per state transition (from the ledger audit trail).
  for (const entry of ledger.auditLog) {
    if (entry.agent === 'orchestrator') {
      console.log(`[${entry.at}] ${entry.action} — ${entry.detail}`);
    }
  }

  const route = typeof ledger.confidence === 'number'
    ? routeFromScore(ledger.confidence)
    : 'n/a';
  console.log(
    `verdict: ${verdict?.pass === true ? 'PASS' : 'FAIL'}` +
      ` | confidence: ${ledger.confidence ?? 'n/a'}` +
      ` | route: ${route}` +
      ` | solution: ${ledger.solution.status}` +
      ` | state: ${caseRecord.status}`
  );
  if (verdict?.reason) console.log(`verdict reason: ${verdict.reason}`);

  console.log('artifacts:');
  for (const file of artifacts.files) {
    console.log(`  ${path.resolve(file)}`);
  }
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`error: ${err?.message ?? err}`);
    process.exitCode = 2;
  });
