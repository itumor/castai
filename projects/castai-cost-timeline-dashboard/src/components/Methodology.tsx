import { useEffect, useMemo, useState } from "react";
import type { ClusterRec, Dataset2, DayRow2 } from "../data2";
import { fmtUsd, loadTimeline } from "../data2";

function WorkedExample({ scope }: { scope: ClusterRec[] }) {
  const demo = useMemo(
    () => scope.find((c) => c.tier === "B" && c.baseline && c.switchDate) ?? scope.find((c) => c.baseline),
    [scope],
  );
  const [day, setDay] = useState<DayRow2 | null>(null);
  useEffect(() => {
    setDay(null);
    if (!demo?.timelineFile) return undefined;
    let dead = false;
    loadTimeline(demo.clusterId).then((tl) => {
      if (dead) return;
      const withTr = [...tl].reverse().find((r) => r.adjTR !== null && r.actualCost > 0 && r.vcpu > 0);
      setDay(withTr ?? null);
    });
    return () => { dead = true; };
  }, [demo]);

  if (!demo?.baseline) return null;
  const b = demo.baseline;
  const impliedBaseRatio = b.pMemUsdPerGibDay > 0 ? (b.pUsdPerVcpuDay - b.pCpuUsdPerVcpuDay) / b.pMemUsdPerGibDay : 0;
  const curRatio = day && day.vcpu > 0 ? day.ramGib / day.vcpu : 0;
  const termCpu = day ? b.pCpuUsdPerVcpuDay * day.vcpu : 0;
  const termMem = day ? b.pMemUsdPerGibDay * day.ramGib : 0;
  return (
    <section className="pane pane-standard">
      <h3>★ Worked example — one real day through TR</h3>
      <p className="pane-note">
        Live arithmetic from <strong>{demo.orgName} · {demo.name}</strong>: frozen prices learned on
        {" "}{b.from} → {b.to} ({b.days} days, before the {demo.switchDate} switch).
      </p>
      <table className="data worked">
        <tbody>
          <tr><th>registers</th>
            <td className="mono">p_cpu = $/vCPU·d</td><td className="mono val">{b.pCpuUsdPerVcpuDay.toFixed(6)}</td>
            <td className="mono">p_mem = $/GiB·d</td><td className="mono val">{b.pMemUsdPerGibDay.toFixed(6)}</td>
            <td className="mono">c_other = $/d</td><td className="mono val">{b.cOtherUsdPerDay.toFixed(2)}</td></tr>
          {day && (
            <>
              <tr><th>day {day.date}</th>
                <td className="mono">vCPU provisioned</td><td className="mono val">{day.vcpu.toFixed(1)}</td>
                <td className="mono">RAM GiB</td><td className="mono val">{day.ramGib.toFixed(0)}</td>
                <td className="mono">actual spend</td><td className="mono val">${day.actualCost.toFixed(2)}</td></tr>
              <tr><th>TR arithmetic</th>
                <td className="mono">p_cpu×V = {b.pCpuUsdPerVcpuDay.toFixed(4)}×{day.vcpu.toFixed(1)}</td>
                <td className="mono val">${termCpu.toFixed(2)}</td>
                <td className="mono">p_mem×RAM</td>
                <td className="mono val">${termMem.toFixed(2)}</td>
                <td className="mono">+ c_other</td>
                <td className="mono val">${b.cOtherUsdPerDay.toFixed(2)}</td></tr>
              <tr className="row-total"><th>counterfactual baseline</th>
                <td className="mono" colSpan={3}>adjusted = ${termCpu.toFixed(2)} + ${termMem.toFixed(2)} + ${b.cOtherUsdPerDay.toFixed(2)}</td>
                <td className="mono val"><strong>${day.adjTR!.toFixed(2)}</strong></td><td /><td /></tr>
              <tr><th>gross({day.date})</th>
                <td className="mono" colSpan={3}>adjusted − actual = {day.adjTR!.toFixed(2)} − {day.actualCost.toFixed(2)}</td>
                <td className={`mono val ${day.adjTR! - day.actualCost >= 0 ? "pos" : "neg"}`}>
                  <strong>{(day.adjTR! - day.actualCost) >= 0 ? "+" : "−"}${Math.abs(day.adjTR! - day.actualCost).toFixed(2)}</strong></td><td /><td /></tr>
              <tr><th>why two prices</th>
                <td className="mono" colSpan={3}>RAM/vCPU ratio: baseline {impliedBaseRatio.toFixed(2)} → this day {curRatio.toFixed(2)}
                  {" "}({curRatio >= impliedBaseRatio ? "+" : ""}{impliedBaseRatio ? ((curRatio / impliedBaseRatio - 1) * 100).toFixed(1) : "0"}%) — M1's single price
                  assumed {impliedBaseRatio.toFixed(2)}, so it {Math.abs((day.adjTR ?? 0) - (day.adjM1 ?? 0)) < 0.01 ? "just happens to match" : `misprices this day by $${((day.adjTR ?? 0) - (day.adjM1 ?? 0)).toFixed(2)}`}</td>
                <td className="mono val muted">M1 adj {day.adjM1 !== null ? `$${day.adjM1.toFixed(2)}` : "—"}</td><td /><td /></tr>
            </>
          )}
        </tbody>
      </table>
      <p className="axis-note">Registered day picked automatically (latest non-idle deep-tier day in scope). Same arithmetic in Day Inspector (click any day) and in the export's per-day columns.</p>
    </section>
  );
}

