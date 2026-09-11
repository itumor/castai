# Karpenter + CAST AI Coexistence

## Supported model

Use **Karpenter as the sole node provisioner** and layer the **CAST AI
Karpenter Enterprise suite** on top:

- Karpenter: provisions nodes, handles drift, interruption, empty-node
  deletion.
- CAST AI Agent: streams cluster state to CAST AI SaaS.
- Kentroller: generates `RebalancePlan`s, creates `NodeClaim`s through
  Karpenter.
- Workload Autoscaler: rightsizes pod requests.
- Pod Mutator / Spot Handler: distribution and interruption telemetry.

This is CAST AI's documented design pattern.

## Not supported

Running CAST AI's standard Node Autoscaler (`tags.node-autoscaler=true` or
`tags.full=true`) alongside Karpenter on the same cluster. Two provisioners
independently creating/deleting nodes = undefined behaviour.

## Key conflicts to avoid

| Conflict | Mitigation |
|---|---|
| Dual provisioners | Use `kent.enabled=true`, never `tags.node-autoscaler=true` |
| Consolidation overlap | Let Kentroller own consolidation; configure Karpenter disruption budgets |
| Workload Autoscaler vs manual requests | Start in deferred mode |
| Spot interruption overlap | Ensure Karpenter `--interruption-queue` is configured |

## Migration options

### Option A — Keep Karpenter + add CAST AI Enterprise (recommended)

```bash
helm upgrade -i castai castai \
  --repo https://castai.github.io/helm-charts \
  -n castai-agent --create-namespace \
  --set kent.enabled=true \
  --set global.castai.provider=eks \
  --set global.castai.apiKey="$CASTAI_API_KEY"
```

### Option B — Move to full CAST AI Autoscaler

Requires off-boarding CAST AI, uninstalling Karpenter, re-onboarding as
standard EKS, then importing Karpenter NodePools/EC2NodeClasses into CAST
AI Node Templates/Configurations.

## Sources

- CAST AI Karpenter Enterprise: https://docs.cast.ai/docs/karpenter-enterprise
- Kentroller: https://docs.cast.ai/docs/karpenter-enterprise-kentroller
- Migration from Karpenter: https://docs.cast.ai/docs/migration-from-karpenter

## Project lab

The `karpenter-lab` cluster in `us-west-2` / `eu-central-1` is the repro
environment. See `README.md`, `karpenter-production/`, and
`KARPENTER-CASTAI-CLM-LEARNINGS.md`.
