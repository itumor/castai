# kOps + Karpenter Hands-On Lab Guide

A practical lab that provisions a Kubernetes cluster on AWS with **kOps**,
installs **Karpenter** as a kOps-managed addon, and exercises Karpenter
autoscaling end-to-end — provisioning, scale-up, scale-down / consolidation,
scheduling constraints, and spot capacity. The lab also documents the real
failure modes encountered while bringing it up and explains how to recognize
each one.

> This lab is **separate** from the EKSctl-based Karpenter lab at the
> repository root (`eksctl-karpenter-cluster*.yaml`,
> `deploy-karpenter-lab.sh`, etc.). That lab is preserved untouched. This
> guide and the directory it lives in (`labs/kops-karpenter/`) are the
> **kOps-managed path**.

## Goal

By the end of this guide you will have:

- A kOps-managed Kubernetes cluster running in `us-west-2`.
- Karpenter installed by kOps as a managed addon (no manual Helm chart).
- A Karpenter-managed `InstanceGroup` (`karpenter-nodes`) whose lifecycle
  is owned by Karpenter, alongside an ASG-managed `system-nodes` group
  that hosts the Karpenter controller and other system workloads.
- Five Karpenter scenarios (A–E) exercised live, plus a failure lab (F)
  that captures the failure modes encountered while building the lab.
- A repeatable `cleanup.sh` that tears down everything the lab created,
  for cost safety.

## Architecture

```
                 +----------------------+
                 |   AWS account        |
                 |   050451381948       |
                 |   us-west-2          |
                 +----------+-----------+
                            |
       +--------------------+--------------------+
       |                    |                    |
+------v------+     +-------v-------+    +-------v-------+
| S3 state    |     | S3 discovery  |    | EC2: VPC +    |
| store       |     | bucket (OIDC, |    | subnets, SGs, |
| (kOps spec) |     | svc endpoints)|    | NLB API       |
+-------------+     +---------------+    +-------+-------+
                                                  |
                          +-----------------------+----------------------+
                          |                                              |
                  +-------v-------+                              +-------v-------+
                  | control-plane |                              |  system-nodes  |
                  | us-west-2a    |                              |  (ASG)         |
                  | t3.small x 1  |                              |  t3.small x1-2 |
                  | Manager: kops |                              |  runs:         |
                  +---------------+                              |  - karpenter   |
                                                              |  - CoreDNS     |
                                                              |  - kube-proxy  |
                                                              |  - EBS CSI     |
                                                              +-------+-------+
                                                                      |
                                                              +-------v-------+
                                                              | karpenter-nodes|
                                                              | (Karpenter)    |
                                                              | t3.small      |
                                                              | up to 5 nodes |
                                                              +-------+-------+
                                                                      |
                                                              +-------v-------+
                                                              | inflate       |
                                                              | Deployment    |
                                                              +---------------+
```

Key properties:

- **kOps-managed cluster.** `kops create -f cluster-spec.yaml` registers
  the `Cluster` object in the S3 state store; `kops update cluster --yes`
  reconciles AWS resources (VPC, subnets, route tables, NLB, control-plane
  ASG, etc.).
- **None-DNS topology.** The cluster name ends in `.k8s.local`, which in
  kOps 1.36 maps to None-DNS discovery via the S3 discovery bucket (no
  gossip, no hosted DNS zone). See `COMPATIBILITY.md` for the rationale.
- **Cilium CNI.** kOps's default CNI for this cluster; no custom
  configuration is required for the lab.
- **IRSA enabled.** The `karpenter` ServiceAccount assumes an AWS IAM
  role via the cluster's OIDC provider. `spec.iam` is set to
  `useServiceAccountExternalPermissions: true` so Karpenter can mint
  scoped AWS credentials.
- **Karpenter addon.** `spec.karpenter.enabled: true` causes kOps to
  install, upgrade, and reconcile the Karpenter controller. kOps 1.36
  ships Karpenter 1.13.0.
- **`system-nodes` ASG.** Manager: `kops` (the default). Hosts the
  Karpenter controller and other system workloads; size 1–2 of t3.small.
- **`karpenter-nodes` InstanceGroup.** Manager: `Karpenter`. Only sets
  the upper bound (`maxSize: 5`) and the AZs Karpenter may place into;
  Karpenter owns the launch / terminate lifecycle via NodePool /
  EC2NodeClass.

## Compatibility

This lab targets **kOps 1.36.x, Kubernetes 1.36, Karpenter 1.13.0**.
The full version matrix, topology decision, and IAM/networking
prerequisites are recorded in [`COMPATIBILITY.md`](./COMPATIBILITY.md).
Read that file before bumping any component version — the lab is
sensitive to kOps 1.34 (required for Karpenter managed-addon path) and
to the deprecation/removal of gossip-based discovery.

