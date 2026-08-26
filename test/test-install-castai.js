'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = '/Users/eramadan/castai/scripts/install-castai.sh';
const SCRIPT_CWD = '/Users/eramadan/castai';

// install-castai.sh runs as follows:
//   1. `command -v castctl` -- bail with [ERROR] if missing.
//   2. ensure-ebs-csi-driver.sh (absolute, from ${SCRIPT_DIR}).
//   3. ../ensure-default-storageclass.sh (absolute, from ${PROJECT_ROOT}).
//   4. `castctl install "$@"`.
//
// Steps 2 and 3 call the real scripts (which in turn call real aws/eksctl/
// kubectl/jq). We stub those four binaries so the install paths short-circuit
// cheaply and never touch AWS. The castctl binary itself is either stubbed
// (success path) or omitted entirely (missing-binary path).

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

// Stub for the kubectl CLI. Must handle every verb the EBS CSI driver
// script AND the default-storageclass script invoke:
//
//   - config current-context     -> "test-cluster"
//   - get sa                     -> exit 1 (no IRSA annotation)
//   - get pods ...               -> pod name when state-already-active set
//   - get storageclass -o <expr> -> "" (no default) so SC script creates gp3
//   - get storageclass           -> exit 0 (final listing)
//   - apply -f -                 -> exit 0 (accept heredoc)
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
  '  exit 1',
  'fi',
  '',
  'if [[ "$1" == "get" && "$2" == "pods" ]]; then',
  '  if [[ -f "$STUB_DIR/state-already-active" ]]; then',
  '    echo "ebs-csi-controller-pod-abc123"',
  '  fi',
  '  exit 0',
  'fi',
  '',
  'if [[ "$1" == "get" && "$2" == "storageclass" ]]; then',
  '  if [[ "${3:-}" == "-o" ]]; then',
  '    # jsonpath query for the default StorageClass name. Empty = none yet.',
  '    echo ""',
  '    exit 0',
  '  fi',
  '  # Final listing: print one line so the script has something to display.',
  '  echo "NAME               PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE"',
  '  echo "gp3-default        ebs.csi.aws.com         Delete          WaitForFirstConsumer   true                   1s"',
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

// Stub for the castctl CLI. Records every arg to a file so the test can
// verify the wrapper passed them through unchanged.
const CASTCTL_STUB = [
  '#!/bin/bash',
  'STUB_DIR="${STUB_DIR:?STUB_DIR must be set}"',
  '# Write each arg on its own line; trailing newline only if any args present.',
  ': > "$STUB_DIR/state-castctl-args"',
  'for arg in "$@"; do',
  '  printf \'%s\\n\' "$arg" >> "$STUB_DIR/state-castctl-args"',
  'done',
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
  castctl: CASTCTL_STUB,
};

function makeStubDir(opts = {}) {
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-castai-stub-'));
  const skip = new Set(opts.skip || []);

  for (const [name, body] of Object.entries(ALL_STUBS)) {
    if (skip.has(name)) continue;
    const p = path.join(stubDir, name);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }

  const kubeconfig = path.join(stubDir, 'kubeconfig');
  fs.writeFileSync(kubeconfig, KUBECONFIG_BODY);

  if (opts.alreadyActive) {
    fs.writeFileSync(path.join(stubDir, 'state-already-active'), '');
  }

  return { stubDir, kubeconfig };
}

