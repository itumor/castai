#!/usr/bin/env python3
"""Build CAST AI Node Autoscaler presentation from handbook content (in-session verified facts)."""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
import copy

# ---------- theme ----------
NAVY    = RGBColor(0x0F, 0x24, 0x40)
NAVY2   = RGBColor(0x1F, 0x3B, 0x5C)
TEAL    = RGBColor(0x00, 0xB0, 0xB9)
ORANGE  = RGBColor(0xF6, 0xA8, 0x00)
RED     = RGBColor(0xC0, 0x39, 0x2B)
GREY    = RGBColor(0xF4, 0xF6, 0xF8)
MIDGREY = RGBColor(0x8A, 0x94, 0xA6)
TEXT    = RGBColor(0x1A, 0x1A, 0x2E)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
GREEN   = RGBColor(0x1E, 0x8E, 0x5A)

FONT = "Calibri"
SW, SH = Inches(13.333), Inches(7.5)

prs = Presentation()
prs.slide_width, prs.slide_height = SW, SH
BLANK = prs.slide_layouts[6]
_page = [0]

def _box(s, x, y, w, h):
    tb = s.shapes.add_textbox(x, y, w, h)
    tb.text_frame.word_wrap = True
    return tb

def _para(tf, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    return p

def _run(p, text, size, color=TEXT, bold=False, italic=False, font=FONT):
    r = p.add_run(); r.text = text
    f = r.font; f.name = font; f.size = Pt(size); f.color.rgb = color; f.bold = bold; f.italic = italic
    return r

def chrome(s, title, kicker=None, num=True):
    """Top band + footer used by content slides."""
    band = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SW, Inches(1.02))
    band.fill.solid(); band.fill.fore_color.rgb = NAVY; band.line.fill.background()
    band.shadow.inherit = False
    if kicker:
        kb = _box(s, Inches(0.55), Inches(0.08), Inches(11), Inches(0.3))
        _run(_para(kb.text_frame, True), kicker.upper(), 11, TEAL, bold=True)
        ty = Inches(0.34)
    else:
        ty = Inches(0.24)
    tb = _box(s, Inches(0.55), ty, Inches(12.2), Inches(0.62))
    _run(_para(tb.text_frame, True), title, 24, WHITE, bold=True)
    acc = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(1.02), SW, Pt(3))
    acc.fill.solid(); acc.fill.fore_color.rgb = TEAL; acc.line.fill.background(); acc.shadow.inherit = False
    _page[0] += 1
    if num:
        fb = _box(s, Inches(12.55), Inches(7.08), Inches(0.7), Inches(0.3))
        p = _para(fb.text_frame, True); p.alignment = PP_ALIGN.RIGHT
        _run(p, str(_page[0]), 10, MIDGREY)
    cb = _box(s, Inches(0.55), Inches(7.08), Inches(9), Inches(0.3))
    _run(_para(cb.text_frame, True), "CAST AI Node Autoscaler — Production Engineering Guide · docs snapshot 2026-10-17", 9, MIDGREY)

def bullets(s, items, x=Inches(0.55), y=Inches(1.35), w=Inches(12.25), h=Inches(5.6), size=15):
    tb = _box(s, x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = True
    first = True
    for it in items:
        lvl, txt = it[0], it[1]
        bold = it[2] if len(it) > 2 else False
        color = it[3] if len(it) > 3 else TEXT
        p = _para(tf, first); first = False
        p.level = lvl
        p.space_after = Pt(6 if lvl == 0 else 3)
        glyph = "▸ " if lvl == 0 else "· "
        _run(p, glyph, size, TEAL if lvl == 0 else MIDGREY, bold=True)
        _run(p, txt, size if lvl == 0 else size - 2, color, bold=bold)
    return tb

def card(s, x, y, w, h, title, lines, tc=NAVY2, bg=GREY, tsize=14, bsize=11.5):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    sh.adjustments[0] = 0.045
    sh.fill.solid(); sh.fill.fore_color.rgb = bg
    sh.line.color.rgb = tc; sh.line.width = Pt(1); sh.shadow.inherit = False
    tf = sh.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.16); tf.margin_right = Inches(0.16)
    tf.margin_top = Inches(0.10); tf.margin_bottom = Inches(0.08)
    p = _para(tf, True); _run(p, title, tsize, tc, bold=True)
    for ln in lines:
        p2 = tf.add_paragraph(); p2.space_before = Pt(3)
        _run(p2, ln, bsize, TEXT)
    return sh

def table(s, x, y, w, rows, col_w=None, header_bg=NAVY, fsize=11, hsize=11, row_h=Inches(0.32)):
    n_r, n_c = len(rows), len(rows[0])
    gt = s.shapes.add_table(n_r, n_c, x, y, w, row_h * n_r).table
    if col_w:
        total = sum(col_w)
        for i, cw in enumerate(col_w):
            gt.columns[i].width = Emu(int(w * cw / total))
    for r_i, row in enumerate(rows):
        for c_i, val in enumerate(row):
            cell = gt.cell(r_i, c_i)
            cell.margin_left = Inches(0.08); cell.margin_right = Inches(0.06)
            cell.margin_top = Inches(0.02); cell.margin_bottom = Inches(0.02)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tfp = cell.text_frame; tfp.word_wrap = True
            p = tfp.paragraphs[0]
            if r_i == 0:
                cell.fill.solid(); cell.fill.fore_color.rgb = header_bg
                _run(p, str(val), hsize, WHITE, bold=True)
            else:
                cell.fill.solid(); cell.fill.fore_color.rgb = WHITE if r_i % 2 else GREY
                _run(p, str(val), fsize, TEXT, bold=(c_i == 0))
    return gt

