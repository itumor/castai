import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  title?: string;
}

/**
 * Small inline badge used to surface status / label / capacity type.
 *
 * Variants map to colour palettes defined in `index.css` and never
 * encode semantics on their own — consumers choose the variant that
 * matches the meaning they want to communicate.
 */
export default function Badge({
  children,
  variant = 'default',
  title,
}: BadgeProps): JSX.Element {
  const variantClass =
    variant === 'default' ? '' : `kv-badge--${variant}`;
  return (
    <span
      className={`kv-badge ${variantClass}`.trim()}
      data-testid="badge"
      data-variant={variant}
      title={title}
    >
      {children}
    </span>
  );
}
