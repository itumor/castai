"""Offline unit tests for the score-alerting POC. No network, no secrets:

    python3 -m unittest discover -s tests -v          (from score-alerting-poc/)
"""

from __future__ import annotations

import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import castai_client
import notify
import owners
import rules
import score_alert
import signals
import state

NOW = dt.datetime(2026, 9, 18, 9, 0, tzinfo=dt.timezone.utc)


def sig(**overrides) -> signals.ClusterSignals:
    base = dict(cluster_id="c1", cluster_name="prod-eks", organization_id="org1",
                cpu_overprov_pct=5.0, ram_overprov_pct=10.0,
                evictor_enabled=True, evictor_dry_run=False,
                unschedulable_pods_enabled=True, woop_policy_count=1,
                woop_enabled=True, rebalance_plan_count=1,
                last_rebalance_at=NOW - dt.timedelta(days=3),
                is_rebalancing_recommended=False)
    base.update(overrides)
    return signals.ClusterSignals(**base)


class RuleTests(unittest.TestCase):
    th = rules.Thresholds()

    def test_healthy_cluster_no_findings(self):
        self.assertEqual(rules.evaluate_rules(sig(), self.th, NOW), [])

    def test_siemens_demo_shape(self):
        """82% CPU overprov, evictor off, no WOOP, never rebalanced, 63% savings."""
        s = sig(cpu_overprov_pct=82.4, ram_overprov_pct=79.1,
                evictor_enabled=False, evictor_dry_run=True,
                woop_policy_count=0, woop_enabled=False,
                rebalance_plan_count=0, last_rebalance_at=None,
                is_rebalancing_recommended=True, savings_pct=63.0)
        found = {f.rule_id: f for f in rules.evaluate_rules(s, self.th, NOW)}
        self.assertIn("overprovisioning", found)
        self.assertIn("evictor_off", found)
        self.assertIn("rebalance_stale", found)
        self.assertIn("woop_off", found)
        self.assertIn("rebalance_recommended", found)
        self.assertTrue(all(f.severity == "poor" for f in found.values()))
        # Action templates must carry doc links (Ebrahim: steps from docs).
        for f in found.values():
            self.assertTrue(f.steps, f.rule_id)
            self.assertTrue(all(d.startswith("https://docs.cast.ai") for d in f.docs))

    def test_overprovisioning_thresholds_are_exclusive(self):
        self.assertEqual(rules.evaluate_rules(
            sig(cpu_overprov_pct=20.0, ram_overprov_pct=35.0), self.th, NOW), [])
        fs = rules.evaluate_rules(sig(cpu_overprov_pct=20.1), self.th, NOW)
        self.assertEqual([f.rule_id for f in fs], ["overprovisioning"])

    def test_dry_run_evictor_is_concerning_not_poor(self):
        fs = rules.evaluate_rules(
            sig(evictor_enabled=True, evictor_dry_run=True), self.th, NOW)
        f = next(f for f in fs if f.rule_id == "evictor_off")
        self.assertEqual(f.severity, "concerning")

    def test_rebalance_age_bucketing(self):
        fresh = sig(last_rebalance_at=NOW - dt.timedelta(days=13))
        self.assertNotIn("rebalance_stale",
                         {f.rule_id for f in rules.evaluate_rules(fresh, self.th, NOW)})
        warn = sig(last_rebalance_at=NOW - dt.timedelta(days=20))
        f = next(f for f in rules.evaluate_rules(warn, self.th, NOW)
                 if f.rule_id == "rebalance_stale")
        self.assertEqual(f.severity, "concerning")
        old = sig(last_rebalance_at=NOW - dt.timedelta(days=31))
        f = next(f for f in rules.evaluate_rules(old, self.th, NOW)
                 if f.rule_id == "rebalance_stale")
        self.assertEqual(f.severity, "poor")

    def test_no_data_means_no_finding(self):
        s = sig(cpu_overprov_pct=None, ram_overprov_pct=None,
                rebalance_plan_count=None, woop_policy_count=None,
                evictor_enabled=None, is_rebalancing_recommended=None)
        self.assertEqual(rules.evaluate_rules(s, self.th, NOW), [])

    def test_restrictions_surface_as_info(self):
        s = sig(restrictions=[{"resource": {"resourceKind": "Deployment",
                                            "resourceName": "web",
                                            "resourceNamespace": "shop"},
                               "restrictionIds": ["pdb-too-strict"]}])
        fs = rules.evaluate_rules(s, self.th, NOW)
        f = next(f for f in fs if f.rule_id == "restrictions_present")
        self.assertEqual(f.severity, "info")
        self.assertIn("web", f.description)


