"""Client + settings tests (B1) — respx-mocked transport, no real network/key.

Covers the B1 contract: headers & org scoping, status->error mapping
(401/403/404/429+Retry-After/500/timeout), retry policy (429 retried, 4xx
never), post_read whitelist, GET path validation, base-URL allow-list,
fail-closed config, repr redaction, counter observability.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest
import respx

from config.settings import load_settings
from services.castai_client import (
    ALLOWED_READ_POST_PATHS,
    API_KEY_HEADER,
    ORG_HEADER,
    CastAIClient,
)
from utils import retries as retries_mod
from utils.errors import (
    ApiTimeoutError,
    AuthError,
    CastAIError,
    ConfigError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    ServerError,
    register_secret,
)
from utils.logging import configure_secret_scrub, scrub

KEY = "test-key-0123456789abcdef012345"  # synthetic; never a real key
ORG = "org-child-0001"
CLUSTER = "c-00000000-1111-2222-3333-444444444444"
BASE = "https://api.eu.cast.ai"
START = "2026-09-01T00:00:00Z"
END = "2026-09-30T00:00:00Z"

_ALL_ENV_VARS = (
    "CASTAI_API_KEY",
    "CASTAI_BASE_URL",
    "CASTAI_ENTERPRISE_ID",
    "CASTAI_MAX_WORKERS",
    "CASTAI_ENABLE_NOTIFICATIONS",
    "CASTAI_ENABLE_ORG_EFFICIENCY",
    "CASTAI_ENABLE_ACTIVE_PROBE",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Hermetic config: no ambient env vars, no real st.secrets file."""

    for name in _ALL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr("config.settings._secrets_get", lambda key: None)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    """Retries never actually sleep in tests (backoff tested via injection)."""

    monkeypatch.setattr(time, "sleep", lambda *_args, **_kwargs: None)


@pytest.fixture
def client():
    instance = CastAIClient(BASE, KEY)
    yield instance
    instance.close()


def _json_response(payload, status=200):
    return httpx.Response(status, json=payload)


# --------------------------------------------------------------------- verbs
class TestHeadersAndScoping:
    @respx.mock
    def test_headers_and_org_scoping(self, client):
        route = respx.get(f"{BASE}/v1/kubernetes/external-clusters").mock(
            return_value=_json_response({"items": []})
        )
        client.get_clusters(ORG)
        request = route.calls.last.request
        assert request.headers[API_KEY_HEADER] == KEY
        assert request.headers["Accept"] == "application/json"
        assert request.headers[ORG_HEADER] == ORG

    @respx.mock
    def test_org_header_absent_without_org_id(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            return_value=_json_response({"organizations": []})
        )
        client.get_organizations()
        headers = route.calls.last.request.headers
        assert headers[API_KEY_HEADER] == KEY
        assert ORG_HEADER not in headers  # no org -> no scoping header

    def test_key_never_in_repr_or_str(self, client):
        # SEC-2.1 allows the key in exactly two places (settings object,
        # client default headers); the object's repr must not surface it.
        assert KEY not in repr(client)
        assert KEY not in client.stats().values()


