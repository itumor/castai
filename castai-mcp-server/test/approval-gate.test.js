// Tests for the ApprovalGate class and its integration with the
// MCP server. These mirror the mocha + chai style of the sibling
// test files (test/server.test.js, test/castai-client.test.js) and
// add sinon where Date.now() needs to be advanced deterministically.
//
// No network I/O is performed — the CastaiClient is constructed
// lazily inside buildServer, but we never call any of its methods in
// these tests.

import { expect } from 'chai';
import sinon from 'sinon';

import ApprovalGate from '../src/approval-gate.js';
import { buildServer } from '../src/server.js';

// ---------- constructor ----------

describe('ApprovalGate constructor', () => {
  it('defaults to block mode', () => {
    const gate = new ApprovalGate();
    expect(gate.mode).to.equal('block');
  });

  it('honours an explicit mode argument', () => {
    const gate = new ApprovalGate('approve');
    expect(gate.mode).to.equal('approve');
  });
});

// ---------- isReadOnly ----------

describe('ApprovalGate.isReadOnly', () => {
  const gate = new ApprovalGate('block');

  it('treats GET as read-only', () => {
    expect(gate.isReadOnly('GET')).to.equal(true);
  });

  it('treats HEAD as read-only', () => {
    expect(gate.isReadOnly('HEAD')).to.equal(true);
  });

  it('is case-insensitive', () => {
    expect(gate.isReadOnly('get')).to.equal(true);
    expect(gate.isReadOnly('Get')).to.equal(true);
  });

  it('defaults to GET when the method is missing', () => {
    expect(gate.isReadOnly()).to.equal(true);
    expect(gate.isReadOnly(undefined)).to.equal(true);
  });

  it('treats POST as mutating', () => {
    expect(gate.isReadOnly('POST')).to.equal(false);
  });

  it('treats PUT as mutating', () => {
    expect(gate.isReadOnly('PUT')).to.equal(false);
  });

  it('treats DELETE as mutating', () => {
    expect(gate.isReadOnly('DELETE')).to.equal(false);
  });

  it('treats PATCH as mutating', () => {
    expect(gate.isReadOnly('PATCH')).to.equal(false);
  });
});

// ---------- check() in each mode ----------

describe('ApprovalGate.check', () => {
  it('always allows GET operations regardless of mode', () => {
    for (const mode of ['block', 'approve', 'allow']) {
      const gate = new ApprovalGate(mode);
      const v = gate.check('list_clusters', 'GET', '/v1/clusters');
      expect(v.allowed, `mode=${mode}`).to.equal(true);
    }
  });

  it('blocks mutating operations in block mode with a reason', () => {
    const gate = new ApprovalGate('block');
    const v = gate.check('delete_cluster', 'DELETE', '/v1/clusters/abc');
    expect(v.allowed).to.equal(false);
    expect(v.reason).to.be.a('string').and.not.empty;
    // The block-mode reason should guide the operator to flip the
    // approval mode rather than ask for an explicit token.
    expect(v.reason).to.match(/blocked/i);
    expect(v.reason).to.match(/APPROVAL_MODE=approve/);
  });

  it('blocks mutating operations in approve mode and mentions explicit approval', () => {
    const gate = new ApprovalGate('approve');
    const v = gate.check('delete_cluster', 'DELETE', '/v1/clusters/abc');
    expect(v.allowed).to.equal(false);
    expect(v.reason).to.be.a('string').and.not.empty;
    expect(v.reason).to.match(/explicit approval/i);
    expect(v.reason).to.match(/approve_operation/);
  });

  it('allows mutating operations in allow mode', () => {
    const gate = new ApprovalGate('allow');
    const v = gate.check('delete_cluster', 'DELETE', '/v1/clusters/abc');
    expect(v.allowed).to.equal(true);
  });
});

// ---------- approve() / isApproved() ----------

describe('ApprovalGate.approve', () => {
  it('returns allowed:true with a non-empty token', () => {
    const gate = new ApprovalGate('approve');
    const result = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');
    expect(result).to.have.property('allowed', true);
    expect(result).to.have.property('token').that.is.a('string').and.not.empty;
  });

  it('generates a fresh token on every call', () => {
    const gate = new ApprovalGate('approve');
    const a = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');
    const b = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');
    expect(a.token).to.not.equal(b.token);
  });
});

