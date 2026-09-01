import { useMemo, useState } from 'react';
import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import ResourceTable, {
  type ResourceTableColumn,
} from '../components/ResourceTable';
import Badge from '../components/Badge';
import type {
  CapacityType,
  NodeSummary,
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

function capacityVariant(c: CapacityType): 'info' | 'warning' | 'default' {
  if (c === 'spot') return 'warning';
  if (c === 'on-demand') return 'info';
  return 'default';
}

const KARPENTER_LABEL_PREFIXES = [
  'karpenter.sh/',
  'karpenter.k8s.aws/',
];

function isKarpenterLabel(key: string): boolean {
  return KARPENTER_LABEL_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * List + detail page for cluster Nodes. Each row shows capacity,
 * zone, arch, age, and the Karpenter labels are summarised in the
 * detail panel.
 */
export default function Nodes(): JSX.Element {
  const nodes = useApi<NodeSummary[]>('/nodes');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const rows = nodes.data ?? [];

  const selected = useMemo<NodeSummary | null>(
    () =>
      selectedName
        ? rows.find((n) => n.name === selectedName) ?? null
        : null,
    [selectedName, rows],
  );

  if (nodes.loading) {
    return (
      <section className="kv-page" data-testid="page-nodes">
        <h1 className="kv-page__title">Nodes</h1>
        <Loading label="Loading Nodes..." />
      </section>
    );
  }

  if (nodes.error) {
    return (
      <section className="kv-page" data-testid="page-nodes">
        <h1 className="kv-page__title">Nodes</h1>
        <ErrorMessage error={nodes.error} title="Failed to load Nodes" />
      </section>
    );
  }

  const columns: ResourceTableColumn<NodeSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
    },
    {
      key: 'nodePool',
      header: 'NodePool',
      sortValue: (row) => row.nodePool ?? '',
      render: (row) =>
        row.nodePool ? (
          row.nodePool
        ) : (
          <span className="kv-list-page__muted">—</span>
        ),
    },
    {
      key: 'capacityType',
      header: 'Capacity Type',
      sortValue: (row) => row.capacityType,
      render: (row) => (
        <Badge variant={capacityVariant(row.capacityType)}>
          {row.capacityType}
        </Badge>
      ),
    },
    {
      key: 'instanceType',
      header: 'Instance Type',
      sortValue: (row) => row.instanceType ?? '',
      render: (row) =>
        row.instanceType ? <Badge>{row.instanceType}</Badge> : (
          <span className="kv-list-page__muted">—</span>
        ),
    },
    {
      key: 'cpu',
      header: 'CPU',
      sortValue: (row) => parseCapacity(row.cpuCapacity),
      render: (row) => row.cpuCapacity ?? '—',
    },
    {
      key: 'memory',
      header: 'Memory',
      sortValue: (row) => parseMemory(row.memoryCapacity),
      render: (row) => row.memoryCapacity ?? '—',
    },
    {
      key: 'zone',
      header: 'Zone',
      sortValue: (row) => row.zone ?? '',
      render: (row) =>
        row.zone ? (
          <span className="kv-list-page__event-row">{row.zone}</span>
        ) : (
          <span className="kv-list-page__muted">—</span>
        ),
    },
    {
      key: 'arch',
      header: 'Arch',
      sortValue: (row) => row.architecture ?? '',
      render: (row) =>
        row.architecture ? (
          <Badge variant="default">{row.architecture}</Badge>
        ) : (
          <span className="kv-list-page__muted">—</span>
        ),
    },
    {
      key: 'age',
      header: 'Age',
      sortValue: (row) =>
        row.ageSeconds ?? Date.parse(row.creationTimestamp ?? '') / 1000,
      render: (row) => formatAge(row.creationTimestamp, row.ageSeconds),
    },
  ];

  return (
    <section className="kv-page" data-testid="page-nodes">
      <h1 className="kv-page__title">Nodes</h1>
      <p className="kv-page__description">
        Cluster Nodes, including their capacity, topology, and the Karpenter
        labels that link them back to their NodePool.
      </p>

      <ResourceTable
        columns={columns}
        data={rows}
        keyField={(row) => row.name}
        onRowClick={(row) =>
          setSelectedName((prev) => (prev === row.name ? null : row.name))
        }
        emptyMessage="No Nodes found."
        filterPlaceholder="Filter Nodes…"
      />

      {selected && <NodeDetailPanel node={selected} />}
    </section>
  );
}

