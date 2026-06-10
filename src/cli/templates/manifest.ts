import { z } from 'zod';

/**
 * `substrate-template.json` — the manifest at the root of a shared substrate
 * template (Phase 8). Describes a workflow-only bundle: 1+ board files, NO
 * runtime (no tasks/comments/DB).
 *
 * `.strict()` is deliberate (C4): an unknown key is a hard error, not a warning.
 * Strict-now is conservative — *relaxing* later (accepting a new optional key)
 * is always backward-safe, whereas *tightening* later would break templates
 * that relied on the laxity. Accepted cost: a template authored against a
 * future optional field fails on an older binary (loudly, naming the key).
 *
 * `version` is **author metadata only** — echoed in the preview, never enforced,
 * never compared to `BINARY_VERSION` or anything in the target substrate.
 * `homepage`/`source` are informational and **never fetched** (the CLI is
 * network-free; the agent does any cloning).
 */
export const TemplateManifestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    boards: z.array(z.string().min(1)).min(1),
    author: z.string().optional(),
    homepage: z.string().optional(),
    source: z.string().optional(),
  })
  .strict();

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;
