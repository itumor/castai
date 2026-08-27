# CAST AI EKS Onboarding — Upgrade and Rollback

This document covers two operational procedures for the
`terraform/modules/castai-eks-*` modules:

1. **Upgrade** — promote a cluster from read-only onboarding to full
   onboarding (or vice versa).
2. **Rollback / uninstall** — cleanly remove CAST AI from a cluster.

Both procedures target an **existing EKS cluster** that you continue to
operate. The EKS cluster itself is never destroyed by these modules.

---

## Upgrade from read-only to full

Read-only and full modes are implemented as **separate Terraform
modules**, not as a flag inside one module. The upgrade therefore
swaps the module source in your Terraform configuration.

### 1. Edit your configuration

In the root module that currently calls `castai-eks-readonly`, replace
the `source` and pass the additional variables required by
`castai-eks-full`:

```hcl
# Before (read-only)
module "castai" {
  source = "../../modules/castai-eks-readonly"

  cluster_name    = var.cluster_name
  aws_region      = var.aws_region
  castai_api_token = var.castai_api_token
}

# After (full)
module "castai" {
  source = "../../modules/castai-eks-full"

  cluster_name    = var.cluster_name
  aws_region      = var.aws_region
  vpc_id          = var.vpc_id
  subnets         = var.subnets
  node_security_group_ids = var.node_security_group_ids
  castai_api_token = var.castai_api_token
}
```

If you use the example root at `terraform/examples/castai-eks-full`,
switch the root module to call that example directly and pass the same
inputs. The example expects:

- `cluster_name`
- `aws_region`
- `aws_profile` (optional)
- `vpc_id`
- `subnets`
- `node_security_group_ids`
- `cluster_security_group_ids` (optional)
- `castai_api_token`
- `api_url`, `grpc_url` (optional, defaults provided)
- `dns_cluster_ip` (optional)
- `delete_nodes_on_disconnect` (default `false`)
- `install_security_agent` (default `true`)
- `install_workload_autoscaler` (default `true`)
- `castai_namespace` (default `castai-agent`)

### 2. Re-initialise, plan, and apply

```bash
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```

What happens:

- The Helm release installed by read-only mode is **upgraded in place**
  by the upstream `castai/eks-cluster` module — no manual Helm delete
  or namespace teardown is required.
- The Helm release will pick up the full-mode tag set, which enables
  the automation components (cluster-controller, evictor, pod-mutator,
  workload-autoscaler, pod-pinner, live, kvisor if enabled).
- New IAM resources (role, inline policy, instance profile named
  `castai-eks-${cluster_name}`) and the EKS access entry for the node
  instance profile role are created.
- A default `castai_node_configuration` and `castai_node_template`
  (`default_by_castai`) are registered with CAST AI.

### 3. Validate the upgrade

See **Validation commands** below.

---

## Validation commands

Run these from a workstation that has AWS CLI, `kubectl`, and the
Helm CLI configured.

### 3a. Verify the CAST AI assume-role path

```bash
aws sts assume-role \
  --role-arn "$(terraform output -raw assume_role_arn)" \
  --role-session-name castai-verify
```

A successful response contains `Credentials.AccessKeyId`,
`Credentials.SecretAccessKey`, `Credentials.SessionToken`, and
`Credentials.Expiration`. If AWS returns `AccessDenied`, the trust
policy on `castai-eks-${cluster_name}` does not include your caller
ARN — re-apply the upstream `castai-eks-role-iam` module so the
trust is rebuilt.

### 3b. Verify the cluster-controller RBAC

```bash
kubectl auth can-i list nodes \
  --as=system:serviceaccount:castai-agent:castai-agent
```

Expected output: `yes`.

### 3c. Verify that pods are running

```bash
kubectl get pods -n castai-agent
```

Expected output: every component pod (agent, cluster-controller,
evictor, pod-mutator, workload-autoscaler, pod-pinner, kvisor, and so
on) shows `Running` and is `READY` `1/1` (or `2/2` for sidecar pods).

### 3d. Verify the CAST AI cluster registration

```bash
terraform output castai_cluster_id
# or, depending on root output naming:
terraform output cluster_id
```

A non-empty UUID confirms the cluster is registered. The variable name
in `terraform/examples/castai-eks-full/outputs.tf` is `cluster_id`.

### 3e. Verify in the CAST AI console

Open the CAST AI console and check that the cluster status reads
**Connected** and that node, workload, and policy recommendations are
flowing.

---

## Rollback / uninstall

There are three layers to remove:

1. CAST AI Terraform resources (IAM, access entry, node config/template,
   cluster registration, Helm release).
