import { useEffect, useState } from 'react';

interface HealthResponse {
  ok: boolean;
  version: string;
  schema_version: number;
  uptime_ms: number;
}

/**
 * Phase 1 minimal UI shell.
 *
 * Fetches /api/health and renders the server's reported version + schema +
 * uptime. Proves the client-server pipeline composes end-to-end:
 * Vite-built React → Hono /api/health → BINARY_VERSION constant on the
 * server. Phase 5 will expand this with real routing (TanStack Router),
 * board/task views, and a substrate inspector.
 */
export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (r) => {
        // Reviewer C2 fix — check r.ok before parsing. Otherwise a 500
        // returning the error envelope would silently pass the type
        // assertion and render `undefined`s.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as HealthResponse;
      })
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch((e: unknown) => {
        // Reviewer C3 fix — promise rejections are unknown-typed.
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Substrate</h1>
      <p className="mt-2 text-neutral-600">Local-first agent-collaborative substrate.</p>

      <section className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Server status
        </h2>
        {error ? (
          <p className="mt-3 text-red-600">Failed to reach /api/health: {error}</p>
        ) : health === null ? (
          <p className="mt-3 text-neutral-500">Connecting…</p>
        ) : (
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-neutral-500">Version</dt>
            <dd className="font-mono">{health.version}</dd>
            <dt className="text-neutral-500">Schema</dt>
            <dd className="font-mono">v{health.schema_version}</dd>
            <dt className="text-neutral-500">Uptime</dt>
            <dd className="font-mono">{Math.round(health.uptime_ms / 1000)}s</dd>
          </dl>
        )}
      </section>

      <p className="mt-8 text-sm text-neutral-500">
        Phase 1 walking skeleton. Full UI (boards, tasks, substrate inspector) lands in Phase 5.
      </p>
    </main>
  );
}