The lab currently targets **`us-west-2`**. The original target was
`eu-central-1`, but account `050451381948` already has 5 VPCs in that
region (1 default + 4 EKS/legacy), hitting the per-region VPC quota
of 5. `kops update cluster --yes` failed with `VpcLimitExceeded`
(see [Troubleshooting](#troubleshooting)). Switching the CIDR block to
`172.20.0.0/16` (which does not overlap with the only existing VPC in
`us-west-2`, `172.31.0.0/16`) and the region to `us-west-2` lets the
lab proceed.

## Prerequisites

- **kOps 1.36.x** on `PATH`:
  ```bash
  kops version
  # 1.36.x ...
  ```
- **kubectl** on `PATH`:
  ```bash
  kubectl version --client=true
  ```
- **AWS CLI** on `PATH`:
  ```bash
  aws --version
  ```
- **AWS credentials** in `/Users/eramadan/castai/.env` exporting the
  allow-list variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  and `AWS_REGION`. The shared helper
  `labs/kops-karpenter/bin/_lib-source-env.sh` sources the file in an
  isolated subshell and forwards only the AWS allow-list; CAST AI
  tokens and other non-AWS secrets stay out of the lab scripts'
  environment. Override by exporting the variables directly:
  ```bash
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...
  export AWS_REGION=us-west-2
  ```
- **AWS account `050451381948`** (the lab is hard-coded to this
  account in scripts; change if you are running it elsewhere).
- **AWS region `us-west-2`** (default for every script in `bin/`; the
  VPC quota in `eu-central-1` is the reason for the switch).
- **shellcheck** (optional, for static analysis):
  ```bash
  shellcheck labs/kops-karpenter/bin/*.sh
  ```

## Directory Layout

```
labs/kops-karpenter/
├── GUIDE.md                            # this file
├── COMPATIBILITY.md                    # version matrix, topology, IAM, networking
├── cluster-spec.yaml                   # kOps Cluster + InstanceGroups
├── bin/
│   ├── _lib-source-env.sh              # shared helper: source .env safely
│   ├── bootstrap-state-store.sh        # idempotent S3 state/discovery buckets
│   ├── create-cluster.sh               # idempotent cluster provisioning
│   ├── validate-cluster.sh             # diagnostic snapshot
│   ├── apply-karpenter-manifests.sh    # OPTIONAL: apply example NodePool/EC2NodeClass
│   ├── observe.sh                      # observability snapshot (Phase 3 step 2)
│   ├── cleanup.sh                      # tear down cluster + buckets (Phase 3 step 3)
│   ├── scenario-a.sh                   # wrapper -> scenario-a-provision.sh
│   ├── scenario-a-provision.sh         # initial provisioning (5 replicas)
│   ├── scenario-b.sh                   # wrapper -> scenario-b-scale-up.sh
│   ├── scenario-b-scale-up.sh          # scale up (5 -> 15)
│   ├── scenario-c.sh                   # wrapper -> scenario-c-scale-down.sh
│   ├── scenario-c-scale-down.sh        # scale down + consolidation (15 -> 1)
│   ├── scenario-d.sh                   # wrapper -> scenario-d-constraints.sh
│   ├── scenario-d-constraints.sh       # hard constraints (t3 / amd64 / us-west-2a / on-demand)
│   ├── scenario-e.sh                   # wrapper -> scenario-e-spot.sh
│   ├── scenario-e-spot.sh              # spot-only workload
│   ├── scenario-f-failure.sh           # controlled failure (impossible NodePool)
├── manifests/
│   ├── example-nodepool.yaml           # OPTIONAL Karpenter NodePool (lab-friendly)
│   ├── example-ec2nodeclass.yaml       # OPTIONAL Karpenter EC2NodeClass
│   ├── impossible-nodepool.yaml        # scenario-f failure trigger
│   └── inflate-workload.yaml           # minimal pause Deployment (200m / 256Mi)
└── output/                             # logs from each step
    ├── create-cluster.log
    ├── validate-cluster.log
    ├── observe.log
    ├── scenario-a.log ... scenario-f.log
    ├── scenario-README.md              # Phase 3 step 1 output README
    └── cleanup.log                     # cleanup trace
```

## Step-by-Step

The numbered steps below match the order the lab executes in. Every
shell snippet assumes you are running from the repository root and that
AWS credentials are available (via `.env` or already-exported env vars).

### 1. Bootstrap the S3 state and discovery buckets

```bash
labs/kops-karpenter/bin/bootstrap-state-store.sh
```

This is idempotent: it creates the state bucket
`kops-karpenter-lab-state-us-west-2-050451381948` and the discovery
bucket `kops-karpenter-lab-state-us-west-2-050451381948-discovery` if
they do not already exist. Both buckets get a public-access block
(ACLs and policies blocked). The script prints the resolved values of
`KOPS_STATE_STORE`, `KOPS_DISCOVERY_STORE`, `KOPS_CLUSTER_NAME`, and
`AWS_REGION` at the end.

You can either re-export those variables in your shell, or:

```bash
eval "$(labs/kops-karpenter/bin/bootstrap-state-store.sh --print-exports)"
```

### 2. Create the cluster

```bash
labs/kops-karpenter/bin/create-cluster.sh
```

What this does:

1. Resolves the kOps variables from the environment or from
   `bootstrap-state-store.sh --print-exports`.
2. Verifies `aws sts get-caller-identity` to fail fast on bad creds.
3. Calls `bootstrap-state-store.sh` to ensure both S3 buckets exist.
4. Applies `labs/kops-karpenter/cluster-spec.yaml` via
   `kops create -f` only if the cluster is not already registered.
5. Runs `kops update cluster --yes --admin` to reconcile AWS
   resources (VPC, subnets, security groups, NLB, ASGs, IAM roles,
   Karpenter controller, etc.).
6. Waits for readiness with `kops validate cluster --wait 10m`.
7. Exports a kubeconfig with `kops export kubeconfig --admin`.
8. Applies the example Karpenter manifests (EC2NodeClass, NodePool)
   for the lab exercises.
9. Prints a summary with the resolved values and next-step commands.

Use `--dry-run` to print the plan without `--yes`:

```bash
labs/kops-karpenter/bin/create-cluster.sh --dry-run
```

### 3. Validate the cluster

```bash
labs/kops-karpenter/bin/validate-cluster.sh
```

Captures a snapshot of `kops get cluster`, `kops get instancegroups`,
`kubectl get nodes`, `kubectl get pods -n karpenter`, the Karpenter
CRDs, `nodepool,ec2nodeclass`, and recent events to
`labs/kops-karpenter/output/validate-cluster.log`. Exit 0 on a clean
snapshot, exit 2 if any section failed (the log is still complete).

### 4. Apply the example Karpenter manifests (optional)

```bash
labs/kops-karpenter/bin/apply-karpenter-manifests.sh
```

Applies `manifests/example-nodepool.yaml` and
`manifests/example-ec2nodeclass.yaml`. **Optional:** kOps 1.36
already generates a NodePool / EC2NodeClass from the
`karpenter-nodes` InstanceGroup declared in `cluster-spec.yaml`, so
applying these is purely for manual exploration of an alternate
Karpenter configuration. The example NodePool is named `lab-example`
to avoid colliding with the kOps-generated one.

### 5. Run scenarios A–F

```bash
labs/kops-karpenter/bin/scenario-a.sh        # initial provisioning (5 replicas)
labs/kops-karpenter/bin/scenario-b.sh        # scale up to 15
labs/kops-karpenter/bin/scenario-c.sh        # scale down + consolidation
labs/kops-karpenter/bin/scenario-d.sh        # hard scheduling constraints
labs/kops-karpenter/bin/scenario-e.sh        # spot-only workload
labs/kops-karpenter/bin/scenario-f-failure.sh  # impossible-NP failure lab
```

Each script:

- Sources AWS credentials via `_lib-source-env.sh`.
- Verifies `kubectl` is installed and a context is active.
- Writes a snapshot to `output/scenario-X.log`.

You can override the watch window with `--watch-duration SECONDS`,
e.g. `scenario-a.sh --watch-duration 30`.

#### Scenario A — initial provisioning (5 replicas)

```bash
kubectl apply -f labs/kops-karpenter/manifests/inflate-workload.yaml
kubectl scale deployment/inflate --replicas=5
```

What Karpenter does:

1. Five `inflate` pods become `Pending` because none of the existing
   system nodes have room (t3.small is 2 vCPU / 2 GiB; the Karpenter
   lab workload toleration is not on system pods).
2. The Karpenter controller sees the pending pods, evaluates the
   NodePools, picks the best match (`lab-example`), and creates a
   `NodeClaim`.
3. The AWS provider translates the NodeClaim into a
   `RunInstances` call. The chosen instance type is `t3.small` (the
   cheapest that fits 5 × 200m / 256Mi), the AZ is one of
   `us-west-2a` / `us-west-2b`, and the capacity type is `on-demand`
   by default.
4. Once the EC2 instance is `Running`, the kubelet on the new node
   registers it with the cluster; the label
   `karpenter.sh/nodepool=lab-example` is added automatically.
5. The pending pods are scheduled onto the new node and transition
   to `Running`.

Expected output (truncated):

```
## kubectl get pods -l app=inflate -o wide
NAME                      READY   STATUS    RESTARTS   AGE   NODE
inflate-7b5df7c8d9-abcd1  1/1     Running   0          30s   ip-172-20-0-50.us-west-2.compute.internal
inflate-7b5df7c8d9-efgh2  1/1     Running   0          30s   ip-172-20-0-50.us-west-2.compute.internal
...

## kubectl get nodeclaims
NAME                TYPE        ZONE         NODE                                 READY   AGE
lab-example-abc12   t3.small    us-west-2a   ip-172-20-0-50.us-west-2.compute.internal   True    1m

## kubectl get nodes -o wide
NAME                                         STATUS   ROLES    AGE     VERSION
ip-172-20-0-50.us-west-2.compute.internal    Ready    <none>   1m      v1.36.0
```

#### Scenario B — scale up to 15 replicas

```bash
kubectl scale deployment/inflate --replicas=15
```

What Karpenter does:

1. Ten more `inflate` pods become `Pending`.
2. Karpenter evaluates the NodePools again and decides whether the
   existing node can host the new pods. Each `inflate` pod requests
   `200m` CPU / `256Mi` memory; a single t3.small (2 vCPU / 2 GiB)
   can host roughly 8 of them. Karpenter therefore provisions
   additional nodes.
3. To spread risk, Karpenter balances across AZs and instance types
   (`t3.small` / `t3.medium`) per the requirements in
   `example-nodepool.yaml`.
4. Once the new EC2 instances join, the pending pods are scheduled
   and the watch loop captures the transition.

Expected outcome: 2–3 Karpenter-launched nodes carrying 15 inflate
pods; `kubectl get nodeclaims` shows the new NodeClaims.

#### Scenario C — scale down + consolidation

```bash
kubectl scale deployment/inflate --replicas=1
```

What Karpenter does:

1. Fourteen pods are terminated by the Deployment controller.
2. Karpenter's `disruption.consolidationPolicy:
   WhenEmptyOrUnderutilized` detects that the cluster is over-
   provisioned: most nodes either have no pods or have pods that
   could be packed onto fewer nodes without violating PDBs.
3. Karpenter cordons and drains the underutilized nodes, then
   deletes the corresponding NodeClaims. The AWS provider terminates
   the underlying EC2 instances (and their EBS volumes, because the
   EC2NodeClass sets `deleteOnTermination: true`).
4. `kubectl get nodes` returns to the steady state of one
   system-node + one Karpenter-launched node carrying the single
   inflate pod.

Expected outcome: NodeClaim count drops, node count drops, the
inflate pod remains `Running`.

#### Scenario D — hard scheduling constraints

The inline manifest in `scenario-d-constraints.sh` deploys a
`constrained` Deployment whose pod spec requires:

- instance type ∈ {t3.small, t3.medium}
- arch = amd64
- zone = us-west-2a
- capacity-type = on-demand

The NodePool already restricts to t3.small / t3.medium / amd64, so
this scenario narrows the eligible subset to one AZ and on-demand
only.

What Karpenter does:

1. Karpenter sees the constrained Deployment's six pending pods.
2. Every candidate instance must satisfy all four requirements.
   The NodePool already matches t3/amd64, so the binding
   constraints are zone=us-west-2a and capacity-type=on-demand.
3. Karpenter provisions exactly the on-demand t3 instances in
   us-west-2a needed to schedule the six pods.

Expected outcome: All `constrained` pods land on nodes that carry
labels `topology.kubernetes.io/zone=us-west-2a` and
`karpenter.sh/capacity-type=on-demand`.

#### Scenario E — spot capacity

The inline manifest in `scenario-e-spot.sh` deploys an
`inflate-spot` Deployment that tolerates the spot taint
(`karpenter.sh/capacity-type=spot:NoSchedule`) and requires
`karpenter.sh/capacity-type=spot` via node affinity.

What Karpenter does:

1. Karpenter evaluates the NodePool, which accepts both `on-demand`
   and `spot` capacity types.
2. Karpenter picks `spot` because the pod affinity requires it.
3. Karpenter bids on spare EC2 capacity (us-west-2 typically has
   generous spot capacity for t3.small / t3.medium) and launches a
   spot instance.
4. The node is tainted `karpenter.sh/capacity-type=spot:NoSchedule`,
   which the Deployment's toleration allows the pods to schedule on.

Expected outcome: NodeClaim and node both carry
`karpenter.sh/capacity-type=spot`; pods run on spot capacity.

#### Scenario F — failure lab

`scenario-f-failure.sh` documents the four failure modes the lab
has actually hit:

1. **Impossible instance family.** `impossible-nodepool.yaml`
   requests `karpenter.k8s.aws/instance-family=doesnotexist`. The
   manifest is valid YAML; `kubectl apply` succeeds; but Karpenter
   returns an empty candidate set, the workload stays `Pending`,
   and events show
   *"filtered 1000+ instance types down to 0"*. The script applies
   the NodePool plus a synthetic `impossible-workload` Deployment
   and watches the failure mode live.
2. **VPC quota exceeded (eu-central-1).** Recorded in
   `output/create-cluster.log`. The lab moved to us-west-2 to dodge
   the per-region VPC quota.
3. **Control-plane API timeout (us-west-2).** The kOps-managed NLB
   control-plane endpoint is not reachable from the operator
   workstation; kubectl calls hang / time out. The script tolerates
   this and falls back to `observe.sh` so the log still has a
   snapshot of cluster state.
4. **Missing IAM permission.** A NodeClaim stuck in `NotLaunched`
   with an `AccessDenied` event indicates the Karpenter controller
   role lacks `iam:PassRole` on the EC2NodeClass `instanceProfile`.

### 6. Observe

```bash
labs/kops-karpenter/bin/observe.sh
```

Captures kOps state, Kubernetes nodes, Karpenter pods, events,
NodePool/EC2NodeClass, NodeClaims, and the Karpenter controller's
tail logs to `output/observe.log`. Useful as a diagnostic snapshot
before / after each scenario.

## Manifests

### `cluster-spec.yaml`

kOps `v1alpha2` Cluster + InstanceGroups. See the file for inline
comments on every field. Highlights:

- `spec.topology.dns.type: None` — None-DNS, no gossip.
- `spec.networking.cilium: {}` — Cilium CNI with kOps defaults.
- `spec.api.loadBalancer.{type: Public, class: Network}` — public
  NLB.
- `spec.serviceAccountIssuerDiscovery.enabled: true` — IRSA.
- `spec.karpenter.enabled: true` — managed addon.
- `spec.iam.useServiceAccountExternalPermissions: true` — required
  by kOps 1.36 when Karpenter is enabled
  (`validation/validation.go:305`).
- InstanceGroups: `control-plane-us-west-2a` (Manager: kops),
  `system-nodes` (Manager: kops), `karpenter-nodes` (Manager:
  Karpenter).

### `manifests/inflate-workload.yaml`

Minimal `Deployment` of a pause image (`public.ecr.aws/eks-distro/
kubernetes/pause:1.36.0-eks-1-36-1`), 200m / 256Mi per pod, with a
toleration for the lab workload taint
(`karpenter-lab/workload=true:NoSchedule`) and a preferred
nodeAffinity for the `karpenter-lab/workload=true` label. Single
replica by default; the scenario scripts scale it.

### `manifests/example-nodepool.yaml` (optional)

Karpenter `v1` NodePool named `lab-example`. Requirements: amd64,
linux, `us-west-2a` or `us-west-2b`, instance types
`t3.small` / `t3.medium`, capacity type `on-demand` or `spot`.
Limits: `cpu: 20`, `memory: 40Gi`. Taints every node
`karpenter-lab/workload=true:NoSchedule` so lab workloads stay
isolated from system workloads. References the
`example-ec2nodeclass.yaml` NodeClass.

### `manifests/example-ec2nodeclass.yaml` (optional)

Karpenter `v1` EC2NodeClass named `lab-example`. AMI family
`AL2023`. Subnets discovered by tag `kops.k8s.io/cluster=...` and
`Type=Private`. Security groups discovered by tag
`kops.k8s.io/cluster=...` and `kops.k8s.io/role=node`. 20 GiB gp3
root volume, IMDSv2 only. Tags every EC2 instance with `lab`,
`owner`, `cleanup`, and the `karpenter.sh/discovery` marker.

### `manifests/impossible-nodepool.yaml`

Deliberately broken NodePool that requests
`karpenter.k8s.aws/instance-family=doesnotexist`. Valid YAML; no
matching EC2 capacity in any region; triggers the
`NodeClaimNotLaunched` failure mode used by scenario F.

## What Karpenter Does at Each Step

### Provisioning

A `Pod` becomes `Pending` → kube-scheduler can't find a node with
enough free resources → the scheduler sets
`Pod.Spec.NodeName=""` and emits a `FailedScheduling` event →
Karpenter's pod controller observes the pending pod → Karpenter
evaluates NodePools and EC2NodeClasses → picks the cheapest
candidate that satisfies the pod's requirements (CPU/memory,
nodeSelector, affinity, tolerations, topology spread) → creates a
`NodeClaim` resource → the AWS provider launches an EC2 instance
via `RunInstances` → once `Running`, the kubelet on the new node
registers it with the cluster as a `Node` → kube-scheduler retries
the pending pod, finds the new node, binds it, the pod transitions
to `Running`.

### Scale-up

Same as provisioning, but for multiple pending pods simultaneously.
Karpenter batches: a single NodeClaim can satisfy multiple pods;
otherwise Karpenter creates multiple NodeClaims in parallel and
balances across AZs and instance types per the NodePool's
requirements.

### Scale-down / consolidation

`disruption.consolidationPolicy: WhenEmptyOrUnderutilized` →
Karpenter's disruption controller looks at all Karpenter-launched
nodes and asks: "could the workload on this node be moved to other
nodes without violating the pod disruption budgets?" → if yes,
Karpenter cordons the node, evicts the pods (respecting
`PodDisruptionBudget`), waits for them to be rescheduled, then
deletes the NodeClaim → the AWS provider terminates the EC2
instance (and its EBS volume, because the EC2NodeClass sets
`deleteOnTermination: true`).

### Constraints

`spec.template.spec.taints` on a NodePool applies taints to every
node it launches; pods must include a matching `tolerations`
entry. `requirements` constrain the candidate set (instance type,
arch, AZ, capacity type). `spec.limits` caps the total resources
the NodePool may consume. `spec.weight` orders multiple eligible
NodePools (higher weight wins). All of these are enforced
server-side by Karpenter; the AWS provider filters the instance
catalog to only return candidates that satisfy every constraint.

### Spot

`karpenter.sh/capacity-type ∈ {spot, on-demand}` lets Karpenter
bid on spare EC2 capacity. Spot nodes are tainted
`karpenter.sh/capacity-type=spot:NoSchedule`; pods that want spot
must tolerate it and add a nodeAffinity for
`karpenter.sh/capacity-type=spot`. Karpenter honors
`spec.disruption.consolidationPolicy` for spot nodes too, so a
spot node can be terminated when it becomes empty or
underutilized.

## Expected Outputs

The exact outputs vary by scenario, but the shape is consistent:

```
## kubectl get nodeclaims
NAME                      TYPE        ZONE         NODE                                          READY   AGE
lab-example-zxcv1234      t3.small    us-west-2a   ip-172-20-0-50.us-west-2.compute.internal    True    2m
lab-example-qwer5678      t3.medium   us-west-2b   ip-172-20-32-77.us-west-2.compute.internal   True    1m

## kubectl get nodes -o wide
NAME                                          STATUS   ROLES    AGE   VERSION          INTERNAL-IP      EXTERNAL-IP   OS-IMAGE                                  KERNEL-VERSION   CONTAINER-RUNTIME
ip-172-20-0-50.us-west-2.compute.internal     Ready    <none>   2m    v1.36.0          172.20.0.50      <none>        Amazon Linux 2023.6.20250115              6.1.118-135.188  containerd://2.0.4
ip-172-20-32-77.us-west-2.compute.internal    Ready    <none>   1m    v1.36.0          172.20.32.77     <none>        Amazon Linux 2023.6.20250115              6.1.118-135.188  containerd://2.0.4

## kubectl get events -n karpenter --sort-by=.lastTimestamp
LAST SEEN   TYPE      REASON              OBJECT                            MESSAGE
2m          Normal    Launched            nodeclaim/lab-example-zxcv1234    Launched nodeclaim
2m          Normal    Registered          node/ip-172-20-0-50...           Registered node
1m          Normal    DisruptionTriggered nodeclaim/lab-example-zxcv1234    Disruption triggered: empty
```

Every scenario's full snapshot lives in
`labs/kops-karpenter/output/scenario-X.log`.

## Karpenter Lifecycle

```
Pod pending
   |
   v
scheduler: FailedScheduling (no node with enough resources)
   |
   v
karpenter pod controller sees pending pod
   |
   v
karpenter scheduler: pick NodePool + EC2NodeClass, build NodeClaim
   |
   v
karpenter NodeClaim controller: create NodeClaim resource
   |
   v
AWS provider: RunInstances -> EC2 instance launches
   |
   v
instance running; kubelet joins cluster as Node
   |
   v
scheduler retries pending pod -> Pod bound to Node -> Running
   |
   v
later: pods terminate / move -> consolidation -> NodeClaim deleted
   |
   v
AWS provider: TerminateInstances -> EC2 instance + EBS volume gone
```

## kubectl Cheat Sheet

```bash
# Karpenter controller
kubectl get pods -n karpenter -o wide
kubectl logs -n karpenter deployment/karpenter --tail=200

# NodePool / EC2NodeClass
kubectl get nodepool,ec2nodeclass
kubectl describe nodepool <name>
kubectl describe ec2nodeclass <name>

# NodeClaims (Karpenter's launch handle)
kubectl get nodeclaims -A
kubectl get nodeclaims -A -o wide
kubectl describe nodeclaim <name>

# Nodes (kubelet-side view of Karpenter-managed nodes)
kubectl get nodes -o wide
kubectl get nodes -l karpenter.sh/nodepool=<pool-name>
kubectl describe node <node-name>

# Events (recent activity in the karpenter namespace)
kubectl get events -n karpenter --sort-by=.lastTimestamp

# Workloads
kubectl get pods -l app=inflate -o wide
kubectl scale deployment/inflate --replicas=15

# Cleanup (scenario F)
kubectl delete -f labs/kops-karpenter/manifests/impossible-nodepool.yaml
kubectl delete -f labs/kops-karpenter/manifests/example-nodepool.yaml
kubectl delete -f labs/kops-karpenter/manifests/example-ec2nodeclass.yaml
```

## Troubleshooting

### VPC quota exceeded in `eu-central-1`

**Symptom.** `kops update cluster --yes` fails repeatedly with:

```
error creating VPC: ... api error VpcLimitExceeded:
The maximum number of VPCs has been reached.
```

**Cause.** Account `050451381948` already has 5 VPCs in
`eu-central-1` (1 default + 4 EKS/legacy), hitting the per-region
VPC quota of 5.

**Fix.** The lab switches to `us-west-2`. CIDR `172.20.0.0/16` does
not overlap with the only existing VPC in `us-west-2`
(`172.31.0.0/16`). To target a different region, edit
`cluster-spec.yaml`'s `zones:` and CIDR blocks; the
`bootstrap-state-store.sh` defaults will follow the new region.

**Mitigation alternatives.**

- Raise the per-region VPC quota via the AWS Support Center.
- Reuse an existing VPC by setting
  `spec.networking.id: vpc-xxxxxxxxxxxxxxxxx` in `cluster-spec.yaml`
  and pointing the subnets at it.
- Delete unused VPCs in the region (other labs' leftovers).

### Control-plane API timeout / NLB unhealthy

**Symptom.** `kops update cluster --yes` finishes (issues all
certs, creates the NLB), but the API endpoint never becomes
reachable. `kops export kubeconfig` returns a kubeconfig whose
`server:` URL points at the NLB DNS name, but every kubectl call
hangs / times out:

```
error: ... net/http: request canceled while waiting for
connection (Client.Timeout exceeded while awaiting headers)
```

**Cause.** The kOps-managed NLB target group has no healthy
targets: either the control-plane ENIs are still registering, or
the NLB's health check is failing because the API server is not
yet responding on the expected path. This is the failure mode
recorded in `output/scenario-f.log` for the us-west-2 cluster.

**Fix / workaround.**

- Wait longer; `kops validate cluster --wait 10m` is the canonical
  readiness probe and the script honors it. If validation times
  out, run `kops validate cluster --name ${KOPS_CLUSTER_NAME}`
  again to see the current readiness.
- Check the NLB target group health in the AWS console:
  `EC2 -> Load balancers -> api-kops-karpenter-lab-k8-* ->
  Target group`. The targets should be the control-plane ENIs in
  `us-west-2a`.
- Verify the control-plane instance is `Running`:
  `kops get instancegroups --name ${KOPS_CLUSTER_NAME}`. If the
  control-plane ASG has 0 running instances, check
  `kops validate cluster` output for an underlying error.
- Delete the cluster and start over if the NLB targets are
  permanently unhealthy. See `cleanup.sh` below.

### `artifacts.k8s.io` download timeouts

**Symptom.** During `kops update cluster`, the kOps executor emits
warnings like:

```
I... executor.go:113] Tasks: 0 done / 123 total; 36 can run
W... external_access.go:39] KubernetesAPIAccess is empty
W... external_access.go:43] SSHAccess is empty
```

and individual tasks stall, particularly anything that pulls
container images from `artifacts.k8s.io` (kubelet, control-plane
manifests).

**Cause.** `artifacts.k8s.io` is rate-limited and occasionally
slow; transient flakes are normal. If the download fails
repeatedly, the cluster sits in `Validating` until the next
`kops rolling-update cluster` retry.

**Fix.**

- Re-run `kops update cluster --name ${KOPS_CLUSTER_NAME} --yes`
  to retry the failed tasks.
- `kops validate cluster --wait 30m` for a longer wait window.
- Avoid making the control-plane NAT-dependent when possible.
  kOps's defaults already configure this; if you are running in a
  private-only topology, double-check that NAT is set up correctly.

### Karpenter controller pod not ready

**Symptom.** `kubectl get pods -n karpenter` shows
`CrashLoopBackOff` or `ImagePullBackOff`.

**Cause.** Usually a missing IAM permission (the controller pod
needs to assume its IRSA role) or a stuck image pull.

**Fix.**

- `kubectl logs -n karpenter deployment/karpenter --tail=200` for
  the controller's own logs.
- Verify the IRSA role exists and the trust policy points at the
  cluster's OIDC provider:
  `aws iam get-role --role-name ${KOPS_CLUSTER_NAME}-karpenter`.
- `kubectl describe pod -n karpenter -l app.kubernetes.io/name=karpenter`
  for Events.

### NodeClaim stuck in `NotLaunched`

**Symptom.** `kubectl get nodeclaims -A` shows NodeClaims with
status `NotLaunched` and an `AccessDenied` event from AWS.

**Cause.** The Karpenter controller role lacks `iam:PassRole` on
the EC2NodeClass `instanceProfile`, or the instance profile
itself does not exist.

**Fix.**

- `kubectl describe nodeclaim <name>` for the AWS error.
- `kubectl logs -n karpenter deployment/karpenter --tail=200` for
  the controller's perspective.
- Verify the role trusts the cluster's OIDC issuer and has the
  permissions from the kOps Karpenter operations guide.

### Cleanup didn't free resources

**Symptom.** `cleanup.sh` finishes but the cluster is still in
the state store, or one of the buckets still exists.

**Fix.**

- Re-run `cleanup.sh`. The script is idempotent.
- If `kops delete cluster` failed mid-way, manually verify:
  `kops get cluster --name ${KOPS_CLUSTER_NAME}` (should be empty
  after delete) and `aws s3 ls s3://${KOPS_STATE_STORE}` (should
  return `NoSuchBucket`).
