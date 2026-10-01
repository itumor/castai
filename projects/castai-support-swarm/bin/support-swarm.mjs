#!/usr/bin/env node
// bin/support-swarm.mjs — contract section 9 (CLI).
//
//   node bin/support-swarm.mjs answer <thread-file.md> [--live] [--strict] [--out <dir>]
//
// Parses a thread file (From:, Subject:, blank line, body; an optional
// ";; sim:" comment line seeds the offline lab, e.g.
// ";; sim: nodes=1 managed=true pods=1 pdb=true"). Offline by default
// (HeuristicLlm + simulated lab). --live uses defaultLlm (HttpLlm when an API
// key exists) plus the real read-only CAST AI client. Prints a compact
// summary: category, plan, verdict, confidence, gate, artifact paths.
// Exit 0 on every handled case, 2 on usage error.
//
// Safety: read-only. --live only ever issues GET requests (the CAST AI client
// enforces the read-path allow-list); replies are drafts written to the
// outbox, never sent.

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HeuristicLlm, defaultLlm } from '../src/core/llm.js';
import { runCase } from '../src/pipeline/orchestrator.js';

// ---------------------------------------------------------------------------
// Thread-file parsing (exported for tests)
// ---------------------------------------------------------------------------

const SIM_LINE = /^\s*;;\s*sim:\s*(.+?)\s*$/;

function parseBool(value) {
  return String(value).toLowerCase() === 'true';
}

/**
 * parseSimSpec('nodes=1 managed=true pods=1 pdb=true') ->
 *   { nodes: [{ name, managed, doNotEvict }], pods: [{ name, node, pdbProtected, localStorage, managed, canMove }] }
 * Deterministic shorthand -> lab spec mapping. Unknown keys are ignored.
 */
export function parseSimSpec(text) {
  const spec = {};
  for (const pair of String(text || '').trim().split(/\s+/)) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) spec[key.toLowerCase()] = value;
  }

  const nodeCount = Math.max(0, Number.parseInt(spec.nodes ?? '0', 10) || 0);
  const podCount = Math.max(0, Number.parseInt(spec.pods ?? '0', 10) || 0);
  const nodesManaged = spec.managed === undefined ? true : parseBool(spec.managed);
  const doNotEvict = parseBool(spec.donotevict);

  const nodes = [];
  for (let i = 1; i <= nodeCount; i += 1) {
    nodes.push({ name: `node-${i}`, managed: nodesManaged, doNotEvict });
  }

  const pods = [];
  for (let i = 1; i <= podCount; i += 1) {
    const nodeName = nodeCount > 0 ? `node-${((i - 1) % nodeCount) + 1}` : 'node-1';
    pods.push({
      name: `pod-${i}`,
      node: nodeName,
      pdbProtected: parseBool(spec.pdb),
      localStorage: parseBool(spec.localstorage),
      managed: spec.podmanaged === undefined ? true : parseBool(spec.podmanaged),
      canMove: spec.canmove === undefined ? true : parseBool(spec.canmove),
    });
  }

  return { nodes, pods };
}

/**
 * parseThreadFile(raw) -> { thread: { from, subject, messages }, simSpec? }
 * Format: "From: ..." / "Subject: ..." / blank / body. Lines starting with
 * ";; sim:" are stripped from the body and converted to the lab spec.
 * Throws on a missing From:/Subject: header (usage error).
 */
export function parseThreadFile(raw) {
  const text = String(raw ?? '');
  const lines = text.split(/\r?\n/);

  // The header block is parsed ONCE from the top of the file: the first
  // From:/Subject: lines. Everything after the first blank line following the
  // headers is the body and is kept verbatim — quoted/forwarded messages
  // inside the body keep their own From:/Subject: lines (stripping them would
  // silently distort the thread the triage stage sees). Only ';; sim:' lines
  // are filtered out of the body.
  if (lines.length === 0 || !/^From:\s*(.+?)\s*$/.test(lines[0])) {
    throw new Error('thread file must start with "From:" and "Subject:" header lines');
  }
  const fromMatch = lines[0].match(/^From:\s*(.+?)\s*$/);
  // Skip extra header lines (none today, but tolerant) until Subject: or blank.
  let cursor = 1;
  while (cursor < lines.length && !/^Subject:/.test(lines[cursor]) && lines[cursor].trim() !== '') {
    cursor += 1;
  }
  const subjectMatch =
    cursor < lines.length ? lines[cursor].match(/^Subject:\s*(.+?)\s*$/) : null;
  if (!subjectMatch) {
    throw new Error('thread file must start with "From:" and "Subject:" header lines');
  }
  const bodyStart = lines.findIndex((line, index) => index > cursor && line.trim() === '');
  const bodyLines = bodyStart === -1 ? [] : lines.slice(bodyStart + 1);

  const simLines = [];
  const bodyText = bodyLines
    .filter((line) => {
      const sim = line.match(SIM_LINE);
      if (sim) simLines.push(sim[1]);
      return !sim;
    })
    .join('\n')
    .trim();

  const thread = {
    from: fromMatch[1],
    subject: subjectMatch[1],
    messages: [{ from: fromMatch[1], date: '', body: bodyText }],
  };
  const result = { thread };
  if (simLines.length > 0) result.simSpec = parseSimSpec(simLines.join(' '));
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'usage: node bin/support-swarm.mjs answer <thread-file.md> [--live] [--strict] [--out <dir>]',
  '',
  '  answer   run the support swarm on a customer thread file',
  '  --live   use defaultLlm (HttpLlm when an API key exists) and the real read-only CAST AI client',
  '  --strict verifier requires >=2 independent evidence classes per claim (enterprise mode)',
  '  --out    outbox directory for drafts, traces and kb notes (default: <package>/outbox)',
].join('\n');