2. Kubernetes namespace and any residual Helm releases.
3. IAM role / policy / instance profile (only if step 1 did not remove
   them).

### Step 1 — Terraform destroy (preferred)

If you used `terraform/examples/castai-eks-full`, run:

```bash
cd terraform/examples/castai-eks-full
terraform destroy
```

This removes, in order:

- The Helm release installed by the upstream `castai-eks-cluster`
  module (cluster-controller, evictor, pod-mutator, etc.).
- The default `castai_node_configuration` and `castai_node_template`
  in CAST AI.
- The EKS access entry and access policy association created by the
  module (`aws_eks_access_entry.castai_nodes` and
  `aws_eks_access_policy_association.castai_nodes_worker`).
- The IAM role, inline policy, and instance profile
  `castai-eks-${cluster_name}` created by the upstream
  `castai-eks-role-iam` module.
- The `castai_eks_clusterid` and `castai_eks_user_arn` resources, which
  deregister the cluster from CAST AI.

### Step 2 — Remove Helm releases and namespace manually

If the Helm release cannot be destroyed via Terraform (for example
because state was lost or the module was removed before destroy), use
the Helm CLI directly:

```bash
helm uninstall castai -n castai-agent
# In case additional releases were created manually:
helm list -n castai-agent
helm uninstall <release-name> -n castai-agent

kubectl delete namespace castai-agent
```

### Step 3 — Remove IAM resources manually

When the IAM resources were provisioned **outside** Terraform (or when
the Terraform state was discarded), remove them with the AWS CLI:

```bash
# Detach the policy from the role first.
aws iam detach-role-policy \
  --role-name castai-eks-${cluster_name} \
  --policy-arn arn:aws:iam::${aws_account_id}:policy/castai-eks-${cluster_name}

# Remove the role from the instance profile.
aws iam remove-role-from-instance-profile \
  --instance-profile-name castai-eks-${cluster_name} \
  --role-name castai-eks-${cluster_name}

# Delete the instance profile.
aws iam delete-instance-profile \
  --instance-profile-name castai-eks-${cluster_name}

# Delete the inline policy from the role (if any remain), then the role.
aws iam delete-role-policy \
  --role-name castai-eks-${cluster_name} \
  --policy-name <inline-policy-name>

aws iam delete-role \
  --role-name castai-eks-${cluster_name}
```

### Warnings

- **`delete_nodes_on_disconnect`.** If you set this input to `true` in
  the full module, CAST AI will **terminate every node it manages** as
  soon as the cluster-controller loses contact with the CAST AI
  control plane. Disable this flag before destructive operations
  (cluster delete, controller restart, network partition) unless you
  intentionally want CAST AI to drain your nodes.
- **State and secrets.** After destroy, rotate the CAST AI API token
  if you suspect it was exposed in Terraform state, CI logs, or
  backups. The token never leaves Terraform outputs, but it can leak
  through state files.
- **Node draining.** CAST AI-managed nodes will not be drained by
  Kubernetes when their IAM role is removed; if you skip the Terraform
  destroy and remove the role manually while pods are still running,
  the next node replacement will fail until the role is restored.
- **Cluster-controller finalizers.** If pods get stuck in
  `Terminating`, check for finalizers on CAST AI CRDs and on the
  namespace:

  ```bash
  kubectl get ns castai-agent -o yaml
  kubectl api-resources --api-group=castai.ai | head
  ```

---

## Mode comparison quick reference

| Aspect                | Read-only (`castai-eks-readonly`)        | Full (`castai-eks-full`)                          |
| --------------------- | ---------------------------------------- | -------------------------------------------------- |
| Module source         | `modules/castai-eks-readonly`            | `modules/castai-eks-full`                         |
| Providers required    | `aws`, `kubernetes`, `helm`              | `aws`, `kubernetes`, `helm`, `castai`             |
| IAM created           | none                                     | role + inline policy + instance profile           |
| EKS access entry      | none                                     | yes (`EC2_LINUX` + `AmazonEKSWorkerNodePolicy`)   |
| Cluster registration  | not registered via Terraform             | registered via `castai_eks_clusterid`             |
| `castai_user_arn`     | not used                                 | used in role trust policy                         |
| Default node config   | none                                     | `default` (subnets, SGs, instance profile)        |
| Default node template | none                                     | `default_by_castai`                                |
| Components installed  | agent, spot-handler, kvisor, gpu-metrics | + cluster-controller, evictor, pod-mutator, workload-autoscaler, pod-pinner, live |
| Recommended use       | evaluate CAST AI, observability only     | full node + workload autoscaling                  |
| Rollback complexity   | delete one Helm release                  | Terraform destroy + optional IAM cleanup          |
