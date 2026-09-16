# CAST AI Cluster Token Rotation — E2E Harness

## Overview

This harness reproduces and verifies the fix for the token-rotation failure seen
on the `ngm-sim2-eks` cluster. In that incident, after the customer rotated
the CAST AI cluster token, the `castai-cluster-controller` deployment kept
using a stale token and started logging `401 Authorization Required`, which
degraded cluster connectivity.

The harness drives a real EKS cluster end-to-end:

1. Provisions a disposable EKS cluster.
2. Registers it with CAST AI and installs the CAST AI Helm chart in **full
   mode** (the chart configuration that the customer actually runs).
3. Creates **one Kubernetes secret per CAST AI component**, mirroring the
   `apiKeySecretRef` topology that caused the failure.
4. Rotates the cluster token via the CAST AI API and updates every
   per-component secret.
5. Restarts all CAST AI deployments and inspects their logs.
6. Asserts that **no component logs `401 Authorization Required`** after
   restart.

The same harness supports a **failure-simulation mode** that intentionally
skips updating one secret, proving the verification step catches the exact
`ngm-sim2-eks` symptom.

The intended outcome is a repeatable green/red signal that the rotation
procedure works before sharing the runbook with the customer, and a direct
evidence trail (Markdown report under `artifacts/`) when it does not.

## Prerequisites

Local tools:

- `aws` — AWS CLI v2
- `eksctl` — EKS cluster lifecycle
- `kubectl` — Kubernetes client
- `helm` — Helm v3
- `curl` — API calls
- `jq` — JSON parsing

Required environment variables:

| Variable | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS access key for the EKS account |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key |
| `CASTAI_API_KEY` | CAST AI API token |
| `CASTAI_API_BASE` | Must be `https://api.eu.cast.ai` |
| `CASTAI_ORG_ID` | UUID of the CAST AI organization |

The preflight step (`lib/preflight.sh`) verifies each of these is set and
that each tool is on `PATH` before any mutation runs.

## Safety / Approval Gate

`preflight.sh` enforces an explicit approval gate whenever the harness would
perform a live mutation against AWS, the CAST AI API, or the Kubernetes API.
The gate is opt-in by setting:

```bash
export APPROVE_LIVE_RUN=true
```

`APPROVE_LIVE_RUN=true` acknowledges that the run will:

- Create and delete an EKS cluster (CloudFormation stacks, EC2 nodes,
  IAM roles, OIDC provider, ELBs, EBS volumes).
- Register the cluster with CAST AI and delete the registration at the end.
- Create, patch, and delete Kubernetes secrets and restart CAST AI
  deployments in a Kubernetes cluster.

Live mode creates **real AWS resources** that incur cost and are visible in
the AWS account. Do not enable `APPROVE_LIVE_RUN` outside a controlled
E2E environment. Use `--dry-run` for review and CI checks; it does not
require the approval flag and does not touch any external system.

## Quick Start — Dry Run

```bash
./e2e/token-rotation/run.sh --dry-run
```

Dry-run mode forces `PREFLIGHT_OFFLINE=1`, prints every mutating command it
would execute, and writes a report to `e2e/token-rotation/artifacts/`. It is
safe to run locally without `APPROVE_LIVE_RUN`.

## Quick Start — Live Run

On a workstation with credentials and approval:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export CASTAI_API_KEY=...
export CASTAI_API_BASE=https://api.eu.cast.ai
export CASTAI_ORG_ID=...

export APPROVE_LIVE_RUN=true

./e2e/token-rotation/run.sh
```

The harness creates the cluster, installs CAST AI, rotates the token,
verifies the components, writes the report, and tears the cluster down by
default. Pass `--keep-cluster` to skip the AWS teardown step while keeping
the CAST AI registration and Kubernetes namespace cleanup best-effort.

To re-run only the rotation+verification steps against an existing cluster
state file (`artifacts/e2e-state.json`):

```bash
./e2e/token-rotation/run.sh --rotate-only
```

## Failure-Simulation Mode

```bash
./e2e/token-rotation/run.sh \
    --simulate-missed-secret=castai-cluster-controller-token