def flow(s, x, y, steps, box_w=Inches(2.28), box_h=Inches(0.95), gap=Inches(0.22), fsize=11.5):
    cx = x
    for i, (t, d) in enumerate(steps):
        card(s, cx, y, box_w, box_h, t, [d] if d else [], tc=TEAL, bg=GREY, tsize=fsize + 1.5, bsize=10)
        if i < len(steps) - 1:
            ar = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, cx + box_w, y + box_h / 2 - Pt(7), gap, Pt(14))
            ar.fill.solid(); ar.fill.fore_color.rgb = TEAL; ar.line.fill.background(); ar.shadow.inherit = False
        cx += box_w + gap

# =====================================================================
# 1 TITLE
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SW, SH)
bg.fill.solid(); bg.fill.fore_color.rgb = NAVY; bg.line.fill.background(); bg.shadow.inherit = False
strips = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(5.9), SW, Pt(4))
strips.fill.solid(); strips.fill.fore_color.rgb = TEAL; strips.line.fill.background(); strips.shadow.inherit = False
tb = _box(s, Inches(0.9), Inches(0.9), Inches(11.5), Inches(0.5))
_run(_para(tb.text_frame, True), "PRODUCTION ENGINEERING GUIDE", 16, TEAL, bold=True)
tb = _box(s, Inches(0.9), Inches(1.55), Inches(11.6), Inches(2.3))
p = _para(tb.text_frame, True); _run(p, "CAST AI", 54, WHITE, bold=True)
p = tb.text_frame.add_paragraph(); _run(p, "Node Autoscaler", 54, WHITE, bold=True)
tb = _box(s, Inches(0.9), Inches(3.75), Inches(11.6), Inches(1.6))
p = _para(tb.text_frame, True)
_run(p, "Architecture · Tuning · Spot · Rebalancing · CLM · FinOps · Operations", 20, RGBColor(0xBD, 0xE8, 0xEA))
p = tb.text_frame.add_paragraph(); p.space_before = Pt(8)
_run(p, "Compiled from ~95 official documentation pages, 9 API references and 14 months of changelogs", 13, MIDGREY)
tb = _box(s, Inches(0.9), Inches(6.15), Inches(11.5), Inches(0.9))
p = _para(tb.text_frame, True); _run(p, "Research snapshot: 2026-10-17  ·  EKS / GKE / AKS", 13, WHITE, bold=True)
p = tb.text_frame.add_paragraph(); _run(p, "Facts marked [Doc] = official CAST AI docs · [Engineering] = field recommendation · [Unverified] = doc gap", 11, MIDGREY)

# =====================================================================
# 2 EXEC SUMMARY
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Executive summary", kicker="Why this guide")
bullets(s, [
 (0, "CAST AI Node Autoscaler = remote SaaS brain + in-cluster executors: agent syncs cluster state every ~15 s; the platform bin-packs unschedulable pods and picks the cheapest fitting instance; controllers execute.", False),
 (0, "Scale-up trigger is ONLY unschedulable pods (Pending + PodScheduled=False/Unschedulable). Scale-down removes only EMPTY nodes — unless Evictor or the Rebalancer deliberately creates emptiness.", False),
 (0, "Expected node provisioning time: 60–120 s [Doc].", False),
 (0, "Five levers that decide production success:", True),
 (1, "Node Templates (constraints, spot strategy, CLM, reservations) + Node Configurations (versioned boot/network — new nodes only)", False),
 (1, "Policies: unschedulable-pods (required for rebalancing!), cluster max-CPU cap, empty-node delay (API default 300 s), scoped mode", False),
 (1, "Evictor (60 s cycles · 5-min grace · 20 targets/cycle defaults) vs Rebalancer (plans, graceful drain-failed, savings gates)", False),
 (1, "Spot safety stack: fallback + re-review · interruption prediction (1h AWS / 3h GCP) · reliability 0–100 % · self-service interruption drills", False),
 (1, "FinOps loop: realized = projected − actual · ≥20 % adoption gates · ≥14-day baseline maturity · commitments in top template tiers", False),
])

# =====================================================================
# 3 AGENDA
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Agenda", kicker="16 chapters in 30 minutes")
ag = [("01", "Architecture & internals"), ("02", "Prerequisites & readiness"), ("03", "Installation & onboarding"),
      ("04-06", "Policies · Templates · Configurations"), ("07-08", "Scale-up & scale-down (Evictor)"), ("09", "Spot optimization"),
      ("10-11", "Rebalancing & advanced ops (CLM / hibernation)"), ("12-13", "Troubleshooting & monitoring"), ("14", "Cost optimization & FinOps"),
      ("15-16", "Profiles & playbooks"), ("", "Gaps · benchmark method · sources"), ("", "")]
x, y = Inches(0.55), Inches(1.45)
for i, (n, t) in enumerate(ag):
    col = i // 4; row = i % 4
    cx = x + col * Inches(3.15)
    cy = y + row * Inches(1.28)
    if not t: continue
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cx, cy, Inches(2.95), Inches(1.05))
    sh.adjustments[0] = 0.08; sh.fill.solid(); sh.fill.fore_color.rgb = GREY; sh.line.color.rgb = TEAL; sh.line.width = Pt(1); sh.shadow.inherit = False
    tf = sh.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.12); tf.margin_top = Inches(0.08)
    if n: _run(_para(tf, True), n + "  ", 22, TEAL, bold=True)
    else: _run(_para(tf, True), "•", 22, TEAL, bold=True)
    p = tf.add_paragraph(); _run(p, t, 12.5, TEXT, bold=True)

