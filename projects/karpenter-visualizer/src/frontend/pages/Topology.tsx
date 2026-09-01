import { useCallback, useState, type ReactNode } from 'react';
import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import TopologyTree, {
  selectionKey,
  type SelectionId,
} from '../components/TopologyTree';
import type { TopologyResponse } from '@shared/types';

/**
 * Topology page. Renders a clickable NodePool → NodeClaim → Node → Pod
 * tree on the left and a details panel on the right for the currently
 * selected item.
 */
export default function Topology(): JSX.Element {
  const { data, loading, error, refetch } = useApi<TopologyResponse>('/topology');

  const [expandedNodePools, setExpandedNodePools] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [expandedNodeClaims, setExpandedNodeClaims] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selection, setSelection] = useState<SelectionId | null>(null);

  const toggleNodePool = useCallback((name: string): void => {
    setExpandedNodePools((prev) => toggleSet(prev, name));
  }, []);
  const toggleNodeClaim = useCallback((name: string): void => {
    setExpandedNodeClaims((prev) => toggleSet(prev, name));
  }, []);
  const toggleNode = useCallback((name: string): void => {
    setExpandedNodes((prev) => toggleSet(prev, name));
  }, []);
  const select = useCallback((id: SelectionId): void => {
    setSelection((prev) => {
      if (prev && selectionKey(prev) === selectionKey(id)) return null;
      return id;
    });
  }, []);

  const selectedKey = selection ? selectionKey(selection) : null;

  if (loading) {
    return (
      <section className="kv-page" data-testid="topology-page">
        <h1 className="kv-page__title">Topology</h1>
        <Loading label="Loading topology..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="kv-page" data-testid="topology-page">
        <h1 className="kv-page__title">Topology</h1>
        <ErrorMessage error={error} title="Failed to load topology" />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="kv-page" data-testid="topology-page">
        <h1 className="kv-page__title">Topology</h1>
        <p className="kv-page__description">No topology data available.</p>
      </section>
    );
  }

  const isEmpty =
    data.nodePools.length === 0 &&
    data.nodeClaims.length === 0 &&
    data.nodes.length === 0 &&
    data.pods.length === 0;

  if (isEmpty) {
    return (
      <section className="kv-page" data-testid="topology-page">
        <h1 className="kv-page__title">Topology</h1>
        <p className="kv-page__description">
          The cluster has no Karpenter-managed workloads yet. Once a
          NodePool exists, its NodeClaims, Nodes, and Pods will appear
          here.
        </p>
        <button
          type="button"
          className="kv-topology__refresh"
          onClick={refetch}
          data-testid="topology-refresh"
        >
          Refresh
        </button>
      </section>
    );
  }

  return (
    <section className="kv-page kv-topology" data-testid="topology-page">
      <header className="kv-topology__header">
        <div>
          <h1 className="kv-page__title">Topology</h1>
          <p className="kv-page__description">
            Click the chevron to expand or collapse a level. Click the
            name to view details in the panel on the right.
          </p>
        </div>
        <button
          type="button"
          className="kv-topology__refresh"
          onClick={refetch}
          data-testid="topology-refresh"
        >
          Refresh
        </button>
      </header>

      <div className="kv-topology__body">
        <div className="kv-topology__tree-pane">
          <TopologyTree
            data={data}
            expandedNodePools={expandedNodePools}
            expandedNodeClaims={expandedNodeClaims}
            expandedNodes={expandedNodes}
            selectedKey={selectedKey}
            onToggleNodePool={toggleNodePool}
            onToggleNodeClaim={toggleNodeClaim}
            onToggleNode={toggleNode}
            onSelect={select}
          />
        </div>
        <div className="kv-topology__detail-pane">
          <DetailPanel selection={selection} data={data} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  selection: SelectionId | null;
  data: TopologyResponse;
}

