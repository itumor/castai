# Karpenter Lab on EKS

A minimal, idempotent lab setup for learning [Karpenter](https://karpenter.sh/) on Amazon EKS using [`eksctl`](https://eksctl.io/).

The cluster uses a single small managed node group for system workloads and lets Karpenter dynamically provision workload nodes via NodePool and EC2NodeClass resources.

---

## What's in this repo

| File | Purpose |
|------|---------|
| `eksctl-karpenter-cluster.yaml` | `eksctl` ClusterConfig. Creates the EKS cluster, enables OIDC, installs Karpenter, and defines the `system-ng` managed node group. |
| `karpenter-nodeclass.yaml` | Karpenter `EC2NodeClass`. Tells Karpenter which IAM role, subnets, security groups, and AMI to use for new nodes. |
| `karpenter-nodepool.yaml` | Karpenter `NodePool`. Defines instance requirements, consolidation, and references the EC2NodeClass. |
| `test-karpenter-workload.yaml` | A sample `inflate` Deployment used to trigger Karpenter scaling. |
| `deploy-karpenter-lab.sh` | One-shot idempotent script: cluster creation → Karpenter setup → NodeClass/NodePool → optional scaling test. |
| `diagnose-karpenter.sh` | Collects Karpenter pod status, events, logs, and node taints. |
| `fix-karpenter-taint.sh` | Removes the `CriticalAddonsOnly` taint from `system-ng` if it was applied and blocks Karpenter pods. |
| `ensure-default-storageclass.sh` | Idempotently ensures the cluster has a default StorageClass (gp3 with EBS CSI if available, otherwise gp2 in-tree). Required by CAST AI PVCs such as ClickHouse. |
| `ensure-clickhouse-crd.sh` | Idempotently installs the `ClickHouseInstallation` CRD with curl retries + optional `GITHUB_TOKEN`. Lets `castctl` skip the GitHub fetch that triggers HTTP 429. |
| `generated-cluster.yaml` | Original eksctl-generated ClusterConfig used as a style reference. |

---

## Quick start

### 1. Prerequisites

- AWS CLI, `eksctl`, and `kubectl` installed
- Valid AWS credentials configured
- `chmod +x deploy-karpenter-lab.sh`

### 2. Create the cluster and install Karpenter

```bash
./deploy-karpenter-lab.sh
```

The script is idempotent:
- If the cluster already exists, it skips `eksctl create cluster`.
- It waits for **at least one** Karpenter pod to be ready.
- It applies the EC2NodeClass and NodePool.
- It scales Karpenter to **1 replica** (the lab uses a single `system-ng` node).

### 3. Test Karpenter scaling

```bash
./deploy-karpenter-lab.sh --test-workload
```

This:
1. Deploys the `inflate` test workload.
2. Scales it to 5 replicas.
3. Watches `kubectl get nodes -w` for 60 seconds so you can see Karpenter provision new nodes.

To scale manually:

```bash
kubectl apply -f test-karpenter-workload.yaml
kubectl scale deployment inflate --replicas=5
kubectl get nodes -w
```

---

## Cluster configuration highlights

- **Cluster name:** `karpenter-lab`
- **Region:** `eu-central-1`
- **Kubernetes version:** `1.36`
- **Karpenter version:** `1.14.0`
- **OIDC:** enabled (required for Karpenter IRSA)
- **Spot interruption queue:** enabled
- **EKS Auto Mode:** explicitly disabled
- **Cluster Autoscaler:** not installed
- **System node group:** `system-ng` (`t3.medium`, Amazon Linux 2023, min/desired/max = 1/1/2, 30 GB disk)

---

## Karpenter NodePool details

- Allows `amd64` / `linux` nodes.
- Supports both `on-demand` and `spot` capacity types (Spot interruption queue is wired up).
- Limits instance families to `t`, `m`, `c`, `r` and generations newer than 2.
- Consolidates empty nodes 30 seconds after they become empty.
- Resource limits: 20 CPU / 80 GiB memory.
- Taints Karpenter nodes with `karpenter-lab/workload=true:NoSchedule`; the test workload tolerates this taint.

---

## Troubleshooting

### Karpenter pods stay Pending

Likely cause: the `system-ng` managed node group was tainted with `CriticalAddonsOnly`, which Karpenter pods do not tolerate.

The current `eksctl-karpenter-cluster.yaml` no longer applies that taint. For an existing cluster, run:

```bash
./fix-karpenter-taint.sh
```

### Only one Karpenter pod is Running, the other is Pending

The lab intentionally uses one `system-ng` node, so only one Karpenter replica can be scheduled. The deploy script automatically scales Karpenter to 1 replica. If needed, run:

```bash
kubectl scale deployment karpenter -n karpenter --replicas=1
```

### NodePool fails to apply with API errors

Karpenter `v1` API fields change across releases. If you see errors like `unknown field "spec.disruption.expireAfter"`, check the NodePool manifest against the installed Karpenter version. The current manifest targets Karpenter `1.14.0`.

### CAST AI onboarding fails on default StorageClass / ClickHouse PVC

CAST AI components such as ClickHouse require a default StorageClass. If `castctl cluster connect` reports:

```
✗ Default StorageClass exists (ClickHouse PVC requirement)
  no default StorageClass found in the cluster
```

Run the helper against the target cluster:

```bash
./ensure-default-storageclass.sh
```

This script:
- Does nothing if a default StorageClass already exists.
- Creates a `gp3-default` class when the AWS EBS CSI driver is installed.
- Otherwise annotates the existing `gp2` class as default (or creates `gp2-default` using the in-tree provisioner).

The deploy script also runs this helper automatically during cluster setup.

### CAST AI onboarding fails with ClickHouse CRD HTTP 429

If `castctl cluster connect` fails with:

```
✗ ClickHouseInstallation CRD
  installing CRD: fetching ClickHouse CRD: HTTP 429
```

GitHub is rate-limiting the raw-content fetch. Install the CRD beforehand:

```bash
./ensure-clickhouse-crd.sh
```

The script retries automatically and supports an authenticated download:

```bash
GITHUB_TOKEN=ghp_xxx ./ensure-clickhouse-crd.sh
```

After the CRD is installed, rerun `castctl cluster connect`.

### Collect diagnostics

```bash
./diagnose-karpenter.sh
```

---

## Identifying Karpenter-provisioned nodes

After scaling the test workload, you should see new nodes join the cluster. Nodes created by Karpenter are different from managed node group nodes in a few ways.

### Quick check

```bash
# Show the NodePool label on every node
kubectl get nodes -L karpenter.sh/nodepool
```

Output example:

```
NAME                                            STATUS   ROLES    AGE   NODEPOOL
ip-192-168-92-33.eu-central-1.compute.internal  Ready    <none>   10m   <none>
ip-192-168-119-42.eu-central-1.compute.internal Ready    <none>   1m    lab-nodepool
```

- `<none>` = `system-ng` managed node group
- `lab-nodepool` = Karpenter-provisioned node

### Detailed labels

```bash
# Labels that identify Karpenter nodes
kubectl get nodes -L karpenter.sh/nodepool,karpenter.sh/capacity-type,karpenter.k8s.aws/instance-type

# Show all labels for a specific node
kubectl describe node <node-name>
```

Common Karpenter labels:

| Label | Example value | Meaning |
|-------|---------------|---------|
| `karpenter.sh/nodepool` | `lab-nodepool` | Which NodePool created the node |
| `karpenter.sh/capacity-type` | `spot` / `on-demand` | Capacity type |
| `karpenter.k8s.aws/instance-type` | `t3.medium` | EC2 instance type |
| `karpenter.k8s.aws/instance-family` | `t3` | EC2 instance family |
| `topology.kubernetes.io/zone` | `eu-central-1a` | Availability zone |

Managed node group nodes are usually missing `karpenter.sh/nodepool` and instead carry:

| Label | Example value |
|-------|---------------|
| `alpha.eksctl.io/nodegroup-name` | `system-ng` |
| `alpha.eksctl.io/nodegroup-type` | `managed` |
| `eks.amazonaws.com/nodegroup` | `system-ng` |

---

## Cleanup

Delete the cluster and all AWS resources created by `eksctl`:

```bash
eksctl delete cluster --region eu-central-1 --name karpenter-lab
```

---

## References

- [AWS eksctl Karpenter documentation](https://docs.aws.amazon.com/eks/latest/eksctl/eksctl-karpenter.html)
- [Karpenter documentation](https://karpenter.sh/docs/)
- [Karpenter compatibility matrix](https://karpenter.sh/docs/upgrading/compatibility/)
