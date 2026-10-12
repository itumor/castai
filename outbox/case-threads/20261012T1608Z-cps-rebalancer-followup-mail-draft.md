# DRAFT follow-up email to Siemens — ready once engineering replies (human reviews & sends)

To: arseniy.lysenko, philipp.steinberg, luka.kroeger, christoph.goebels.ext, yang.ext
Subject: CPS rebalance plan — what the prices mean, and proposed cautious path

Hi team,

Update on the rebalancer questions from today. I've raised the specific plan with our engineering team (cluster `5dc3bf31-…`, plans generated 2026-10-12 08:28–12:14 UTC). While waiting for their definitive answer, here's what we could already confirm:

**1. The "same shape, 2x price" pair is real AWS pricing, not a UI or pricing bug.**

The console row mixes two units: the small $-value is **cost per vCPU per hour**, the monthly value is the **whole node's discounted on-demand rate**:

- c8in.large: $67.91/mo → $0.093/node-hour → $0.047 per vCPU-hour
- c5a.large: $38.13/mo → $0.052/node-hour → $0.026 per vCPU-hour

c8in (8th-gen Intel, network-optimized, up to 25 Gbps) costs ~1.77x c5a (AMD) at AWS on-demand list prices — the ratio you see in CAST AI matches exactly. What still needs engineering's answer is *why the optimizer included the pricier type at all* when the cheaper same-shape type is in the same plan; AWS capacity/commitment effects or a plan-generation artifact are the candidates. This is the core of the engineering case.

**2. Flex instances are a separate feature from Spot** (`flex_instances_enabled` in autoscaler settings) — that's why they can appear with Spot off. I recommend we verify its state together in the next working session.

**3. Configuration finding:** the only node template saved server-side is **Turbo** (family `r8id`, tainted `siemens.com/node-type=turbo`) — good, it will stay excluded. The ~13-type allow-list we looked at on the main group is **not currently saved** in the autoscaler configuration, so the rebalancer considered the full AWS catalog. Please double-check in the console whether that list was saved or only set in the screen-share session — a saved, sensible constraint set is the main lever to get a cleaner plan.

**4. Available Savings vs Rebalance difference is expected:** Available Savings is the idealized best case (matches the "68 → 8 nodes" view: 3× m6a.8xlarge + 5× r6a.8xlarge); the rebalancer respects pod-per-instance limits, replica spread and safe disruption, so it plans 47 nodes. Both are "right" for their purpose.

**Proposed cautious next step (nothing executes without your explicit trigger):**

1. Confirm/save the main-group instance-type constraints (and check the Flex toggle).
2. Regenerate plans and review together — read-only, off-peak.
3. First real rebalance on **dema-platform-services-test**: main group only, Turbo excluded, non-aggressive settings, evacuation-exempt labels for single-replica pods.
4. Measure cost and stability for a week; then schedule a production window for dema-platform-services with the same settings.

I'll share engineering's selection-rationale answer as soon as I have it, and we can adjust the constraints accordingly.

Best regards,
Ebrahim

---
DRAFT — hold until (a) engineering answers Q1, or (b) Siemens asks for interim status. Do NOT send automatically.
