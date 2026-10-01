// tests/core/policy.test.js — contract section 3 (src/core/policy.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PolicyError,
  AGENT_PERMISSIONS,
  assertToolAllowed,
  CASTAI_READ_PATHS,
  assertCastaiReadPath,
  KUBECTL_READ_VERBS,
  assertKubectlArgs,
  SENSITIVE_KEYS,
  redact,
  maskSecretsString,
} from '../../src/core/policy.js';

test('AGENT_PERMISSIONS matches the contract map', () => {
  assert.deepEqual(AGENT_PERMISSIONS.supervisor, { tools: [], writes: ['plan'] });
  assert.deepEqual(AGENT_PERMISSIONS.writer, { tools: ['emailDraft'] });
  assert.deepEqual(AGENT_PERMISSIONS.sre, { tools: ['kube', 'castai', 'lab'] });
  assert.deepEqual(AGENT_PERMISSIONS.knowledge, { tools: ['kb', 'kbWrite'] });
  assert.equal(Object.keys(AGENT_PERMISSIONS).length, 13);
});

test('assertToolAllowed permits listed tools and throws PolicyError otherwise', () => {
  assert.doesNotThrow(() => assertToolAllowed('researcher', 'kb'));
  assert.doesNotThrow(() => assertToolAllowed('researcher', 'docsSearch'));
  assert.doesNotThrow(() => assertToolAllowed('sre', 'castai'));
  assert.doesNotThrow(() => assertToolAllowed('writer', 'emailDraft'));

  assert.throws(() => assertToolAllowed('writer', 'kube'), PolicyError);
  assert.throws(() => assertToolAllowed('triage', 'castai'), PolicyError);
  assert.throws(() => assertToolAllowed('supervisor', 'kb'), PolicyError); // supervisor has no tools
  assert.throws(() => assertToolAllowed('nosuchagent', 'kb'), PolicyError);

  try {
    assertToolAllowed('qa', 'castai');
    assert.unreachable('should have thrown');
  } catch (err) {
    assert.ok(err instanceof PolicyError);
    assert.match(err.message, /qa/);
    assert.match(err.message, /castai/);
  }
});

test('CASTAI_READ_PATHS is the contract allow-list', () => {
  assert.equal(CASTAI_READ_PATHS.length, 7);
  assert.ok(CASTAI_READ_PATHS.every((rx) => rx instanceof RegExp));
});

test('assertCastaiReadPath allows read-scope paths exactly', () => {
  const allowed = [
    '/v1/organizations',
    '/v1/organizations/abc-123',
    '/v1/kubernetes/external-clusters',
    '/v1/kubernetes/external-clusters/clu-1',
    '/v1/kubernetes/external-clusters/clu-1/nodes',
    '/v1/cost-reports/rep-1',
    '/v1/workload-autoscaling/clusters/clu-1',
    '/v1/inventory/x',
    '/v1/recommendations/y',
    '/v1/pricing',
  ];
  for (const path of allowed) assert.doesNotThrow(() => assertCastaiReadPath(path), path);
});

test('assertCastaiReadPath rejects lookalike and write paths', () => {
  const denied = [
    '/v1/organizationsx',
    '/v1/organization',
    '/v2/organizations',
    'organizations',
    '/v1/kubernetes/clusters',
    '/v1/kubernetes/external-clustersx',
    '/v1/tokens',
    '/v1/auth/token-exchange',
    '',
  ];
  for (const path of denied) assert.throws(() => assertCastaiReadPath(path), PolicyError, path);
});

test('KUBECTL_READ_VERBS matches the contract', () => {
  assert.deepEqual(KUBECTL_READ_VERBS, ['get', 'describe', 'logs', 'top', 'explain', 'api-resources', 'version', 'config']);
});

