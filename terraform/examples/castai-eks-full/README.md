# CAST AI EKS Full-Mode Onboarding - Example

This directory is a ready-to-use Terraform root that installs
[CAST AI](https://www.cast.ai/) on an **already-existing EKS cluster** in
**full mode** (node autoscaler + workload autoscaler + security agent).

It does not create the EKS cluster, VPC, or subnets - those must already
exist and be passed in as variables.

## What it deploys

- **CAST AI IAM role and instance profile** for the cluster, scoped to the
  supplied VPC (via the official `castai/eks-role-iam` Terraform module).
- **EKS access entry + access policy association** that grants the CAST AI
  node instance profile role permission to join the cluster with the
  `AmazonEKSWorkerNodePolicy`.
- **Cluster registration with CAST AI** via `castai_eks_cluster`.
- **Helm release** of the `castai` umbrella chart (full mode) installed via
  the official `castai/eks-cluster` Terraform module. This includes the
  node autoscaler, workload autoscaler, and security agent as configured.
- **Default `castai_node_configuration` and `castai_node_template`** so CAST
  AI can start managing nodes immediately after registration.

## Prerequisites

- Terraform `>= 1.3.2`
- AWS CLI configured with credentials that can call `eks:DescribeCluster`,
  obtain an EKS token (`eks:get-token`), and create IAM resources for the
  CAST AI role.
- `kubectl` is not required; providers use exec auth via the AWS CLI.
- An existing EKS cluster (created with `eksctl` or any other tool), with
  its VPC ID and at least one subnet ID known.
- A CAST AI organization-level API key.

## Usage

1. Copy the example tfvars and edit it:

   ```sh
   cp terraform.tfvars.example terraform.tfvars
   # edit cluster_name, aws_region, vpc_id, subnets,
   # node_security_group_ids, cluster_security_group_ids, etc.
   ```

2. Supply the CAST AI API token via an environment variable (recommended):

   ```sh
   export TF_VAR_castai_api_token="<your-castai-api-token>"
   ```

   You can still keep the placeholder value in `terraform.tfvars` for
   `terraform validate` runs on machines that supply the real token
   through the environment.

3. Initialize, plan, and apply:

   ```sh
   terraform init
   terraform plan
   terraform apply
   ```

4. Inspect outputs:

   ```sh
   terraform output
   ```

## File layout

| File                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `versions.tf`                 | Terraform and provider version constraints.          |
| `providers.tf`                | AWS / Kubernetes / Helm / CAST AI provider config.   |
| `variables.tf`                | Input variables (token is sensitive).                |
| `main.tf`                     | Calls the local reusable module.                     |
| `outputs.tf`                  | Pass-through of safe module outputs.                 |
| `terraform.tfvars.example`    | Example variable values.                             |

## Architecture

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the
architecture overview and the design of the underlying reusable module at
[`../../modules/castai-eks-full/`](../../modules/castai-eks-full/).

## Upgrade and rollback

See [`../../docs/UPGRADE-ROLLBACK.md`](../../docs/UPGRADE-ROLLBACK.md) for
upgrade and rollback procedures.

## Safety notes

- `castai_api_token` is marked `sensitive` and never appears in plan output.
- `terraform.tfvars` is gitignored; do not commit it.
- Terraform state will still contain the token in clear text - in production,
  use an encrypted remote backend with strict access controls.
- Full mode provisions nodes and creates AWS IAM resources for CAST AI;
  review the planned IAM changes before applying in production.