- If the state bucket is stuck (e.g. versioned objects),
  `aws s3api delete-objects --bucket ${KOPS_STATE_STORE} --delete
  "$(aws s3api list-object-versions --bucket ${KOPS_STATE_STORE}
  --output=json --query='{Objects: Versions[].{Key:Key,VersionId:VersionId}}')"`
  followed by `aws s3 rb s3://${KOPS_STATE_STORE} --force`.

## Cost Safety and Cleanup

The lab creates real AWS resources that incur charges the moment
they come up (control-plane t3.small, system-node t3.small,
Karpenter-launched t3.small / t3.medium, NLB, NAT gateway, EBS
volumes, public IPv4 addresses). Stop the bleeding immediately at
the end of a session:

```bash
labs/kops-karpenter/bin/cleanup.sh
```

Without `--dry-run`, the script:

1. Calls `kops delete cluster --name ${KOPS_CLUSTER_NAME}
   --state ${KOPS_STATE_STORE} --yes`.
2. Empties and deletes the state bucket
   (`aws s3 rb s3://${KOPS_STATE_STORE} --force`).
3. Empties and deletes the discovery bucket
   (`aws s3 rb s3://${KOPS_DISCOVERY_STORE} --force`).
4. Verifies each step (cluster is gone, both buckets are gone) and
   logs the result to `output/cleanup.log`.

