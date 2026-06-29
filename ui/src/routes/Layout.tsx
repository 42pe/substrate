import { useState } from 'react';
import { Link, NavLink, Outlet, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { cn } from '../lib/cn.js';
import { ErrorCard } from '../components/States.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-2.5 py-1.5 transition hover:text-foreground',
    isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
  );

/** Light/dark toggle. Initial theme is set pre-paint by the inline script in
 *  index.html (localStorage override, else OS preference); this just flips it. */
function ThemeToggle() {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('substrate-theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        {dark ? (
          <circle cx="12" cy="12" r="4">
            <animate attributeName="r" begin="0s" />
          </circle>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        )}
        {dark ? (
          <g stroke="currentColor">
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </g>
        ) : null}
      </svg>
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only rounded-md bg-card px-3 py-2 text-sm shadow focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          <Link to="/" className="shrink-0 text-lg font-semibold tracking-tight">
            Substrate
          </Link>
          <nav aria-label="Primary" className="flex gap-1 text-sm">
            <NavLink to="/" end className={navClass}>
              Overview
            </NavLink>
            <NavLink to="/boards" className={navClass}>
              Boards
            </NavLink>
            <NavLink to="/activity" className={navClass}>
              Activity
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              read-only inspector
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

export function Layout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Router-level error boundary (bad route, unexpected render throw). */
export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : 'Unexpected error';
  return (
    <Shell>
      <ErrorCard error={new Error(message)} />
    </Shell>
  );
}