# ------------------------------------------------------------- status mapping
class TestStatusMapping:
    @respx.mock
    def test_401_maps_to_auth_error_and_is_never_retried(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(return_value=_json_response({}, 401))
        with pytest.raises(AuthError):
            client.get_organizations()
        assert route.call_count == 1  # credentials do not heal (SEC-2.6)

    @respx.mock
    def test_403_maps_to_permission_denied_and_is_never_retried(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(return_value=_json_response({}, 403))
        with pytest.raises(PermissionDeniedError):
            client.get_organizations()
        assert route.call_count == 1

    @respx.mock
    def test_404_maps_to_not_found_and_is_never_retried(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(return_value=_json_response({}, 404))
        with pytest.raises(NotFoundError):
            client.get_organizations()
        assert route.call_count == 1

    @respx.mock
    def test_400_maps_to_base_error_and_is_never_retried(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(return_value=_json_response({}, 400))
        with pytest.raises(CastAIError):
            client.get_organizations()
        assert route.call_count == 1

    @respx.mock
    def test_429_maps_to_rate_limited_with_retry_after(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "7"}, json={})
        )
        with pytest.raises(RateLimitedError) as exc_info:
            client.get_organizations()
        assert exc_info.value.retry_after == 7.0
        assert route.call_count == 4  # retriable: 1 + 3 retries

    @respx.mock
    def test_500_maps_to_server_error(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(return_value=_json_response({}, 500))
        with pytest.raises(ServerError):
            client.get_organizations()
        assert route.call_count == 4

    @respx.mock
    def test_timeout_maps_to_api_timeout_error(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=httpx.ReadTimeout("slow upstream")
        )
        with pytest.raises(ApiTimeoutError):
            client.get_organizations()
        assert route.call_count == 4  # timeouts are retriable


# ----------------------------------------------------------------- retrying
class TestRetryBehavior:
    @respx.mock
    def test_429_then_success(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[
                httpx.Response(429, headers={"Retry-After": "1"}, json={}),
                _json_response({"organizations": [{"id": "o1"}]}),
            ]
        )
        result = client.get_organizations()
        assert result == {"organizations": [{"id": "o1"}]}
        assert route.call_count == 2

    @respx.mock
    def test_500_then_success(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[_json_response({}, 503), _json_response({"organizations": []})]
        )
        assert client.get_organizations() == {"organizations": []}
        assert route.call_count == 2

    @respx.mock
    def test_timeout_then_success(self, client):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[httpx.ReadTimeout("slow"), _json_response({"organizations": []})]
        )
        assert client.get_organizations() == {"organizations": []}
        assert route.call_count == 2


class TestWithRetryUnit:
    def test_4xx_family_never_retried(self):
        calls = {"n": 0}

        def boom():
            calls["n"] += 1
            raise AuthError("x")

        with pytest.raises(AuthError):
            retries_mod.with_retry(boom, attempts=4)
        assert calls["n"] == 1

    def test_retry_after_clamped_and_jittered(self):
        sleeps: list[float] = []

        def boom():
            raise RateLimitedError("x", retry_after=999.0)

        with pytest.raises(RateLimitedError):
            retries_mod.with_retry(boom, attempts=3, sleep=sleeps.append)
        assert len(sleeps) == 2
        assert all(0.0 <= s <= 30.0 for s in sleeps)  # clamp cap 30 s

    def test_backoff_shape_capped(self):
        sleeps: list[float] = []

        def boom():
            raise ServerError("x")

        with pytest.raises(ServerError):
            retries_mod.with_retry(boom, attempts=4, base=0.5, cap=15.0, sleep=sleeps.append)
        assert len(sleeps) == 3
        assert sleeps[0] <= 0.5
        assert sleeps[1] <= 1.0
        assert sleeps[2] <= 2.0  # base * 2**n, full jitter below the bound


# ------------------------------------------------------------- post whitelist
class TestPostRead:
    @respx.mock
    def test_active_clusters_is_allowed(self, client):
        route = respx.post(f"{BASE}/v1/cost-reports/clusters/active").mock(
            return_value=_json_response({"clusterIds": ["c1", "c2"]})
        )
        result = client.get_active_cluster_ids(ORG, START, END)
        assert result == {"clusterIds": ["c1", "c2"]}
        body = json.loads(route.calls.last.request.content)
        assert body == {"startTime": START, "endTime": END}
        assert route.calls.last.request.headers[ORG_HEADER] == ORG

    @respx.mock
    def test_whitelisted_template_with_concrete_cluster_id(self, client):
        url = f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/workload-cost-summaries"
        route = respx.post(url).mock(return_value=_json_response({"items": []}))
        result = client.post_read(
            f"/v1/cost-reports/clusters/{CLUSTER}/workload-cost-summaries",
            org_id=ORG,
            json={"startTime": START, "endTime": END},
        )
        assert result == {"items": []}
        assert route.call_count == 1

    def test_mutation_paths_rejected(self, client):
        with pytest.raises(PermissionDeniedError):
            client.post_read("/v1/organizations", json={"name": "x"})
        with pytest.raises(PermissionDeniedError):
            client.post_read("/v1/notifications/ack", json={"id": "x"})
        with pytest.raises(PermissionDeniedError):
            client.post_read(
                f"/v1/cost-reports/clusters/{CLUSTER}/reporting-capabilities", json={}
            )

    def test_savings_write_never_whitelisted(self):
        assert not any(p.startswith("/savings/") for p in ALLOWED_READ_POST_PATHS)


# ---------------------------------------------------------- path validation
class TestPathValidation:
    def test_get_rejects_absolute_and_unprefixed_paths(self, client):
        with pytest.raises(CastAIError):
            client.get("https://evil.example.com/v1/organizations")
        with pytest.raises(CastAIError):
            client.get("organizations")
        with pytest.raises(CastAIError):
            client.get("/v2/organizations")

    @respx.mock
    def test_get_allows_savings_v1beta_prefix(self, client):
        route = respx.get(
            f"{BASE}/savings/v1beta/organizations/{ORG}/commitments/c1:getUsageHistory"
        ).mock(return_value=_json_response({"items": []}))
        assert (
            client.get(f"/savings/v1beta/organizations/{ORG}/commitments/c1:getUsageHistory")
            == {"items": []}
        )
        assert route.call_count == 1


class TestPathTraversalGate:
    """CHK-15 / SEC-4.4 — _validate_path at the _request chokepoint.

    Rejections MUST happen before any byte hits the wire (respx asserts zero
    requests). User-touched ids (query-param seeding) reach these paths via
    f-string interpolation in cluster-scoped wrappers.
    """

    @pytest.mark.parametrize(
        "bad_path",
        [
            "/v1/cost-reports/clusters/../organizations",
            "/v1/kubernetes/external-clusters/..%2f..%2forganizations",
            "/v1/cost-reports/clusters/%2e%2e/organizations",
            "/v1/kubernetes/external-clusters/a b/nodes",
            "/v1/kubernetes/external-clusters/a\\b/nodes",
            "/v1//organizations",
            "/v1/organizations?x=1",
            "/v1/kubernetes/clusters/x \ty/policies",
        ],
    )
    @respx.mock(assert_all_called=False)
    def test_traversal_rejected_before_wire(self, client, bad_path):
        with pytest.raises(PermissionDeniedError):
            client.get(bad_path)

    @respx.mock(assert_all_called=False)
    def test_post_read_traversal_rejected(self, client):
        with pytest.raises(PermissionDeniedError):
            client.post_read(
                "/v1/cost-reports/clusters/../workload-cost-summaries",
                json={"startTime": "2026-01-01T00:00:00Z", "endTime": "2026-01-02T00:00:00Z"},
            )

    @respx.mock
    def test_legitimate_cluster_path_still_passes(self, client):
        cid = "95064800-b16c-4127-a874-725341ad06b4"
        route = respx.get(f"{BASE}/v1/kubernetes/clusters/{cid}/policies").mock(
            return_value=_json_response({"enabled": True})
        )
        assert client.get_cluster_policies(ORG, cid) == {"enabled": True}
        assert route.call_count == 1


# ---------------------------------------------------------------- endpoints
class TestEndpointShapes:
    @respx.mock
    def test_wa_agent_statuses_org_path(self, client):
        url = (
            f"{BASE}/v1/workload-autoscaling/organizations/{ORG}"
            "/components/workload-autoscaler"
        )
        route = respx.get(url).mock(return_value=_json_response({"clusterAgentStatuses": []}))
        result = client.get_org_wa_agent_statuses(ORG)
        assert result == {"clusterAgentStatuses": []}
        assert route.calls.last.request.headers[ORG_HEADER] == ORG

    @respx.mock
    def test_time_window_params_start_end(self, client):
        route = respx.get(f"{BASE}/v1/cost-reports/organization/clusters/report").mock(
            return_value=_json_response({"clusters": []})
        )
        client.get_org_clusters_report(ORG, START, END)
        params = route.calls.last.request.url.params
        assert params["startTime"] == START
        assert params["endTime"] == END

    @respx.mock
    def test_notifications_default_page(self, client):
        route = respx.get(f"{BASE}/v1/notifications").mock(
            return_value=_json_response({"items": []})
        )
        client.get_notifications(ORG)
        params = route.calls.last.request.url.params
        assert params["page.limit"] == "500"  # v2 default page size
        client.get_notifications(ORG, cluster_id=CLUSTER)
        assert route.calls.last.request.url.params["filter.clusterId"] == CLUSTER

    @respx.mock
    def test_cluster_drilldown_get(self, client):
        route = respx.get(
            f"{BASE}/v1/cost-reports/clusters/{CLUSTER}/savings"
        ).mock(return_value=_json_response({"summary": {}}))
        result = client.get_cluster_savings(ORG, CLUSTER, START, END)
        assert result == {"summary": {}}
        assert route.calls.last.request.headers[ORG_HEADER] == ORG


# ------------------------------------------------------------ observability
class TestStats:
    @respx.mock
    def test_counters_thread_safe_snapshot(self, client):
        respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[_json_response({}, 401), _json_response({"organizations": []})]
        )
        with pytest.raises(AuthError):
            client.get_organizations()
        client.get_organizations()
        snapshot = client.stats()
        assert snapshot["requests"] == 2
        assert snapshot["failures"] == 1
        assert snapshot["by_status"] == {401: 1, 200: 1}
        assert snapshot["total_latency_s"] >= 0.0

    def test_lazy_single_client_and_close(self):
        instance = CastAIClient(BASE, KEY)
        assert instance._client is None  # lazy: nothing until first request
        with respx.mock:
            respx.get(f"{BASE}/v1/organizations").mock(
                return_value=_json_response({"organizations": []})
            )
            instance.get_organizations()
            instance.get_organizations()
        assert instance._client is not None
        instance.close()
        assert instance._client is None

    def test_timeouts(self, client):
        assert client._timeout_for("/v1/organizations").connect == 5.0
        assert client._timeout_for("/v1/organizations").read == 30.0
        assert client._timeout_for("/v1/cost-reports/organization/daily-cost").read == 60.0
        assert client._timeout_for("/v1/cost-reports/clusters/x/node-count-history").read == 60.0


# ------------------------------------------------------------------ settings
class TestSettings:
    def test_missing_key_fails_closed_generic(self):
        with pytest.raises(ConfigError) as exc_info:
            load_settings()
        message = str(exc_info.value)
        assert "secret" not in message.lower()  # no filesystem/path leaks
        assert ".toml" not in message

    @pytest.mark.parametrize("value", ["", "   "])
    def test_empty_key_fails_closed(self, monkeypatch, value):
        monkeypatch.setenv("CASTAI_API_KEY", value)
        with pytest.raises(ConfigError):
            load_settings()

    @pytest.mark.parametrize(
        "url",
        ["http://api.eu.cast.ai", "https://evil.example.com", "ftp://api.eu.cast.ai",
         "https://api.eu.cast.ai.evil.example", "not-a-url"],
    )
    def test_base_url_allow_list_rejects(self, monkeypatch, url):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        monkeypatch.setenv("CASTAI_BASE_URL", url)
        with pytest.raises(ConfigError) as exc_info:
            load_settings()
        assert KEY not in str(exc_info.value)

    @pytest.mark.parametrize(
        "url",
        ["https://api.cast.ai", "https://api.eu.cast.ai", "https://api.in.cast.ai"],
    )
    def test_base_url_allow_list_accepts_regional(self, monkeypatch, url):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        monkeypatch.setenv("CASTAI_BASE_URL", url)
        settings = load_settings()
        assert settings.base_url.startswith("https://api.")
        assert settings.base_url.endswith(".cast.ai")

    def test_base_url_trailing_slash_normalized(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        monkeypatch.setenv("CASTAI_BASE_URL", "https://api.eu.cast.ai/")
        assert load_settings().base_url == "https://api.eu.cast.ai"

    def test_env_precedence_over_secrets(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        secret_variant = "test-key-secret-variant-999999999"
        monkeypatch.setattr(
            "config.settings._secrets_get",
            lambda key: secret_variant if key == "castai.api_key" else None,
        )
        assert load_settings().get_api_key() == KEY

    def test_secrets_fallback_when_env_absent(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", "")  # empty env must NOT win
        monkeypatch.setattr(
            "config.settings._secrets_get",
            lambda key: KEY if key == "castai.api_key" else None,
        )
        assert load_settings().get_api_key() == KEY

    def test_repr_redaction_and_accessor(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        monkeypatch.setenv("CASTAI_ENTERPRISE_ID", "ent-1234")
        settings = load_settings()
        representation = repr(settings)
        assert KEY not in representation
        assert "***" in representation
        assert settings.get_api_key() == KEY
        assert settings.enterprise_id == "ent-1234"

    def test_workers_clamped(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        monkeypatch.setenv("CASTAI_MAX_WORKERS", "100")
        assert load_settings().max_workers == 32
        monkeypatch.setenv("CASTAI_MAX_WORKERS", "1")
        assert load_settings().max_workers == 4
        monkeypatch.setenv("CASTAI_MAX_WORKERS", "12")
        assert load_settings().max_workers == 12

    def test_flag_defaults_and_parse(self, monkeypatch):
        monkeypatch.setenv("CASTAI_API_KEY", KEY)
        settings = load_settings()
        assert settings.enable_notifications is False
        assert settings.enable_org_efficiency is True
        assert settings.enable_active_probe is False
        monkeypatch.setenv("CASTAI_ENABLE_NOTIFICATIONS", "true")
        monkeypatch.setenv("CASTAI_ENABLE_ACTIVE_PROBE", "1")
        settings = load_settings()
        assert settings.enable_notifications is True
        assert settings.enable_active_probe is True


# ----------------------------------------------------------------- redaction
class TestRedaction:
    def test_scrub_removes_registered_key_and_header_values(self):
        configure_secret_scrub(KEY)
        out = scrub(f"saw X-API-Key: {KEY} and Authorization: Bearer {KEY}")
        assert KEY not in out
        assert out.count("***") >= 2

    def test_error_messages_sanitized(self):
        register_secret(KEY)
        err = RateLimitedError(f"429 for key {KEY}", retry_after=3)
        assert KEY not in str(err)
        assert KEY not in repr(err)
        assert err.retry_after == 3.0

    def test_generic_401_message_has_no_body_echo(self, client):
        with respx.mock:
            respx.get(f"{BASE}/v1/organizations").mock(
                return_value=httpx.Response(
                    401, json={"message": f"leaked: {KEY}", "details": "internal"}
                )
            )
            with pytest.raises(AuthError) as exc_info:
                client.get_organizations()
        assert KEY not in str(exc_info.value)
        assert "leaked" not in str(exc_info.value)
