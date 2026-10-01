From: Samuel Frunza <samuel.frunza@customer.example.com>
Subject: CAST AI onboarding fails: iam:PutRolePolicy 403

Hi — we're connecting our EKS test cluster (siemenstest-siemenstest-1, eu-west-1, AWS account 951463557399) to CAST AI in full mode. The connect run gets most of the way through, then fails with "iam:PutRolePolicy" 403 on the role cast-eks-…-36575565. Read-only onboarding worked fine earlier today. What permission are we missing, and is there a Terraform workaround?
