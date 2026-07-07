import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateTask } from './tools/write/create-task.js';
import { registerUpdateTask } from './tools/write/update-task.js';
import { registerArchiveTask } from './tools/write/archive-task.js';
import { registerUnarchiveTask } from './tools/write/unarchive-task.js';
import { registerAddComment } from './tools/write/add-comment.js';
import { registerEditComment } from './tools/write/edit-comment.js';
import { registerArchiveComment } from './tools/write/archive-comment.js';
import { registerWhoami } from './tools/read/whoami.js';
import { registerGetProject } from './tools/read/get-project.js';
import { registerListBoards } from './tools/read/list-boards.js';
import { registerGetBoardSubstrate } from './tools/read/get-board-substrate.js';
import { registerListTasks } from './tools/read/list-tasks.js';
import { registerGetTask } from './tools/read/get-task.js';
import { registerGetTaskHistory } from './tools/read/get-task-history.js';
import { registerListComments } from './tools/read/list-comments.js';
import { registerGetComment } from './tools/read/get-comment.js';
import { registerReverseCaptcha } from './tools/read/reverse-captcha.js';
import { registerCheckTransition } from './tools/read/check-transition.js';
import { registerListPendingApprovals } from './tools/read/list-pending-approvals.js';
import { registerUpdateProject } from './tools/write/update-project.js';
import { registerCreateBoard } from './tools/write/create-board.js';
import { registerUpdateBoard } from './tools/write/update-board.js';
import { registerArchiveBoard } from './tools/write/archive-board.js';
import { registerUnarchiveBoard } from './tools/write/unarchive-board.js';
import { registerCreateGroup } from './tools/write/create-group.js';
import { registerUpdateGroup } from './tools/write/update-group.js';
import { registerReorderGroups } from './tools/write/reorder-groups.js';
import { registerArchiveGroup } from './tools/write/archive-group.js';
import { registerCreatePolicy } from './tools/write/create-policy.js';
import { registerUpdatePolicy } from './tools/write/update-policy.js';
import { registerArchivePolicy } from './tools/write/archive-policy.js';
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
  registerReverseCaptcha(server, deps);
  registerCheckTransition(server, deps);
  registerListPendingApprovals(server, deps);

  // Write tools (singletons) — task writes (Step 5) + comment writes (Step 6).
  registerCreateTask(server, deps);
  registerUpdateTask(server, deps);
  registerArchiveTask(server, deps);
  registerUnarchiveTask(server, deps);
  registerAddComment(server, deps);
  registerEditComment(server, deps);
  registerArchiveComment(server, deps);

  // Substrate-edit tools (Phase 4): project + board (Step 2), group (Step 3),
  // policy (Step 4).
  registerUpdateProject(server, deps);
  registerCreateBoard(server, deps);
  registerUpdateBoard(server, deps);
  registerArchiveBoard(server, deps);
  registerUnarchiveBoard(server, deps);
  registerCreateGroup(server, deps);
  registerUpdateGroup(server, deps);
  registerReorderGroups(server, deps);
  registerArchiveGroup(server, deps);
  registerCreatePolicy(server, deps);
  registerUpdatePolicy(server, deps);
  registerArchivePolicy(server, deps);
}
