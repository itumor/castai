import { useMemo, useState } from 'react';
import useApi from '../hooks/useApi';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import ResourceTable, {
  type ResourceTableColumn,
} from '../components/ResourceTable';
import type { EventSummary } from '@shared/types';

const MESSAGE_TRUNCATE_LIMIT = 80;

function truncate(value: string, limit = MESSAGE_TRUNCATE_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

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

function formatTime(timestamp?: string, eventTime?: string): string {
  const value = timestamp ?? eventTime;
  if (!value) return '—';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  return new Date(t).toLocaleString();
}

/**
 * Read-only event stream page. Supports two client-side filters:
 *   - Involved object kind (dropdown, populated from the dataset).
 *   - Reason text (substring match).
 */
export default function Events(): JSX.Element {
  const events = useApi<EventSummary[]>('/events');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [reasonFilter, setReasonFilter] = useState<string>('');

  const all = events.data ?? [];

  const kinds = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const e of all) {
      if (e.involvedObject?.kind) set.add(e.involvedObject.kind);
    }
    return Array.from(set).sort();
  }, [all]);

  const filtered = useMemo<EventSummary[]>(() => {
    const needle = reasonFilter.trim().toLowerCase();
    return all.filter((e) => {
      if (kindFilter !== 'all' && e.involvedObject?.kind !== kindFilter) {
        return false;
      }
      if (needle && !e.reason.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [all, kindFilter, reasonFilter]);

  if (events.loading) {
    return (
      <section className="kv-page" data-testid="page-events">
        <h1 className="kv-page__title">Events</h1>
        <Loading label="Loading events..." />
      </section>
    );
  }

  if (events.error) {
    return (
      <section className="kv-page" data-testid="page-events">
        <h1 className="kv-page__title">Events</h1>
        <ErrorMessage error={events.error} title="Failed to load events" />
      </section>
    );
  }

  const columns: ResourceTableColumn<EventSummary>[] = [
    {
      key: 'time',
      header: 'Time',
      sortValue: (row) =>
        Date.parse(row.lastTimestamp ?? row.eventTime ?? '') || 0,
      render: (row) => (
        <span
          title={
            row.lastTimestamp ?? row.eventTime ?? row.firstTimestamp ?? ''
          }
        >
          {formatAge(row.lastTimestamp ?? row.eventTime, row.ageSeconds)}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: (row) => row.type,
      render: (row) => (
        <span
          className={
            row.type === 'Warning'
              ? 'kv-event-list__badge kv-event-list__badge--warning'
              : 'kv-event-list__badge kv-event-list__badge--normal'
          }
        >
          {row.type}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      sortValue: (row) => row.reason,
    },
    {
      key: 'object',
      header: 'Object',
      sortValue: (row) =>
        `${row.involvedObject?.kind ?? ''}/${row.involvedObject?.name ?? ''}`,
      render: (row) => (
        <span className="kv-list-page__event-row">
          {row.involvedObject?.kind ? (
            <>
              <span className="kv-event-list__kind">
                {row.involvedObject.kind}
              </span>
              <span>{row.involvedObject.name}</span>
            </>
          ) : (
            <span className="kv-list-page__muted">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      sortValue: (row) => row.message,
      render: (row) => (
        <span
          className="kv-list-page__message"
          title={row.message}
        >
          {truncate(row.message)}
        </span>
      ),
    },
  ];

  return (
    <section className="kv-page" data-testid="page-events">
      <h1 className="kv-page__title">Events</h1>
      <p className="kv-page__description">
        Karpenter-related events (NodeClaims, Nodes, NodePools, Pods).
        Filter by involved object kind and reason.
      </p>

      <div className="kv-list-page__filters">
        <label className="kv-list-page__filter-label">
          Kind
          <select
            className="kv-list-page__select"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            data-testid="events-kind-filter"
          >
            <option value="all">all</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="kv-list-page__filter-label">
          Reason
          <input
            type="search"
            className="kv-list-page__text-input"
            placeholder="Filter by reason"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            data-testid="events-reason-filter"
          />
        </label>
        <span className="kv-list-page__muted">
          {filtered.length} of {all.length}
        </span>
      </div>

      <ResourceTable
        columns={columns}
        data={filtered}
        keyField={(row) => {
          const when = row.lastTimestamp ?? row.firstTimestamp ?? row.eventTime ?? '';
          return `${row.involvedObject?.kind ?? 'unknown'}/${row.involvedObject?.name ?? 'unknown'}/${when}/${row.reason}`;
        }}
        emptyMessage="No events match the current filters."
        filterPlaceholder="Search messages…"
      />
    </section>
  );
}
