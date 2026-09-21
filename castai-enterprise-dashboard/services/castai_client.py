"""Read-only CAST AI API client (implemented by Builder B1).

Rules (docs/security-requirements.md, docs/performance.md):
  * GET-only transport with a centralized method allow-list. The ONLY permitted
    non-GET calls are read-semantics report query paths in ALLOWED_READ_POST_PATHS.
  * Headers: X-API-Key always; X-CastAI-Organization-Id when org_id is given
    (undocumented in OpenAPI but load-bearing for enterprise keys — one constant).
  * Never log headers or the API key. Never retry 401/403. Retry 429/5xx with
    backoff+jitter, honor Retry-After. Timeouts mandatory (connect 5s / read 30s;
    60s for historical endpoints).
  * Error taxonomy (utils/errors.py):
      CastAIError -> AuthError(401), PermissionDeniedError(403), NotFoundError(404),
      RateLimitedError(429), ServerError(5xx), ApiTimeoutError(timeout).

Transport: ONE lazily-created thread-safe ``httpx.Client`` (``verify=True``
always, SEC-2.4). This module owns URL/status/timeout policy ONLY — response
parsing belongs to the normalizers (docs/architecture.md §2).
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import re

import httpx

from utils.errors import (
    ApiTimeoutError,
    AuthError,
    CastAIError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    ServerError,
)
from utils.logging import get_logger
from utils.retries import with_retry

ORG_HEADER = "X-CastAi-Organization-Id"
API_KEY_HEADER = "X-API-Key"

ALLOWED_READ_POST_PATHS: frozenset[str] = frozenset(
    {
        "/v1/cost-reports/clusters/active",
        "/v1/cost-reports/clusters/{clusterId}/workload-cost-summaries",
        "/v1/cost-reports/clusters/{clusterId}/namespace-cost-summaries",
        "/v1/cost-reports/clusters/{clusterId}/workload-efficiency",
    }
)

_GET_PATH_PREFIXES = ("/v1/", "/savings/")
_READ_POST_TEMPLATE = "{clusterId}"
_HTTP_DATE_YEAR_FLOOR = 1970  # sanity floor for parsed Retry-After dates

# Historical/heavy report paths get the 60 s read window (performance.md §2.4).
_LONG_READ_MARKERS = ("history", "daily-cost", "report")

_USER_AGENT = "castai-enterprise-dashboard/0.1.0"  # no key/org/host (SEC-2.8)

# Pre-wire validation allow-lists (api-delta-v2 §2g/§3.7): the server answers
# 400 on unknown values, so the client rejects them before any byte leaves.
# Event types are free-form k8s reason strings; the allow-list is the
# documented set (extend only against the spec snapshot).
ALLOWED_EVENT_TYPES: frozenset[str] = frozenset(
    {"OOMKilled", "FailedScheduling", "BackOff", "Killing", "Evicted"}
)
ALLOWED_STEP_SECONDS: frozenset[int] = frozenset({0, 30, 300, 600, 900, 3600, 86400})
NOTIFICATION_SEVERITIES: frozenset[str] = frozenset(
    {"UNSPECIFIED", "CRITICAL", "ERROR", "WARNING", "INFO", "SUCCESS"}
)

_PAGE_HARD_CAP = 200  # absolute ceiling for any auto-pagination helper

# SEC-4.4 / CHK-15: RFC-3986 unreserved characters + ':' per path segment
# (':' is required for AIP-136 custom verbs, e.g. /savings/v1beta/.../{id}:getUsageHistory).
_PATH_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._~:-]+$")

_log = get_logger(__name__)


def _validate_path(path: str) -> None:
    """Reject path-traversal / smuggling attempts in request paths (SEC-4.4).

    Every request path — static or f-string-built from ids that may originate
    in user input (query-param seeding, table selection) — funnels through
    ``_request`` and thus through this gate. Rules: absolute path, no empty
    segments, no ``..`` segments, no backslashes/whitespace/control chars,
    no percent-encoding (blocks ``%2e`` traversal), no query/fragment chars,
    and every segment is RFC-3986 unreserved characters only.
    """

    if not isinstance(path, str) or not path.startswith("/"):
        raise PermissionDeniedError("Client path rejected by validation.")
    for segment in path.split("/")[1:]:
        if not segment or segment == ".." or not _PATH_SEGMENT_RE.match(segment):
            raise PermissionDeniedError("Client path rejected by validation.")


def _validate_event_types(event_types: Any) -> list[str]:
    """Pre-wire allow-list (api-delta-v2 §2g): unknown reasons -> ValueError,
    before any HTTP call. Accepts a single string or an iterable."""

    if event_types is None:
        return []
    if isinstance(event_types, str):
        event_types = [event_types]
    out: list[str] = []
    for item in event_types:
        value = str(item)
        if value not in ALLOWED_EVENT_TYPES:
            raise ValueError(f"event type {value!r} is not in the client allow-list.")
        out.append(value)
    return list(dict.fromkeys(out))  # dedup, preserve order


def _validate_step_seconds(step_seconds: Any) -> int:
    """Pre-wire stepSeconds allow-list {0,30,300,600,900,3600,86400} (0=auto)."""

    try:
        step = int(step_seconds)
    except (TypeError, ValueError):
        raise ValueError(f"stepSeconds {step_seconds!r} is not in the client allow-list.")
    if step not in ALLOWED_STEP_SECONDS:
        raise ValueError(f"stepSeconds {step_seconds!r} is not in the client allow-list.")
    return step


def _validate_severities(severities: Any) -> list[str]:
    """Notification severity enum allow-list (api-delta-v2 §2h)."""

    out: list[str] = []
    for item in severities or []:
        value = str(item)
        if value not in NOTIFICATION_SEVERITIES:
            raise ValueError(f"severity {value!r} is not in the client allow-list.")
        out.append(value)
    return list(dict.fromkeys(out))


class _RateGate:
    """429-reactive permit gate (performance-v2 §3.3): halve active permits on
    any 429 (floor 2), cool down 60 s, recover +1 permit per fully clean 60 s
    window, restoring up to the cap on a sustained success streak. Thread-safe;
    costs one lock acquire (~µs) when no 429 ever occurs. The ``clock`` soft
    dependency is injectable/monkeypatchable so tests can drive time."""

    def __init__(
        self,
        initial: int = 8,
        cap: int = 16,
        *,
        floor: int = 2,
        cooldown_s: float = 60.0,
        clock: Any = None,
    ) -> None:
        self._cond = threading.Condition()
        self._cap = max(1, int(cap))
        self._floor = max(1, min(int(floor), self._cap))
        self._limit = max(self._floor, min(int(initial), self._cap))
        self._cooldown_s = float(cooldown_s)
        self._clock = clock or time.monotonic
        self._inflight = 0
        self._clean_since = self._clock()

    def acquire(self) -> None:
        with self._cond:
            while True:
                self._recover()
                if self._inflight < self._limit:
                    self._inflight += 1
                    return
                self._cond.wait(timeout=0.05)

    def release(self) -> None:
        with self._cond:
            self._inflight = max(0, self._inflight - 1)
            self._cond.notify()

    def on_429(self) -> None:
        with self._cond:
            self._limit = max(self._floor, self._limit // 2)  # halve, floor 2
            self._clean_since = self._clock()  # 60 s cooldown restarts

    def on_success(self) -> None:
        with self._cond:
            self._recover()

    def _recover(self) -> None:  # caller holds self._cond
        if self._limit >= self._cap:
            self._clean_since = self._clock()
            return
        gained = int((self._clock() - self._clean_since) // self._cooldown_s)
        if gained > 0:
            self._limit = min(self._cap, self._limit + gained)
            self._clean_since = self._clock()


class CastAIClient:
    """Synchronous read-only CAST AI client. Thread-safe; owns no config.

    ``api_key`` reaches memory exactly twice: here and in the httpx client's
    default headers (SEC-2.1). It is never logged, copied, or repr'd.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        connect_timeout: float = 5.0,
        read_timeout: float = 30.0,
        max_retries: int = 4,
        max_permits: int = 8,
        gate: _RateGate | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._connect_timeout = float(connect_timeout)
        self._read_timeout = float(read_timeout)
        self._max_retries = max(1, int(max_retries))
        # 429-reactive permit gate (perf-v2 §3.3) — injectable soft dependency.
        self._gate = gate if gate is not None else _RateGate(initial=max_permits)
        self._client: httpx.Client | None = None
        self._client_lock = threading.Lock()
        self._default_headers = {
            API_KEY_HEADER: api_key,
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        }
        # Observability counters (performance.md §7) — all thread-safe.
        self._stats_lock = threading.Lock()
        self._requests = 0
        self._failures = 0
        self._total_latency_s = 0.0
        self._by_status: dict[int, int] = {}

    # ------------------------------------------------------------------ HTTP
    def _get_client(self) -> httpx.Client:
        """ONE shared httpx.Client per instance, created lazily, verify=True."""

        if self._client is None:
            with self._client_lock:
                if self._client is None:  # double-checked locking
                    self._client = httpx.Client(
                        base_url=self._base_url,
                        headers=self._default_headers,
                        verify=True,  # SEC-2.4 — TLS verification always on
                        http2=False,
                        follow_redirects=False,  # defense in depth
                    )
        return self._client

    def close(self) -> None:
        with self._client_lock:
            if self._client is not None:
                self._client.close()
                self._client = None

    def __enter__(self) -> "CastAIClient":
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self.close()

    # ----------------------------------------------------------------- stats
    def _record(self, status: int | None, latency_s: float, failed: bool) -> None:
        with self._stats_lock:
            self._requests += 1
            self._total_latency_s += latency_s
            if failed:
                self._failures += 1
            if status is not None:
                self._by_status[status] = self._by_status.get(status, 0) + 1

    def stats(self) -> dict[str, Any]:
        """Thread-safe snapshot for the observability surface."""

        with self._stats_lock:
            return {
                "requests": self._requests,
                "failures": self._failures,
                "total_latency_s": self._total_latency_s,
                "by_status": dict(self._by_status),
            }

    # ------------------------------------------------------------- transport
    def _headers(self, org_id: str | None) -> dict[str, str]:
        headers = dict(self._default_headers)
        if org_id:
            headers[ORG_HEADER] = org_id
        return headers

    def _timeout_for(self, path: str) -> httpx.Timeout:
        read = (
            max(self._read_timeout, 60.0)
            if any(marker in path for marker in _LONG_READ_MARKERS)
            else self._read_timeout
        )
        return httpx.Timeout(
            connect=self._connect_timeout,
            read=read,
            write=10.0,
            pool=10.0,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        org_id: str | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict:
        """Single transport chokepoint (SEC-4.2). Method allow-list is enforced

        by the public wrappers (``get``/``post_read``) BEFORE reaching here.
        Retries via utils.retries.with_retry; 401/403 never retried (SEC-2.6).
        """

        if method not in ("GET", "POST"):  # assertion-grade guard (CHK-14)
            raise PermissionDeniedError("HTTP method not allowed by read-only client.")
        _validate_path(path)  # SEC-4.4 / CHK-15 — traversal gate at the chokepoint

        def _once() -> dict:
            started = time.monotonic()
            status: int | None = None
            try:
                self._gate.acquire()  # 429-reactive permit gate (perf-v2 §3.3)
                try:
                    response = self._get_client().request(
                        method,
                        path,
                        headers=self._headers(org_id),
                        params=params,
                        json=json_body,
                        timeout=self._timeout_for(path),
                    )
                finally:
                    self._gate.release()
                status = response.status_code
                if status == 429:
                    self._gate.on_429()  # halve permits, restart 60 s cooldown
                if status >= 400:
                    self._record(status, time.monotonic() - started, True)
                    self._raise_for_status(response, method, path)
                try:
                    payload = response.json()
                except ValueError:
                    self._record(0, time.monotonic() - started, True)
                    raise CastAIError(f"CAST AI returned a non-JSON body [{method} {path}].")
                self._record(status, time.monotonic() - started, False)
                self._gate.on_success()  # clean streak -> recover +1 per 60 s
                return payload if isinstance(payload, dict) else {"items": payload}
            except httpx.TimeoutException:
                self._record(0, time.monotonic() - started, True)
                raise ApiTimeoutError(f"CAST AI request timed out [{method} {path}].")
            except CastAIError:
                raise  # _raise_for_status already recorded it
            except httpx.HTTPError:
                self._record(0, time.monotonic() - started, True)
                raise ServerError(f"CAST AI connection failed [{method} {path}].")

        try:
            return with_retry(_once, attempts=self._max_retries)
        except CastAIError as exc:
            _log.warning(
                "api_call_failed",
                extra={"method": method, "path": path, "error": str(exc)},
            )
            raise

    def _raise_for_status(self, response: httpx.Response, method: str, path: str) -> None:
        """Status -> typed error (SEC-2.7 generic messages; bodies never echoed)."""

        status = response.status_code
        label = f"[{method} {path}]"
        if status == 400:
            err: CastAIError = CastAIError(f"CAST AI rejected the request (400) {label}.")
        elif status == 401:
            err = AuthError(f"CAST AI API key rejected (401) {label}.")
        elif status == 403:
            err = PermissionDeniedError(f"CAST AI API key lacks the required scope (403) {label}.")
        elif status == 404:
            err = NotFoundError(f"CAST AI resource not found (404) {label}.")
        elif status == 429:
            err = RateLimitedError(
                f"CAST AI rate limit hit (429) {label}.",
                retry_after=_parse_retry_after(response.headers.get("Retry-After")),
            )
        elif 500 <= status <= 599:
            err = ServerError(f"CAST AI upstream error ({status}) {label}.")
        else:
            err = CastAIError(f"CAST AI unexpected status ({status}) {label}.")
        raise err

    # --------------------------------------------------------------- verbs
    def get(self, path: str, *, org_id: str | None = None, params: dict[str, Any] | None = None) -> dict:
        """GET an allowed read path (``/v1/...`` or ``/savings/...``)."""

        if not isinstance(path, str) or not path.startswith(_GET_PATH_PREFIXES):
            raise CastAIError("Client path must start with '/v1/' or '/savings/'.")
        return self._request("GET", path, org_id=org_id, params=params)

    def post_read(self, path: str, *, org_id: str | None = None, json: dict[str, Any] | None = None) -> dict:
        """Read-semantics POST against ALLOWED_READ_POST_PATHS only (SEC-4.3).

        The TEMPLATE is validated: callers substitute ``{clusterId}`` before
        calling, and the template marker is re-inserted for the whitelist
        check, so concrete ids can never smuggle a non-whitelisted path.
        """

        if not isinstance(path, str):
            raise PermissionDeniedError("POST path is not on the read-only allow-list.")
        # Exact hit covers literal whitelist entries (e.g. '.../clusters/active'
        # and literal template forms); otherwise restore the template from the
        # concrete path and check the template.
        allowed = path in ALLOWED_READ_POST_PATHS
        if not allowed:
            allowed = _template_restore(path) in ALLOWED_READ_POST_PATHS
        if not allowed:
            raise PermissionDeniedError("POST path is not on the read-only allow-list.")
        return self._request("POST", path, org_id=org_id, json_body=json)

    # --- hierarchy (Tier 0/1) ---------------------------------------------
    def get_organizations(self) -> dict:  # GET /v1/organizations
        return self.get("/v1/organizations")

    def get_clusters(self, org_id: str) -> dict:  # GET /v1/kubernetes/external-clusters
        return self.get("/v1/kubernetes/external-clusters", org_id=org_id)

    # --- organization-level reporting (Tier 1) -----------------------------
    def get_org_clusters_summary(self, org_id: str) -> dict:
        return self.get("/v1/cost-reports/organization/clusters/summary", org_id=org_id)

    def get_org_clusters_report(self, org_id: str, start: str, end: str) -> dict:
        return self.get(
            "/v1/cost-reports/organization/clusters/report",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_org_clusters_efficiency(self, org_id: str, start: str, end: str) -> dict:
        return self.get(
            "/v1/cost-reports/organization/clusters/efficiency",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_org_efficiency_summary(self, org_id: str, start: str, end: str) -> dict:
        return self.get(
            "/v1/cost-reports/organization/efficiency/summary",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_org_daily_cost(self, org_id: str, start: str, end: str) -> dict:
        return self.get(
            "/v1/cost-reports/organization/daily-cost",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_org_overview(self, org_id: str, start: str, end: str) -> dict:
        return self.get(
            "/v1/cost-reports/organization/overview",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_org_wa_agent_statuses(self, org_id: str) -> dict:
        # All clusters' WA agent status in ONE call per org (api-matrix §7.2).
        return self.get(
            f"/v1/workload-autoscaling/organizations/{org_id}/components/workload-autoscaler",
            org_id=org_id,
        )

    def get_notifications(
        self,
        org_id: str,
        *,
        severities: Any = None,
        cluster_id: str | None = None,
        is_acked: bool | None = None,
        is_expired: bool | None = None,
        limit: int = 500,
        cursor: str | None = None,
    ) -> dict:
        """GET /v1/notifications (api-delta-v2 §2h). Envelope: ``items[]`` +
        ``count``/``countUnacked``/``hasAny`` + ``nextCursor``/``previousCursor``.
        Severities validated pre-wire against the closed enum."""

        params: dict[str, Any] = {"page.limit": int(limit)}
        if cursor:
            params["page.cursor"] = cursor
        sel = _validate_severities(severities)
        if sel:
            params["filter.severities"] = sel
        if cluster_id:
            params["filter.clusterId"] = cluster_id
        if is_acked is not None:
            params["filter.isAcked"] = bool(is_acked)
        if is_expired is not None:
            params["filter.isExpired"] = bool(is_expired)
        return self.get("/v1/notifications", org_id=org_id, params=params)

    # --- api-delta-v2 family methods (v2 expansion; all GET, org-scoped) ----
    def get_org_cluster_efficiency(
        self,
        org_id: str,
        start: str,
        end: str,
        limit: int = 500,
        cursor: str | None = None,
    ) -> dict:
        """GET /v1/cost-reports/organization/clusters/efficiency — per-cluster
        rows carrying ``wasted{cpu,ram,storage}`` (DOUBLES, USD/window) and
        ``nextCursor`` pagination (api-delta-v2 §2c)."""

        params: dict[str, Any] = {
            "startTime": start,
            "endTime": end,
            "page.limit": int(limit),
        }
        if cursor:
            params["page.cursor"] = cursor
        return self.get(
            "/v1/cost-reports/organization/clusters/efficiency", org_id=org_id, params=params
        )

    def get_org_efficiency(self, org_id: str, start: str, end: str, step_seconds: int = 86400) -> dict:
        """GET /v1/cost-reports/organization/efficiency — the SERIES variant
        (items[] with onDemand/spot/fallback lifecycle blocks); distinct from
        the flux ``.../efficiency/summary`` rollup (historical-model §2.3-A)."""

        return self.get(
            "/v1/cost-reports/organization/efficiency",
            org_id=org_id,
            params={
                "startTime": start,
                "endTime": end,
                "stepSeconds": _validate_step_seconds(step_seconds),
            },
        )

    def get_org_workload_event_metrics(
        self,
        org_id: str,
        metrics: Any = None,
        event_types: Any = None,
        start: str | None = None,
        end: str | None = None,
        step_seconds: int = 86400,
    ) -> dict:
        """GET /v1/cost-reports/organization/workload-event-metrics
        (api-delta-v2 §2g). ``metrics`` and ``event_types`` UNION into the
        ``eventTypes`` wire param; each value must pass the pre-wire
        allow-list (unknown k8s reasons are HTTP 400 server-side — rejected
        here first with ValueError). Fleet totals ONLY: the org response has
        NO clusterId anywhere (reliability-model §3.2)."""

        events = _validate_event_types(metrics) + _validate_event_types(event_types)
        params: dict[str, Any] = {
            "startTime": start,
            "endTime": end,
            "stepSeconds": _validate_step_seconds(step_seconds),
        }
        events = list(dict.fromkeys(events))
        if events:
            params["eventTypes"] = events
        return self.get(
            "/v1/cost-reports/organization/workload-event-metrics", org_id=org_id, params=params
        )

    def get_org_idle_disks(self, org_id: str, limit: int = 500, cursor: str | None = None) -> dict:
        """GET /v1/cost-reports/idle-resources/disks (api-delta-v2 §2j).
        DELTA vs v1: envelope carries ``nextPage{limit,cursor}`` — NOT
        ``nextCursor``; ``storageCostMonthly`` is already USD/month."""

        params: dict[str, Any] = {"page.limit": int(limit)}
        if cursor:
            params["page.cursor"] = cursor
        return self.get("/v1/cost-reports/idle-resources/disks", org_id=org_id, params=params)

    # --- cluster-level api-delta-v2 methods (Tier 2 / batch) ---------------
    def get_cluster_workload_event_metrics(
        self,
        org_id: str,
        cluster_id: str,
        metrics: Any = None,
        event_types: Any = None,
        start: str | None = None,
        end: str | None = None,
        step_seconds: int = 86400,
        bucket_timestamp: str | None = None,
    ) -> dict:
        """GET /v1/cost-reports/clusters/{id}/workload-event-metrics — cluster
        sibling of the org endpoint (adds ``bucketTimestamp`` for a
        single-bucket workload breakdown; api-delta-v2 §2g). Same pre-wire
        eventTypes/stepSeconds allow-lists as the org variant."""

        events = _validate_event_types(metrics) + _validate_event_types(event_types)
        params: dict[str, Any] = {
            "startTime": start,
            "endTime": end,
            "stepSeconds": _validate_step_seconds(step_seconds),
        }
        events = list(dict.fromkeys(events))
        if events:
            params["eventTypes"] = events
        if bucket_timestamp:
            params["bucketTimestamp"] = bucket_timestamp
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/workload-event-metrics",
            org_id=org_id,
            params=params,
        )

    def get_cluster_realized_savings(
        self,
        org_id: str,
        cluster_id: str,
        start: str,
        end: str,
        step_seconds: int = 86400,
    ) -> dict:
        """GET /v1/cost-reports/clusters/{id}/savings — the ONLY realized
        savings endpoint. ``items[]{timestamp, downscalingSavings, spotSavings}``
        (string USD/bucket) + ``summary{totalCost,totalSavings}`` (string USD
        over window). Never mixed with estimated savings (finops-model §3)."""

        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/savings",
            org_id=org_id,
            params={
                "startTime": start,
                "endTime": end,
                "stepSeconds": _validate_step_seconds(step_seconds),
            },
        )

    def get_cluster_estimated_savings_history(
        self, org_id: str, cluster_id: str, from_dt: str, to_dt: str
    ) -> dict:
        """GET /v1/cost-reports/clusters/{id}/estimated-savings-history —
        event-driven snapshots ``items[]{createdAt, current{}, optimizedSpot
        Instances{}, optimizedLayman{}, optimizedSpotOnly{}}`` (api-delta-v2 §2b)."""

        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/estimated-savings-history",
            org_id=org_id,
            params={"fromDate": from_dt, "toDate": to_dt},
        )

    def get_cluster_node_count_history(
        self,
        org_id: str,
        cluster_id: str,
        start: str,
        end: str,
        step_seconds: int = 86400,
    ) -> dict:
        """GET /v1/cost-reports/clusters/{id}/node-count-history —
        ``items[]{timestamp, nodeCountOnDemand/Spot/Fallback/Unknown, source}``
        + ``sources[]`` + ``lastSnapshotAt`` (api-delta-v2 §2i)."""

        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/node-count-history",
            org_id=org_id,
            params={
                "startTime": start,
                "endTime": end,
                "stepSeconds": _validate_step_seconds(step_seconds),
            },
        )

    # --- auto-pagination helpers (bounded; envelope-aware) -----------------
    def _collect_pages(self, fetch_page: Any, items_key: str, next_cursor_of: Any) -> list:
        """Loop a cursor-paginated endpoint to exhaustion (or ``_PAGE_HARD_CAP``
        pages). ``fetch_page(cursor) -> payload``; ``next_cursor_of(payload)``
        returns the next cursor or a falsy value to stop."""

        items: list = []
        cursor: str | None = None
        for _ in range(_PAGE_HARD_CAP):
            payload = fetch_page(cursor)
            chunk = payload.get(items_key)
            if isinstance(chunk, list):
                items.extend(chunk)
            cursor = next_cursor_of(payload)
            if not cursor:
                break
        return items

    def get_all_org_cluster_efficiency(
        self, org_id: str, start: str, end: str, limit: int = 500
    ) -> list:
        """All pages of ``organization/clusters/efficiency`` (nextCursor env.)."""

        return self._collect_pages(
            lambda cursor: self.get_org_cluster_efficiency(org_id, start, end, limit=limit, cursor=cursor),
            "items",
            lambda payload: payload.get("nextCursor") or None,
        )

    def get_all_org_idle_disks(self, org_id: str, limit: int = 500) -> list:
        """All pages of ``idle-resources/disks`` — DELTA envelope
        ``nextPage{limit,cursor}`` (NOT nextCursor; api-delta-v2 §4.1)."""

        return self._collect_pages(
            lambda cursor: self.get_org_idle_disks(org_id, limit=limit, cursor=cursor),
            "idleDisks",
            lambda payload: (payload.get("nextPage") or {}).get("cursor") or None,
        )

    def get_all_wa_workloads(self, org_id: str, cluster_id: str, limit: int = 500) -> list:
        """All pages of ``workload-autoscaling/.../workloads`` — the envelope
        list key is ``workloads[]`` (NOT items[]; api-delta-v2 §4.5)."""

        def _page(cursor: str | None) -> dict:
            filters = {"page.limit": int(limit)}
            if cursor:
                filters["page.cursor"] = cursor
            return self.get_wa_workloads(org_id, cluster_id, **filters)

        return self._collect_pages(
            _page, "workloads", lambda payload: payload.get("nextCursor") or None
        )

    def get_active_cluster_ids(self, org_id: str, start: str, end: str) -> dict:
        return self.post_read(
            "/v1/cost-reports/clusters/active",
            org_id=org_id,
            json={"startTime": start, "endTime": end},
        )

    # --- cluster-level drill-down (Tier 2, lazy) ---------------------------
    def get_cluster_overview(self, org_id: str, cluster_id: str, start: str, end: str) -> dict:
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/overview",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_cluster_summary(self, org_id: str, cluster_id: str) -> dict:
        return self.get(f"/v1/cost-reports/clusters/{cluster_id}/summary", org_id=org_id)

    def get_cluster_resource_usage(self, org_id: str, cluster_id: str, start: str, end: str) -> dict:
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/resource-usage",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_cluster_cost(self, org_id: str, cluster_id: str, start: str, end: str) -> dict:
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/cost",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_cluster_estimated_savings(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/estimated-savings", org_id=org_id
        )

    def get_cluster_savings(self, org_id: str, cluster_id: str, start: str, end: str) -> dict:
        # REALIZED savings — the only realized endpoint (api-matrix §5.1).
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/savings",
            org_id=org_id,
            params={"startTime": start, "endTime": end},
        )

    def get_cluster_rightsizing_summary(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/rightsizing-summary", org_id=org_id
        )

    def get_cluster_nodes(self, org_id: str, cluster_id: str, **filters: Any) -> dict:
        params: dict[str, Any] = {"page.limit": 500}
        params.update(filters)
        return self.get(
            f"/v1/kubernetes/external-clusters/{cluster_id}/nodes",
            org_id=org_id,
            params=params,
        )

    def get_problematic_nodes(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/kubernetes/clusters/{cluster_id}/problematic-nodes", org_id=org_id
        )

    def get_problematic_workloads(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/kubernetes/clusters/{cluster_id}/problematic-workloads", org_id=org_id
        )

    def get_unscheduled_pods(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/kubernetes/clusters/{cluster_id}/unscheduled-pods", org_id=org_id
        )

    def get_cluster_policies(self, org_id: str, cluster_id: str) -> dict:
        return self.get(f"/v1/kubernetes/clusters/{cluster_id}/policies", org_id=org_id)

    def get_cluster_agent_status(self, org_id: str, cluster_id: str) -> dict:
        return self.get(f"/v1/kubernetes/clusters/{cluster_id}/agent-status", org_id=org_id)

    def get_wa_workloads_summary(self, org_id: str, cluster_id: str) -> dict:
        return self.get(
            f"/v1/workload-autoscaling/clusters/{cluster_id}/workloads-summary",
            org_id=org_id,
            params={"includeCosts": "true"},
        )

    def get_wa_workloads(self, org_id: str, cluster_id: str, **filters: Any) -> dict:
        params: dict[str, Any] = {"page.limit": 500}
        params.update(filters)
        return self.get(
            f"/v1/workload-autoscaling/clusters/{cluster_id}/workloads",
            org_id=org_id,
            params=params,
        )

    # --- pricing (Wave-C drill-down Cost tab) ------------------------------
    def get_cluster_node_pricing(
        self,
        org_id: str,
        cluster_id: str,
        node_ids: Any = None,
        pricing_as_of: str | None = None,
    ) -> dict:
        """GET /v1/pricing/clusters/{id}/nodes — ``nodes[]{id, name, basePrice,
        totalPrice, totalRegularPrice, components[], extensions[], discounts[],
        pricingPeriod{startTime,endTime}, provider, region}``; prices are USD
        STRINGS (proto3; parse via data.normalizers.parse_number). All nodes
        returned when ``node_ids`` is omitted."""

        params: dict[str, Any] = {}
        if node_ids:
            params["nodeIds"] = [str(n) for n in node_ids]
        if pricing_as_of:
            params["pricingAsOf"] = pricing_as_of
        return self.get(
            f"/v1/pricing/clusters/{cluster_id}/nodes",
            org_id=org_id,
            params=params or None,
        )


def _parse_retry_after(raw: str | None) -> float | None:
    """Retry-After header: non-negative seconds or HTTP-date (performance §2.5).

    Clamping to [1, 30] s happens in utils.retries._sleep_seconds so the raw
    server hint stays visible on the error object (logged as clamped there).
    """

    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt.year < _HTTP_DATE_YEAR_FLOOR:
        return None
    return max(0.0, (dt - datetime.now(tz=timezone.utc)).total_seconds())


def _template_restore(path: str) -> str:
    """Map a concrete cluster path back onto its whitelist template.

    Only the single id segment after ``/clusters/`` is replaced; any other
    shape is left untouched (and therefore fails the allow-list check).
    """

    parts = path.split("/")
    try:
        idx = parts.index("clusters")
    except ValueError:
        return path
    if idx + 1 < len(parts) and parts[idx + 1]:
        parts[idx + 1] = _READ_POST_TEMPLATE
    return "/".join(parts)
