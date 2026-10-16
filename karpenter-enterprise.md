---
updatedAt: 2026-09-14T19:36:57.000Z
agentTools:
  projectIndex: https://docs.cast.ai/llms.txt
---

# Overview

Karpenter Enterprise suite is a suite of optimization features designed to work alongside open-source Karpenter. Rather than replacing Karpenter, Karpenter Enterprise suite extends it with capabilities that help you capture additional savings, improve operational stability, and gain visibility into cluster efficiency.

# Why Karpenter Enterprise suite

Open-source Karpenter handles Pod scheduling and Node provisioning effectively. However, organizations running Karpenter at scale often encounter gaps that the open-source project doesn't address:

**Cost visibility gaps**\
Karpenter provisions Nodes based on Pod requirements, but has no awareness of your organization's Reserved Instances, Savings Plans, or negotiated discounts. This can lead to underutilized commitments and missed savings opportunities.

**Consolidation limitations**\
Karpenter's built-in consolidation works at the Node level but doesn't coordinate with workload rightsizing or account for the actual resource utilization patterns of your applications.

**Spot reliability concerns**\
While Karpenter supports Spot Instances, it treats all Spot pools equally and relies on the standard two-minute interruption warning. Teams often limit Spot adoption due to unpredictable interruptions.

**Operational overhead**\
After Spot fallback to On-Demand, clusters can accumulate expensive Nodes that remain in place long after Spot capacity becomes available again. This requires manual intervention to recover cost savings.

Karpenter Enterprise suite addresses these gaps by layering Cast AI's optimization capabilities on top of your existing Karpenter deployment.

# How Karpenter Enterprise suite works

Karpenter Enterprise suite uses a non-intrusive approach that preserves your existing Karpenter configuration while adding enterprise capabilities through Cast AI components.

## Architecture

When you connect a Karpenter-managed cluster to Cast AI, the platform deploys Castware components alongside your existing Karpenter installation:

