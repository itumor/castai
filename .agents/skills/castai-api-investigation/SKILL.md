---
name: castai-api-investigation
description: Research and troubleshoot CAST AI REST API, Swagger/OpenAPI, reporting and Value Realization endpoints, API scopes, 400/401/403/404 responses, regional US/EU hosts, service accounts, and CAST AI MCP integration.
---

# CAST AI API and MCP investigation

## Procedure
1. Record operation purpose and whether **read-only**; identify target account region (US or EU), organization, product area and required data.
2. Locate the exact operation in current official API documentation/OpenAPI. CAST AI has multiple specs; **do not presume Value Realization/reporting operations live in the legacy `v1` management spec**.
3. Verify **HTTP method, full route, authentication, permission scope, required request body/query fields, pagination, timestamp format, response schema, and documented errors** before providing a runnable request. If not verifiable, provide discovery steps rather than made-up fields.
4. Classify failures: 400 invalid input or inapplicable report prerequisites; 401 authentication; 403 authorization/role/scope or org mismatch; 404 route/resource/report not found or a feature-specific unavailable state **only if documented**; 429 limits; 5xx server errors. Never assign a definitive cause from HTTP code alone.
5. For divergent outputs, record response timestamps, exact spec/version, host/region, org/cluster IDs (redacted when shared), request parameters, and success/failure status.
6. For MCP: validate client transport, approved auth path, API scope and region. Current docs describe `https://docs.cast.ai/mcp` with `X-API-Key` and `x-readme-auth: castai-mcp`; the `server` query parameter can select EU vs US. Recheck current docs before use.
7. Use GET / explicitly documented read-only operations for investigation. A `POST` may be read-only for particular reporting APIs but **verify semantics**; do not generalize from method. No write requests without explicit approval.

## Safe API example pattern (illustrative; confirm endpoint path in spec)
```text
Method: GET
Host:   https://api.eu.cast.ai
Path:   <verified-read-only-path>
Auth:   X-API-Key: <credential-via-secret-manager>
Scope:  <verified-permission-scope>
```
Do not put API credentials into URLs, shell history, shared logs, screenshots, or tickets. Use approved secret-injection mechanisms and redact responses before sharing. Avoid any automatic API discovery that calls mutating endpoints.

## Output
**Operation** / **Exact doc reference** / **Region and expected auth** / **Observed HTTP status** / **Validated cause or next probe** / **Safe example**.

## References
- [Official API reference](https://docs.cast.ai/reference)
- [CAST AI MCP documentation](https://docs.cast.ai/reference/mcp)
- [CAST AI v1 Swagger](https://api.cast.ai/v1/spec/)
- [CAST AI docs](https://docs.cast.ai/)
