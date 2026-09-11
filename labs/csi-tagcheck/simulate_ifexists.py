"""Test the IfExists variant of the Siemens CSO tag-guard SCP.

Real-world tag-guard SCPs are commonly written with condition operators like
ForAnyValue:StringLikeIfExists (or StringEqualsIfExists) so that actions
which don't carry tag context still pass. But AWS semantics: IfExists
operators evaluate TRUE when the context key is ABSENT from the request.

castctl (and the AWS console simulator with no condition keys set) calls
SimulatePrincipalPolicy with NO aws:TagKeys context. So an SCP written as:

  Deny ec2:CreateTags If ForAnyValue:StringLikeIfExists aws:TagKeys in {CSO*,cso*,Cso*}

would:
  - DENY in the no-context simulation (IfExists true when key absent)      -> castctl blocker
  - ALLOW at runtime for real CreateTags calls carrying non-CSO tag keys  -> install would work

If scenario B2 below returns explicitDeny while B3 returns allowed, the
mystery is fully explained: castctl preflight is a false positive and the
Helm/Terraform path (which runs real API calls against real tag context)
would succeed where castctl refused to proceed.
"""
import json

import boto3

BASE = "/Users/eramadan/castai/labs/csi-tagcheck"
castai_policy = json.dumps(json.load(open(f"{BASE}/policy-castai-tagging.json")))

iam = boto3.client("iam")
ROLE = "castai-csi-tagcheck"


def scp_ifexists():
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DenyCSOTaggingIfExists",
                "Effect": "Deny",
                "Action": ["ec2:CreateTags", "ec2:DeleteTags"],
                "Resource": "*",
                "Condition": {
                    "ForAnyValue:StringLikeIfExists": {
                        "aws:TagKeys": ["CSO*", "cso*", "Cso*"]
                    }
                },
            },
            {"Sid": "BoundaryAllowAll", "Effect": "Allow",
             "Action": "*", "Resource": "*"},
        ],
    })


def simulate(boundary=None, tag_keys=None):
    kwargs = {
        "PolicySourceArn": f"arn:aws:iam::050451381948:role/{ROLE}",
        "ActionNames": ["ec2:CreateTags"],
        "ResourceArns": ["*"],
    }
    if boundary:
        kwargs["PermissionsBoundaryPolicyInputList"] = [boundary]
    if tag_keys:
        kwargs["ContextEntries"] = [
            {
                "ContextKeyName": "aws:TagKeys",
                "ContextKeyValues": [tag_keys],
                "ContextKeyType": "stringList",
            }
        ]
    resp = iam.simulate_principal_policy(**kwargs)
    out = resp["EvaluationResults"][0]
    return out["EvalDecision"], [s.get("SourcePolicyId") for s in out.get("MatchedStatements", [])]


b = scp_ifexists()
rows = [
    ("B1. IfExists-SCP, no context (castctl shape)", b, None),
    ("B2. IfExists-SCP, keys cast.ai:cluster", b, "cast.ai:cluster"),
    ("B3. IfExists-SCP, keys CSO-team (control)", b, "CSO-team"),
]

print(f"{'scenario':<46} {'decision':<14} matched")
print("-" * 90)
for name, boundary, keys in rows:
    decision, matched = simulate(boundary, keys)
    print(f"{name:<46} {decision:<14} {matched}")
