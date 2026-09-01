import { useMemo } from 'react';
import type {
  NodeClaimSummary,
  NodePoolSummary,
  NodeSummary,
  PodSummary,
  TopologyResponse,
} from '@shared/types';
import TopologyNode, { type TopologyNodeBadge } from './TopologyNode';

export type SelectionId =
  | { kind: 'NodePool'; name: string }
  | { kind: 'NodeClaim'; name: string }
  | { kind: 'Node'; name: string }
  | { kind: 'Pod'; name: string; namespace: string };

export interface TopologyTreeProps {
  data: TopologyResponse;
  expandedNodePools: ReadonlySet<string>;
  expandedNodeClaims: ReadonlySet<string>;
  expandedNodes: ReadonlySet<string>;
  selectedKey: string | null;
  onToggleNodePool: (name: string) => void;
  onToggleNodeClaim: (name: string) => void;
  onToggleNode: (name: string) => void;
  onSelect: (id: SelectionId) => void;
}

/**
 * Builds the NodePool → NodeClaim → Node → Pod hierarchy from the
 * topology response and renders it using `TopologyNode`.
 *
 * Children are matched by `nodePool` (NodeClaim), `nodeName` (Node),
 * and `nodeName` (Pod). Items whose parent is missing are still
 * rendered, but attached to a synthetic root bucket so they remain
 * visible in the UI.
 */
