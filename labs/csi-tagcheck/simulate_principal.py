"""Replicate castctl's preflight check end-to-end with iam.simulate_principal_policy.

castctl compiles in SimulatePrincipalPolicy + the decision strings, so the
production check evaluates the *installer principal's effective policies*
(iam role policy + AWS Organizations SCP).

A permissions boundary is the closest AWS-native shape to an SCP: the
boundary's statement list can hold both Deny (CSO) and Allow (everything
else), mirroring how a real SCP document would evaluate alongside the
role's own CastEKSPolicy.

Scenarios reproduce what castctl would say for each layer combination.
"""
import json

import boto3

BASE = "/Users/eramadan/castai/labs/csi-tagcheck"
castai_policy = json.dumps(json.load(open(f"{BASE}/policy-castai-tagging.json")))
scp_policy = json.dumps(json.load(open(f"{BASE}/policy-scp-block-cso.json")))

iam = boto3.client("iam")
ROLE = "castai-csi-tagcheck"


def boundary_doc():
    # Merge the CSO deny with a broad allow, the way an SCP document reads.
    scp = json.load(open(f"{BASE}/policy-scp-block-cso.json"))
    scp["Statement"].append(
        {"Sid": "BoundaryAllowAll", "Effect": "Allow",
         "Action": "*", "Resource": "*"}
    )
    return json.dumps(scp)


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
    matched = [s.get("SourcePolicyId") for s in out.get("MatchedStatements", [])]
    return out["EvalDecision"], matched


def blanket_boundary():
    return json.dumps({
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "BlanketDenyCreateTags", "Effect": "Deny",
             "Action": "ec2:CreateTags", "Resource": "*"},
            {"Sid": "BoundaryAllowAll", "Effect": "Allow",
             "Action": "*", "Resource": "*"},
        ],
    })


b = boundary_doc()
blanket = blanket_boundary()
rows = [
    ("A. role + castai policy only", None, None),
    ("B. A + Siemens CSO deny boundary", b, None),
    ("C. B + tag keys cast.ai:cluster", b, "cast.ai:cluster"),
    ("D. control: boundary denies CSO-*", b, "CSO-team"),
    ("E. blanket-Deny CreateTags SCP", blanket, None),
    ("F. E + tag keys cast.ai:cluster", blanket, "cast.ai:cluster"),
]

print(f"{'scenario':<42} {'decision':<14} matched")
print("-" * 80)
for name, boundary, keys in rows:
    try:
        decision, matched = simulate(boundary, keys)
        print(f"{name:<42} {decision:<14} {matched}")
    except Exception as e:
        print(f"{name:<42} ERROR    {e}")
