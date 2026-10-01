import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_ONLY_TOOL_NAMES, ToolNotAllowedError } from '../../src/adapters/castai/castai-tools.js';
import { MockCastaiTools } from '../../src/adapters/castai/mock-castai-tools.js';

const ALL_TEN = [
  'list_clusters',
  'get_cluster_details',
  'get_cluster_savings',
  'get_cluster_cost',
  'get_cluster_nodes',
  'get_cluster_utilization',
  'get_workload_recommendations',
  'get_workload_autoscaler_status',
  'get_available_savings',
  'get_recent_optimization_actions',
];

test('READ_ONLY_TOOL_NAMES is a frozen list of exactly the 10 read-only tools', () => {
  assert.equal(Object.isFrozen(READ_ONLY_TOOL_NAMES), true);
  assert.equal(READ_ONLY_TOOL_NAMES.length, 10);
  assert.deepEqual([...READ_ONLY_TOOL_NAMES], ALL_TEN);
});

test('MockCastaiTools.call throws ToolNotAllowedError for delete_cluster (not in read-only list)', async () => {
  const mock = new MockCastaiTools();
  await assert.rejects(mock.call('delete_cluster', { clusterId: 'c-1' }), (err) => {
    assert.ok(err instanceof ToolNotAllowedError);
    assert.equal(err.name, 'ToolNotAllowedError');
    assert.equal(err.toolName, 'delete_cluster');
    return true;
  });
});

test('MockCastaiTools.call throws for any name outside the frozen list', async () => {
  const mock = new MockCastaiTools();
  for (const name of ['update_cluster', 'exec_command', 'list_secrets', '']) {
    await assert.rejects(mock.call(name), ToolNotAllowedError);
  }
  // mutation of the frozen list cannot smuggle a name in
  await assert.rejects(mock.call('delete_cluster'), ToolNotAllowedError);
});

test('MockCastaiTools returns fixture values and fixture functions of args', async () => {
  const mock = new MockCastaiTools({
    list_clusters: [{ id: 'c-1', name: 'prod' }],
    get_cluster_nodes: (args) => ({ clusterId: args.clusterId, nodes: ['n1', 'n2'] }),
  });
  const clusters = await mock.call('list_clusters', {});
  assert.deepEqual(clusters, [{ id: 'c-1', name: 'prod' }]);

  const nodes = await mock.call('get_cluster_nodes', { clusterId: 'c-9' });
  assert.deepEqual(nodes, { clusterId: 'c-9', nodes: ['n1', 'n2'] });
});

test('MockCastaiTools falls back to a sensible empty default and records calls', async () => {
  const mock = new MockCastaiTools();
  const list = await mock.call('list_clusters', {});
  assert.deepEqual(list, []);

  const details = await mock.call('get_cluster_details', { clusterId: 'c-1' });
  assert.deepEqual(details, {});

  assert.equal(mock.calls.length, 2);
  assert.deepEqual(
    { toolName: mock.calls[0].toolName, args: mock.calls[0].args },
    { toolName: 'list_clusters', args: {} },
  );
  assert.deepEqual({ toolName: mock.calls[1].toolName, args: mock.calls[1].args }, {
    toolName: 'get_cluster_details',
    args: { clusterId: 'c-1' },
  });
  assert.deepEqual(mock.calls[0].result, []);
});

test('rejected calls are not recorded', async () => {
  const mock = new MockCastaiTools();
  await assert.rejects(mock.call('delete_cluster'), ToolNotAllowedError);
  assert.equal(mock.calls.length, 0);
});
