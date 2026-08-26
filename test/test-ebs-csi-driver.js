'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = '/Users/eramadan/castai/scripts/ensure-ebs-csi-driver.sh';

// Stubs read STUB_DIR from the environment so the same stub source works
// from any temp directory the test allocates. Each stub is a self-contained
// bash script that knows how to fake the one or two subcommands the install
// script actually calls.

// Stub for the aws CLI.
const AWS_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  'case "$1 $2" in',
  '  "sts get-caller-identity")',
  '    exit 0',
  '    ;;',
  '  "iam get-role")',
  '    if [[ -f "$STUB_DIR/state-iam-role-created" ]]; then',
  '      echo "arn:aws:iam::123456789012:role/test-cluster-ebs-csi-driver"',
  '      exit 0',
  '    else',
  '      exit 254',
  '    fi',
  '    ;;',
  'esac',
  '# Default: empty output, success. Lets cf_stack_status / describe-stack-events',
  '# return empty strings, which the script treats as "no stack".',
  'exit 0',
].join('\n');

// Stub for the eksctl CLI.
const EKSCTL_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  'case "$1 $2" in',
  '  "get addon")',
  '    if [[ -f "$STUB_DIR/state-already-active" || -f "$STUB_DIR/state-addon-created" ]]; then',
  '      printf \'%s\\n\' \'[{"Name":"aws-ebs-csi-driver","Status":"ACTIVE"}]\'',
  '    else',
  '      printf \'%s\\n\' \'[]\'',
  '    fi',
  '    exit 0',
  '    ;;',
  '  "create iamserviceaccount")',
  '    touch "$STUB_DIR/state-iam-role-created"',
  '    exit 0',
  '    ;;',
  '  "create addon")',
  '    touch "$STUB_DIR/state-addon-created"',
  '    exit 0',
  '    ;;',
  'esac',
  'exit 0',
].join('\n');

// Stub for the kubectl CLI.
const KUBECTL_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  'if [[ "$1 $2" == "config current-context" ]]; then',
  '  if [[ -f "$STUB_DIR/state-no-context" ]]; then',
  '    exit 1',
  '  fi',
  '  echo "test-cluster"',
  '  exit 0',
  'fi',
  'if [[ "$1" == "get" && "$2" == "sa" ]]; then',
  '  if [[ -f "$STUB_DIR/state-iam-role-created" ]]; then',
  '    echo "arn:aws:iam::123456789012:role/test-cluster-ebs-csi-driver"',
  '    exit 0',
  '  else',
  '    exit 1',
  '  fi',
  'fi',
  'if [[ "$1" == "get" && "$2" == "pods" ]]; then',
  '  if [[ -f "$STUB_DIR/state-already-active" || -f "$STUB_DIR/state-addon-created" ]]; then',
  '    echo "ebs-csi-controller-pod-abc123"',
  '  fi',
  '  exit 0',
  'fi',
  'exit 0',
].join('\n');

const KUBECONFIG_BODY = [
  'apiVersion: v1',
  'kind: Config',
  'current-context: test-cluster',
  'clusters:',
  '- cluster:',
  '    server: https://test-cluster.eks.us-east-1.amazonaws.com',
  '  name: test-cluster',
  'contexts:',
  '- context:',
  '    cluster: test-cluster',
  '    user: test-user',
  '  name: test-cluster',
  'users:',
  '- name: test-user',
  '  user:',
  '    token: fake-token',
].join('\n');

// All stubs the script requires. Each test can request to omit one via the
// `skip` option in order to exercise the "missing binary" failure paths.
const ALL_STUBS = {
  aws: AWS_STUB,
  eksctl: EKSCTL_STUB,
  kubectl: KUBECTL_STUB,
};