# =====================================================================
# 4 ARCHITECTURE LOOP
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "The four-step control loop", kicker="Ch 1 · Architecture [Doc]")
flow(s, Inches(0.55), Inches(1.9), [
    ("1 · Watching", "Agent informers sync cluster state to CAST AI every 15 s"),
    ("2 · Calculating", "Extra capacity needed + empty-node detection"),
    ("3 · Evaluating", "Bin-pack pods (NP-hard approx.) → filter → sort by price → cheapest fit"),
    ("4 · Provisioning", "Create right-sized nodes; remove empty nodes"),
], box_w=Inches(2.85), box_h=Inches(1.5), gap=Inches(0.28))
tb = _box(s, Inches(0.55), Inches(4.1), Inches(12.2), Inches(2.6))
p = _para(tb.text_frame, True); _run(p, "In your cluster vs in the SaaS", 16, NAVY2, bold=True)
for lvl, t in [
 (0, "Intelligence (remote): autoscaling engine, rebalancer, spot prediction/reliability models"),
 (0, "Execution (in-cluster): cluster-controller (create/drain/delete, CSR approvals), Evictor (pod moves), Pod Pinner (exact binding), Spot Handler (telemetry-only DaemonSet), Pod Mutator, Live controller, Kvisor"),
 (0, "Watched resources: Node, Pod, PV/PVC, RC, Service, Deployment, RS, DaemonSet, StatefulSet, StorageClass, Job, CSINode, HPA"),
 (0, "DaemonSet accounting uses the HIGHER of DS spec vs running DS pods — prevents scale loops with Workload Autoscaler"),
]:
    p = tb.text_frame.add_paragraph(); p.space_before = Pt(5)
    _run(p, ("▸ " if lvl == 0 else "· "), 14, TEAL, bold=True); _run(p, t, 13, TEXT)

# =====================================================================
# 5 TRIGGERS
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "What triggers scaling — exact semantics", kicker="Ch 1 · [Doc]")
card(s, Inches(0.55), Inches(1.45), Inches(5.95), Inches(2.3), "SCALE UP — only this", [
    "Pod in Pending with PodScheduled=False,",
    'reason "Unschedulable" — verbatim definition.',
    "CPU/memory pressure alone NEVER triggers it.",
    "HPA adds pods → pods pend → autoscaler reacts.",
], tc=GREEN)
card(s, Inches(6.85), Inches(1.45), Inches(5.95), Inches(2.3), "SCALE DOWN — only this", [
    "EMPTY nodes: zero running pods.",
    "Exited, static and DaemonSet pods are ignored",
    "in the emptiness check.",
    "Evictor/Rebalancer manufacture emptiness on purpose.",
], tc=TEAL)
card(s, Inches(0.55), Inches(4.05), Inches(12.25), Inches(2.6), "Instance selection order [Doc]", [
  "Filter viable instance types (template constraints · node-config subnets/AZs · commitments & reservations first)  →  sort by price  →  pick cheapest fit",
  "Zone pick: least-allocated cores → IP availability check → topology-spread feasibility → PVC-bound zones",
  "Only whenUnsatisfiable: DoNotSchedule spreads onto NEW fault domains; ScheduleAnyway keeps bin-packing; minDomains unsupported",
  "Provider-native labels (cloud.google.com/machine-family, karpenter.k8s.aws/instance-family) are NOT evaluated — use scheduling.cast.ai/*",
  "Custom/extended resources cannot drive autoscaling (GPU/TPU/Neuron are first-class exceptions)",
])

# =====================================================================
# 6 PREREQS
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Prerequisites — the compatibility gate", kicker="Ch 2 · [Doc]")
table(s, Inches(0.55), Inches(1.4), Inches(12.25), [
 ["Gate", "Rule"],
 ["Sole autoscaler", "CAST AI only. Cluster-autoscaler conflict; Karpenter mix = officially unsupported (undefined behavior)"],
 ["Incompatible platforms", "GKE Autopilot · EKS Auto Mode · EKS Fargate · AKS Automatic (→ use CAST AI Anywhere)"],
 ["K8s versions", "≥1.27 Pod Pinner · ≥1.30 CLM · ≥1.34 DRA GPU · AL2023 required for K8s ≥1.33"],
 ["IAM", "Dedicated instance profile; NEVER share with managed node groups; documented least-privilege policies"],
 ["Network", "Egress to api/grpc/files.<region>.cast.ai :443 · registries ghcr.io/us-docker.pkg.dev · webhook :9443"],
 ["Private clusters", "AWS PrivateLink (4 VPC endpoints + private ECR mirror) · GCP Private Service Connect"],
 ["Workload gates", "PDB minAvailable≥1 everywhere · no imagePullPolicy:Always · startup probes < nodeGracePeriod (5 min) · metrics-server"],
], col_w=[2.6, 9.6], fsize=12, hsize=12.5)

# =====================================================================
# 7 INSTALL
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Installation — three supported paths", kicker="Ch 3 · [Doc]")
card(s, Inches(0.55), Inches(1.45), Inches(3.95), Inches(3.1), "1 · castctl (recommended)", [
 "brew install castctl / curl | bash",
 "castctl auth login → cluster connect",
 "Registers cluster, installs umbrella",
 "chart, creates IAM. --dry-run preview.",
 "import-config: node groups →",
 "configs + templates (all clouds).",
])
card(s, Inches(4.7), Inches(1.45), Inches(3.95), Inches(3.1), "2 · Console + Operator", [
 "castware-operator lifecycle mgmt",
 "Phase 1: agent + spot-handler (RO)",
 "Phase 2: cluster-controller",
 "(extendedPermissions: true)",
 "Legacy onboarding script: DEPRECATED",
])
card(s, Inches(8.85), Inches(1.45), Inches(3.95), Inches(3.1), "3 · Terraform provider", [
 "castai/castai ≥ 3.11.0",
 "module castai/eks-role-iam ~> 2.0",
 "castai_autoscaler / node_template /",
 "node_configuration / rebalancing_",
 "schedule resources per layer",
])
tb = _box(s, Inches(0.55), Inches(4.85), Inches(12.25), Inches(2.0))
p = _para(tb.text_frame, True)
_run(p, "Umbrella chart rules [Doc]:  ", 14, RED, bold=True)
_run(p, "one namespace (castai-agent) · exactly one mode tag true (readonly / workload-autoscaler / node-autoscaler / full) · upgrade with --reset-then-reuse-values (Helm ≥3.14) · pin --version for config-only changes · K8s upgrades: control plane first, then roll nodes · AL2 EOL — AL2023 for K8s ≥1.33 · ghcr.io is the default registry, us-docker.pkg.dev the fallback.", 13, TEXT)

