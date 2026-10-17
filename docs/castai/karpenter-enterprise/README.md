# CAST AI Karpenter Enterprise Suite — Engineering Handbook Pack

Research snapshot: **2026-10-17** (all facts sourced live from https://docs.cast.ai `.md` endpoints + OpenAPI spec + changelog Nov 2025–Jul 2026, 22 documented sources; defaults cross-checked against the actual `castai` umbrella chart 0.45.8 / kent wrapper 0.16.0 / castai-kentroller 0.27.1).

| File | What it is |
|---|---|
| `castai-karpenter-enterprise-handbook.md` | Complete field handbook — 20 chapters + 2 appendices (1,531 lines): architecture, 5 install scenarios (castctl / manual Helm / AKS+NAP / GitOps / restricted), Kentroller CRDs & plan engine, CRB tuning, WOOP / Spot / CLM / Commitments, observability, FinOps, 20-scenario troubleshooting playbook, security, day-2 ops, 7-phase adoption strategy, hypothetical case study, quick reference |
| `castai-karpenter-enterprise-handbook.pptx` | 31-slide presentation summarizing the handbook (16:9, native editable shapes, navy/teal theme, caveats in orange) |
| `build_karpenter_pptx.py` | Generator for the PPTX (python-pptx); re-run after edits to regenerate the deck |

Conventions used inside the handbook: every section cites its source URL; **[chart-verified]** = confirmed against Helm chart source rather than docs; *Recommendation* = engineering practice, not a documented default; *[Hypothetical]* = illustrative numbers, never CAST AI-published rates. Documented contradictions and unshipped features are **flagged, not smoothed over** — see Appendix B (20-row conflict & gap log: CRB threshold key rename, `kent.` values nesting, prediction-horizon drift 30m/1h/180m, spot-handler role drift, Karpenter-mode realized-savings gap, and more).

Regenerate the deck:

```bash
python3 build_karpenter_pptx.py   # writes the .pptx next to this script
```

CAST AI ships weekly — re-verify the snapshot date against https://docs.cast.ai/changelog before major adoption decisions.
