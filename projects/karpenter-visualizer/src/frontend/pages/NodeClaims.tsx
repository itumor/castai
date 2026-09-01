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
  NodeClaimSummary,
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

/**
 * List + detail page for NodeClaims. Each row exposes the underlying
 * Node, NodePool, capacity, instance type, and phase.
 */
export default function NodeClaims(): JSX.Element {
  const nodeClaims = useApi<NodeClaimSummary[]>('/nodeclaims');
  const nodes = useApi<NodeSummary[]>('/nodes');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const loading = nodeClaims.loading || nodes.loading;
  const error = nodeClaims.error || nodes.error;

  const rows = nodeClaims.data ?? [];
  const nodeList = nodes.data ?? [];

  const selected = useMemo<NodeClaimSummary | null>(
    () =>
      selectedName
        ? rows.find((c) => c.name === selectedName) ?? null
        : null,
    [selectedName, rows],
  );

  if (loading) {
    return (
      <section className="kv-page" data-testid="page-nodeclaims">
        <h1 className="kv-page__title">NodeClaims</h1>
        <Loading label="Loading NodeClaims..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="kv-page" data-testid="page-nodeclaims">
        <h1 className="kv-page__title">NodeClaims</h1>
        <ErrorMessage error={error} title="Failed to load NodeClaims" />
      </section>
    );
  }

  const columns: ResourceTableColumn<NodeClaimSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
    },
    {
      key: 'nodePool',
      header: 'NodePool',
      sortValue: (row) => row.nodePool ?? '',
    },
    {
      key: 'node',
      header: 'Node',
      sortValue: (row) => row.nodeName ?? '',
      render: (row) =>
        row.nodeName ? (
          <span className="kv-list-page__event-row">{row.nodeName}</span>
        ) : (
          <span className="kv-list-page__muted">unbound</span>
        ),
    },
    {
      key: 'capacityType',
      header: 'Capacity Type',
      sortValue: (row) => row.capacityType,
      render: (row) => (
        <Badge
          variant={capacityVariant(row.capacityType)}
          title={`Capacity type: ${row.capacityType}`}
        >
          {row.capacityType}
        </Badge>
      ),
    },
    {
      key: 'instanceType',
      header: 'Instance Type',
      sortValue: (row) => row.instanceType ?? '',
      render: (row) =>
        row.instanceType ? (
          <Badge
            variant="default"
            title={`Instance type: ${row.instanceType}`}
          >
            {row.instanceType}
          </Badge>
        ) : (
          <span className="kv-list-page__muted">—</span>
        ),
    },
    {
      key: 'phase',
      header: 'Phase',
      sortValue: (row) => row.phase ?? 'Unknown',
    },
    {
      key: 'age',
      header: 'Age',
      sortValue: (row) => row.ageSeconds ?? Date.parse(row.creationTimestamp ?? '') / 1000,
      render: (row) => formatAge(row.creationTimestamp, row.ageSeconds),
    },
  ];

  return (
    <section className="kv-page" data-testid="page-nodeclaims">
      <h1 className="kv-page__title">NodeClaims</h1>
      <p className="kv-page__description">
        Karpenter NodeClaims linking a NodePool template to a concrete
        instance. Click a row for full requirements and capacity.
      </p>

      <ResourceTable
        columns={columns}
        data={rows}
        keyField={(row) => row.name}
        onRowClick={(row) =>
          setSelectedName((prev) => (prev === row.name ? null : row.name))
        }
        emptyMessage="No NodeClaims found."
        filterPlaceholder="Filter NodeClaims…"
      />

      {selected && (
        <NodeClaimDetailPanel
          claim={selected}
          nodes={nodeList}
        />
      )}
    </section>
  );
}

function NodeClaimDetailPanel({
  claim,
  nodes,
}: {
  claim: NodeClaimSummary;
  nodes: NodeSummary[];
}): JSX.Element {
  const linkedNode = claim.nodeName
    ? nodes.find((n) => n.name === claim.nodeName) ?? null
    : null;

  return (
    <div
      className="kv-list-page__detail"
      data-testid="nodeclaim-detail"
      data-nodeclaim={claim.name}
    >
      <h2 className="kv-list-page__detail-title">NodeClaim: {claim.name}</h2>

      <dl className="kv-list-page__detail-grid">
        <dt className="kv-list-page__detail-label">Name</dt>
        <dd className="kv-list-page__detail-value">{claim.name}</dd>
        <dt className="kv-list-page__detail-label">Namespace</dt>
        <dd className="kv-list-page__detail-value">{claim.namespace}</dd>
        <dt className="kv-list-page__detail-label">UID</dt>
        <dd className="kv-list-page__detail-value">{claim.uid ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">NodePool</dt>
        <dd className="kv-list-page__detail-value">{claim.nodePool}</dd>
        <dt className="kv-list-page__detail-label">Node</dt>
        <dd className="kv-list-page__detail-value">
          {claim.nodeName ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Phase</dt>
        <dd className="kv-list-page__detail-value">
          {claim.phase ?? 'Unknown'}
        </dd>
        <dt className="kv-list-page__detail-label">Capacity Type</dt>
        <dd className="kv-list-page__detail-value">
          <Badge variant={capacityVariant(claim.capacityType)}>
            {claim.capacityType}
          </Badge>
        </dd>
        <dt className="kv-list-page__detail-label">Instance Type</dt>
        <dd className="kv-list-page__detail-value">
          {claim.instanceType ? (
            <Badge>{claim.instanceType}</Badge>
          ) : (
            '—'
          )}
        </dd>
        <dt className="kv-list-page__detail-label">Architecture</dt>
        <dd className="kv-list-page__detail-value">
          {claim.architecture ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Zone</dt>
        <dd className="kv-list-page__detail-value">{claim.zone ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">Region</dt>
        <dd className="kv-list-page__detail-value">{claim.region ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">OS</dt>
        <dd className="kv-list-page__detail-value">{claim.os ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">Created</dt>
        <dd className="kv-list-page__detail-value">
          {claim.creationTimestamp ?? '—'}
        </dd>
      </dl>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">Requirements</h3>
        {claim.capacity &&
        Object.keys(claim.capacity).length > 0 ? (
          <dl className="kv-list-page__detail-grid">
            {Object.entries(claim.capacity).map(([k, v]) => (
              <ResourceRow key={k} label={k} value={v} />
            ))}
          </dl>
        ) : (
          <p className="kv-list-page__muted">No capacity summary available.</p>
        )}
      </section>

      {linkedNode && (
        <section className="kv-list-page__detail-section">
          <h3 className="kv-list-page__detail-section-title">
            Linked Node
          </h3>
          <dl className="kv-list-page__detail-grid">
            <dt className="kv-list-page__detail-label">Name</dt>
            <dd className="kv-list-page__detail-value">{linkedNode.name}</dd>
            <dt className="kv-list-page__detail-label">CPU</dt>
            <dd className="kv-list-page__detail-value">
              {linkedNode.cpuCapacity ?? '—'}
            </dd>
            <dt className="kv-list-page__detail-label">Memory</dt>
            <dd className="kv-list-page__detail-value">
              {linkedNode.memoryCapacity ?? '—'}
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}

function ResourceRow({
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
