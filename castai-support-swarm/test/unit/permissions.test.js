import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, assertAllowed, PermissionError } from '../../src/permissions.js';

const AGENT_KEYS = [
  'supervisor', 'triage', 'docs-researcher', 'sre-investigator',
  'cloud-security-engineer', 'reproduction-engineer', 'qa-engineer',
  'product-engineer', 'solution-architect', 'verifier', 'support-writer',
  'escalation-agent', 'knowledge-agent',
];

const ADAPTERS = ['castai', 'k8s', 'kb', 'sandbox', 'draft'];

describe('PERMISSIONS matrix', () => {
  test('has exactly the 13 specced agent keys', () => {
    assert.deepEqual(Object.keys(PERMISSIONS).sort(), [...AGENT_KEYS].sort());
  });

  test('every entry has all 5 adapters with a valid level', () => {
    const valid = new Set(['read', 'write-sandbox', 'write-draft', 'none']);
    for (const agent of AGENT_KEYS) {
      const entry = PERMISSIONS[agent];
      assert.ok(entry, `missing entry for ${agent}`);
      assert.deepEqual(Object.keys(entry).sort(), [...ADAPTERS].sort(), agent);
      for (const adapter of ADAPTERS) {
        assert.ok(valid.has(entry[adapter]), `${agent}.${adapter} invalid level '${entry[adapter]}'`);
      }
    }
  });

  test('supervisor: all none except kb read', () => {
    const s = PERMISSIONS['supervisor'];
    for (const a of ADAPTERS) assert.equal(s[a], a === 'kb' ? 'read' : 'none');
  });

  test('triage / docs-researcher: kb read only', () => {
    for (const agent of ['triage', 'docs-researcher']) {
      for (const a of ADAPTERS) assert.equal(PERMISSIONS[agent][a], a === 'kb' ? 'read' : 'none', agent);
    }
  });

  test('sre-investigator: castai read, k8s read, rest none', () => {
    const s = PERMISSIONS['sre-investigator'];
    assert.equal(s.castai, 'read');
    assert.equal(s.k8s, 'read');
    assert.equal(s.kb, 'none');
    assert.equal(s.sandbox, 'none');
    assert.equal(s.draft, 'none');
  });

  test('cloud-security-engineer: castai read, kb read, rest none', () => {
    const s = PERMISSIONS['cloud-security-engineer'];
    assert.equal(s.castai, 'read');
    assert.equal(s.kb, 'read');
    assert.equal(s.k8s, 'none');
    assert.equal(s.sandbox, 'none');
    assert.equal(s.draft, 'none');
  });

  test('reproduction-engineer: sandbox write-sandbox ONLY (no castai, no k8s)', () => {
    const s = PERMISSIONS['reproduction-engineer'];
    assert.equal(s.sandbox, 'write-sandbox');
    assert.equal(s.castai, 'none');
    assert.equal(s.k8s, 'none');
    assert.equal(s.kb, 'none');
    assert.equal(s.draft, 'none');
  });

  test('qa-engineer: sandbox write-sandbox', () => {
    const s = PERMISSIONS['qa-engineer'];
    assert.equal(s.sandbox, 'write-sandbox');
    assert.equal(s.castai, 'none');
    assert.equal(s.k8s, 'none');
    assert.equal(s.draft, 'none');
  });

  test('product-engineer / solution-architect: kb read, castai read', () => {
    for (const agent of ['product-engineer', 'solution-architect']) {
      assert.equal(PERMISSIONS[agent].kb, 'read', agent);
      assert.equal(PERMISSIONS[agent].castai, 'read', agent);
      assert.equal(PERMISSIONS[agent].k8s, 'none', agent);
    }
  });

  test('verifier: castai, k8s, kb all read (re-check capability)', () => {
    const s = PERMISSIONS['verifier'];
    assert.equal(s.castai, 'read');
    assert.equal(s.k8s, 'read');
    assert.equal(s.kb, 'read');
    assert.equal(s.sandbox, 'none');
    assert.equal(s.draft, 'none');
  });

  test('support-writer: draft write-draft only (no castai, k8s, kb, sandbox)', () => {
    const s = PERMISSIONS['support-writer'];
    assert.equal(s.draft, 'write-draft');
    assert.equal(s.castai, 'none');
    assert.equal(s.k8s, 'none');
    assert.equal(s.kb, 'none');
    assert.equal(s.sandbox, 'none');
  });

  test('escalation-agent / knowledge-agent: kb read', () => {
    for (const agent of ['escalation-agent', 'knowledge-agent']) {
      for (const a of ADAPTERS) assert.equal(PERMISSIONS[agent][a], a === 'kb' ? 'read' : 'none', agent);
    }
  });
});

describe('assertAllowed', () => {
  test('accept (3): sre-investigator k8s read passes', () => {
    assert.doesNotThrow(() => assertAllowed('sre-investigator', 'k8s', 'read'));
  });

  test('accept (2): support-writer castai read throws PermissionError naming agent+adapter+operation', () => {
    assert.throws(
      () => assertAllowed('support-writer', 'castai', 'read'),
      (err) => {
        assert.ok(err instanceof PermissionError, 'must be PermissionError');
        assert.ok(err.message.includes('support-writer'), 'names agent');
        assert.ok(err.message.includes('castai'), 'names adapter');
        assert.ok(err.message.includes('read'), 'names operation');
        return true;
      }
    );
  });

  test('reproduction-engineer may write sandbox but not castai/k8s', () => {
    assert.doesNotThrow(() => assertAllowed('reproduction-engineer', 'sandbox', 'write-sandbox'));
    assert.throws(() => assertAllowed('reproduction-engineer', 'castai', 'read'), PermissionError);
    assert.throws(() => assertAllowed('reproduction-engineer', 'k8s', 'read'), PermissionError);
  });

  test('level sufficiency table: read < write-sandbox < write-draft, none < nothing', () => {
    // 'read' level satisfies only 'read'
    assert.doesNotThrow(() => assertAllowed('docs-researcher', 'kb', 'read'));
    // 'write-sandbox' satisfies 'read' and 'write-sandbox' — qa-engineer sandbox
    assert.doesNotThrow(() => assertAllowed('qa-engineer', 'sandbox', 'read'));
    assert.doesNotThrow(() => assertAllowed('qa-engineer', 'sandbox', 'write-sandbox'));
    // 'write-draft' satisfies 'read' and 'write-draft' — support-writer draft
    assert.doesNotThrow(() => assertAllowed('support-writer', 'draft', 'read'));
    assert.doesNotThrow(() => assertAllowed('support-writer', 'draft', 'write-draft'));
    // 'none' satisfies nothing
    assert.throws(() => assertAllowed('supervisor', 'castai', 'read'), PermissionError);
    // 'write-sandbox' does NOT satisfy 'write-draft' and vice versa
    assert.throws(() => assertAllowed('qa-engineer', 'sandbox', 'write-draft'), PermissionError);
    assert.throws(() => assertAllowed('support-writer', 'draft', 'write-sandbox'), PermissionError);
  });

  test('unknown agent key throws PermissionError', () => {
    assert.throws(
      () => assertAllowed('no-such-agent', 'castai', 'read'),
      (err) => err instanceof PermissionError && err.message.includes('no-such-agent')
    );
  });

  test('unknown adapter name throws PermissionError', () => {
    assert.throws(
      () => assertAllowed('docs-researcher', 'email', 'read'),
      (err) => err instanceof PermissionError && err.message.includes('email')
    );
  });
});
