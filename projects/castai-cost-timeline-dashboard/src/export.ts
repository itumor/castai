// CSV + multi-sheet XLSX export — every calculation method side by side.
import * as XLSX from "xlsx";
import type { ClusterRec, Dataset2, DayRow2, MonthRow2 } from "./data2";

type Row = Array<string | number | null>;

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name: string, content: string | Blob) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const MONTH_HEADER = "month,org,cluster,cluster_id,tier,days,daysInMonth,idle,estimated,actual_usd,avg_vcpu,fee_usd,"
  + "M0_gross,M0_net,M1_adjusted,M1_gross,M1_fee,M1_net,TR_adjusted,TR_gross,TR_fee,TR_net,"
  + "TR30D_adjusted,TR30D_gross,TR30D_net,WMAX_adjusted,WMAX_gross,WMAX_net,TRW_adjusted,TRW_gross,TRW_net,REQ_adjusted,REQ_gross,REQ_net,M2_adjusted,M2_gross,M2_net,M4_demand_W,M4_packing_N,M4_price_P,M4_gross,M4_net,"
  + "cast_realized,cast_minus_M1,flags";

function monthRow(c: ClusterRec, m: MonthRow2): Row {
  const g = (mm: { gross: number } | null) => (mm ? mm.gross : null);
  const n = (mm: { net: number } | null) => (mm ? mm.net : null);
  const a = (mm: { adjusted: number | null } | null) => (mm ? mm.adjusted : null);
  return [
    m.month, c.orgName, c.name, c.clusterId, c.tier, m.days, m.daysInMonth,
    m.idle ? 1 : 0, m.estimated ? 1 : 0, m.actualCost, m.avgVcpu, m.feesUsd,
    g(m.M0), n(m.M0), a(m.M1), g(m.M1), m.M1 ? m.M1.fee : null, n(m.M1),
    a(m.TR), g(m.TR), m.TR ? m.TR.fee : null, n(m.TR),
    a(m.TR30D), g(m.TR30D), n(m.TR30D),
    a(m.WMAX), g(m.WMAX), n(m.WMAX),
    a(m.TRW), g(m.TRW), n(m.TRW),
    a(m.REQ), g(m.REQ), n(m.REQ),
    a(m.M2), g(m.M2), n(m.M2),
    m.M4 ? m.M4.woopDemand : null, m.M4 ? m.M4.nodePacking : null,
    m.M4 ? m.M4.priceEffect : null, m.M4 ? m.M4.gross : null, m.M4 ? m.M4.net : null,
    m.castRealizedSavings,
    m.M1 && m.castRealizedSavings !== null ? +(m.castRealizedSavings - m.M1.gross).toFixed(2) : null,
    m.flags.join("|"),
  ];
}

const DAY_HEADER = "date,org,cluster,cluster_id,source,idle,actual_usd,vcpu_provisioned,ram_gib,"
  + "req_vcpu,orig_req_vcpu,used_vcpu,unit_price_usd_per_vcday,"
  + "M1_adjusted,M1_gross,TR_adjusted,TR_gross,TR30D_day_baseline,TR30D_gross,WMAX_baseline,WMAX_gross,TRW_adjusted,TRW_gross,REQ_adjusted,REQ_gross_vs_compute,M2_adjusted,M2_gross,M0_gross_flat,"
  + "LW_demand,LN_packing,LP_price,organic_demand_vcpu,"
  + "cast_projected,cast_realized_savings,cast_autoscaler_savings,cast_woop_savings";

function dayRow(c: ClusterRec, r: DayRow2): Row {
  return [
    r.date, c.orgName, c.name, c.clusterId, r.source, r.idle ? 1 : 0, r.actualCost, r.vcpu, r.ramGib,
    r.reqCpu, r.origReqCpu, r.usedCpu, r.unitPrice,
    r.adjM1, r.adjM1 !== null ? +(r.adjM1 - r.actualCost).toFixed(4) : null,
    r.adjTR, r.adjTR !== null ? +(r.adjTR - r.actualCost).toFixed(4) : null,
    r.adjTR30D, r.adjTR30D !== null ? +(r.adjTR30D - r.actualCost).toFixed(4) : null,
    r.wmaxBaseline, r.wmaxBaseline !== null ? +(r.wmaxBaseline - r.actualCost).toFixed(4) : null,
    r.adjTRW, r.adjTRW !== null ? +(r.adjTRW - r.actualCost).toFixed(4) : null,
    r.adjREQ, (r.adjREQ !== null && r.reqActualCompute !== null) ? +(r.adjREQ - r.reqActualCompute).toFixed(4) : null,
    r.adjM2, r.adjM2 !== null ? +(r.adjM2 - r.actualCost).toFixed(4) : null,
    r.grossM0,
    r.layers?.woopDemand ?? null, r.layers?.nodePacking ?? null, r.layers?.priceEffect ?? null,
    r.layers?.organicDemandVcpu ?? null,
    r.castProjected, r.castTotalSavings, r.castAutoscalerSavings, r.castWoopSavings,
  ];
}

const PARAM_HEADER = "cluster,org,switch_date,switch_source,baseline_from,baseline_to,baseline_days,"
  + "p_usd_per_vcpu_day,p_cpu_usd_per_vcpu_day,p_mem_usd_per_gib_day,c_other_usd_per_day,"
  + "unit_price_cv,ci_halfwidth_pct,m2_a,m2_b,m2_c,m2_r2,kappa0,o0,policy_enabled,spot_enabled,woop_installed,baseline_flags";