test('assertKubectlArgs allows read-only invocations', () => {
  assert.doesNotThrow(() => assertKubectlArgs(['get', 'pods', '-n', 'castai-agent']));
  assert.doesNotThrow(() => assertKubectlArgs(['describe', 'node', 'ip-10-0-0-1']));
  assert.doesNotThrow(() => assertKubectlArgs(['logs', 'pod-1', '--follow=false'])); // explicitly fine
  assert.doesNotThrow(() => assertKubectlArgs(['version']));
  assert.doesNotThrow(() => assertKubectlArgs(['api-resources']));
  // config's read-only subcommands are allowed.
  assert.doesNotThrow(() => assertKubectlArgs(['config', 'view']));
  assert.doesNotThrow(() => assertKubectlArgs(['config', 'get-contexts']));
  assert.doesNotThrow(() => assertKubectlArgs(['config', 'current-context']));
});

test('assertKubectlArgs rejects mutating verbs and dangerous flags', () => {
  const bad = [
    [],
    'get pods',
    ['exec', 'pod-1', '--', 'ls'],
    ['apply', '-f', 'x.yaml'],
    ['delete', 'pod', 'pod-1'],
    ['edit', 'deploy', 'x'],
    ['patch', 'pdb', 'x'],
    ['cp', 'a', 'b'],
    ['port-forward', 'svc/x', '8080'],
    ['attach', 'pod-1'],
    ['get', 'secrets', '--token=abc'],
    ['get', 'pods', '--server=https://evil.example.com'],
    ['describe', 'pod', '--kubeconfig=/tmp/evil'],
    ['get', '--TOKEN=abc'], // case-insensitive flag detection
  ];
  for (const args of bad) assert.throws(() => assertKubectlArgs(args), PolicyError, JSON.stringify(args));
});

test('config subcommands beyond the read-only three are rejected', () => {
  for (const args of [
    ['config'],
    ['config', 'set-context', 'x'],
    ['config', 'use-context', 'evil'],
    ['config', 'set-credentials', 'evil'],
    ['config', 'unset', 'clusters.evil'],
  ]) {
    assert.throws(() => assertKubectlArgs(args), PolicyError, JSON.stringify(args));
  }
});

test('auth/impersonation flags are denied in BOTH "--flag=value" and "--flag value" forms', () => {
  const tails = [
    '--server', '-s', '--token', '--kubeconfig', '--context', '--as',
    '--as-group', '--username', '--password', '--client-certificate',
    '--client-key', '--certificate-authority',
  ];
  for (const flag of tails) {
    assert.throws(
      () => assertKubectlArgs(['get', 'pods', `${flag}=evil`]),
      PolicyError,
      `${flag}=evil`,
    );
    assert.throws(
      () => assertKubectlArgs(['get', 'pods', flag, 'evil']),
      PolicyError,
      `${flag} evil (two-arg)`,
    );
  }
  // Non-flag arguments must never be mistaken for flags: the value AFTER a
  // benign flag is positionally fine (namespace names etc.).
  assert.doesNotThrow(() => assertKubectlArgs(['get', 'pods', '-n', 'kube-system']));
});

test('secret resource reads are denied for get/describe/logs, even mixed-case and plural/short forms', () => {
  for (const resource of ['secret', 'secrets', 'Secret', 'SECRETS']) {
    for (const verb of ['get', 'describe', 'logs']) {
      assert.throws(
        () => assertKubectlArgs([verb, resource, 'api-keys']),
        PolicyError,
        `${verb} ${resource}`,
      );
    }
  }
  // Reading pods that happen to be NAMED 'secret-thing' is fine.
  assert.doesNotThrow(() => assertKubectlArgs(['get', 'pods', 'secret-thing']));
});

test('--raw path injection is denied in both forms', () => {
  assert.throws(() => assertKubectlArgs(['get', '--raw', '/api/v1/secrets']), PolicyError);
  assert.throws(() => assertKubectlArgs(['get', 'pods', '--raw=/api/v1/namespaces/x/secrets/y']), PolicyError);
  // ---raw is not --raw: leading dashes beyond 2 fall through harmlessly... and
  // any truly odd flag of unknown meaning is still allowed ONLY alongside read verbs.
  assert.doesNotThrow(() => assertKubectlArgs(['get', 'pods']));
});

