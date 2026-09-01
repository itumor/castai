export interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
}

/**
 * Reusable stat card. Renders a large value with a small title and an
 * optional subtitle. The `data-testid` is slugified from the title so
 * tests can target individual cards (e.g. `stat-card-nodepools`).
 */
export default function StatCard({
  title,
  value,
  subtitle,
}: StatCardProps): JSX.Element {
  const testId = `stat-card-${slugify(title)}`;
  return (
    <div className="kv-stat-card" data-testid={testId}>
      <div className="kv-stat-card__title">{title}</div>
      <div className="kv-stat-card__value">{value}</div>
      {subtitle ? (
        <div className="kv-stat-card__subtitle">{subtitle}</div>
      ) : null}
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