const TIER_BADGE: Record<number, string> = {
  0: "reference", 1: "trivial", 2: "core", 3: "robust", 4: "statistical", 5: "attribution",
};

export default function Methodology({ data, scope }: { data: Dataset2; scope: ClusterRec[] }) {
  return (
    <div className="methodology">
      <section className="pane">
        <h3>Why several methods — and why never just one number</h3>
        <p>
          A savings number is only as honest as its <em>counterfactual</em> — the answer to
          “what would this have cost without CAST AI?”. There are two irreducible unknowns:
          the <strong>price</strong> a vCPU would command, and the <strong>quantity</strong> of vCPUs the workload
          would demand. Different clusters admit different answers, so this atlas computes every method the
          telemetry supports, shows them side by side, and flags the months where even independent methods
          disagree. Naive month-over-month arithmetic (M0) is included deliberately: it is the number that
          appears in ad-hoc slide decks, and it is systematically wrong once workloads change.
        </p>
      </section>

      <WorkedExample scope={scope} />

      <section className="pane pane-standard">
        <h3>★ Operational standard: TR — frozen CPU+RAM prices</h3>
        <p>
          The default method of calculation for routine FinOps & reporting.<br />
          <strong>Dual-resource sensitivity</strong> — unlike M1, it prices CPU and RAM independently, preventing
          distortion when workloads shift in memory-to-CPU ratio.{" "}
          <strong>Robust &amp; deterministic</strong> — unlike M2, it depends on no noisy regression fit, no
          collinearity check, no data-availability gate.{" "}
          <strong>Defensible &amp; auditable</strong> — it avoids vendor bias and provides a consistent, dispute-free
          counterfactual: two frozen price points, one workload series, one arithmetic identity.
        </p>
      </section>

      <section className="pane">
        <h3>The method ladder</h3>
        <div className="methods-table-wrap">
          <table className="data methods-table">
            <thead>
              <tr><th style={{ textAlign: "left" }}>method</th><th style={{ textAlign: "left" }}>evidence / formula</th><th style={{ textAlign: "left" }}>when to trust it</th></tr>
            </thead>
            <tbody>
              {data.methodsCatalog.filter((m) => m.id !== "CAST").concat(data.methodsCatalog.filter((m) => m.id === "CAST")).map((m) => (
                <tr key={m.id} className={m.default ? "method-default" : ""}>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                    <span className="method-id">{m.id}{m.default ? " ★" : ""}</span>
                    <span className={`method-tier ${m.default ? "default" : ""}`}>{m.default ? "default" : TIER_BADGE[m.tier]}</span>
                    <div className="method-name">{m.name}</div>
                  </td>
                  <td style={{ textAlign: "left" }}><span className="mono method-formula">{m.formula}</span></td>
                  <td style={{ textAlign: "left" }} className="method-note">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pane">
        <h3>Frozen parameters in the current scope ({scope.length} clusters)</h3>
        <p className="pane-note">
          Baseline era = pre-autoscaler-switch days/months (switch from CAST AI <em>baseline-params</em>,
          value-realization first-savings month, or <em>firstOperationAt</em>. Price vintage frozen; workload
          changes after the switch cannot rewrite history — that is the whole point.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>org</th><th style={{ textAlign: "left" }}>cluster</th>
                <th>switch</th><th>baseline window</th><th>days</th><th>p $/vCPU·d</th>
                <th>p_cpu</th><th>p_mem</th><th>CV</th><th>M2</th><th>woop κ0/o0</th>
              </tr>
            </thead>
            <tbody>
              {scope.filter((c) => c.baseline).map((c) => (
                <tr key={c.clusterId}>
                  <td style={{ textAlign: "left" }} className="org">{c.orgName}</td>
                  <td style={{ textAlign: "left" }} className="cluster">{c.name}</td>
                  <td className="mono muted">{c.switchDate ?? "—"}<div className="muted" style={{ fontSize: 9 }}>{c.switchSource ?? ""}</div></td>
                  <td className="mono muted">{c.baseline?.from} → {c.baseline?.to}</td>
                  <td className="mono">{c.baseline?.days}</td>
                  <td className="mono">${c.baseline?.pUsdPerVcpuDay.toFixed(4)}</td>
                  <td className="mono muted">${c.baseline?.pCpuUsdPerVcpuDay.toFixed(3)}</td>
                  <td className="mono muted">${c.baseline?.pMemUsdPerGibDay.toFixed(4)}</td>
                  <td className="mono muted">{c.baseline?.unitPriceCV != null ? `${(c.baseline.unitPriceCV * 100).toFixed(1)}%` : "—"}</td>
                  <td className="mono muted">{c.baseline?.m2 ? `a=${c.baseline.m2.a.toFixed(3)} R²=${c.baseline.m2.r2}` : <span className="flagchip">gates failed</span>}</td>
                  <td className="mono muted">
                    {c.methodsMeta.M4?.kappa0 ? `${c.methodsMeta.M4.kappa0.toFixed(2)} / ${c.methodsMeta.M4.o0?.toFixed(2)}` : "—"}
                    {c.methodsMeta.WMAX && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        WMAX O: {c.methodsMeta.WMAX.oCpu}/{c.methodsMeta.WMAX.oMem}
                        {c.methodsMeta.WMAX.castOCpu ? ` · CAST O: ${c.methodsMeta.WMAX.castOCpu.toFixed(2)}/${c.methodsMeta.WMAX.castOMem?.toFixed(2)}` : ""}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {scope.filter((c) => !c.baseline).map((c) => (
                <tr key={c.clusterId}>
                  <td style={{ textAlign: "left" }} className="org">{c.orgName}</td>
                  <td style={{ textAlign: "left" }} className="cluster">{c.name}</td>
                  <td colSpan={9} className="muted mono" style={{ textAlign: "left" }}>
                    no own-history baseline — {c.isPhase2 ? "onboarded after autoscaler switch (peer-cluster baseline on CAST AI side; our frozen methods n/a)" : "monitoring only · nested/zombie telemetry"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pane">
        <h3>Validation & hard rules</h3>
        <ul className="rules">
          <li><strong>Never blend:</strong> CAST AI realized savings and our methods answer different questions (different counterfactual weights, different price vintages). Side by side; ±{(data.reconcileTolerance * 100).toFixed(0)}% reconciliation band; breaches flagged <span className="flagchip">CROSSCHECK_OUT_OF_BAND</span> per month.</li>
          <li><strong>Fee:</strong> CAST AI subscription — €{data.fee.eurPerVcpuMonth} per provisioned vCPU·month (frozen FX 1€ = ${data.fee.fxUsdPerEur.toFixed(2)} ⇒ ${data.fee.usdPerVcpuMonth.toFixed(2)}), prorated by telemetried days. net = gross − fee; the fee applies even on negative-gross months. Idle clusters (nothing provisioned) pay $0. The CAST AI realized reference series is left untouched so the two lines stay comparable.</li>
          <li><strong>No silent interpolation:</strong> months without telemetry are excluded from savings math and marked <span className="flagchip">ESTIMATED_NO_DATA</span> / <span className="flagchip">IDLE_MONTH($0)</span> only when the authoritative org daily-cost feed proves silence inside its coverage window.</li>
          <li><strong>M2 gates:</strong> OLS published only when corr(vCPU, RAM) &lt; 0.9, R² ≥ 0.7, CI ≤ 25%, physical price bounds — on this fleet RAM/CPU ratios are near-constant, so M2 stays unidentified; TR is the honest structural successor (ratio-of-sums, no regression).</li>
          <li><strong>M4 telescopes:</strong> L_W + L_N + L_P = p×o0×r_org − c by construction (≤1¢ daily rounding); demand layer counts <em>original</em> requests, so WOOP's own oversizing cannot inflate credit.</li>
          <li><strong>Bucket labels:</strong> cost-report buckets are end-labeled (label−1 = calendar day); org-style feeds are start-labeled; today's partial day is dropped everywhere.</li>
          <li><strong>Provenance:</strong> {data.clusters.length} clusters · {data.clusters.filter((c) => c.tier === "B").length} deep-tier (cost + resource-usage + value-realization daily, WOOP metrics, audit events, rebalancing plans, policies) · {data.clusters.filter((c) => c.tier === "A").length} fleet-tier (org daily-cost + monthly org report + per-cluster monthly value-realization) · snapshot {data.generatedAt}.</li>
        </ul>
      </section>

      <section className="pane">
        <h3>Frozen baseline → future-month comparison</h3>
        <p className="mono" style={{ lineHeight: 1.9 }}>
          For every month m after the switch:<br />
          &nbsp;&nbsp;M1: gross(m) = p × Σ<sub>d∈m</sub> vCPU(d) − actual(m)<br />
          &nbsp;&nbsp;TR: gross(m) = p_cpu × ΣvCPU + p_mem × ΣRAM + c_other×days − actual(m)<br />
          &nbsp;&nbsp;M2: gross(m) = â·ΣvCPU + b̂·ΣRAM + ĉ×days − actual(m)<br />
          &nbsp;&nbsp;fee(m) = €{data.fee.eurPerVcpuMonth} × {data.fee.fxUsdPerEur.toFixed(2)} × avgVCPU(m) × (covered-days / days-in-month)<br />
          &nbsp;&nbsp;net(m) = gross(m) − fee(m)<br />
          Future months need only facts: provisioned vCPU/RAM-days, actual spend. Frozen prices keep the
          counterfactual comparable a year from now; a workload doubling doubles the baseline — savings scale
          with it, which is the correct behavior.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Anchors in-scope: {scope.length} clusters · {fmtUsd(scope.flatMap((c) => c.monthly).reduce((a, m) => a + m.actualCost, 0), 0)} spend in ledger · {scope.filter((c) => c.baseline).length} frozen baselines.
        </p>
      </section>
    </div>
  );
}
