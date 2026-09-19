#!/usr/bin/env python3
"""Mock CAST AI API server for the score-based alerting (SOC) POC.

Serves the subset of the CAST AI public API that the POC's signal collector
(``../castai_client.py``) consumes, implemented with the Python standard
library only (``http.server`` + ``threading`` via ``ThreadingHTTPServer``).

Response bodies are read from JSON fixture files in the ``fixtures/``
directory next to this script. A ``load_fixture(name)`` helper maps a route's
fixture base name (optionally suffixed with a cluster id) to its file; when
the file is missing or unparsable, a sensible inline default from
``DEFAULTS`` is returned so the server stays useful with an empty fixture
directory. Unknown paths get CAST AI's standard 404 body.

Usage:
    python3 mock_server.py [--port PORT]      # default port: 4015

Every request is logged to stderr, one line per request.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HOST = "127.0.0.1"
DEFAULT_PORT = 4015
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

# Story cluster ids (see fixtures/clusters.json); the audit default refers
# to the first one, mirroring the demo narrative.
CLUSTER_A_ID = "11111111-2222-3333-4444-555555555555"

# Body returned for every unknown path, matching CAST AI's 404 shape.
NOT_FOUND = {"fieldViolations": [], "message": "not found"}

# ---------------------------------------------------------------------------
# Inline defaults: used only when the corresponding fixture file cannot be
# read. Shapes mirror the documented API responses.
# ---------------------------------------------------------------------------

DEFAULTS = {
    "clusters": {
        "items": [],
        "totalCount": 0,
    },
    "efficiency": {
        "stepSeconds": "3600",
        "cpuOverallProvisionedCores": "64",
        "ramOverallProvisionedGib": "256",
        "cpuOverallRequestedCores": "32",
        "ramOverallRequestedGib": "128",
        "cpuOverprovisioningPercent": 50.0,
        "ramOverprovisioningPercent": 50.0,
        "costPerProvisionedCpu": "0.031",
        "costPerProvisionedRam": "0.0041",
        "noDataReason": "NO_DATA_REASON_UNSPECIFIED",
    },
    "savings": {
        "recommendations": {
            "spotInstances": {
                "hourlyPriceBefore": "0.45",
                "hourlyPriceAfter": "0.13",
                "savingsPercentage": "71",
            },
        },
        "isRebalancingRecommended": True,
    },
    "policies": {
        "enabled": True,
        "isScopedMode": False,
        "nodeDownscaler": {
            "emptyNodes": {"enabled": True, "delaySeconds": 300},
            "evictor": {
                "enabled": False,
                "dryRun": True,
                "aggressiveMode": False,
            },
        },
        "unschedulablePods": {
            "enabled": True,
            "nodeConstraints": {
                "enabled": True,
                "minCpuCores": 2,
                "maxCpuCores": 32,
                "minRamMib": 4096,
                "maxRamMib": 131072,
            },
        },
        "clusterLimits": {
            "enabled": True,
            "cpu": {"minCores": 2, "maxCores": 100},
        },
        "spotInstances": {
            "enabled": True,
            "clouds": ["gcp"],
            "spotBackups": {"enabled": True},
        },
        "spotDiversity": {"enabled": False, "diversityGroups": []},
    },
    "evictor": {
        "evictor": {
            "enabled": False,
            "dryRun": True,
            "aggressiveMode": False,
            "scopedMode": False,
            "nodeGracePeriodMinutes": 5,
            "podGracePeriodSeconds": 0,
            "cycleInterval": 60,
        },
    },
    "woop": {
        "policies": [],
        "totalCount": 0,
    },
    "rebalance": {
        "rebalancingPlans": [],
        "totalCount": 0,
    },
    "restrictions": {
        "items": [
            {
                "resource": {
                    "resourceName": "web-tier",
                    "resourceKind": "Deployment",
                    "resourceNamespace": "shop",
                },
                "restrictionIds": ["missing-readiness-probe"],
            },
            {
                "resource": {
                    "resourceName": "payments-pdb",
                    "resourceKind": "PodDisruptionBudget",
                    "resourceNamespace": "shop",
                },
                "restrictionIds": ["pdb-too-strict"],
            },
        ],
        "totalCount": 2,
    },
    "enterprise_orgs": {
        "items": [
            {
                "id": "org-child-1",
                "name": "siemens-teamcenter",
                "createTime": "2026-01-01T00:00:00Z",
                "type": "ORGANIZATION_TYPE_CHILD",
                "counters": {
                    "users": 3,
                    "groups": 1,
                    "roleBindings": 2,
                    "clusters": 2,
                },
                "childOrderId": 1,
            },
        ],
        "totalSize": 1,
    },
    "audit": {
        "items": [
            {
                "id": 1,
                "eventType": "rebalancePlanExecution",
                "initiatedBy": {
                    "id": "u1",
                    "name": "Guy Siemens",
                    "email": "guy@siemens.example",
                },
                "time": "2026-09-10T12:00:00Z",
                "labels": {"clusterId": CLUSTER_A_ID},
                "operation": {
                    "type": "rebalance",
                    "text": "Rebalance plan executed",
                },
            },
        ],
        "totalCount": 1,
    },
}

# ---------------------------------------------------------------------------
# Route table. The optional "cid" capture group marks a cluster-scoped route
# whose fixture file may be specialized per cluster (<base>_<clusterId>.json)
# before falling back to the shared <base>.json and then the inline default.
# ---------------------------------------------------------------------------

ROUTE_TABLE = [
    (re.compile(pattern), base) for pattern, base in [
        (r"^/v1/kubernetes/external-clusters$", "clusters"),
        (r"^/v1/cost-reports/clusters/(?P<cid>[^/]+)/efficiency$",
         "efficiency"),
        (r"^/v1/cost-reports/clusters/(?P<cid>[^/]+)/estimated-savings$",
         "savings"),
        (r"^/v1/kubernetes/clusters/(?P<cid>[^/]+)/policies$", "policies"),
        (r"^/workload-eviction/v1/clusters/(?P<cid>[^/]+)/config$",
         "evictor"),
        (r"^/v1/workload-autoscaling/clusters/(?P<cid>[^/]+)/policies$",
         "woop"),
        (r"^/v1/kubernetes/clusters/(?P<cid>[^/]+)/rebalancing-plans$",
         "rebalance"),
        (r"^/reporting/v1beta/organizations/[^/]+/clusters/(?P<cid>[^/]+)"
         r"/restrictions$", "restrictions"),
        (r"^/organization-management/v1/enterprises/[^/]+/organizations$",
         "enterprise_orgs"),
        (r"^/v1/audit$", "audit"),
    ]
]


def load_fixture(name):
    """Load and parse fixture ``fixtures/<name>.json``.

    ``name`` is the fixture base name without extension, e.g. ``"clusters"``
    or ``"efficiency_11111111-2222-3333-4444-555555555555"``. Returns the
    parsed JSON object, or ``None`` when the file is missing, unreadable, or
    not valid JSON — callers then fall back to ``DEFAULTS``.
    """
    path = FIXTURES_DIR / f"{name}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def resolve(path):
    """Map a request path to a ``(payload, http_status)`` pair.

    Cluster-scoped routes try ``<base>_<clusterId>.json`` first, then the
    shared ``<base>.json``, then the inline default for that base. Any other
    path returns CAST AI's standard 404 body.
    """
    for pattern, base in ROUTE_TABLE:
        match = pattern.match(path)
        if not match:
            continue
        cluster_id = match.groupdict().get("cid")
        if cluster_id:
            payload = load_fixture(f"{base}_{cluster_id}")
            if payload is not None:
                return payload, 200
        payload = load_fixture(base)
        if payload is not None:
            return payload, 200
        return DEFAULTS[base], 200
    return NOT_FOUND, 404


class MockCastAiHandler(BaseHTTPRequestHandler):
    """Serve every mock CAST AI route as JSON; one stderr line per request."""

    server_version = "CastAiMock/1.0"
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        """Route the request (query string ignored) through the table."""
        payload, status = resolve(urlsplit(self.path).path)
        self._send_json(payload, status)

    def _method_not_supported(self):
        """Non-GET verbs are outside the mock surface: answer 404."""
        self._send_json(NOT_FOUND, 404)

    do_POST = _method_not_supported
    do_PUT = _method_not_supported
    do_PATCH = _method_not_supported
    do_DELETE = _method_not_supported

    def _send_json(self, payload, status):
        """Serialize ``payload`` and write the full JSON response."""
        body = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - stdlib signature
        """Log one request line per call to stderr (no stdout noise)."""
        sys.stderr.write("%s - %s\n" % (self.address_string(),
                                        format % args))


def main(argv=None):
    """Parse ``--port`` and serve forever until interrupted."""
    parser = argparse.ArgumentParser(
        description="Mock CAST AI API server (fixture-backed, stdlib only).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="TCP port to listen on (default: %(default)s)")
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer((HOST, args.port), MockCastAiHandler)
    sys.stderr.write(
        "mock CAST AI server listening on http://%s:%d (fixtures: %s)\n"
        % (HOST, args.port, FIXTURES_DIR)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("keyboard interrupt - shutting down\n")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
