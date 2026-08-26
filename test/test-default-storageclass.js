'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = '/Users/eramadan/castai/ensure-default-storageclass.sh';
const SCRIPT_CWD = '/Users/eramadan/castai';

// ensure-default-storageclass.sh invokes the EBS CSI install script by
// a fixed absolute path under the repo root (${SCRIPT_DIR}/scripts/...),
// so PATH-shadowing cannot redirect that call. Instead, we install stubs
// for the four CLIs the EBS script invokes (aws, eksctl, kubectl, jq)
// so the real script succeeds against them. Real jq is fine because
// the eksctl stub outputs valid JSON.
//
// Each stub reads STUB_DIR from the environment so the same stub source
// works from any temp directory the test allocates.

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

// Stub for the eksctl CLI. We always make the addon report ACTIVE so the
// EBS script short-circuits via its "already installed" path -- this keeps
// tests fast and avoids any 10s polling loop.
const EKSCTL_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  'case "$1 $2" in',
  '  "get addon")',
  '    printf \'%s\\n\' \'[{"Name":"aws-ebs-csi-driver","Status":"ACTIVE"}]\'',
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
//
// Dispatch by argv because the storageclass script and the EBS CSI driver
// script share the same kubectl binary and call it with different verbs:
//   - config current-context     -> "test-cluster"
//   - get sa                     -> exit 1 (no IRSA annotation set)
//   - get pods                   -> a pod name (EBS verify_pods path)
//   - get storageclass -o <expr> -> SC name when state-default-exists, else ""
//   - get storageclass           -> exit 0 (final listing)
//   - apply -f -                 -> exit 0 (accept the heredoc)
const KUBECTL_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  '',
  'if [[ "$1 $2" == "config current-context" ]]; then',
  '  echo "test-cluster"',
  '  exit 0',
  'fi',
  '',
  'if [[ "$1" == "get" && "$2" == "sa" ]]; then',
  '  # No IRSA annotation on the SA; the EBS script then falls through to',
  '  # the IAM role lookup, which succeeds when state-iam-role-created exists.',
  '  exit 1',
  'fi',
  '',
  'if [[ "$1" == "get" && "$2" == "pods" ]]; then',
  '  # EBS verify_pods: emit a pod name so the script accepts the addon as',
  '  # healthy when state-already-active is set.',
  '  if [[ -f "$STUB_DIR/state-already-active" || -f "$STUB_DIR/state-addon-created" ]]; then',
  '    echo "ebs-csi-controller-pod-abc123"',
  '  fi',
  '  exit 0',
  'fi',
  '',
  'if [[ "$1" == "get" && "$2" == "storageclass" ]]; then',
  '  if [[ "${3:-}" == "-o" ]]; then',
  '    # jsonpath query for the default StorageClass name',
  '    if [[ -f "$STUB_DIR/state-default-exists" ]]; then',
  '      echo "gp3-default"',
  '    else',
  '      echo ""',
  '    fi',
  '    exit 0',
  '  fi',
  '  # Final "kubectl get storageclass" listing -- no output needed, just exit 0.',
  '  exit 0',
  'fi',
  '',
  'if [[ "$1" == "apply" ]]; then',
  '  # Accept the heredoc StorageClass manifest without parsing it.',
  '  exit 0',
  'fi',
  '',
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

const ALL_STUBS = {
  aws: AWS_STUB,
  eksctl: EKSCTL_STUB,
  kubectl: KUBECTL_STUB,
};

function makeStubDir(opts = {}) {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-stub-'));
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

  if (opts.defaultExists) {
    fs.writeFileSync(path.join(stubDir, 'state-default-exists'), '');
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
    cwd: SCRIPT_CWD,
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
// 1. Default StorageClass already exists -> exit 0 immediately, no work done.
// ---------------------------------------------------------------------------

test('default StorageClass already exists -> exit 0, no EBS call, no gp3 create', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ defaultExists: true });
  t.after(() => cleanup(stubDir));

  const result = runScript(buildEnv(stubDir, kubeconfig));

  assert.strictEqual(
    result.status,
    0,
    'expected exit 0; got status=' + result.status +
      ', stderr=' + result.stderr + ', stdout=' + result.stdout
  );

  // The script announces the short-circuit and names the existing class.
  assert.match(
    result.stdout,
    /Default StorageClass already set: gp3-default/,
    'expected "already set" log line naming the existing class; got stdout:\n' + result.stdout
  );

  // It must NOT have invoked the EBS CSI driver install script.
  const combined = (result.stdout || '') + (result.stderr || '');
  assert.doesNotMatch(
    combined,
    /Ensuring AWS EBS CSI driver is installed/,
    'expected no EBS install attempt when default already exists; got output:\n' + combined
  );
  assert.doesNotMatch(
    combined,
    /EBS CSI driver addon is already installed and ACTIVE/,
    'expected the EBS script to never run; got output:\n' + combined
  );
  assert.doesNotMatch(
    combined,
    /Creating gp3 default StorageClass/,
    'expected no gp3 creation when default already exists; got output:\n' + combined
  );

  // The eksctl stub writes a marker if "create addon" ever fires. It must
  // not have fired on the short-circuit path.
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-addon-created')),
    false,
    'expected eksctl create addon NOT to have run on short-circuit path'
  );
});

// ---------------------------------------------------------------------------
// 2. No default StorageClass -> script creates gp3 default and exits 0.
// ---------------------------------------------------------------------------

test('no default StorageClass -> script installs EBS driver stub then creates gp3 default', (t) => {
  // alreadyActive=true makes the real EBS script short-circuit via its
  // "already ACTIVE" path -- this still proves the storageclass script
  // called it (the stub markers would be missing otherwise) without
  // burning the default 600s polling budget.
  const { stubDir, kubeconfig } = makeStubDir({ alreadyActive: true });
  t.after(() => cleanup(stubDir));

  const result = runScript(buildEnv(stubDir, kubeconfig));

  assert.strictEqual(
    result.status,
    0,
    'expected exit 0; got status=' + result.status +
      ', stderr=' + result.stderr + ', stdout=' + result.stdout
  );

  // The script should report no default was found, then ensure the EBS
  // driver, then create the gp3 default class.
  assert.match(
    result.stdout,
    /No default StorageClass found/,
    'expected "No default StorageClass found" log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Ensuring AWS EBS CSI driver is installed\.\.\./,
    'expected EBS install kickoff log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /EBS CSI driver addon is already installed and ACTIVE/,
    'expected EBS short-circuit log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Creating gp3 default StorageClass\.\.\./,
    'expected gp3 create log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Verifying default StorageClass\.\.\./,
    'expected final verify log; got stdout:\n' + result.stdout
  );

  // The apply stub must have been invoked -- we detect it indirectly by
  // confirming the kubectl stub received an "apply" call. The simplest
  // signal is that the script reached "Verifying default StorageClass"
  // after the create step (kubectl apply runs between them).
  // Additionally, the EBS stub markers should NOT have been written,
  // because the eksctl stub short-circuits to ACTIVE without calling
  // "create addon".
  assert.strictEqual(
    fs.existsSync(path.join(stubDir, 'state-addon-created')),
    false,
    'expected eksctl create addon NOT to have run on the already-active path'
  );
});

// ---------------------------------------------------------------------------
// 3. Missing kubectl -> non-zero exit with an actionable [ERROR] message.
// ---------------------------------------------------------------------------

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