```

In failure-simulation mode, the rotation step updates every per-component
secret **except** the one named on the flag. That secret therefore keeps the
old token. After the restart sweep, `verify-components.sh` asserts that the
**expected** component logs `401 Authorization Required` and that all other
components are clean.

This proves two things:

1. The verification step can detect the exact `ngm-sim2-eks` symptom
   (`castai-cluster-controller` returning `401 Authorization Required`).
2. The rotation step is correct only when **every** secret is updated — a
   missed secret reproduces the customer's failure.

Failure-simulation mode is intended for use with the live harness. In dry-run
it logs the simulated outcome but cannot prove log-level symptom detection.

## What the Harness Does Step by Step

- Provisions a disposable EKS cluster (`eksctl create cluster`) in
  `eu-central-1` using `configs/e2e-token-rotation.yaml`.
- Registers the cluster with CAST AI using the cluster's IAM role and
  captures the cluster ID.
- Creates one Kubernetes secret per CAST AI component in namespace
  `castai-agent`, all populated with the initial token.
- Installs the CAST AI Helm chart in full mode with per-component
  `apiKeySecretRef` references.
- Calls `POST /v1/kubernetes/external-clusters/{clusterId}/token` to rotate
  the token and capture the new token value.
- Updates every per-component secret in place with the new token.
- Restarts every CAST AI deployment so pods pick up the updated secrets.
- Verifies rollout status and scans component logs for
  `401 Authorization Required`.
- Writes a Markdown report under `artifacts/`.
- Tears down the EKS cluster and deletes the CAST AI registration.

## Multi-Secret Topology

The `ngm-sim2-eks` failure happened because CAST AI components reference the
cluster token via individual `apiKeySecretRef` entries in the Helm values,
not via a single shared secret. When the customer rotated the token at the
CAST AI API and patched only the secrets their automation knew about, the
`castai-cluster-controller` secret was missed and that deployment kept using
the stale token.

To reproduce that surface, the harness installs the chart with **one
Kubernetes secret per component**:

- `castai-agent-token`
- `castai-cluster-controller-token`
- `castai-spot-handler-token`
- `castai-evictor-token`
- `castai-workload-autoscaler-token`

The post-install check (`castai-install.sh`) confirms via `helm get values`
that every secret above is referenced by an `apiKeySecretRef` in the
rendered chart. The rotation step iterates the same list; missing one would
re-create the `ngm-sim2-eks` symptom, which the failure-simulation mode
demonstrates directly.

## Production Runbook

For a real cluster, the equivalent rotation procedure is:

1. Call the CAST AI API to rotate the cluster token and capture the new
   token:

   ```bash
   curl -X POST \
       -H "X-API-Key: ${CASTAI_API_KEY}" \
       "${CASTAI_API_BASE}/v1/kubernetes/external-clusters/${CLUSTER_ID}/token"
   ```

2. Update **every** Kubernetes secret referenced by an `apiKeySecretRef`
   under the `castai-agent` namespace, replacing the `API_KEY` value with
   the new token. The full list on the customer chart is:
   - `castai-agent-token`
   - `castai-cluster-controller-token`
   - `castai-spot-handler-token`
   - `castai-evictor-token`
   - `castai-workload-autoscaler-token`
3. Restart all CAST AI deployments so pods re-mount the updated secrets:

   ```bash
   kubectl rollout restart deployment \
       -n castai-agent \
       castai-agent \
       castai-cluster-controller \
       castai-spot-handler \
       castai-evictor \
       workload-autoscaler
   ```

4. Verify cluster connectivity by tailing component logs for
   `401 Authorization Required` and confirming the CAST AI API reports the
   cluster as `ready`/`connected`:

   ```bash
   curl -H "X-API-Key: ${CASTAI_API_KEY}" \
       "${CASTAI_API_BASE}/v1/kubernetes/external-clusters/${CLUSTER_ID}"
   ```

If any component still logs `401 Authorization Required` after this
procedure, see the **Troubleshooting** section below.

## Cleanup / Token Hygiene

EKS cluster deletion is **best-effort**: the harness runs
`eksctl delete cluster` and then sweeps orphaned CloudFormation stacks, ELBs,
EBS volumes, and IAM roles tagged with the disposable marker. State required
for cleanup is written to `artifacts/e2e-state.json`.

The harness cannot guarantee that CAST AI will revoke the rotated token
synchronously, so a CAST AI org admin should review active tokens after the
run:

- List active tokens in the CAST AI console under the cluster's
  **Security** / **API tokens** tab.
- Revoke any token issued before the rotation that is no longer in use.
- Rotate the customer-side `CASTAI_API_KEY` used by CI if it was used in
  the harness run.

Local artifacts under `e2e/token-rotation/artifacts/` are git-ignored
(`.gitignore` excludes `artifacts/`, `logs/`, `*.env`, `kubeconfig*`, and
`*.tfstate*`). Do not commit them.

## Troubleshooting

If `401 Authorization Required` appears in a component's logs after
rotation:

1. **Missed secret.** Confirm every secret listed in the
   *Production Runbook* section above exists and was updated. The
   `castai-cluster-controller-token` secret is the most common miss on the
   `ngm-sim2-eks` topology.
2. **Wrong endpoint.** Confirm `CASTAI_API_BASE` matches the cluster's
   region. For EU clusters it must be `https://api.eu.cast.ai`; using the
   US endpoint will produce `401` even with a fresh token.
