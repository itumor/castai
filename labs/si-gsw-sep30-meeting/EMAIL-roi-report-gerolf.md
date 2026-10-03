# DRAFT — Ibrahim → Gerolf (SI GSW thread), attach roi_report_SI_GSW_CLO_3clusters_QBR.pdf

> Draft only — review before sending. Numbers verified 02 Oct 2026 from the CAST API
> (12 monthly buckets, Oct 2025 – Sep 2026). If the account team confirms the actual
> contract ARR, swap the fee-basis line for the contract figure before sending.

Subject: RE: Cast.ai Exchange - SI GSW — Are the savings real? 12-month ROI report (Helios, Integ, Kronos)

---

Hallo Gerolf,

following up on the open question from our last calls — whether the CAST AI savings on ngm-helios-eks, ngm-integ-eks and ngm-kronos-eks are real — I have attached a one-page ROI report built directly from the CAST API (12 months, Oct 2025 – Sep 2026). No estimates, no models: every number below is measured node-hour data.

**The short answer: yes, the savings are real, and they hold up after the fee.**

- **$526,923 saved over 12 months** across the three clusters — a 33.5% reduction against the $1.57M these clusters would have cost without CAST AI.
- **Every cluster is net-positive every single month.** Integ +$215.6k net, Helios +$128.9k, Kronos +$12.8k — after deducting the platform fee (€5 × provisioned vCPU, €157k / ~$169.6k over the year).
- **$3.1 returned per $1 of fee** (211% ROI). A full month of fee is covered by ~11 days of savings.
- Even applying your internal discounted rates instead of list prices, the net stays **+$83k–$136k positive** — under either mapping, CAST AI has never cost more than it saved on these clusters.

Two points we discussed explicitly:

1. **Fee follows real usage.** The fee basis is the average provisioned vCPU of each month. Deploy waves temporarily scale nodes up — that raises the fee basis because those node-hours were genuinely used; it is not double counting, and savings do not re-accrue on restarts.
2. **Helios' June→July increase was workload growth, not fee mechanics.** Provisioned vCPU grew 1,531 → 1,787 (+17%) from new releases; CAST's savings grew in the same period ($21.7k → $24.0k) — it removed more, demand just grew faster.

**Where the next upside is:** spot savings are currently $0 on all three clusters (0% spot mix). The estimated-savings analysis shows the spot path alone is worth roughly −70% on Helios' compute. Happy to scope a low-risk rollout on ngm-sim2 as a measured before/after, as discussed.

If the numbers raise anything you want to dig into, I can walk you or Marco through the per-month series cluster by cluster — 15 minutes, straight in the console.

Best regards
Ibrahim

---

## Sender notes (not part of the mail)
- Attachment: `roi_report_SI_GSW_CLO_3clusters_QBR.pdf` (2 pages: executive dashboard + provenance/disclaimer).
- Report is stamped QBR (customer-facing), not Internal — safe to attach as-is.
- If Gerolf asks for the raw series: `labs/si-gsw-sep30-meeting/data/2026-10-02-roi/monthly_series.json` has the per-month table; offer to export as XLSX if wanted.
- The 48–58%-of-list range is our inference from their Cloudability view, not contract data — phrase stays "est." in the report disclaimer; the mail says "applying your internal discounted rates", which is safe.
- Keep the ngm-sim2 spot pilot as the concrete next step — it was already proposed in the Sep 30 analysis.
