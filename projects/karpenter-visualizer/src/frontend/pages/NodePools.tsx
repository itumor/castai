import { useMemo, useState } from 'react';
import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import ResourceTable, {
  type ResourceTableColumn,
} from '../components/ResourceTable';
import CodeBlock from '../components/CodeBlock';
import type {
  EC2NodeClassSummary,
  NodeClaimSummary,
  NodePoolSummary,
  NodeSummary,
} from '@shared/types';

interface NodePoolsPageData {
  nodePools: NodePoolSummary[];
  nodeClaims: NodeClaimSummary[];
  nodes: NodeSummary[];
  ec2NodeClasses: EC2NodeClassSummary[];
}

function formatAge(timestamp?: string): string {
  if (!timestamp) return '—';
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/**
 * List + detail page for Karpenter NodePools.
 *
 * Pulls NodePool, NodeClaim, Node, and EC2NodeClass payloads so the
 * detail panel can show related metadata without additional fetches.
 */
export default function NodePools(): JSX.Element {
  const nodePools = useApi<NodePoolSummary[]>('/nodepools');
  const ec2NodeClasses = useApi<EC2NodeClassSummary[]>('/ec2nodeclasses');
  const nodeClaims = useApi<NodeClaimSummary[]>('/nodeclaims');
  const nodes = useApi<NodeSummary[]>('/nodes');

  const [selectedName, setSelectedName] = useState<string | null>(null);

  const loading =
    nodePools.loading ||
    ec2NodeClasses.loading ||
    nodeClaims.loading ||
    nodes.loading;
  const error =
    nodePools.error ||
    ec2NodeClasses.error ||
    nodeClaims.error ||
    nodes.error;

  const data: NodePoolsPageData = {
    nodePools: nodePools.data ?? [],
    nodeClaims: nodeClaims.data ?? [],
    nodes: nodes.data ?? [],
    ec2NodeClasses: ec2NodeClasses.data ?? [],
  };

  const selected = useMemo<NodePoolSummary | null>(
    () =>
      selectedName
        ? data.nodePools.find((np) => np.name === selectedName) ?? null
        : null,
    [selectedName, data.nodePools],
  );

  if (loading) {
    return (
      <section className="kv-page" data-testid="page-nodepools">
        <h1 className="kv-page__title">NodePools</h1>
        <Loading label="Loading NodePools..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="kv-page" data-testid="page-nodepools">
        <h1 className="kv-page__title">NodePools</h1>
        <ErrorMessage error={error} title="Failed to load NodePools" />
      </section>
    );
  }

  const columns: ResourceTableColumn<NodePoolSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: (row) => row.name,
    },
    {
      key: 'nodeclass',
      header: 'NodeClass',
      sortValue: (row) => row.nodeClassRef?.name ?? '',
      render: (row) =>
        row.nodeClassRef?.name ? (
          row.nodeClassRef.name
        ) : (
          <span className="kv-list-page__muted">none</span>
        ),
    },
    {
      key: 'nodeCount',
      header: 'Node Count (est.)',
      sortValue: (row) => countNodesForPool(data, row.name),
      render: (row) => countNodesForPool(data, row.name),
    },
    {
      key: 'created',
      header: 'Creation Time',
      sortValue: (row) => row.creationTimestamp ?? '',
      render: (row) => formatAge(row.creationTimestamp),
    },
  ];

  return (
    <section className="kv-page" data-testid="page-nodepools">
      <header className="kv-list-page__header">
        <div>
          <h1 className="kv-page__title">NodePools</h1>
          <p className="kv-page__description">
            Karpenter NodePools with their requirements, limits, disruption
            configuration, and the EC2NodeClass they target.
          </p>
        </div>
      </header>

      <ResourceTable
        columns={columns}
        data={data.nodePools}
        keyField={(row) => row.name}
        onRowClick={(row) =>
          setSelectedName((prev) => (prev === row.name ? null : row.name))
        }
        emptyMessage="No NodePools found."
        filterPlaceholder="Filter NodePools…"
      />

      {selected && (
        <NodePoolDetailPanel
          pool={selected}
          data={data}
        />
      )}
    </section>
  );
}

function countNodesForPool(
  data: NodePoolsPageData,
  poolName: string,
): number {
  const claimNames = new Set<string>(
    data.nodeClaims
      .filter((c) => c.nodePool === poolName)
      .map((c) => c.name),
  );
  return data.nodes.filter(
    (n) => (n.nodePool === poolName) || (n.nodeClaim && claimNames.has(n.nodeClaim)),
  ).length;
}

