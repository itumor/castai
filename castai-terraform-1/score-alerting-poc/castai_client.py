"""Minimal stdlib CAST AI API client for the score-alerting POC.

Auth and base URLs per https://docs.cast.ai/reference/llms.txt :
  - US:  https://api.cast.ai
  - EU:  https://api.eu.cast.ai
  - Auth: ``X-API-Key: <key>`` (default) or ``Authorization: Bearer <jwt>``.
    Set ``CASTAI_AUTH_HEADER=bearer`` in the environment to switch.

All documented endpoints used here are GET + JSON. A pluggable ``transport``
callable keeps the client fully unit-testable without network access.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE_URL = "https://api.cast.ai"
EU_BASE_URL = "https://api.eu.cast.ai"


class ApiError(Exception):
    """Raised when the CAST AI API (or the wire) returns an error."""

    def __init__(self, status: int, message: str, path: str = ""):
        super().__init__(f"HTTP {status} on {path}: {message}")
        self.status = status
        self.path = path
        self.message = message


def _default_transport(method: str, url: str, headers: dict, body: bytes | None):
    """HTTP transport via urllib. Returns (status_code, response_bytes)."""
    request = urllib.request.Request(url, data=body, headers=dict(headers), method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:  # HTTP-level error still has a body.
        return exc.code, exc.read()
    except urllib.error.URLError as exc:
        raise ApiError(0, f"network error: {exc.reason}", url) from exc


class CastaiClient:
    """Thin CAST AI API wrapper with header, pagination and retry handling."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None,
                 timeout: int = 30, retries: int = 2, transport=None, logger=None):
        self.base_url = (base_url
                         or os.environ.get("CASTAI_API_URL")
                         or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self.retries = retries
        self.transport = transport or _default_transport
        self.log = logger or (lambda *args, **kwargs: None)

        key = api_key or os.environ.get("CASTAI_API_KEY") or ""
        auth_style = os.environ.get("CASTAI_AUTH_HEADER", "x-api-key").lower()
        # A real User-Agent is required: api.cast.ai sits behind Cloudflare,
        # which blocks library defaults (python-urllib/…) with HTTP 403/1010.
        self.headers = {
            "Accept": "application/json",
            "User-Agent": os.environ.get(
                "CASTAI_USER_AGENT",
                "castai-score-alerting-poc/1.0 (+https://cast.ai)"),
        }
        if key:
            if auth_style == "bearer":
                self.headers["Authorization"] = f"Bearer {key}"
            elif auth_style == "token":
                self.headers["Authorization"] = f"Token {key}"
            else:
                self.headers["X-API-Key"] = key

    # -- core HTTP ---------------------------------------------------------

    def _request(self, method: str, path: str, params: dict | None = None,
                 payload: dict | None = None) -> dict:
        """Perform one JSON request with retry on 429/5xx. Never raises on 404
        page-not-found shape unless retries are exhausted."""
        query = ""
        if params:
            flat = {k: v for k, v in params.items() if v is not None}
            if flat:
                query = "?" + urllib.parse.urlencode(flat, doseq=True)
        url = f"{self.base_url}{path}{query}"
        body = None
        headers = dict(self.headers)
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode()

        last_status, last_text = 0, ""
        for attempt in range(self.retries + 1):
            self.log("%s %s", method, url)
            status, raw = self.transport(method, url, headers, body)
            last_status = status
            text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
            last_text = text
            if status in (429, 500, 502, 503, 504) and attempt < self.retries:
                time.sleep(2 ** attempt)
                continue
            if status == 404:
                raise ApiError(status, "not found", path)
            if status >= 400:
                raise ApiError(status, text[:400], path)
            if not text.strip():
                return {}
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                raise ApiError(status, f"invalid JSON: {exc}", path) from exc
        raise ApiError(last_status, f"retries exhausted: {last_text[:200]}", path)

    def get(self, path: str, params: dict | None = None) -> dict:
        return self._request("GET", path, params=params)

    # -- org / cluster discovery ------------------------------------------

    def scoped(self, org_id: str) -> "CastaiClient":
        """Return a client pinned to one (child) org context.

        Verified against api.eu.cast.ai: the org-switch header is
        ``X-Castai-Organization-Id`` (NOT X-Organization-Id — that one is
        silently ignored). Cluster/signal endpoints under that header return
        that org's data."""
        clone = CastaiClient(base_url=self.base_url, timeout=self.timeout,
                             retries=self.retries, transport=self.transport,
                             logger=self.log)
        clone.headers = dict(self.headers)
        clone.headers["X-Castai-Organization-Id"] = org_id
        return clone

    def list_organizations(self) -> list[dict]:
        """UsersAPI_ListOrganizations — every org the token's user is a
        member of, including the enterprise org and its children."""
        data = self.get("/v1/organizations")
        return data.get("organizations", []) or []

    def enterprise_child_orgs(self, enterprise_id: str) -> list[dict]:
        """EnterpriseAPI_ListChildrenOrganizations — all child orgs visible to
        the token. Docs: /reference/enterpriseapi_listchildrenorganizations"""
        out: list[dict] = []
        cursor: str | None = None
        while True:
            data = self.get(f"/organization-management/v1/enterprises/{enterprise_id}/organizations",
                            params={"page.cursor": cursor})
            out.extend(data.get("items", []))
            cursor = data.get("nextPageCursor") or None
            if not cursor:
                return out

    def list_clusters(self) -> list[dict]:
        """ExternalClusterAPI_ListClusters for the token's organization."""
        data = self.get("/v1/kubernetes/external-clusters")
        return data.get("items", []) or []

    # -- per-cluster signal endpoints --------------------------------------

    def efficiency(self, cluster_id: str, start_iso: str, end_iso: str) -> dict:
        """ClusterReportAPI efficiency report (overprovisioning %, costs)."""
        return self.get(f"/v1/cost-reports/clusters/{cluster_id}/efficiency",
                        params={"startTime": start_iso, "endTime": end_iso,
                                "stepSeconds": "3600"})

    def estimated_savings(self, cluster_id: str) -> dict:
        """Available savings recommendation incl. isRebalancingRecommended."""
        return self.get(f"/v1/cost-reports/clusters/{cluster_id}/estimated-savings")

    def autoscaler_policies(self, cluster_id: str) -> dict:
        """PoliciesAPI_GetClusterPolicies (evictor, unschedulable pods, spot)."""
        return self.get(f"/v1/kubernetes/clusters/{cluster_id}/policies")

    def evictor_config(self, cluster_id: str) -> dict:
        """EvictorAPI_GetConfig — evictor enabled/dry-run/aggressive flags."""
        return self.get(f"/workload-eviction/v1/clusters/{cluster_id}/config")

    def woop_policies(self, cluster_id: str) -> dict:
        """WorkloadOptimizationAPI_ListWorkloadScalingPolicies."""
        return self.get(f"/v1/workload-autoscaling/clusters/{cluster_id}/policies")

    def rebalancing_plans(self, cluster_id: str) -> dict:
        """AutoscalerAPI_ListRebalancingPlans."""
        return self.get(f"/v1/kubernetes/clusters/{cluster_id}/rebalancing-plans")

    def restrictions(self, org_id: str, cluster_id: str) -> dict:
        """ClusterScoreAPI_ListClusterRestrictions — the advisory constraint
        catalogue behind a low score."""
        return self.get(f"/reporting/v1beta/organizations/{org_id}/clusters/{cluster_id}/restrictions")

    def audit_entries(self, cluster_id: str, from_iso: str, to_iso: str,
                      limit: int = 50) -> dict:
        """AuditAPI_ListAuditEntries — used for owner inference only."""
        return self.get("/v1/audit", params={
            "clusterId": cluster_id, "fromDate": from_iso, "toDate": to_iso,
            "page.limit": str(limit)})
