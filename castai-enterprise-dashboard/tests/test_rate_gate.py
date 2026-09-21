"""429-reactive permit gate (performance-v2 §3.3) — halve/cooldown/recover.

The gate's ``clock`` soft dependency is monkeypatched with a controllable fake
so recovery windows are driven deterministically; HTTP behavior is respx-mocked
(retries never sleep via the time.sleep patch below).
"""

from __future__ import annotations

import threading
import time

import httpx
import pytest
import respx

from services.castai_client import CastAIClient, _RateGate
from utils.errors import RateLimitedError

KEY = "test-key-0123456789abcdef012345"
BASE = "https://api.eu.cast.ai"


class FakeClock:
    def __init__(self):
        self.now = 1_000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda *_a, **_k: None)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def gate_client(clock):
    gate = _RateGate(initial=8, cap=16, clock=clock)
    client = CastAIClient(BASE, KEY, gate=gate)
    yield client
    client.close()


def _json(payload, status=200):
    return httpx.Response(status, json=payload)


class TestHalveAndFloor:
    def test_unit_halve_on_429(self, clock):
        gate = _RateGate(initial=8, cap=16, clock=clock)
        gate.on_429()
        assert gate._limit == 4
        gate.on_429()
        assert gate._limit == 2
        gate.on_429()
        gate.on_429()
        assert gate._limit == 2  # floor 2, never below

    @respx.mock
    def test_wire_429_triggers_halve(self, gate_client):
        respx.get(f"{BASE}/v1/organizations").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "0"}, json={})
        )
        with pytest.raises(RateLimitedError):
            gate_client.get_organizations()
        # each attempt yields a 429 RESPONSE => 8 -> 4 -> 2 -> 2 -> 2 (floor 2)
        assert gate_client._gate._limit == 2

    @respx.mock
    def test_429_then_success_keeps_reduced_limit(self, gate_client, clock):
        respx.get(f"{BASE}/v1/organizations").mock(
            side_effect=[
                httpx.Response(429, headers={"Retry-After": "0"}, json={}),
                _json({"organizations": []}),
            ]
        )
        assert gate_client.get_organizations() == {"organizations": []}
        assert gate_client._gate._limit == 4  # halved, no recovery inside 60 s


class TestCooldownAndRecovery:
    def test_no_recovery_inside_cooldown(self, clock):
        gate = _RateGate(initial=8, cap=16, clock=clock)
        gate.on_429()  # limit 4, cooldown restarts now
        clock.advance(59.9)
        gate.on_success()
        assert gate._limit == 4
        clock.advance(0.2)  # crosses the 60 s window
        gate.on_success()
        assert gate._limit == 5  # +1 per fully clean 60 s

    def test_success_streak_restores_to_cap(self, clock):
        gate = _RateGate(initial=2, cap=16, clock=clock)
        gate.on_429()
        assert gate._limit == 2
        for _ in range(14):
            clock.advance(61.0)
            gate.on_success()
        assert gate._limit == 16  # cap restored, never beyond
        clock.advance(600.0)
        gate.on_success()
        assert gate._limit == 16

    def test_recovery_counts_full_windows(self, clock):
        gate = _RateGate(initial=4, cap=16, clock=clock)
        clock.advance(125.0)  # two clean 60 s windows since construction
        gate.on_success()
        assert gate._limit == 6

    @respx.mock
    def test_across_calls_recovery_is_lazy_and_monotonic(self, gate_client, clock):
        route = respx.get(f"{BASE}/v1/organizations").mock(
            return_value=_json({"organizations": []})
        )
        assert gate_client._gate._limit == 8
        clock.advance(120.0)
        gate_client.get_organizations()
        assert gate_client._gate._limit == 10  # 8 + 2 clean windows, capped 16
        assert route.call_count == 1


class TestPermitEnforcement:
    def test_concurrent_inflight_never_exceeds_limit(self, clock):
        gate = _RateGate(initial=2, cap=16, clock=clock)
        peak = 0
        peak_lock = threading.Lock()
        release_after = threading.Event()

        def worker():
            nonlocal peak
            gate.acquire()
            with peak_lock:
                peak = max(peak, gate._inflight)
            release_after.wait(timeout=2.0)  # hold the permit
            gate.release()

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        time.sleep(0.15)  # let all threads arrive at the gate
        assert peak <= 2
        assert gate._inflight == 2  # exactly at limit, others parked
        release_after.set()
        for t in threads:
            t.join(timeout=2.0)
        assert gate._inflight == 0

    def test_constructor_injection_is_the_soft_dependency(self, clock):
        gate = _RateGate(initial=3, cap=16, clock=clock)
        client = CastAIClient(BASE, KEY, gate=gate)
        try:
            assert client._gate is gate
            gate.on_429()
            assert gate._limit == 2  # 3 // 2 = 1 -> clamped up to floor 2
        finally:
            client.close()
