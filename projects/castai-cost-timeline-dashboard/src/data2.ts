// Data layer — dataset2.json (inventory-driven, multi-method).

export interface MethodMeta {
  p?: number;
  pCpu?: number;
  pMem?: number;
  cOther?: number;
  window?: [string, string];
  days?: number;
  kappa0?: number | null;
  o0?: number | null;
  oCpu?: number;
  oMem?: number;
  uCpu?: number;
  uMem?: number;
  castOCpu?: number;
  castOMem?: number;
  note?: string;
  a?: number; b?: number; c?: number; r2?: number; corr?: number;
}

export interface MonthMethod {
  adjusted: number | null;
  gross: number;
  fee: number;
  net: number;
}

export interface MonthM4 {
  woopDemand: number;
  nodePacking: number;
  priceEffect: number;
  gross: number;
  net: number;
}

export interface MonthRow2 {
  month: string;
  days: number;
  daysInMonth: number;
  partial: boolean;
  idle: boolean;
  estimated: boolean;
  fromOrgReport: boolean;
  actualCost: number;
  avgVcpu: number;
  avgRamGib: number;
  feesUsd: number;
  M0: MonthMethod | null;
  M1: MonthMethod | null;
  TR: MonthMethod | null;
  TR30D: MonthMethod | null;
  WMAX: MonthMethod | null;
  TRW: MonthMethod | null;
  REQ: MonthMethod | null;
  M2: MonthMethod | null;
  M4: MonthM4 | null;
  castRealizedSavings: number | null;
  er: number | null;
  flags: string[];
}

export interface EventRow2 {
  date: string;
  type: string;
  clusterId: string;
  title: string;
  details: Record<string, unknown>;
}

export interface Baseline2 {
  from: string;
  to: string;
  days: number;
  pUsdPerVcpuDay: number;
  pCpuUsdPerVcpuDay: number;
  pMemUsdPerGibDay: number;
  cOtherUsdPerDay: number;
  unitPriceCV: number | null;
  ciHalfwidthPct: number | null;
  m2: { a: number; b: number; c: number; r2: number; corr: number } | null;
  gapToSwitchDays: number | null;
  flags: string[];
}

export interface Last30 {
  from: string;
  to: string;
  days: number;
  baseline: number;
  actual: number;
  gross: number;
  fee: number;
  net: number;
}

export function mergeLast30(clusters: ClusterRec[]): { wmax: Last30 | null; req: Last30 | null; nW: number; nR: number } {
  const ws = clusters.map((c) => c.last30?.WMAX).filter((x): x is Last30 => !!x);
  const rs = clusters.map((c) => c.last30?.REQ).filter((x): x is Last30 => !!x);
  const agg = (xs: Last30[]): Last30 | null =>
    xs.length
      ? [{ from: xs.map((x) => x.from).sort()[0], to: xs.map((x) => x.to).sort().slice(-1)[0],
           days: Math.max(...xs.map((x) => x.days)),
           baseline: xs.reduce((a, x) => a + x.baseline, 0), actual: xs.reduce((a, x) => a + x.actual, 0),
           gross: xs.reduce((a, x) => a + x.gross, 0), fee: xs.reduce((a, x) => a + x.fee, 0),
           net: xs.reduce((a, x) => a + x.net, 0) }][0]
      : null;
  return { wmax: agg(ws), req: agg(rs), nW: ws.length, nR: rs.length };
}

export interface ClusterRec {
  clusterId: string;
  name: string;
  orgId: string;
  orgName: string;
  parentOrgId: string | null;
  tier: "A" | "B";
  isPhase2: boolean | null;
  status: string | null;
  agentStatus: string | null;
  createdAt: string | null;
  switchDate: string | null;
  switchSource: string | null;
  baseline: Baseline2 | null;
  methodsMeta: Record<string, MethodMeta>;
  policies: { enabled: boolean | null; spotEnabled: boolean | null; isScopedMode: boolean | null } | null;
  woop: {
    installedAt: string | null;
    currentVersion: string | null;
    optimizedWorkloads: number;
    totalWorkloads: number;
    requestedPerHour: number;
    recommendedPerHour: number;
  } | null;
  castBaselineParams: { periodStart: string | null; periodEnd: string | null; baselineType: string | null };
  last30: { WMAX: Last30 | null; REQ: Last30 | null };
  timelineFile: string | null;
  monthly: MonthRow2[];
  events: EventRow2[];
  flags: string[];
}

