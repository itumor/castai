# kOps + Karpenter Lab — Agent Status

This file tracks the kOps + Karpenter hands-on lab. It is a status document for
agents and humans working in this repo: what the lab is, what decisions are
already scoped, and which phase is currently in progress.

## Lab Title and Goal

**Title:** kOps + Karpenter Hands-On Lab

**Goal:** Provision a Kubernetes cluster on AWS using **kOps**, install **Karpenter**
via kOps's managed addon, and exercise Karpenter autoscaling end-to-end
(NodePool / EC2NodeClass / workloads / consolidation / spot). The lab is a
self-contained, repeatable path that complements — and does not replace — the
existing EKSctl-based Karpenter lab at the repository root.

## Scoped Decisions

These choices are locked in for the lab and are not changed without an explicit
update to `labs/kops-karpenter/COMPATIBILITY.md` and this status file.

- **Region:** `eu-central-1` (Frankfurt).
- **Cluster topology:** **None-DNS** (`.k8s.local`, no gossip). See
  `labs/kops-karpenter/COMPATIBILITY.md` for the rationale.
- **Spot instances:** **Enabled** — Karpenter is configured to provision spot
  capacity by default, with on-demand as a fallback.
- **Cost controls:**
  - Spot preferred for `NodePool` capacity types.
  - Consolidation policy set to delete/replace underutilized nodes.
  - TTL/limits on NodePool capacity to prevent runaway scaling.
  - Lab is torn down (`kops delete cluster --yes`) at the end of each run
    unless an explicit keep is requested.
- **Provision mode:** kOps-managed cluster, Karpenter installed as a kOps
  managed addon (not a manual Helm release). kOps owns upgrades of the
  controller; lab exercises upgrades via `kops rolling-update cluster`.

## Current Phase

**Phase 3 — Karpenter scenario scripts + final guide & cleanup** (in progress; steps 1, 2, 3 completed)

Deliverables for this phase:
- `labs/kops-karpenter/bin/scenario-a.sh` through `scenario-e.sh` — short
  stable wrapper scripts that delegate to the implementation scripts
  (`scenario-a-provision.sh`, `scenario-b-scale-up.sh`,
  `scenario-c-scale-down.sh`, `scenario-d-constraints.sh`,
  `scenario-e-spot.sh`). All wrappers are executable and shellcheck-clean.
  **Done (Phase 3, step 1).**
- `labs/kops-karpenter/manifests/inflate-workload.yaml` — minimal pause
  Deployment (200m / 256Mi) that the scenarios scale to exercise
  provisioning (5, 15) and consolidation (1). Tolerates the
  `karpenter-lab/workload=true:NoSchedule` taint and prefers the lab
  workload node label. **Done (Phase 3, step 1).**
- `labs/kops-karpenter/output/scenario-README.md` — explains what each
  scenario does and notes that live execution is blocked by the AWS VPC
  quota documented in Phase 2 step 2. **Done (Phase 3, step 1).**

### Phase 3 Step Status

- Step 1 — Scenario scripts + inflate manifest + output README:
  **completed.** Files added:
  - `labs/kops-karpenter/bin/scenario-a.sh` (wrapper for `scenario-a-provision.sh`)
  - `labs/kops-karpenter/bin/scenario-b.sh` (wrapper for `scenario-b-scale-up.sh`)
  - `labs/kops-karpenter/bin/scenario-c.sh` (wrapper for `scenario-c-scale-down.sh`)
  - `labs/kops-karpenter/bin/scenario-d.sh` (wrapper for `scenario-d-constraints.sh`)
  - `labs/kops-karpenter/bin/scenario-e.sh` (wrapper for `scenario-e-spot.sh`)
  - `labs/kops-karpenter/manifests/inflate-workload.yaml`
  - `labs/kops-karpenter/output/scenario-README.md`

  Live scenario execution against the cluster is deferred: the Phase 2
  step 2 VPC quota block prevents `kops update cluster --yes` from
  finishing, so no API endpoint is reachable and every scenario script
  records the missing-context failure mode and exits 1. The scripts
  themselves pass `bash -n` and `shellcheck labs/kops-karpenter/bin/scenario-*.sh`.