function paramRow(c: ClusterRec): Row {
  const b = c.baseline;
  const m4 = c.methodsMeta.M4 ?? {};
  const m2 = b?.m2;
  return [
    c.name, c.orgName, c.switchDate, c.switchSource,
    b?.from ?? null, b?.to ?? null, b?.days ?? null,
    b?.pUsdPerVcpuDay ?? null, b?.pCpuUsdPerVcpuDay ?? null, b?.pMemUsdPerGibDay ?? null,
    b?.cOtherUsdPerDay ?? null, b?.unitPriceCV ?? null, b?.ciHalfwidthPct ?? null,
    m2?.a ?? null, m2?.b ?? null, m2?.c ?? null, m2?.r2 ?? null,
    m4.kappa0 ?? null, m4.o0 ?? null,
    c.policies?.enabled === null || c.policies?.enabled === undefined ? null : c.policies.enabled ? 1 : 0,
    c.policies?.spotEnabled === null || c.policies?.spotEnabled === undefined ? null : c.policies.spotEnabled ? 1 : 0,
    c.woop?.installedAt ?? null, (b?.flags ?? []).join("|"),
  ];
}

export function exportCsv(scope: ClusterRec[], timelines: Map<string, DayRow2[]>) {
  const lines: string[] = [
    "# Cost Atlas export — all calculation methods side by side",
    "# Fee model: €5 per provisioned vCPU-month × frozen FX 1.10 $/€, prorated by telemetried days; net = gross − fee (fee also on negative-gross months)",
    "# Methods: M0 naive flat-demand · M1 frozen vCPU price · TR frozen CPU+RAM ★default · TR30D rolling 30-day baseline · WMAX WA-aware counterfactual · TRW = TR ✚ WA demand floor (best of both) · REQ demand-unit counterfactual (Siemens proposal + TAM cost-per-requested-CPU framework) · M2 OLS (gated) · M4 3-layer WOOP attribution · CAST = CAST AI realized reference (never blended)",
    "",
    "## PARAMETERS (frozen baselines per cluster)",
    PARAM_HEADER,
    ...scope.map((c) => paramRow(c).map(csvEscape).join(",")),
    "",
    "## MONTHLY LEDGER (cluster x month)",
    MONTH_HEADER,
    ...scope.flatMap((c) => c.monthly.map((m) => monthRow(c, m).map(csvEscape).join(","))),
    "",
    "## DAILY TIMELINE (where telemetried)",
    DAY_HEADER,
  ];
  for (const c of scope) {
    const tl = timelines.get(c.clusterId) ?? [];
    for (const r of tl) lines.push(dayRow(c, r).map(csvEscape).join(","));
  }
  lines.push("", "## EVENTS (deep-tier clusters)", "date,org,cluster,type,title");
  for (const c of scope) for (const e of c.events) lines.push([e.date, c.orgName, c.name, e.type, e.title].map(csvEscape).join(","));
  download(`cost-atlas_export_${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n"));
}

export function exportXlsx(data: Dataset2, scope: ClusterRec[], timelines: Map<string, DayRow2[]>) {
  const wb = XLSX.utils.book_new();

  // 1) methods & provenance
  const readme: Row[] = [
    ["Cost Atlas export", ""],
    ["generated", data.generatedAt],
    ["scope", `${scope.length} clusters`],
    [],
    ["operational standard", "TR (frozen CPU+RAM prices) is the default method of calculation: dual-resource sensitivity, robust & deterministic, defensible & auditable — dispute-free vendor-independent counterfactual."],
    [],
    ["method id", "name", "formula", "note"],
    ...data.methodsCatalog.map((m) => [m.id, m.name, m.formula, m.note]),
    [],
    ["rule", "CAST AI realized and our methods use different counterfactuals & price vintages — shown side by side, never blended. ±30% reconciliation band flagged per month (CROSSCHECK_OUT_OF_BAND)."],
    ["fee model", "CAST AI subscription: €5 per provisioned vCPU-month (frozen FX 1€=$1.10), prorated by telemetried days; net = gross − fee; applies also on negative-gross months. CAST realized reference series untouched."],
    ["disclaimer", "Months with no telemetry are excluded from savings math, never silently interpolated. IDLE months = $0 inside authoritative org coverage."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "README-methods");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PARAM_HEADER.split(","), ...scope.map(paramRow)]), "parameters");

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([MONTH_HEADER.split(","), ...scope.flatMap((c) => c.monthly.map((m) => monthRow(c, m)))]),
    "monthly-all-methods",
  );

  const dayRows: Row[] = [DAY_HEADER.split(",")];
  for (const c of scope) {
    for (const r of timelines.get(c.clusterId) ?? []) dayRows.push(dayRow(c, r));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dayRows), "daily");

  const evRows: Row[] = [["date", "org", "cluster", "type", "title", "details"]];
  for (const c of scope) for (const e of c.events) evRows.push([e.date, c.orgName, c.name, e.type, e.title, JSON.stringify(e.details)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(evRows), "events");
  // last-30-days demand-side pulses
  const l30Cols = ["cluster", "org", "method", "window_from", "window_to", "days", "baseline_usd", "actual_usd", "gross_usd", "fee_usd", "net_usd"];
  const l30Rows: (string | number)[][] = [];
  for (const c of scope) {
    for (const [mth, blk] of [["WMAX", c.last30?.WMAX], ["REQ", c.last30?.REQ]] as const) {
      if (blk) l30Rows.push([c.name, c.orgName, mth, blk.from, blk.to, blk.days, blk.baseline, blk.actual, blk.gross, blk.fee, blk.net]);
    }
  }
  if (l30Rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([l30Cols, ...l30Rows]), "last30-wmax-req");

  XLSX.writeFile(wb, `cost-atlas_all-methods_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
