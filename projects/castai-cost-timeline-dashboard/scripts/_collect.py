"""Shared read-only CAST AI collection helpers (tier A + B collectors)."""
import datetime as dt
import json
import os
import time

import requests

BASE = os.environ.get("CASTAI_API_BASE", "https://api.eu.cast.ai")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
UA = "curl/8.7.1"  # Cloudflare 1010-blocks python-urllib UAs (verified 2026-09-26)


class Client:
    def __init__(self, key):
        self.s = requests.Session()
        self.s.headers.update({
            "X-API-Key": key, "Accept": "application/json", "User-Agent": UA,
        })

    def get(self, path, org=None, attempts=4, **params):
        h = {"X-CastAI-Organization-Id": org} if org else {}
        for i in range(attempts):
            try:
                r = self.s.get(BASE + path, params=params, headers=h, timeout=90)
            except requests.RequestException:
                if i == attempts - 1:
                    raise
                time.sleep(1.5 * (i + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(2 * (i + 1) + (10 if r.status_code == 429 else 0))
                continue
            if r.status_code in (400, 401, 403, 404):
                return None  # cluster gone / endpoint n/a — caller records absence
            r.raise_for_status()
            return r.json()
        return None

    def post_report(self, path, body, org=None, attempts=4, **params):
        """POST is used ONLY for read-style `:run…Report` endpoints."""
        h = {"X-CastAI-Organization-Id": org} if org else {}
        url = f"{BASE}/reporting/v1beta/organizations/{org}{path}"
        for i in range(attempts):
            r = self.s.post(url, params=params, json=body, headers=h, timeout=120)
            if r.status_code in (429, 500, 502, 503, 504) and i < attempts - 1:
                time.sleep(2 * (i + 1) + (10 if r.status_code == 429 else 0))
                continue
            if r.status_code in (400, 401, 403, 404):
                return None
            r.raise_for_status()
            return r.json()
        return None


def save(subdir, name, data):
    os.makedirs(subdir, exist_ok=True)
    path = os.path.join(subdir, name)
    with open(path, "w") as fh:
        json.dump(data, fh)
    return path


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def day(s):
    return dt.datetime.strptime(s[:10], "%Y-%m-%d").date()


def chunks(d0, d1, span_days):
    cur = d0
    while cur < d1:
        end = min(d1, cur + dt.timedelta(days=span_days))
        yield cur, end
        cur = end


def months_between(d0, d1):
    out = []
    cur = dt.date(d0.year, d0.month, 1)
    while cur < d1:
        y, m = cur.year, cur.month
        end = dt.date(y + (m == 12), (m % 12) + 1, 1)
        out.append((cur, end))
        cur = end
    return out


def org_dir(org_id):
    return os.path.join(RAW, "orgs", org_id)


def cluster_dir(cid, section):
    return os.path.join(RAW, "clusters", cid, section)


def today():
    return dt.datetime.now(dt.timezone.utc).date()


def load_inventory():
    with open(os.path.join(RAW, "inventory", "inventory.json")) as fh:
        return json.load(fh)
