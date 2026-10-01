import { useMemo } from "react";
import type { EventRow2 } from "../data2";

const TYPE_META: Record<string, { label: string; hue: string }> = {
  "woop-installed": { label: "workload autoscaler", hue: "#5cc8e6" },
  "rebalance-planned": { label: "rebalance plan", hue: "#c9b8ff" },
  rebalance: { label: "rebalance", hue: "#c9b8ff" },
  "policy-enabled": { label: "policy enabled", hue: "#69d58c" },
  "policy-change": { label: "policy change", hue: "#f2b84b" },
  "woop-activity": { label: "scaling policy", hue: "#8e97ae" },
};

interface Props { events: EventRow2[]; scopeNames: Map<string, string>; }

export default function EventsList({ events, scopeNames }: Props) {
  // consolidate rebalance churn: keep plan-generated + finished per day
  const consolidated = useMemo(() => {
    const byKey = new Map<string, EventRow2>();
    const out: EventRow2[] = [];
    for (const e of events) {
      if (e.type === "woop-activity") {
        const k = `${e.clusterId}|${e.date}`;
        if (byKey.has(k)) {
          const prev = byKey.get(k)!;
          (prev.details as { n?: number }).n = ((prev.details as { n?: number }).n ?? 1) + 1;
          continue;
        }
        const c = { ...e, details: { ...e.details, n: 1 } };
        byKey.set(k, c);
        out.push(c);
      } else {
        out.push(e);
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [events]);

  return (
    <div>
      <p className="pane-note">
        Optimization events from audit trail, rebalancing plans, policies & workload-autoscaler installs
        — deep-tier clusters only. Days with intense scaling-policy churn are collapsed.
      </p>
      {consolidated.length === 0 && (
        <p className="empty-note">No events in the current scope (fleet-tier orgs carry no event telemetry).</p>
      )}
      <div className="events">
        {consolidated.map((e, i) => {
          const meta = TYPE_META[e.type] ?? { label: e.type, hue: "#8e97ae" };
          const n = (e.details as { n?: number }).n ?? 0;
          return (
            <div className="event" key={i}>
              <span className="event-date mono">{e.date}</span>
              <span className="event-dot" style={{ background: meta.hue }} />
              <div>
                <div className="event-title">
                  {e.title}
                  {n > 1 && <span className="event-n">×{n}</span>}
                </div>
                <div className="event-sub">
                  {scopeNames.get(e.clusterId) ?? e.clusterId.slice(0, 8)} · {meta.label}
                  {e.type === "rebalance" && typeof (e.details as { rebalancingNodes?: number }).rebalancingNodes === "number"
                    ? ` · ${(e.details as { rebalancingNodes?: number }).rebalancingNodes} nodes`
                    : ""}
                  {e.type === "woop-installed" && (e.details as { currentVersion?: string }).currentVersion
                    ? ` · v${(e.details as { currentVersion?: string }).currentVersion}`
                    : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