function parseCapacity(value?: string): number {
  if (!value) return 0;
  if (value.endsWith('m')) {
    const n = Number(value.slice(0, -1));
    return Number.isFinite(n) ? n / 1000 : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseMemory(value?: string): number {
  if (!value) return 0;
  const match = value.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|K|M|G|T|P)?$/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = match[2] ?? '';
  const multipliers: Record<string, number> = {
    '': 1,
    K: 1000,
    Ki: 1024,
    M: 1000 * 1000,
    Mi: 1024 * 1024,
    G: 1000 * 1000 * 1000,
    Gi: 1024 * 1024 * 1024,
    T: 1000 * 1000 * 1000 * 1000,
    Ti: 1024 * 1024 * 1024 * 1024,
    P: 1000 * 1000 * 1000 * 1000 * 1000,
    Pi: 1024 * 1024 * 1024 * 1024 * 1024,
  };
  return n * (multipliers[unit] ?? 1);
}

function NodeDetailPanel({ node }: { node: NodeSummary }): JSX.Element {
  const labels = node.labels ?? {};
  const karpenterLabels = Object.entries(labels).filter(([k]) =>
    isKarpenterLabel(k),
  );

  return (
    <div
      className="kv-list-page__detail"
      data-testid="node-detail"
      data-node={node.name}
    >
      <h2 className="kv-list-page__detail-title">Node: {node.name}</h2>

      <dl className="kv-list-page__detail-grid">
        <dt className="kv-list-page__detail-label">Name</dt>
        <dd className="kv-list-page__detail-value">{node.name}</dd>
        <dt className="kv-list-page__detail-label">Status</dt>
        <dd className="kv-list-page__detail-value">
          <Badge variant={node.ready ? 'success' : 'error'}>
            {node.ready ? 'Ready' : 'NotReady'}
          </Badge>
        </dd>
        <dt className="kv-list-page__detail-label">NodePool</dt>
        <dd className="kv-list-page__detail-value">
          {node.nodePool ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">NodeClaim</dt>
        <dd className="kv-list-page__detail-value">
          {node.nodeClaim ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Capacity Type</dt>
        <dd className="kv-list-page__detail-value">
          <Badge variant={capacityVariant(node.capacityType)}>
            {node.capacityType}
          </Badge>
        </dd>
        <dt className="kv-list-page__detail-label">Instance Type</dt>
        <dd className="kv-list-page__detail-value">
          {node.instanceType ? <Badge>{node.instanceType}</Badge> : '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Architecture</dt>
        <dd className="kv-list-page__detail-value">
          {node.architecture ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Zone</dt>
        <dd className="kv-list-page__detail-value">{node.zone ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">Region</dt>
        <dd className="kv-list-page__detail-value">{node.region ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">OS</dt>
        <dd className="kv-list-page__detail-value">{node.os ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">Schedulable</dt>
        <dd className="kv-list-page__detail-value">
          {node.schedulable === false ? 'No' : 'Yes'}
        </dd>
      </dl>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">
          Allocatable Capacity
        </h3>
        <dl className="kv-list-page__detail-grid">
          <dt className="kv-list-page__detail-label">CPU</dt>
          <dd className="kv-list-page__detail-value">
            {node.cpuCapacity ?? '—'}
          </dd>
          <dt className="kv-list-page__detail-label">Memory</dt>
          <dd className="kv-list-page__detail-value">
            {node.memoryCapacity ?? '—'}
          </dd>
          <dt className="kv-list-page__detail-label">Pods</dt>
          <dd className="kv-list-page__detail-value">
            {node.podCapacity ?? '—'}
          </dd>
        </dl>
      </section>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">
          Karpenter Labels
        </h3>
        {karpenterLabels.length === 0 ? (
          <p className="kv-list-page__muted">No Karpenter labels.</p>
        ) : (
          <dl className="kv-list-page__detail-grid" data-testid="node-karpenter-labels">
            {karpenterLabels.map(([k, v]) => (
              <DetailRow key={k} label={k} value={v} />
            ))}
          </dl>
        )}
      </section>

      {Object.keys(labels).length > karpenterLabels.length && (
        <section className="kv-list-page__detail-section">
          <h3 className="kv-list-page__detail-section-title">
            Other Labels
          </h3>
          <dl className="kv-list-page__detail-grid">
            {Object.entries(labels)
              .filter(([k]) => !isKarpenterLabel(k))
              .map(([k, v]) => (
                <DetailRow key={k} label={k} value={v} />
              ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <>
      <dt className="kv-list-page__detail-label">{label}</dt>
      <dd className="kv-list-page__detail-value">{value}</dd>
    </>
  );
}