export interface DayRow2 {
  date: string;
  actualCost: number;
  vcpu: number;
  ramGib: number;
  cpuCost: number;
  memCost: number;
  castActual: number | null;
  castProjected: number | null;
  castTotalSavings: number | null;
  castAutoscalerSavings: number | null;
  castWoopSavings: number | null;
  reqCpu: number;
  origReqCpu: number;
  usedCpu: number;
  source: string;
  idle: boolean;
  adjM1: number | null;
  adjTR: number | null;
  adjTR30D: number | null;
  adjM2: number | null;
  wmaxBaseline: number | null;
  wmax: { refCpu: number; refMem: number; oCpu: number; oMem: number; pCpuUsed: number; pMemUsed: number; hours: number } | null;
  adjTRW: number | null;
  trw: { vRef: number; mRef: number; refCpu: number; refMem: number; floorCpu: boolean; floorMem: boolean } | null;
  adjREQ: number | null;
  reqActualCompute: number | null;
  reqD: { cpu: number; mem: number; uCpu: number; uMem: number } | null;
  grossM0: number | null;
  unitPrice: number | null;
  tr30dSplit: { cpu: number; mem: number; other: number; windowDays: number } | null;
  layers: { woopDemand: number; nodePacking: number; priceEffect: number; organicDemandVcpu: number } | null;
}

export interface OrgRec {
  id: string;
  name: string;
  parentId: string | null;
}

export interface MethodCatalogEntry {
  id: string;
  tier: number;
  default?: boolean;
  name: string;
  formula: string;
  note: string;
}

export interface Dataset2 {
  generatedAt: string;
  fee: {
    model: string;
    eurPerVcpuMonth: number;
    fxUsdPerEur: number;
    usdPerVcpuMonth: number;
    note: string;
  };
  reconcileTolerance: number;
  methodsCatalog: MethodCatalogEntry[];
  orgs: OrgRec[];
  clusters: ClusterRec[];
}

export async function loadDataset2(): Promise<Dataset2> {
  const res = await fetch("/data/dataset2.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`dataset2 fetch failed: ${res.status}`);
  return (await res.json()) as Dataset2;
}

// ---- lazy per-cluster timeline cache ------------------------------------
const tsCache = new Map<string, Promise<DayRow2[]>>();
export function loadTimeline(clusterId: string): Promise<DayRow2[]> {
  let p = tsCache.get(clusterId);
  if (!p) {
    p = fetch(`/data/ts/${clusterId}.json`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : { timeline: [] }))
      .then((d) => (d.timeline ?? []) as DayRow2[]);
    tsCache.set(clusterId, p);
  }
  return p;
}

