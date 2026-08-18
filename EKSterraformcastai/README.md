# EKS + CAST AI Read-Only Terraform Module

Connects an **already existing AWS EKS cluster** to CAST AI in **strict read-only / observability mode** using Terraform-managed Helm.

> **Warning:** This module intentionally does **not** enable any CAST AI automation. It installs only the observability components required for cost monitoring and security telemetry.

---

## Architecture

```text
Existing eksctl EKS cluster (development, us-west-2)
        |
        | Terraform reads EKS metadata via data sources
        v
Terraform Helm Provider
        |
        v
CAST AI umbrella Helm chart (castai-helm/castai)
        |
        v
tags.readonly=true
        |
        +-- castai-agent
        +-- castai-spot-handler
        +-- castai-kvisor
        +-- gpu-metrics-exporter
        |
        X No node autoscaling
        X No workload autoscaling
        X No evictions
        X No node provisioning
        X No workload mutations
        X No Container Live Migration
```

### Why the CAST AI Terraform provider is omitted

Current CAST AI documentation confirms that read-only mode (and Workload Autoscaler mode) can be installed with Helm only. The `castai/castai` Terraform provider is introduced only when you enable **node-autoscaler** or **full** mode, because those modes require cloud IAM resources that Terraform provisions for node management.

Since this deployment is strictly read-only, no cloud IAM resources, node configurations, node templates, or cluster registration resources are created. Therefore the `castai/castai` provider is not used.

---

## Prerequisites

- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and authenticated
- [Terraform](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli) `>= 1.3.2`
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- [Helm](https://helm.sh/docs/intro/install/) `>= 3.14.0` (useful for troubleshooting)
- An existing EKS cluster named `development` in AWS region `us-west-2`
- AWS permissions to describe the EKS cluster and generate EKS auth tokens
- A CAST AI organization-level API key from [console.cast.ai](https://console.cast.ai/)

---

## Verify current AWS identity

```bash
aws sts get-caller-identity
```

## Verify the EKS cluster

```bash
aws eks describe-cluster \
  --name development \
  --region us-west-2
```

## Configure kubectl

```bash
aws eks update-kubeconfig \
  --name development \
  --region us-west-2
```

## Verify cluster access

```bash
kubectl get nodes
```

---

## Set the CAST AI API token

Never hardcode the token. Provide it via an environment variable:

```bash
export TF_VAR_castai_api_token="YOUR_CASTAI_API_KEY"
```

---

## Terraform commands

```bash
cd EKSterraformcastai

terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
```

To optionally override variables, copy the example file:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Then edit `terraform.tfvars` as needed. **Do not** put the CAST AI API key in `terraform.tfvars`.

---

## Verification

After `terraform apply` completes, verify that CAST AI components are running:

```bash
kubectl get pods -n castai-agent
```

Expected pods in read-only mode:

- `castai-agent-*`
- `castai-spot-handler-*`
- `castai-kvisor-*`
- `gpu-metrics-exporter-*`

Other useful commands:

```bash
# List Helm releases
helm list -n castai-agent

# Inspect installed values (API key is redacted/sensitive)
helm get values castai -n castai-agent

# Show installed CAST AI workloads
kubectl get deployment,daemonset -n castai-agent
```

### Confirm automation components are absent

The following components must **not** appear in the `castai-agent` namespace:

```text
cluster-controller
evictor
pod-mutator
workload-autoscaler
workload-autoscaler-exporter
pod-pinner
castai-live
```

You can check with:

```bash
kubectl get pods -n castai-agent | grep -E 'cluster-controller|evictor|pod-mutator|workload-autoscaler|pod-pinner|castai-live'
```

No results should be returned.

---

## Why this deployment is read-only

The CAST AI umbrella Helm chart selects components via tags. This module sets only:

```yaml
tags:
  readonly: true
  full: false
  node-autoscaler: false
  workload-autoscaler: false
```

With `tags.readonly=true`, the chart installs only the observability stack. The mutually exclusive tag validation in the chart prevents other automation modes from being enabled at the same time.

Because no `castai-cluster-controller`, `castai-evictor`, `castai-pod-mutator`, `castai-pod-pinner`, `castai-live`, or Workload Autoscaler components are deployed, CAST AI cannot:

- provision nodes
- delete nodes
- evict workloads
- mutate pods or workloads
- change resource requests/limits automatically
- perform Container Live Migration

## Why no CAST AI autoscaler AWS IAM role is created

AWS IAM roles and instance profiles for CAST AI are required only when CAST AI provisions EC2 instances on your behalf (node-autoscaler / full mode). Read-only mode does not interact with the AWS EC2 API to create or manage nodes. Therefore this module creates no IAM role, instance profile, or EKS access entry for CAST AI node provisioning.

## Important caveats about Terraform state

The CAST AI API key is passed to Helm as a sensitive value (`set_sensitive`). However, Terraform state files may still contain the API key in plaintext. In production:

- Use an **encrypted remote backend** (e.g., Terraform Cloud, S3 with SSE-KMS and locking via DynamoDB).
- Restrict access to state files to authorized users and CI/CD pipelines only.
- Rotate the CAST AI API key if state is ever exposed.

This module does not create or manage the backend configuration. Configure it according to your organization's requirements.

---

## Safety guardrails

This module:

- Uses `data` sources for the EKS cluster, not `resource` blocks.
- Does not import the existing cluster into Terraform state.
- Does not create or modify VPC, subnet, security group, IAM, or node group resources.
- Does not enable OIDC or change the EKS authentication mode.
- Does not create `castai_node_configuration`, `castai_node_template`, or `castai_autoscaler` resources.
- Explicitly disables automation tags in the Helm values.

`terraform destroy` will only remove the Helm release and namespace managed by this module. It will not affect the existing EKS cluster, node groups, or eksctl-managed infrastructure.

---

## References

- [CAST AI EKS GitOps documentation](https://docs.cast.ai/docs/terraform-provider-eks)
- [CAST AI Terraform provider overview](https://docs.cast.ai/docs/terraform-provider)
- [CAST AI Helm charts repository](https://github.com/castai/helm-charts)
- [CAST AI umbrella chart on Artifact Hub](https://artifacthub.io/packages/helm/castai/castai)
