#!/usr/bin/env node
// scripts/install-dsh-preset.mjs — install the CAST AI Support Swarm agent
// preset into the DeepSeek Harness user preset root.
//
//   node scripts/install-dsh-preset.mjs [--dry-run] [--preset-root <dir>]
//
// Renders the dsh-preset/ templates against THIS checkout's absolute path and
// writes them to  <DSH_HOME or $HOME/.dsh>/.agent-presets/castai-support-swarm/.
// Idempotent: identical content is left in place; changed files are rewritten
// with the list of differences printed. The harness roster re-reads preset
// roots on discovery, so no harness restart is required — select the preset
// when creating a session.

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'dsh-preset');
const PRESET_ID = 'castai-support-swarm';
const TEMPLATE_FILES = ['agent.cordis.yml', 'preset.yml', 'support-swarm.mjs'];

function parseArgs(argv) {
  const args = { dryRun: false, presetRoot: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--preset-root') {
      i += 1;
      if (i >= argv.length) throw new Error('--preset-root requires a directory argument');
      args.presetRoot = argv[i];
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

async function render(templateName, packagePath) {
  const raw = await readFile(path.join(TEMPLATE_DIR, templateName), 'utf8');
  if (!raw.includes('{{PACKAGE_PATH}}') && templateName !== 'preset.yml') {
    throw new Error(`template ${templateName} has no {{PACKAGE_PATH}} placeholder — refusing to render a copy with stale paths`);
  }
  return raw.replaceAll('{{PACKAGE_PATH}}', packagePath);
}

function diffSummary(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const changed = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
  const extra = b.length > a.length ? b.length - a.length : 0;
  return `${changed.length} line(s) differ${extra > 0 ? `, ${extra} added` : ''}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : path.join(os.homedir(), '.dsh');
  const presetRoot = args.presetRoot ? path.resolve(args.presetRoot) : path.join(dshHome, '.agent-presets');
  const targetDir = path.join(presetRoot, PRESET_ID);

  process.stdout.write(`package:     ${PACKAGE_ROOT}\n`);
  process.stdout.write(`preset:      ${PRESET_ID}\n`);
  process.stdout.write(`target:      ${targetDir}\n`);
  process.stdout.write(`mode:        ${args.dryRun ? 'dry-run (nothing written)' : 'install'}\n\n`);

  // Only ordinary ASCII path segments — {{PACKAGE_PATH}} lands inside a YAML
  // scalar and a JS string literal in the templates.
  if (!/^[\x20-\x7e]+$/.test(PACKAGE_ROOT) || /['"\n]/.test(PACKAGE_ROOT) || PACKAGE_ROOT.includes('{{')) {
    throw new Error(`package path ${JSON.stringify(PACKAGE_ROOT)} cannot be embedded in the templates (quotes/unicode)`);
  }

  let wrote = 0;
  for (const template of TEMPLATE_FILES) {
    const rendered = await render(template, PACKAGE_ROOT);
    const target = path.join(targetDir, template);
    const previous = existsSync(target) ? await readFile(target, 'utf8') : null;
    const state = previous === null ? 'create' : previous === rendered ? 'unchanged' : `update (${diffSummary(previous, rendered)})`;
    process.stdout.write(`  ${state.padEnd(28)} ${template}\n`);
    if (previous !== rendered) {
      wrote += 1;
      if (!args.dryRun) {
        await mkdir(targetDir, { recursive: true });
        await writeFile(target, rendered, 'utf8');
      }
    }
  }

  if (args.dryRun) {
    process.stdout.write(`\ndry-run: ${wrote} file(s) would change. Re-run without --dry-run to install.\n`);
    return;
  }
  process.stdout.write(
    `\n${wrote === 0 ? 'Already up to date.' : `Installed/updated ${wrote} file(s).`}\n` +
      `\nTo use it: in the DSH GUI, create a session on workspace ${path.resolve(PACKAGE_ROOT, '..', '..')}\n` +
      `and pick the "${'CAST AI Support Swarm'}" preset in the preset selector. Then paste a customer\n` +
      `thread — the session calls support_swarm_answer (offline engine) or support_swarm_eval.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`install-dsh-preset: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});
