import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateTask } from './tools/write/create-task.js';
import { registerUpdateTask } from './tools/write/update-task.js';
import { registerArchiveTask } from './tools/write/archive-task.js';
import { registerUnarchiveTask } from './tools/write/unarchive-task.js';
import { registerWhoami } from './tools/read/whoami.js';
import { registerGetProject } from './tools/read/get-project.js';
import { registerListBoards } from './tools/read/list-boards.js';
import { registerGetBoardSubstrate } from './tools/read/get-board-substrate.js';
import { registerListTasks } from './tools/read/list-tasks.js';
import { registerGetTask } from './tools/read/get-task.js';
import { registerGetTaskHistory } from './tools/read/get-task-history.js';
import { registerListComments } from './tools/read/list-comments.js';
import { registerGetComment } from './tools/read/get-comment.js';
import type { ToolDeps } from './deps.js';

/**
 * Single place that lists Substrate's MCP tools. New tools land here as later
 * phases ship them (Phase 2: full read singletons + write singletons land in
 * Steps 5-6; Phase 3: adds `reverse_captcha` stub; Phase 4: substrate-edit
 * tools).
 *
 * The order of registration is the order tools appear in `tools/list` — reads
 * first (whoami leads, as the bootstrap call), then writes.
 */
export function registerAllTools(server: McpServer, deps: ToolDeps): void {
  // Read tools
  registerWhoami(server, deps);
  registerGetProject(server, deps);
  registerListBoards(server, deps);
  registerGetBoardSubstrate(server, deps);
  registerListTasks(server, deps);
  registerGetTask(server, deps);
  registerGetTaskHistory(server, deps);
  registerListComments(server, deps);
  registerGetComment(server, deps);

  // Write tools (singletons) — task writes (Step 5); comment writes land in Step 6.
  registerCreateTask(server, deps);
  registerUpdateTask(server, deps);
  registerArchiveTask(server, deps);
  registerUnarchiveTask(server, deps);
}