- Step 2 — Failure lab + observability helper: **completed.** Files
  added:
  - `labs/kops-karpenter/bin/observe.sh` — observability helper.
    Sources AWS creds via the shared `_lib-source-env.sh` helper, sets
    the kubectl context to the kOps cluster via `kops export
    kubeconfig`, then captures kOps state, node list, karpenter pod
    list, karpenter events, NodePool/EC2NodeClass list, NodeClaim
    list (cluster-wide), and the Karpenter controller's tail logs
    (skipped if the deployment does not exist). All sections run
    inside `run_section` so a broken API endpoint still produces a
    log file with partial output. Writes to
    `labs/kops-karpenter/output/observe.log`. Supports `--quiet` and
    `--output-dir`. Passes `bash -n` and
    `shellcheck -x labs/kops-karpenter/bin/observe.sh`.
  - `labs/kops-karpenter/bin/scenario-f-failure.sh` — failure-lab
    script. Documents the four failure modes the lab has actually
    hit (impossible instance family / no matching capacity; VPC
    quota exceeded in eu-central-1; control-plane API timeout in
    us-west-2; missing IAM permission) in the log header, then
    probes kubectl reachability with a 10s client-side timeout and
    either applies `manifests/impossible-nodepool.yaml` plus a
    synthetic `impossible-workload` Deployment and watches for
    pending pods / `NodeClaimNotLaunched` events for the configured
    watch window, or captures the live API timeout error and skips
    the live apply. Writes to
    `labs/kops-karpenter/output/scenario-f.log`. Passes `bash -n`
    and `shellcheck -x labs/kops-karpenter/bin/scenario-f-failure.sh`.
  - `labs/kops-karpenter/manifests/impossible-nodepool.yaml` —
    Karpenter v1 NodePool with
    `karpenter.k8s.aws/instance-family=doesnotexist`, the trigger
    for the synthetic failure. Comments document why the failure
    mode is real (valid YAML, no candidates) and what the matching
    event looks like.
  - `labs/kops-karpenter/output/scenario-f.log` — produced by
    running `scenario-f-failure.sh`. Captures the API-timeout
    failure mode end-to-end: kubectl context is set to
    `kops-karpenter-lab.k8s.local` by `kops export kubeconfig`,
    the live `kubectl get pods` call hangs for the full 10s
    client-side timeout, and the error is recorded verbatim. The
    synthetic impossible-NP branch is exercised when the cluster
    becomes reachable.

- Step 3 — Final guide + cleanup script + teardown: **completed.**
  Files added:
  - `labs/kops-karpenter/GUIDE.md` — comprehensive practical lab
    guide. Sections: title + goal, ASCII architecture diagram
    (kOps-managed cluster, None-DNS, Cilium, IRSA, Karpenter
    managed addon, Karpenter-managed InstanceGroup, system-node
    ASG), compatibility reference to `COMPATIBILITY.md`,
    prerequisites (kOps 1.36.x, kubectl, AWS CLI, `.env` credentials,
    account `050451381948`, `us-west-2`), directory layout,
    step-by-step commands (bootstrap, create, validate, apply
    manifests, run scenarios A–F, observe), manifest reference
    (`cluster-spec.yaml`, `inflate-workload.yaml`,
    `example-nodepool.yaml`, `example-ec2nodeclass.yaml`,
    `impossible-nodepool.yaml`), per-step explanation of what
    Karpenter does (provisioning, scale-up, scale-down /
    consolidation, constraints, spot), expected outputs for each
    scenario, the Pod → NodeClaim → EC2 → Node → Pod lifecycle,
    kubectl cheat sheet, troubleshooting (VPC quota in
    `eu-central-1`, control-plane API timeout / NLB unhealthy,
    `artifacts.k8s.io` download timeouts, Karpenter controller not
    ready, NodeClaim stuck in `NotLaunched`, cleanup didn't free
    resources), cost safety + `cleanup.sh` usage, and links to the
    official kOps and Karpenter docs.
  - `labs/kops-karpenter/bin/cleanup.sh` — cost-safety teardown.
    Sources `.env` via `_lib-source-env.sh`, defaults region to
    `us-west-2` and cluster name to `kops-karpenter-lab.k8s.local`,
    supports `--dry-run` (prints the plan and exits) and `--yes`
    (non-interactive). Apply mode: idempotently calls
    `kops delete cluster --name ... --state ... --yes`, then
    `aws s3 rb s3://<state> --force` and `aws s3 rb
    s3://<discovery> --force`. Tolerates `kops delete cluster`
    errors when the cluster is already gone and tolerates missing
    buckets. Passes `bash -n` and is shellcheck-clean. Logs to
    `output/cleanup.log`. Verified via
    `./labs/kops-karpenter/bin/cleanup.sh --dry-run` (plan printed,
    no resources modified).
  - `labs/kops-karpenter/output/cleanup.log` — produced by the
    cleanup run. Records the plan, the `kops delete cluster`
    invocation and progress, the S3 bucket deletions, and a
    verification section confirming the cluster is gone from the
    state store and both buckets no longer exist.

  **Cleanup completion confirmed (Phase 3 step 3, post-run):**
  - `cleanup.sh` + `kops delete cluster` finished after ~3
    minutes; process tree cleared.
  - `kops get cluster` against the state bucket returns 404
    (state bucket itself is gone).
  - `aws s3 ls` shows no `kops-karpenter-lab*` buckets in
    `us-west-2`.
  - `cleanup.log` ends with `cluster: not found in state store
    (expected).`, `state bucket: gone (expected).`,
    `discovery bucket: gone (expected).`, and
    `Cleanup complete: labs/kops-karpenter/output/cleanup.log`.

