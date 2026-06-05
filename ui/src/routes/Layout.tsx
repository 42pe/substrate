import { Link, NavLink, Outlet, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { cn } from '../lib/cn.js';
import { ErrorCard } from '../components/States.js';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-2 py-1 transition hover:text-neutral-900',
    isActive ? 'font-medium text-neutral-900' : 'text-neutral-500',
  );

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            Substrate
          </Link>
          <nav className="flex gap-2 text-sm">
            <NavLink to="/" end className={navClass}>
              Overview
            </NavLink>
            <NavLink to="/boards" className={navClass}>
              Boards
            </NavLink>
          </nav>
          <span className="ml-auto text-xs text-neutral-400">read-only inspector</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
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