test('maskSecretsString masks secret-shaped material in free text', () => {
  // bearer tokens
  assert.equal(
    maskSecretsString('Authorization: Bearer abcdef1234567890TOKEN'),
    'Authorization: Bearer ***REDACTED***',
  );
  assert.ok(!maskSecretsString('bearer abcdef1234567890TOKEN').includes('abcdef1234567890TOKEN'));
  // jwt-shaped blobs
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghSIGNATURE';
  assert.ok(!maskSecretsString(`token is ${jwt}`).includes('eyJhbGci'));
  // aws-style access key ids (AKIA + 16 chars)
  assert.ok(!maskSecretsString('aws_access_key_id=AKIAXYZ123456789ABCD').includes('AKIAXYZ123456789ABCD'));
  // long hex ids
  const hex = 'a'.repeat(40);
  assert.ok(!maskSecretsString(`fingerprint: ${hex}`).includes(hex));
  // key=value secret pairs (quoted and unquoted)
  assert.ok(!maskSecretsString('password=supersecretpassword').includes('supersecretpassword'));
  assert.ok(!maskSecretsString('password="supersecretpassword"').includes('supersecretpassword'));
  assert.ok(!maskSecretsString('api_key: supersecretpassword').includes('supersecretpassword'));
  // non-secrets pass through untouched
  assert.equal(maskSecretsString('pod castai-cluster-controller is Running'), 'pod castai-cluster-controller is Running');
  // an already-masked value is not re-masked into nonsense
  assert.equal(maskSecretsString('token= ***REDACTED***'), 'token= ***REDACTED***');
  // null/undefined/object input is passed through unchanged
  assert.equal(maskSecretsString(null), null);
  const obj = { a: 1 };
  assert.equal(maskSecretsString(obj), obj);
});

test('redact masks STRING VALUES of sensitive keys (not only the key slot)', () => {
  const out = redact({ note: 'the api_key is AKIAXYZ123456789ABCD' });
  assert.ok(!out.note.includes('AKIAXYZ123456789ABCD'), `leak: ${out.note}`);
  // but ordinary English is untouched
  assert.equal(redact({ note: 'the cluster token is a concept' }).note, 'the cluster token is a concept');
});

test('SENSITIVE_KEYS matches the contract', () => {
  assert.deepEqual(SENSITIVE_KEYS, ['token', 'secret', 'password', 'apikey', 'api_key', 'authorization', 'credential']);
});

test('redact replaces sensitive keys at any nesting depth', () => {
  const input = {
    apiKey: 'k1',
    nested: {
      clusterToken: 't1',
      deep: {
        Authorization: 'Bearer abc',
        user_password_hash: 'p1',
        fine: 42,
      },
      list: [{ secret_name: 's1' }, { ok: 'yes' }],
    },
    'X-ApiKey': 'k2',
    myCredentials: 'c1',
    empty: null,
  };
  const out = redact(input);

  assert.equal(out.apiKey, '***REDACTED***');
  assert.equal(out.nested.clusterToken, '***REDACTED***');
  assert.equal(out.nested.deep.Authorization, '***REDACTED***');
  assert.equal(out.nested.deep.user_password_hash, '***REDACTED***');
  assert.equal(out.nested.list[0].secret_name, '***REDACTED***');
  assert.equal(out['X-ApiKey'], '***REDACTED***');
  assert.equal(out.myCredentials, '***REDACTED***');

  assert.equal(out.nested.deep.fine, 42);
  assert.equal(out.nested.list[1].ok, 'yes');
  assert.equal(out.empty, null);
});

test('redact does not mutate its input and handles arrays/primitives', () => {
  const input = { token: 'keep-me', arr: [{ password: 'p' }] };
  const out = redact(input);
  assert.equal(input.token, 'keep-me'); // untouched original
  assert.equal(input.arr[0].password, 'p');
  assert.equal(out.token, '***REDACTED***');
  assert.equal(out.arr[0].password, '***REDACTED***');
  assert.notEqual(out, input);
  assert.notEqual(out.arr, input.arr);

  assert.equal(redact('token'), 'token'); // bare strings are not keys
  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.deepEqual(redact(['a', 'b']), ['a', 'b']);

  // Contract semantics: substring match on the lowercased key. The hyphenated
  // 'x-api-key' contains no SENSITIVE_KEYS entry ('apikey' / 'api_key'), so
  // it passes through verbatim.
  assert.equal(redact({ 'X-Api-Key': 'k' })['X-Api-Key'], 'k');
});
