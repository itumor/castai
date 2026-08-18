# How to Run the Terraform Commands

This guide covers the exact commands to initialize, validate, plan, apply, and verify the CAST AI read-only installation on the existing EKS cluster.

---

## Prerequisites

- AWS CLI is installed and authenticated.
- Terraform `>= 1.3.2` is installed.
- kubectl is installed and can access the `development` EKS cluster in `us-west-2`.
- Helm `>= 3.14.0` is installed (useful for troubleshooting).
- You have a CAST AI organization-level API key.

---

## Initialize Terraform

Download the required providers and create the dependency lock file.

```bash
cd EKSterraformcastai
terraform init
```

---

## Set the CAST AI API Token

Never hardcode the token in source files or `terraform.tfvars`. Provide it via the `TF_VAR_castai_api_token` environment variable.

```bash
export TF_VAR_castai_api_token="YOUR_CASTAI_API_KEY"
```

---

## Use the Provided `.env` File

The repository includes an `.env` file in the `EKSterraformcastai` directory. It exports both the AWS credentials (read from `/Users/eramadan/castai/awskey.env`) and the CAST AI API token, so Terraform authenticates to the correct AWS account (`050451381948`) where the `development` EKS cluster lives.

```bash
cd EKSterraformcastai
source .env

# Confirm the right AWS account is active
aws sts get-caller-identity
```

Expected output:

```json
{
    "UserId": "AIDAQXPZC726LICGPTYK4",
    "Account": "050451381948",
    "Arn": "arn:aws:iam::050451381948:user/ebrahim"
}
```

If `aws sts get-caller-identity` returns a different account, Terraform will fail to find the `development` cluster because it is located in account `050451381948`. In that case, make sure you sourced `.env` and that `awskey.env` contains the expected credentials.

---

## Plan and Apply

Run the commands in order. Review the plan output before confirming `terraform apply`.

```bash
# Check formatting
terraform fmt -check

# Validate the configuration
terraform validate

# Preview changes
terraform plan

# Apply changes
terraform apply
```

To apply without an interactive prompt:

```bash
terraform apply -auto-approve
```

---

## Verification After Apply

After the Helm release is installed, verify the CAST AI read-only components are running.

```bash
# List CAST AI pods
kubectl get pods -n castai-agent

# List Helm releases
helm list -n castai-agent

# Inspect installed Helm values (API key is redacted/sensitive)
helm get values castai -n castai-agent

# Show installed CAST AI workloads
kubectl get deployment,daemonset -n castai-agent
```

### Confirm automation components are absent

The following components must **not** appear in the `castai-agent` namespace:

- `cluster-controller`
- `evictor`
- `pod-mutator`
- `workload-autoscaler`
- `workload-autoscaler-exporter`
- `pod-pinner`
- `castai-live`

Run:

```bash
kubectl get pods -n castai-agent | grep -E 'cluster-controller|evictor|pod-mutator|workload-autoscaler|pod-pinner|castai-live'
```

No results should be returned.

---

## Destroy (Optional)

If you need to remove the CAST AI Helm release and namespace from the cluster:

```bash
terraform destroy
```

This will **not** delete or modify the existing EKS cluster, node groups, VPC, IAM roles, or any eksctl-managed infrastructure.
