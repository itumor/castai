import { test } from 'node:test';
import assert from 'node:assert/strict';
import { K8S_METHODS } from '../../src/adapters/k8s/k8s-client.js';
import { MockK8sClient } from '../../src/adapters/k8s/mock-k8s-client.js';

test('K8S_METHODS is a frozen list of the 8 interface methods', () => {
  assert.equal(Object.isFrozen(K8S_METHODS), true);
  assert.equal(K8S_METHODS.length, 8);
  assert.deepEqual([...K8S_METHODS], [
    'get',
    'describe',
    'logs',
    'top',
    'apiResources',
    'apiVersions',
    'clusterInfo',
    'version',
  ]);
});

test('MockK8sClient implements all 8 K8S_METHODS', () => {
  const mock = new MockK8sClient();
  for (const method of K8S_METHODS) {
    assert.equal(typeof mock[method], 'function', `missing method: ${method}`);
  }
});

test('MockK8sClient returns fixtures keyed by method name (values and functions)', async () => {
  const mock = new MockK8sClient({
    get: (kind, opts) => ({ kind, name: opts?.name ?? null }),
    describe: 'Pod prod/api-7f9 running',
    logs: ['line1', 'line2'],
    apiVersions: ['v1'],
  });

  assert.deepEqual(await mock.get('pod', { name: 'api-7f9' }), { kind: 'pod', name: 'api-7f9' });
  assert.equal(await mock.describe('pod', 'api-7f9', { namespace: 'prod' }), 'Pod prod/api-7f9 running');
  assert.deepEqual(await mock.logs({ app: 'api' }, {}), ['line1', 'line2']);
  assert.deepEqual(await mock.apiVersions(), ['v1']);
});

test('MockK8sClient falls back to sensible empty defaults per method', async () => {
  const mock = new MockK8sClient();
  assert.deepEqual(await mock.apiResources(), []);
  assert.deepEqual(await mock.apiVersions(), []);
  assert.deepEqual(await mock.logs({ app: 'x' }, {}), []);
  assert.equal(await mock.describe('node', 'n1', {}), '');
  assert.deepEqual(await mock.get('pod', {}), {});
  assert.deepEqual(await mock.top('nodes', {}), {});
  assert.deepEqual(await mock.clusterInfo(), {});
  assert.deepEqual(await mock.version(), {});
});

test('MockK8sClient records every call with method and args', async () => {
  const mock = new MockK8sClient({ version: { gitVersion: 'v1.29.0' } });
  await mock.version();
  await mock.get('pod', { namespace: 'prod' });
  await mock.top('pods', { namespace: 'prod' });

  assert.equal(mock.calls.length, 3);
  assert.deepEqual(
    mock.calls.map((c) => c.method),
    ['version', 'get', 'top'],
  );
  assert.deepEqual(mock.calls[1].args, ['pod', { namespace: 'prod' }]);
  assert.deepEqual(mock.calls[0].result, { gitVersion: 'v1.29.0' });
});