function parseArgs(argv) {
  const args = { command: argv[0], live: false, strict: false, out: undefined, file: undefined };
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--live') args.live = true;
    else if (token === '--strict') args.strict = true;
    else if (token === '--out') {
      i += 1;
      if (i >= rest.length || rest[i].startsWith('--')) {
        throw new Error('--out requires a directory argument');
      }
      args.out = rest[i];
    } else if (token.startsWith('--')) {
      throw new Error(`unknown flag: ${token}`);
    } else if (args.file === undefined) {
      args.file = token;
    } else {
      throw new Error(`unexpected argument: ${token}`);
    }
  }
  return args;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.command !== 'answer' || !args.file) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(cliDir, '..');
  const repoRoot = path.resolve(packageRoot, '..', '..');
  const threadPath = path.resolve(args.file);
  const outboxDir = path.resolve(args.out ?? path.join(packageRoot, 'outbox'));

  let raw;
  try {
    raw = await readFile(threadPath, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read thread file: ${threadPath} (${error.message})\n`);
    return 2;
  }

  let parsed;
  try {
    parsed = parseThreadFile(raw);
  } catch (error) {
    process.stderr.write(`cannot parse thread file: ${error.message}\n`);
    return 2;
  }

  // Offline by default: HeuristicLlm + simulated lab, no CAST AI client.
  // --live: defaultLlm + the real read-only client assembled from the env.
  const env = args.live ? process.env : {};
  const llm = args.live ? defaultLlm(process.env) : new HeuristicLlm();

  const { caseObj, summary } = await runCase(parsed.thread, {
    repoRoot,
    llm,
    outboxDir,
    simSpec: parsed.simSpec,
    strictTwoSource: args.strict,
    kbRoot: path.join(outboxDir, 'kb'),
    env,
  });

  const category = caseObj.triage && caseObj.triage.category ? caseObj.triage.category : 'unknown';
  const plan = caseObj.plan && Array.isArray(caseObj.plan.agents) ? caseObj.plan.agents : [];
  const tracePath = path.join(outboxDir, 'traces', `${caseObj.id}.trace.jsonl`);
  const llmKind = args.live ? llm.constructor.name : 'HeuristicLlm';

  const lines = [];
  lines.push(`case:       ${caseObj.id}`);
  lines.push(`mode:       ${args.live ? `live (${llmKind}, read-only)` : 'offline (HeuristicLlm, simulated lab)'}`);
  lines.push(`category:   ${category}`);
  lines.push(`plan:       ${plan.join(' -> ')}`);
  lines.push(`agents run: ${summary.agentsRun.join(', ')}`);
  lines.push(`verdict:    ${summary.verdict}`);
  lines.push(`confidence: ${summary.confidence}`);
  lines.push(`gate:       ${summary.gate}`);
  if (summary.replyPath) lines.push(`reply:      ${summary.replyPath}`);
  if (summary.escalationPath) lines.push(`escalation: ${summary.escalationPath}`);
  for (const note of caseObj.kbNotes || []) lines.push(`kb note:    ${note}`);
  lines.push(`trace:      ${tracePath}`);
  process.stdout.write(`${lines.join('\n')}\n`);

  return 0;
}

// Only execute main() when invoked directly, so tests can import the parsers.
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return fileURLToPath(import.meta.url);
  }
})();
const isMain = invokedAs === selfPath || invokedAs === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`support-swarm: ${error && error.message ? error.message : error}\n`);
      process.exitCode = 2;
    });
}
