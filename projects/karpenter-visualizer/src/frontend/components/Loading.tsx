export interface LoadingProps {
  label?: string;
}

/**
 * Lightweight loading indicator. Uses an aria-busy spinner for accessibility.
 */
export default function Loading({ label = 'Loading...' }: LoadingProps): JSX.Element {
  return (
    <div className="kv-loading" role="status" aria-live="polite" data-testid="kv-loading">
      <span className="kv-loading__spinner" aria-hidden="true" />
      <span className="kv-loading__label">{label}</span>
    </div>
  );
}