# =====================================================================
# 8 POLICIES
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Policies — documented defaults", kicker="Ch 4 · API-verified")
table(s, Inches(0.55), Inches(1.4), Inches(12.25), [
 ["Setting", "Default", "Note"],
 ["unschedulablePods.enabled", "false (TF!)", "Required for scale-up AND all rebalancing — #1 foot-gun"],
 ["clusterLimits.cpu.maxCores", "20 (min 2)", "Hard cap on CAST nodes; 90–95 % alerts (Apr 2026); minCores DEPRECATED"],
 ["nodeDownscaler.emptyNodesDelay", '"300s"', "Natural empties only — Evictor drains delete immediately (TTL bypassed)"],
 ["scopedMode", "false", "Only taint-tolerant pods scale up; only managed-by=cast.ai nodes downscale"],
 ["partialemplate matching", "false", "All terms must match unless enabled; sort: all-match > count > price/CPU desc > name"],
 ["drainTimeoutSec (node config)", "0 = platform", "Docs cite 20 m default / 180 max; since Aug 2026 downscaler honors it too"],
 ["podPinner", "off", "K8s ≥1.27; status must be COMPATIBLE; audit webhook conflicts first"],
], col_w=[3.1, 1.9, 7.2], fsize=11.5, hsize=12)
tb = _box(s, Inches(0.55), Inches(5.05), Inches(12.25), Inches(1.9))
p = _para(tb.text_frame, True)
_run(p, "⚠ V1→V2 breaking [Doc]: ", 14, RED, bold=True)
_run(p, "Policies V2 removed headroom, headroom_spot, spot_instances, node_constraints, custom_instances_enabled, disk_gib_to_cpu_ratio. Evictor moved to its own API (/workload-eviction/v1/…/config). No bidirectional sync with node templates. Optimistic-lock the PATCH with version.", 13, TEXT)

# =====================================================================
# 9 TEMPLATES
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Node Templates — scheduling constraints", kicker="Ch 5 · [Doc]")
bullets(s, [
 (0, "1 template ↔ 1 node configuration; default-by-castai is mandatory, undeletable, unrenamable (can be disabled).", False),
 (0, "Matching: explicit selector scheduling.cast.ai/node-template: <name> (recommended) > custom labels; operator In only for the template key.", False),
 (0, "shouldTaint=true ⇒ node-template=<name>:NoSchedule taint — specialized pools stay clean; false lets anything land (default template pattern).", False),
 (0, "Constraint box: spot/OD offerings, CPU/RAM bounds, families include/exclude, arch (+priority), OS, AZs (∩ subnets), burstable, bare-metal, GPU blocks, sole-tenant (GKE), capacity reservations.", False),
 (0, "Instance-family prioritization = tiered queue that BEATS commitment-aware selection — put RI/SP/CUD-covered families top tier [Doc].", False),
 (0, "Guardrails: per-template CPU cap (upscale + rebalance; pods stay Pending with event at cap) · maxPricePerCpu spot ceiling (Jul 2026) · cost multipliers per instance type.", False),
 (0, "Capacity reservations: targeting locks type+AZ, auto-taint reserved=only:NoSchedule; order = reservation → RI/SP-covered OD → OD/Spot → Pending. Autoscaler pre-drains at Capacity Block end.", False),
 (0, "Min-nodes workaround: tiny helper Deployment + podAntiAffinity + removal-disabled labels (docs pattern).", False),
], size=14)

# =====================================================================
# 10 NODE CONFIG
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Node Configurations — versioned node boot", kicker="Ch 6 · [Doc]")
bullets(s, [
 (0, "Configs are versioned; changes apply to NEW nodes only — roll with a rebalance. Exactly one default per cluster.", False),
 (0, "Shared defaults: disk 100 GiB · ratio 1 CPU:0 GiB · init empty · kubelet {} · drainTimeoutSec 0 (platform default)", False),
 (0, "EKS: gp3/3000 IOPS/125 MiB/s · IMDSv1=true + hop-limit 2 · imageFamily AL2023 (K8s 1.33+) · threadsPerCpu · KMS needs ReEncrypt*/GenerateDataKey*/Encrypt/DescribeKey/Decrypt/CreateGrant · target-group IAM else unregistered nodes", False),
 (0, "EKS maxPods CEL presets: default N*(I−1)+2 · prefix-delegation N*(I−1)*P+2 · capped variant · custom-networking / SGPP variants — wrong formula = pods Pending with free CPU (classic)", False),
 (0, "Subnets: routable = IGW+public-map / TGW / NAT, or tag cast.ai/routable=true; EKS-only 'subnet by usage' needs AWS VPC CNI (off with custom networking/IPv6); /28 prefix blocks when delegation on", False),
 (0, "Zone selection: least-allocated cores → IP availability → abort; event 'there is no subnet with enough available IP addresses'", False),
 (0, "GKE: maxPods 110 (formula NUM_CPU/NUM_RAM_GB), Pod CIDR = maxPods×2 → pow2 · AKS: maxPods 30 (10–250), image families incl. Ubuntu 24.04 (≥1.36), Azure Linux, WS 2019/2022/2025, ephemeral OS disks, pod_subnet_id, accelerated networking", False),
 (1, "Pitfalls: comma-separated AMI search silently returns ZERO results · duplicate kubelet --register-with-taints keeps only the LAST flag · Bottlerocket init = single-line TOML, GPU needs lockdown='none', Nitro-only, no CLM", True, RED),
], size=13.5)

