import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import StatCard from '../components/StatCard';
import EventList from '../components/EventList';
import type { EventSummary, TopologyResponse } from '@shared/types';

const RECENT_EVENT_LIMIT = 10;

/**
 * Cluster-wide overview: top-level counts (NodePools / NodeClaims /
 * Nodes / Pods / Pending Pods / EC2NodeClasses) plus a snapshot of the
 * most recent Karpenter-related events.
 */
export default function Overview(): JSX.Element {
  const topology = useApi<TopologyResponse>('/topology');
  const events = useApi<EventSummary[]>('/events');

  if (topology.loading) {
    return (
      <section className="kv-page" data-testid="overview-page">
        <h1 className="kv-page__title">Overview</h1>
        <Loading label="Loading cluster summary..." />
      </section>
    );
  }

  if (topology.error) {
    return (
      <section className="kv-page" data-testid="overview-page">
        <h1 className="kv-page__title">Overview</h1>
        <ErrorMessage
          error={topology.error}
          title="Failed to load cluster summary"
        />
      </section>
    );
  }

  if (!topology.data) {
    return (
      <section className="kv-page" data-testid="overview-page">
        <h1 className="kv-page__title">Overview</h1>
        <p className="kv-page__description">No cluster data available.</p>
      </section>
    );
  }

  const summary = topology.data.cluster ?? {};
  const totalPods = topology.data.pods?.length ?? 0;
  const eventItems = events.data ?? [];

  return (
    <section className="kv-page" data-testid="overview-page">
      <h1 className="kv-page__title">Overview</h1>
      <p className="kv-page__description">
        Cluster-wide summary of nodes, NodePools, capacity, and recent
        Karpenter events.
      </p>

      <div className="kv-stat-grid" data-testid="overview-stats">
        <StatCard title="NodePools" value={summary.nodePoolCount} />
        <StatCard title="NodeClaims" value={summary.nodeClaimCount} />
        <StatCard title="Nodes" value={summary.nodeCount} />
        <StatCard title="Pods" value={totalPods} />
        <StatCard title="Pending Pods" value={summary.pendingPodCount} />
        <StatCard title="EC2NodeClasses" value={summary.ec2NodeClassCount} />
      </div>

      <section className="kv-overview__activity">
        <h2 className="kv-overview__section-title">Recent Karpenter Activity</h2>
        {events.loading ? (
          <Loading label="Loading recent events..." />
        ) : events.error ? (
          <ErrorMessage error={events.error} title="Failed to load events" />
        ) : (
          <EventList events={eventItems} limit={RECENT_EVENT_LIMIT} />
        )}
      </section>
    </section>
  );
}