function NodePoolDetailPanel({
  pool,
  data,
}: {
  pool: NodePoolSummary;
  data: NodePoolsPageData;
}): JSX.Element {
  const requirements = Array.isArray(pool.requirements)
    ? pool.requirements
    : [];
  const limits = pool.limits ?? {};
  const linkedClass = pool.nodeClassRef?.name
    ? data.ec2NodeClasses.find(
        (c) => c.name === pool.nodeClassRef?.name,
      ) ?? null
    : null;
  const nodeCount = countNodesForPool(data, pool.name);

  return (
    <div
      className="kv-list-page__detail"
      data-testid="nodepool-detail"
      data-nodepool={pool.name}
    >
      <h2 className="kv-list-page__detail-title">NodePool: {pool.name}</h2>

      <dl className="kv-list-page__detail-grid">
        <dt className="kv-list-page__detail-label">Name</dt>
        <dd className="kv-list-page__detail-value">{pool.name}</dd>
        <dt className="kv-list-page__detail-label">Namespace</dt>
        <dd className="kv-list-page__detail-value">{pool.namespace}</dd>
        <dt className="kv-list-page__detail-label">UID</dt>
        <dd className="kv-list-page__detail-value">{pool.uid ?? '—'}</dd>
        <dt className="kv-list-page__detail-label">Created</dt>
        <dd className="kv-list-page__detail-value">
          {pool.creationTimestamp ?? '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Weight</dt>
        <dd className="kv-list-page__detail-value">
          {pool.weight !== undefined ? String(pool.weight) : '—'}
        </dd>
        <dt className="kv-list-page__detail-label">Node Count (est.)</dt>
        <dd className="kv-list-page__detail-value">{nodeCount}</dd>
        <dt className="kv-list-page__detail-label">NodeClass</dt>
        <dd className="kv-list-page__detail-value">
          {pool.nodeClassRef?.name ?? '—'}
        </dd>
      </dl>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">Requirements</h3>
        {requirements.length === 0 ? (
          <p className="kv-list-page__muted">No explicit requirements.</p>
        ) : (
          <CodeBlock
            code={JSON.stringify(requirements, null, 2)}
            language="json"
          />
        )}
      </section>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">Limits</h3>
        {Object.keys(limits).length === 0 ? (
          <p className="kv-list-page__muted">No limits configured.</p>
        ) : (
          <CodeBlock
            code={JSON.stringify(limits, null, 2)}
            language="json"
          />
        )}
      </section>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">EC2NodeClass</h3>
        {!linkedClass ? (
          <p className="kv-list-page__muted">
            No linked EC2NodeClass summary available.
          </p>
        ) : (
          <dl className="kv-list-page__detail-grid">
            <dt className="kv-list-page__detail-label">Name</dt>
            <dd className="kv-list-page__detail-value">{linkedClass.name}</dd>
            <dt className="kv-list-page__detail-label">Namespace</dt>
            <dd className="kv-list-page__detail-value">
              {linkedClass.namespace}
            </dd>
            <dt className="kv-list-page__detail-label">AMI Family</dt>
            <dd className="kv-list-page__detail-value">
              {linkedClass.amiFamily ?? '—'}
            </dd>
            <dt className="kv-list-page__detail-label">IAM Role</dt>
            <dd className="kv-list-page__detail-value">
              {linkedClass.role ?? '—'}
            </dd>
            <dt className="kv-list-page__detail-label">Subnet Selectors</dt>
            <dd className="kv-list-page__detail-value">
              {linkedClass.subnetSelectorTerms}
            </dd>
            <dt className="kv-list-page__detail-label">Security Group Selectors</dt>
            <dd className="kv-list-page__detail-value">
              {linkedClass.securityGroupSelectorTerms}
            </dd>
            {linkedClass.amiSelectorTerms !== undefined && (
              <>
                <dt className="kv-list-page__detail-label">AMI Selectors</dt>
                <dd className="kv-list-page__detail-value">
                  {linkedClass.amiSelectorTerms}
                </dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section className="kv-list-page__detail-section">
        <h3 className="kv-list-page__detail-section-title">Raw Spec / Status</h3>
        <CodeBlock
          code={JSON.stringify(
            {
              spec: {
                weight: pool.weight,
                limits: pool.limits,
                requirements: pool.requirements,
                disruption: pool.disruption,
                nodeClassRef: pool.nodeClassRef,
              },
              status: pool.status ?? {},
            },
            null,
            2,
          )}
          language="json"
        />
      </section>
    </div>
  );
}
