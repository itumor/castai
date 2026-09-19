"""Dedup state: alert each (cluster, rule) at most once per cooldown window,
defaulting to a daily cadence. JSON file, best-effort and human-inspectable."""

from __future__ import annotations

import datetime as dt
import json
import os


class AlertState:
    def __init__(self, path: str, cooldown_hours: float = 24.0):
        self.path = path
        self.cooldown = dt.timedelta(hours=cooldown_hours)
        self._sent: dict[str, str] = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    raw = json.load(fh)
                if isinstance(raw, dict):
                    self._sent = {str(k): str(v) for k, v in raw.items()}
            except (OSError, json.JSONDecodeError):
                self._sent = {}

    @staticmethod
    def _parse(value: str) -> dt.datetime | None:
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

    def should_send(self, cluster_id: str, rule_id: str,
                    now: dt.datetime | None = None) -> bool:
        now = now or dt.datetime.now(dt.timezone.utc)
        last = self._parse(self._sent.get(f"{rule_id}:{cluster_id}", ""))
        return last is None or (now - last) >= self.cooldown

    def mark_sent(self, cluster_id: str, rule_id: str,
                  now: dt.datetime | None = None) -> None:
        now = now or dt.datetime.now(dt.timezone.utc)
        self._sent[f"{rule_id}:{cluster_id}"] = now.isoformat()

    def save(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self._sent, fh, indent=2, sort_keys=True)
