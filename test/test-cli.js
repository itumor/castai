const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const SCRIPT = '/Users/eramadan/castai/scripts/ensure-eks-cluster.sh';

function run(args) {
  const result = spawnSync(SCRIPT, args, { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

test('no args prints usage and exits non-zero', () => {
  const r = run([]);
  assert.notStrictEqual(r.status, 0, 'expected non-zero exit');
  assert.match(r.output, /Usage:/);
});

test('start --dry-run prints create preview and exits 0', () => {
  const r = run(['start', '--dry-run']);
  assert.strictEqual(r.status, 0, 'expected zero exit');
  assert.match(r.output, /aws sts get-caller-identity/);
  assert.match(r.output, /eksctl create cluster/);
  assert.match(r.output, /kubectl get nodes/);
  assert.match(r.output, /start: would create cluster/);
});

test('stop --dry-run prints delete preview and exits 0', () => {
  const r = run(['stop', '--dry-run']);
  assert.strictEqual(r.status, 0, 'expected zero exit');
  assert.match(r.output, /aws sts get-caller-identity/);
  assert.match(r.output, /eksctl delete cluster/);
  assert.match(r.output, /kubectl config delete-context eks-08181-in/);
  assert.match(r.output, /stop: would delete cluster/);
});

test('invalid subcommand exits non-zero', () => {
  const r = run(['invalid']);
  assert.notStrictEqual(r.status, 0);
});

test('unknown flag exits non-zero', () => {
  const r = run(['start', '--foo']);
  assert.notStrictEqual(r.status, 0);
});
