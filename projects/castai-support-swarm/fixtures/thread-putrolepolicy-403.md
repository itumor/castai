From: Samuel Okafor <samuel.okafor@siemens.example.com>
Subject: Onboarding fails — PutRolePolicy AccessDenied

Hello,

I'm trying to onboard our EKS dev cluster to CAST AI using the Terraform module,
and terraform apply fails with:

  Error: creating IAM Role Policy: AccessDenied:
  User: arn:aws:iam::123456789012:user/ci-terraform is not authorized to perform:
  iam:PutRolePolicy on resource: role castai-eks-dev

Our CI pipeline runs with a limited IAM user managed by our security team. What
permission is missing, and can we scope it down? We don't want to hand out
IAMFullAccess to a CI role.

Regards,
Samuel
