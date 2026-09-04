# castai-billing-export

A standalone bash script that exports CAST AI Enterprise billing usage to CSV
by walking the new three-step API flow: list child organisations, fetch
per-cluster usage for each, and join against `external-clusters` metadata to
resolve the cloud-account identifier.

## Prerequisites

| Tool     | Required for             | Install (macOS)            |
| -------- | ------------------------ | -------------------------- |
| `bash`   | running the script       | preinstalled               |
| `curl`   | calling the CAST AI API  | preinstalled               |
| `jq`     | JSON parsing             | `brew install jq`          |
| Python 3 | running the test suite   | `brew install python`      |

## Environment variables

| Variable         | Required | Default                  | Description                                                       |
| ---------------- | -------- | ------------------------ | ----------------------------------------------------------------- |
| `CASTAI_API_KEY` | yes      | _(none)_                 | CAST AI API key used as the `X-API-Key` header.                   |
| `BASE_URL`       | no       | `https://api.eu.cast.ai` | Base URL of the CAST AI API.                                      |
| `FROM`           | no       | `2026-08-01`             | Inclusive start date (YYYY-MM-DD) for the usage window.           |
| `TO`             | no       | `2026-08-31`             | Inclusive end date (YYYY-MM-DD) for the usage window.             |
| `FEATURE`        | no       | `phase2`                 | Billing feature filter passed through to the billing endpoints.   |

The script exits non-zero with a clear error message if `CASTAI_API_KEY` is
unset or if `curl`/`jq` cannot be found on `PATH`.

## Usage

```bash
export CASTAI_API_KEY=...
./castai-billing-export.sh > billing.csv
```

Optional overrides:

```bash
export BASE_URL=https://api.cast.ai
export FROM=2026-07-01
export TO=2026-07-31
export FEATURE=phase2
./castai-billing-export.sh > billing.csv
```

Progress messages are written to stderr; the CSV (header + rows) is written to
stdout, so the redirection above captures only the data.

## Output

The script writes a CSV with the following columns:

```
organization_id,organization_name,cluster_id,cluster_name,provider,cloud_account,usage,unit
```

The `cloud_account` column is resolved with this precedence:

1. `providerNamespaceId`
2. `eks.accountId`
3. `gke.projectId`
4. `aks.subscriptionId`
5. `UNKNOWN` (if none of the above are present)

### Sample CSV

```csv
organization_id,organization_name,cluster_id,cluster_name,provider,cloud_account,usage,unit
org-abc123,Acme Prod,cls-001,acme-prod-eks,EKS,123456789012,182.5,USD
org-abc123,Acme Prod,cls-002,acme-prod-gke,GKE,acme-gcp-prod,77.2,USD
org-def456,Acme Staging,cls-003,acme-stage-aks,AKS,sub-abcdef-1234,12.0,USD
org-xyz789,Acme Legacy,cls-004,legacy-cluster,UNKNOWN,UNKNOWN,3.4,USD
```

## Tests

A Python-based test suite plus a local mock CAST AI server live under
`tests/`. The mock server returns deterministic fixtures, so no real CAST AI
credentials are needed in CI.

```bash
./tests/run_tests.sh
```

The script must fail fast when `CASTAI_API_KEY` is unset:

```bash
unset CASTAI_API_KEY
./castai-billing-export.sh
# -> ERROR: CASTAI_API_KEY environment variable is required.
# -> exit code 2
```

## Project layout

```
projects/castai-billing-export/
├── castai-billing-export.sh    # the export script
├── README.md                   # this file
└── tests/                      # mock server + Python test suite (Chunk 2)
```

## Targeted API versions

- `GET /v1/billing/enterprise/platform-usage-detail`
- `GET /v1/billing/platform-usage-detail`
- `GET /v1/kubernetes/external-clusters`

If CAST AI changes the response schema for any of these endpoints, update
the corresponding `jq` selectors inside `castai-billing-export.sh`.
