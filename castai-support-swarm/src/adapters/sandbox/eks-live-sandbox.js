// Allowlist-gated live EKS reproduction sandbox (spec chunk 12).
//
// Safety invariants (spec chunks 5 §1 + 12), enforced IN THIS ORDER:
//  1. Cluster allowlist gate: run() refuses (SandboxRefusedError) unless
//     clusterName matches allowPattern BEFORE any subprocess is spawned.
//     allowPattern comes from the constructor or the SWARM_REPRO_ALLOW_CLUSTER
//     env var (regex source string). Default/empty → refuse EVERY cluster.
//     The refusal message names the cluster, the refusal reason, and how to
//     opt in (set SWARM_REPRO_ALLOW_CLUSTER to a lab/dev-only regex).
//  2. Script path jail: scriptPath must resolve (realpath) inside the repo's
//     `labs/` subtree, using the same symlink-jail check as KbReader
//     (KbReader.isPathAllowed). Anything outside → SandboxRefusedError.
//  3. Only then execute: default execImpl spawns node with the script path as
//     an argv array (no shell), kills with SIGKILL after timeoutMs, and all
//     output passes through redact() before it is returned.
//
// execImpl contract (injectable):
//   execImpl({ scriptPath, argv, timeoutMs }) → Promise<{
//     stdout: string, stderr: string, exitCode: number|null, timedOut: boolean
//   }>
//
// Marker parsing: simple KEY=VALUE lines on stdout are lifted into the
// structured result:
//   REPRODUCED=true|false
//   TRIGGER=<text>            (repeatable / comma-split into triggerConditions)
//   BEFORE=<text>
//   AFTER=<text>
// All stdout/stderr lines (redacted) are captured into `logs`. If no
// REPRODUCED marker is present, reproduced defaults to false.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { redact } from '../../core/redact.js';
import { KbReader } from '../kb/kb-reader.js';

const DEFAULT_TIMEOUT_MS = 120 * 1000;

/** Thrown when the sandbox refuses to run (cluster not allowlisted or script outside the labs jail). */
export class SandboxRefusedError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'SandboxRefusedError';
  }
}

function defaultRepoRoot() {
  // src/adapters/sandbox/eks-live-sandbox.js → component dir is 3 levels up;
  // repoRoot is the parent of the component dir → 4 levels up.
  const componentDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..'
  );
  return path.resolve(componentDir, '..');
}

/**
 * Default execImpl: spawn node (argv array, no shell) on the script,
 * SIGKILL after timeoutMs. Collects stdout/stderr as utf8 strings.
 */
