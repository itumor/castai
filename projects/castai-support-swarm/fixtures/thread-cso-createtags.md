From: Jonas Dahl <jonas.dahl@siemens.example.com>
Subject: TKT-20260817-b640 | RE: Cast AI permissions failed

Hi Cast AI Colleagues,

We are trying to install Cast AI on a cluster on an AWS account not
controlled by Central Siemens (account 238720913587). They are refusing to
allow the CreateTags on EC2 as they have some tags that cannot be
overwritten or modified. Is there anything in your script to allow us to
bypass the create tags portion?

From: Arun Saxena <arun.saxena@siemens.example.com>

I am trying to deploy Cast AI on account 238720913587 and getting below
errors. I am trying this activity using admin access only.

  ✓ ec2:AuthorizeSecurityGroupEgress
  ✗ ec2:CreateTags
    Permission denied: explicitDeny
    Fix: Grant this permission to your IAM user/role
  ✓ eks:CreateAccessEntry
  ✓ eks:AssociateAccessPolicy
  ✓ eks:DescribeAccessEntry
  ✗ executing installation: doing Prepare Cloud Node Autoscaling: cloud
    credential validation failed: AWS permission checks failed
castctl : Error: command failed
+ castctl cluster connect --api-token="castai_v1_..."

From: Tarek Sander (CSO security) <tarek.sander@siemens.example.com>

We do NOT block dev teams from tagging their resources.
We DO block dev teams from modifying CSO-owned tags.
The org-level SCP blocks the creation, modification, or deletion of a tag
that begins with CSO (cso, CSO, Cso, etc). We cannot change the SCP. We are
unable to supply our SCP code — we consider it sensitive — but it should be
simple for Cast.AI to simulate the blocking of existing tags. We don't
block any of the tags Cast AI listed (kubernetes.io/cluster/<name>,
castai/managed, castai/node-configuration-id, Name). What's the CloudTrail
error generated during the installation?

From: Sam Petrov <sam.petrov@siemens.example.com>

Please check with which role you install/manage CastAI. The role
OPS_CloudAdminEngineer should have the required permissions. You can check
which policy prohibits the action in AWS IAM Policy Simulator, then run
aws iam get-policy --policy-arn <arn>.

From: Tarek Sander <tarek.sander@siemens.example.com>

I don't see any CreateTags events in this CloudTrail.

From: Sam Petrov <sam.petrov@siemens.example.com>

Have you seen any permission restrictions during the next session (started
immediately after the first one), where we got the message that the user
has no rights? In the worst case we need another session.
