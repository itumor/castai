import { useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import NavLink from './NavLink';

interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/topology', label: 'Topology' },
  { to: '/nodepools', label: 'NodePools' },
  { to: '/nodeclaims', label: 'NodeClaims' },
  { to: '/nodes', label: 'Nodes' },
  { to: '/pending-pods', label: 'Pending Pods' },
  { to: '/events', label: 'Events' },
] as const;

/**
 * App shell with header, sidebar navigation, and main content area.
 * Sidebar collapses to a top bar on narrow screens.
 */
export default function Layout(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  return (
    <div
      className="kv-layout"
      data-testid="kv-layout"
      data-menu-open={menuOpen ? 'true' : 'false'}
    >
      <header className="kv-header">
        <button
          type="button"
          className="kv-header__menu-toggle"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          data-testid="kv-menu-toggle"
        >
          <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
        </button>
        <Link to="/" className="kv-header__title">
          Karpenter Visualizer
        </Link>
        <span className="kv-header__subtitle">read-only cluster view</span>
      </header>

      <div className="kv-body">
        <nav
          className="kv-sidebar"
          aria-label="Primary"
          data-testid="kv-sidebar"
        >
          <ul className="kv-nav">
            {NAV_ENTRIES.map((entry) => (
              <li key={entry.to} className="kv-nav__item">
                <NavLink to={entry.to} label={entry.label} end={entry.end} />
              </li>
            ))}
          </ul>
        </nav>

        <main className="kv-main" data-testid="kv-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