# =====================================================================
# 11 SCALE-UP
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Scale-up tuning — the funnel & the failures", kicker="Ch 7 · [Doc]")
flow(s, Inches(0.55), Inches(1.65), [
    ("Pending pods", "Unschedulable only"),
    ("Bin-pack", "+ DS higher-of"),
    ("Template match", "explicit selector"),
    ("Commitments", "RI→SP / CUD→Flex"),
    ("Cheapest fit", "60–120 s node"),
], box_w=Inches(2.25), box_h=Inches(1.15), gap=Inches(0.22))
table(s, Inches(0.55), Inches(3.35), Inches(12.25), [
 ["FailedUpscaling cause", "Documented fix"],
 ["maxPods wall (c6g.2xlarge = 58)", "ENABLE_PREFIX_DELEGATION=true on aws-node · or raise template Min CPU"],
 ["Subnet IP exhaustion", "Free IPs / add subnets+AZs / tune WARM_*; event is explicit"],
 ["Zone topology-spread (5 event variants)", "Subnet per zone · widen template AZs · reconcile selector/PVC zones"],
 ["GPU custom resource requests", "Cannot drive scaling — use first-class GPU/TPU/Neuron or DRA-MPS (1.34+)"],
 ["Template / cluster CPU cap hit", "Pods stay Pending by design; pod event names the policy"],
 ["GKE pd-standard vs C3/C3D", "WaitForFirstConsumer + volume.scheduling.cast.ai/pd-standard:'true'"],
], col_w=[4.6, 7.6], fsize=11.5, hsize=12)
tb = _box(s, Inches(0.55), Inches(6.3), Inches(12.25), Inches(0.7))
p = _para(tb.text_frame, True)
_run(p, "Latency levers: ", 13.5, NAVY2, bold=True)
_run(p, "AL2023 + short init (≤12 KB) · broader templates (drought-proof) · Pod Pinner for big bursts · spare capacity in POD replicas, not node headroom (V2 removed headroom fields).", 13, TEXT)

# =====================================================================
# 12 EVICTOR
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Scale-down & Evictor", kicker="Ch 8 · [Doc]")
tb = _box(s, Inches(0.55), Inches(1.3), Inches(12.25), Inches(1.15))
p = _para(tb.text_frame, True)
_run(p, "TTL paradox [Doc verbatim rule]: ", 14, RED, bold=True)
_run(p, "empty-node TTL applies only to naturally-emptied nodes (job done, scale-down). When Evictor actively drains a node, it is deleted IMMEDIATELY — the configured TTL does not apply.", 13.5, TEXT)
table(s, Inches(0.55), Inches(2.6), Inches(12.25), [
 ["Evictor default", "Value", "Guidance [Doc]"],
 ["cycleInterval", "60 s", "≤200 nodes 1m · 200–500 → 5m · 500+ → 10m"],
 ["nodeGracePeriodMinutes", "5 min", "Raise to worst-case pod startup (JVM!)"],
 ["maxTargetNodesPerCycle", "20", "200–500 → 10 · 500+ → 5"],
 ["dryRun", "on (manual)", "Observe a week before activating"],
 ["CPVPA sizing", "200Mi/2Gi + 256Mi/20 nodes", "500+ nodes → 128Mi/10 · freezes via scale 0/1"],
], col_w=[3.4, 3.0, 5.8], fsize=11.5, hsize=12)
bullets(s, [
 (0, "Modes: default (multi-replica) · aggressive (+single-replica + Jobs — 'not advised for production') · scoped (only managed-by=cast.ai nodes, Helm-only)", False),
 (0, "PDBs ALWAYS respected, in every mode, even for disposable pods — minAvailable: 1 is the documented floor.", True),
 (0, "Protection: removal-disabled (node+pod) · disposable · live-migration-disabled · safe-to-evict true/false; protection applies only to RUNNING pods (terminal Job pods lose it — annotate the node).", False),
 (0, "Soft tainting (chart ≥0.33.193) = PreferNoSchedule safety-net instead of hard cordon · OSS-Karpenter cleanup (≥0.33.196) deletes NodeClaims.", False),
], y=Inches(4.8), h=Inches(2.1), size=13)

# =====================================================================
# 13 EVICTOR VS REBALANCER
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Evictor vs Rebalancer — use both, differently", kicker="Ch 8/10 · [Doc]")
table(s, Inches(0.55), Inches(1.4), Inches(12.25), [
 ["Aspect", "Evictor", "Rebalancer"],
 ["Solves", '"wasted space" — pod consolidation', '"wrong infrastructure" — node replacement'],
 ["Nodes", "Empties existing ones", "Adds new, removes old"],
 ["Frequency", "Continuous (60 s)", "On-demand / scheduled"],
 ["Disruption", "Lower", "Higher (whole-node replace)"],
 ["Single replica", "✗ std / ✓ aggr", "✓ / ✓"],
 ["StatefulSet", "✗ std · CLM auto-migrates eligible", "✓ / ✓"],
 ["When", "always on", "onboarding · DS changes · weekly cadence"],
], col_w=[2.2, 5.0, 5.0], fsize=12, hsize=12.5)