export default function TopologyTree(props: TopologyTreeProps): JSX.Element {
  const {
    data,
    expandedNodePools,
    expandedNodeClaims,
    expandedNodes,
    selectedKey,
    onToggleNodePool,
    onToggleNodeClaim,
    onToggleNode,
    onSelect,
  } = props;

  const grouped = useMemo(() => groupByParent(data), [data]);

  if (data.nodePools.length === 0) {
    return (
      <div className="kv-topology-tree kv-topology-tree--empty" data-testid="topology-tree">
        <p className="kv-topology-tree__empty">No NodePools found.</p>
      </div>
    );
  }

  return (
    <div className="kv-topology-tree" data-testid="topology-tree">
      {data.nodePools.map((np) => {
        const expanded = expandedNodePools.has(np.name);
        return (
          <TopologyNode
            key={np.name}
            kind="NodePool"
            name={np.name}
            testId="topology-node-pool"
            uid={np.uid}
            meta={`${countDescendants(np, grouped)} children`}
            badges={buildNodePoolBadges(np)}
            hasChildren
            expanded={expanded}
            selected={selectedKey === makeKey({ kind: 'NodePool', name: np.name })}
            onToggle={() => onToggleNodePool(np.name)}
            onSelect={() =>
              onSelect({ kind: 'NodePool', name: np.name })
            }
            depth={0}
          >
            {expanded
              ? renderNodeClaims(
                  grouped.claimsByPool[np.name] ?? [],
                  grouped,
                  expandedNodeClaims,
                  expandedNodes,
                  selectedKey,
                  onToggleNodeClaim,
                  onToggleNode,
                  onSelect,
                )
              : null}
          </TopologyNode>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Grouped {
  claimsByPool: Record<string, NodeClaimSummary[]>;
  nodesByClaim: Record<string, NodeSummary[]>;
  podsByNode: Record<string, PodSummary[]>;
  orphanNodeClaims: NodeClaimSummary[];
  orphanNodes: NodeSummary[];
  orphanPods: PodSummary[];
}

function groupByParent(data: TopologyResponse): Grouped {
  const claimsByPool: Record<string, NodeClaimSummary[]> = {};
  const orphanNodeClaims: NodeClaimSummary[] = [];
  const poolNames = new Set(data.nodePools.map((p) => p.name));
  for (const claim of data.nodeClaims) {
    const pool = claim.nodePool;
    if (pool && poolNames.has(pool)) {
      (claimsByPool[pool] = claimsByPool[pool] ?? []).push(claim);
    } else {
      orphanNodeClaims.push(claim);
    }
  }

  const nodesByClaim: Record<string, NodeSummary[]> = {};
  const orphanNodes: NodeSummary[] = [];
  const claimNames = new Set(data.nodeClaims.map((c) => c.name));
  for (const node of data.nodes) {
    const claim = node.nodeClaim;
    if (claim && claimNames.has(claim)) {
      (nodesByClaim[claim] = nodesByClaim[claim] ?? []).push(node);
    } else {
      orphanNodes.push(node);
    }
  }

  const podsByNode: Record<string, PodSummary[]> = {};
  const orphanPods: PodSummary[] = [];
  const nodeNames = new Set(data.nodes.map((n) => n.name));
  for (const pod of data.pods) {
    const node = pod.nodeName;
    if (node && nodeNames.has(node)) {
      (podsByNode[node] = podsByNode[node] ?? []).push(pod);
    } else {
      orphanPods.push(pod);
    }
  }

  return { claimsByPool, nodesByClaim, podsByNode, orphanNodeClaims, orphanNodes, orphanPods };
}

function countDescendants(
  pool: NodePoolSummary,
  grouped: Grouped,
): number {
  const claims = grouped.claimsByPool[pool.name] ?? [];
  let count = claims.length;
  for (const claim of claims) {
    const nodes = grouped.nodesByClaim[claim.name] ?? [];
    count += nodes.length;
    for (const node of nodes) {
      count += (grouped.podsByNode[node.name] ?? []).length;
    }
  }
  return count;
}

function renderNodeClaims(
  claims: NodeClaimSummary[],
  grouped: Grouped,
  expandedClaims: ReadonlySet<string>,
  expandedNodes: ReadonlySet<string>,
  selectedKey: string | null,
  onToggleClaim: (n: string) => void,
  onToggleNode: (n: string) => void,
  onSelect: (id: SelectionId) => void,
): JSX.Element {
  return (
    <>
      {claims.map((claim) => {
        const expanded = expandedClaims.has(claim.name);
        const nodes = grouped.nodesByClaim[claim.name] ?? [];
        return (
          <TopologyNode
            key={claim.name}
            kind="NodeClaim"
            name={claim.name}
            testId="topology-node-claim"
            uid={claim.uid}
            meta={nodes.length > 0 ? `${nodes.length} nodes` : undefined}
            badges={buildNodeClaimBadges(claim)}
            hasChildren
            expanded={expanded}
            selected={selectedKey === makeKey({ kind: 'NodeClaim', name: claim.name })}
            onToggle={() => onToggleClaim(claim.name)}
            onSelect={() =>
              onSelect({ kind: 'NodeClaim', name: claim.name })
            }
            depth={1}
          >
            {expanded
              ? renderNodes(
                  nodes,
                  grouped,
                  expandedNodes,
                  selectedKey,
                  onToggleNode,
                  onSelect,
                )
              : null}
          </TopologyNode>
        );
      })}
    </>
  );
}

function renderNodes(
  nodes: NodeSummary[],
  grouped: Grouped,
  expandedNodes: ReadonlySet<string>,
  selectedKey: string | null,
  onToggleNode: (n: string) => void,
  onSelect: (id: SelectionId) => void,
): JSX.Element {
  return (
    <>
      {nodes.map((node) => {
        const expanded = expandedNodes.has(node.name);
        const pods = grouped.podsByNode[node.name] ?? [];
        return (
          <TopologyNode
            key={node.name}
            kind="Node"
            name={node.name}
            testId="topology-node"
            uid={node.uid}
            meta={
              pods.length > 0 ? `${pods.length} pods` : undefined
            }
            badges={buildNodeBadges(node)}
            hasChildren
            expanded={expanded}
            selected={selectedKey === makeKey({ kind: 'Node', name: node.name })}
            onToggle={() => onToggleNode(node.name)}
            onSelect={() =>
              onSelect({ kind: 'Node', name: node.name })
            }
            depth={2}
          >
            {expanded ? renderPods(pods, selectedKey, onSelect) : null}
          </TopologyNode>
        );
      })}
    </>
  );
}

function renderPods(
  pods: PodSummary[],
  selectedKey: string | null,
  onSelect: (id: SelectionId) => void,
): JSX.Element {
  return (
    <>
      {pods.map((pod) => (
        <TopologyNode
          key={`${pod.namespace}/${pod.name}`}
          kind="Pod"
          name={pod.name}
          testId="topology-pod"
          uid={pod.uid}
          meta={pod.namespace}
          badges={buildPodBadges(pod)}
          hasChildren={false}
          expanded={false}
          selected={
            selectedKey ===
            makeKey({ kind: 'Pod', name: pod.name, namespace: pod.namespace })
          }
          onToggle={() => {
            /* no children */
          }}
          onSelect={() =>
            onSelect({ kind: 'Pod', name: pod.name, namespace: pod.namespace })
          }
          depth={3}
        />
      ))}
    </>
  );
}

function buildNodePoolBadges(np: NodePoolSummary): TopologyNodeBadge[] {
  const badges: TopologyNodeBadge[] = [];
  if (np.weight !== undefined) {
    badges.push({ label: `weight ${np.weight}`, variant: 'info' });
  }
  if (np.nodeClassRef?.name) {
    badges.push({
      label: np.nodeClassRef.name,
      variant: 'info',
    });
  }
  return badges;
}

function buildNodeClaimBadges(c: NodeClaimSummary): TopologyNodeBadge[] {
  const badges: TopologyNodeBadge[] = [];
  if (c.capacityType && c.capacityType !== 'unknown') {
    badges.push({
      label: c.capacityType,
      variant: c.capacityType === 'spot' ? 'spot' : 'on-demand',
    });
  }
  if (c.instanceType) {
    badges.push({ label: c.instanceType, variant: 'default' });
  }
  if (c.zone) {
    badges.push({ label: c.zone, variant: 'info' });
  }
  return badges;
}

function buildNodeBadges(n: NodeSummary): TopologyNodeBadge[] {
  const badges: TopologyNodeBadge[] = [];
  if (n.capacityType && n.capacityType !== 'unknown') {
    badges.push({
      label: n.capacityType,
      variant: n.capacityType === 'spot' ? 'spot' : 'on-demand',
    });
  }
  if (n.instanceType) {
    badges.push({ label: n.instanceType, variant: 'default' });
  }
  if (n.zone) {
    badges.push({ label: n.zone, variant: 'info' });
  }
  badges.push({
    label: n.ready ? 'ready' : 'not-ready',
    variant: n.ready ? 'ready' : 'warning',
  });
  return badges;
}

function buildPodBadges(p: PodSummary): TopologyNodeBadge[] {
  return [
    {
      label: p.phase,
      variant:
        p.phase === 'Running'
          ? 'ready'
          : p.phase === 'Pending'
            ? 'warning'
            : 'default',
    },
  ];
}

function makeKey(id: SelectionId): string {
  if (id.kind === 'Pod') return `Pod:${id.namespace}/${id.name}`;
  return `${id.kind}:${id.name}`;
}

export function selectionKey(id: SelectionId): string {
  return makeKey(id);
}
