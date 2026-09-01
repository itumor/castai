# AWS EKS Blueprints Lab

This lab provisions a production-shaped Amazon EKS cluster on AWS using the
current official Terraform modules:

- [`terraform-aws-modules/eks/aws`](https://github.com/terraform-aws-modules/terraform-aws-eks)
  for the EKS control plane, managed node groups, and core EKS add-ons
  (`vpc-cni`, `kube-proxy`, `coredns`, `eks-pod-identity-agent`,
  `aws-ebs-csi-driver`).
- [`terraform-aws-modules/vpc/aws`](https://github.com/terraform-aws-modules/terraform-aws-vpc)
  for the VPC, public / private / intra subnets, and a single NAT gateway.
- [`aws-ia/eks-blueprints-addons/aws`](https://github.com/aws-ia/terraform-aws-eks-blueprints-addons)
  for the rest of the cluster add-ons and to install the **Karpenter v1**
  controller via its Helm chart, wired to **EKS Pod Identity**.

On top of that baseline the lab deploys a **Karpenter v1 NodePool +
EC2NodeClass** and a synthetic `inflate` Deployment so you can watch
just-in-time node provisioning and consolidation in real time.

> This lab intentionally does **not** use the deprecated monolithic
> `terraform-aws-eks-blueprints` module. The modern pattern is the modular
> split used here.

## Architecture

```mermaid
flowchart TB
    subgraph AWS["AWS account / region (default us-west-2)"]
        subgraph VPC["VPC 10.0.0.0/16 (terraform-aws-modules/vpc/aws)"]
            PUB["Public subnets<br/>+ 1 x NAT gateway"]
            PRIV["Private subnets<br/>tag: karpenter.sh/discovery"]
            INTRA["Intra subnets<br/>no NAT route"]
        end

        EKS["EKS control plane<br/>eks-blueprints-lab<br/>v1.33"]

        subgraph CORE["Bootstrap capacity"]
            MNG["Managed node group 'core'<br/>2 x t3.medium (ON_DEMAND)<br/>Amazon Linux 2023"]
        end

        ADD["EKS add-ons<br/>vpc-cni, kube-proxy,<br/>coredns, pod-identity-agent,<br/>aws-ebs-csi-driver"]

        subgraph PI["EKS Pod Identity"]
            PIA["aws_eks_pod_identity_association<br/>karpenter / karpenter<br/>-> controller IAM role"]
        end

        subgraph KARP["karpenter namespace"]
            CTRL["Karpenter controller<br/>chart 1.6.0 (Helm)"]
            NP["NodePool 'default'<br/>spot-preferred, m/c/t, 1-8 vCPU<br/>consolidateAfter: 1m"]
            NC["EC2NodeClass 'default'<br/>al2023@latest, gp3 100Gi<br/>IMDSv2, detailed monitoring"]
        end

        subgraph WORK["default namespace"]
            INFL["Deployment 'inflate'<br/>replicas: 0 -> 10<br/>requests: 1 CPU / 256Mi"]
        end
    end

    USER["Learner / kubectl"] -->|aws eks update-kubeconfig| EKS
    EKS --> MNG
    EKS --> ADD
    EKS --> CTRL
    PIA --> CTRL
    CTRL --> NP
    NP --> NC
    NC -->|launches EC2 (spot / on-demand)| PRIV
    INFL -. schedules onto .-> NP
    INFL -. tolerates workload=dedicated .-> NC
```

## Layout

```
labs/aws-terraform-eks-blueprints/
├── README.md                     # this file
├── main.tf                       # VPC + EKS + addons modules, Pod Identity assoc
├── versions.tf                   # Terraform / provider version pins
├── providers.tf                  # AWS provider + default tags
├── datasources.tf                # AZs, caller identity, ECR public token
├── locals.tf                     # cluster name, AZ slice, merged tags
├── variables.tf                  # input variables (cluster_name, region, ...)
├── outputs.tf                    # cluster, VPC, and Karpenter outputs
├── terraform.tfvars              # current values used by the lab
├── terraform.tfvars.example      # template you copy into terraform.tfvars
├── k8s/
│   ├── karpenter-nodepool.yaml   # Karpenter v1 NodePool 'default'
│   ├── karpenter-nodeclass.yaml  # Karpenter v1 EC2NodeClass 'default'
│   └── inflate.yaml              # synthetic Deployment (pause container)
├── scripts/
│   └── verify-karpenter.sh       # applies manifests and asserts node registration
└── docs/
    ├── learning-guide.md         # deeper walk-through and concept notes
    ├── research.md               # design decisions and module comparison
    └── e2e-limitations.md        # observed Phase 4 E2E run and remediation
```

## Prerequisites

- Terraform `>= 1.5`
- AWS credentials with permission to create VPCs, EKS clusters, managed node
  groups, IAM roles, and Pod Identity associations in the target region.
- `kubectl`, `helm`, `jq`, `envsubst`, and the AWS CLI v2.
- A Kubernetes version available in your region (the lab pins `1.33`).

## Reproduction commands

Run these from inside `labs/aws-terraform-eks-blueprints/`:

```bash
# 1. Configure AWS credentials (any method that puts credentials in the env)
export AWS_REGION=us-west-2
# e.g. aws configure, or `source ~/awskey.env`, or AWS_PROFILE=...

# 2. (Optional) override variables
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# 3. Initialize and apply the Terraform stack
terraform init
terraform apply -auto-approve

# 4. Wire kubectl to the new cluster
aws eks --region us-west-2 update-kubeconfig \
  --name $(terraform output -raw cluster_name)

# 5. Verify the cluster is up and the core managed nodes are Ready
kubectl get nodes
kubectl get pods -n kube-system

# 6. Apply the Karpenter v1 manifests
export CLUSTER_NAME=$(terraform output -raw cluster_name)
export KARPENTER_NODE_INSTANCE_PROFILE_NAME=$(terraform output -raw karpenter_node_instance_profile_name)
kubectl apply -f k8s/karpenter-nodepool.yaml
envsubst < k8s/karpenter-nodeclass.yaml | kubectl apply -f -

# 7. Deploy and scale the inflate workload to drive Karpenter
kubectl apply -f k8s/inflate.yaml
kubectl scale deployment inflate --replicas=10

# 8. Watch Karpenter launch and consolidate nodes
sleep 120
kubectl get nodes
kubectl get pods
kubectl get nodes -l karpenter.sh/nodepool=default
kubectl get nodeclaims -A
```

## Karpenter v1 integration

The lab exercises the full Karpenter v1 path. Three Kubernetes objects and one
Terraform resource make it work:

- `k8s/karpenter-nodepool.yaml` - `NodePool/default`
  - Weighted capacity-type preference: `spot` first, `on-demand` fallback.
  - Instance category restricted to `m`, `c`, `t`; vCPU capped at `1, 2, 4, 8`.
  - Aggressive consolidation (`WhenEmptyOrUnderutilized`, `consolidateAfter: 1m`)
    and a 100% disruption budget.
  - Applies a `workload=dedicated:NoSchedule` taint so only opted-in pods land
    on Karpenter-launched nodes.
  - Hard limits: 100 CPU / 400Gi memory.
- `k8s/karpenter-nodeclass.yaml` - `EC2NodeClass/default`
  - Uses the official Amazon EKS-optimized AL2023 alias (`al2023@latest`).
  - Discovers subnets and security groups via the `karpenter.sh/discovery`
    tag written by the Terraform stack.
  - IMDSv2 required, hop limit 2; gp3 root volume, 100 Gi, encrypted.
  - Detailed CloudWatch monitoring enabled.
- `k8s/inflate.yaml` - `Deployment/inflate`
  - Uses the `public.ecr.aws/eks-distro/kubernetes/pause:3.7` image.
  - Replicas default to 0; the lab bumps them to 10 to force node provisioning.
  - Carries the matching `workload=dedicated:NoSchedule` toleration so the
    pods can actually land on Karpenter-provisioned nodes.
- Terraform: `aws_eks_pod_identity_association.karpenter`
  - Binds the `karpenter` service account in the `karpenter` namespace to the
    controller IAM role created by `eks-blueprints-addons`.

`scripts/verify-karpenter.sh` ties this together: it applies the three
manifests (using `envsubst` to render `${CLUSTER_NAME}`), scales `inflate` to
10 replicas, waits 120 seconds, and then asserts that at least one node with
the `karpenter.sh/nodepool=default` label exists and that its `providerID`
matches an EC2 `InstanceId` tagged `karpenter.sh/nodepool=default`.

```bash
./scripts/verify-karpenter.sh
```

## Learning resources

- `docs/learning-guide.md` - deeper walk-through: module comparison, IRSA vs
  EKS Pod Identity, managed node groups vs Karpenter, full reproduction and
  cleanup commands.
- `docs/research.md` - design decisions captured while building the lab.
- `docs/e2e-limitations.md` - the Phase 4 E2E run, the symptom observed
  (Karpenter-launched instances not registering as Kubernetes nodes), and
  the remediation steps. Read this if `verify-karpenter.sh` exits non-zero.

## Cleanup

Tear the lab down in the reverse order it was built:

```bash
# 1. Remove the workloads and Karpenter manifests.
#    Karpenter will then start consolidating any nodes it launched.
cd labs/aws-terraform-eks-blueprints
kubectl delete -f k8s/

# 2. Watch Karpenter drain the nodes it created.
kubectl get nodes -l karpenter.sh/nodepool=default

# 3. Destroy the AWS infrastructure.
terraform destroy -auto-approve

# 4. Sanity-check that nothing is left behind.
aws ec2 describe-instances \
  --filters Name=tag:Environment,Values=lab \
            Name=instance-state-name,Values=running
```

If `terraform destroy` complains about orphaned node groups or Pod Identity
associations, delete the `inflate` Deployment, the `NodePool`, and the
`EC2NodeClass` first and re-run `terraform destroy`.

## Cost implications

This lab is designed to be cheap but is **not free**. While it is running you
are paying for:

- **EKS control plane** - approximately **$0.10/hour** for every cluster,
  charged by AWS regardless of node count.
- **NAT gateway** - approximately **$0.045/hour** for the single NAT gateway
  plus per-GB data-processing charges. The lab uses `single_nat_gateway = true`
  to keep this low; production clusters typically want one NAT per AZ.
- **Managed node group (`core`)** - 2 x `t3.medium` on-demand (default).
  Roughly **$0.04/hour each**, so ~$0.08/hour total. They run continuously so
  Karpenter and the core add-ons have somewhere to live.
- **Karpenter-provisioned spot / on-demand nodes** - billed per second while
  the inflate workload is scaled up. With spot instances and the vCPU/category
  restrictions in the NodePool, each instance is small (1-8 vCPU). When
  `inflate` is scaled back to 0 and consolidation runs (`consolidateAfter: 1m`),
  Karpenter terminates them and the hourly charges drop to just the control
  plane, NAT gateway, and the bootstrap managed nodes.

Always run `terraform destroy` when you are done to avoid surprise charges.

## Outputs

`terraform output` exposes the values most commonly consumed by downstream
scripts:

- `cluster_name`, `cluster_endpoint`, `cluster_version`,
  `cluster_certificate_authority_data`
- `cluster_oidc_issuer_url`, `oidc_provider`
- `cluster_security_group_id`, `vpc_id`, `private_subnets`, `public_subnets`,
  `intra_subnets`
- `karpenter_node_iam_role_name`, `karpenter_service_account_name`
