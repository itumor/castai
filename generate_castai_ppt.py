from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)


def add_title_slide(prs, title, subtitle):
    slide_layout = prs.slide_layouts[6]  # blank
    slide = prs.slides.add_slide(slide_layout)

    # Siemens dark blue bar at top
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), prs.slide_width, Inches(1.1))
    bar.fill.solid()
    bar.fill.fore_color.rgb = RGBColor(0x00, 0x96, 0xCF)
    bar.line.fill.background()

    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.6), Inches(12.3), Inches(1.2))
    tf = title_box.text_frame
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0x00, 0x33, 0x66)

    sub_box = slide.shapes.add_textbox(Inches(0.5), Inches(3.0), Inches(12.3), Inches(0.8))
    tf2 = sub_box.text_frame
    p2 = tf2.paragraphs[0]
    p2.text = subtitle
    p2.font.size = Pt(24)
    p2.font.color.rgb = RGBColor(0x00, 0x96, 0xCF)

    footer = slide.shapes.add_textbox(Inches(0.5), Inches(6.9), Inches(12.3), Inches(0.4))
    tf3 = footer.text_frame
    p3 = tf3.paragraphs[0]
    p3.text = "Unrestricted | © Siemens 2026 | <Owner> | Public Cloud Enablement"
    p3.font.size = Pt(10)
    p3.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    page = slide.shapes.add_textbox(Inches(12.3), Inches(6.9), Inches(0.5), Inches(0.4))
    tf4 = page.text_frame
    p4 = tf4.paragraphs[0]
    p4.text = "1"
    p4.font.size = Pt(10)
    p4.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    return slide


def add_section_header(slide, text):
    box = slide.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(12.3), Inches(0.8))
    tf = box.text_frame
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(28)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0x00, 0x33, 0x66)


def add_footer(slide, page_num):
    footer = slide.shapes.add_textbox(Inches(0.5), Inches(6.9), Inches(12.3), Inches(0.4))
    tf = footer.text_frame
    p = tf.paragraphs[0]
    p.text = "Unrestricted | © Siemens 2026 | <Owner> | Public Cloud Enablement"
    p.font.size = Pt(10)
    p.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    page = slide.shapes.add_textbox(Inches(12.3), Inches(6.9), Inches(0.5), Inches(0.4))
    tf4 = page.text_frame
    p4 = tf4.paragraphs[0]
    p4.text = str(page_num)
    p4.font.size = Pt(10)
    p4.font.color.rgb = RGBColor(0x66, 0x66, 0x66)


def add_bullet_box(slide, left, top, width, height, title, bullets, title_color=RGBColor(0x00, 0x96, 0xCF)):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = title_color
    for b in bullets:
        bp = tf.add_paragraph()
        bp.text = b
        bp.level = 0
        bp.font.size = Pt(14)
        bp.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
        bp.space_after = Pt(8)
    return box


# Slide 1: Title
add_title_slide(prs, "Cast AI Adoption", "Cast AI compared to Karpenter\nAMI Updates")

# Slide 2: Karpenter vs Cast AI
slide2 = prs.slides.add_slide(prs.slide_layouts[6])
add_section_header(slide2, "Comparison between Karpenter & Cast AI")
add_footer(slide2, 2)

add_bullet_box(
    slide2,
    Inches(0.5), Inches(1.4), Inches(6.0), Inches(2.2),
    "Optimization Strategy of Karpenter:",
    [
        "Karpenter optimizes provisioned infrastructure through node auto-scaling.",
        "CPU and memory are scaled automatically based on workload demand.",
        "Savings come from reducing over-provisioned infrastructure."
    ],
    title_color=RGBColor(0x00, 0x33, 0x66)
)

add_bullet_box(
    slide2,
    Inches(6.8), Inches(1.4), Inches(6.0), Inches(2.2),
    "Optimization Strategy of Cast AI:",
    [
        "Cast AI optimizes both infrastructure and workloads.",
        "Node auto-scaling: CPU and memory are scaled automatically.",
        "Workload rightsizing: container resource requests are tuned to actual usage.",
        "Right-sized workloads reduce required node capacity and cost further."
    ],
    title_color=RGBColor(0x00, 0x96, 0xCF)
)

# Benchmark banner
banner = slide2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(3.85), Inches(12.3), Inches(0.9))
banner.fill.solid()
banner.fill.fore_color.rgb = RGBColor(0xE6, 0xF4, 0xFA)
banner.line.color.rgb = RGBColor(0x00, 0x96, 0xCF)
tf = banner.text_frame
tf.paragraphs[0].text = "Benchmark: Replacing Karpenter with the full CAST AI Autoscaler delivered up to 43% realized savings on comparable workloads."
tf.paragraphs[0].font.size = Pt(16)
tf.paragraphs[0].font.bold = True
tf.paragraphs[0].font.color.rgb = RGBColor(0x00, 0x33, 0x66)

add_bullet_box(
    slide2,
    Inches(0.5), Inches(4.95), Inches(12.3), Inches(1.6),
    "Additional capabilities with the full CAST AI Autoscaler:",
    [
        "Predictive Spot instance reliability with automated fallback",
        "Topology Spread Constraints and PDB-aware rebalancing",
        "Commitment-aware instance selection (Reserved Instances / Savings Plans)",
        "Partnership support and Hypercare from CAST AI"
    ],
    title_color=RGBColor(0x00, 0x33, 0x66)
)

# Slide 3: AMI Updates
slide3 = prs.slides.add_slide(prs.slide_layouts[6])
add_section_header(slide3, "How Cast AI handles AMI Updates")
add_footer(slide3, 3)

add_bullet_box(
    slide3,
    Inches(0.5), Inches(1.3), Inches(12.3), Inches(1.4),
    "Automated rolling AMI replacement:",
    [
        "Cast AI keeps EKS worker nodes on the latest approved image.",
        "When a newer approved AMI is available, nodes are replaced (not patched in place).",
        "Replacement follows a disruption-aware rolling process, similar to rebalancing.",
        "Designed to minimize disruption when workloads follow Kubernetes best practices."
    ],
    title_color=RGBColor(0x00, 0x33, 0x66)
)

models_title = slide3.shapes.add_textbox(Inches(0.5), Inches(2.85), Inches(12.3), Inches(0.5))
tf = models_title.text_frame
tf.paragraphs[0].text = "AMI Selection Models — choose the right level of control:"
tf.paragraphs[0].font.size = Pt(16)
tf.paragraphs[0].font.bold = True
tf.paragraphs[0].font.color.rgb = RGBColor(0x00, 0x33, 0x66)

models = [
    ("1. Fully Automatic", ["Cast AI selects the latest compatible AWS image.", "Lowest effort; fastest security patch adoption."]),
    ("2. Controlled Pattern", ["Teams define the approved image family.", "Cast AI picks the newest match within guardrails."]),
    ("3. Pinned AMI", ["Teams define one specific image.", "Maximum control; updates remain the team's responsibility."]),
    ("4. Customer / Hardened AMIs", ["Teams provide a custom image or image selector.", "Cast AI uses the selected image for node provisioning."]),
]

for i, (title, bullets) in enumerate(models):
    col = i % 2
    row = i // 2
    left = Inches(0.5 + col * 6.3)
    top = Inches(3.4 + row * 1.55)
    add_bullet_box(slide3, left, top, Inches(6.0), Inches(1.35), title, bullets, title_color=RGBColor(0x00, 0x96, 0xCF))

prs.save("CastAI_FT_DISW_Information_Corrected.pptx")
print("Created CastAI_FT_DISW_Information_Corrected.pptx")