class StateTests(unittest.TestCase):
    def test_daily_dedup(self):
        with tempfile.TemporaryDirectory() as d:
            st = state.AlertState(os.path.join(d, "s.json"), cooldown_hours=24)
            self.assertTrue(st.should_send("c1", "r1", NOW))
            st.mark_sent("c1", "r1", NOW)
            st.save()
            st2 = state.AlertState(os.path.join(d, "s.json"), cooldown_hours=24)
            self.assertFalse(st2.should_send("c1", "r1", NOW + dt.timedelta(hours=5)))
            self.assertTrue(st2.should_send("c1", "r1", NOW + dt.timedelta(hours=25)))

    def test_corrupt_state_file_is_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            with open(path, "w") as fh:
                fh.write("{not json")
            st = state.AlertState(path)
            self.assertTrue(st.should_send("c1", "r1", NOW))


class FakeTransport:
    """Records calls, replays canned JSON by path prefix."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[str] = []

    def __call__(self, method, url, headers, body):
        self.calls.append(url)
        parsed = urllib.parse.urlparse(url)
        for prefix, payload in self.routes.items():
            if parsed.path.startswith(prefix):
                return 200, json.dumps(payload).encode()
        return 404, b'{"message":"nope"}'


class ClientTests(unittest.TestCase):
    def test_get_path_params_and_auth_header(self):
        t = FakeTransport({"/v1/foo": {"ok": "y"}})
        os.environ["CASTAI_API_KEY"] = "k-test"
        try:
            client = castai_client.CastaiClient(base_url="http://x", transport=t)
            out = client._request("GET", "/v1/foo", params={"a.b": 1, "skip": None})
        finally:
            del os.environ["CASTAI_API_KEY"]
        self.assertTrue(out["ok"] == "y")
        self.assertIn("a.b=1", t.calls[-1])
        self.assertNotIn("skip=", t.calls[-1])

    def test_404_raises_api_error(self):
        t = FakeTransport({})
        client = castai_client.CastaiClient(base_url="http://x", api_key="k",
                                            transport=t)
        with self.assertRaises(castai_client.ApiError):
            client.efficiency("cX", "a", "b")

    def test_enterprise_pagination(self):
        page2 = {"items": [{"id": "o2"}], "nextPageCursor": ""}
        page1 = {"items": [{"id": "o1"}], "nextPageCursor": "c2"}
        calls = {"n": 0}

        def transport(method, url, headers, body):
            calls["n"] += 1
            return 200, json.dumps(page1 if "cursor" not in url else page2).encode()

        client = castai_client.CastaiClient(base_url="http://x", api_key="k",
                                            transport=transport)
        self.assertEqual([o["id"] for o in client.enterprise_child_orgs("e1")],
                         ["o1", "o2"])
        self.assertEqual(calls["n"], 2)


class OwnerTests(unittest.TestCase):
    cfg = [{"pattern": "*-prod-*", "emails": ["prod@x"], "slack_webhook_env": "S1"},
           {"pattern": "*-dev-*", "emails": ["dev@x"]}]

    def test_first_match_wins_case_insensitive(self):
        got = owners.resolve_owners("Teamcenter-PROD-EKS", self.cfg)
        self.assertEqual(got["emails"], ["prod@x"])
        self.assertEqual(got["source"], "config")

    def test_default_fallback(self):
        got = owners.resolve_owners("unmatched", self.cfg, {"emails": ["cs@cast.ai"]})
        self.assertEqual((got["emails"], got["source"]), (["cs@cast.ai"], "default"))

    def test_audit_inference_counts_editors(self):
        t = FakeTransport({"/v1/audit": {"items": [
            {"initiatedBy": {"email": "guy@siemens.example"}},
            {"initiatedBy": {"email": "guy@siemens.example"}},
            {"initiatedBy": {"email": "nina@siemens.example"}}]}})
        client = castai_client.CastaiClient(base_url="http://x", api_key="k",
                                            transport=t)
        editors = owners.infer_active_editors(client, "c1", now=NOW)
        self.assertEqual(editors[0], ("guy@siemens.example", 2))


class SignalsTests(unittest.TestCase):
    def test_partial_failure_keeps_other_signals(self):
        t = FakeTransport({
            "/v1/cost-reports/clusters/c1/efficiency": {
                "cpuOverprovisioningPercent": 82.4,
                "ramOverprovisioningPercent": 79.1},
            "/v1/kubernetes/clusters/c1/policies": {
                "nodeDownscaler": {"evictor": {"enabled": False, "dryRun": True}},
                "unschedulablePods": {"enabled": True}},
            "/v1/kubernetes/clusters/c1/rebalancing-plans": {"rebalancingPlans": []},
        })
        client = castai_client.CastaiClient(base_url="http://x", api_key="k",
                                            transport=t)
        s = signals.collect_cluster_signals(client, {"id": "c1", "name": "n"}, now=NOW)
        self.assertEqual(s.cpu_overprov_pct, 82.4)
        self.assertEqual(s.rebalance_plan_count, 0)
        self.assertIn("woop", s.errors)   # missing route → captured, not raised


class EndToEndCliTests(unittest.TestCase):
    """Full scan against a FakeClient, report written to disk."""

    ROUTES = {
        "/v1/kubernetes/external-clusters": {"items": [
            {"id": "c1", "name": "siemens-teamcenter-prod-eks",
             "organizationId": "org1"},
            {"id": "c2", "name": "siemens-teamcenter-dev-eks",
             "organizationId": "org1"}]},
        "/v1/cost-reports/clusters/c1/efficiency": {
            "cpuOverprovisioningPercent": 82.4, "ramOverprovisioningPercent": 79.1},
        "/v1/cost-reports/clusters/c2/efficiency": {
            "cpuOverprovisioningPercent": 12.0, "ramOverprovisioningPercent": 25.0},
        "/v1/cost-reports/clusters/c1/estimated-savings": {
            "isRebalancingRecommended": True,
            "recommendations": {"s": {"savingsPercentage": "63"}}},
        "/v1/cost-reports/clusters/c2/estimated-savings": {
            "isRebalancingRecommended": False},
        "/v1/kubernetes/clusters/c1/policies": {
            "nodeDownscaler": {"evictor": {"enabled": False, "dryRun": True}},
            "unschedulablePods": {"enabled": True}},
        "/v1/kubernetes/clusters/c2/policies": {
            "nodeDownscaler": {"evictor": {"enabled": True, "dryRun": False}},
            "unschedulablePods": {"enabled": True}},
        "/v1/workload-autoscaling/clusters/c2/policies": {
            "policies": [{"id": "p1", "enabled": True}]},
        "/v1/kubernetes/clusters/c1/rebalancing-plans": {"rebalancingPlans": []},
        "/v1/kubernetes/clusters/c2/rebalancing-plans": {"rebalancingPlans": [
            {"id": "rp1", "createdAt": "2026-09-13T08:00:00Z", "status": "Completed"}]},
        "/reporting/v1beta/organizations/org1/clusters/c1/restrictions": {
            "items": [], "totalCount": 0},
        "/reporting/v1beta/organizations/org1/clusters/c2/restrictions": {
            "items": [], "totalCount": 0},
    }

    def test_scan_two_clusters_dry_run(self):
        t = FakeTransport(self.ROUTES)
        client = castai_client.CastaiClient(base_url="http://x", api_key="k",
                                            transport=t)
        with tempfile.TemporaryDirectory() as d:
            cfg = {
                "state_file": os.path.join(d, "st.json"),
                "owners": [{"pattern": "*prod*", "emails": ["p@x"]}],
                "default_recipients": {"emails": ["cs@cast.ai"]},
                "smtp": {"host": "localhost"},
            }
            cfg_path = os.path.join(d, "config.json")
            with open(cfg_path, "w") as fh:
                json.dump(cfg, fh)
            report_path = os.path.join(d, "report.md")

            original = score_alert.build_client
            score_alert.build_client = lambda cfg, args: client
            try:
                out = io.StringIO()
                with redirect_stdout(out):
                    rc = score_alert.main(["--config", cfg_path, "--dry-run",
                                           "scan", "--report-out", report_path])
            finally:
                score_alert.build_client = original

            self.assertEqual(rc, 0, out.getvalue())
            with open(report_path) as fh:
                report = fh.read()
            self.assertIn("siemens-teamcenter-prod-eks", report)
            self.assertIn("Rebalancer never run", report)
            self.assertIn("Evictor disabled", report)
            self.assertIn("dry-run: would email ['p@x']", out.getvalue())
            # Healthy cluster present but without findings sections.
            self.assertIn("siemens-teamcenter-dev-eks — 100%", report)


if __name__ == "__main__":
    unittest.main()
