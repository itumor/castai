# DRAFT — human reviews and sends. From: ebrahim@cast.ai
# To: samuel.frunza@conceptboard.com; Cc: f.m.yang@accenture.com, umair.shahid@conceptboard.com
# Subject: RE: Cast AI x Siemens | Import bundles and node group configuration

Hi Samuel,

thanks for the files and the node-group details — this is everything we
need.

**Confirmed findings:**

- All three bundles contain only the castctl startup banner. castctl
  writes this minimal bundle the instant a command fails fatally, so each
  run (07:53, 07:54 on 0.15.0; 07:57 on 0.15.1) failed within ~1 second,
  before any call to CAST AI or AWS. The actual error was printed to your
  terminal only.
- Verified on our side right now: the cluster is healthy (agent online,
  reconcile ok) and nothing was imported — all 6 nodes are unchanged.
  No cleanup needed; safe to retry.

**Most likely cause:** castctl defaults to the **US** API while your
organization lives in **EU**, and/or the token you passed is the **cluster
connect token** — this command needs an **organization API token**.

**How to get the correct token (org API token):**

1. You can do this yourself, since you now have console access: in the
   CAST AI console for organization `IT DF COL UC 2` —
   https://console.cast.ai (EU region).
2. Go to **Settings → API keys → Add / Create API key**, e.g.
   `import-config samuel`.
3. Select the **Full access** preset (or at minimum read+write on
   clusters/nodes) and create it.
4. Copy the key immediately — it is only shown once. It must be an
   org-level API key (shown on that page, format `castai_v1_…`), **not**
   the cluster connect token used during onboarding.
5. Send it to us securely (or keep it on your machine and use it locally).

**Then retry with:**

```bash
export CASTAI_API_TOKEN=<org API key from above>

castctl cluster import-config \
  --api-region eu \
  --organization-id 2b9d9744-f37d-4a22-b9c6-2f1857a5417d \
  --cluster-id 36575565-7149-431b-b5f6-71f43f18ef3f \
  --context <your-siemenstest-context> \
  --file plan.yaml
```

`--file` only writes the discovered plan; nothing is applied until we run
`castctl cluster apply-config --file plan.yaml` together. If it still
fails, paste me the terminal output and the `/tmp/castctl-*.log` it
prints on the first line.

**Node groups noted** — web (r6a.large/100GB, desired 3), webapp
(m5a.xlarge/100GB, desired 1), worker (r6a.large/50GB, desired 2), all
ON_DEMAND, labels `CcsEnv=siemenstest` + `ccs.node.role`, no taints. If
the retry fails we create them manually in the console at our next
meeting, one time, as agreed.

Best regards,
Ebrahim