function defaultExecImpl({ scriptPath, timeoutMs }) {
  const argv = [process.execPath, scriptPath];
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

/**
 * Extract KEY=VALUE marker lines from raw (unredacted) stdout and return
 * the structured fields plus the remaining redacted log lines.
 */
function parseMarkers(stdout) {
  const result = {
    reproduced: null,
    triggerConditions: [],
    before: '',
    after: '',
  };
  const logLines = [];
  for (const rawLine of splitLines(stdout)) {
    const m = rawLine.match(/^(REPRODUCED|TRIGGER|BEFORE|AFTER)=(.*)$/);
    if (!m) {
      logLines.push(rawLine);
      continue;
    }
    const [, key, value] = m;
    const text = value.trim();
    if (key === 'REPRODUCED') {
      result.reproduced = text === 'true';
      logLines.push(rawLine);
    } else if (key === 'TRIGGER') {
      for (const t of text.split(',')) {
        const trimmed = t.trim();
        if (trimmed) result.triggerConditions.push(trimmed);
      }
      logLines.push(rawLine);
    } else if (key === 'BEFORE') {
      result.before = text;
      logLines.push(rawLine);
    } else {
      result.after = text;
      logLines.push(rawLine);
    }
  }
  return { ...result, logLines };
}

/**
 * Live EKS reproduction sandbox. Refuses clusters not matching the
 * allowlist (default: refuse everything) and scripts outside `labs/`.
 *
 * @implements {import('./sandbox.js').Sandbox}
 */
export class EksLiveSandbox {
  /**
   * @param {object} [options]
   * @param {string} [options.allowPattern] regex source string; falls back to
   *        SWARM_REPRO_ALLOW_CLUSTER env; default/empty → refuse all clusters.
   * @param {Function} [options.execImpl] injectable executor, see module docs.
   * @param {string} [options.repoRoot] defaults to parent of the component dir.
   * @param {number} [options.timeoutMs] subprocess kill timeout (default 120s).
   */
  constructor({ allowPattern, execImpl, repoRoot, timeoutMs } = {}) {
    this.allowPattern = String(allowPattern ?? process.env.SWARM_REPRO_ALLOW_CLUSTER ?? '').trim();
    this.execImpl = execImpl || defaultExecImpl;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    this.repoRoot = fs.realpathSync(path.resolve(repoRoot || defaultRepoRoot()));
    this.labsRoot = path.join(this.repoRoot, 'labs');
  }

  /**
   * Run a reproduction script against a live cluster.
   * Gating order (spec chunk 12): cluster allowlist → labs jail → exec.
   *
   * @param {{clusterName: string, scriptPath: string}} args
   * @returns {Promise<{reproduced: boolean, triggerConditions: string[], before: string, after: string, logs: string[]}>}
   */
  async run({ clusterName, scriptPath } = {}) {
    // Gate 1: cluster allowlist — BEFORE any exec.
    const cluster = String(clusterName ?? '');
    if (!this.allowPattern) {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': no cluster ` +
          `allowlist configured (SWARM_REPRO_ALLOW_CLUSTER is empty; default ` +
          `is refuse-everything). To opt in for lab/dev clusters only, set ` +
          `SWARM_REPRO_ALLOW_CLUSTER to a strict regex such as '^karpenter-lab-'`
      );
    }
    let allowRe;
    try {
      allowRe = new RegExp(this.allowPattern);
    } catch (err) {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': ` +
          `SWARM_REPRO_ALLOW_CLUSTER is not a valid regex (${err.message}); ` +
          `fix the pattern to opt in`
      );
    }
    if (!allowRe.test(cluster)) {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': cluster ` +
          `does not match SWARM_REPRO_ALLOW_CLUSTER pattern '${this.allowPattern}'. ` +
          `Only lab/dev clusters may be targeted; to opt in, set ` +
          `SWARM_REPRO_ALLOW_CLUSTER to a strict regex such as '^karpenter-lab-'`
      );
    }

    // Gate 2: script path must live inside the repo's labs/ subtree.
    const resolved = path.isAbsolute(scriptPath)
      ? path.resolve(scriptPath)
      : path.resolve(this.repoRoot, scriptPath);
    let realLabsRoot;
    try {
      realLabsRoot = fs.realpathSync(this.labsRoot);
    } catch {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': the ` +
          `labs/ directory does not exist under the repository root, so no ` +
          `script can be authorized`
      );
    }
    if (!KbReader.isPathAllowed(this.repoRoot, resolved)) {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': script ` +
          `path '${scriptPath}' escapes the repository jail or does not exist`
      );
    }
    const realScript = fs.realpathSync(resolved);
    const jailRoot = realLabsRoot.endsWith(path.sep) ? realLabsRoot : realLabsRoot + path.sep;
    if (realScript !== realLabsRoot && !realScript.startsWith(jailRoot)) {
      throw new SandboxRefusedError(
        `refusing to run live reproduction on cluster '${cluster}': script ` +
          `path '${scriptPath}' resolves outside the labs/ subtree`
      );
    }

    // Gate 3: only now execute. Output is redacted before it leaves here.
    const exec = await this.execImpl({
      scriptPath: realScript,
      argv: [process.execPath, realScript],
      timeoutMs: this.timeoutMs,
    });

    const stdout = exec?.stdout ?? '';
    const stderr = exec?.stderr ?? '';
    const markers = parseMarkers(stdout);
    const logs = [...markers.logLines.map(redact), ...splitLines(stderr).map(redact)];
    if (exec?.timedOut) {
      logs.unshift(
        `[timeout] reproduction script exceeded ${this.timeoutMs}ms and was killed with SIGKILL`
      );
    }

    return {
      reproduced: markers.reproduced === true,
      triggerConditions: markers.triggerConditions,
      before: markers.before,
      after: markers.after,
      logs,
    };
  }
}
