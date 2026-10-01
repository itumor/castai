// support-swarm.mjs — preset-local cordis plugin for the `castai-support-swarm`
// agent preset. Registers the model-facing tools that drive the 13-agent
// evidence-gated support pipeline from projects/castai-support-swarm:
//
//   - support_swarm_answer  run the swarm on one customer thread (OFFLINE only)
//   - support_swarm_eval    run the 7-case evaluation harness, offline
//
// The plugin is a plain ESM module: the loader unwraps these named exports.
// It intentionally imports NO @deepseek-ai/* package — a preset file plugin
// cannot resolve harness dependencies through Node's node_modules walk, so the
// tool definitions are hand-written JSON Schema (the registry's raw contract).
//
// Safety: OFFLINE ONLY. The engine is wired with HeuristicLlm and env: {} —
// never the live LLM/CAST-API path. Drafts are written to the package outbox;
// nothing is ever sent to a customer. Live mode stays on the CLI
// (bin/support-swarm.mjs --live) behind the AGENTS.md preflight checks.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const name = 'support-swarm';
const inject = ['tools'];

const DEFAULT_PACKAGE_PATH = '{{PACKAGE_PATH}}'; // rendered by scripts/install-dsh-preset.mjs

const ANSWER_DESCRIPTION = [
  'Run the CAST AI support swarm on one customer email thread and return the evidence-gated answer:',
  'triage category, supervisor plan, agent roster, verifier verdict (PASS/REJECT), confidence score,',
  'confidence-gate outcome, and the full customer-ready DRAFT reply (draft-only — a human sends).',
  'Offline mode: deterministic heuristics + the simulated lab, no network, no live-cluster reads.',
  'Input is a thread with "From:" and "Subject:" headers, pasted inline or read from a workspace file.',
  'An optional "; ; sim:" line seeds the offline lab (e.g. ";; sim: nodes=1 managed=true pods=1 pdb=true").',
  'Treat REJECT + clarify as a correct outcome — never restate an unverified claim as a verified one,',
  'and never forward internal repo paths or internal KB refs into a customer-facing message.',
].join(' ');

const EVAL_DESCRIPTION = [
  'Run the support swarm evaluation harness (node evals/run.js) over the built-in 7-case dataset:',
  'routing accuracy, verifier adversarial catch rate, mean tone score, confidence-gate correctness,',
  'and per-case check results. Offline and deterministic; writes evals/outbox + evals/results.json.',
  'Use it to validate a change to the swarm engine, or to show ground-truth behavior on any of the',
  '7 fixture scenarios.',
].join(' ');

/**
 * Load the engine entry points once per preset lifetime. Dynamic file-URL
 * imports keep this module's top level free of anything but node:* builtins,
 * which keeps the roster discovery health check trivially importable.
 */
function makeEngineLoader(packagePath) {
  let enginePromise = null;
  return async () => {
    if (enginePromise === null) {
      enginePromise = Promise.all([
        import(pathToFileURL(path.join(packagePath, 'bin', 'support-swarm.mjs')).href),
        import(pathToFileURL(path.join(packagePath, 'src', 'core', 'llm.js')).href),
        import(pathToFileURL(path.join(packagePath, 'src', 'pipeline', 'orchestrator.js')).href),
      ]).then(([cli, llm, orchestrator]) => ({
        parseThreadFile: cli.parseThreadFile,
        HeuristicLlm: llm.HeuristicLlm,
        runCase: orchestrator.runCase,
      }));
    }
    return enginePromise;
  };
}

function renderAnswer(value) {
  const lines = [];
  lines.push(`case ${value.caseId} — ${value.title}`);
  lines.push(`category:   ${value.category}`);
  lines.push(`plan:       ${value.plan}`);
  lines.push(`agents run: ${value.agentsRun}`);
  lines.push(`verdict:    ${value.verdict}   confidence: ${value.confidence}   gate: ${value.gate}`);
  if (value.forcedClarify) lines.push('note:       guard forced a clarify draft (ungrounded reply discarded)');
  if (value.escalationPath) lines.push(`escalation: ${value.escalationPath}`);
  if (value.replyPath) lines.push(`draft file: ${value.replyPath}`);
  for (const note of value.kbNotes) lines.push(`kb note:    ${note}`);
  lines.push('', '── draft reply (DRAFT ONLY — a human reviews and sends; never claim anything was sent) ──');
  lines.push(value.replyBody !== '' ? value.replyBody : '(no reply body — see escalation package)');
  return [{ type: 'text', text: lines.join('\n') }];
}

async function executeAnswer(args, loadEngine, paths) {
  const input = args && typeof args === 'object' ? args : {};
  const threadFile = typeof input.threadFile === 'string' && input.threadFile.trim() !== '' ? input.threadFile.trim() : undefined;
  const threadText = typeof input.threadText === 'string' && input.threadText.trim() !== '' ? input.threadText : undefined;
  if ((threadFile === undefined) === (threadText === undefined)) {
    throw new Error('support_swarm_answer: provide exactly one of threadFile or threadText');
  }

  const { parseThreadFile, HeuristicLlm, runCase } = await loadEngine();

  const raw = threadFile !== undefined ? await readFile(threadFile, 'utf8') : threadText;
  const parsed = parseThreadFile(raw);

  const { caseObj, summary } = await runCase(parsed.thread, {
    repoRoot: paths.repoRoot,
    llm: new HeuristicLlm(),
    outboxDir: paths.outboxDir,
    simSpec: parsed.simSpec,
    strictTwoSource: input.strict === true,
    kbRoot: paths.kbRoot,
    env: {}, // offline: match the CLI default (no live credentials in-session)
  });

  const plan = caseObj.plan && Array.isArray(caseObj.plan.agents) ? caseObj.plan.agents : [];
  return {
    caseId: caseObj.id,
    title: String(parsed.thread.subject || ''),
    category: caseObj.triage && caseObj.triage.category ? caseObj.triage.category : 'unknown',
    questions: caseObj.triage && Array.isArray(caseObj.triage.questions) ? caseObj.triage.questions : [],
    plan: plan.join(' -> '),
    agentsRun: summary.agentsRun.join(', '),
    verdict: summary.verdict,
    confidence: summary.confidence,
    gate: summary.gate,
    forcedClarify: Boolean(caseObj.reply && caseObj.reply.forcedClarify),
    // The registry schema validator has no type unions: absent values are ''.
    replyBody: caseObj.reply && typeof caseObj.reply.body === 'string' ? caseObj.reply.body : '',
    replyPath: summary.replyPath ?? '',
    escalationPath: summary.escalationPath ?? '',
    kbNotes: Array.isArray(caseObj.kbNotes) ? caseObj.kbNotes : [],
    strictTwoSource: input.strict === true,
  };
}

