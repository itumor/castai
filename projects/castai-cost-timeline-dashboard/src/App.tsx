import { useEffect, useMemo, useState } from "react";
import FilterBar from "./components/FilterBar";
import CostTimeline from "./components/CostTimeline";
import MethodCompare, { CumulativeCompare } from "./components/MethodCompare";
import DemandLines from "./components/WorkloadCharts";
import LayerChart from "./components/LayerChart";
import MonthlyLedger from "./components/MonthlyLedger";
import EventsList from "./components/EventsList";
import DayInspector from "./components/DayInspector";
import Methodology from "./components/Methodology";
import { exportCsv, exportXlsx } from "./export";
import type { ClusterRec, Dataset2, DayRow2, EventRow2 } from "./data2";
import { fmtSigned, fmtUsd, loadDataset2, loadTimeline, mergeDays, mergeMonths } from "./data2";

type Tab = "overview" | "methods" | "ledger" | "events" | "how";

export default function App() {
  const [data, setData] = useState<Dataset2 | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selOrgs, setSelOrgs] = useState<string[]>([]);
  const [selClusters, setSelClusters] = useState<string[]>([]);
  const [method, setMethod] = useState("TR");
  const [showCast, setShowCast] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Map<string, DayRow2[]>>(new Map());
  const [loadPct, setLoadPct] = useState(0);

  useEffect(() => {
    loadDataset2().then(setData).catch((e) => setErr(String(e)));
  }, []);

  const scope: ClusterRec[] = useMemo(() => {
    if (!data) return [];
    return data.clusters.filter(
      (c) =>
        (selOrgs.length === 0 || selOrgs.includes(c.orgId)) &&
        (selClusters.length === 0 || selClusters.includes(c.clusterId)),
    );
  }, [data, selOrgs, selClusters]);

  // lazy timeline loading for scope (budget: fetch all in scope; typical scope small)
  useEffect(() => {
    if (!scope.length) {
      setTimelines(new Map());
      return;
    }
    let cancelled = false;
    const targets = scope.filter((c) => c.timelineFile);
    setLoadPct(0);
    (async () => {
      const next = new Map<string, DayRow2[]>();
      let done = 0;
      const batch = 12;
      for (let i = 0; i < targets.length; i += batch) {
        await Promise.all(
          targets.slice(i, i + batch).map(async (c) => {
            next.set(c.clusterId, await loadTimeline(c.clusterId));
            done += 1;
            if (!cancelled && done % batch === 0) setLoadPct(Math.round((done / targets.length) * 100));
          }),
        );
      }
      if (!cancelled) {
        setTimelines(next);
        setLoadPct(100);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const days = useMemo(() => mergeDays([...timelines.values()]), [timelines]);
  const months = useMemo(() => mergeMonths(scope), [scope]);
  const events: EventRow2[] = useMemo(() => scope.flatMap((c) => c.events), [scope]);
  const scopeNames = useMemo(() => new Map(scope.map((c) => [c.clusterId, c.name])), [scope]);

  const totals = useMemo(() => {
    const t = {
      actual: 0, tr: null as number | null, trnet: null as number | null,
      m1: null as number | null, m1net: null as number | null, cast: null as number | null,
    };
    for (const m of months) {
      t.actual += m.actual;
      t.tr = m.TR === null ? t.tr : (t.tr ?? 0) + m.TR;
      t.trnet = m.TRnet === null ? t.trnet : (t.trnet ?? 0) + m.TRnet;
      t.m1 = m.M1 === null ? t.m1 : (t.m1 ?? 0) + m.M1;
      t.m1net = m.M1net === null ? t.m1net : (t.m1net ?? 0) + m.M1net;
      t.cast = m.cast === null ? t.cast : (t.cast ?? 0) + m.cast;
    }
    return t;
  }, [months]);

  const deep = scope.filter((c) => c.tier === "B").length;

  if (err) return <div className="page"><div className="notice-error">{err}</div></div>;
  if (!data) return <div className="page"><p className="loading">loading dataset…</p></div>;

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>Cost <span className="accent">Atlas</span></h1>
          <p className="hero-sub">
            every CAST AI optimization euro, every way it can be counted — org → cluster → day
          </p>
        </div>
        <div className="exportbar">
          <button onClick={() => exportCsv(scope, timelines)} disabled={!scope.length}>⬇ CSV · all methods</button>
          <button onClick={() => exportXlsx(data, scope, timelines)} disabled={!scope.length}>⬇ Excel · all methods</button>
        </div>
      </header>

      <FilterBar
        orgs={data.orgs}
        clusters={data.clusters}
        selOrgs={selOrgs}
        onOrgs={(ids) => { setSelOrgs(ids); setSelClusters([]); setPickedDate(null); }}
        selClusters={selClusters}
        onClusters={(ids) => { setSelClusters(ids); setPickedDate(null); }}
      />

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">actual spend · ledger</div>
          <div className="kpi-value">{fmtUsd(totals.actual, 0)}</div>
          <div className="kpi-sub">{scope.length} clusters · {months.length} months</div>
        </div>
        <div className="kpi kpi-default">
          <div className="kpi-label">TR gross · operational standard ★</div>
          <div className={`kpi-value ${(totals.tr ?? 0) >= 0 ? "pos" : "neg"}`}>{fmtSigned(totals.tr)}</div>
          <div className="kpi-sub">net after €5/vCPU·mo fee {fmtSigned(totals.trnet)} · M1 gross {fmtSigned(totals.m1)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">CAST AI realized</div>
          <div className={`kpi-value cast`}>{fmtSigned(totals.cast)}</div>
          <div className="kpi-sub">reference series — never blended</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">telemetry depth</div>
          <div className="kpi-value">{deep}<span className="kpi-dim">/</span>{scope.length}</div>
          <div className="kpi-sub">deep-tier clusters (daily + events)</div>
        </div>
        {loadPct < 100 && scope.some((c) => c.timelineFile) && (
          <div className="kpi kpi-loading">
            <div className="kpi-label">timelines</div>
            <div className="kpi-value muted">{loadPct}%</div>
          </div>
        )}
      </div>

      <nav className="tabs">
        {([["overview", "Timeline"], ["methods", "Method comparison"], ["ledger", "Monthly ledger · all methods"], ["events", "Optimization events"], ["how", "How it's calculated"]] as Array<[Tab, string]>).map(([t, label]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{label}</button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="pane">
            <div className="pane-head">
              <h3>Daily cost vs frozen counterfactual</h3>
              <div className="seg methodseg">
                {["M0", "M1", "TR", "TR30D", "WMAX", "TRW", "REQ", "M2"].map((m) => (
                  <button key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)} title={data.methodsCatalog.find((x) => x.id === m)?.formula}>
                    <span className="m-tier">{m === "M0" ? "t1" : m === "M1" ? "t2" : m === "TR" ? "t3★" : m === "TR30D" ? "t3·roll" : "t4"}</span>{m}
                  </button>
                ))}
                <button className={showCast ? "on" : ""} onClick={() => setShowCast(!showCast)}>± CAST</button>
              </div>
            </div>
            {days.length === 0
              ? <p className="empty-note">No daily telemetry in scope (fleet-tier orgs are monthly-only; pick clusters marked “deep”).</p>
              : <CostTimeline days={days} events={events} method={method} showCast={showCast} onPickDate={(d) => setPickedDate(d)} />}
            <p className="axis-note">shaded area = actuals · dashed = the selected method's frozen counterfactual · bars = daily gross by that method · amber line = autoscaler switch. Click any day for the full arithmetic.</p>
          </div>
          <div className="pane">
            <div className="pane-head"><h3>Demand story (deep-tier days)</h3></div>
            {deep === 0
              ? <p className="empty-note">Select deep-tier clusters (tier chip "B" in cluster filter) for request/usage telemetry.</p>
              : <DemandLines days={days} />}
          </div>
        </>
      )}

      {tab === "methods" && (
        <>
          <div className="pane">
            <div className="pane-head"><h3>Monthly gross — every method vs CAST AI</h3></div>
            <MethodCompare months={months} />
            <p className="axis-note">Same months, six questions. DISAGREEMENT IS THE INFORMATION: where M0 and M1 split, the workload changed; where M1 and CAST split, the price vintage or baseline window differs; flags explain which. Hover any month.</p>
          </div>
          <div className="pane">
            <div className="pane-head"><h3>Cumulative net (post-fee) by method</h3></div>
            <CumulativeCompare months={months} />
          </div>
          {deep > 0 && (
            <div className="pane">
              <div className="pane-head"><h3>M4 attribution — where the savings come from</h3></div>
              <LayerChart days={days} />
              <p className="axis-note">L_W = demand right-sizing (original vs current requests) · L_N = node packing · L_P = price/family/spot. Negative L_W = workloads genuinely grew while autoscaled — protection value, not failure.</p>
            </div>
          )}
        </>
      )}

      {tab === "ledger" && (
        <div className="pane">
          <div className="pane-head"><h3>Monthly ledger — all methods, all selected clusters</h3></div>
          <MonthlyLedger scope={scope} />
        </div>
      )}

      {tab === "events" && (
        <div className="pane">
          <EventsList events={events} scopeNames={scopeNames} />
        </div>
      )}

      {tab === "how" && <Methodology data={data} scope={scope} />}

      {pickedDate && (
        <DayInspector date={pickedDate} scope={scope} timelines={timelines} onClose={() => setPickedDate(null)} />
      )}

      <footer className="pagefoot">
        snapshot {data.generatedAt} · {data.orgs.length} orgs · {data.clusters.length} clusters · two telemetry tiers ·
        methods frozen per cluster · export contains every method's arithmetic
      </footer>
    </div>
  );
}
