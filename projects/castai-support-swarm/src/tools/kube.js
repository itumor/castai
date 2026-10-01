// src/tools/kube.js — read-only kubectl wrapper (contract section 6).
//
// Safety (root AGENTS.md): read-only posture. Every invocation is validated
// by assertKubectlArgs BEFORE any process is spawned, so mutations
// (delete/apply/exec/edit/...), auth-overriding flags (--server/--token/
// --kubeconfig, both '=' and two-arg forms), impersonation (--as/--as-group),
// secret reads (get/describe/logs secrets) and path-injection flags (--raw)
// can never reach a cluster through this tool. Returned stdout is additionally
// passed through maskSecretsString so secret material shaped like a known
// secret cannot flow into the ledger even from an allowed read.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertKubectlArgs, maskSecretsString } from '../core/policy.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024; // large `get -o json` payloads

/**
 * defaultExec — runs the real kubectl binary via execFile (no shell, so args
 * are never re-split or expanded). Tests inject a mock instead.
 */
async function defaultExec(file, args) {
  const { stdout } = await execFileAsync(file, args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

/**
 * kubectlRead(args, { execImpl } = {}) — validates args then runs kubectl;
 * returns the stdout string. execImpl, when provided, is called as
 * execImpl('kubectl', args) and may resolve to a string or { stdout }.
 * Throws PolicyError before executing when args are not read-only.
 */
export async function kubectlRead(args, { execImpl } = {}) {
  assertKubectlArgs(args);
  const exec = execImpl ?? defaultExec;
  const out = await exec('kubectl', [...args]);
  if (typeof out === 'string') return maskSecretsString(out);
  if (out !== null && typeof out === 'object' && typeof out.stdout === 'string') {
    return maskSecretsString(out.stdout);
  }
  return maskSecretsString(String(out));
}

/** parseKubejson(stdout) — JSON.parse helper used by the sre agent. */
export function parseKubejson(stdout) {
  return JSON.parse(stdout);
}