# =====================================================================
# 14 SPOT
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Spot optimization — the safety stack", kicker="Ch 9 · [Doc]")
card(s, Inches(0.55), Inches(1.45), Inches(3.95), Inches(2.9), "Prediction", [
 "ML model: 1h window (AWS) ·",
 "3h (GCP) · node-level re-eval",
 "every 10 min. Replacement-",
 "FIRST drain. Drain label:",
 "draining=spot-prediction.",
 "AWS rebalance-rec source",
 "removed Jul 2026.",
])
card(s, Inches(4.7), Inches(1.45), Inches(3.95), Inches(2.9), "Fallback", [
 "spot-fallback OD when capacity",
 "fails + re-review interval to",
 "return to spot. Toleration:",
 "scheduling.cast.ai/spot-fallback.",
 "Rebalancer IGNORES removal-",
 "disabled on fallback nodes",
 "(by design — avoid cost leak).",
])
card(s, Inches(8.85), Inches(1.45), Inches(3.95), Inches(2.9), "Reliability", [
 "enableSpotReliability +",
 "price tolerance 0–100 %",
 "(default 100 = most",
 "aggressive). Scores nodes",
 "via label spot-reliability.",
 "Diversified Spot DEPRECATED",
 "in favor of Reliability.",
])
tb = _box(s, Inches(0.55), Inches(4.6), Inches(12.25), Inches(2.3))
p = _para(tb.text_frame, True)
_run(p, "Adoption pattern [Engineering on Doc]: ", 14, NAVY2, bold=True)
_run(p, "template spot+fallback+prediction → PDBs + multi-replica + tolerations (or Pod Mutations percentage rollout: only-spot / preferred-spot / optional-spot 0–100 %, enforcer: spot-reschedule) → game day with simulate-spot-interruption API → ramp % · validate sampling ≈2 % of spot cost (capped 10 %) · drain labels spot-interruption / spot-prediction / spot-fallback prove behavior.", 13, TEXT)

# =====================================================================
# 15 REBALANCING
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Rebalancing — plans, graceful mode, schedules", kicker="Ch 10 · [Doc]")
flow(s, Inches(0.55), Inches(1.5), [
    ("Generating", "cheapest redistribution (same engine)"),
    ("Ready", "preview savings"),
    ("In progress", "create → prepare(80m) → drain → delete 1-by-1"),
    ("Completed/Partial", "drain-failed annotation + 3h auto-uncordon*"),
], box_w=Inches(2.85), box_h=Inches(1.35), gap=Inches(0.28))
table(s, Inches(0.55), Inches(3.2), Inches(12.25), [
 ["Schedule setting", "Documented default"],
 ["Drain timeout", "20 min · max 180 min · graceful = cordon+keep (PDBs strict) vs forceful (PDBs may break)"],
 ["Max batch size", "0 = all nodes · min node age 0 = any age"],
 ["Sort", "NormalizedPrice (default) · UtilizedPrice (1:7 CPU:RAM — best for most) · Utilization"],
 ["Savings gates", "triggerConditions.savingsPercentage (skip) + achievedSavingsPercentage (mid-flight abort → new nodes deleted)"],
 ["Targeting", "UI terms AND; API nodeSelectorTerms give OR (In with multiple values)"],
], col_w=[2.9, 9.3], fsize=11.5, hsize=12)
tb = _box(s, Inches(0.55), Inches(5.9), Inches(12.25), Inches(1.3))
p = _para(tb.text_frame, True)
_run(p, "⚠ Known traps [Doc]: ", 13.5, RED, bold=True)
_run(p, "targeting cordoned nodes skips the WHOLE run · problematic workloads excluded (custom-label affinity → map a Node Template) · aggressiveModeConfig.ignoreLocalPersistentVolumes = DATA LOSS · paused drain = plans only, never schedules · *API default uncordonAfterSeconds=1800 vs docs prose 3h — flagged conflict.", 12.5, TEXT)

# =====================================================================
# 16 CLM + HIBERNATION
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Advanced: Container Live Migration & Hibernation", kicker="Ch 11 · [Doc]")
card(s, Inches(0.55), Inches(1.45), Inches(5.95), Inches(4.9), "CLM (CRIU)", [
 "K8s 1.30+ · containerd v2+ · both nodes CAST-managed",
 "EKS: AL2023 only (kernel 6.1/6.12/6.18 by K8s version);",
 "Bottlerocket/AL2 ✗ · GKE COS/Ubuntu · AKS Ubuntu/AL3",
 "Single arch + same-generation families; ARM64 = full",
 "dump freeze (no incremental — cannot be overcome)",
 "TCP paths: VPC CNI (IP kept, same subnet, no prefix-",
 "delegation/IPv6/multi-NIC) · TC (kernel 6.6+, IPv4 TCP)",
 "· Calico VXLAN (own risk)",
 "Excluded: GPU · DaemonSets · tty · hostPath · io_uring",
 "· MPTCP · eBPF · privileged; StatefulSets keep names",
 "Evictor matrix: migrate → fallback evict; StatefulSet",
 "w/o disposable stays on source; SPOT: call support first",
], tsize=15)
card(s, Inches(6.85), Inches(1.45), Inches(5.95), Inches(4.9), "Cluster hibernation", [
 "Connected → Hibernating → Hibernated → Resuming",
 "Control plane + PVs keep billing; >1000 nodes may fail",
 "Resume node: CriticalAddonsOnly taint (post 2026-05-25)",
 "+ min chart floors (agent 0.139.0, controller 0.90.0…)",
 "EKS: default node config needs nodeGroupArn (IAM role",
 "ARN — TF/API only) for aws-auth CONFIG_MAP mode",
 "Schedules via API/TF/console · manual PAUSE/resume jobs",
 "Resume node NOT auto-removed → rebalance afterward",
 "Webhooks: ignore-during-hibernation annotation;",
 "Gatekeeper×Kyverno Fail-policies deadlock → tolerations",
 "+ kube-system exclusions",
], tsize=15)

