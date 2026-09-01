import type { ReactNode } from 'react';

export type TopologyKind = 'NodePool' | 'NodeClaim' | 'Node' | 'Pod';

export interface TopologyNodeBadge {
  label: string;
  variant?:
    | 'default'
    | 'spot'
    | 'on-demand'
    | 'ready'
    | 'pending'
    | 'warning'
    | 'info';
}

export interface TopologyNodeProps {
  kind: TopologyKind;
  name: string;
  testId: string;
  uid?: string;
  meta?: string;
  badges?: TopologyNodeBadge[];
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  children?: ReactNode;
  depth: number;
}

/**
 * Recursive row used in the Topology tree. Renders a chevron for
 * expand/collapse, a name button that opens the details panel, and
 * zero or more optional badges (status, capacity type, etc.).
 *
 * Pods have `hasChildren={false}` and therefore render a non-interactive
 * chevron placeholder; selecting their name still works.
 */
export default function TopologyNode(props: TopologyNodeProps): JSX.Element {
  const {
    kind,
    name,
    testId,
    meta,
    badges = [],
    hasChildren,
    expanded,
    selected,
    onToggle,
    onSelect,
    children,
    depth,
  } = props;

  const chevron = hasChildren ? (expanded ? '▾' : '▸') : '·';
  const rowClass = `kv-topology-node__row${
    selected ? ' kv-topology-node__row--selected' : ''
  }`;

  return (
    <div className="kv-topology-node" data-testid={testId}>
      <div className={rowClass} style={{ paddingLeft: `${0.25 + depth * 1.25}rem` }}>
        <button
          type="button"
          className="kv-topology-node__chevron"
          aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : 'No children'}
          aria-expanded={hasChildren ? expanded : undefined}
          onClick={hasChildren ? onToggle : undefined}
          disabled={!hasChildren}
          data-testid="expand-toggle"
        >
          {chevron}
        </button>
        <span
          className={`kv-topology-node__kind kv-topology-node__kind--${kind.toLowerCase()}`}
        >
          {kind}
        </span>
        <button
          type="button"
          className="kv-topology-node__name"
          onClick={onSelect}
          title={name}
        >
          {name}
        </button>
        {meta ? (
          <span className="kv-topology-node__meta">{meta}</span>
        ) : null}
        {badges.map((b, i) => (
          <span
            key={`${b.label}-${i}`}
            className={`kv-topology-node__badge kv-topology-node__badge--${
              b.variant ?? 'default'
            }`}
          >
            {b.label}
          </span>
        ))}
      </div>
      {hasChildren && expanded && children ? (
        <div className="kv-topology-node__children">{children}</div>
      ) : null}
    </div>
  );
}
