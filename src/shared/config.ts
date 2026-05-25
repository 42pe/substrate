import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { SubstrateError } from '../core/errors.js';
import type { Config } from '../core/types.js';
import { paths } from './paths.js';

/**
 * Zod schema for `.substrate/config.json`. Used both at read time (validate
 * what's on disk) and at write time (validate what we're about to persist).
 */
const ConfigSchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string().min(1),
  schema_version: z.number().int().positive(),
  created_at: z.string().min(1),
});

/**
 * Read `.substrate/config.json` from the given root.
 *
 * Throws:
 *   - SubstrateError.notFound      if the file does not exist
 *   - SubstrateError.internalError if the file is malformed JSON
 *   - SubstrateError.internalError if the file's shape doesn't match the schema
 */
export async function readConfig(root: string): Promise<Config> {
  const p = paths(root).config;
  let raw: string;
  try {
    raw = await readFile(p, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw SubstrateError.notFound(
        `No .substrate/config.json at ${p}. Run 'substrate init' in the project root.`,
      );
    }
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw SubstrateError.internalError(`Malformed .substrate/config.json: ${(e as Error).message}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw SubstrateError.internalError('Invalid .substrate/config.json shape', {
      issues: result.error.issues,
    });
  }
  return result.data;
}

/**
 * Write `.substrate/config.json` atomically (in spirit — uses a single
 * `writeFile` which is atomic enough for v1 since config is written only at
 * `init`). Validates against the schema before writing.
 */
export async function writeConfig(root: string, config: Config): Promise<void> {
  const validated = ConfigSchema.parse(config);
  const p = paths(root).config;
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
}
