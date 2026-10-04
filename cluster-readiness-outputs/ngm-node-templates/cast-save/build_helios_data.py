#!/usr/bin/env python3
"""Build cast-optimise data JSON for ngm-helios-eks from verified local + live API data."""
import json

NOTE = "evictor self-managed/Incompatible (allowed=false in policies) - console cannot tune CAST evictor"

# 15 distinct argo nodes blocked by removal-disabled pod annotations (from workloads API 2026-10-04, replicas capped 25/wl)
argo_nodes = [
    ("ip-10-46-183-77.eu-central-1.compute.internal",  "argocd-repo-server",            "argo"),
    ("ip-10-46-163-63.eu-central-1.compute.internal",  "argocd-repo-server",            "argo"),
    ("ip-10-46-169-13.eu-central-1.compute.internal",  "argocd-repo-server",            "argo"),
    ("ip-10-46-222-74.eu-central-1.compute.internal",  "argocd-repo-server",            "argo"),
    ("ip-10-46-175-190.eu-central-1.compute.internal", "argocd-repo-server",            "argo"),
    ("ip-10-46-129-28.eu-central-1.compute.internal",  "argocd-repo-server",            "argo"),
    ("ip-10-46-134-126.eu-central-1.compute.internal", "argocd-repo-server",            "argo"),
    ("ip-10-46-229-114.eu-central-1.compute.internal", "argocd-repo-server",            "argo"),
    ("ip-10-46-163-60.eu-central-1.compute.internal",  "argocd-application-controller", "argo"),
    ("ip-10-46-199-214.eu-central-1.compute.internal", "argocd-applicationset-controller / argocd-server", "argo"),
    ("ip-10-46-251-22.eu-central-1.compute.internal",  "argocd-dex-server",             "argo"),
    ("ip-10-46-179-11.eu-central-1.compute.internal",  "argocd-server",                 "argo"),
    ("ip-10-46-184-255.eu-central-1.compute.internal", "argocd-server",                 "argo"),
    ("ip-10-46-255-27.eu-central-1.compute.internal",  "argocd-server",                 "argo"),
    ("ip-10-46-155-254.eu-central-1.compute.internal", "argocd-server",                 "argo"),
]

blocked_nodes = [
    {
        "node": n,
        "category": f"Removal Disabled (pod annotation; {NOTE})",
        "blocking_pod": p,
        "namespace": ns,
    }
    for n, p, ns in argo_nodes
] + [
    {
        "node": "ip-10-46-240-96.eu-central-1.compute.internal",
        "category": f"Removal Disabled (node label; {NOTE})",
        "blocking_pod": "rocket/tofu-sincal-as-a-service (Windows node-selector pods; also Not Reschedulable - no linux template match)",
        "namespace": "siemens-digital-grid-rocket / siemens-digital-grid-tofu",
    },
    {
        "node": "ip-10-46-241-184.eu-central-1.compute.internal",
        "category": f"Removal Disabled (node label; {NOTE})",
        "blocking_pod": "rocket-sincal-as-a-service (Windows node-selector pod)",
        "namespace": "siemens-digital-grid-rocket",
    },
]

