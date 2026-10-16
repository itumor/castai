# Console walkthrough — creating the 3 groups as CAST AI node configs + templates
# Meeting companion, 2026-10-16 · cluster siemenstest-siemenstest-1 · org IT DF COL UC 2 (EU)
# DRAFT — for Ebrahim's use on the call; cast.ai identity only.

## Step 0 — who drives

Samuel now **has CAST AI console access** for org `IT DF COL UC 2` (as of
2026-10-16), so he can create the org API token and drive the console
steps himself; Ebrahim supports by screen-share. Also open this piece of
preparation on Samuel's side:

```bash
aws eks describe-nodegroup --region eu-west-1 \
  --cluster-name siemenstest-siemenstest-1 \
  --nodegroup-name siemenstest-siemenstest-eks-worker-20250508143800652400000003 \
  --query 'nodegroup.subnets'
```

We need: the **VPC subnets** the node groups use and the **cluster/node
security group**. The console form lists them as dropdowns, so having the
names at hand just speeds the call.

## Step 1 — Node configuration #1 (shared by web + webapp)

Console (EU) → **Clusters** → `siemenstest-siemenstest-1` → **Autoscaler**
→ **Node configuration** → **Create node configuration**:

| Field | Value |
|---|---|
| Name | `siemenstest-disk100` |
| Subnets | same private subnets the EKS node groups use (eu-west-1a/1b) |
| Security groups | the worker-node SG of the cluster (from dropdown) |
| Instance profile | the CAST AI instance profile created during onboarding (name contains `castai-eks-…`) |
| Disk size | `100` GiB |
| Key pair / AMI image / init script / tags | leave default (empty) |
| Max pods per node formula | leave default |

→ **Save**.

## Step 2 — Node configuration #2 (worker)

Same form, only two fields differ:

| Field | Value |
|---|---|
| Name | `siemenstest-disk50` |
| Disk size | `50` GiB |

→ **Save**.

## Step 3 — Node templates (3x)

**Autoscaler** → **Node templates** → **Create node template**, one per row:

### Template 1 — `siemenstest-web`
| Field | Value |
|---|---|
| Name | `siemenstest-web` |
| Node configuration | `siemenstest-disk100` |
| Default template | **no** (leave `default-by-castai` as the default) |
| Taint nodes | **off** (customer has no taints) |
| Custom labels | `CcsEnv=siemenstest`, `ccs.node.role=web` |
| On-demand | **on** |
| Spot | **off** |
| Instance families | include `r6a` |
| Min/Max CPU | `2` / `2` |
| Min/Max Memory (MiB) | `16384` / `16384` |
| Compute/storage optimized | off/default |

### Template 2 — `siemenstest-webapp`
Same as 1 except: Name `siemenstest-webapp`; label `ccs.node.role=webapp`;
families include `m5a`; Min/Max CPU `4` / `4`; Memory `32768` / `32768`.

### Template 3 — `siemenstest-worker`
Same as 1 except: Name `siemenstest-worker`; Node configuration
`siemenstest-disk50`; label `ccs.node.role=worker`.

(The CPU/memory pins keep it to the exact type today — r6a.large is the
only r6a with 2 vCPU/16 GiB. If Siemens wants freedom later, widen the
min/max ranges or add families and CAST AI will right-size within them.)

## Step 4 — What happens (and what does NOT)

- **Nothing changes immediately.** Templates only matter when CAST AI
  provisions nodes.
- When an eligible pod can't be scheduled, the autoscaler creates a CAST
  AI node from the matching template, carrying the labels
  `CcsEnv`/`ccs.node.role` — pods with the corresponding `nodeSelector`
  land on it without any manifest changes.
- The 3 existing EKS managed node groups stay **untouched**. First
  validation, then — per Siemens' decision — drain/scale-down of the old
  groups (or CAST AI rebalancing, deliberately enabled later).
- Verify afterwards: **Autoscaler → Nodes** shows new nodes with
  `Managed by: CAST AI` or via
  `kubectl get nodes --show-labels | grep cast.ai`.

## Rollback

Delete the 3 templates (Nodes templates → ⋮ → Delete). No nodes exist yet,
so removal is zero-impact; the default template keeps the cluster untouched.