function makeStubDir(opts = {}) {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebs-csi-stub-'));
  const skip = new Set(opts.skip || []);

  for (const [name, body] of Object.entries(ALL_STUBS)) {
    if (skip.has(name)) continue;
    const p = path.join(stubDir, name);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }

  // Drop a kubeconfig into the stub dir and point KUBECONFIG at it.
  const kubeconfig = path.join(stubDir, 'kubeconfig');
  fs.writeFileSync(kubeconfig, KUBECONFIG_BODY);

  if (opts.noContext) {
    fs.writeFileSync(path.join(stubDir, 'state-no-context'), '');
  }
  if (opts.alreadyActive) {
    fs.writeFileSync(path.join(stubDir, 'state-already-active'), '');
  }

  return { stubDir, kubeconfig };
}

function buildEnv(stubDir, kubeconfig, opts = {}) {
  // Start from the real PATH and strip out every directory that holds a
  // binary we want to be "missing". This handles machines where the same
  // binary lives in multiple PATH dirs (e.g. /usr/local/bin/kubectl AND
  // /opt/homebrew/bin/kubectl) - `which` only reports the first match, so
  // we scan every directory ourselves.
  const excluded = new Set(opts.excludeBinaries || []);
  const baseDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const filteredDirs = baseDirs.filter(d => {
    if (!excluded.size) return true;
    for (const bin of excluded) {
      try {
        const stat = fs.statSync(path.join(d, bin));
        if (stat.isFile()) return false;
      } catch (_) {
        // Binary not in this dir; keep looking.
      }
    }
    return true;
  });

  return {
    ...process.env,
    // stubDir FIRST so our stubs shadow any real binaries on PATH, but the
    // remaining dirs still allow unrelated tools (and the real `jq`) to be
    // found unless explicitly excluded.
    PATH: stubDir + path.delimiter + filteredDirs.join(path.delimiter),
    KUBECONFIG: kubeconfig,
    AWS_REGION: 'us-east-1',
    STUB_DIR: stubDir,
  };
}

function runScript(env, timeoutMs = 60_000) {
  return spawnSync('/bin/bash', [SCRIPT], {
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function cleanup(stubDir) {
  try {
    fs.rmSync(stubDir, { recursive: true, force: true });
  } catch (_) {
    // Best-effort cleanup; never mask a real assertion failure.
  }
}

// ---------------------------------------------------------------------------
// 1. Missing required binaries -> non-zero exit with clear [ERROR] messages.
// ---------------------------------------------------------------------------

test('missing aws CLI -> non-zero exit and [ERROR] message', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ skip: ['aws'] });
  t.after(() => cleanup(stubDir));

  const result = runScript(
    buildEnv(stubDir, kubeconfig, { excludeBinaries: ['aws'] })
  );

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status + ', stderr=' + result.stderr
  );
  assert.match(
    result.stderr,
    /\[ERROR\].*aws CLI is required/,
    'expected [ERROR] aws CLI message in stderr; got:\n' + result.stderr
  );
});

test('missing eksctl -> non-zero exit and [ERROR] message', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ skip: ['eksctl'] });
  t.after(() => cleanup(stubDir));

  const result = runScript(
    buildEnv(stubDir, kubeconfig, { excludeBinaries: ['eksctl'] })
  );

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status + ', stderr=' + result.stderr
  );
  assert.match(
    result.stderr,
    /\[ERROR\].*eksctl is required/,
    'expected [ERROR] eksctl message in stderr; got:\n' + result.stderr
  );
});

test('missing kubectl -> non-zero exit and [ERROR] message', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ skip: ['kubectl'] });
  t.after(() => cleanup(stubDir));

  const result = runScript(
    buildEnv(stubDir, kubeconfig, { excludeBinaries: ['kubectl'] })
  );

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status + ', stderr=' + result.stderr
  );
  assert.match(
    result.stderr,
    /\[ERROR\].*kubectl is required/,
    'expected [ERROR] kubectl message in stderr; got:\n' + result.stderr
  );
});