async function executeEval(paths) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['evals/run.js'], {
      cwd: paths.packagePath,
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { exitCode: 0, durationMs: Date.now() - start, output: tail(stdout, 120), stderrTail: tail(stderr, 20) };
  } catch (error) {
    return {
      exitCode: typeof error.code === 'number' ? error.code : -1,
      durationMs: Date.now() - start,
      output: tail(String(error.stdout ?? ''), 120),
      stderrTail: tail(String(error.stderr ?? error.message ?? ''), 20),
    };
  }
}

function tail(text, maxLines) {
  const lines = String(text).split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

async function apply(ctx, config = {}) {
  const packagePath =
    typeof config.packagePath === 'string' && config.packagePath.trim() !== ''
      ? config.packagePath.trim()
      : DEFAULT_PACKAGE_PATH;
  const paths = {
    packagePath,
    repoRoot: path.resolve(packagePath, '..', '..'),
    outboxDir: path.join(packagePath, 'outbox'),
    kbRoot: path.join(packagePath, 'outbox', 'kb'),
  };
  const loadEngine = makeEngineLoader(packagePath);

  ctx.tools.register({
    name: 'support_swarm_answer',
    description: ANSWER_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        threadFile: {
          type: 'string',
          description: 'Path to a thread file with From:/Subject: headers (e.g. fixtures/thread-pdb-scaledown.md). Use this OR threadText.',
        },
        threadText: {
          type: 'string',
          description: 'The complete customer thread text, starting with "From:" and "Subject:" header lines. Use this OR threadFile.',
        },
        strict: {
          type: 'boolean',
          description: 'Enterprise mode: the verifier requires >=2 independent evidence classes per claim (default false).',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'caseId', 'title', 'category', 'questions', 'plan', 'agentsRun', 'verdict',
          'confidence', 'gate', 'forcedClarify', 'replyBody', 'replyPath',
          'escalationPath', 'kbNotes', 'strictTwoSource',
        ],
        properties: {
          caseId: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          questions: { type: 'array', items: { type: 'string' } },
          plan: { type: 'string' },
          agentsRun: { type: 'string' },
          verdict: { type: 'string', enum: ['PASS', 'REJECT'] },
          confidence: { type: 'integer' },
          gate: { type: 'string' },
          forcedClarify: { type: 'boolean' },
          replyBody: { type: 'string' },
          replyPath: { type: 'string' },
          escalationPath: { type: 'string' },
          kbNotes: { type: 'array', items: { type: 'string' } },
          strictTwoSource: { type: 'boolean' },
        },
      },
      render: (_args, value) => renderAnswer(value),
    },
    execute: (args) => executeAnswer(args, loadEngine, paths),
    presentCall: (args) => ({
      card: 'generic',
      title: 'Support swarm: answer thread',
      kind: 'other',
      rawInput: { threadFile: args?.threadFile, strict: args?.strict === true, inline: typeof args?.threadText === 'string' },
    }),
  });

  ctx.tools.register({
    name: 'support_swarm_eval',
    description: EVAL_DESCRIPTION,
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['exitCode', 'durationMs', 'output', 'stderrTail'],
        properties: {
          exitCode: { type: 'integer' },
          durationMs: { type: 'integer' },
          output: { type: 'string' },
          stderrTail: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `support swarm evaluation — exit ${value.exitCode}, ${Math.round(value.durationMs / 1000)}s\n\n${value.output}${value.stderrTail.trim() !== '' ? `\n\nstderr:\n${value.stderrTail}` : ''}`,
      }],
    },
    timeoutMs: 300_000,
    execute: () => executeEval(paths),
    presentCall: () => ({ card: 'generic', title: 'Support swarm: run evaluation', kind: 'other' }),
  });

  if (typeof ctx.tools.guard === 'function') {
    ctx.tools.guard((execution) => {
      // Defense in depth: a threadFile must be an ordinary project path,
      // never something hidden under $HOME that the model could be tricked
      // into treating as a customer thread.
      if (execution.name !== 'support_swarm_answer') return undefined;
      const args = execution.arguments;
      if (!args || typeof args !== 'object' || typeof args.threadFile !== 'string' || args.threadFile.trim() === '') {
        return undefined;
      }
      const home = process.env.HOME;
      const resolved = path.resolve(args.threadFile.trim());
      if (
        resolved.split(path.sep).includes('..') ||
        (typeof home === 'string' && home !== '' && resolved.startsWith(`${home}${path.sep}.`))
      ) {
        return 'support_swarm_answer: threadFile must resolve to an ordinary project path (no hidden $HOME locations)';
      }
      return undefined;
    });
  }
}

export { apply, inject, name };
