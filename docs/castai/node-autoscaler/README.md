# CAST AI Node Autoscaler — Production Engineering Pack

Research snapshot: **2026-10-17** (all facts sourced live from https://docs.cast.ai `.md` endpoints + API reference + changelog Aug 2025–Sep 2026, ~95 docs pages / 9 API ref pages).

| File | What it is |
|---|---|
| `cast-ai-node-autoscaler-handbook.md` | Complete production engineering handbook — 16 chapters + command reference + benchmark framework + deliverables A–G (1,828 lines) |
| `cast-ai-node-autoscaler-handbook.pptx` | 24-slide presentation summarizing the handbook (16:9, native editable shapes) |
| `cast-ai-node-autoscaler-master-prompt.md` | The master research prompt that produced the handbook (85+ docs URL catalog, groups A–J — reusable for re-runs) |
| `build_cast_pptx.py` | Generator for the PPTX (python-pptx); re-run after edits to regenerate the deck |

Conventions used inside the handbook: **[Doc]** = official CAST AI documentation claim (URL cited inline); **[Engineering]** = field recommendation; **[Unverified]** = documentation gap flagged, not resolved. Numeric defaults appear only where the docs state them. Documented contradictions (e.g. drain-fail uncordon 3h vs API 1800 s, GPU-sharing platform support) are flagged in-line rather than smoothed over.

Regenerate the deck:

```bash
python3 build_cast_pptx.py
```

CAST AI ships weekly — re-verify the snapshot date before major adoption decisions.