* **[Cast AI Agent](https://docs.cast.ai/castai/docs/about-the-read-only-agent)** collects cluster metrics and workload data
* **[Cluster Controller](https://docs.cast.ai/castai/docs/cluster-controller)** coordinates optimization actions with Karpenter
* **[Kentroller](https://docs.cast.ai/castai/docs/hosted-components#karpenter-specific-components)**  coordinates Cast AI optimization and automation features with Karpenter
* **[CLM Controller](https://docs.cast.ai/castai/docs/clm-overview)** orchestrates zero-downtime container migrations
* **[Spot Handler](https://docs.cast.ai/castai/docs/spot-handler)** manages Spot Instance lifecycle and fallback recovery
* **[Pod Mutator](https://docs.cast.ai/castai/docs/pod-mutations-quickstart)** automates Pod spec adjustments for optimal placement
* **[Workload Autoscaler](https://docs.cast.ai/castai/docs/workload-autoscaling-overview)** handles continuous rightsizing

These components work with Karpenter's existing CRDs and node provisioning logic. Cast AI guides Karpenter's decisions through CRD modifications and policy adjustments rather than replacing its core functionality.

## CRD-first approach

Karpenter users expect to manage configuration through Kubernetes Custom Resource Definitions. Karpenter Enterprise suite maintains this pattern—Cast AI modifies Karpenter CRDs to influence provisioning decisions while keeping configuration in the Kubernetes-native format you're already using.

For example, when Cast AI identifies under-utilized Reserved Instances in a specific instance family, it can adjust your NodePool CRDs to prioritize that family for new capacity. Once those commitments are fully utilized, the configuration shifts to prefer the most cost-effective alternatives available.

## Concept mapping

If you're familiar with Cast AI's standard Autoscaler, the following table shows how Karpenter concepts map to Cast AI equivalents:

| Karpenter concept                                                     | Cast AI equivalent | Role                                                                                                 |
| --------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| [NodePool](https://karpenter.sh/docs/concepts/nodepools/)             | Node Template      | Defines constraints for Node provisioning: instance types, zones, capacity types, taints, and labels |
| [EC2NodeClass](https://karpenter.sh/docs/concepts/nodeclasses/) (AWS) | Node Configuration | Defines cloud-provider-specific settings: AMI, security groups, subnets, etc.                        |

With Karpenter Enterprise suite, you continue using NodePools and EC2NodeClasses. Cast AI reads and, when optimization features are enabled, modifies these CRDs to steer provisioning decisions—but your existing resources remain the source of truth.

If you later migrate to Cast AI Autoscaler, your NodePools will be replaced by Node Templates, and your EC2NodeClasses will be replaced by Node Configurations. For details, see [Migration from Karpenter](https://docs.cast.ai/castai/docs/migration-from-karpenter).

# Key capabilities

## Savings analysis and reporting

Before you enable any optimization, Cast AI analyzes your Karpenter-managed cluster and generates a savings report showing specific optimization opportunities.

<Cards columns={2}>
  <Card title="Compute costs" icon="fa-server">
    Compare current spending against optimized configurations that use spot instances, right-sized nodes, and commitment-based pricing where applicable.
  </Card>

  <Card title="Node utilization" icon="fa-chart-bar">
    Review how efficiently workloads are packed onto nodes and identify opportunities to reduce waste from underutilized capacity.
  </Card>

  <Card title="Commitment utilization" icon="fa-calendar-check">
    See how well Reserved Instances and Savings Plans are being used, and where gaps exist that could be filled with on-demand or spot instances.

    <Callout icon="📘" theme="info">
      Planned for a future release.
    </Callout>
  </Card>

  <Card title="Workload rightsizing" icon="fa-sliders-h">
    Identify pods with resource requests that don't match actual usage patterns, allowing you to adjust requests and reduce node footprint.
  </Card>
</Cards>

This report shows the difference between what Karpenter delivers and what additional optimization is possible with Cast AI. You can use the free reporting tier indefinitely without enabling active optimization.

## Commitments

Karpenter provisions capacity based on Pod requirements alone, so it can keep paying full price while your Reserved Instances and Savings Plans sit unused. Karpenter Enterprise suite closes this gap with high-weight *shadow NodePools* that Karpenter prefers over your regular NodePools, steering new capacity toward committed instance types.

Commitments are imported and assigned through the Cast AI console — everything else is automatic:

* Assigned commitments are synced to the cluster as `CommitmentBudget` resources
* Kentroller creates the shadow NodePools, rebalances their limits based on observed usage, and cleans them up when commitments are unassigned
* Zonal and regional Reserved Instances, Compute Savings Plans, and EC2 Instance Savings Plans are supported
* Your existing NodePools are not modified

For details, see [Commitments in Karpenter Enterprise](https://docs.cast.ai/castai/docs/karpenter-enterprise-commitments).

## Continuous rebalancing

Kentroller's [Continuous Rebalancing](https://docs.cast.ai/castai/docs/karpenter-enterprise-continuous-rebalancing) monitors your cluster on a recurring cycle and consolidates underutilized nodes. When enabled, it takes over consolidation from Karpenter entirely — Karpenter continues handling drift detection, but cost-driven consolidation runs exclusively through Kentroller. Unlike standard eviction, this integration:

* Coordinates with [Workload Autoscaler](https://docs.cast.ai/castai/docs/workload-autoscaling-overview) to account for actual resource usage, including pending rightsizing recommendations not yet applied to Pods
* Uses [Container Live Migration](https://docs.cast.ai/castai/docs/clm-overview) (when available) to move workloads without restarts
* Runs only when projected savings meet configured thresholds, avoiding unnecessary churn
* Offers fine-grained control over what gets consolidated and how — including per-Pod and per-Node eviction policies, configurable modes, and node exclusions — going well beyond what Karpenter's native consolidation exposes

The result is tighter bin-packing with reduced disruption to running applications.

![](https://files.readme.io/6d7a047dcb6871b5ab275cfa3192fddb71b29cf533636599fb248592d0ed1a50-image.png)

## Cluster rebalancing

While Karpenter optimizes at the Node level, Cast AI's [Rebalancer](https://docs.cast.ai/castai/docs/rebalancing) operates across the entire cluster to identify optimization opportunities that span multiple NodePools:

* Identifies Nodes that could be replaced with more cost-effective alternatives
* Coordinates replacements to maintain workload stability
* Accounts for constraints like availability zones, architecture requirements, and capacity types
* Avoids recently failing instance type, zone, and capacity type combinations based on observed capacity failures
* Works alongside Karpenter's provisioning rather than competing with it

![](https://files.readme.io/9639fdf490f4c0c17f84d90263514aff2de1b9ffb2845e5070f968979af50db5-image.png)

## Spot intelligence

Cast AI enhances Karpenter's Spot Instance handling with prediction, reporting, and reliability capabilities:

**Interruption prediction**\
Cast AI's prediction model identifies at-risk Nodes up to 30 minutes before interruptions occur—extending AWS's standard two-minute warning significantly. This additional lead time enables graceful workload migration with minimal disruption.

**Observed interruptions**
Kentroller reports observed Spot interruptions in Karpenter-backed clusters. Cast AI uses these observations with other capacity data to improve Spot capacity intelligence.

**Spot reliability model** (coming in future releases)
Cast AI maintains global telemetry across connected clusters to identify which Spot pools have historically stable capacity. By steering Karpenter toward reliable pools, interruptions can be reduced substantially compared to random pool selection.

### Spot fallback recovery

<Callout icon="📘" theme="info">
  Spot fallback recovery is planned for a future release. Currently, if Karpenter falls back to On-Demand due to Spot unavailability, those Nodes remain On-Demand until manually replaced or consolidated.
</Callout>

When Spot capacity is unavailable, Karpenter falls back to On-Demand instances. The problem is that these fallback Nodes often remain in place long after Spot capacity returns, accumulating unnecessary costs.

Cast AI's [Spot Handler](https://docs.cast.ai/castai/docs/spot-handler) monitors market conditions and automatically recovers Spot capacity when it becomes available. This bidirectional fallback ensures clusters don't get stuck on expensive On-Demand Nodes.

## Workload rightsizing

Most Kubernetes workloads are over-provisioned. Requests are set conservatively, leaving clusters with significant waste that Karpenter can't address because it provisions based on what Pods request, not what they actually use.

[Workload Autoscaler](https://docs.cast.ai/castai/docs/workload-autoscaling-overview) continuously learns actual resource utilization and adjusts requests to match reality. This tighter fit enables better bin-packing and reduces the total compute capacity your cluster requires.

Workload Autoscaler integrates with [Continuous Rebalancing](https://docs.cast.ai/castai/docs/karpenter-enterprise-continuous-rebalancing) and [Rebalancer](https://docs.cast.ai/castai/docs/rebalancing) so that rightsizing decisions flow through to Node-level optimization automatically.

![](https://files.readme.io/5a8175915e9ed6a0297ab05f63169959e37b9c6d477a2bce620164131c8fd198-image.png)

## Pod mutations

For teams onboarding existing clusters to Cast AI, [Pod mutations](https://docs.cast.ai/castai/docs/pod-mutations-quickstart) automate the configuration changes needed to take advantage of optimization features. Rather than updating every Deployment manifest, you define mutation rules that automatically apply labels, tolerations, and NodeSelectors to matching Pods.

For teams that have already onboarded and seek to take advantage of Spot Instances, Pod mutations allow for proportionally distributing Pods across On-Demand and Spot Instances automatically based on assigned labels.

# What Karpenter Enterprise suite doesn't change

Karpenter Enterprise suite is designed to be non-intrusive:

* **Your NodePools remain yours** – Cast AI works with your existing NodePool definitions
* **Karpenter continues provisioning** – Node creation and deletion flow through Karpenter
* **Rollback is straightforward** – Removing Cast AI components returns your cluster to its original Karpenter-only state
* **No vendor lock-in** – Your Karpenter configuration remains portable

# Unsupported configurations

**Running Cast AI Autoscaler alongside Karpenter**\
Karpenter Enterprise suite is designed for clusters where Karpenter is the sole node provisioner. Running Cast AI's standard node autoscaler and Karpenter together in the same cluster is not supported and will result in undefined behavior.

# Switch from Karpenter Enterprise suite to Cast AI Autoscaler

If you onboarded your cluster with the Karpenter option and want to use the standard Cast AI Autoscaler instead, you must off-board the cluster from Cast AI and re-onboard it as a standard EKS cluster.

To switch:

1. **Off-board the cluster from Cast AI** by deleting the `castai-agent` namespace. This removes all Cast AI components from the cluster:

   ```shell
   kubectl delete namespace castai-agent
   ```

2. **Uninstall Karpenter** from the cluster if you no longer want to use it as your node provisioner. Refer to the [Karpenter documentation](https://karpenter.sh/docs/getting-started/getting-started-with-karpenter/#cleanup) for removal steps.

3. **Re-onboard the cluster** in the Cast AI console. Click **Connect cluster**, select **EKS** as your provider, and choose **Other** (not Karpenter) as your autoscaling tool. Run the generated onboarding script.

The re-onboarded cluster will have access to use Cast AI Node Autoscaler.

<Callout icon="📘" theme="info">
  The off-boarding step removes Cast AI components only. Your nodes, pods, and Kubernetes configuration remain intact throughout the process.
</Callout>

# Next steps

Ready to see what optimization is available for your Karpenter cluster?

[Get started with Karpenter Enterprise suite](https://docs.cast.ai/castai/docs/karpenter-enterprise-getting-started) – Connect your cluster and view your optimization potential

# Related resources

* [Karpenter Enterprise suite features](https://docs.cast.ai/castai/docs/karpenter-enterprise-features) – Feature details and Karpenter integration
* [Commitments in Karpenter Enterprise](https://docs.cast.ai/castai/docs/karpenter-enterprise-commitments) – How AWS commitments are put to work in Karpenter clusters