---
name: karpenter-castai-clm
description: Use when implementing Karpenter cost-optimized node provisioning or CAST AI Container Live Migration on EKS in this repo, or when debugging Karpenter/CAST AI CLM failures
---

# Karpenter + CAST AI CLM on EKS

## Overview

This repo contains a working lab (`karpenter-lab`, `us-west-2`) that combines Karpenter v1.14.1 cost-optimized NodePools with CAST AI Container Live Migration (CLM). Key patterns: Spot-first NodePool, On-Demand critical NodePool, CLM-enabled single-AZ NodePool on private subnets, and an end-to-end test script.

## When to Use

- Standing up Karpenter on a new EKS lab cluster in this repo
- Adding CAST AI CLM prerequisites to a Karpenter NodePool
- Debugging why Karpenter nodes won't join, why CLM migrations fail, or why the CLM dashboard shows zero migrations
- Destroying the lab cluster cleanly

## Core Pattern

### 1. Karpenter controller must run on non-Karpenter nodes

The Karpenter controller Deployment has node affinity `karpenter.sh/nodepool DoesNotExist`. Keep the managed `system-ng` node group at `minSize >= 1`, otherwise the controller has nowhere to schedule.

### 2. EC2NodeClass checklist

- `amiFamily: AL2023` (required for CLM)
- Do **not** set `kmsKeyID: ""` — remove the key entirely
- Tag subnets and security groups with `karpenter.sh/discovery=<cluster-name>`
- Use `metadataOptions.httpTokens: required` for IMDSv2

### 3. NodePool design

```yaml
# general = Spot-first, cost-optimized
requirements:
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot", "on-demand"]
  - key: karpenter.k8s.aws/instance-category
    operator: In
    values: ["t", "m", "c", "r"]
  - key: karpenter.k8s.aws/instance-generation
    operator: Gt
    values: ["4"]

# critical-on-demand = isolated, no Spot
requirements:
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["on-demand"]
taints:
  - key: workload-type
    value: critical
    effect: NoSchedule

# general-live = CLM-enabled
metadata:
  labels:
    live.cast.ai/install: "true"
spec:
  requirements:
    - key: topology.kubernetes.io/zone
      operator: In
      values: ["us-west-2a"]
    - key: karpenter.k8s.aws/instance-family
      operator: In
      values: ["c3", "m3", "r3", "i2"]
  startupTaints:
    - key: live.cast.ai/not-ready
      value: "true"
      effect: NoSchedule
```

### 4. CLM NodePool must use a private-only subnet

CAST AI TCP live migration requires source and destination nodes to be in the **same subnet**, not just the same AZ. Create a separate EC2NodeClass that selects the private subnet by ID:

```yaml
subnetSelectorTerms:
  - id: "subnet-02c159ffd8bc11508"   # private subnet in us-west-2a
```

### 5. KarpenterNodeRole must be in aws-auth

Without this mapping, Karpenter-launched nodes cannot authenticate:

```yaml
mapRoles: |
  - rolearn: arn:aws:iam::<account>:role/eksctl-KarpenterNodeRole-karpenter-lab
    username: system:node:{{EC2PrivateDNSName}}
    groups:
      - system:bootstrappers
      - system:nodes
```

### 6. EBS CSI default StorageClass

The EBS CSI driver addon is declared in `eksctl-karpenter-cluster-us-west-2.yaml`. Apply a default `gp3` StorageClass:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  encrypted: "true"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ImagePullBackOff` for Karpenter | Chart ignores `registry:` | Set `controller.image.repository: public.ecr.aws/karpenter/controller` |
| `Unauthorized` in Karpenter logs | Missing IRSA permissions | Add `eks:DescribeCluster`, `ec2:*`, `iam:PassRole`, `sqs:*`, `pricing`, `ssm`, `events` |
| Karpenter `no subnets found` | Missing subnet tag | Tag all subnets with `karpenter.sh/discovery=<cluster>` |
| `CreateFleet` `kmsKeyId` invalid | Empty `kmsKeyID` | Remove `kmsKeyID` from blockDeviceMappings |
| HPA `FailedGetResourceMetric` | metrics-server missing | Install metrics-server |
| `tail -n1 test-results.log` not `RESULT: PASS` | Cleanup printed after result | Disable EXIT trap, cleanup, then print result |
| CLM migration `SubnetMismatch` | Public + private subnets mixed | Restrict CLM NodeClass to one private subnet ID |
| CLM dashboard zero migrations | `castai-live-controller` has `replicas: 0` or `migration-enabled=false` | Enable CLM in CAST AI console, then trigger rebalance |
| `castai kubectl get no` Unauthorized | kubeconfig stale | `aws eks update-kubeconfig` |

## Quick Commands

```bash
# Update kubeconfig
export AWS_REGION=us-west-2
aws eks update-kubeconfig --name karpenter-lab --region us-west-2

# Apply manifests
kubectl apply -f karpenter-production/manifests.rendered.yaml

# Run e2e test
bash karpenter-production/test.sh

# Check CLM daemonset
kubectl get daemonset castai-live-daemon -n castai-agent

# Check migrations
kubectl get migrations.live.cast.ai -A

# Destroy lab
kubectl scale deployment karpenter -n karpenter --replicas=0
kubectl delete nodeclaims --all
# terminate remaining EC2 instances tagged karpenter.sh/nodepool
eksctl delete cluster -f eksctl-karpenter-cluster-us-west-2.yaml --wait=false
```

## Reference Files

- `karpenter-production/values.yaml`
- `karpenter-production/manifests.yaml`
- `karpenter-production/manifests.rendered.yaml`
- `karpenter-production/deploy.sh`
- `karpenter-production/test.sh`
- `eksctl-karpenter-cluster-us-west-2.yaml`
- `KARPENTER-CASTAI-CLM-LEARNINGS.md`