data = {
    "cluster_name": "ngm-helios-eks",
    "cluster_id": "419c39e4-66bf-4d61-b833-4562968a61c7",
    "generated_at": "04 October 2026 15:36 UTC",

    "evictor": {
        "window_start": f"2026-10-01T21:06Z (audit-events window; {NOTE})",
        "window_end":   "2026-10-01T23:02Z",
        "reconcile_cycles": 2,   # rebalancing plan cycles in window (proxy; Loki evictor logs inaccessible - self-managed)
        "evictions_completed": 6,  # nodeDrained events in window (39 nodeDeleted followed)
        "blocked_nodes": blocked_nodes,
        "top_blockers": [
            {"category": f"Removal Disabled (annotation/label; {NOTE})", "count": 17},
            {"category": "Not Reschedulable - Windows selectors, no matching linux template", "count": 2},
            {"category": "Savings below threshold - rebalance plan skips (3x in 36h, plan-level)", "count": 3},
        ],
        "cross_matches": [],
    },

    # No kubectl (AWS creds expired): unhealthy list intentionally EMPTY, gap flagged in exec_summary HIGH item.
    "pod_health": {
        "unhealthy": [],
    },

    "max_pod_per_node": {
        "provider": "EKS",
        "config_summary": [
            {"node_config": "default-by-castai", "instance_type": "r6a.large",    "provider": "EKS", "max_pods": 29,  "node_count": 8},
            {"node_config": "default-by-castai", "instance_type": "m6a.xlarge",   "provider": "EKS", "max_pods": 58,  "node_count": 41},
            {"node_config": "default-by-castai", "instance_type": "r6a.xlarge",   "provider": "EKS", "max_pods": 58,  "node_count": 50},
            {"node_config": "default-by-castai", "instance_type": "m6a.2xlarge",  "provider": "EKS", "max_pods": 58,  "node_count": 51},
            {"node_config": "default-by-castai", "instance_type": "r6a.2xlarge",  "provider": "EKS", "max_pods": 58,  "node_count": 11},
            {"node_config": "default-by-castai", "instance_type": "c5a.2xlarge",  "provider": "EKS", "max_pods": 58,  "node_count": 14},
            {"node_config": "default-by-castai", "instance_type": "c6a.2xlarge",  "provider": "EKS", "max_pods": 58,  "node_count": 1},
            {"node_config": "default-by-castai", "instance_type": "m6a.4xlarge",  "provider": "EKS", "max_pods": 234, "node_count": 58},
            {"node_config": "default-by-castai", "instance_type": "r6a.4xlarge",  "provider": "EKS", "max_pods": 234, "node_count": 21},
            {"node_config": "default-by-castai", "instance_type": "c5a.4xlarge",  "provider": "EKS", "max_pods": 234, "node_count": 32},
            {"node_config": "default-by-castai", "instance_type": "c6a.4xlarge",  "provider": "EKS", "max_pods": 234, "node_count": 4},
            {"node_config": "default-by-castai", "instance_type": "c5ad.4xlarge", "provider": "EKS", "max_pods": 234, "node_count": 1},
            {"node_config": "(customer-managed, no CAST template)", "instance_type": "m7a.xlarge", "provider": "EKS", "max_pods": 58, "node_count": 8},
        ],
        "at_capacity": [],  # left empty - no kubectl to count running pods per node (gap flagged in exec summary)
    },

    "node_templates": {
        "inventory": [
            {
                "template": "default-by-castai", "count": 292,
                "arch": ["amd64"], "capacity_type": ["on-demand"], "os": ["linux"],
                "instance_types": ["c5a.2xlarge", "c5a.4xlarge", "c5ad.4xlarge", "c6a.2xlarge", "c6a.4xlarge",
                                   "m6a.2xlarge", "m6a.4xlarge", "m6a.xlarge",
                                   "r6a.2xlarge", "r6a.4xlarge", "r6a.large", "r6a.xlarge"],
                "taints": [], "gpu": False,
            },
            {
                "template": "(unmanaged - no CAST template)", "count": 8,
                "arch": ["amd64"], "capacity_type": ["on-demand"], "os": ["linux"],
                "instance_types": ["m7a.xlarge"],
                "taints": ["windowsOnly=true:NoExecute"], "gpu": False,
            },
        ],
        "merge_candidates": [],  # single CAST template - nothing to merge
        "keep_separate": [
            {"template": "(unmanaged - 8x m7a.xlarge)",
             "reason": "Customer-managed Windows-only nodes (windowsOnly:NoExecute taint, removal-disabled labels, addedBy empty). Not CAST-provisioned; keep outside default-by-castai."},
        ],
        "misconfigured": [],
        "spot_templates": [],  # spot disabled - deprecation advisory carried in exec summary instead
    },

    "nt_resource_profile": {
        "templates": [
            {"template": "default-by-castai", "node_count": 292,
             "cpu_vcpu": 2376.6, "mem_gi": 5955.0,
             "ratio_str": "1:2.5", "pattern": "general-purpose",
             "recommendation": "m6i/m7g (AWS) · n2-standard (GCP) · Dsv5 (Azure)"},
            {"template": "(unmanaged - no CAST template)", "node_count": 8,
             "cpu_vcpu": 23.8, "mem_gi": 26.0,
             "ratio_str": "1:1.1", "pattern": "compute-heavy",
             "recommendation": "c6i/c7g (AWS) · n2-highcpu (GCP) · Fsv2 (Azure)"},
        ],
        "ds_advisory": False,      # DaemonSet share 3.0% of requested CPU < 15% threshold
        "ds_cpu_pct": 3.0,
        "total_nodes": 300,
    },

    "woop_rollout": {
        "active": True,            # WOOP agent RUNNING v1.10.4 (latest v1.14.1), metrics-only (optimizedCount=0)
        "total_checked": 3592,
        "ok": 0,
        "warnings": 0,
        "action_needed": 0,
        "issues": [],              # all workloads READ_ONLY; per-workload rollout/zero-downtime not gradable - see exec summary HIGH item
    },

    "exec_summary": {
        "critical": [
            {"area": "Max Pod Per Node",
             "finding": "Static kubelet maxPods=55 (node configuration ngm-helios-castai, kubeletConfig.maxPods) exceeds the AWS VPC-CNI ENI/IPAM limit of 29 IPs on large-class instances: 8 r6a.large nodes are live. The scheduler can place up to 55 pods but pods beyond 29 cannot receive an IP and will fail to start.",
             "action": "Exclude large-class instances from default-by-castai constraints (or set per-size maxPods / enable prefix delegation), then roll the 8 r6a.large nodes."},
        ],
        "high": [
            {"area": "Evictor",
             "finding": f"Evictor is self-managed and reported Incompatible by the policy API (allowed=false, status=Incompatible) - consolidation settings cannot be tuned from the CAST AI console. Blocked-node evidence in this report is proxied from audit events, problematic-nodes and the workloads API, not evictor/Loki logs.",
             "action": "Switch to CAST-managed evictor (helm upgrade --set autoscaler.castai-evictor.managedByCASTAI=true) or adopt the recommended Helm values for cycleInterval/maxTargetNodesPerCycle."},
            {"area": "Pod Health",
             "finding": "Live pod-state scan requires kubectl access (AWS credentials expired): the unhealthy-pod list is empty because no scan was possible, NOT a verified-clean result. Unscheduled pods verified = 0 via CAST AI API on report date (Sunday trough).",
             "action": "Restore kubectl credentials and rerun the pod-health probe before treating pod health as clean."},
            {"area": "WOOP Rollout",
             "finding": "WOOP is metrics-only on this cluster: 3,592 workloads in READ_ONLY, optimizedCount=0, workload-autoscaler v1.10.4 vs latest v1.14.1, resourceQuotasAffectingOptimization=true. Requests run 7-21x live usage over 30d (peak day 1,897 requested vs 225 used cores, 2026-09-18).",
             "action": "Upgrade workload-autoscaler to v1.14.x, resolve ResourceQuota interference, then graduate workloads from READ_ONLY to managed optimization in waves."},
        ],
        "medium": [
            {"area": "Evictor",
             "finding": "17 of 300 nodes blocked from consolidation: 15 CAST nodes pinned by argo removal-disabled pod annotations, plus 2 customer-managed m7a.xlarge nodes with removal-disabled labels hosting Windows-selector sincal workloads.",
             "action": "Review the argo removal-disabled annotations (repo-server, server, dex, applicationset, application-controller); keep the 2 Windows nodes as permanent exceptions."},
            {"area": "Node Templates",
             "finding": "c5a/c5ad (5th-generation) account for 47 of 300 nodes (15.7%) while default-by-castai already allows 6th/7th/8th-gen AMD families.",
             "action": "Deprioritise or exclude c5a/c5ad in the template constraints to drift the fleet to newer generations for better price/performance."},
            {"area": "Node Templates",
             "finding": "Spot is disabled, but the default template pins spotInterruptionPredictionsType=aws-rebalance-recommendations, which is a deprecated signal source.",
             "action": "Switch default-by-castai to the CAST AI spot predictions model before any spot pilot (or remove the deprecated setting)."},
            {"area": "Rebalancing",
             "finding": "Hourly-nightly schedule skipped 3x in 36h with 'generated plan did not meet trigger conditions' (achieved savings below the 20% schedule trigger / 5% execution condition).",
             "action": "Lower triggerConditions.savingsPercentage toward 10% for more consistent nightly consolidation, and rerun rebalances after the maxPods and c5a fixes land."},
        ],
    },
}

out = "/Users/eramadan/castai/cluster-readiness-outputs/ngm-node-templates/cast-save/ngm-helios-eks-cast-optimise-data.json"
with open(out, "w") as f:
    json.dump(data, f, indent=2)
print("written:", out)
print("blocked nodes:", len(blocked_nodes))