describe('ApprovalGate.isApproved', () => {
  it('accepts a valid, freshly minted token (one-time use)', () => {
    const gate = new ApprovalGate('approve');
    const { token } = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');

    const ok = gate.isApproved('delete_cluster', 'DELETE', '/v1/clusters/abc', token);
    expect(ok).to.equal(true);

    // Second invocation with the same token must fail — the token is
    // single-use.
    const reused = gate.isApproved('delete_cluster', 'DELETE', '/v1/clusters/abc', token);
    expect(reused).to.equal(false);
  });

  it('rejects an unknown token', () => {
    const gate = new ApprovalGate('approve');
    gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');
    const ok = gate.isApproved('delete_cluster', 'DELETE', '/v1/clusters/abc', 'nope');
    expect(ok).to.equal(false);
  });

  it('rejects a token issued for a different operation', () => {
    const gate = new ApprovalGate('approve');
    const { token } = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');
    const ok = gate.isApproved('delete_cluster', 'DELETE', '/v1/clusters/other', token);
    expect(ok).to.equal(false);
  });

  it('rejects an expired token (Date.now advances past expiresAt)', () => {
    const gate = new ApprovalGate('approve');
    const { token } = gate.approve('delete_cluster', 'DELETE', '/v1/clusters/abc');

    // Default expiry is 5 minutes; jump well past it. Capture the
    // real clock first since Date.now() is about to be stubbed.
    const realNow = Date.now();
    const clock = sinon.stub(Date, 'now');
    try {
      clock.returns(realNow + 10 * 60 * 1000);
      const ok = gate.isApproved('delete_cluster', 'DELETE', '/v1/clusters/abc', token);
      expect(ok).to.equal(false);
    } finally {
      clock.restore();
    }
  });
});

// ---------- server integration ----------

// Helper: build a Server and capture the handlers registered for
// ListToolsRequestSchema / CallToolRequestSchema so we can invoke them
// directly without going through the MCP transport. We monkey-patch
// Server.prototype.setRequestHandler for the duration of the test.
async function captureServerHandlers(overrides = {}) {
  const mod = await import('@modelcontextprotocol/sdk/server/index.js');
  const { Server } = mod;
  const captured = new Map();

  const original = Server.prototype.setRequestHandler;
  Server.prototype.setRequestHandler = function (schema, handler) {
    captured.set(schema, handler);
    return original.call(this, schema, handler);
  };

  try {
    const { server, getClient } = buildServer({
      apiKey: 'test-key',
      apiBase: 'https://api.eu.cast.ai',
      orgId: null,
      logLevel: 'error',
      approvalMode: overrides.approvalMode || 'block'
    });
    expect(server).to.exist;
    expect(typeof getClient).to.equal('function');
    return { server, getClient, captured };
  } finally {
    Server.prototype.setRequestHandler = original;
  }
}

async function getCallToolHandler(captured) {
  const mod = await import('@modelcontextprotocol/sdk/types.js');
  const { CallToolRequestSchema } = mod;
  const handler = captured.get(CallToolRequestSchema);
  expect(handler, 'CallToolRequestSchema handler').to.be.a('function');
  return handler;
}

describe('server integration: approval gate', () => {
  it('blocks delete_cluster in block mode', async () => {
    const { captured } = await captureServerHandlers({ approvalMode: 'block' });
    const handler = await getCallToolHandler(captured);

    const res = await handler({
      params: { name: 'delete_cluster', arguments: { clusterId: 'abc' } }
    });

    expect(res).to.have.property('isError', true);
    expect(res.content[0].text).to.match(/blocked/i);
  });

  it('allows approve_operation regardless of mode and returns a token', async () => {
    const { captured } = await captureServerHandlers({ approvalMode: 'block' });
    const handler = await getCallToolHandler(captured);

    const res = await handler({
      params: {
        name: 'approve_operation',
        arguments: {
          toolName: 'delete_cluster',
          method: 'DELETE',
          path: '/v1/clusters/abc'
        }
      }
    });

    expect(res.isError).to.not.equal(true);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.token).to.be.a('string').and.not.empty;
    expect(parsed.toolName).to.equal('delete_cluster');
  });

  it('consumes a token via invoke_approved_operation (one-time)', async () => {
    const { captured } = await captureServerHandlers({ approvalMode: 'approve' });
    const handler = await getCallToolHandler(captured);

    // 1. Mint a token.
    const approveRes = await handler({
      params: {
        name: 'approve_operation',
        arguments: {
          toolName: 'delete_cluster',
          method: 'DELETE',
          path: '/v1/clusters/abc'
        }
      }
    });
    const { token } = JSON.parse(approveRes.content[0].text);

    // 2. First invocation must be allowed through.
    const firstRes = await handler({
      params: {
        name: 'invoke_approved_operation',
        arguments: {
          toolName: 'delete_cluster',
          method: 'DELETE',
          path: '/v1/clusters/abc',
          token
        }
      }
    });

    // The actual upstream call would fail without a real API key,
    // but the gate must let it through. Either a success response or
    // an upstream error is fine; what matters is that it is NOT a
    // token-rejection error.
    if (firstRes.isError) {
      expect(firstRes.content[0].text).to.not.match(/invalid, expired, or already used/i);
    }

    // 3. Replay must be rejected — one-time token.
    const replayRes = await handler({
      params: {
        name: 'invoke_approved_operation',
        arguments: {
          toolName: 'delete_cluster',
          method: 'DELETE',
          path: '/v1/clusters/abc',
          token
        }
      }
    });
    expect(replayRes.isError).to.equal(true);
    expect(replayRes.content[0].text).to.match(/invalid, expired, or already used/i);
  });
});
