# Cast AI Product Map

## Core Products (this stack)
- **Autoscaling** — node autoscaler, spot fallback, evictor, cluster limits.
- **Node Configuration** — subnets, security groups, instance profiles, tags.
- **Node Templates** — default/spot/on-demand constraints.

## Optional Products (disabled by default in this stack)
| Product | Terraform flag | Purpose |
|---------|---------------|---------|
| Workload Autoscaler | `install_workload_autoscaler` | Right-size workloads |
| Workload Autoscaler Exporter | `install_workload_autoscaler_exporter` | Metrics export |
| Pod Mutator | `install_pod_mutator` | Inject runtime configs |
| Security Agent (Kvisor) | `install_security_agent` | Runtime security |
| Egressd | `install_egressd` | Network cost visibility |
| CAST AI Live | `install_live`, `install_live_cni` | Live debugging |
| AI Optimizer | `install_ai_optimizer` | AI-driven optimization |
| Omni | `install_omni` | Cross-cloud cluster management |

## Common Customer Requests
1. "Enable workload autoscaler" → set `install_workload_autoscaler = true`, re-apply.
2. "Why no Spot?" → check constraints, capacity, taints.
3. "How to disconnect?" → `terraform destroy`, set `delete_nodes_on_disconnect` if needed.
4. "Can I use IPv6?" → `enable_ipv6` is set automatically from EKS `ip_family`.

## Terraform Module Versions
- `castai/eks-cluster/castai`: 14.6.1
- `castai/eks-role-iam/castai`: 2.0.4
- Provider `castai/castai`: ~> 8.53
