# DRAFT EMAIL — maxPods formula + node template sizing, PD confirmation needed (draft; human sends)

**To:** NGM platform team
**Cc:** Paul Till
**Subject:** ngm-helios / integ / kronos — proposed maxPods formula + node template sizing; prefix delegation check needed

---

Hi team,

As part of the node-configuration tuning for ngm-helios-eks, ngm-integ-eks, and ngm-kronos-eks, we propose replacing the current static `maxPods: 55` setting with CAST AI's dynamic **maxPodsPerNodeFormula**.

CAST AI recommends a dynamic formula when AWS VPC CNI manages pod networking, because the supported pod count varies by EC2 instance type based on ENI/IP capacity.

Before finalizing, please confirm whether **AWS VPC CNI Prefix Delegation** is enabled on each cluster:

- ngm-helios-eks: PD yes/no
- ngm-integ-eks: PD yes/no
- ngm-kronos-eks: PD yes/no

## How to Check

Run the following command on each cluster:

```bash
kubectl -n kube-system get ds aws-node \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ENABLE_PREFIX_DELEGATION")].value}'
```

Result:
- `true` → Prefix Delegation is enabled
- empty or `false` → Prefix Delegation is disabled

Alternatively, check your deployment pipeline (VPC CNI add-on, Helm, eksctl, or Terraform) for `ENABLE_PREFIX_DELEGATION=true` or `enablePrefixDelegation: true`.

Optional node-level check:

```bash
aws ec2 describe-network-interfaces \
  --filters Name=attachment.instance-id,Values=<instance-id> \
  --query 'NetworkInterfaces[].{IPv4Addresses: length(Ipv4Addresses), Prefixes: length(Ipv4Prefixes)}'
```

Nodes using Prefix Delegation will show attached IPv4 /28 prefixes.

## Proposed Formula Adjustments

**If Prefix Delegation is OFF**, we will use:

```
math.least( NUM_MAX_NET_INTERFACES * (NUM_IP_PER_INTERFACE - 1) + 2, 110 )
```

This adapts the pod limit to the instance type while capping it conservatively at 110 pods.

**If Prefix Delegation is ON**, we will use:

```
math.least( (NUM_MAX_NET_INTERFACES - 1) * (NUM_IP_PER_INTERFACE - 1) * NUM_IP_PER_PREFIX + 2, 300 )
```

with `ipsPerPrefix: 16`.

(Note: non-Nitro instance types will be excluded from Node Templates, as they do not support Prefix Delegation.)

## Proposed Node Template Sizing

The Maximum Pods change is part of the wider node-template tuning. Based on the current workload and fleet analysis, we propose the following starting values:

| Cluster | minCpu | minMemory | maxCpu | Rationale |
|---|---|---|---|---|
| ngm-helios-eks | 4 | 12 GiB | 24 | Matches the observed ~1:2.9 CPU:memory workload profile, removes inefficient small shapes, and gives CAST AI more packing capacity. |
| ngm-integ-eks | 4 | 16 GiB | 32 | Protects nightly burst workloads from landing on memory-constrained small nodes while allowing larger nodes for better density. |
| ngm-kronos-eks | 4 | 16 GiB | 24 | Removes inefficient small node shapes and provides enough capacity for the hibernation/resume workload profile. |

CAST AI supports Min/Max CPU and Min/Max Memory as Node Template instance constraints. These are starting values from our analysis — we're happy to iterate them with you until they fit each cluster's reality.

## Next Steps

Removing `maxPods: 55` and adjusting instance constraints allows CAST AI to place workloads on fewer, properly sized nodes rather than scaling unnecessarily — this combination is where the tuning savings come from. Nothing will be applied to any cluster until these updates pass your standard review process.

**What we need from you:**

1. **Prefix Delegation status** per cluster (yes/no — command above) so we can finalize the formula variant.
2. **Review & confirmation of the starting sizing values** in the table — accept, adjust, or flag concerns per cluster. We can conclude this in our next call.

**What we will do, in order (one observation cycle between each step):**

| Step | Cluster | Change | Observation gate |
|---|---|---|---|
| 1 | **ngm-integ-eks** | Remove static `maxPods: 55` → dynamic formula; apply minCpu/minMemory/maxCpu sizing | ~1 week of nightly burst runs — verify no scale-up storms, correct pod limits per node size, no IPAM errors |
| 2 | **ngm-kronos-eks** | Same change | One rebalancing cycle — verify the 29-pod `r6a.large` class is retired and node shapes look right |
| 3 | **ngm-helios-eks** | Same change (production, rolled last) | One nightly rebalancing window — then keep monitoring |

All changes apply to **newly provisioned nodes only** — running nodes are untouched until normal rebalancing replaces them, so no workload restarts are triggered by the settings change itself.

Once step 1 has a week of integ data, we'll share the observed numbers with you before touching kronos and helios.

Please let me know if you have any questions ahead of our call.

Best regards,
Ebrahim Ramadan
CAST AI