3. **Stale pod cache.** A deployment rollout may report `complete` before
   the new secret is mounted. Force a fresh rollout:

   ```bash
   kubectl rollout restart deployment/<component> -n castai-agent
   kubectl rollout status deployment/<component> -n castai-agent
   ```

4. **Helm values drift.** If a CI/CD pipeline reconciles the chart with a
   cached values file, it may rewrite `apiKeySecretRef` back to the wrong
   secret. Re-check `helm get values castai-agent -n castai-agent` and
   confirm each component references the secret list above.
5. **Token not actually rotated.** Call
   `POST /v1/kubernetes/external-clusters/{clusterId}/token` again and
   compare the response payload; an identical response means the rotation
   request was rejected (for example, due to a missing or invalid API key).

The harness's own report (`artifacts/report-*.md`) records the rotation
timestamp, the token-endpoint response status, and the per-component rollout
status; use it to pinpoint which step failed.

## Files in This Directory

| File | Purpose |
|---|---|
| `run.sh` | Entrypoint. Parses CLI flags, runs preflight, and orchestrates the cluster/CAST AI/rotation/verify/report/teardown phases. |
| `lib/logging.sh` | Logging helpers (`log_step`, `log_info`, `log_error`, ...). |
| `lib/preflight.sh` | Tool and environment-variable checks; enforces the `APPROVE_LIVE_RUN` gate. |
| `lib/cluster.sh` | EKS cluster lifecycle (create via `eksctl`, delete, sweep orphans). |
| `lib/castai-install.sh` | Cluster registration, per-component secret creation, Helm chart install, `apiKeySecretRef` verification. |
| `lib/rotate-token.sh` | Calls the CAST AI rotate-token endpoint, updates per-component secrets, supports the simulate-missed-secret mode. |
| `lib/verify-components.sh` | Restart sweep, rollout status, `401 Authorization Required` log scan. |
| `lib/report.sh` | Builds the Markdown report under `artifacts/`. |
| `configs/e2e-token-rotation.yaml` | `eksctl` ClusterConfig for the disposable EKS cluster. |
| `configs/castai-full-values.yaml` | Helm values used to install the CAST AI chart in full mode. |
| `configs/castai-agent-values-schema.yaml` | YAML reference snapshot of value paths used to verify the rendered chart values (dry-run only). |
| `configs/castai-chart-version.txt` | Pinned CAST AI chart version. |
| `tests/test-preflight.sh` | Unit tests for preflight checks. |
| `tests/test-cluster.sh` | Unit tests for cluster lifecycle helpers. |
| `tests/test-castai-install.sh` | Unit tests for CAST AI install helpers. |
| `tests/test-rotate-token.sh` | Unit tests for rotation helpers. |
| `tests/test-verify-components.sh` | Unit tests for verification helpers. |
| `tests/test-report.sh` | Unit tests for the report builder. |
| `.gitignore` | Excludes `artifacts/`, `logs/`, secrets, kubeconfigs, and Terraform state from version control. |
