# kOps + Karpenter Lab — Phase 3 Scenario Scripts

This directory records the Phase 3 scenario scripts that exercise Karpenter
behavior end-to-end against the kOps-managed cluster built in Phase 2.

## Status

**Live scenario execution is deferred.** The lab scripts in
`labs/kops-karpenter/bin/` are written and verified to be shellcheck-clean,
but they have not been run end-to-end against a live cluster. They are
blocked by the control-plane API timeout documented in Phase 2 of
`.ai/agents/kops-karpenter-lab.md`:

- `kops update cluster --yes` originally failed with
  `error creating VPC: ... api error VpcLimitExceeded: The maximum number of
  VPCs has been reached.` (account `050451381948` already had 5 VPCs in
  `eu-central-1`, hitting the per-region quota).
- After switching to `us-west-2`, AWS resources were provisioned but the
  control-plane API endpoint timed out (`i/o timeout` dialing the NLB), so
  `kubectl` could not reach the cluster.
- The cluster and its S3 state store were later deleted as part of Phase 3
  step 3 cleanup. Scenarios A-E were therefore captured *post-cleanup* and
  show the expected DNS `no such host` error for the deleted NLB endpoint.
  Scenario F captured the *real* provisioning-time API timeout while the
  cluster still existed.

## Execution status

Each scenario script writes its own log to `labs/kops-karpenter/output/`.
Because the kOps cluster and its S3 state store were deleted as part of
Phase 3 step 3 cleanup, scenarios A-E only show the post-deletion DNS error.
Scenario F is the only one that captured the live provisioning-time API
failure before cleanup.

| Scenario | Log file                              | Status                                       | Notes                                                                                                                                                                              |
|----------|---------------------------------------|----------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A        | `output/scenario-a.log`               | deferred / cluster deleted (DNS no such host) | Initial provisioning (5 replicas). Captured post-cleanup; the deleted NLB endpoint no longer resolves (`dial tcp: lookup api-kops-karpenter-lab-...: no such host`).                 |
| B        | `output/scenario-b.log`               | deferred / cluster deleted (DNS no such host) | Scale-up (5 -> 15). Captured post-cleanup; same DNS no-such-host error.                                                                                                            |
| C        | `output/scenario-c.log`               | deferred / cluster deleted (DNS no such host) | Scale-down + consolidation (15 -> 1). Captured post-cleanup; same DNS no-such-host error.                                                                                          |
| D        | `output/scenario-d.log`               | deferred / cluster deleted (DNS no such host) | Hard scheduling constraints (t3 / amd64 / us-west-2a / on-demand). Captured post-cleanup; same DNS no-such-host error.                                                             |
| E        | `output/scenario-e.log`               | deferred / cluster deleted (DNS no such host) | Spot-only workload. Captured post-cleanup; same DNS no-such-host error.                                                                                                            |
| F        | `output/scenario-f.log`               | failure captured                             | Failure-lab run produced a full snapshot of the NLB control-plane timeout plus the `observe.sh` follow-up. Not a "live pass" but the failure mode is documented end-to-end.        |

Note: Scenario F captured the *real* provisioning-time API timeout
(`i/o timeout` dialing the NLB) while the cluster still existed. Scenarios
A-E were run after cleanup and therefore show the *post-deletion* DNS
`no such host` error, which is the expected failure mode once the NLB has
been deleted.

To rerun a scenario once a cluster is reachable, export kubeconfig first
and then invoke the wrapper:

```bash
kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin
labs/kops-karpenter/bin/scenario-a.sh            # overwrite output/scenario-a.log
```

The lab has been left in the post-cleanup state on purpose: scripts are
exercised (logs exist), but no AWS resources remain.

## Scenarios

All scenarios live in `labs/kops-karpenter/bin/`. Each scenario has a short
stable wrapper (`scenario-X.sh`) and a longer-named implementation script
that the wrapper `exec`s. Both names are interchangeable.

| Short wrapper | Implementation script           | What it exercises                                                                                  |
|---------------|---------------------------------|----------------------------------------------------------------------------------------------------|
| `scenario-a.sh` | `scenario-a-provision.sh`     | Initial provisioning trigger: applies `manifests/inflate-workload.yaml` and scales inflate to 5.   |
| `scenario-b.sh` | `scenario-b-scale-up.sh`      | Scale-up: scales inflate from 5 to 15 replicas and watches new nodes join across AZs / types.      |
| `scenario-c.sh` | `scenario-c-scale-down.sh`    | Scale-down / consolidation: scales inflate to 1 and watches NodeClaims consolidate empty nodes.    |
| `scenario-d.sh` | `scenario-d-constraints.sh`   | Constraints: deploys a workload hard-pinned to t3 / amd64 / us-west-2a / on-demand.                |
| `scenario-e.sh` | `scenario-e-spot.sh`          | Spot vs on-demand: deploys a spot-only workload that tolerates the spot taint and requires spot.   |

Every script:

- Sources AWS credentials from `/Users/eramadan/castai/.env` via
  `labs/kops-karpenter/bin/_lib-source-env.sh` (only `AWS_*` variables are
  forwarded).
- Verifies `kubectl` is installed and a context is active; exits 1 with a
  clear error if not.
- Writes a snapshot to `labs/kops-karpenter/output/scenario-X.log`
  (overwritten on each run).

## Running a scenario

Once the cluster is reachable:

```bash
kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin
labs/kops-karpenter/bin/scenario-a.sh           # provisioning trigger
labs/kops-karpenter/bin/scenario-b.sh           # scale up to 15
labs/kops-karpenter/bin/scenario-c.sh           # scale down + consolidation
labs/kops-karpenter/bin/scenario-d.sh           # constraints
labs/kops-karpenter/bin/scenario-e.sh           # spot vs on-demand
```

Each script accepts `--watch-duration SECONDS` to override the default
watch window (90s for a/d, 120s for b/e, 180s for c).

## Verification

Phase 3 step 1 verification:

```bash
test -f labs/kops-karpenter/manifests/inflate-workload.yaml && for s in a b c d e; do test -f labs/kops-karpenter/bin/scenario-${s}.sh; done && test -d labs/kops-karpenter/output && ls labs/kops-karpenter/output/ | grep -q scenario
```

Exit 0 confirms the manifest, all five short-named wrappers, the output
directory, and at least one file containing "scenario" in the output
directory all exist.
