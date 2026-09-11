# API Keys & Regions

## Region

Siemens CAST AI data lives in the **EU region**:

- API base: `https://api.eu.cast.ai`
- gRPC: `grpc.cast.ai` (US default in some configs; Siemens uses EU API)
- Console: `https://console.cast.ai`

## Keys in use

| Key env / file | Region | Scope | What it can see | Notes |
|---|---|---|---|---|
| `projects/castai-billing-export/.env` `CASTAI_API_KEY` | EU | Enterprise key | 111 orgs, 230 clusters | Use this for fleet inventory, billing export, readiness reports |
| `castai-mcp-server/.env` `CASTAI_API_KEY` | EU | Default org only | 0 clusters | Binds to `CAST AI EU` org; MCP server shows empty fleet today |
| root `.env` `Castai_mcp` / `CASTAI_API_KEY` | EU | Default org only | 0 clusters | Same key as MCP server `.env` |
| `dashboard/.env` `CASTAI_API_KEY` | US (`api.cast.ai`) | unknown | mismatched region | Dashboard region is wrong for Siemens; should be EU |
| `castai-mcp-server/.env` `CASTAI_ORG_ID` | — | empty | — | Not bound to any org; server relies on default org of key |
| root `.env` `TF_VAR_castai_api_token` | EU/US? | Terraform token | full-mode onboarding | Used by Terraform modules |

## Decision pending

Should the MCP server and dashboard be repointed at the enterprise key so
LLM agents can see the full 230-cluster fleet? Security tradeoff:

- Pro: agents become useful for real Siemens queries.
- Con: enterprise key has broad org visibility; need org allow-list in
  `castai-mcp-server` before switching (see `.kimchi/docs/castai-mcp-security.md` §6).

## Verification

```bash
# Enterprise key scope
export CASTAI_API_KEY=$(grep -o 'castai_v1_[^"]*' /Users/eramadan/castai/projects/castai-billing-export/.env)
curl -sS -H "X-API-Key: $CASTAI_API_KEY" https://api.eu.cast.ai/v1/organizations | jq '.organizations | length'
```

Expected: 111.
