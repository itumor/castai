import type { EventSummary } from '@shared/types';

export interface EventListProps {
  events: EventSummary[];
  limit?: number;
}

const MESSAGE_TRUNCATE = 140;

/**
 * Renders a table of Kubernetes events filtered to Karpenter-related
 * objects. Long messages are truncated with the full text exposed via
 * the `title` attribute on hover.
 */
export default function EventList({
  events,
  limit,
}: EventListProps): JSX.Element {
  const items = Array.isArray(events) ? events : [];
  const visible = typeof limit === 'number' ? items.slice(0, limit) : items;

  if (visible.length === 0) {
    return (
      <div className="kv-event-list kv-event-list--empty" data-testid="event-list">
        <p className="kv-event-list__empty">No recent events.</p>
      </div>
    );
  }

  return (
    <div className="kv-event-list" data-testid="event-list">
      <table className="kv-event-list__table">
        <thead>
          <tr>
            <th scope="col">Age</th>
            <th scope="col">Type</th>
            <th scope="col">Reason</th>
            <th scope="col">Involved Object</th>
            <th scope="col">Message</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((event, idx) => (
            <EventRow key={eventKey(event, idx)} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }): JSX.Element {
  const age = formatRelativeTime(event.lastTimestamp ?? event.eventTime ?? event.firstTimestamp);
  const fullMessage = event.message || '';
  const truncated =
    fullMessage.length > MESSAGE_TRUNCATE
      ? `${fullMessage.slice(0, MESSAGE_TRUNCATE - 1)}…`
      : fullMessage;
  const involved = event.involvedObject ?? { kind: '', name: '' };
  return (
    <tr className="kv-event-list__row" data-testid="event-row">
      <td className="kv-event-list__cell kv-event-list__cell--age">{age}</td>
      <td className="kv-event-list__cell kv-event-list__cell--type">
        <span className={`kv-event-list__badge kv-event-list__badge--${event.type.toLowerCase()}`}>
          {event.type}
        </span>
      </td>
      <td className="kv-event-list__cell kv-event-list__cell--reason">{event.reason}</td>
      <td className="kv-event-list__cell kv-event-list__cell--involved">
        <span className="kv-event-list__kind">{involved.kind}</span>
        <span className="kv-event-list__name">{involved.name}</span>
      </td>
      <td
        className="kv-event-list__cell kv-event-list__cell--message"
        title={fullMessage}
      >
        {truncated}
      </td>
    </tr>
  );
}

function eventKey(event: EventSummary, idx: number): string {
  const inv = event.involvedObject ?? {};
  return `${event.lastTimestamp ?? event.eventTime ?? ''}-${inv.kind ?? ''}-${inv.name ?? ''}-${idx}`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return 'unknown';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(t).toLocaleDateString();
}
