#!/usr/bin/env python3
"""Mock CAST AI API server for castai-billing-export.sh tests.

Serves JSON fixtures based on path + X-CastAI-Organization-Id header.
Validates X-API-Key and Accept headers.

Usage:
    python3 mock_castai_server.py --port 8765 [--fixtures-dir DIR]
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Optional, Tuple


EXPECTED_API_KEY = "test-api-key"
DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def load_fixtures(fixtures_dir: Path) -> Dict[str, dict]:
    """Load all JSON fixtures into a dict keyed by their fixture name (no ext)."""
    loaded: Dict[str, dict] = {}
    for p in sorted(fixtures_dir.glob("*.json")):
        with p.open("r", encoding="utf-8") as fh:
            loaded[p.stem] = json.load(fh)
    return loaded


def build_handler(fixtures: Dict[str, dict]):
    """Build a BaseHTTPRequestHandler subclass with fixtures in scope."""

    class MockCastAIHandler(BaseHTTPRequestHandler):
        # Quieter logs (we still print request lines on stderr for debugging).
        def log_message(self, format: str, *args) -> None:  # noqa: A002 (stdlib name)
            sys.stderr.write(
                "[mock] %s - %s\n" % (self.address_string(), format % args)
            )

        # ---- helpers ----
        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_error_json(self, status: int, message: str) -> None:
            self._send_json(status, {"error": message})

        def _validate_auth(self) -> Optional[Tuple[int, str]]:
            api_key = self.headers.get("X-API-Key", "")
            accept = self.headers.get("Accept", "")
            if api_key != EXPECTED_API_KEY:
                return (401, "invalid or missing X-API-Key")
            if "application/json" not in accept:
                return (400, "Accept: application/json header required")
            return None

        # ---- routing ----
        def do_GET(self) -> None:  # noqa: N802 (stdlib name)
            err = self._validate_auth()
            if err is not None:
                self._send_error_json(err[0], err[1])
                return

            path = self.path.split("?", 1)[0]
            org_id = self.headers.get("X-CastAI-Organization-Id", "")

            # Enterprise billing endpoint (no X-CastAI-Organization-Id required).
            if path == "/v1/billing/enterprise/platform-usage-detail":
                fixture = fixtures.get("enterprise_usage")
                if fixture is None:
                    self._send_error_json(500, "missing enterprise_usage fixture")
                    return
                self._send_json(200, fixture)
                return

            # Per-org cluster usage.
            if path == "/v1/billing/platform-usage-detail":
                key = f"cluster_usage_{org_id}"
                fixture = fixtures.get(key)
                if fixture is None:
                    self._send_json(200, {"detail": {"entities": []}})
                    return
                self._send_json(200, fixture)
                return

            # Per-org external clusters.
            if path == "/v1/kubernetes/external-clusters":
                key = f"external_clusters_{org_id}"
                fixture = fixtures.get(key)
                if fixture is None:
                    self._send_json(200, {"items": []})
                    return
                self._send_json(200, fixture)
                return

            # Unknown path.
            self._send_error_json(404, f"no mock for path {path}")

    return MockCastAIHandler


def main() -> int:
    parser = argparse.ArgumentParser(description="Mock CAST AI API server")
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="TCP port to bind (0 = OS-chosen). Defaults to 0.",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Bind address (default 127.0.0.1).",
    )
    parser.add_argument(
        "--fixtures-dir",
        type=str,
        default=str(DEFAULT_FIXTURES_DIR),
        help=f"Directory of *.json fixtures (default {DEFAULT_FIXTURES_DIR}).",
    )
    args = parser.parse_args()

    fixtures_dir = Path(args.fixtures_dir)
    if not fixtures_dir.is_dir():
        print(f"ERROR: fixtures dir not found: {fixtures_dir}", file=sys.stderr)
        return 2

    fixtures = load_fixtures(fixtures_dir)
    if not fixtures:
        print(f"ERROR: no JSON fixtures loaded from {fixtures_dir}", file=sys.stderr)
        return 2

    handler_cls = build_handler(fixtures)
    httpd = ThreadingHTTPServer((args.host, args.port), handler_cls)

    def _shutdown(_signum, _frame):
        # Use a threaded shutdown so concurrent requests can drain.
        try:
            httpd.shutdown()
        except Exception:  # pragma: no cover - best effort
            pass

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Startup marker on stdout: "MOCK_READY <port>" so the test driver can wait.
    bound_port = httpd.server_address[1]
    sys.stdout.write(f"MOCK_READY {bound_port}\n")
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
