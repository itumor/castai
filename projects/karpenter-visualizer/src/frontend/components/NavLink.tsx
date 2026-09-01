import { NavLink as RouterNavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface NavLinkProps {
  to: string;
  label: string;
  end?: boolean;
  children?: ReactNode;
}

/**
 * Wraps React Router's NavLink and applies an `active` class when the route matches.
 */
export default function NavLink({ to, label, end = false }: NavLinkProps): JSX.Element {
  return (
    <RouterNavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        isActive ? 'kv-nav-link kv-nav-link--active' : 'kv-nav-link'
      }
    >
      {label}
    </RouterNavLink>
  );
}
