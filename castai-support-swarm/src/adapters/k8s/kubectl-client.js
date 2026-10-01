// KubectlClient — whitelist-gated subprocess wrapper around the kubectl CLI.
//
// Safety contract (chunk 9):
//   - The verb is validated against the frozen whitelist SYNCHRONOUSLY,
//     before any spawn; non-whitelisted verbs never reach execImpl.
//   - The child process is spawned from an argv array with NO shell.
//   - timeoutMs is enforced with a timer: on expiry the child is
//     kill('SIGKILL')ed and the promise rejects with a typed KubectlError.
//   - stdout/stderr are captured with a 1MB cap each (truncation is flagged).
//   - exit code != 0 rejects with a KubectlError whose stderr has been
//     passed through `redact` so leaked credentials never surface.
//   - execImpl is injectable so tests never spawn a real kubectl.

import { spawn } from 'node:child_process';
import { redact } from '../../core/redact.js';

// 1MB capture cap per stream (bytes).
const MAX_CAPTURE_BYTES = 1024 * 1024;

// Bounded stream capture: accumulates chunks up to capBytes; once the cap
// is exceeded, further data is dropped and `truncated` is set.
class LimitedCapture {
  constructor(capBytes) {
    this.cap = capBytes;
    this.buf = Buffer.alloc(0);
    this.truncated = false;
  }

  push(chunk) {
    if (this.truncated) return;
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const space = this.cap - this.buf.length;
    if (piece.length > space) {
      if (space > 0) {
        this.buf = Buffer.concat([this.buf, piece.subarray(0, space)]);
      }
      this.truncated = true;
    } else {
      this.buf = Buffer.concat([this.buf, piece]);
    }
  }

  text() {
    return this.buf.toString('utf8');
  }
}

// Typed error for every kubectl failure mode (refused verb, spawn error,
// non-zero exit, timeout). Carries the redacted stderr plus exit code and
// a timedOut flag so callers can branch without string matching.
export class KubectlError extends Error {
  constructor(message, { stderr = '', exitCode = null, timedOut = false } = {}) {
    super(message);
    this.name = 'KubectlError';
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.timedOut = timedOut;
  }
}

export class KubectlClient {
  // Exactly these verbs may ever be executed. Frozen so the gate cannot
  // be widened at runtime.
  static ALLOWED_VERBS = Object.freeze([
    'get',
    'describe',
    'logs',
    'top',
    'api-resources',
    'api-versions',
    'cluster-info',
    'version',
  ]);

  // `--raw=<path>` on `kubectl get` issues an arbitrary API GET, bypassing
  // the whitelisted verbs' usual resource surface. Rejected before spawn.
  static FORBIDDEN_ARG = /^--raw=/;

  constructor({ kubectlPath = 'kubectl', timeoutMs = 15000, execImpl } = {}) {
    this.kubectlPath = kubectlPath;
    this.timeoutMs = timeoutMs;
    this._execImpl = execImpl || spawn;
  }

  // Runs `kubectl <verb> <args...>` read-only. Rejects non-whitelisted
  // verbs synchronously — before execImpl is ever invoked.
  async run(verb, ...args) {
    if (typeof verb !== 'string' || !KubectlClient.ALLOWED_VERBS.includes(verb)) {
      throw new KubectlError(
        `kubectl verb not allowed: ${JSON.stringify(verb)}. ` +
          `Allowed verbs: ${KubectlClient.ALLOWED_VERBS.join(', ')}`,
        { stderr: '', exitCode: null, timedOut: false },
      );
    }

    const forbidden = args.find((a) => typeof a === 'string' && KubectlClient.FORBIDDEN_ARG.test(a));
    if (forbidden !== undefined) {
      throw new KubectlError(
        `kubectl argument not allowed: ${JSON.stringify(forbidden)}. ` +
          `Raw API requests (--raw=...) are rejected; use the whitelisted verbs.`,
        { stderr: '', exitCode: null, timedOut: false },
      );
    }

    const argv = [verb, ...args];
    let child;
    try {
      // argv array only, no shell — kubectlPath is the binary, argv the
      // exact argument vector.
      child = this._execImpl(this.kubectlPath, argv, { shell: false });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      throw new KubectlError(`failed to spawn kubectl: ${msg}`, {
        stderr: redact(msg),
        exitCode: null,
        timedOut: false,
      });
    }

    return await this._collect(child, argv);
  }

  // Attach stream capture, timeout timer, and close/error handlers.
  _collect(child, argv) {
    return new Promise((resolve, reject) => {
      const stdout = new LimitedCapture(MAX_CAPTURE_BYTES);
      const stderr = new LimitedCapture(MAX_CAPTURE_BYTES);
      let settled = false;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() => {
          reject(
            new KubectlError(
              `kubectl ${argv[0]} timed out after ${this.timeoutMs}ms (SIGKILL sent)`,
              { stderr: redact(stderr.text()), exitCode: null, timedOut: true },
            ),
          );
        });
      }, this.timeoutMs);

      const settle = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      if (child.stdout && typeof child.stdout.on === 'function') {
        child.stdout.on('data', (d) => stdout.push(d));
      }
      if (child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (d) => stderr.push(d));
      }

      child.on('error', (err) => {
        const msg = err && err.message ? err.message : String(err);
        settle(() => {
          reject(
            new KubectlError(`failed to run kubectl ${argv[0]}: ${msg}`, {
              stderr: redact(stderr.text()),
              exitCode: null,
              timedOut: false,
            }),
          );
        });
      });

      child.on('close', (code) => {
        settle(() => {
          const stderrText = redact(stderr.text());
          if (code !== 0) {
            reject(
              new KubectlError(
                `kubectl ${argv[0]} exited with code ${code}` +
                  (stderrText ? `: ${stderrText}` : ''),
                { stderr: stderrText, exitCode: code, timedOut: false },
              ),
            );
            return;
          }
          resolve({
            stdout: stdout.text(),
            stderr: stderrText,
            exitCode: code,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
          });
        });
      });
    });
  }
}
