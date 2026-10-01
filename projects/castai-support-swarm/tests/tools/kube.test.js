// tests/tools/kube.test.js — read-only kubectl wrapper (contract section 6).
// No real kubectl is ever executed: a mock execImpl stands in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { kubectlRead, parseKubejson } from '../../src/tools/kube.js';
import { assertKubectlArgs, PolicyError } from '../../src/core/policy.js';

test('kubectlRead accepts read-only args and returns stdout', async () => {
  const seen = [];
  const execImpl = async (file, args) => {
    seen.push([file, args]);
    return 'NAME      STATUS   ROLES\nnode-1    Ready    control-plane\n';
  };
  const stdout = await kubectlRead(['get', 'pods', '-A'], { execImpl });
  assert.equal(stdout, 'NAME      STATUS   ROLES\nnode-1    Ready    control-plane\n');
  assert.deepEqual(seen, [['kubectl', ['get', 'pods', '-A']]]);
});

test('kubectlRead also accepts an execImpl resolving to { stdout }', async () => {
  const stdout = await kubectlRead(['get', 'nodes', '-o', 'json'], {
    execImpl: async () => ({ stdout: '{"items":[]}', stderr: '' }),
  });
  assert.equal(stdout, '{"items":[]}');
});

test('kubectlRead MASKS secret-shaped material in stdout before returning it', async () => {
  // Defense in depth: even a permitted read must not let secret-shaped text
  // flow into the case ledger (contract §6).
  const stdout = await kubectlRead(['get', 'pods', '-n', 'x'], {
    execImpl: async () =>
      'NAME        READY\nrunner-1    1/1   api_key=AKIAXYZ123456789ABCD in env\n',
  });
  assert.ok(!stdout.includes('AKIAXYZ123456789ABCD'), `leak: ${stdout}`);
  assert.match(stdout, /READY/);
});

test('kubectlRead rejects mutating/dangerous invocations before exec', async () => {
  let execCalled = 0;
  const execImpl = async () => {
    execCalled += 1;
    return '';
  };
  const forbidden = [
    ['delete', 'pod', 'x'],
    ['exec'],
    ['apply', '-f', 'x'],
    ['logs', 'x', '--server=http://evil'],
  ];
  for (const args of forbidden) {
    await assert.rejects(() => kubectlRead(args, { execImpl }), PolicyError);
  }
  assert.equal(execCalled, 0);
});

test('assertKubectlArgs accepts the read-only vocabulary', () => {
  assert.doesNotThrow(() => assertKubectlArgs(['get', 'pods', '-A']));
  assert.doesNotThrow(() => assertKubectlArgs(['logs', 'x', '--follow=false']));
  assert.doesNotThrow(() => assertKubectlArgs(['describe', 'node', 'n1']));
  assert.doesNotThrow(() => assertKubectlArgs(['top', 'pods']));
});

test('assertKubectlArgs rejects writes, exec, and auth overrides', () => {
  assert.throws(() => assertKubectlArgs(['delete', 'pod', 'x']), PolicyError);
  assert.throws(() => assertKubectlArgs(['exec']), PolicyError);
  assert.throws(() => assertKubectlArgs(['apply', '-f', 'x']), PolicyError);
  assert.throws(() => assertKubectlArgs(['logs', 'x', '--server=http://evil']), PolicyError);
  assert.throws(() => assertKubectlArgs(['get', 'secrets', '--token=dummy-token-value']), PolicyError);
  assert.throws(() => assertKubectlArgs(['get', 'pods', '--kubeconfig=/tmp/elsewhere']), PolicyError);
  assert.throws(() => assertKubectlArgs(['edit', 'deploy', 'api']), PolicyError);
  assert.throws(() => assertKubectlArgs([]), PolicyError);
});

test('parseKubejson parses kubectl -o json output', () => {
  const parsed = parseKubejson('{"kind":"NodeList","items":[{"metadata":{"name":"n1"}}]}');
  assert.equal(parsed.kind, 'NodeList');
  assert.equal(parsed.items[0].metadata.name, 'n1');
  assert.throws(() => parseKubejson('not json'));
});