The ferment is **complete** after Phase 3 step 3. No AWS resources
tagged `cleanup=true` remain in `us-west-2` for the lab, and the
state/discovery buckets are deleted.

## Phase 2 — Cluster provisioning (in progress)

Deliverables for this phase:
- `labs/kops-karpenter/bin/create-cluster.sh` — idempotent kOps cluster
  provisioning (state buckets, kops create -f, kops update cluster,
  kops validate cluster, kops export kubeconfig) with a `--dry-run`
  flag. **Done (Phase 2, step 1).**
- `labs/kops-karpenter/bin/validate-cluster.sh` — diagnostic snapshot
  of kOps/Kubernetes/Karpenter state captured to
  `labs/kops-karpenter/output/validate-cluster.log`. Supports `--quiet`
  and `--output-dir`. **Done (Phase 2, step 1).**
- (Future) IRSA, IAM, and networking prerequisites surfaced and applied
  by `create-cluster.sh` ahead of `kops update cluster`.

### Phase 2 Step Status

- Step 1 — `create-cluster.sh` + `validate-cluster.sh` scripts:
  **completed.** Files added:
  - `labs/kops-karpenter/bin/create-cluster.sh`
  - `labs/kops-karpenter/bin/validate-cluster.sh`
  - No AWS resources were created in this step (scripts are written
    and syntax-checked only).

