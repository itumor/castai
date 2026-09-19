# CAST AI one-apply EKS onboarding

Terraform stack for connecting one existing Amazon EKS cluster to CAST AI. It creates required AWS IAM resources, authorizes CAST AI nodes through an EKS Access Entry, installs core CAST AI components, and enables node autoscaling.

Default capacity policy prefers Spot instances and falls back to on-demand capacity. Optional products such as workload autoscaling, Kvisor, Egressd, Omni, AI Optimizer, and CAST AI Live are disabled.

## Requirements

- Terraform 1.11 or newer, but earlier than 2.0
- AWS CLI v2 available to Terraform's Helm provider
- Existing EKS cluster using `API` or `API_AND_CONFIG_MAP` authentication
- AWS credentials permitted to read EKS/VPC metadata and manage IAM and EKS Access Entries
- Kubernetes access to the EKS API endpoint from the Terraform runner
- CAST AI API token with permission to onboard and configure the cluster
- Existing, access-controlled S3 bucket for encrypted Terraform state and lockfiles
- Private worker subnets and worker-compatible security groups from the EKS VPC

The stack rejects legacy `CONFIG_MAP`-only clusters. Migrate the cluster to EKS Access Entries before applying. See [AWS EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html).

## Configure

Create local configuration files:

```bash
cp terraform.tfvars.example terraform.tfvars
cp backend.hcl.example backend.hcl
```

Edit both files. Set the real cluster name, AWS Region, private subnet IDs, worker security group IDs, maximum cluster vCPU, and S3 backend values.

Do not put the CAST AI token in a file. Export it as a sensitive Terraform variable:

```bash
export TF_VAR_castai_api_token='replace-with-castai-api-token'
```

AWS authentication uses the normal SDK credential chain. To force a shared AWS CLI profile, set `aws_profile` in `terraform.tfvars`. The same profile is passed to `aws eks get-token` for Helm access.

## Install

Initialize the pinned providers and official CAST AI modules:

```bash
terraform init -backend-config=backend.hcl
```

Review the change set:

```bash
terraform fmt -check -recursive
terraform validate
terraform test
terraform plan -out=castai.tfplan
```

Apply once:

```bash
terraform apply castai.tfplan
```

CAST AI waits for the cluster to report ready before Terraform completes.

## Verify

Check Terraform outputs and CAST AI pods:

```bash
terraform output
aws eks list-access-entries --cluster-name my-eks-cluster --region eu-central-1
kubectl get pods -n castai-agent
```

Replace the example cluster name and Region in the AWS command.

Use the CAST AI console to confirm the cluster is connected and ready. In a non-production cluster, deploy a workload larger than current free capacity and confirm CAST AI creates a Spot node or on-demand fallback. Remove the workload and confirm an empty eligible node is removed after the configured delay and grace period.

## Safety behavior

Active autoscaling can provision nodes, evict workloads while honoring pod disruption budgets, and remove eligible empty nodes. Test this stack against a non-production cluster first.

`max_cluster_cpu_cores` is required. It acts as the autoscaler cost guardrail. The default minimum is one vCPU.

The stack validates that supplied subnets and security groups belong to the EKS VPC. It also rejects subnets with public-IP auto-assignment. This does not inspect route tables; verify that supplied subnets are private and have required outbound connectivity.

Terraform state contains sensitive cluster material. Keep `backend.hcl`, `terraform.tfvars`, plans, and local state out of version control. Restrict and audit access to the S3 backend.

## Disconnect

Review destruction first:

```bash
terraform plan -destroy
terraform destroy
```

`delete_nodes_on_disconnect` defaults to `false`. Destroy disconnects CAST AI but retains CAST AI-created EC2 nodes. Confirm replacement capacity exists before disconnecting. Set the variable to `true` only when node deletion is intentional.

## Troubleshooting

- `CONFIG_MAP` authentication error: migrate EKS authentication to `API_AND_CONFIG_MAP` or `API`.
- Helm timeout or connection error: ensure the Terraform runner can reach the EKS endpoint and `aws eks get-token` succeeds.
- VPC validation error: provide private subnet and worker security group IDs from the cluster VPC.
- Existing IAM, Access Entry, or Helm resource conflict: import the existing object into this state or remove the conflicting unmanaged installation before retrying.
- Read [CAST AI Terraform troubleshooting](https://docs.cast.ai/docs/terraform-troubleshooting) for product-specific failures.

## Versions

- [CAST AI Terraform provider](https://github.com/castai/terraform-provider-castai): `~> 8.53`
- [CAST AI EKS cluster module](https://github.com/castai/terraform-castai-eks-cluster): `14.6.1`
- [CAST AI EKS IAM module](https://github.com/castai/terraform-castai-eks-role-iam): `2.0.4`