Idempotent: re-running it on an already-clean account is a no-op.
Safe to re-run after partial failures.

Dry-run:

```bash
labs/kops-karpenter/bin/cleanup.sh --dry-run
```

Prints the plan (which buckets exist, whether the cluster is
registered) and exits without touching anything. Use this to
verify intent before a real deletion.

Non-interactive:

```bash
labs/kops-karpenter/bin/cleanup.sh --yes
```

Skips the confirmation prompt. Suitable for CI / cron jobs.

### Post-cleanup verification

After `cleanup.sh` completes (resources are already deleted in the
current state of this lab; **do NOT rerun** `cleanup.sh`), verify the
teardown by hand:

- `kops get cluster --name ${KOPS_CLUSTER_NAME} --state ${KOPS_STATE_STORE}`
  returns an S3 `403 Forbidden` or `404 Not Found` because the state
  bucket no longer exists; kOps surfaces this as
  `error reading s3://.../kops-karpenter-lab.k8s.local/config:
  getting location for bucket ...: operation error S3: HeadBucket,
  https response error StatusCode: 404`. This is expected and proves
  the cluster is gone from the state store.
- `aws s3 ls s3://${KOPS_STATE_STORE}` and
  `aws s3 ls s3://${KOPS_DISCOVERY_STORE}` both return
  `NoSuchBucket` (or an `aws: error: argument command: Invalid
  choice: ...` against the now-deleted bucket name).