# =====================================================================
# 17 TROUBLESHOOTING
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Troubleshooting — the top 10 of 22 cases", kicker="Ch 12 · runbook")
rows = [["#", "Symptom", "First move"]]
cases = [
 ("1", "Pods Pending, CPU free", "allocatable.pods vs running count → prefix delegation"),
 ("2", "Nodes NotReady after join", "aws-auth / access entries for instance-profile role"),
 ("4", "Bottlerocket 5+ min Ready", "set dnsClusterIp (kube-dns ClusterIP)"),
 ("7", "Zone topology-spread events", "5 variants — subnets/AZs/maxSkew/PVC conflict"),
 ("8", "no subnet with enough IPs", "ENI inventory cmd; add subnets/AZs"),
 ("9", "Evictor idle", "PDBs at 0 disruptions · 5-min age · labels"),
 ("10", "Evictor 429 PDB stalls", "lower targets/cycle · fix minAvailable==replicas"),
 ("11", "drain-failed residue", "clear annotation → uncordon (or force-drain)"),
 ("15", "Hibernation resume auth error", "nodeGroupArn (IAM role) on default config"),
 ("21", "Controller not responding", "snapshots_received=0? processed=0? → who owns it"),
]
rows += [list(c) for c in cases]
table(s, Inches(0.55), Inches(1.4), Inches(12.25), rows, col_w=[0.6, 5.2, 6.4], fsize=11, hsize=12)

# =====================================================================
# 18 MONITORING
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Monitoring & observability", kicker="Ch 13 · [Doc]")
bullets(s, [
 (0, "Surfaces: cluster audit log (90-day retention → archive) · org activity log · notifications (Slack/webhook, expire after 24h) · OSS OTel exporter castai/audit-logs-receiver → SIEM · k8s events (Unscheduled Pods Policy Applied, Migration* events)", False),
 (0, "Critical alarms: agent can't connect · Cluster controller not responding · IP Address quota exceeded · Spot quota exceeded (Critical w/o fallback / Warning with) · Node config validation failed · Cost anomaly on {metric}", False),
 (0, "Agent health metrics [Doc]: castai_autoscaler_agent_snapshots_received_total = 0 → agent/network issue; received>0 with processed=0 → '100% Cast AI issue' (verbatim) — evidence for support.", False),
 (0, "Labels to watch: autoscaling.cast.ai/draining ∈ {rebalancing, spot-prediction, spot-fallback, spot-interruption, evictor} · managed-by · spot-reliability score · drain-failed + uncordon-after", False),
 (0, "SLO inputs: 60–120 s provisioning expectation · 15 s agent sync · pending-pod alert kube_pod_status_phase{phase=Pending} ≥ 15 min", False),
], size=14)

# =====================================================================
# 19 FINOPS
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Cost optimization — exact report math", kicker="Ch 14 · [Doc]")
table(s, Inches(0.55), Inches(1.4), Inches(12.25), [
 ["Report", "Formula / gate"],
 ["Savings (realized)", "realized = projected − actual · WOOP = (orig−current requests)×unit cost · cards hidden <20 % adoption"],
 ["Baseline", "4 factors, computed once/day; history (≥7d to takeover) → peers → industry avg; <14-day cluster = ABSENT"],
 ["Efficiency", "Overprovisioning % = 100 − (Requested ÷ Provisioned ×100)"],
 ["Cost comparison", "≤30-day windows, like-for-like; >1000 % delta = period A idle/over-provisioned"],
 ["Total compute cost", "public inventory + YOUR Price adjustments; monthly = hourly avg ×24 ×730"],
 ["Commitments", "utilization = ½·provCPU/total + ½·provMEM/total · import hourly · families top-tier in templates"],
], col_w=[2.8, 9.4], fsize=11.5, hsize=12)
tb = _box(s, Inches(0.55), Inches(5.0), Inches(12.25), Inches(1.9))
p = _para(tb.text_frame, True)
_run(p, "Documentation gaps to keep honest [flagged]: ", 14, RED, bold=True)
_run(p, "CAST AI fee / gross-vs-net NOT stated anywhere · no separate spot-savings line (spot = cheaper actuals) · projection formulas unpublished · savings listing only after 2025-08-06 · confirm with CSM before quoting net ROI.", 13, TEXT)

# =====================================================================
# 20 PROFILES
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Three production configuration profiles", kicker="Ch 15 · [Engineering on Doc]")
table(s, Inches(0.55), Inches(1.4), Inches(12.25), [
 ["Dimension", "🛡 Conservative", "⚖️ Balanced (default)", "💰 Cost-optimized"],
 ["Cluster max CPU", "peak +50 %", "peak +30 %", "peak +15 % + alerts"],
 ["emptyNodesDelay", "600–900 s", "300 s", "60–120 s"],
 ["Spot", "optional pool, fallback, reliability 50", "pool, fallback, reliability 50–70", "spot-first 70–100 % + enforcer"],
 ["Evictor", "default, 5 min grace", "default + per-ns disposables", "aggressive on batch namespaces"],
 ["Rebalancing", "manual, ≥20 % threshold", "weekly graceful 10–20 %", "nightly spot-targeted ≥10 %"],
 ["Hibernation", "manual only", "dev/stage schedules", "schedules widely"],
 ["Fallbacks", "delayed CA / GKE Watchdog", "same", "same"],
], col_w=[2.4, 3.1, 3.4, 3.3], fsize=11, hsize=11.5)