function DetailPanel({ selection, data }: DetailPanelProps): JSX.Element {
  if (!selection) {
    return (
      <div
        className="kv-detail-panel kv-detail-panel--empty"
        data-testid="detail-panel"
      >
        <p className="kv-detail-panel__empty">
          Select an item from the tree to see its details.
        </p>
      </div>
    );
  }

  if (selection.kind === 'NodePool') {
    const np = data.nodePools.find((p) => p.name === selection.name);
    if (!np) return emptyDetail('NodePool not found.');
    return <NodePoolDetails np={np} classes={data.ec2NodeClasses} />;
  }
  if (selection.kind === 'NodeClaim') {
    const nc = data.nodeClaims.find((c) => c.name === selection.name);
    if (!nc) return emptyDetail('NodeClaim not found.');
    return <NodeClaimDetails claim={nc} />;
  }
  if (selection.kind === 'Node') {
    const node = data.nodes.find((n) => n.name === selection.name);
    if (!node) return emptyDetail('Node not found.');
    return <NodeDetails node={node} />;
  }
  const pod = data.pods.find(
    (p) => p.name === selection.name && p.namespace === selection.namespace,
  );
  if (!pod) return emptyDetail('Pod not found.');
  return <PodDetails pod={pod} />;
}

function emptyDetail(message: string): JSX.Element {
  return (
    <div
      className="kv-detail-panel kv-detail-panel--empty"
      data-testid="detail-panel"
    >
      <p className="kv-detail-panel__empty">{message}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}): JSX.Element {
  return (
    <div className="kv-detail-panel__row">
      <dt className="kv-detail-panel__label">{label}</dt>
      <dd className="kv-detail-panel__value">{value ?? '—'}</dd>
    </div>
  );
}

function NodePoolDetails({
  np,
  classes,
}: {
  np: import('@shared/types').NodePoolSummary;
  classes: import('@shared/types').EC2NodeClassSummary[];
}): JSX.Element {
  const relatedClass = np.nodeClassRef?.name
    ? classes.find((c) => c.name === np.nodeClassRef?.name)
    : undefined;
  const reqCount = Array.isArray(np.requirements) ? np.requirements.length : 0;
  return (
    <dl className="kv-detail-panel" data-testid="detail-panel">
      <h2 className="kv-detail-panel__title">NodePool: {np.name}</h2>
      <DetailRow label="Kind" value="NodePool" />
      <DetailRow label="Name" value={np.name} />
      <DetailRow label="Namespace" value={np.namespace} />
      <DetailRow label="UID" value={np.uid} />
      <DetailRow
        label="Status"
        value={summariseStatus(np.status)}
      />
      <DetailRow label="Created" value={np.creationTimestamp} />
      <DetailRow
        label="Weight"
        value={np.weight !== undefined ? String(np.weight) : undefined}
      />
      <DetailRow
        label="Limits"
        value={
          np.limits && Object.keys(np.limits).length > 0 ? (
            <code className="kv-detail-panel__code">
              {JSON.stringify(np.limits)}
            </code>
          ) : undefined
        }
      />
      <DetailRow
        label="Requirements"
        value={
          reqCount > 0 ? (
            <code className="kv-detail-panel__code">
              {reqCount} requirement{reqCount === 1 ? '' : 's'}
            </code>
          ) : (
            'no explicit requirements'
          )
        }
      />
      <DetailRow
        label="EC2NodeClass"
        value={
          relatedClass ? (
            <span>
              {np.nodeClassRef?.name} <em>({relatedClass.namespace})</em>
            </span>
          ) : (
            np.nodeClassRef?.name ?? '—'
          )
        }
      />
      <DetailRow
        label="Disruption"
        value={
          np.disruption && Object.keys(np.disruption).length > 0 ? (
            <code className="kv-detail-panel__code">
              {JSON.stringify(np.disruption)}
            </code>
          ) : undefined
        }
      />
      <DetailRow
        label="Conditions"
        value={
          np.conditions && np.conditions.length > 0 ? (
            <code className="kv-detail-panel__code">
              {np.conditions.length} condition
              {np.conditions.length === 1 ? '' : 's'}
            </code>
          ) : undefined
        }
      />
    </dl>
  );
}

