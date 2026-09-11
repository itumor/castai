# Runbook: Reproduce an IAM/SCP deny in castctl

Use when a customer reports `Permission denied: explicitDeny` during
`castctl cluster connect` or similar CAST AI installs.

## Inputs needed

- Customer account ID and org ID (if CAST AI EU).
- The failing action(s) from castctl output.
- Customer's best description of any relevant SCP or permission boundary.
- ARN of the IAM principal running castctl (if available).

## Steps

### 1. Identify the mechanism

```bash
strings /opt/homebrew/bin/castctl | grep -E 'SimulatePrincipalPolicy|explicitDeny'
```

If `SimulatePrincipalPolicy` appears, castctl is using AWS IAM policy
simulation, not DryRun.

### 2. Build the local repro

Use the lab harness in `labs/csi-tagcheck/`:

```bash
cd /Users/eramadan/castai/labs/csi-tagcheck
# Edit policy-castai-tagging.json if the action differs
# Edit policy-scp-block-cso.json to match the customer's stated SCP
python3 simulate_principal.py
```

### 3. Test variants

For tag-related denies, test at minimum:

- No tag context (castctl's real request shape).
- CAST AI tag keys (`cast.ai:*`, `kubernetes.io/cluster/*`, `Name`).
- Customer-prefixed keys (e.g. `CSO*`, `cso*`).
- A blanket Deny with no condition.

For each variant record `EvalDecision` and which statement matched.

### 4. Check if castctl emits the customer prefix

```bash
strings castctl | grep -i cso
```

If the customer claims only CSO tags are denied, this rules in/out whether
castctl itself supplies such a tag.

### 5. Document and reply

Write findings to `labs/<case>/CASE-....md`, update [[CreateTags Case]] and
[[Siemens Fleet]] in the brain, and draft `REPLY-to-customer.md`.

## Common mistakes

- Assuming `DryRun` — castctl uses `SimulatePrincipalPolicy`.
- Trusting the customer's SCP summary without replicating it; always test
  the stated shape AND a broader shape.
- Offering a scoped-Allow as a bypass — it does not override an explicit
  Deny.
