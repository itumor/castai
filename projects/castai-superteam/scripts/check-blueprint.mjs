#!/usr/bin/env node
// scripts/check-blueprint.mjs — self-check for the CAST AI Superteam
// blueprint. Verifies that every role file exists and carries the mandatory
// safety markers, that TEAM.md names every teammate, and that the preset
// templates render. Exits non-zero on any failure.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROLES = [
  'supervisor',
  'cost-savings-analyst',
  'cluster-health',
  'support-triage',
  'docs-memory-keeper',
  'mcp-api-ops-runner',
];

// Teammate spawn names used in TEAM.md and live sessions (lower-kebab).
const TEAMMATE_NAMES = [
  'supervisor',
  'cost-analyst',
  'cluster-health',
  'support-triage',
  'docs-keeper',
  'mcp-ops',
];

let failures = 0;

function check(ok, label) {
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}\n`);
  if (!ok) failures += 1;
}

async function main() {
  process.stdout.write('castai-superteam blueprint self-check\n\n');

  // 1. Role files exist and carry the mandatory markers.
  for (const role of ROLES) {
    const file = path.join(ROOT, 'agents', `${role}.md`);
    check(existsSync(file), `agents/${role}.md exists`);
    if (!existsSync(file)) continue;
    const body = await readFile(file, 'utf8');
    check(body.length > 500, `agents/${role}.md is substantive (${body.length} chars)`);
    check(/read-only/i.test(body), `agents/${role}.md states the read-only rule`);
    check(body.includes('/Users/eramadan/castai') || body.includes('{{cwd}}'), `agents/${role}.md pins the working directory`);
  }

  // 2. TEAM.md names every teammate and the safety protocols.
  const teamPath = path.join(ROOT, 'TEAM.md');
  check(existsSync(teamPath), 'TEAM.md exists');
  const team = await readFile(teamPath, 'utf8');
  for (const name of TEAMMATE_NAMES) {
    check(team.includes(`\`${name}\``), `TEAM.md names teammate ${name}`);
  }
  check(/AGENTS\.md/.test(team), 'TEAM.md binds AGENTS.md');
  check(/Escalat/i.test(team), 'TEAM.md defines escalation');

  // 3. Preset templates exist and render.
  const agentPath = path.join(ROOT, 'dsh-preset', 'agent.cordis.yml');
  const presetPath = path.join(ROOT, 'dsh-preset', 'preset.yml');
  check(existsSync(agentPath), 'dsh-preset/agent.cordis.yml exists');
  check(existsSync(presetPath), 'dsh-preset/preset.yml exists');
  const agent = await readFile(agentPath, 'utf8');
  check(agent.includes('{{PACKAGE_PATH}}'), 'agent.cordis.yml carries the {{PACKAGE_PATH}} placeholder');
  const rendered = agent.replaceAll('{{PACKAGE_PATH}}', ROOT);
  check(rendered.includes(path.join(ROOT, 'TEAM.md')), 'agent.cordis.yml renders TEAM.md reference');

  if (failures > 0) {
    process.stderr.write(`\n${failures} check(s) failed.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nAll checks passed. The superteam blueprint is coherent.\n');
}

main().catch((error) => {
  process.stderr.write(`check-blueprint: ${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});