export const fmtUsd = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtSigned = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${v < 0 ? "−" : "+"}${fmtUsd(Math.abs(v), digits)}`;

export const sumN = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

/** Merge monthly rows across clusters → one row per month per method sum. */
export interface MergedMonth {
  month: string;
  actual: number;
  M0: number | null; M1: number | null; TR: number | null; TR30D: number | null; WMAX: number | null; TRW: number | null; REQ: number | null; M2: number | null; M4: number | null;
  M1net: number | null; TRnet: number | null; TR30Dnet: number | null; WMAXnet: number | null; TRWnet: number | null; REQnet: number | null; M0net: number | null; M2net: number | null;
  M1adj: number | null; cast: number | null;
  clusters: number;
  flags: Set<string>;
}

export function mergeMonths(scope: ClusterRec[]): MergedMonth[] {
  const byMonth = new Map<string, MergedMonth>();
  for (const c of scope) {
    for (const m of c.monthly) {
      let e = byMonth.get(m.month);
      if (!e) {
        e = {
          month: m.month, actual: 0, M0: null, M1: null, TR: null, TR30D: null, WMAX: null, TRW: null, REQ: null, M2: null, M4: null,
          M1net: null, TRnet: null, TR30Dnet: null, WMAXnet: null, TRWnet: null, REQnet: null, M0net: null, M2net: null, M1adj: null, cast: null,
          clusters: 0, flags: new Set(),
        };
        byMonth.set(m.month, e);
      }
      const add = (cur: number | null, v: number | null | undefined) =>
        v === null || v === undefined ? cur : (cur ?? 0) + v;
      e.actual += m.actualCost;
      e.clusters += m.days > 0 || m.actualCost > 0 ? 1 : 0;
      e.M0 = add(e.M0, m.M0?.gross); e.M0net = add(e.M0net, m.M0?.net);
      e.M1 = add(e.M1, m.M1?.gross); e.M1net = add(e.M1net, m.M1?.net);
      e.TR = add(e.TR, m.TR?.gross); e.TRnet = add(e.TRnet, m.TR?.net);
      e.TR30D = add(e.TR30D, m.TR30D?.gross); e.TR30Dnet = add(e.TR30Dnet, m.TR30D?.net);
      e.WMAX = add(e.WMAX, m.WMAX?.gross); e.WMAXnet = add(e.WMAXnet, m.WMAX?.net);
      e.TRW = add(e.TRW, m.TRW?.gross); e.TRWnet = add(e.TRWnet, m.TRW?.net);
      e.REQ = add(e.REQ, m.REQ?.gross); e.REQnet = add(e.REQnet, m.REQ?.net);
      e.M2 = add(e.M2, m.M2?.gross); e.M2net = add(e.M2net, m.M2?.net);
      e.M4 = add(e.M4, m.M4?.gross);
      e.M1adj = add(e.M1adj, m.M1?.adjusted);
      e.cast = add(e.cast, m.castRealizedSavings);
      m.flags.forEach((f) => e.flags.add(f));
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Merge daily timelines (already fetched) per method. */
export interface MergedDay {
  date: string;
  actual: number;
  M0: number | null; M1: number | null; TR: number | null; TR30D: number | null; WMAX: number | null; TRW: number | null; REQ: number | null; M2: number | null;
  adjM1: number | null; adjTR: number | null; adjTR30D: number | null; adjM2: number | null; adjWmax: number | null; adjTRW: number | null; adjREQ: number | null;
  reqCompute: number | null;
  cast: number | null; castProjected: number | null;
  vcpu: number; reqCpu: number; usedCpu: number;
  lw: number | null; ln: number | null; lp: number | null;
}

export function mergeDays(timelines: DayRow2[][]): MergedDay[] {
  const byDate = new Map<string, MergedDay>();
  for (const tl of timelines) {
    for (const r of tl) {
      let e = byDate.get(r.date);
      if (!e) {
        e = { date: r.date, actual: 0, M0: null, M1: null, TR: null, TR30D: null, WMAX: null, TRW: null, REQ: null, M2: null, adjM1: null, adjTR: null, adjTR30D: null, adjM2: null, adjWmax: null, adjTRW: null, adjREQ: null, reqCompute: null,
              cast: null, castProjected: null, vcpu: 0, reqCpu: 0, usedCpu: 0,
              lw: null, ln: null, lp: null };
        byDate.set(r.date, e);
      }
      const add = (cur: number | null, v: number | null | undefined) =>
        v === null || v === undefined ? cur : (cur ?? 0) + v;
      e.actual += r.actualCost;
      e.vcpu += r.vcpu;
      e.reqCpu += r.reqCpu;
      e.usedCpu += r.usedCpu;
      e.lw = add(e.lw, r.layers?.woopDemand ?? undefined);
      e.ln = add(e.ln, r.layers?.nodePacking ?? undefined);
      e.lp = add(e.lp, r.layers?.priceEffect ?? undefined);
      e.M0 = add(e.M0, r.grossM0);
      e.M1 = add(e.M1, r.adjM1 !== null ? r.adjM1 - r.actualCost : null);
      e.TR = add(e.TR, r.adjTR !== null ? r.adjTR - r.actualCost : null);
      e.TR30D = add(e.TR30D, r.adjTR30D !== null ? r.adjTR30D - r.actualCost : null);
      e.WMAX = add(e.WMAX, r.wmaxBaseline !== null ? r.wmaxBaseline - r.actualCost : null);
      e.TRW = add(e.TRW, r.adjTRW !== null ? r.adjTRW - r.actualCost : null);
      e.REQ = add(e.REQ, r.adjREQ !== null && r.reqActualCompute !== null ? r.adjREQ - r.reqActualCompute : null);
      e.M2 = add(e.M2, r.adjM2 !== null ? r.adjM2 - r.actualCost : null);
      e.adjM1 = add(e.adjM1, r.adjM1);
      e.adjTR = add(e.adjTR, r.adjTR);
      e.adjTR30D = add(e.adjTR30D, r.adjTR30D);
      e.adjM2 = add(e.adjM2, r.adjM2);
      e.adjWmax = add(e.adjWmax, r.wmaxBaseline);
      e.adjTRW = add(e.adjTRW, r.adjTRW);
      e.adjREQ = add(e.adjREQ, r.adjREQ);
      e.reqCompute = add(e.reqCompute, r.reqActualCompute);
      e.cast = add(e.cast, r.castTotalSavings);
      e.castProjected = add(e.castProjected, r.castProjected);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
