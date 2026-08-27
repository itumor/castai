# CAST AI EKS Read-Only / Savings-Assessment - Example

This directory is a ready-to-use Terraform root that installs
[CAST AI](https://www.cast.ai/) on an **already-existing EKS cluster** in
**strict read-only / savings-assessment mode**.

It does not create, modify, or import any AWS resources. It only reads cluster
metadata and installs one Helm release.

## What it deploys

- No AWS resources (no IAM, no VPC, no EKS).
- No usage of the `castai/castai` Terraform provider.
- One Helm release of the `castai` umbrella chart with `tags.readonly=true`
  and all automation tags (`full`, `node-autoscaler`, `workload-autoscaler`)
  explicitly set to `false`.

The Helm release installs only the CAST AI observability components:

- `castai-agent`
- `castai-spot-handler`
- `castai-kvisor`
- `gpu-metrics-exporter` (bundled with the observability stack)

All automation components (cluster-controller, evictor, pod-mutator,
workload-autoscaler, pod-pinner, live migration, node autoscaler) are
disabled at the Helm values level.

## Prerequisites

- Terraform `>= 1.3.2`
- AWS CLI configured with credentials that can call `eks:DescribeCluster`
  and obtain an EKS token (`eks:get-token`).
- `kubectl` is not required; providers use exec auth via the AWS CLI.
- An existing EKS cluster (created with `eksctl` or any other tool).
- A CAST AI organization-level API key.

## Usage

1. Copy the example tfvars and edit it:

   ```sh
   cp terraform.tfvars.example terraform.tfvars
   # edit cluster_name, aws_region, etc.
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
| `providers.tf`                | AWS / Kubernetes / Helm provider configuration.      |
| `variables.tf`                | Input variables (token is sensitive).                |
| `main.tf`                     | Calls the local reusable module.                     |
| `outputs.tf`                  | Pass-through of safe module outputs.                 |
| `terraform.tfvars.example`    | Example variable values.                             |

## Architecture

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the
underlying design specification and
[`../../modules/castai-eks-readonly/`](../../modules/castai-eks-readonly/)
for the reusable module that this example wraps.

## Safety notes

- `castai_api_token` is marked `sensitive` and never appears in plan output.
- `terraform.tfvars` is gitignored; do not commit it.
- Terraform state will still contain the token in clear text - in production,
  use an encrypted remote backend with strict access controls.
- Read-only mode does not provision nodes and does not require cloud IAM
  resources, so the blast radius of a misconfiguration is limited to
  observability data flowing to CAST AI.
