// Unit tests for EksLiveSandbox (spec chunk 12 acceptance criteria).
//
// execImpl is stubbed in every test except the SIGKILL-timeout test, which
// exercises the DEFAULT execImpl against a harmless local node script
// (console.log + sleep) written into a temp labs/ dir — no live cluster,
// no real lab scripts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EksLiveSandbox,
  SandboxRefusedError,
} from '../../src/adapters/sandbox/eks-live-sandbox.js';

function makeTempRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eks-live-sandbox-')));
  fs.mkdirSync(path.join(root, 'labs'), { recursive: true });
  return root;
}

function stubExec(stdout = '', stderr = '') {
  const calls = [];
  const impl = async (args) => {
    calls.push(args);
    return { stdout, stderr, exitCode: 0, timedOut: false };
  };
  impl.calls = calls;
  return impl;
}

function cleanEnv() {
  const prev = process.env.SWARM_REPRO_ALLOW_CLUSTER;
  delete process.env.SWARM_REPRO_ALLOW_CLUSTER;
  return () => {
    if (prev === undefined) delete process.env.SWARM_REPRO_ALLOW_CLUSTER;
    else process.env.SWARM_REPRO_ALLOW_CLUSTER = prev;
  };
}

describe('EksLiveSandbox', () => {
  test('default construction refuses every cluster', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const exec = stubExec('REPRODUCED=true\n');
      const sandbox = new EksLiveSandbox({ execImpl: exec, repoRoot: root });
      await assert.rejects(
        sandbox.run({ clusterName: 'anything', scriptPath: 'labs/x.js' }),
        (err) => {
          assert.ok(err instanceof SandboxRefusedError);
          assert.match(err.message, /anything/);
          assert.match(err.message, /SWARM_REPRO_ALLOW_CLUSTER/);
          return true;
        }
      );
      assert.equal(exec.calls.length, 0, 'execImpl must not be called');
    } finally {
      restore();
    }
  });

  test('empty allowPattern env means refuse-everything too', async () => {
    const restore = cleanEnv();
    try {
      process.env.SWARM_REPRO_ALLOW_CLUSTER = '';
      const root = makeTempRoot();
      const exec = stubExec('REPRODUCED=true\n');
      const sandbox = new EksLiveSandbox({ execImpl: exec, repoRoot: root });
      await assert.rejects(
        sandbox.run({ clusterName: 'karpenter-lab-us-west-2', scriptPath: 'labs/x.js' }),
        SandboxRefusedError
      );
      assert.equal(exec.calls.length, 0);
    } finally {
      restore();
    }
  });

  test("allowPattern '^karpenter-lab-' allows lab cluster via execImpl stub", async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const script = path.join(root, 'labs', 'repro.js');
      fs.writeFileSync(script, '// stub\n');
      const exec = stubExec(
        [
          'some ordinary log line',
          'REPRODUCED=true',
          'TRIGGER=spot interruption, node join timeout',
          'BEFORE=3 nodes',
          'AFTER=0 nodes',
          'post-marker log line',
        ].join('\n')
      );
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        execImpl: exec,
        repoRoot: root,
      });
      const result = await sandbox.run({
        clusterName: 'karpenter-lab-us-west-2',
        scriptPath: script,
      });
      assert.equal(exec.calls.length, 1, 'execImpl stub called exactly once');
      assert.equal(exec.calls[0].scriptPath, script);
      assert.equal(exec.calls[0].timedOut, undefined); // sandbox passes timeoutMs
      assert.equal(result.reproduced, true);
      assert.deepEqual(result.triggerConditions, ['spot interruption', 'node join timeout']);
      assert.equal(result.before, '3 nodes');
      assert.equal(result.after, '0 nodes');
      assert.ok(result.logs.some((l) => l.includes('some ordinary log line')));
      assert.ok(result.logs.some((l) => l.includes('post-marker log line')));
    } finally {
      restore();
    }
  });

  test("allowPattern '^karpenter-lab-' refuses prod-cluster and never calls execImpl", async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const exec = stubExec('REPRODUCED=true\n');
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        execImpl: exec,
        repoRoot: root,
      });
      await assert.rejects(
        sandbox.run({ clusterName: 'prod-cluster', scriptPath: 'labs/repro.js' }),
        (err) => {
          assert.ok(err instanceof SandboxRefusedError);
          assert.match(err.message, /prod-cluster/);
          assert.match(err.message, /SWARM_REPRO_ALLOW_CLUSTER/);
          return true;
        }
      );
      assert.equal(exec.calls.length, 0, 'refusal must happen before exec');
    } finally {
      restore();
    }
  });

  test('refusal happens before execImpl is invoked (cluster gate precedes path gate)', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const exec = stubExec();
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        execImpl: exec,
        repoRoot: root,
      });
      // bad cluster AND bad path → must refuse on the cluster gate first
      await assert.rejects(
        sandbox.run({ clusterName: 'production', scriptPath: '/etc/passwd' }),
        SandboxRefusedError
      );
      assert.equal(exec.calls.length, 0);
    } finally {
      restore();
    }
  });

  test('script path outside repoRoot/labs throws even with matching cluster', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      // real file that exists but lives OUTSIDE <root>/labs (sibling dir)
      const outsideDir = path.join(path.dirname(root), path.basename(root) + '-outside');
      fs.mkdirSync(outsideDir, { recursive: true });
      const outsideScript = path.join(outsideDir, 'evil.js');
      fs.writeFileSync(outsideScript, 'console.log("hi");\n');
      try {
        const exec = stubExec('REPRODUCED=true\n');
        const sandbox = new EksLiveSandbox({
          allowPattern: '^karpenter-lab-',
          execImpl: exec,
          repoRoot: root,
        });
        await assert.rejects(
          sandbox.run({ clusterName: 'karpenter-lab-us-west-2', scriptPath: outsideScript }),
          (err) => {
            assert.ok(err instanceof SandboxRefusedError);
            assert.match(err.message, /labs|jail/);
            return true;
          }
        );
        assert.equal(exec.calls.length, 0);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    } finally {
      restore();
    }
  });

  test('nonexistent and jail-escaping script paths are refused', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const exec = stubExec();
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        execImpl: exec,
        repoRoot: root,
      });
      await assert.rejects(
        sandbox.run({
          clusterName: 'karpenter-lab-us-west-2',
          scriptPath: 'labs/does-not-exist.js',
        }),
        SandboxRefusedError
      );
      // symlink inside labs pointing outside the repo
      const outside = path.join(path.dirname(root), path.basename(root) + '-link-target.js');
      fs.writeFileSync(outside, 'console.log("hi");\n');
      const link = path.join(root, 'labs', 'link.js');
      fs.symlinkSync(outside, link);
      try {
        await assert.rejects(
          sandbox.run({ clusterName: 'karpenter-lab-us-west-2', scriptPath: link }),
          SandboxRefusedError
        );
      } finally {
        fs.rmSync(outside, { force: true });
      }
      assert.equal(exec.calls.length, 0);
    } finally {
      restore();
    }
  });

  test('no markers on stdout → reproduced:false with logs captured and redacted', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const script = path.join(root, 'labs', 'plain.js');
      fs.writeFileSync(script, '// stub\n');
      const exec = stubExec(
        'plain output line\nsecret: castai_v1_AbCdEf1234567890abcdef\nstderr line here',
        'oops on stderr\nAuthorization: Token castai_v1_ZzYyXw0000000000000000\n'
      );
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        execImpl: exec,
        repoRoot: root,
      });
      const result = await sandbox.run({
        clusterName: 'karpenter-lab-us-west-2',
        scriptPath: script,
      });
      assert.equal(result.reproduced, false);
      assert.deepEqual(result.triggerConditions, []);
      assert.equal(result.before, '');
      assert.equal(result.after, '');
      const all = result.logs.join('\n');
      assert.ok(all.includes('plain output line'));
      assert.ok(all.includes('oops on stderr'));
      assert.ok(!all.includes('castai_v1_AbCdEf'));
      assert.ok(all.includes('castai_v1_[REDACTED]'));
      assert.ok(!all.includes('ZzYyXw'));
    } finally {
      restore();
    }
  });

  test('default execImpl: SIGKILL on timeout and stdout redaction (local temp script)', async () => {
    const restore = cleanEnv();
    try {
      const root = makeTempRoot();
      const script = path.join(root, 'labs', 'sleeper.js');
      fs.writeFileSync(
        script,
        [
          "console.log('castai_v1_PlantedSecretValue123');",
          'setTimeout(() => {}, 60000);',
          '',
        ].join('\n')
      );
      const sandbox = new EksLiveSandbox({
        allowPattern: '^karpenter-lab-',
        repoRoot: root,
        timeoutMs: 250,
      });
      const started = Date.now();
      const result = await sandbox.run({
        clusterName: 'karpenter-lab-us-west-2',
        scriptPath: script,
      });
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 10000, `should be killed quickly, took ${elapsed}ms`);
      assert.ok(!result.reproduced);
      const all = result.logs.join('\n');
      assert.match(all, /\[timeout\]/);
      assert.match(all, /SIGKILL/);
      assert.ok(!all.includes('PlantedSecretValue'));
      assert.ok(all.includes('castai_v1_[REDACTED]'));
    } finally {
      restore();
    }
  });
});