function buildEnv(stubDir, kubeconfig, opts = {}) {
  // Strip every PATH directory that holds a binary we want to be "missing".
  // This handles machines where the same binary lives in multiple PATH dirs
  // (e.g. /usr/local/bin/kubectl AND /opt/homebrew/bin/kubectl) - `which`
  // only reports the first match, so we scan every directory ourselves.
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

function runScript(env, args = [], timeoutMs = 60_000) {
  return spawnSync('/bin/bash', [SCRIPT, ...args], {
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
// 1. Missing castctl -> non-zero exit with clear [ERROR] message.
// ---------------------------------------------------------------------------

test('missing castctl -> non-zero exit and [ERROR] message', (t) => {
  // Skip the castctl stub AND filter any system-installed castctl from PATH
  // so `command -v castctl` fails for real.
  const { stubDir, kubeconfig } = makeStubDir({ skip: ['castctl'] });
  t.after(() => cleanup(stubDir));

  const result = runScript(
    buildEnv(stubDir, kubeconfig, { excludeBinaries: ['castctl'] })
  );

  assert.notStrictEqual(
    result.status,
    0,
    'expected non-zero exit; got status=' + result.status +
      ', stderr=' + result.stderr + ', stdout=' + result.stdout
  );
  // The script uses `command -v castctl` and prints to stderr.
  assert.match(
    result.stderr,
    /\[ERROR\].*castctl is required but not found in PATH/,
    'expected [ERROR] castctl message in stderr; got:\n' + result.stderr
  );

  // The script bails on the very first check, before either prerequisite
  // script runs. Neither the EBS CSI driver nor the storageclass script
  // should have produced output.
  const combined = (result.stdout || '') + (result.stderr || '');
  assert.doesNotMatch(
    combined,
    /Step 1\/3: Ensuring AWS EBS CSI driver/,
    'expected the wrapper to bail before invoking ensure-ebs-csi-driver.sh; got:\n' + combined
  );
  assert.doesNotMatch(
    combined,
    /Step 2\/3: Ensuring default StorageClass/,
    'expected the wrapper to bail before invoking ensure-default-storageclass.sh; got:\n' + combined
  );
  assert.doesNotMatch(
    combined,
    /Step 3\/3: Running castctl install/,
    'expected the wrapper to bail before invoking castctl install; got:\n' + combined
  );
});

// ---------------------------------------------------------------------------
// 2. Happy path -> wrapper passes extra args through to `castctl install`.
// ---------------------------------------------------------------------------

test('wrapper passes extra args through to castctl install exactly', (t) => {
  const { stubDir, kubeconfig } = makeStubDir({ alreadyActive: true });
  t.after(() => cleanup(stubDir));

  // Distinctive args -- including one with a value that contains a hyphen,
  // to confirm quoting is preserved (the wrapper uses `castctl install "$@"`).
  const extraArgs = [
    '--cluster-id', 'cluster-abc-123',
    '--region', 'us-east-1',
    '--log-level', 'debug',
  ];

  const result = runScript(buildEnv(stubDir, kubeconfig), extraArgs);

  assert.strictEqual(
    result.status,
    0,
    'expected exit 0; got status=' + result.status +
      ', stderr=' + result.stderr + ', stdout=' + result.stdout
  );

  // The wrapper should announce each prerequisite step before invoking castctl.
  assert.match(
    result.stdout,
    /Step 1\/3: Ensuring AWS EBS CSI driver/,
    'expected EBS step log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Step 2\/3: Ensuring default StorageClass/,
    'expected StorageClass step log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /Step 3\/3: Running castctl install/,
    'expected castctl step log; got stdout:\n' + result.stdout
  );
  assert.match(
    result.stdout,
    /castctl install complete\./,
    'expected completion log; got stdout:\n' + result.stdout
  );

  // Verify the castctl stub received the args in the expected order.
  // The wrapper invokes `castctl install "$@"`, so argv[1] is the literal
  // "install" verb and argv[2..] are the user-supplied args.
  const argsFile = path.join(stubDir, 'state-castctl-args');
  assert.strictEqual(
    fs.existsSync(argsFile),
    true,
    'expected castctl stub to have written state-castctl-args; got stdout:\n' +
      result.stdout + '\nstderr:\n' + result.stderr
  );

  const recorded = fs.readFileSync(argsFile, 'utf8');
  // Castctl stub writes one arg per line. Splitting on '\n' and dropping the
  // trailing empty entry from the final newline gives the exact argv list.
  const argv = recorded.split('\n').filter((s) => s.length > 0);

  const expectedArgv = ['install', ...extraArgs];
  assert.deepStrictEqual(
    argv,
    expectedArgv,
    'expected castctl to receive exactly [install, ...extraArgs]; got:\n' +
      JSON.stringify(argv) + '\nrecorded file:\n' + recorded
  );
});
