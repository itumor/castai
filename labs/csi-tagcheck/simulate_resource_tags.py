"""Test whether a resource carrying an existing CSO-prefixed tag changes the
SimulatePrincipalPolicy outcome for ec2:CreateTags.

Hypothesis from the email thread: the cluster in the CSO-managed account
(238720913587) has resources already tagged by CSO governance (cso-* keys).
AWS evaluates aws:TagKeys against BOTH the request's new tags and the
resource's current tags. A Deny on aws:TagKeys matching CSO* would then fire
for any CreateTags call targeting such a resource — even if the caller only
intends to ADD unrelated tags, explaining castctl's explicitDeny.

Note: SimulatePrincipalPolicy cannot apply real resource tags (it accepts
ARNs and context entries only), so this tests both interpretations by
simulating a resource policy context with cso-present keys.
"""
import json

import boto3

BASE = "/Users/eramadan/castai/labs/csi-tagcheck"

iam = boto3.client("iam")
ROLE = "castai-csi-tagcheck"


def scp_plain():
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DenyCSOTagging",
                "Effect": "Deny",
                "Action": ["ec2:CreateTags", "ec2:DeleteTags"],
                "Resource": "*",
                "Condition": {
                    "ForAnyValue:StringLike": {"aws:TagKeys": ["CSO*", "cso*", "Cso*"]}
                },
            },
            {"Sid": "BoundaryAllowAll", "Effect": "Allow",
             "Action": "*", "Resource": "*"},
        ],
    })


def simulate(boundary, tag_keys):
    return iam.simulate_principal_policy(
        PolicySourceArn=f"arn:aws:iam::050451381948:role/{ROLE}",
        ActionNames=["ec2:CreateTags"],
        ResourceArns=["arn:aws:ec2:eu-central-1:050451381948:instance/i-0123456789abcdef0"],
        PermissionsBoundaryPolicyInputList=[boundary],
        ContextEntries=[
            {
                "ContextKeyName": "aws:TagKeys",
                "ContextKeyValues": tag_keys,
                "ContextKeyType": "stringList",
            }
        ],
    )["EvaluationResults"][0]["EvalDecision"]


b = scp_plain()
print("plain CSO SCP, request keys ['cast.ai:cluster']            :",
      simulate(b, ["cast.ai:cluster"]))
print("plain CSO SCP, request keys ['cast.ai:cluster','cso-xyz']  :",
      simulate(b, ["cast.ai:cluster", "cso-xyz"]))
