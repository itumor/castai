#!/usr/bin/env python3
"""Integration tests for castai-billing-export.sh against a mock CAST AI API.

Starts mock_castai_server.py as a subprocess, waits for its startup marker,
runs the export script against it, and asserts the resulting CSV.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from typing import List, Tuple


PROJECT_DIR = Path(__file__).resolve().parent.parent
TESTS_DIR = PROJECT_DIR / "tests"
SCRIPT_PATH = PROJECT_DIR / "castai-billing-export.sh"
MOCK_PATH = TESTS_DIR / "mock_castai_server.py"

EXPECTED_API_KEY = "test-api-key"
FROM_DATE = "2026-08-01"
TO_DATE = "2026-08-31"
FEATURE = "phase2"

EXPECTED_HEADER = (
    "organization_id,organization_name,cluster_id,cluster_name,"
    "provider,cloud_account,usage,unit"
)


def find_free_port() -> int:
    """Bind a socket to port 0 to let the OS pick a free port, then release."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def wait_for_mock(stdout_pipe, port: int, timeout: float = 10.0) -> None:
    """Block until mock_castai_server.py prints 'MOCK_READY <port>' on stdout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = stdout_pipe.readline()
        if not line:
            time.sleep(0.05)
            continue
        line = line.strip()
        if line.startswith("MOCK_READY"):
            try:
                announced = int(line.split()[1])
            except (IndexError, ValueError):
                continue
            if announced == port:
                return
        # else: keep waiting (could be a stray log)
    raise RuntimeError(
        f"Mock server did not announce MOCK_READY on port {port} within {timeout}s"
    )


class TestCastaiBillingExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        for p in (SCRIPT_PATH, MOCK_PATH):
            if not p.exists():
                raise RuntimeError(f"required file missing: {p}")

        cls.port = find_free_port()
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        cls.mock_proc = subprocess.Popen(
            [sys.executable, str(MOCK_PATH), "--port", str(cls.port)],
            cwd=str(PROJECT_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            wait_for_mock(cls.mock_proc.stdout, cls.port, timeout=10.0)
        except Exception:
            cls._terminate_mock()
            stderr = cls.mock_proc.stderr.read() if cls.mock_proc.stderr else ""
            raise RuntimeError(f"mock failed to start: {stderr}")

        cls.script_proc: subprocess.CompletedProcess

    @classmethod
    def tearDownClass(cls) -> None:
        cls._terminate_mock()

    @classmethod
    def _terminate_mock(cls) -> None:
        proc = getattr(cls, "mock_proc", None)
        if proc is None:
            return
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)

    def _run_script(self) -> Tuple[str, str, int]:
        env = os.environ.copy()
        env["CASTAI_API_KEY"] = EXPECTED_API_KEY
        env["BASE_URL"] = f"http://127.0.0.1:{self.port}"
        env["FROM"] = FROM_DATE
        env["TO"] = TO_DATE
        env["FEATURE"] = FEATURE

        proc = subprocess.run(
            [str(SCRIPT_PATH)],
            cwd=str(PROJECT_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return proc.stdout, proc.stderr, proc.returncode

    @staticmethod
    def _split_csv(csv_text: str) -> Tuple[str, List[List[str]]]:
        lines = [ln for ln in csv_text.splitlines() if ln != ""]
        if not lines:
            return "", []
        header = lines[0]
        # Naive CSV split is fine here — fixtures have no embedded commas/quotes.
        rows = [ln.split(",") for ln in lines[1:]]
        return header, rows

    def test_csv_header_and_row_count(self) -> None:
        stdout, stderr, rc = self._run_script()
        self.assertEqual(
            rc,
            0,
            msg=f"script exit {rc}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}",
        )
        header, rows = self._split_csv(stdout)
        self.assertEqual(header, EXPECTED_HEADER)
        # 3 rows for org-111 (incl. unmatched) + 2 rows for org-222 = 5.
        self.assertEqual(
            len(rows),
            5,
            msg=f"unexpected row count\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}",
        )

    def _row_by_cluster(self, rows: List[List[str]], cluster_id: str) -> List[str]:
        for r in rows:
            if r[2] == cluster_id:
                return r
        self.fail(f"row not found for cluster_id={cluster_id} in {rows}")

    def test_org111_eks_clusters(self) -> None:
        stdout, stderr, rc = self._run_script()
        self.assertEqual(rc, 0, msg=f"stderr:\n{stderr}")
        _, rows = self._split_csv(stdout)

        aaa = self._row_by_cluster(rows, "cluster-aaa")
        self.assertEqual(aaa[0], "org-111")
        self.assertEqual(aaa[1], "Customer A")
        self.assertEqual(aaa[3], "alpha-prod")
        self.assertEqual(aaa[4], "eks")
        self.assertEqual(aaa[5], "111111111111")  # providerNamespaceId
        self.assertEqual(aaa[6], "12.5")
        self.assertEqual(aaa[7], "CPU_HOURS")

        bbb = self._row_by_cluster(rows, "cluster-bbb")
        self.assertEqual(bbb[0], "org-111")
        self.assertEqual(bbb[1], "Customer A")
        self.assertEqual(bbb[3], "beta-prod")
        self.assertEqual(bbb[4], "eks")
        self.assertEqual(bbb[5], "222222222222")  # eks.accountId fallback
        self.assertEqual(bbb[6], "7.25")
        self.assertEqual(bbb[7], "CPU_HOURS")

    def test_org111_unmatched_cluster_uses_unknown(self) -> None:
        stdout, stderr, rc = self._run_script()
        self.assertEqual(rc, 0, msg=f"stderr:\n{stderr}")
        _, rows = self._split_csv(stdout)

        orphan = self._row_by_cluster(rows, "cluster-orphan")
        self.assertEqual(orphan[0], "org-111")
        self.assertEqual(orphan[1], "Customer A")
        self.assertEqual(orphan[3], "orphan-cluster")
        self.assertEqual(orphan[4], "UNKNOWN")
        self.assertEqual(orphan[5], "UNKNOWN")
        self.assertEqual(orphan[6], "3.0")
        self.assertEqual(orphan[7], "CPU_HOURS")

    def test_org222_gke_and_aks_providers(self) -> None:
        stdout, stderr, rc = self._run_script()
        self.assertEqual(rc, 0, msg=f"stderr:\n{stderr}")
        _, rows = self._split_csv(stdout)

        ccc = self._row_by_cluster(rows, "cluster-ccc")
        self.assertEqual(ccc[0], "org-222")
        self.assertEqual(ccc[1], "Customer B")
        self.assertEqual(ccc[3], "gamma-prod")
        self.assertEqual(ccc[4], "gke")
        self.assertEqual(ccc[5], "my-gcp-project-123")  # gke.projectId
        self.assertEqual(ccc[6], "5.5")
        self.assertEqual(ccc[7], "CPU_HOURS")

        ddd = self._row_by_cluster(rows, "cluster-ddd")
        self.assertEqual(ddd[0], "org-222")
        self.assertEqual(ddd[1], "Customer B")
        self.assertEqual(ddd[3], "delta-prod")
        self.assertEqual(ddd[4], "aks")
        self.assertEqual(ddd[5], "sub-abcdef-1234")  # aks.subscriptionId
        self.assertEqual(ddd[6], "9.75")
        self.assertEqual(ddd[7], "CPU_HOURS")


class TestMockServerAuth(unittest.TestCase):
    """Direct HTTP-level tests of the mock server's auth behavior."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.port = find_free_port()
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        cls.proc = subprocess.Popen(
            [sys.executable, str(MOCK_PATH), "--port", str(cls.port)],
            cwd=str(PROJECT_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            wait_for_mock(cls.proc.stdout, cls.port, timeout=10.0)
        except Exception:
            cls.proc.kill()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.proc.poll() is None:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.proc.kill()
                cls.proc.wait(timeout=5)

    def _curl(self, *extra_args: str) -> Tuple[int, str]:
        curl = shutil.which("curl")
        if curl is None:
            self.skipTest("curl not on PATH")
        cmd = [curl, "-sS", "-o", "-", "-w", "\n%{http_code}"] + list(extra_args)
        out = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10
        )
        self.assertEqual(out.returncode, 0, msg=out.stderr)
        # Last line is the HTTP code; everything before is the body.
        body, _, code_str = out.stdout.rpartition("\n")
        return int(code_str), body

    def test_missing_api_key_returns_401(self) -> None:
        code, body = self._curl(
            "-H", "Accept: application/json",
            f"http://127.0.0.1:{self.port}/v1/billing/enterprise/platform-usage-detail",
        )
        self.assertEqual(code, 401)
        self.assertIn("X-API-Key", body)

    def test_missing_accept_returns_400(self) -> None:
        code, body = self._curl(
            "-H", f"X-API-Key: {EXPECTED_API_KEY}",
            f"http://127.0.0.1:{self.port}/v1/billing/enterprise/platform-usage-detail",
        )
        self.assertEqual(code, 400)
        self.assertIn("Accept", body)

    def test_valid_request_returns_200(self) -> None:
        code, body = self._curl(
            "-H", f"X-API-Key: {EXPECTED_API_KEY}",
            "-H", "Accept: application/json",
            f"http://127.0.0.1:{self.port}/v1/billing/enterprise/platform-usage-detail",
        )
        self.assertEqual(code, 200)
        self.assertIn("org-111", body)
        self.assertIn("org-222", body)


def main() -> int:
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
