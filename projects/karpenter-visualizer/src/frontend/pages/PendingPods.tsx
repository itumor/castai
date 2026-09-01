import { useMemo, useState } from 'react';
import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import ResourceTable, {
  type ResourceTableColumn,
} from '../components/ResourceTable';
import CodeBlock from '../components/CodeBlock';
import type {
  PendingPodEvidence,
  PendingPodResponse,
  SchedulingEvidence,
} from '@shared/types';

function formatAge(timestamp?: string, ageSeconds?: number): string {
  if (typeof ageSeconds === 'number') {
    if (ageSeconds < 60) return `${ageSeconds}s`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
    if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3600)}h`;
    return `${Math.floor(ageSeconds / 86_400)}d`;
  }
  if (!timestamp) return '—';
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function summariseRequests(evidence: SchedulingEvidence): string {
  const parts: string[] = [];
  if (evidence.requests.cpu) parts.push(`cpu ${evidence.requests.cpu}`);
  if (evidence.requests.memory) parts.push(`mem ${evidence.requests.memory}`);
  return parts.length === 0 ? '—' : parts.join(' / ');
}

function summariseNodeSelector(
  evidence: SchedulingEvidence,
): string {
  const keys = Object.keys(evidence.nodeSelector ?? {});
  return keys.length === 0 ? '0' : String(keys.length);
}

function summariseAffinity(evidence: SchedulingEvidence): string {
  const a = evidence.affinity;
  if (!a) return 'no';
  const hasNode = Boolean(a.nodeAffinity);
  const hasPod = Boolean(a.podAffinity);
  const hasAnti = Boolean(a.podAntiAffinity);
  if (!hasNode && !hasPod && !hasAnti) return 'no';
  return 'yes';
}

function summariseTopology(
  evidence: SchedulingEvidence,
): string {
  const n = Array.isArray(evidence.topologySpreadConstraints)
    ? evidence.topologySpreadConstraints.length
    : 0;
  return n === 0 ? '0' : String(n);
}

/**
 * List + detail page for pending pods and their scheduling evidence.
 *
 * The backend returns structured evidence (requests, nodeSelector,
 * affinity, tolerations, topology spread) so the UI just renders
 * counts/summaries in the table and full evidence in the detail panel.
 */
export default function PendingPods(): JSX.Element {
  const pending = useApi<PendingPodResponse | PendingPodEvidence[]>(
    '/pending-pods',
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const items = useMemo<PendingPodEvidence[]>(() => {
    const payload = pending.data;
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    return payload.items ?? [];
  }, [pending.data]);

  const selected = useMemo<PendingPodEvidence | null>(
    () =>
      selectedKey
        ? items.find(
            (e) => `${e.pod.namespace}/${e.pod.name}` === selectedKey,
          ) ?? null
        : null,
    [selectedKey, items],
  );

  if (pending.loading) {
    return (
      <section className="kv-page" data-testid="page-pending-pods">
        <h1 className="kv-page__title">Pending Pods</h1>
        <Loading label="Loading pending pods..." />
      </section>
    );
  }

  if (pending.error) {
    return (
      <section className="kv-page" data-testid="page-pending-pods">
        <h1 className="kv-page__title">Pending Pods</h1>
        <ErrorMessage
          error={pending.error}
          title="Failed to load pending pods"
        />
      </section>
    );
  }

  const columns: ResourceTableColumn<PendingPodEvidence>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.pod.name,
      render: (row) => (
        <span className="kv-list-page__event-row">{row.pod.name}</span>
      ),
    },
    {
      key: 'namespace',
      header: 'Namespace',
      sortValue: (row) => row.pod.namespace,
    },
    {
      key: 'requests',
      header: 'Requests',
      sortValue: (row) => summariseRequests(row.evidence),
      render: (row) => summariseRequests(row.evidence),
    },
    {
      key: 'nodeSelector',
      header: 'Node Selector',
      sortValue: (row) => summariseNodeSelector(row.evidence),
      render: (row) => summariseNodeSelector(row.evidence),
    },
    {
      key: 'affinity',
      header: 'Affinity',
      sortValue: (row) => summariseAffinity(row.evidence),
      render: (row) => {
        const text = summariseAffinity(row.evidence);
        const a = row.evidence.affinity;
        const detail = a
          ? `Node Affinity: ${a.nodeAffinity ? 'yes' : 'no'} | Pod Affinity: ${a.podAffinity ? 'yes' : 'no'} | Pod Anti-Affinity: ${a.podAntiAffinity ? 'yes' : 'no'}`
          : 'No affinity rules defined';
        return (
          <span
            data-testid="pending-pod-affinity"
            data-has-affinity={text}
            title={detail}
          >
            {text}
          </span>
        );
      },
    },
    {
      key: 'tolerations',
      header: 'Tolerations',
      sortValue: (row) => row.evidence.tolerations?.length ?? 0,
      render: (row) => String(row.evidence.tolerations?.length ?? 0),
    },
    {
      key: 'topology',
      header: 'Topology Constraints',
      sortValue: (row) => row.evidence.topologySpreadConstraints?.length ?? 0,
      render: (row) =>
        String(row.evidence.topologySpreadConstraints?.length ?? 0),
    },
    {
      key: 'age',
      header: 'Age',
      sortValue: (row) =>
        row.pod.ageSeconds ?? Date.parse(row.pod.creationTimestamp ?? '') / 1000,
      render: (row) => formatAge(row.pod.creationTimestamp, row.pod.ageSeconds),
    },
  ];

  return (
    <section className="kv-page" data-testid="page-pending-pods">
      <h1 className="kv-page__title">Pending Pods</h1>
      <p className="kv-page__description">
        Pods that have not yet been scheduled, with the structured
        scheduling constraints that the backend extracted from each pod
        spec. Click a row to see the full evidence and the raw pod spec.
      </p>

      <ResourceTable
        columns={columns}
        data={items}
        keyField={(row) => `${row.pod.namespace}/${row.pod.name}`}
        onRowClick={(row) => {
          const k = `${row.pod.namespace}/${row.pod.name}`;
          setSelectedKey((prev) => (prev === k ? null : k));
        }}
        emptyMessage="No pending pods."
        filterPlaceholder="Filter pending pods…"
      />

      {selected && <PendingPodDetailPanel item={selected} />}
    </section>
  );
}

function PendingPodDetailPanel({
  item,
}: {
  item: PendingPodEvidence;
}): JSX.Element {
  const e = item.evidence;
  const nodeSelectorEntries = Object.entries(e.nodeSelector ?? {});

  return (
    <div
      className="kv-list-page__detail"
      data-testid="pending-pod-detail"
      data-pod={`${item.pod.namespace}/${item.pod.name}`}
    >
      <h2 className="kv-list-page__detail-title">
        Pending Pod: {item.pod.namespace}/{item.pod.name}
      </h2>

      <dl className="kv-list-page__detail-grid">
        <dt className="kv-list-page__detail-label">Namespace</dt>
        <dd className="kv-list-page__detail-value">{item.pod.namespace}</dd>
        <dt className="kv-list-page__detail-label">Node</dt>
        <dd className="kv-list-page__detail-value">
          {item.pod.nodeName ?? 'unassigned'}
        </dd>
        <dt className="kv-list-page__detail-label">Phase</dt>
        <dd className="kv-list-page__detail-value">{item.pod.phase}</dd>
        <dt className="kv-list-page__detail-label">Created</dt>
        <dd className="kv-list-page__detail-value">
          {item.pod.creationTimestamp ?? '—'}
        </dd>
      </dl>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">
          Scheduling Evidence
        </h3>

        <div className="kv-list-page__evidence-grid">
          <EvidenceCell
            label="CPU Request"
            value={e.requests.cpu ?? '—'}
          />
          <EvidenceCell
            label="Memory Request"
            value={e.requests.memory ?? '—'}
          />
          <EvidenceCell
            label="Runtime Class"
            value={e.runtimeClassName ?? '—'}
          />
          <EvidenceCell
            label="Architecture"
            value={e.architecture ?? '—'}
          />
          <EvidenceCell
            label="Tolerations"
            value={String(e.tolerations?.length ?? 0)}
          />
          <EvidenceCell
            label="Topology Constraints"
            value={String(e.topologySpreadConstraints?.length ?? 0)}
          />
          <EvidenceCell
            label="Affinity"
            value={summariseAffinity(e)}
          />
          <EvidenceCell
            label="Node Selector"
            value={String(nodeSelectorEntries.length)}
          />
        </div>

        {nodeSelectorEntries.length > 0 && (
          <>
            <h4 className="kv-list-page__detail-section-title">
              Node Selectors
            </h4>
            <CodeBlock
              code={JSON.stringify(
                Object.fromEntries(nodeSelectorEntries),
                null,
                2,
              )}
              language="json"
            />
          </>
        )}

        {e.affinity && (
          <>
            <h4 className="kv-list-page__detail-section-title">Affinity</h4>
            <CodeBlock
              code={JSON.stringify(e.affinity, null, 2)}
              language="json"
            />
          </>
        )}

        {(e.tolerations?.length ?? 0) > 0 && (
          <>
            <h4 className="kv-list-page__detail-section-title">
              Tolerations
            </h4>
            <CodeBlock
              code={JSON.stringify(e.tolerations, null, 2)}
              language="json"
            />
          </>
        )}

        {(e.topologySpreadConstraints?.length ?? 0) > 0 && (
          <>
            <h4 className="kv-list-page__detail-section-title">
              Topology Spread Constraints
            </h4>
            <CodeBlock
              code={JSON.stringify(e.topologySpreadConstraints, null, 2)}
              language="json"
            />
          </>
        )}

        {Array.isArray(e.zonePreference) && e.zonePreference.length > 0 && (
          <>
            <h4 className="kv-list-page__detail-section-title">
              Zone Preference
            </h4>
            <CodeBlock
              code={JSON.stringify(e.zonePreference, null, 2)}
              language="json"
            />
          </>
        )}

        {Array.isArray(e.instanceTypePreference) &&
          e.instanceTypePreference.length > 0 && (
            <>
              <h4 className="kv-list-page__detail-section-title">
                Instance Type Preference
              </h4>
              <CodeBlock
                code={JSON.stringify(e.instanceTypePreference, null, 2)}
                language="json"
              />
            </>
          )}

        {Array.isArray(e.capacityTypePreference) &&
          e.capacityTypePreference.length > 0 && (
            <>
              <h4 className="kv-list-page__detail-section-title">
                Capacity Type Preference
              </h4>
              <CodeBlock
                code={JSON.stringify(e.capacityTypePreference, null, 2)}
                language="json"
              />
            </>
          )}

        {Array.isArray(e.reasons) && e.reasons.length > 0 && (
          <>
            <h4 className="kv-list-page__detail-section-title">
              Observed Reasons
            </h4>
            <ul data-testid="pending-pod-reasons">
              {e.reasons.map((r, idx) => (
                <li key={`${idx}-${r.slice(0, 16)}`}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">Raw Pod Spec</h3>
        <CodeBlock
          code={JSON.stringify(item.pod, null, 2)}
          language="json"
        />
      </section>
    </div>
  );
}

function EvidenceCell({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="kv-list-page__evidence-cell">
      <span className="kv-list-page__evidence-cell-label">{label}</span>
      <span className="kv-list-page__evidence-cell-value">{value}</span>
    </div>
  );
}
