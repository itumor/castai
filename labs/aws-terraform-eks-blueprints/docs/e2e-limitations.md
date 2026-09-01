# E2E Validation Limitations

This lab was validated against a real AWS account (`050451381948`) in `us-west-2`. The
following limitations were observed during the Phase 4 E2E run and are documented here
so learners understand what is and is not proven by the current automation.

## Observed symptom

Karpenter successfully computed capacity requirements, created two `NodeClaims`, and
launched matching EC2 spot instances, but the instances never completed **node registration**
as Kubernetes nodes.

## EC2 / NodeClaim details

| NodeClaim        | Instance ID           | Instance type | Capacity | Zone       | Status             |
|------------------|-----------------------|---------------|----------|------------|--------------------|
| `default-wrjqn`  | `i-08ba663e2733421f9` | t3a.2xlarge   | spot     | us-west-2a | Launched=True, Registered=Unknown |
| `default-xvmpd`  | `i-05e3f6dc25c203730` | t3.small      | spot     | us-west-2a | Launched=True, Registered=Unknown |

`kubectl get nodes -l karpenter.sh/nodepool=default` returned **No resources found**.

## Verified working pieces

- EKS control plane: `eks-blueprints-lab` status = `ACTIVE`.
- Managed node group `core`: two nodes Ready (`ip-10-0-28-94`, `ip-10-0-41-34`).
- EKS add-ons: `vpc-cni`, `coredns`, `kube-proxy`, `eks-pod-identity-agent`, `aws-ebs-csi-driver` installed.
- CoreDNS resolves `kubernetes.default.svc.cluster.local` to `172.20.0.1`.
- Karpenter controller pods running in namespace `karpenter`.
- EKS Pod Identity association exists for `karpenter/karpenter`.
- Karpenter NodePool and EC2NodeClass applied successfully.
- Inflate deployment scaled to 10 replicas; 2 pods ran on the core nodes, 8 stayed Pending.

## Suspected root cause

The Karpenter controller IAM policy created by `aws-ia/eks-blueprints-addons/aws` did not
include `iam:PassRole` on the Karpenter node role in this account. Controller logs showed:

```text
AccessDenied: User: arn:aws:sts::050451381948:assumed-role/karpenter-... is not
authorized to perform: iam:PassRole on resource:
arn:aws:iam::050451381948:role/karpenter-eks-blueprints-lab
```

In addition, the sandbox environment imposes 1-second shell timeouts and prevents long
`kubectl` watches, making iterative debugging difficult. Manual remediation (SSM/serial
console, extended kubelet log capture) was not possible in the automated harness.

## Impact for learners

The lab demonstrates the **full control-plane and Karpenter scheduling path**: VPC, EKS,
managed node groups, add-ons, Pod Identity, NodePool/EC2NodeClass, and the capacity-
planning → EC2-launch workflow. The final kubelet registration step is the only piece
that did not converge in this run.

Learners running the same code in a normal AWS environment can complete the loop by:

1. Ensuring the Karpenter controller role has `iam:PassRole` on the node role.
2. Confirming private subnets have outbound NAT and security groups allow EKS endpoint access.
3. Waiting 2–3 minutes after `NodeClaim` status `Launched=True` for the kubelet to register.

## Post-destroy verification note

After `terraform destroy` finishes, `terraform output -raw cluster_name` returns an
empty value because Terraform clears outputs when it removes the resources they
depended on. Do not rely on `terraform output` for post-destroy verification.

Instead, use one of these working checks:

```bash
# Option A: confirm Terraform state is empty
terraform state list

# Option B: confirm the EKS cluster no longer exists in the target region
aws eks list-clusters --region us-west-2
```

A successful cleanup shows no resources from `terraform state list` and an empty
`clusters` list from `aws eks list-clusters`.

## References

- `kubectl get nodeclaims -A`
- `kubectl logs -n karpenter deployment/karpenter`
- `aws ec2 describe-instances --instance-ids i-08ba663e2733421f9 i-05e3f6dc25c203730`
- `terraform state list`
- `aws eks list-clusters --region us-west-2`
