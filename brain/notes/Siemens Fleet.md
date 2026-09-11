# Siemens Fleet

Live snapshot from `cluster-readiness-outputs/castai_cluster_inventory.xlsx`
(refreshed 2026-09-11).

## Headline counts

- **111 organizations** in the Siemens AG enterprise tree
- **230 clusters** visible to the enterprise API key
- **41** in Phase 2 / autoscaler mode
- **189** read-only / monitoring only

## Agent health

| Status | Count |
|---|---|
| online | 188 |
| disconnected | 26 |
| waiting-connection | 9 |
| non-responding | 7 |

## Top orgs by cluster count

| Org | Clusters |
|---|---|
| SMO-RI-CSX-CS | 29 |
| IT IPS | 26 |
| SI GSW CLO | 20 |
| SFS IT CDO | 16 |
| HAFAS H&O | 13 |
| DDI SW MNDX PRO&TECH | 12 |
| DI PA SW DH APM 6 (gWAP X) | 11 |
| SMO Railigent X | 10 |
| SI B SW | 10 |
| Pillar#1 | 9 |

## Key accounts mentioned in cases

- `238720913587` — CSO-managed; account where TKT-20260817-b640 fails.
- `842549707235` — test account used by Sergej; not CSO-managed.
- `397393891645` — AWS org for 842549707235; not CSO-managed.
- `050451381948` — our lab/support AWS account.

## Refresh command

```bash
cd /Users/eramadan/castai/cluster-readiness-outputs
python3 castai_cluster_inventory.py
```

After refresh, update the counts in this note.
