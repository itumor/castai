import { useMemo, useState } from "react";
import type { ClusterRec } from "../data2";
import { fmtSigned, fmtUsd } from "../data2";

interface FlatRow {
  month: string;
  orgName: string;
  cluster: string;
  tier: string;
  days: number;
  actual: number;
  avgVcpu: number;
  M0: number | null;
  M1: number | null;
  M1adj: number | null;
  TR: number | null;
  TR30D: number | null;
  WMAX: number | null;
  TRW: number | null;
  REQ: number | null;
  M2: number | null;
  M4: number | null;
  cast: number | null;
  flags: string[];
  idle: boolean;
  estimated: boolean;
}

const num = (v: number | null | undefined) => (v ?? 0);

export default function MonthlyLedger({ scope }: { scope: ClusterRec[] }) {
  const [sortKey, setSortKey] = useState<"month" | "cluster" | "actual" | "M1">("month");
  const [dir, setDir] = useState<-1 | 1>(-1);

  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const c of scope)
      for (const m of c.monthly)
        out.push({
          month: m.month, orgName: c.orgName, cluster: c.name, tier: c.tier,
          days: m.days, actual: m.actualCost, avgVcpu: m.avgVcpu,
          M0: m.M0 ? m.M0.gross : null, M1: m.M1 ? m.M1.gross : null, M1adj: m.M1 ? m.M1.adjusted : null,
          TR: m.TR ? m.TR.gross : null, TR30D: m.TR30D ? m.TR30D.gross : null, WMAX: m.WMAX ? m.WMAX.gross : null, TRW: m.TRW ? m.TRW.gross : null, REQ: m.REQ ? m.REQ.gross : null, M2: m.M2 ? m.M2.gross : null, M4: m.M4 ? m.M4.gross : null,
          cast: m.castRealizedSavings, flags: m.flags, idle: m.idle, estimated: m.estimated,
        });
    return out.sort((a, b) => {
      const k = sortKey;
      const va = k === "month" || k === "cluster" ? String(a[k]) : num(a[k] as number | null);
      const vb = k === "month" || k === "cluster" ? String(b[k]) : num(b[k] as number | null);
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
  }, [scope, sortKey, dir]);

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({
      actual: t.actual + r.actual,
      M0: t.M0 + num(r.M0), M1: t.M1 + num(r.M1), TR: t.TR + num(r.TR),
      TR30D: t.TR30D + num(r.TR30D), WMAX: t.WMAX + num(r.WMAX), TRW: t.TRW + num(r.TRW), REQ: t.REQ + num(r.REQ), M2: t.M2 + num(r.M2), M4: t.M4 + num(r.M4), cast: t.cast + num(r.cast),
    }),
    { actual: 0, M0: 0, M1: 0, TR: 0, TR30D: 0, WMAX: 0, TRW: 0, REQ: 0, M2: 0, M4: 0, cast: 0 },
  ), [rows]);

  const sort = (k: typeof sortKey) => { setDir(k === sortKey ? (dir === 1 ? -1 : 1) : 1); setSortKey(k); };
  const sgn = (k: typeof sortKey) => (sortKey === k ? (dir === 1 ? " ▲" : " ▼") : "");
  const tone = (v: number | null) => (v === null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th onClick={() => sort("month")}>month{sgn("month")}</th>
            <th>org</th>
            <th onClick={() => sort("cluster")}>cluster{sgn("cluster")}</th>
            <th>tier</th>
            <th>days</th>
            <th onClick={() => sort("actual")}>actual{sgn("actual")}</th>
            <th>avg vCPU</th>
            <th className="m0">M0 gross</th>
            <th className="m1" onClick={() => sort("M1")}>M1 gross{sgn("M1")}</th>
            <th className="m1adj">M1 baseline</th>
            <th className="tr" title="operational standard — default method">TR gross ★</th>
            <th className="tr30d" title="rolling 30-day baseline — short-horizon pulse, not cumulative savings">TR30D</th>
            <th className="wmax" title="WA-aware counterfactual: max(orig,cur) × frozen O × max(base,current price), per WOOP hour">WMAX</th>
            <th className="trw" title="TR + WA demand floor: V_ref = max(provisioned, O×max(orig,cur)) — best of TR and WMAX">TRW</th>
            <th className="req" title="Siemens C/D demand-unit: u_cpu×max(orig,cur) + u_mem×max(orig,cur) vs actual compute — docs 05/06">REQ</th>
            <th className="m2">M2 gross</th>
            <th className="m4">M4 Σ</th>
            <th className="cast">CAST</th>
            <th>flags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.estimated ? "est" : r.idle ? "idle" : ""}>
              <td className="mono">{r.month}</td>
              <td className="org">{r.orgName}</td>
              <td className="cluster">{r.cluster}</td>
              <td><span className={`tier tier-${r.tier.toLowerCase()}`}>{r.tier}</span></td>
              <td className="mono muted">{r.days}{r.idle ? " ·idle" : ""}</td>
              <td className="mono">{fmtUsd(r.actual)}</td>
              <td className="mono muted">{r.avgVcpu.toFixed(0)}</td>
              <td className={`mono ${tone(r.M0)}`}>{fmtSigned(r.M0)}</td>
              <td className={`mono ${tone(r.M1)}`}>{fmtSigned(r.M1)}</td>
              <td className="mono muted">{r.M1adj === null ? "—" : fmtUsd(r.M1adj)}</td>
              <td className={`mono ${tone(r.TR)}`}>{fmtSigned(r.TR)}</td>
              <td className={`mono ${tone(r.TR30D)}`}>{fmtSigned(r.TR30D)}</td>
              <td className={`mono ${tone(r.WMAX)}`}>{fmtSigned(r.WMAX)}</td>
              <td className={`mono ${tone(r.TRW)}`}>{fmtSigned(r.TRW)}</td>
              <td className={`mono ${tone(r.REQ)}`}>{fmtSigned(r.REQ)}</td>
              <td className={`mono ${tone(r.M2)}`}>{fmtSigned(r.M2)}</td>
              <td className={`mono ${tone(r.M4)}`}>{fmtSigned(r.M4)}</td>
              <td className={`mono ${tone(r.cast)}`}>{fmtSigned(r.cast)}</td>
              <td className="flags">{r.flags.map((f) => <span key={f} className="flagchip">{f}</span>)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Σ {rows.length} cluster-months</td>
            <td className="mono">{fmtUsd(totals.actual)}</td>
            <td />
            <td className={`mono ${tone(totals.M0)}`}>{fmtSigned(totals.M0)}</td>
            <td className={`mono ${tone(totals.M1)}`}>{fmtSigned(totals.M1)}</td>
            <td />
            <td className={`mono ${tone(totals.TR)}`}>{fmtSigned(totals.TR)}</td>
            <td className={`mono ${tone(totals.TR30D)}`}>{fmtSigned(totals.TR30D)}</td>
            <td className={`mono ${tone(totals.WMAX)}`}>{fmtSigned(totals.WMAX)}</td>
            <td className={`mono ${tone(totals.TRW)}`}>{fmtSigned(totals.TRW)}</td>
            <td className={`mono ${tone(totals.REQ)}`}>{fmtSigned(totals.REQ)}</td>
            <td className={`mono ${tone(totals.M2)}`}>{fmtSigned(totals.M2)}</td>
            <td className={`mono ${tone(totals.M4)}`}>{fmtSigned(totals.M4)}</td>
            <td className={`mono ${tone(totals.cast)}`}>{fmtSigned(totals.cast)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
