import { z } from 'zod';

/**
 * Zod schemas for `.substrate/boards/<id>.json`.
 *
 * These mirror the `Board` / `Group` / `Policy` / `FieldSchema` interfaces in
 * `core/types.ts`. They are the strict on-disk contract: a board file that
 * doesn't match fails the whole substrate load (loader.ts). Structural checks
 * that span fields or boards (duplicate IDs, enum-without-values, dangling
 * group refs) live in `validator.ts`, not here — Zod validates one file's
 * shape, the validator validates the substrate's integrity.
 */

export const FieldSchemaEntrySchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'enum', 'markdown', 'string_list']),
  required: z.boolean().optional(),
  format: z.string().optional(),
  values: z.array(z.string()).optional(),
  // B3 (dogfood 2026-07-07): a human-only field — an agent's MCP write tools refuse
  // to set it; only a human channel (`substrate approve` / the UI) may. Lets a
  // `transition_guard` that requires such a field function as a real human-approval
  // gate rather than an honor-system one an autonomous agent can self-satisfy.
  human_only: z.boolean().optional(),
});

export const FieldSchemaSchema = z.object({
  task: z.record(z.string(), FieldSchemaEntrySchema),
  comments: z.record(z.string(), FieldSchemaEntrySchema),
});

export const GroupSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  position: z.number().int(),
  color: z.string().nullable(),
  version: z.number().int(),
  archived_at: z.string().nullable(),
});

export const PolicySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  type: z.enum(['transition_guard', 'agent_responsibility']),
  definition: z.record(z.string(), z.unknown()),
  priority: z.number().int(),
  enabled: z.boolean(),
  version: z.number().int(),
  created_by_agent: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
});

export const BoardSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  field_schema: FieldSchemaSchema,
  groups: z.array(GroupSchema),
  policies: z.array(PolicySchema),
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
});