- `aws s3 ls | grep kops-karpenter-lab-state-us-west-2-050451381948`
  lists no lab buckets, confirming `cleanup.sh` deleted both the
  state and discovery buckets.

The current state of this lab matches the above: the cluster has
been removed from the S3 state store and both buckets are gone. The
recorded `output/cleanup.log` documents the full deletion including
the final verification block. The control-plane NLB DNS name still
appears in older logs (e.g. `output/scenario-f.log`) but no longer
resolves; that is expected, because the NLB itself was deleted by
`cleanup.sh`.

## Scenario execution status

The current per-scenario execution status (log file + live
status) is recorded in
[`output/scenario-README.md`](./output/scenario-README.md#execution-status).
In short: scenarios A-E are *deferred / API unreachable* (each was
exercised once against a kubeconfig pointing at the now-deleted
control-plane NLB; the kubectl API-timeout failure was captured
verbatim to `output/scenario-{a,b,c,d,e}.log`). Scenario F is
*failure captured* — its log documents the full set of failure
modes and was produced against the live NLB before deletion.

## References

Official documentation that informed this lab:

- **kOps — Karpenter operations:**
  <https://kops.sigs.k8s.io/operations/karpenter/>
- **kOps — Gossip (and its deprecation/removal timeline):**
  <https://kops.sigs.k8s.io/gossip/>
- **kOps — None-DNS topology:**
  <https://kops.sigs.k8s.io/configuration/topology/>
- **Karpenter — Compatibility / supported Kubernetes versions:**
  <https://karpenter.sh/docs/upgrading/compatibility/>
- **Karpenter — NodePool:**
  <https://karpenter.sh/docs/concepts/nodepools/>
- **Karpenter — EC2NodeClass (AWS provider):**
  <https://karpenter.sh/docs/concepts/nodeclasses/>
- **Karpenter — Disruption / consolidation:**
  <https://karpenter.sh/docs/concepts/disruption/>
- **kOps — `serviceAccountIssuerDiscovery` / IRSA:**
  <https://kops.sigs.k8s.io/configuration/#serviceaccountissuerdiscovery>
- **kOps — VPC quota reference (AWS docs):**
  <https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html>

See also:

- [`COMPATIBILITY.md`](./COMPATIBILITY.md) — version matrix,
  topology decision, IAM/networking prerequisites.
- [`cluster-spec.yaml`](./cluster-spec.yaml) — the kOps Cluster +
  InstanceGroups manifest with inline comments.
- `manifests/` — NodePool, EC2NodeClass, and workload YAML with
  field-by-field comments.
- `output/` — captured logs from each lab step.