- Step 2 — Provision the kOps cluster and verify Karpenter is installed:
  **PARTIAL — panic root cause FIXED; provisioning BLOCKED on AWS VPC quota.**

  **Diagnosis (panic root cause):**
  `validation/validation.go:305` in kOps 1.36.2 dereferences
  `spec.IAM.UseServiceAccountExternalPermissions` unconditionally when
  `spec.Karpenter.Enabled == true`. With no `spec.iam` block declared,
  `spec.IAM` is nil and the dereference panics.

  **Fix applied to `labs/kops-karpenter/cluster-spec.yaml`:**
  - Added `spec.iam.useServiceAccountExternalPermissions: true` so
    `spec.IAM` is non-nil and Karpenter's IRSA requirement is satisfied.
  - Aligned all subnet/zone CIDRs with kOps's default
    `networkCIDR 172.20.0.0/16` (the original 10.10.0.0/20 ranges
    were outside the VPC kOps was about to create).
  - Added `spec.etcdClusters` for `main` and `events` (single-member,
    `provider: Manager`, hosted on the control-plane InstanceGroup).
  - Removed the reserved `kops.k8s.io/manager` label from the
    Karpenter-managed InstanceGroup's `cloudLabels` (kOps rejects it).

  **Script changes:**
  - `labs/kops-karpenter/bin/create-cluster.sh` and
    `labs/kops-karpenter/bin/bootstrap-state-store.sh` now source
    `.env` from the repo root when AWS credentials are not already
    exported. The shared `_lib-source-env.sh` helper sources the
    file in an isolated subshell and forwards only the AWS
    allow-list variables, so non-AWS secrets (CAST AI tokens) stay
    out of the script environment. Explicit env vars always win.
  - `create-cluster.sh` strips the `s3://` scheme from
    `KOPS_STATE_STORE` / `KOPS_DISCOVERY_STORE` before invoking the
    bootstrap script (which expects bare bucket names).

  **`kops create -f` now succeeds:**
  ```
  Created cluster/kops-karpenter-lab.k8s.local
  Created instancegroup/control-plane-eu-central-1a
  Created instancegroup/system-nodes
  Created instancegroup/karpenter-nodes
  ```

  **Provisioning BLOCKED on AWS account VPC quota.**
  `kops update cluster --yes` ran and issued all certs, then failed
  repeatedly with:
  ```
  error creating VPC: ... api error VpcLimitExceeded:
  The maximum number of VPCs has been reached.
  ```
  Account `050451381948` already has 5 VPCs in `eu-central-1`
  (1 default + 4 EKS/legacy), hitting the per-region VPC quota.
  The lab spec instructs kOps to create a fresh VPC; that quota must
  be raised (or an unused VPC reused via `spec.networking.id`) before
  provisioning can complete. Karpenter object captures and the
  validate-cluster.sh run were therefore skipped.

  **Log:** `labs/kops-karpenter/output/create-cluster.log` contains the
  full `create-cluster.sh` output ending in the `VpcLimitExceeded`
  errors.

## Phase 1 — Compatibility & Scaffolding

**Phase 1 — Compatibility & Scaffolding** (completed).

Deliverables for this phase:
- `labs/kops-karpenter/COMPATIBILITY.md` — version matrix, topology decision,
  IAM and networking requirements, official doc links. **Done.**
- `labs/kops-karpenter/bin/` — directory reserved for executable lab scripts.
  - `labs/kops-karpenter/bin/bootstrap-state-store.sh` — idempotent S3
    state/discovery bucket bootstrap. **Done (Phase 1, step 2).**
- `labs/kops-karpenter/manifests/` — directory reserved for Kubernetes manifests
  applied during lab phases (NodePool, EC2NodeClass, workloads, etc.).
- `labs/kops-karpenter/cluster-spec.yaml` — kOps Cluster + InstanceGroups
  manifest (None-DNS, Cilium, NLB API, IRSA, Karpenter addon, control-plane
  + system + Karpenter-managed groups). **Done (Phase 1, step 2).**
- This status file at `.ai/agents/kops-karpenter-lab.md`.

### Phase 1 Step Status

- Step 1 — Compatibility doc + bin/ + manifests/ scaffolding: **completed.**
- Step 2 — Initial kOps cluster manifest + state-store bootstrap script:
  **completed.** Files added:
  - `labs/kops-karpenter/cluster-spec.yaml`
  - `labs/kops-karpenter/bin/bootstrap-state-store.sh`
  - No AWS resources were created in this step.

Future phases:
- Phase 3 — Karpenter scenario scripts. **COMPLETED** in three steps:
  step 1 (scenario wrappers + inflate manifest + scenario README),
  step 2 (failure lab + observability helper), step 3 (final
  guide + cleanup + teardown). All scripts pass `bash -n` and
  shellcheck; the cluster + S3 buckets have been deleted via
  `cleanup.sh`.
- (Optional follow-up, out of scope for this ferment) Phase 4
  exercises (scale-out, scale-in, consolidation, spot) and Phase 5
  (teardown + docs) — already covered by the lab scripts; running
  them against a fresh cluster remains a manual exercise for the
  operator.

## Phase 2 grader findings (FIXED)

The Phase 2 grader surfaced three findings; all three have been fixed.