# =====================================================================
# 21 PLAYBOOKS
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "14 operational playbooks", kicker="Ch 16")
p1 = ["P1 Onboard a cluster (30 min)", "P2 Enable Evictor safely", "P3 Adopt Spot in production", "P4 Standing rebalance cadence", "P5 Drain-failed recovery", "P6 Hibernation for dev/stage", "P7 K8s version upgrade"]
p2 = ["P8 AL2 → AL2023 migration", "P9 Scoped-mode enablement", "P10 Commitments onboarding", "P11 GPU Capacity Blocks", "P12 PrivateLink air-gap", "P13 CAST AI control-plane incident", "P14 Clean offboarding"]
x = Inches(0.55)
for i, group in enumerate([p1, p2]):
    cx = x + i * Inches(6.35)
    for j, t in enumerate(group):
        card(s, cx, Inches(1.5) + j * Inches(0.78), Inches(5.95), Inches(0.62), t, [], tc=TEAL, tsize=13.5)

# =====================================================================
# 22 BENCHMARKS
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Benchmark framework — method, not numbers", kicker="Part 4 · honesty note")
tb = _box(s, Inches(0.55), Inches(1.45), Inches(12.25), Inches(1.0))
p = _para(tb.text_frame, True)
_run(p, "The CAST AI docs publish NO benchmark numbers. ", 15, RED, bold=True)
_run(p, "This framework is a test method — every cell is a placeholder you fill with your own game-day measurements.", 14, TEXT)
table(s, Inches(0.55), Inches(2.65), Inches(12.25), [
 ["Scenario", "Pass criteria"],
 ["1 Baseline scale-up", "node in 60–120 s band; empty node removed after emptyNodesDelay"],
 ["3 Spot interruption drill", "simulate-spot-interruption → drain label → PDBs hold → reschedule"],
 ["4 Prediction drill", "replacement node exists BEFORE interruption"],
 ["6 Subnet exhaustion", "documented event + node lands in next-least-allocated zone"],
 ["7 Evictor consolidation", "merge without PDB violations; immediate delete (TTL bypass confirmed)"],
 ["8 Rebalance round-trip", "achievedSavings ≥ threshold; zero drain-failed residue"],
 ["9 Hibernation round-trip", "Critical components validated clean; resume-node cleanup"],
 ["10 CLM migration", "MigrationFinished; freeze window measured; connections continuous"],
], col_w=[3.6, 8.6], fsize=11.5, hsize=12)

# =====================================================================
# 23 GAPS + SOURCES
# =====================================================================
s = prs.slides.add_slide(BLANK); chrome(s, "Known gaps & source base", kicker="Trust model")
card(s, Inches(0.55), Inches(1.45), Inches(5.95), Inches(4.6), "Documentation gaps [flagged, not invented]", [
 "· CAST AI fee in savings math (gross vs net)",
 "· Savings projection formulas unpublished",
 "· Empty-node TTL prose default vs API 300 s",
 "· Drain-fail uncordon: prose 3h vs API 1800 s",
 "· GPU-sharing support contradiction between",
 "   two docs pages (Bottlerocket vs AL2023)",
 "· Spot Handler is telemetry-ONLY (often mis-sold)",
 "· Changelog ends Sep 2026; Oct 2026 404 at fetch",
], tc=RED)
card(s, Inches(6.85), Inches(1.45), Inches(5.95), Inches(4.6), "Source base (all fetched 2026-10-17)", [
 "· ~95 docs pages via .md endpoints (HTTP 200)",
 "· 9 API reference pages (policies v2, evictor,",
 "   templates, configurations, rebalancing)",
 "· Changelog Aug 2025 → Sep 2026 monthly",
 "· Indexes: llms.txt + node-autoscaling +",
 "   monitoring-reporting + API llms.txt",
 "· GitHub: helm-charts · terraform-provider ·",
 "   privatelink-aws · audit-logs-receiver ·",
 "   hibernate · spot-drought simulator",
], tc=GREEN)

# =====================================================================
# 24 CLOSING
# =====================================================================
s = prs.slides.add_slide(BLANK)
bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SW, SH)
bg.fill.solid(); bg.fill.fore_color.rgb = NAVY; bg.line.fill.background(); bg.shadow.inherit = False
tb = _box(s, Inches(0.9), Inches(2.2), Inches(11.5), Inches(1.2))
p = _para(tb.text_frame, True); _run(p, "Start on Balanced. Prove it. Then optimize.", 36, WHITE, bold=True)
tb = _box(s, Inches(0.9), Inches(3.6), Inches(11.5), Inches(2.2))
for i, ln in enumerate([
    "1 · Read-only + Cloud Connect → Efficiency report baseline",
    "2 · Balanced profile → Evictor dry-run week → activate",
    "3 · Spot with prediction + PDBs → simulated interruption game day",
    "4 · Weekly graceful rebalancing with savings gates → commitments in top tier",
]):
    p = tb.text_frame.paragraphs[0] if i == 0 else tb.text_frame.add_paragraph()
    p.space_after = Pt(6)
    _run(p, ln, 16, RGBColor(0xBD, 0xE8, 0xEA))
tb = _box(s, Inches(0.9), Inches(6.3), Inches(11.5), Inches(0.6))
p = _para(tb.text_frame, True)
_run(p, "Source: cast-ai-node-autoscaler-handbook.md (1,828 lines) · docs.cast.ai snapshot 2026-10-17", 12, MIDGREY)

OUT = "/Users/eramadan/gitwork/iac/cast-ai-node-autoscaler-handbook.pptx"
prs.save(OUT)
print(f"saved {OUT} with {len(prs.slides.__iter__.__self__._sldIdLst)} slides")
