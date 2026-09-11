"""Simulate Siemens' CSO-tag SCP against CAST AI's tagging policy.

Uses boto3 iam.simulate_custom_policy — the same underlying API an agent
preflight permission check uses — across four scenarios. Prints a verdict
table. Run:  AWS_PROFILE=default python3 simulate.py  (creds from awskey.env)
"""
import json

import boto3

BASE = "/Users/eramadan/castai/labs/csi-tagcheck"
castai_policy = json.dumps(json.load(open(f"{BASE}/policy-castai-tagging.json")))
scp_policy = json.dumps(json.load(open(f"{BASE}/policy-scp-block-cso.json")))

iam = boto3.client("iam")


def simulate(policies, tag_keys=None):
    kwargs = {
        "PolicyInputList": policies,
        "ActionNames": ["ec2:CreateTags"],
        "ResourceArns": ["*"],
    }
    if tag_keys:
        kwargs["ContextEntries"] = [
            {
                "ContextKeyName": "aws:TagKeys",
                "ContextKeyValues": [tag_keys],
                "ContextKeyType": "stringList",
            }
        ]
    resp = iam.simulate_custom_policy(**kwargs)
    return resp["EvaluationResults"][0]["EvalDecision"]


scenarios = [
    ("1. castctl check today (no SCP)", [castai_policy], None),
    ("2. castctl w/ Siemens SCP, no tag context", [castai_policy, scp_policy], None),
    ("3. SCP present, tags CAST AI names", [castai_policy, scp_policy], "cast.ai:cluster"),
    ("4. control: SCP blocks CSO-prefixed key", [castai_policy, scp_policy], "CSO-team"),
]

print(f"{'scenario':<48} decision")
print("-" * 65)
for name, policies, keys in scenarios:
    print(f"{name:<48} {simulate(policies, keys)}")