1. **Missing example Karpenter manifests.** Added
   `labs/kops-karpenter/manifests/example-nodepool.yaml` (Karpenter
   `NodePool`, v1 API) and
   `labs/kops-karpenter/manifests/example-ec2nodeclass.yaml`
   (Karpenter `EC2NodeClass`, v1 API) with comments documenting each
   section. Both manifests note that applying them is OPTIONAL
   because kOps 1.36 generates equivalent objects automatically
   from the `karpenter-nodes` InstanceGroup declared in
   `cluster-spec.yaml`. The manifests allow t3.small/t3.medium in
   us-west-2a/us-west-2b, restrict to amd64/linux, accept on-demand
   and spot capacity types, and set the Karpenter 1.13 default
   consolidation policy (`WhenEmptyOrUnderutilized`,
   `expireAfter: 720h`). The NodePool taints
   `karpenter-lab/workload=true:NoSchedule` so only lab workloads
   schedule on it. The EC2NodeClass references kOps subnet/SG tags,
   uses `amiFamily: Custom` with a placeholder selector, a 20 GiB
   gp3 block device mapping, IMDSv2-only metadata options, and lab
   cleanup tags.
2. **Shellcheck failures.** Removed the `awskey.env` fallback from
   every script in `labs/kops-karpenter/bin/` (the user uses only
   `/Users/eramadan/castai/.env` for AWS credentials). The `.env`
   source goes through the shared `_lib-source-env.sh` helper,
   which sources the file in an isolated subshell and forwards
   only the AWS allow-list variables. Added
   `# shellcheck disable=SC1090,SC1091` directives where the
   helper path is dynamic, and fixed the SC2317
   unreachable-command in `_lib-source-env.sh` by removing the
   redundant `|| true`. `shellcheck labs/kops-karpenter/bin/*.sh`
   now exits 0 with no error-level output.
3. **`validate-cluster.sh` could not resolve `KOPS_STATE_STORE`.**
   The script now sources
   `labs/kops-karpenter/bin/bootstrap-state-store.sh --print-exports`
   to derive `KOPS_STATE_STORE`, `KOPS_DISCOVERY_STORE`, and
   `KOPS_CLUSTER_NAME` when any of them are unset (same pattern as
   `create-cluster.sh`). After the derivation step the script
   echoes the resolved values and proceeds.

A new helper `labs/kops-karpenter/bin/apply-karpenter-manifests.sh`
applies the example manifests on demand. `create-cluster.sh` no
longer applies them automatically; it only documents the helper
in its next-steps output. Since kOps 1.36 generates NodePool /
EC2NodeClass automatically, applying the example manifests is
strictly OPTIONAL and intended for manual exploration.

## Links

- Lab directory: `labs/kops-karpenter/`
- Compatibility document: `labs/kops-karpenter/COMPATIBILITY.md`
- Bin directory: `labs/kops-karpenter/bin/`
  - `labs/kops-karpenter/bin/bootstrap-state-store.sh`
  - `labs/kops-karpenter/bin/create-cluster.sh`
  - `labs/kops-karpenter/bin/validate-cluster.sh`
  - `labs/kops-karpenter/bin/apply-karpenter-manifests.sh`
  - `labs/kops-karpenter/bin/_lib-source-env.sh` (shared helper)
- Manifests directory: `labs/kops-karpenter/manifests/`
  - `labs/kops-karpenter/manifests/example-nodepool.yaml`
  - `labs/kops-karpenter/manifests/example-ec2nodeclass.yaml`
- Output directory: `labs/kops-karpenter/output/`
  - `validate-cluster.log` — diagnostic snapshot (produced by
    `validate-cluster.sh`).
  - `observe.log` — observability snapshot (produced by
    `observe.sh`).
  - `scenario-a.log` ... `scenario-f.log` — per-scenario snapshots.
  - `cleanup.log` — teardown trace (produced by `cleanup.sh`).
  - `scenario-README.md` — Phase 3 step 1 README.
- Lab guide: `labs/kops-karpenter/GUIDE.md` (Phase 3 step 3).
- Cleanup script: `labs/kops-karpenter/bin/cleanup.sh`
  (Phase 3 step 3).
- Cluster manifest: `labs/kops-karpenter/cluster-spec.yaml`
- kOps docs — Karpenter: https://kops.sigs.k8s.io/operations/karpenter/
- Karpenter docs — Compatibility: https://karpenter.sh/docs/upgrading/compatibility/
