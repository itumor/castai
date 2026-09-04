# Draft email response

**To:** John Doyle; Guy & Ahmed
**From:** [Your name]
**Subject:** Update on the CAST AI billing endpoint change — replacement workflow and ready-to-run script

---

Hi John, Guy, and Ahmed,

Thanks for flagging this and apologies for the confusion. You are correct: `GET /v1/billing/usage-report` (the endpoint that returned `summary` and `clusters` in a single response) has been removed from the current CAST AI API, which is why your calls now return `404` and the path no longer appears in Swagger.

The endpoint you found, `/v1/billing/enterprise/platform-usage-detail`, is the right starting point — but on its own it only returns the parent (enterprise) account and its child organizations, with usage rolled up at the organization level. It does not include the per-cluster detail or cloud-account mapping you need to build internal charges, so the workflow has to be split into a few steps.

## What the new workflow looks like

From an Enterprise API key, the data you want is now assembled in three calls per child organization:

1. **List child organizations and their usage.**
   `GET /v1/billing/enterprise/platform-usage-detail?period.from=YYYY-MM-DD&period.to=YYYY-MM-DD&feature=<feature>`
   Authenticated with your Enterprise `X-API-Key`. The response lists each child organization and its aggregate usage.

2. **For each child organization, fetch per-cluster usage.**
   `GET /v1/billing/platform-usage-detail?period.from=YYYY-MM-DD&period.to=YYYY-MM-DD&feature=<feature>`
   Authenticated with the same Enterprise `X-API-Key`, plus the header `X-CastAI-Organization-Id: <child_org_id>` so the call is scoped to that organization. This is where you get the per-cluster rows you used to see under `clusters`.

3. **Map cluster IDs to cloud accounts.**
   `GET /v1/kubernetes/external-clusters` with the same `X-CastAI-Organization-Id: <child_org_id>` header. The cloud account lives on the cluster object under, in priority order:
   - `providerNamespaceId` (generic)
   - `eks.accountId` (EKS)
   - `gke.projectId` (GKE)
   - `aks.subscriptionId` (AKS)

Joining those three responses on `clusterId` gives you the same shape you had before — one row per cluster, with organization, cloud account, and usage.

## A working script you can run today

To save you from wiring this up by hand, I have put together a small bash project that implements the full flow end-to-end and includes a set of automated tests against a mocked CAST AI server (so it can be verified offline, no live key required).

**Project location** (in our internal repo):

```
projects/castai-billing-export/
├── castai-billing-export.sh   # the export script
├── README.md                  # prerequisites and configuration
└── tests/                     # mock server + unit tests
```

### Usage

```bash
export CASTAI_API_KEY="your-enterprise-api-key"
cd projects/castai-billing-export
./castai-billing-export.sh > billing.csv
```

Optional environment variables, all with sensible defaults:

- `BASE_URL` — defaults to `https://api.eu.cast.ai`
- `FROM`, `TO` — billing period (defaults: `2026-08-01` and `2026-08-31`)
- `FEATURE` — defaults to `phase2`

Prerequisites: `bash`, `curl`, and `jq`. The script checks for these up front and fails fast with a clear message if anything is missing.

### Sample CSV output

```csv
organization_id,organization_name,cluster_id,cluster_name,provider,cloud_account,usage,unit
org_123,Acme Prod,cls-abc,prod-eks-1,eks,111122223333,42.50,cluster-hour
org_123,Acme Prod,cls-def,prod-gke-1,gke,my-gcp-project,18.75,cluster-hour
org_456,Acme Staging,cls-ghi,stage-aks-1,aks,sub-0000-0000,7.20,cluster-hour
```

Each row carries the organization, cluster ID, cluster name, provider, resolved cloud account, usage, and unit — enough to drive internal chargeback directly.

### Verifying it works (no live API calls)

The tests use a local Python mock server that serves deterministic fixtures for all three endpoints, then assert the produced CSV matches expectations:

```bash
cd projects/castai-billing-export
./tests/run_tests.sh
```

If the tests pass on your side, you can be confident the join logic and the cloud-account precedence (`providerNamespaceId` → `eks.accountId` → `gke.projectId` → `aks.subscriptionId` → `UNKNOWN`) behave as expected before pointing it at production.

## Want a walkthrough?

If it would help, I am happy to set up a short call to walk through the script, the new endpoint shape, and how the cloud-account fallback rules work for your EKS / GKE / AKS mix. Just let me know a couple of times that work for you.

Best,
[Your name]