function NodeClaimDetails({
  claim,
}: {
  claim: import('@shared/types').NodeClaimSummary;
}): JSX.Element {
  return (
    <dl className="kv-detail-panel" data-testid="detail-panel">
      <h2 className="kv-detail-panel__title">NodeClaim: {claim.name}</h2>
      <DetailRow label="Kind" value="NodeClaim" />
      <DetailRow label="Name" value={claim.name} />
      <DetailRow label="Namespace" value={claim.namespace} />
      <DetailRow label="UID" value={claim.uid} />
      <DetailRow
        label="NodePool"
        value={claim.nodePool}
      />
      <DetailRow label="Status" value={claim.phase ?? 'Unknown'} />
      <DetailRow label="Created" value={claim.creationTimestamp} />
      <DetailRow label="Capacity Type" value={claim.capacityType} />
      <DetailRow label="Instance Type" value={claim.instanceType} />
      <DetailRow label="Architecture" value={claim.architecture} />
      <DetailRow label="Zone" value={claim.zone} />
      <DetailRow label="Region" value={claim.region} />
      <DetailRow label="OS" value={claim.os} />
      <DetailRow
        label="Capacity"
        value={
          claim.capacity && Object.keys(claim.capacity).length > 0 ? (
            <code className="kv-detail-panel__code">
              {JSON.stringify(claim.capacity)}
            </code>
          ) : undefined
        }
      />
    </dl>
  );
}

function NodeDetails({
  node,
}: {
  node: import('@shared/types').NodeSummary;
}): JSX.Element {
  return (
    <dl className="kv-detail-panel" data-testid="detail-panel">
      <h2 className="kv-detail-panel__title">Node: {node.name}</h2>
      <DetailRow label="Kind" value="Node" />
      <DetailRow label="Name" value={node.name} />
      <DetailRow label="UID" value={node.uid} />
      <DetailRow label="Status" value={node.ready ? 'Ready' : 'NotReady'} />
      <DetailRow label="Created" value={node.creationTimestamp} />
      <DetailRow label="Capacity Type" value={node.capacityType} />
      <DetailRow label="Instance Type" value={node.instanceType} />
      <DetailRow label="Architecture" value={node.architecture} />
      <DetailRow label="Zone" value={node.zone} />
      <DetailRow label="Region" value={node.region} />
      <DetailRow label="OS" value={node.os} />
      <DetailRow label="NodeClaim" value={node.nodeClaim} />
      <DetailRow label="NodePool" value={node.nodePool} />
      <DetailRow label="CPU Capacity" value={node.cpuCapacity} />
      <DetailRow label="Memory Capacity" value={node.memoryCapacity} />
      <DetailRow label="Pod Capacity" value={node.podCapacity} />
      <DetailRow label="Schedulable" value={node.schedulable === false ? 'No' : 'Yes'} />
    </dl>
  );
}

function PodDetails({
  pod,
}: {
  pod: import('@shared/types').PodSummary;
}): JSX.Element {
  return (
    <dl className="kv-detail-panel" data-testid="detail-panel">
      <h2 className="kv-detail-panel__title">Pod: {pod.name}</h2>
      <DetailRow label="Kind" value="Pod" />
      <DetailRow label="Name" value={pod.name} />
      <DetailRow label="Namespace" value={pod.namespace} />
      <DetailRow label="UID" value={pod.uid} />
      <DetailRow label="Phase" value={pod.phase} />
      <DetailRow label="Node" value={pod.nodeName} />
      <DetailRow label="NodePool" value={pod.nodePool} />
      <DetailRow label="Owner" value={
        pod.ownerKind ? `${pod.ownerKind}/${pod.ownerName ?? ''}` : undefined
      } />
      <DetailRow label="Created" value={pod.creationTimestamp} />
    </dl>
  );
}

function summariseStatus(status: unknown): string {
  if (!status || typeof status !== 'object') return '—';
  const s = status as Record<string, any>;
  if (Array.isArray(s.conditions) && s.conditions.length > 0) {
    const ready = s.conditions.find((c: any) => c?.type === 'Ready');
    if (ready?.status) return `${ready.status === 'True' ? 'Ready' : 'NotReady'}`;
  }
  return 'Reported';
}

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
