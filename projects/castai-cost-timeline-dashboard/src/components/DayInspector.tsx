import type { ClusterRec, DayRow2 } from "../data2";
import { fmtSigned, fmtUsd } from "../data2";

interface Props {
  date: string;
  scope: ClusterRec[];
  timelines: Map<string, DayRow2[]>;
  onClose: () => void;
}

const f = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? "—" : fmtUsd(v, d);

export default function DayInspector({ date, scope, timelines, onClose }: Props) {
  const rows: Array<{ c: ClusterRec; r: DayRow2 }> = [];
  for (const c of scope) {
    const r = (timelines.get(c.clusterId) ?? []).find((x) => x.date === date);
    if (r) rows.push({ c, r });
  }
  return (
    <div className="inspector-drawer">
      <div className="inspector-head">
        <div>
          <div className="inspector-date mono">{date}</div>
          <div className="inspector-sub">{rows.length} cluster{rows.length === 1 ? "" : "s"} with telemetry this day — every method shown with its own arithmetic</div>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      {rows.length === 0 && <p className="empty-note">No timeline rows on this date in the selected scope.</p>}
      {rows.map(({ c, r }) => {
        const g = (adj: number | null) => (adj === null ? null : +(adj - r.actualCost).toFixed(2));
        const L = r.layers;
        return (
          <div className="calc-card" key={c.clusterId}>
            <div className="calc-title">{c.orgName} · {c.name} <span className="muted mono">{r.source}</span></div>
            <div className="calc-grid">
              <div className="calc-row">
                <span className="calc-name">actual spend</span>
                <span className="calc-formula">Σ node hourly costs (cost-report / value-realization / org daily-cost)</span>
                <span className="calc-value mono">{f(r.actualCost)}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">provisioned / requests / used</span>
                <span className="calc-formula">vCPU provisioned · after-WOOP request cores · used cores</span>
                <span className="calc-value mono">{r.vcpu.toFixed(1)} · {r.reqCpu.toFixed(1)} · {r.usedCpu.toFixed(1)}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">M0 · naive flat demand</span>
                <span className="calc-formula">first-full-month daily avg − actual</span>
                <span className="calc-value mono">{fmtSigned(r.grossM0)}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">M1 · frozen vCPU price</span>
                <span className="calc-formula mono">p×V = {c.baseline ? `$${c.baseline.pUsdPerVcpuDay.toFixed(4)}` : "?"} × {r.vcpu.toFixed(1)} = {f(r.adjM1)} → gross</span>
                <span className="calc-value mono">{fmtSigned(g(r.adjM1))}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">TR · frozen CPU+RAM</span>
                <span className="calc-formula mono">{c.baseline ? `$${c.baseline.pCpuUsdPerVcpuDay.toFixed(4)}/vCPU + $${c.baseline.pMemUsdPerGibDay.toFixed(4)}/GiB + $${c.baseline.cOtherUsdPerDay.toFixed(1)}` : "?"} → {f(r.adjTR)} → gross</span>
                <span className="calc-value mono">{fmtSigned(g(r.adjTR))}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">TRW · TR + WA floor</span>
                <span className="calc-formula mono">{r.trw ? `V_ref=max(${r.vcpu.toFixed(1)}, ${c.methodsMeta.WMAX ? c.methodsMeta.WMAX.oCpu : c.methodsMeta.M4?.o0 ?? "?"}×${r.trw.refCpu.toFixed(1)})=${r.trw.vRef.toFixed(1)}${r.trw.floorCpu ? " ⬆floor" : ""} · M_ref=max(${r.ramGib.toFixed(0)}, O_mem×${r.trw.refMem.toFixed(0)})=${r.trw.mRef.toFixed(0)}${r.trw.floorMem ? " ⬆" : ""} → $${r.adjTRW!.toFixed(2)}` : (r.adjTRW !== null ? "= TR (no O factors on this cluster)" : "—")}</span>
                <span className="calc-value mono">{r.adjTRW === null ? "—" : fmtSigned(g(r.adjTRW))}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">REQ · demand-unit (docs 05/06)</span>
                <span className="calc-formula mono">{r.reqD ? `u_cpu=$${r.reqD.uCpu}/req-core·d × max(Rᵒʳⁱᵍ,Rᵖᵘʳ)=${r.reqD.cpu.toFixed(1)} + u_mem=$${r.reqD.uMem}/req-GiB·d × ${r.reqD.mem.toFixed(0)} → $${r.adjREQ!.toFixed(2)} vs compute $${r.reqActualCompute!.toFixed(2)}` : "no request telemetry or pre-switch day"}</span>
                <span className="calc-value mono">{r.adjREQ === null || r.reqActualCompute === null ? "—" : fmtSigned(r.adjREQ - r.reqActualCompute)}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">TR30D · rolling 30-day</span>
                <span className="calc-formula mono">{r.tr30dSplit ? `avg($${r.tr30dSplit.cpu} cpu + $${r.tr30dSplit.mem} ram + $${r.tr30dSplit.other} other)/day over ${r.tr30dSplit.windowDays}d → $${r.adjTR30D!.toFixed(2)} → gross` : "needs ≥7 prior telemetried days"}</span>
                <span className="calc-value mono">{r.adjTR30D === null ? "—" : fmtSigned(g(r.adjTR30D))}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">WMAX · WA-aware</span>
                <span className="calc-formula mono">{r.wmax ? `Σh max(Rᵒʳⁱᵍ,Rᵖᵘʳ)=${r.wmax.refCpu}c·${r.wmax.refMem}G × O ${r.wmax.oCpu}/${r.wmax.oMem} × max(pᵇᵃˢᵉ,pᶜᵘʳ)=${r.wmax.pCpuUsed.toFixed(4)}/${r.wmax.pMemUsed.toFixed(4)} (${r.wmax.hours}h) → $${r.wmaxBaseline!.toFixed(2)}` : "no WOOP hourly originals this day (~60d window)"}</span>
                <span className="calc-value mono">{r.wmaxBaseline === null ? "—" : fmtSigned(g(r.wmaxBaseline))}</span>
              </div>
              <div className="calc-row">
                <span className="calc-name">M2 · OLS two-factor</span>
                <span className="calc-formula mono">{c.baseline?.m2 ? `a=${c.baseline.m2.a.toFixed(4)}·V + b=${c.baseline.m2.b.toFixed(4)}·RAM + c=${c.baseline.m2.c.toFixed(1)} (R² ${c.baseline.m2.r2})` : "gates failed / not fitted — only published when corr(V,RAM)<0.9"}</span>
                <span className="calc-value mono">{r.adjM2 === null ? "n/a" : fmtSigned(g(r.adjM2))}</span>
              </div>
              {L && (
                <>
                  <div className="calc-row">
                    <span className="calc-name">M4 · L_W WOOP demand</span>
                    <span className="calc-formula mono">o0×p×(r_org − r_now): {c.methodsMeta.M4?.o0?.toFixed(2)}×{c.baseline ? c.baseline.pUsdPerVcpuDay.toFixed(4) : "?"}×({L.organicDemandVcpu.toFixed(1)}−{r.reqCpu.toFixed(1)})</span>
                    <span className="calc-value mono">{fmtSigned(L.woopDemand)}</span>
                  </div>
                  <div className="calc-row">
                    <span className="calc-name">M4 · L_N node packing</span>
                    <span className="calc-formula mono">p×(o0×r_now − v_now): {c.baseline ? c.baseline.pUsdPerVcpuDay.toFixed(4) : "?"}×({((c.methodsMeta.M4?.o0 ?? 0) * r.reqCpu).toFixed(1)}−{r.vcpu.toFixed(1)})</span>
                    <span className="calc-value mono">{fmtSigned(L.nodePacking)}</span>
                  </div>
                  <div className="calc-row">
                    <span className="calc-name">M4 · L_P price/family+spot</span>
                    <span className="calc-formula mono">v_now×(p − c/v): {r.vcpu.toFixed(1)}×({c.baseline ? c.baseline.pUsdPerVcpuDay.toFixed(4) : "?"}−{r.unitPrice?.toFixed(4) ?? "?"})</span>
                    <span className="calc-value mono">{fmtSigned(L.priceEffect)}</span>
                  </div>
                  <div className="calc-row total">
                    <span className="calc-name">M4 Σ = telescoping decomposition</span>
                    <span className="calc-formula">L_W + L_N + L_P = p×o0×r_org − c  (verified ≤1¢ error daily)</span>
                    <span className="calc-value mono">{fmtSigned(+(L.woopDemand + L.nodePacking + L.priceEffect).toFixed(2))}</span>
                  </div>
                </>
              )}
              {r.castProjected !== null && (
                <div className="calc-row castrow">
                  <span className="calc-name">CAST AI realized</span>
                  <span className="calc-formula mono">projected {f(r.castProjected)} − actual {f(r.castActual)} — their counterfactual, current prices (reference, never blended)</span>
                  <span className="calc-value mono">{fmtSigned(r.castTotalSavings)}</span>
                </div>
              )}
              <div className="calc-row">
                <span className="calc-name">unit price today</span>
                <span className="calc-formula">c/V vs frozen p {c.baseline ? `($${c.baseline.pUsdPerVcpuDay.toFixed(4)})` : ""} · source {r.source}{r.idle ? " · IDLE" : ""}</span>
                <span className="calc-value mono">{r.unitPrice ? `$${r.unitPrice.toFixed(4)}` : "—"}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
