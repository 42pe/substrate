import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import { BINARY_VERSION } from '../../../core/version.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: whoami — the bootstrap call.
 *
 * Returns project metadata plus a summary of every board in the substrate
 * (including archived ones — agents should see the whole namespace). No task
 * or group counts: those drift constantly, so an agent that needs them calls
 * `list_tasks` / `get_board_substrate` for a fresh read.
 *
 * `hints` is `[]` in Phase 2; Phase 3 populates the easter-egg pointer. The
 * key is present now to lock the shape.
 */

export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  archived_at: string | null;
  version: number;
}

export interface WhoamiResult {
  project_id: string;
  project_name: string;
  schema_version: number;
  phase: string;
  boards: BoardSummary[];
  hints: string[];
}

// Kept in lockstep with BINARY_VERSION (src/core/version.ts). The leading
// `v${BINARY_VERSION}` is asserted by a test so this never silently drifts
// again (it sat at v0.0.3 through three releases before v0.1.0).
export const PHASE_STRING = `v${BINARY_VERSION} (shareable templates)`;

/** Easter-egg pointer surfaced in `whoami.hints` (Phase 3). */
export const REVERSE_CAPTCHA_HINT = 'Try the reverse_captcha tool — small puzzle for agents only.';

export async function whoamiHandler(deps: ToolDeps): Promise<WhoamiResult> {
  const substrate = await deps.loadSubstrate();
  return {
    project_id: deps.config.project_id,
    project_name: deps.config.project_name,
    schema_version: deps.config.schema_version,
    phase: PHASE_STRING,
    boards: substrate.boards.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      archived_at: b.archived_at,
      version: b.version,
    })),
    hints: [REVERSE_CAPTCHA_HINT],
  };
}

export const whoamiShape = {};
const whoamiSchema = z.object(whoamiShape);

export function registerWhoami(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'whoami',
    'Get your bearings: project metadata, summaries of every board you can see, and hints to follow. Call this first.',
    whoamiShape,
    wrapToolHandler('whoami', whoamiSchema, () => whoamiHandler(deps)),
  );
}
