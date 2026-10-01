# DRAFT — Ibrahim → Gerolf (Si GSW thread), send BEFORE the Wed 30 Sep call

> Action item from 19 Aug minutes, owner: Ebrahim. Overdue; Gerolf has chased twice.
> Replace `[PIN EXACT LINK]` with the precise docs.cast.ai URL before sending.

Subject: RE: Cast.ai Exchange - SI GSW — Anomaly detection: how to view and read it

---

Hallo Gerolf,

as promised in the August minutes, here is how CAST AI anomaly detection works and where you find it — no workshop needed, 5 minutes.

**Where**
1. Console https://console.cast.ai → organization "SI GSW CLO" → Cost management / Cost monitoring.
2. Pick the cluster (e.g. ngm-helios-eks). Anomalies are shown in the cost-monitoring view of the cluster and can additionally be routed to notification destinations (email/webhook) for the person you nominate as FinOps contact.
Documentation: `[PIN EXACT LINK]` (docs.cast.ai → cost monitoring / anomaly detection).

**What an anomaly is**
CAST AI learns the cost baseline of the cluster from its history and flags when actual spend or usage deviates significantly from that baseline. On your R&D clusters the typical triggers are:
- a redeployment that brings up more replicas or bigger requests than before,
- a workload/namespaces that keeps running over night or weekend when the usual pattern scales down,
- node-type changes (e.g. a new memory-heavy family being provisioned).

**How to read one**
Each anomaly shows: detection time, the affected scope (cluster / node pool / namespace / workload), the baseline it deviated from, the deviation (% and $/hour). What I do:
1. Open the anomaly, note the scope and start time.
2. Correlate with your deployment history at that timestamp (in R&D it is almost always a deploy).
3. Check in the workload view whether requests increased or replicas grew — that tells us if it's intentional (new feature) or waste (runaway test, forgotten dev instance).

**Caveat on R&D clusters**
Nightly shutdown and weekend scale-down are *patterns*, not anomalies — they are part of the learned baseline, so they are not flagged. What IS flagged: a night/weekend where the scale-down did *not* happen, and deploys that raise the steady-state.

If it helps: on Wednesday I can walk Marco through one or two live anomalies from ngm-helios-eks directly — 5 minutes, no slides.

Best regards
Ibrahim

---

## Sender notes (not part of the mail)
- This is the only overdue item explicitly assigned to "Ebrahim" — sending it closes the "no single feedback" escalation for our part.
- Optional tru-up before sending: open the console and note 1–2 real recent anomalies on helios to cite dates in the mail.