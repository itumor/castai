# DRAFT email (for human review only, not sent)

To: Jennrich, Fabian <fabian.jennrich@accenture.com>
Cc: Guy, Bosko, Lars Marin <lmarin@tecracer.de>, Ahmed
Subject: Updated CAST AI Savings Report — Helios, Integ, Kronos (corrected fee basis)

---

Hi Fabian, hi team,

thank you, Fabian, for the sharp review — you spotted slightly different numbers in the billing (billable vCPU) calculation, and I have updated the report accordingly. Kindly find the updated PDF attached.

**The new numbers:**

- The correct fee basis is the **average provisioned (billable) vCPUs** confirmed by the CAST AI billing API for September 2026: **2,878.85 vCPUs** for the three clusters (Helios 1,786.38; Integ 1,005.88; Kronos 86.59). The earlier version had used 2,040.1 vCPUs on a mixed basis, which understated the fee.
- Corrected combined fee at €5/vCPU: **€14,394.26/month** (≈ $15,823.61), giving **net savings of +$24,872.23/month** against gross API-reported realized savings of **$40,695.84**. At the alternative €5.70/vCPU rate: €16,409.45/month, net **+$22,656.93/month**.
- New billing-API addendum: the full SI GSW CLO org totals **3,400.82 billable vCPUs** for September (including baseline-clo-eks, ngm-sim-eks and ngm-sim2-eks) — relevant if Finance books the licence at org level (€17,004.09/month at €5; €19,384.66 at €5.70).

Only the fee sections changed; all realized-savings and tuning figures remain as in the first issue.

**Bottom line:** the savings remain real and significant after fees under either rate — the portfolio is strongly cash-flow positive at **+$22,657–$24,872/month net**. Before final accounting, Finance should confirm the contractual unit rate (€5 vs €5.70/vCPU) and the EUR/USD rate, as flagged in the report.

Thanks again — please send any further questions ahead of our call.

Best regards,
Ebrahim Ramadan
