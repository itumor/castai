// Tests for the tool registry and the read-only tool handlers.
// Pure-JS so they need nothing but `npm install` (for chai) to run
// under mocha.

import { expect } from 'chai';

import {
  toolDefinitions,
  TOOL_NAMES,
  getToolDefinition,
  handlers,
  __internals
} from '../src/tools/index.js';

const EXPECTED_TOOLS = [
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
  // Approval gate + write-operation demonstration tools.
  'delete_cluster',
  'approve_operation',
  'invoke_approved_operation'
];

// ---------- registry shape ----------

describe('tool registry', () => {
  it('exposes exactly the 10 expected tools', () => {
    expect(EXPECTED_TOOLS).to.have.lengthOf(13);
    expect(TOOL_NAMES).to.have.lengthOf(13);
    for (const name of EXPECTED_TOOLS) {
      expect(TOOL_NAMES).to.include(name);
    }
  });

  it('defines every tool with name, description, inputSchema and handler', () => {
    for (const name of TOOL_NAMES) {
      const def = toolDefinitions[name];
      expect(def.name, `name on ${name}`).to.equal(name);
      expect(def.description, `description on ${name}`).to.be.a('string').and.not.empty;
      expect(def.inputSchema, `inputSchema on ${name}`).to.be.an('object');
      expect(def.inputSchema.type, `inputSchema.type on ${name}`).to.equal('object');
      expect(def.handler, `handler on ${name}`).to.be.a('function');
      expect(handlers[name], `handlers map entry for ${name}`).to.equal(def.handler);
    }
  });

  it('marks every shipped read-only tool as non-mutating', () => {
    for (const name of TOOL_NAMES) {
      if (name === 'delete_cluster') {
        expect(toolDefinitions[name].mutating, `${name} must be mutating`).to.equal(true);
        continue;
      }
      expect(toolDefinitions[name].mutating, `${name} must be read-only in step 2`).to.equal(false);
    }
  });

  it('requires clusterId on tools that target a specific cluster', () => {
    const perClusterTools = [
      'get_cluster_details',
      'get_cluster_savings',
      'get_cluster_cost',
      'get_cluster_nodes',
      'get_cluster_utilization',
      'get_workload_recommendations',
      'get_workload_autoscaler_status'
    ];
    for (const name of perClusterTools) {
      const required = toolDefinitions[name].inputSchema.required || [];
      expect(required, `${name} must require clusterId`).to.include('clusterId');
    }
  });

  it('getToolDefinition returns null for unknown tools', () => {
    expect(getToolDefinition('does_not_exist')).to.equal(null);
  });

  it('every tool has additionalProperties=false on its inputSchema', () => {
    for (const name of TOOL_NAMES) {
      expect(
        toolDefinitions[name].inputSchema.additionalProperties,
        `${name} should reject unknown input fields`
      ).to.equal(false);
    }
  });
});

// ---------- helpers ----------

function makeStubClient(responses) {
  // responses is an array of { path, query, result, error } objects.
  // Each call consumes the next one; mismatches throw.
  const calls = [];
  let i = 0;
  const get = async (path, opts = {}) => {
    calls.push({ path, query: opts.query || null });
    if (i >= responses.length) {
      throw new Error(`unexpected client.get(${path})`);
    }
    const expected = responses[i++];
    expect(path, `path on call ${i}`).to.equal(expected.path);
    if (expected.query !== undefined) {
      expect(opts.query, `query on call ${i}`).to.deep.equal(expected.query);
    }
    if (expected.error) {
      throw expected.error;
    }
    return expected.result;
  };
  return { get, calls };
}

// ---------- handlers ----------

