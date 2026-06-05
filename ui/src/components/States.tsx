import type { ReactNode } from 'react';
import { Card, CardContent } from './ui/Card.js';

/**
 * Shared status surfaces. Every page composes these so loading / empty /
 * error / not-found are visually consistent and never silently skipped
 * (a reviewer focus for Phase 5b).
 */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="py-12 text-center text-sm text-neutral-500">{label}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-medium text-neutral-700">{title}</p>
        {hint ? <p className="mt-1 text-sm text-neutral-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ErrorCard({ error }: { error: Error }) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="py-8">
        <p className="text-sm font-medium text-red-700">Something went wrong</p>
        <p className="mt-1 break-words text-sm text-red-600">{error.message}</p>
      </CardContent>
    </Card>
  );
}

export function NotFound({ what = 'page', children }: { what?: string; children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="text-sm font-medium text-neutral-700">Not found</p>
        <p className="mt-1 text-sm text-neutral-500">
          {children ?? `The requested ${what} does not exist.`}
        </p>
      </CardContent>
    </Card>
  );
}
