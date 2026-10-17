#!/usr/bin/env python3
"""Build CAST AI Karpenter Enterprise handbook presentation deck."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
import copy

# ---------- theme ----------
NAVY    = RGBColor(0x0B, 0x25, 0x45)
NAVY2   = RGBColor(0x10, 0x2A, 0x43)
TEAL    = RGBColor(0x2C, 0xA6, 0xA4)
ORANGE  = RGBColor(0xE8, 0x87, 0x1E)
RED     = RGBColor(0xC0, 0x39, 0x2B)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
OFFWHT  = RGBColor(0xF4, 0xF6, 0xF8)
GRAY    = RGBColor(0x5A, 0x6B, 0x7B)
LTGRAY  = RGBColor(0xD8, 0xDF, 0xE6)
DARKTXT = RGBColor(0x22, 0x2A, 0x33)

FONT = "Calibri"
FOOTER = "CAST AI Karpenter Enterprise — Field Handbook Deck · 2026-10-17"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
SW, SH = 13.333, 7.5

def _rect(slide, x, y, w, h, color, line=False):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = color
    if line:
        sh.line.color.rgb = LTGRAY; sh.line.width = Pt(0.75)
    else:
        sh.line.fill.background()
    sh.shadow.inherit = False
    return sh

def _tx(slide, x, y, w, h):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = Emu(9144)
    tf.margin_top = tf.margin_bottom = Emu(4572)
    return tf

def _para(tf, runs, size=14, color=DARKTXT, bold=False, level=0, space_after=4, align=PP_ALIGN.LEFT, first=False):
    p = tf.paragraphs[0] if (first and not tf.paragraphs[0].runs) else tf.add_paragraph()
    p.level = level; p.space_after = Pt(space_after); p.alignment = align
    if isinstance(runs, str):
        runs = [(runs, bold)]
    for txt, b in runs:
        r = p.add_run(); r.text = txt
        r.font.name = FONT; r.font.size = Pt(size); r.font.bold = b; r.font.color.rgb = color
    return p

def _footer(slide, n):
    tf = _tx(slide, 0.55, SH - 0.42, SW - 2.2, 0.34)
    _para(tf, FOOTER, size=9, color=GRAY, first=True, space_after=0)
    tf2 = _tx(slide, SW - 1.15, SH - 0.42, 0.8, 0.34)
    _para(tf2, str(n), size=9, color=GRAY, first=True, space_after=0, align=PP_ALIGN.RIGHT)

def header(slide, kicker, title, n, accent=TEAL):
    _rect(slide, 0, 0, SW, 1.18, NAVY)
    _rect(slide, 0, 1.18, SW, 0.045, accent)
    tf = _tx(slide, 0.55, 0.09, SW - 1.1, 0.34)
    _para(tf, kicker.upper(), size=11, color=accent, bold=True, first=True, space_after=0)
    tf = _tx(slide, 0.55, 0.40, SW - 1.1, 0.72)
    _para(tf, title, size=24, color=WHITE, bold=True, first=True, space_after=0)
    _footer(slide, n)

def content_slide(kicker, title, n, accent=TEAL):
    s = prs.slides.add_slide(BLANK)
    header(s, kicker, title, n, accent)
    return s, _tx(s, 0.55, 1.45, SW - 1.1, SH - 1.95)

def bullets(tf, items, size=13.5):
    first = True
    for it in items:
        lvl = it.get("lvl", 0)
        seg = []
        if it.get("h"): seg.append((it["h"] + " — ", True)) if it.get("dash", True) else seg.append((it["h"], True))
        if it.get("t"): seg.append((it["t"], False))
        if not seg: seg = [(it.get("x", ""), False)]
        col = it.get("color", DARKTXT)
        _para(tf, seg, size=size - lvl * 1.5, color=col, level=lvl,
              space_after=it.get("sa", 5), first=first)
        first = False

def chips(slide, labels, y=6.35, accent=TEAL):
    x = 0.55
    for lab in labels:
        w = 0.32 + len(lab) * 0.088
        _rect(slide, x, y, w, 0.42, OFFWHT, line=True)
        tf = _tx(slide, x + 0.06, y + 0.055, w - 0.12, 0.32)
        _para(tf, lab, size=10.5, color=NAVY, bold=True, first=True, space_after=0)
        x += w + 0.18

def table_slide(kicker, title, n, headers, rows, col_w, n_rows=None, font=11, hfont=11, accent=TEAL, note=None, note_color=ORANGE):
    s = prs.slides.add_slide(BLANK)
    header(s, kicker, title, n, accent)
    n_rows = n_rows or len(rows)
    top = 1.5
    avail_h = SH - 1.95 - (0.42 if note else 0)
    shape = s.shapes.add_table(n_rows + 1, len(headers), Inches(0.55), Inches(top),
                               Inches(SW - 1.1), Inches(min(avail_h, 0.5 + n_rows * 0.55)))
    tbl = shape.table
    # kill default style banding for clean look
    for i, w in enumerate(col_w):
        tbl.columns[i].width = Inches(w)
    for j, h in enumerate(headers):
        c = tbl.cell(0, j); c.fill.solid(); c.fill.fore_color.rgb = NAVY
        c.margin_top = c.margin_bottom = Emu(27432)
        p = c.text_frame.paragraphs[0]; r = p.add_run(); r.text = h
        r.font.name = FONT; r.font.size = Pt(hfont); r.font.bold = True; r.font.color.rgb = WHITE
    for i, row in enumerate(rows):
        for j, val in enumerate(row):
            c = tbl.cell(i + 1, j)
            c.fill.solid(); c.fill.fore_color.rgb = OFFWHT if i % 2 else WHITE
            c.margin_top = c.margin_bottom = Emu(18288)
            tfr = c.text_frame; tfr.word_wrap = True
            p = tfr.paragraphs[0]; r = p.add_run(); r.text = str(val)
            r.font.name = FONT; r.font.size = Pt(font); r.font.color.rgb = DARKTXT
            if j == 0: r.font.bold = True; r.font.color.rgb = NAVY2
    if note:
        tf = _tx(s, 0.55, SH - 0.92, SW - 1.1, 0.4)
        _para(tf, note, size=10.5, color=note_color, bold=True, first=True, space_after=0)
    return s

def divider(part, title, sub, n, accent=TEAL):
    s = prs.slides.add_slide(BLANK)
    _rect(s, 0, 0, SW, SH, NAVY)
    _rect(s, 0, 2.02, 2.6, 0.06, accent)
    tf = _tx(s, 0.9, 1.25, SW - 1.8, 0.6)
    _para(tf, part.upper(), size=16, color=accent, bold=True, first=True, space_after=0)
    tf = _tx(s, 0.9, 2.25, SW - 1.8, 1.6)
    _para(tf, title, size=40, color=WHITE, bold=True, first=True, space_after=6)
    tf = _tx(s, 0.9, 3.7, SW - 1.8, 2.2)
    _para(tf, sub, size=15, color=LTGRAY, first=True, space_after=0)
    tf = _tx(s, 0.9, SH - 0.62, SW - 1.8, 0.4)
    _para(tf, FOOTER, size=9, color=GRAY, first=True, space_after=0)
    tf2 = _tx(s, SW - 1.15, SH - 0.62, 0.8, 0.4)
    _para(tf2, str(n), size=9, color=GRAY, first=True, space_after=0, align=PP_ALIGN.RIGHT)
    return s

n = 1

# ---------- 1 title ----------
s = prs.slides.add_slide(BLANK)
_rect(s, 0, 0, SW, SH, NAVY)
_rect(s, 0, 4.62, SW, 0.05, TEAL)
tf = _tx(s, 0.9, 1.15, SW - 1.8, 0.5);  _para(tf, "COMPLETE ENGINEERING · OPERATIONS · OPTIMIZATION · FINOPS", size=14, color=TEAL, bold=True, first=True, space_after=0)
tf = _tx(s, 0.9, 1.75, SW - 1.8, 2.6);  _para(tf, "CAST AI", size=54, color=WHITE, bold=True, first=True, space_after=0)
_para(tf, "Karpenter Enterprise Suite", size=54, color=TEAL, bold=True, space_after=4)
tf = _tx(s, 0.9, 4.0, SW - 1.8, 0.5);   _para(tf, "The Field Handbook — EKS (primary) & AKS (secondary)", size=20, color=WHITE, first=True, space_after=0)
tf = _tx(s, 0.9, 4.85, SW - 1.8, 1.4)
_para(tf, "Distilled from the 20-chapter engineering handbook · docs.cast.ai + chart-verified defaults", size=13, color=LTGRAY, first=True, space_after=2)
_para(tf, "October 2026 · EA Nov 2025 → GA May 2026 → latest changelog Jul 2026", size=13, color=LTGRAY, space_after=2)
_para(tf, "Integrity: every fact cited or flagged; unshipped features never promised", size=13, color=ORANGE, space_after=0)
n += 1

# ---------- 2 agenda ----------
s, tf = content_slide("Deck map", "What's inside — 20 chapters in 6 parts", n)
bullets(tf, [
    {"h": "Part 1 · Foundations (Ch 1–3)", "t": "what the suite is, architecture & responsibility split, prerequisites"},
    {"h": "Part 2 · Install & Kentroller (Ch 4–6)", "t": "5 install scenarios, Kentroller CRDs & plan engine, rebalancing modes"},
    {"h": "Part 3 · Optimization Features (Ch 7–12)", "t": "NodePools, Workload Autoscaler, Spot intelligence, Live Migration, Commitments, tuning matrix"},
    {"h": "Part 4 · Operations & FinOps (Ch 13–18)", "t": "monitoring, savings measurement, troubleshooting playbook, security, day-2 ops, adoption strategy"},
    {"h": "Part 5 · Reference (Ch 19–20 + App A/B)", "t": "hypothetical case study, quick reference, source inventory, 20-row documentation conflict log"},
    {"h": "", "t": "Color code: teal = documented fact · orange = caveat / doc conflict / unverified", "color": GRAY, "sa": 0},
], size=14)
n += 1

# ---------- part 1 ----------
divider("Part 1 · Chapters 1–3", "Foundations", "What the suite is — and is not. Architecture, responsibility split, and the readiness gate before anything touches a cluster.", n); n += 1

s, tf = content_slide("Ch 1 · Executive overview", "What the suite actually is", n)
bullets(tf, [
    {"h": "An optimization layer ON TOP of open-source Karpenter", "t": "it extends Karpenter, it never replaces it — Karpenter remains the provisioner; CAST AI influences decisions via CRDs"},
    {"h": "Three GA pillars", "t": "Continuous Rebalancing · Spot interruption prediction · Workload rightsizing — plus Commitments steering and Container Live Migration"},
    {"h": "Timeline", "t": "Early Access Nov 2025 → GA May 2026 → per-mode cycles, EC2 Instance SP, disposable annotation, API parity by Jul 2026"},
    {"h": "Scope", "t": "Karpenter-managed nodes only — pre-Karpenter legacy nodes, EKS managed node groups, Cluster-Autoscaler nodes are out of scope"},
    {"h": "HARD RULE", "t": "standard CAST AI Node Autoscaler + Karpenter in the same cluster = unsupported, undefined behavior", "color": RED},
    {"h": "Switch-away path exists", "t": "delete namespace castai-agent, uninstall Karpenter, re-onboard as standard cluster"},
], size=14)
n += 1

table_slide("Ch 1 · Positioning", "Three models you must not conflate", n,
    ["Capability", "OSS Karpenter", "Karpenter Enterprise (CAST AI)", "CAST AI Autoscaler"],
    [
      ["Node provisioning", "✔ (you operate it)", "✔ Karpenter stays provisioner", "✔ CAST AI controller"],
      ["Cost-driven consolidation", "native consolidation", "Continuous Rebalancing takes over", "Evictor + Rebalancer"],
      ["Spot prediction", "2-min AWS notice", "ML model, up to ~30 min lead", "same ML family"],
      ["Commitment steering", "none", "weight-100 shadow NodePools", "commitment-aware selection"],
      ["Rightsizing (WOOP)", "—", "identical behavior", "identical behavior"],
      ["Live migration", "—", "via castai-live + Kentroller", "via castai-live + Evictor"],
    ],
    [2.9, 2.9, 3.5, 2.9], font=11.5)
n += 1

s, tf = content_slide("Ch 2 · Architecture", "Responsibility split — who does what", n)
bullets(tf, [
    {"h": "Kentroller (in-cluster controller)", "t": "watches CAST AI CRDs, generates/executes rebalancing plans, talks to Karpenter NodeClaims/NodePools; 2 replicas, leader-elected, 1 CPU/2Gi"},
    {"h": "CRDs (cluster-scoped, autoscaling.cast.ai/v1alpha)", "t": "RebalancePlan (rp) · RebalancePlanClaim (rpc) · RebalancePlanSchedule (rps) · RebalanceMigrationPlan · UnavailableOffering (uo) · CommitmentBudget (cb)"},
    {"h": "kent Helm wrapper pins everything", "t": "kentroller 0.27.1 · agent 0.162.7 · cluster-controller 0.92.20 · live 0.141.0 · pod-mutator 0.17.11 · spot-handler 0.35.11 · kvisor 1.165.5 · WOOP (+exporter) 1.14.2 [chart-verified]"},
    {"h": "CAST AI SaaS", "t": "console, API/gRPC, ML prediction API, audit — claim-driven plans are SaaS-generated; Continuous Rebalancing computes locally (works during SaaS outages)"},
    {"h": "Karpenter", "t": "keeps provisioning, drift detection, and its interruption queue — Kentroller suppresses competing consolidation during its own plans (disruptGuard)"},
], size=13.5)
n += 1

s, tf = content_slide("Ch 3 · Readiness gate", "Prerequisites — verify before install", n)
bullets(tf, [
    {"h": "Versions", "t": "EKS self-managed Karpenter ≥ 1.0.0 · AKS self-managed ≥ 1.0.0 or NAP (auto-detected via karpenter.azure.com CRDs) · kubectl ≥ 1.19 · Helm ≥ 3.14 (--reset-then-reuse-values)"},
    {"h": "AWS permissions (installer)", "t": "create IAM roles/policies, instance profiles, manage EC2 SGs — Karpenter's own provisioning IAM stays yours"},
    {"h": "AKS identity (mandatory)", "t": "kastroller azure.subscriptionID else chart fails; workload identity federated subject = system:serviceaccount:castai-agent:castai-kentroller (chart adds labels/annotations itself)"},
    {"h": "Egress", "t": "api.cast.ai:443 · grpc.cast.ai:443 · files.cast.ai · kvisor.* · ghcr.io (or us-docker.pkg.dev fallback) — per-region EU/India variants"},
    {"h": "Proxies/TLS interception", "t": "dual-key CA secret (TLS_CA_CERT_FILE AND TLS_CA_CERT); kvisor lacks trustedCACertSecretRef"},
    {"h": "Multi-provisioner", "t": "no other autoscaler co-existing with Karpenter; PrivateLink/PSC path for KE = not documented — confirm with CAST AI", "color": ORANGE},
], size=13.5)
n += 1

# ---------- part 2 ----------
divider("Part 2 · Chapters 4–6", "Installation & the Kentroller Engine", "Five install scenarios, chart traps that break onboarding, the CRD machinery, and how rebalancing actually decides.", n); n += 1

s, tf = content_slide("Ch 4 · Read this first", "Install: the six facts that prevent 90% of failures", n)
bullets(tf, [
    {"h": "Chart identity", "t": "install castai-helm/castai — dir is charts/castai-umbrella but chart name: castai; legacy castai-umbrella alias exists (3 doc variants → App. B #3)"},
    {"h": "kent profile", "t": "kent.enabled=true enables the whole Karpenter Enterprise wrapper (v0.16.0)"},
    {"h": "Values nesting", "t": "umbrella path is kent.castai-kentroller.<…> [chart-verified]; docs often show castai-kentroller.<…> — verify with helm get values castai -a", "color": ORANGE},
    {"h": "One release", "t": "everything in -n castai-agent as release castai; watch castai-kent-preflight reach Completed"},
    {"h": "Secrets", "t": "prefer global.castai.apiKeySecretRef=castai-credentials (key API_KEY) via External Secrets; never inline in Git"},
    {"h": "Toolchain", "t": "Helm ≥ 3.14.0; castctl bundles its own Helm logic (no local helm/jq/yq needed)"},
], size=14)
n += 1

table_slide("Ch 4 · Pick your path", "Five install scenarios", n,
    ["Scenario", "Use when", "Key deltas"],
    [
      ["A · castctl (recommended)", "standard EKS/AKS onboarding", "auto-detects provider/Karpenter; --dry-run; creates cloud identity; prints console URL"],
      ["B · Manual Helm (EKS)", "castctl not permitted", "kent.enabled=true + provider=eks + apiKey(SecretRef) + apiURL/grpcURL"],
      ["C · AKS / NAP", "Azure", "+ azure.subscriptionID & workloadIdentityClientID; managedKarpenter=true for NAP"],
      ["D · GitOps (Argo/Flux)", "enterprise change control", "pin version; prune=false; CAST AI owns cb/zzz-*/rpc CRs — ignoreDifferences; External Secrets"],
      ["E · Restricted envs", "platform team pre-creates IAM", "pre-created identities/secrets; proxy+CA; standalone deploymentMode exists but unsupported pattern → confirm with CAST AI"],
    ],
    [3.1, 3.3, 5.8], font=11.5)
n += 1

table_slide("Ch 5 · Kentroller CRDs", "The six CRDs you will operate", n,
    ["CRD", "Short", "Purpose", "Watch with"],
    [
      ["RebalancePlan", "rp", "concrete plan: nodes to add/remove, savings, execution phases", "kubectl describe rp <n>"],
      ["RebalancePlanClaim", "rpc", "one execution request (console/schedule/CRB)", "kubectl get rpc -w"],
      ["RebalancePlanSchedule", "rps", "cron schedules (UTC)", "kubectl get rps"],
      ["RebalanceMigrationPlan", "—", "CLM coordination inside a plan", "kubectl get migrations -A"],
      ["UnavailableOffering", "uo", "temporarily avoid (type, zone, capacity)", "kubectl get uo"],
      ["CommitmentBudget", "cb", "RI/SP steering → shadow pools", "kubectl get cb / describe cb"],
    ],
    [2.9, 0.9, 5.2, 3.2], font=11.5)
n += 1

s, tf = content_slide("Ch 5 · Plan engine", "Lifecycle, gates, and failure recovery", n)
bullets(tf, [
    {"h": "Claim states", "t": "Pending → Generating → Ready → Executing → Completed | Failed (run/stuck here first when debugging)"},
    {"h": "Execution phases", "t": "Creation (new NodeClaims; ICE retries recorded as -attempt-N, UnavailableOffering written) → savings re-check → Deletion (drain or CLM via RebalanceMigrationPlan; LiveMigration* states tracked)"},
    {"h": "Savings gate", "t": "executionPolicy.achievedSavingsPercentageThreshold — abort = FailureReasonInsufficientSavings; validated numbers in status.validatedSavings"},
    {"h": "Failure recovery (documented)", "t": "failurePhase=Creation → delete new NodeClaims; =Deletion → uncordon new nodes"},
    {"h": "Consolidation controller", "t": "deletes NodeClaims on expireAfter, CRB drains, and empty nodes — Karpenter terminates the instance"},
    {"h": "Feature gating", "t": "dynamic via console (no restarts) — except nodePoolFilterMode & disruptGuard (pod restart)"},
], size=13.5)
n += 1

s, tf = content_slide("Ch 6 · Consolidation", "Three rebalancing paths — and the CRB mode ladder", n)
bullets(tf, [
    {"h": "Continuous (CRB)", "t": "recurring in-cluster cycles; plan computed LOCALLY (no SaaS round-trip — survives CAST AI outages); auto-executes"},
    {"h": "Scheduled (rps)", "t": "cron UTC → claim template → optional autoExecute; night-shift spot rebalances, maintenance windows"},
    {"h": "Manual / console / API (rpc)", "t": "first rebalance, one-off moves; track via kubectl get rebalancing -n castai-agent"},
    {"h": "Mode ladder", "t": "delete-empty ⊂ drain-only ⊂ full · default = full; drain-only = bin-pack onto EXISTING capacity, zero new nodes"},
    {"h": "Both savings gates required", "t": "projected ≥ savingsThresholdPercent (default 15, % of TOTAL cluster cost, full mode only) AND ≥ $50/mo (env) — not either/or", "color": ORANGE},
    {"h": "Cadences [chart-verified]", "t": "base 60s · full-mode 1800s · drain-only 60s · delete-empty 60s; minNodeAge 300s; failure backoff 30m; ≤ 10 nodes/iteration"},
], size=13.5)
chips(s, ["exclude annotation blocks ALL paths", "budgets re-checked every 30s", "WhenEmpty → empty nodes only", "static pools never"], y=6.55)
n += 1

s, tf = content_slide("Ch 6 · Guardrails", "Exclusion hierarchy & eviction strictness", n)
bullets(tf, [
    {"h": "Strongest first", "t": "① NodePool annotation kentroller.cast.ai/consolidation:exclude (blocks everything incl. delete-empty & drift) ② node label autoscaling.cast.ai/removal-disabled=true ③ Karpenter natives (WhenEmpty, disruption.budgets, do-not-disrupt)"},
    {"h": "Filter mode", "t": "nodePoolFilterMode opt-out (default) vs opt-in — opt-in with zero includes stops ALL rebalancing; static setting, restart required", "color": ORANGE},
    {"h": "Excluded pools can still RECEIVE nodes", "t": "replacements placed there become untouchable — audit pool annotations when nodes never get consolidated"},
    {"h": "EvictionConfig (most restrictive match wins)", "t": "removalDisabled > disposable > aggressive; podSelector XOR nodeSelector per entry"},
    {"h": "Doc vs chart field drift", "t": "docs write nodeSelector, chart comments write nodeSelectorTerm — dry-run against your chart before wide rollout (App. B #6)", "color": ORANGE},
], size=13.5)
n += 1

# ---------- part 3 ----------
divider("Part 3 · Chapters 7–12", "The Optimization Features", "NodePool hygiene, workload rightsizing, spot intelligence, live migration, commitments — and one tuning matrix to rule them.", n); n += 1

s, tf = content_slide("Ch 7 · NodePools", "Design choices that decide what CAST AI can do for you", n)
bullets(tf, [
    {"h": "Breadth = search space", "t": "broad multi-generation requirements give CRB its 'largest replaceable subset' and ICE recovery alternatives"},
    {"h": "Capacity-type discipline", "t": "separate/label spot vs on-demand pools — schedules scope on karpenter.sh/capacity-type; commitments only clone spot-allowing pools"},
    {"h": "Weights", "t": "shadow commitment pools win via weight 100 + 'zzz-' lexicographic tiebreak — design your own weights around that"},
    {"h": "consolidationPolicy & budgets", "t": "WhenEmptyOrUnderutilized for flexible pools; budgets rate-limit deletions (both Karpenter-native, honored by CRB)"},
    {"h": "CLM-forward pools", "t": "single-arch (amd64/arm64 never 'Any'), AL2023, generation-compatible families — decide per pool"},
    {"h": "EKS VPC CNI trade-off", "t": "prefix delegation raises pod density (better bin-packing) but forbids the CLM VPC-CNI same-IP path", "color": ORANGE},
], size=13.5)
n += 1

s, tf = content_slide("Ch 8 · Workload Autoscaler", "Rightsizing that feeds Karpenter", n)
bullets(tf, [
    {"h": "Identical on Karpenter & Autoscaler", "t": "operates at workload level; tighter requests → denser packing → CRB removes nodes (incl. pending recommendations)"},
    {"h": "Apply modes", "t": "immediate (default; Eviction API → PDBs enforced) vs deferred (natural recreation; in-place resize on K8s 1.33+)"},
    {"h": "Forced-deferred overrides", "t": "hostname anti-affinity · hostNetwork · Rollouts"},
    {"h": "Unhealthy bypass", "t": "OOMKilled / CrashLoopBackOff pods deleted directly, bypassing PDB checks — by design (recovery)"},
    {"h": "Confidence ramp", "t": "<2.4h → 10% cap · <6h → 25% · <24h → 35% · >24h full; manual enable bypasses"},
    {"h": "OOM response", "t": "+20% or +100Mi (whichever greater), linear decay 24h, cap 2.5×, loop-guard 20 OOM/h → 4h pause (diagram says 500Mi floor — App. B #9)", "color": ORANGE},
    {"h": "HPA interop", "t": "CPU overhead ignored when VPA+HPA both on; target converter stops drift fights"},
], size=13.5)
n += 1

s, tf = content_slide("Ch 9 · Spot intelligence", "Prediction → claim → replacement", n)
bullets(tf, [
    {"h": "Lead time", "t": "KE pages: up to ~30 min vs AWS's 2-minute notice (other pages say 1h/180-min model window — plan around 30, App. B #7)"},
    {"h": "Signal path", "t": "node labeled autoscaling.cast.ai/predicted-interruption=true → scoped rpc → SpotInterruptionPredicted event → 15-min replacement cooldown · polls ML API every 1m"},
    {"h": "Without CLM", "t": "Kentroller signals Karpenter's interruption queue → Karpenter's standard replacement with extended lead (needs SQS queue + IAM)"},
    {"h": "With CLM", "t": "CRB + live migration move workloads off the at-risk node first"},
    {"h": "Observe & report", "t": "spot-handler is monitoring-only; observed ICE/interruptions reported — prediction-only never reported as observed"},
    {"h": "NOT shipped", "t": "on-demand→spot fallback recovery + spot reliability model are 'planned future release' — nightly spot-scoped schedule is the honest interim", "color": ORANGE},
], size=13.5)
n += 1

s, tf = content_slide("Ch 10 · Container Live Migration", "CRIU-based moves with honest limits", n)
bullets(tf, [
    {"h": "Default OFF in kent", "t": "castai-live controller.replicaCount 0→2 to enable + kentroller castai.clm.enabled [chart-verified]"},
    {"h": "Hard gates", "t": "K8s ≥ 1.30 · containerd v2+ · AL2023 on EKS (no Bottlerocket/AL2) · both nodes CAST AI-managed · single-arch pools"},
    {"h": "Three TCP paths", "t": "VPC CNI (same IP; no prefix delegation/IPv6/multi-NIC; 'kubernetes.io/role/cni' tag forbidden) · Traffic Control (kernel 6.6+, new IP, in-cluster only) · Calico full CNI (VXLAN)"},
    {"h": "Label matrix", "t": "removal-disabled → migrate but NO eviction fallback · live-migration-disabled → skip · disposable=true → always evict · StatefulSets: no fallback unless disposable"},
    {"h": "Not supported", "t": "DaemonSets · GPU · io_uring/MPTCP/heavy eBPF · privileged; PVC reattach ≈ 9s on EBS"},
    {"h": "Messaging discipline", "t": "'briefly paused' ≠ zero downtime; on Spot, migration before CSP termination cannot be guaranteed — sell it as near-zero for eligible pods", "color": ORANGE},
], size=13.5)
n += 1

s, tf = content_slide("Ch 11 · Commitments", "Shadow NodePools steer workloads into your RI/SP discounts", n)
bullets(tf, [
    {"h": "The gap", "t": "Karpenter has no native commitment awareness — it will buy full-price capacity while discounts idle"},
    {"h": "The mechanism", "t": "console assignment → CommitmentBudget CRDs → Kentroller clones compatible Spot-allowing pools as zzz-castai-budget-* / zzz-castai-sp-*, weight 100, on-demand only"},
    {"h": "Continuous steering", "t": "shadow-pool limits re-tuned every 2 minutes: zonal RI = node count; regional RI + SP = CPU millicores floor($ / pricePerCPU × 1000); min 1 vCPU/pool else InsufficientCommitment"},
    {"h": "Guards", "t": "EKS-only (AKS not yet) · Kentroller ≥ v0.1.162 for Savings Plans · drainMode off|safe|aggressive (default off) · your pools never modified"},
    {"h": "Teardown", "t": "unassign/disable → limits 0 → drain → delete; verify with kubectl get cb + kubectl get nodepools | grep zzz-"},
    {"h": "FinOps caution", "t": "attribute commitment UTILIZATION improvement — the discount itself was already yours", "color": ORANGE},
], size=13.5)
n += 1

table_slide("Ch 12 · One matrix", "Tuning profiles — conservative / balanced / aggressive", n,
    ["Knob", "Default", "Conservative", "Balanced", "Aggressive"],
    [
      ["CRB mode", "full", "drain-only", "drain-only", "full"],
      ["savingsThresholdPercent", "15", "20", "15", "8–10"],
      ["$ / month gate (env)", "50", "100", "50", "25"],
      ["minNodeAgeSeconds", "300", "900", "300", "300"],
      ["fullModeCycleInterval", "1800", "3600", "1800", "1800"],
      ["evictionConfig", "[]", "+ removalDisabled criticals", "+ aggressive N≥3", "+ disposable Jobs"],
      ["commitment drainMode", "off", "off", "off → safe later", "safe"],
      ["CLM", "off", "off", "on (eligible pools)", "on"],
    ],
    [3.3, 1.6, 2.5, 2.5, 2.3], font=11.5,
    note="Rule: one knob per PR · measure ≥1 week · rollback command pre-staged")
n += 1

# ---------- part 4 ----------
divider("Part 4 · Chapters 13–18", "Operations, FinOps & Adoption", "See it, measure it, fix it, govern it — and roll it out without a single avoidable incident.", n); n += 1

s, tf = content_slide("Ch 13 · Observability", "Telemetry surfaces that actually exist", n)
bullets(tf, [
    {"h": "CRDs as your primary console", "t": "rp/rpc/rps/uo/cb + kubectl get rebalancing -n castai-agent (console progress for Karpenter is thin)"},
    {"h": "Metrics", "t": "Kentroller :8443 [chart-verified] — metric names NOT published; discover via /metrics, don't hardcode; OTel export enabled in connected mode"},
    {"h": "Audit", "t": "castai-audit namespace events + console Event Log; ship into your SIEM"},
    {"h": "Cost feeds", "t": "console reports (60s refresh) + API: /cost-reports/clusters/{id}/{savings,estimated-savings,cost}, /organization/cost-comparison [OpenAPI-verified]"},
    {"h": "Alert on mechanics, not money", "t": "pod health, CrashLoops (app=castai-kentroller), Failed/DoneWithWarnings plans, stuck Executing > 1h, NodeClaim > 15 min, uo growth — never alert on absolute savings"},
], size=13.5)
n += 1

s, tf = content_slide("Ch 14 · FinOps", "Measure savings honestly", n)
bullets(tf, [
    {"h": "Core math (documented)", "t": "realized = projected − actual · baseline = 4 frozen params over window · both % cards gated at 20% adoption · Total = autoscaler savings only — never add realized + WA cards (double count)"},
    {"h": "Pricing basis", "t": "public pricing + your Price adjustments — NOT your CUR/bill; list-price view unavailable pre Aug-2025"},
    {"h": "THE KARPENTER GAP", "t": "every FinOps page is autoscaler-written; KE pages claim 'works identically' — baseline method & card gating for Kentroller clusters are NOT documented", "color": RED},
    {"h": "6-step verification protocol", "t": "14+ days → check cards → record baseline source → one attributable rebalance → compare Δcost vs plan savings → reconcile to CUR month-end"},
    {"h": "Attribution", "t": "incremental over your OSS-Karpenter baseline: scale-corrected Period A vs B + Σ plan projectedSavings + request deltas + Δcommitment utilization"},
    {"h": "Report shape", "t": "gross savings · platform fee · net — always separate (handbook Ch 14.5 has a fully-labeled hypothetical 30-day model)"},
], size=13.5)
n += 1

table_slide("Ch 15 · Troubleshooting", "Playbook digest — 20 scenarios in 4 clusters", n,
    ["Cluster", "Top scenarios", "First moves"],
    [
      ["Connectivity", "pods pending · kentroller CrashLoop · private egress", "preflight Job logs · curl api.cast.ai from node · secret key API_KEY"],
      ["No activity", "no plans · claims stuck Generating · savings report empty", "BOTH thresholds? opt-in filter empty? cluster < 14 days (absent ≠ zero)"],
      ["Stuck execution", "plan stuck Executing · NodeClaim > 15 min · nodes not removed", "describe rp (nodesDeletion) · PDBs/budgets · uo list · excluded-pool trap"],
      ["Weird outcomes", "surprise replacements · savings mismatch · GitOps fights", "expireAfter/drift check · Discounted view + Price adjustments · Argo ignoreLists"],
    ],
    [2.2, 4.6, 5.4], font=11.5,
    note="Escalation trigger (documented): repeated same-error plans · NodeClaims > 15 min · persistent connection errors — attach logs + CRD YAMLs")
n += 1

s, tf = content_slide("Ch 16–17 · Govern & operate", "Security boundaries and the day-2 cadence", n)
bullets(tf, [
    {"h": "Identity per scenario E", "t": "pre-created cloud identities; org-level API key in External Secrets; quarterly rotation; key per cluster archetype"},
    {"h": "Two RACI roles", "t": "castai-reader (reports) vs castai-operator (CRB mode, aggressive eviction, drainMode≠off) — destructive knobs behind change approval"},
    {"h": "GitOps boundaries", "t": "your Git owns pools/schedules/values; CAST AI owns cb/zzz-*/rpc CRs + dynamicConfig (chart already marks IgnoreExtraneous)"},
    {"h": "Daily/weekly/monthly", "t": "pods + failed plans / rp outcomes + values diffs + uo reasons / FinOps report + commitment audit + upgrade review"},
    {"h": "SaaS outage behavior", "t": "CRB continues locally; claims/schedules/toggles/prediction degrade — Karpenter unaffected"},
    {"h": "Emergency chain", "t": "suspend all rps → CRB off → labels/annotations protect → commitments off → (only if needed) helm uninstall + delete namespace", "color": ORANGE},
], size=13.5)
n += 1

table_slide("Ch 18 · Rollout", "7-phase adoption — with gates, not hope", n,
    ["Phase", "Do", "Gate to advance"],
    [
      ["0 Inventory", "pools, workloads, PDBs, commitments mapped", "written risk list"],
      ["1 Baseline", "connect, zero features, 7–14d", "stable cost report"],
      ["2 Staging proof", "CRB drain-only + manual rebalance + CLM scan", "plans complete, no blips"],
      ["3 Rightsizing", "WOOP pilot → wave rollout", "-requests, no OOM loops"],
      ["4 Prod rebalancing", "CRB drain-only 20%/$100, nightly schedules", "2 stable weeks, zero PDB incidents"],
      ["5 Spot & commitments", "assign commitments, prediction on, drainMode off", "utilization ↑, fallback debt ↓"],
      ["6–7 Steady state", "CRB full balanced, CLM eligible pools, FinOps monthly", "Day 30/60/90 signed off"],
    ],
    [2.5, 5.4, 4.3], font=11.5,
    note="Every phase: SLO green 2 weeks · ticket with exact knob diff · named rollback command · one feature at a time")
n += 1

# ---------- part 5 ----------
divider("Part 5 · Chapters 19–20 & Appendices", "Case Study & Honesty Log", "A hypothetical 90-day rollout using the handbook's method — and the 20 documentation conflicts this deck refuses to hide.", n, accent=ORANGE); n += 1

s, tf = content_slide("Ch 19 · Case study (hypothetical)", "“Aurora Bank” — 90 days from connect to −21%", n)
bullets(tf, [
    {"h": "Wk 1", "t": "castctl connect EKS prod + AKS dev · zero features · baseline window runs (projected == actual by design)"},
    {"h": "Wk 3", "t": "available savings: 11% rightsizing, 18% oversized nodes, RI util 52%; first manual rebalance → DoneWithWarnings (budget gating)"},
    {"h": "Wk 4–6", "t": "WOOP wave (−12% requests) → prod CRB drain-only: 31 plans, 2 Failed (savings-gate + drain timeout → evictionConfig fix), 24 nodes removed"},
    {"h": "Wk 8", "t": "2 RIs + 1 Compute SP assigned → zzz- shadow pools live; CLM pilot: 14 migrations ok, 1 eBPF workload excluded"},
    {"h": "Day 90", "t": "provisioned CPU −22% · effective $/vCPU-h −14% · $34.1k → $26.9k (−21%) · reconciled ±4% vs CUR · net reported after fee"},
    {"h": "", "t": "All numbers are illustrative method examples — never present them as CAST AI-published rates", "color": ORANGE},
], size=14)
n += 1

table_slide("App B · Honesty log", "Documentation conflicts you should know about (top 8 of 20)", n,
    ["#", "Conflict", "Handbook resolution"],
    [
      ["1", "CRB % default: env 0.0 vs Helm 15 (renamed key)", "chart wins: savingsThresholdPercent=15, cluster-cost scoped"],
      ["2", "cycle: env 10s vs chart 60s (+1800 full mode)", "chart cadences authoritative"],
      ["4", "values nesting with/Without kent. prefix", "chart tree kent.castai-kentroller.*; verify helm get values -a"],
      ["6", "evictionConfig nodeSelector vs nodeSelectorTerm", "unverified divergence — dry-run first"],
      ["7", "prediction horizon 30m vs 1h vs 180m", "plan around ≤30 min"],
      ["8", "spot-handler 3 role descriptions", "monitoring-only; fallback recovery not GA"],
      ["9", "OOM floor 100Mi text vs 500Mi diagram", "quoted both, flagged"],
      ["11", "realized-savings mechanics on Karpenter: undocumented", "Ch 14 gap + empirical protocol before CFO claims"],
    ],
    [0.5, 6.3, 5.4], font=11, hfont=11,
    note="Full 20-row conflict + gap table: handbook Appendix B")
n += 1

# ---------- close ----------
s = prs.slides.add_slide(BLANK)
_rect(s, 0, 0, SW, SH, NAVY)
_rect(s, 0, 1.98, 2.6, 0.06, TEAL)
tf = _tx(s, 0.9, 1.15, SW - 1.8, 0.6); _para(tf, "WRAP-UP", size=15, color=TEAL, bold=True, first=True, space_after=0)
tf = _tx(s, 0.9, 2.2, SW - 1.8, 1.0); _para(tf, "Non-intrusive. Verifiable. Honest about the gaps.", size=34, color=WHITE, bold=True, first=True, space_after=0)
tf = _tx(s, 0.9, 3.35, SW - 1.8, 2.6)
for t in [
    ("Keep Karpenter; gain CRB, spot foresight, rightsizing, commitment steering and live migration", TEAL),
    ("Start silent → baseline → drain-only → commitments → full; one knob at a time", LTGRAY),
    ("Alert on failed plans, not on savings. Report gross − fee = net. Reconcile to CUR", LTGRAY),
    ("Sources: docs.cast.ai (22 refs) + castai umbrella chart 0.45.8 / kent 0.16.0 [chart-verified] + live OpenAPI", GRAY),
]:
    _para(tf, t[0], size=15, color=t[1], first=(t == ("Keep Karpenter; gain CRB, spot foresight, rightsizing, commitment steering and live migration", TEAL)), space_after=8)
tf = _tx(s, 0.9, SH - 0.62, SW - 1.8, 0.4); _para(tf, FOOTER, size=9, color=GRAY, first=True, space_after=0)
n += 1

import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "castai-karpenter-enterprise-handbook.pptx")
prs.save(out)
print(f"saved {out} with {n-1} slides")
