import { useMemo, useState } from "react";
import type { ClusterRec, OrgRec } from "../data2";

interface Props {
  orgs: OrgRec[];
  clusters: ClusterRec[];
  selOrgs: string[]; // empty = all
  selClusters: string[]; // empty = all (within org filter)
  onOrgs: (ids: string[]) => void;
  onClusters: (ids: string[]) => void;
}

function Multi({
  label, options, selected, onChange, groupPrefix,
}: {
  label: string;
  options: Array<{ id: string; name: string; sub?: string; group?: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  groupPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => options.filter((o) => (o.name + (o.sub ?? "")).toLowerCase().includes(q.toLowerCase())),
    [options, q],
  );
  const allOn = selected.length === 0;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const grouped = useMemo(() => {
    const g = new Map<string, typeof shown>();
    for (const o of shown) {
      const k = o.group ?? "";
      const arr = g.get(k) ?? [];
      arr.push(o);
      g.set(k, arr);
    }
    return [...g.entries()];
  }, [shown]);

  return (
    <div className={`multi ${open ? "open" : ""}`}>
      <button className="multi-btn" onClick={() => setOpen(!open)}>
        <span className="multi-label">{label}</span>
        <span className="multi-val">
          {allOn ? "all" : `${selected.length} selected`}
        </span>
        <span className="multi-caret">▾</span>
      </button>
      {open && (
        <div className="multi-pop">
          <div className="multi-tools">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" autoFocus />
            <button onClick={() => onChange([])}>reset</button>
          </div>
          <div className="multi-list">
            {grouped.map(([g, rows]) => (
              <div key={g || "_"}>
                {g && <div className="multi-group">{groupPrefix}{g}</div>}
                {rows.map((o) => (
                  <label key={o.id} className={`multi-row ${selected.includes(o.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                    <span className="multi-row-name">{o.name}</span>
                    {o.sub && <span className="multi-row-sub">{o.sub}</span>}
                  </label>
                ))}
                {rows.length === 0 && <div className="multi-row-sub" style={{ padding: 8 }}>no match</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ orgs, clusters, selOrgs, selClusters, onOrgs, onClusters }: Props) {
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orgs) m.set(o.id, o.name ?? o.id.slice(0, 8));
    return m;
  }, [orgs]);

  const orgOptions = useMemo(
    () =>
      orgs
        .filter((o) => clusters.some((c) => c.orgId === o.id))
        .map((o) => ({
          id: o.id,
          name: o.name,
          sub: `${clusters.filter((c) => c.orgId === o.id).length} clusters`,
          group: o.parentId ? parentOf.get(o.parentId) ?? "parent org" : "top-level",
        })),
    [orgs, clusters, parentOf],
  );

  const clusterOptions = useMemo(() => {
    const inScope = selOrgs.length ? clusters.filter((c) => selOrgs.includes(c.orgId)) : clusters;
    return inScope.map((c) => ({
      id: c.clusterId,
      name: c.name,
      sub: `${c.orgName} · ${c.tier === "B" ? "deep" : "fleet"}${c.isPhase2 ? " · phase2" : ""}`,
      group: c.orgName,
    }));
  }, [clusters, selOrgs]);

  return (
    <div className="filterbar">
      <Multi label="Organization" options={orgOptions} selected={selOrgs} onChange={onOrgs} groupPrefix="" />
      <Multi label="Cluster" options={clusterOptions} selected={selClusters} onChange={onClusters} groupPrefix="" />
      <div className="filterbar-count">
        {selClusters.length
          ? `${selClusters.length} cluster${selClusters.length > 1 ? "s" : ""}`
          : selOrgs.length
            ? `${clusters.filter((c) => selOrgs.includes(c.orgId)).length} clusters in scope`
            : `${clusters.length} clusters · ${orgs.filter((o) => clusters.some((c) => c.orgId === o.id)).length} orgs`}
      </div>
    </div>
  );
}