test('missing jq -> non-zero exit and [ERROR] message', (t) => {
  const { stubDir, kubeconfig } = makeStubDir();
  t.after(() => cleanup(stubDir));

  const result = runScript(
    buildEnv(stubDir, kubeconfig, { excludeBinaries: ['jq'] })
  );

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status + ', stderr=' + result.stderr
  );
  assert.match(
    result.stderr,
    /\[ERROR\].*jq is required/,
    'expected [ERROR] jq message in stderr; got:\n' + result.stderr
  );
});

// ---------------------------------------------------------------------------
// 2. No active kubectl context -> non-zero exit with a clear message.
// ---------------------------------------------------------------------------

test('no active kubectl context -> non-zero exit and [ERROR] message', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ noContext: true });
  t.after(() => cleanup(stubDir));

  const result = runScript(buildEnv(stubDir, kubeconfig));

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status + ', stderr=' + result.stderr
  );
  assert.match(
    result.stderr,
    /\[ERROR\].*No active kubectl context/,
    'expected [ERROR] "No active kubectl context" in stderr; got:\n' + result.stderr
  );
});

// ---------------------------------------------------------------------------
// 3. Addon already ACTIVE -> exit 0, no install attempt.
// ---------------------------------------------------------------------------

test('addon already ACTIVE -> exit 0, no install attempted', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ alreadyActive: true });
  t.after(() => cleanup(stubDir));

  const result = runScript(buildEnv(stubDir, kubeconfig));

  assert.strictEqual(
    result.status,
    0,
    'expected exit 0; got status=' + result.status + ', stderr=' + result.stderr
  );

  assert.match(
    result.stdout,
    /EBS CSI driver addon is already installed and ACTIVE/,
    'expected "already installed and ACTIVE" log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /EBS CSI driver pods running:/,
    'expected verify_pods log line; got stdout:\n' + result.stdout
  );

  const combined = (result.stdout || '') + (result.stderr || '');
  assert.doesNotMatch(
    combined,
    /Creating IRSA role/,
    'expected no IRSA creation when already ACTIVE; got output:\n' + combined
  );
  assert.doesNotMatch(
    combined,
    /Creating EBS CSI driver addon/,
    'expected no addon creation when already ACTIVE; got output:\n' + combined
  );

  // The eksctl stub writes a marker file when create iamserviceaccount /
  // create addon runs. Neither should have run on the already-active path.
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-iam-role-created')),
    false,
    'expected eksctl create iamserviceaccount NOT to be invoked'
  );
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-addon-created')),
    false,
    'expected eksctl create addon NOT to be invoked'
  );
});

// ---------------------------------------------------------------------------
// 4. First-time install path -> script creates IRSA SA and addon, exits 0.
// ---------------------------------------------------------------------------

test('first-time install creates IRSA service account, addon, and reaches ACTIVE', (t) => {
  const { stubDir, kubeconfig } = makeStubDir();
  t.after(() => cleanup(stubDir));

  const result = runScript(buildEnv(stubDir, kubeconfig));

  assert.strictEqual(
    result.status,
    0,
    'expected exit 0; got status=' + result.status +
      ', stderr=' + result.stderr + ', stdout=' + result.stdout
  );

  // The script's install path logs both creation steps before polling.
  assert.match(
    result.stdout,
    /Creating IRSA role/,
    'expected IRSA role creation log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Creating EBS CSI driver addon/,
    'expected addon creation log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /EBS CSI driver addon is ACTIVE/,
    'expected polling loop to observe ACTIVE; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /EBS CSI driver pods running:/,
    'expected verify_pods to find running pods; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /EBS CSI driver is ready\./,
    'expected success log line; got stdout:\n' + result.stdout
  );

  // Verify the stub markers prove both create commands actually fired.
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-iam-role-created')),
    true,
    'expected eksctl create iamserviceaccount to have run (state-iam-role-created missing)'
  );
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-addon-created')),
    true,
    'expected eksctl create addon to have run (state-addon-created missing)'
  );
});