describe('tool handlers', () => {
  it('list_clusters calls GET /v1/kubernetes/clusters with no query', async () => {
    const { get, calls } = makeStubClient([
      { path: '/v1/kubernetes/clusters', result: { items: [] } }
    ]);
    const res = await handlers.list_clusters({}, { client: { get } });
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].query).to.equal(null);
    expect(res.isError).to.equal(undefined);
    expect(res.content).to.have.lengthOf(1);
    expect(res.content[0].type).to.equal('text');
    expect(JSON.parse(res.content[0].text)).to.deep.equal({ items: [] });
  });

  const CLUSTER = '00000000-0000-0000-0000-000000000abc';

  const perClusterCases = [
    {
      name: 'get_cluster_details',
      path: `/v1/kubernetes/clusters/${CLUSTER}`,
      args: { clusterId: CLUSTER }
    },
    {
      name: 'get_cluster_savings',
      path: `/v1/kubernetes/clusters/${CLUSTER}/savings`,
      args: { clusterId: CLUSTER }
    },
    {
      name: 'get_cluster_nodes',
      path: `/v1/kubernetes/clusters/${CLUSTER}/nodes`,
      args: { clusterId: CLUSTER }
    },
    {
      name: 'get_cluster_utilization',
      path: `/v1/kubernetes/clusters/${CLUSTER}/utilization`,
      args: { clusterId: CLUSTER }
    },
    {
      name: 'get_workload_recommendations',
      path: `/v1/kubernetes/clusters/${CLUSTER}/workload-recommendations`,
      args: { clusterId: CLUSTER }
    },
    {
      name: 'get_workload_autoscaler_status',
      path: `/v1/kubernetes/clusters/${CLUSTER}/autoscaler`,
      args: { clusterId: CLUSTER }
    }
  ];

  for (const tc of perClusterCases) {
    it(`${tc.name} hits the expected endpoint with clusterId`, async () => {
      const { get, calls } = makeStubClient([
        { path: tc.path, result: { ok: true, tool: tc.name } }
      ]);
      const res = await handlers[tc.name](tc.args, { client: { get } });
      expect(calls).to.have.lengthOf(1);
      expect(res.content[0].type).to.equal('text');
      expect(JSON.parse(res.content[0].text)).to.deep.equal({ ok: true, tool: tc.name });
    });
  }

  it('get_cluster_cost hits /v1/cost-management/.../cost and forwards range=7d', async () => {
    const { get, calls } = makeStubClient([
      {
        path: `/v1/cost-management/clusters/${CLUSTER}/cost`,
        query: { range: '7d' },
        result: { total: 12.34 }
      }
    ]);
    const res = await handlers.get_cluster_cost(
      { clusterId: CLUSTER, range: '7d' },
      { client: { get } }
    );
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].query).to.deep.equal({ range: '7d' });
    expect(JSON.parse(res.content[0].text)).to.deep.equal({ total: 12.34 });
  });

  it('get_cluster_cost defaults range to 7d when not supplied', async () => {
    const { get, calls } = makeStubClient([
      {
        path: `/v1/cost-management/clusters/${CLUSTER}/cost`,
        query: { range: '7d' },
        result: { total: 0 }
      }
    ]);
    await handlers.get_cluster_cost({ clusterId: CLUSTER }, { client: { get } });
    expect(calls[0].query).to.deep.equal({ range: '7d' });
  });

  it('get_available_savings hits /v1/savings', async () => {
    const { get, calls } = makeStubClient([
      { path: '/v1/savings', result: { potential: 100 } }
    ]);
    const res = await handlers.get_available_savings({}, { client: { get } });
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].path).to.equal('/v1/savings');
    expect(JSON.parse(res.content[0].text)).to.deep.equal({ potential: 100 });
  });

  it('get_recent_optimization_actions scopes by clusterId when given', async () => {
    const { get, calls } = makeStubClient([
      {
        path: `/v1/kubernetes/clusters/${CLUSTER}/actions`,
        query: { limit: 10 },
        result: { items: [] }
      }
    ]);
    const res = await handlers.get_recent_optimization_actions(
      { clusterId: CLUSTER, limit: 10 },
      { client: { get } }
    );
    expect(calls[0].path).to.equal(`/v1/kubernetes/clusters/${CLUSTER}/actions`);
    expect(calls[0].query).to.deep.equal({ limit: 10 });
    expect(JSON.parse(res.content[0].text)).to.deep.equal({ items: [] });
  });

  it('get_recent_optimization_actions falls back to /v1/kubernetes/actions without clusterId', async () => {
    const { get, calls } = makeStubClient([
      {
        path: '/v1/kubernetes/actions',
        query: { limit: 50 },
        result: { items: ['a', 'b'] }
      }
    ]);
    const res = await handlers.get_recent_optimization_actions({}, { client: { get } });
    expect(calls[0].path).to.equal('/v1/kubernetes/actions');
    expect(calls[0].query).to.deep.equal({ limit: 50 });
    expect(JSON.parse(res.content[0].text)).to.deep.equal({ items: ['a', 'b'] });
  });

  it('handlers return isError=true when client.get throws, and redact secrets', async () => {
    const sentinelErr = new Error(
      'CAST AI GET /v1/kubernetes/clusters failed: 401 — Token castai_v1_supersecret'
    );
    const { get } = makeStubClient([{ path: '/v1/kubernetes/clusters', error: sentinelErr }]);
    const res = await handlers.list_clusters({}, { client: { get } });
    expect(res.isError).to.equal(true);
    expect(res.content[0].type).to.equal('text');
    expect(res.content[0].text).to.not.match(/castai_v1_supersecret/);
    expect(res.content[0].text).to.not.match(/Token castai_v1_/);
    expect(res.content[0].text).to.match(/401/);
  });

  it('handlers return isError=true with a safe message when clusterId is missing', async () => {
    const { get } = makeStubClient([]);
    const res = await handlers.get_cluster_details({}, { client: { get } });
    expect(res.isError).to.equal(true);
    expect(res.content[0].text).to.match(/clusterId is required/);
  });
});

// ---------- internal helpers ----------

describe('tool helpers', () => {
  it('formatSuccess returns pretty-printed JSON text', () => {
    const out = __internals.formatSuccess({ a: 1 });
    expect(out.content[0].type).to.equal('text');
    expect(out.content[0].text).to.equal('{\n  "a": 1\n}');
  });

  it('formatError redacts Token / Bearer / castai_v1_ credentials', () => {
    const out = __internals.formatError(
      new Error('upstream failed: Token abc123 and Bearer xyz and castai_v1_xyz')
    );
    expect(out.isError).to.equal(true);
    expect(out.content[0].text).to.match(/\[REDACTED\]/);
    expect(out.content[0].text).to.not.match(/abc123/);
    expect(out.content[0].text).to.not.match(/castai_v1_xyz/);
  });

  it('redactErrorMessage is idempotent on already-redacted strings', () => {
    const once = __internals.redactErrorMessage('Token [REDACTED]');
    const twice = __internals.redactErrorMessage(once);
    expect(twice).to.equal(once);
  });
});
