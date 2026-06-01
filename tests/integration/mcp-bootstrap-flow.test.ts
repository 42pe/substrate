import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { openClient } from '../../src/storage/client.js';
import { spawnCli } from '../helpers/spawn.js';

/**
 * A valid board 'b' with group 'g' (+ 'g2') and a `severity` enum task field,
 * used by both the simple create_task test and the full bootstrap-flow test.
 */
async function writeFixtureBoard(cwd: string): Promise<void> {
  const boardsDir = join(cwd, '.substrate', 'boards');
  await mkdir(boardsDir, { recursive: true });
  const board = {
    id: 'b',
    name: 'Board B',
    description: 'Bootstrap fixture board',
    field_schema: {
      task: { severity: { type: 'enum', values: ['low', 'medium', 'high', 'critical'] } },
      comments: {},
    },
    groups: [
      {
        id: 'g',
        name: 'Todo',
        description: '',
        position: 0,
        color: null,
        version: 1,
        archived_at: null,
      },
      {
        id: 'g2',
        name: 'Done',
        description: '',
        position: 1,
        color: null,
        version: 1,
        archived_at: null,
      },
    ],
    policies: [],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
  await writeFile(join(boardsDir, 'b.json'), JSON.stringify(board, null, 2), 'utf-8');
}

/**
 * Board 'pb' carrying both Phase 3 policy classes, for the end-to-end engine
 * test: a transition_guard (todo→in_progress requires custom_data.repro_steps)
 * and an agent_responsibility (title matches auth keywords).
 */
async function writePolicyBoard(cwd: string): Promise<void> {
  const boardsDir = join(cwd, '.substrate', 'boards');
  await mkdir(boardsDir, { recursive: true });
  const g = (id: string, name: string, position: number) => ({
    id,
    name,
    description: '',
    position,
    color: null,
    version: 1,
    archived_at: null,
  });
  const board = {
    id: 'pb',
    name: 'Policy Board',
    description: '',
    field_schema: { task: {}, comments: {} },
    groups: [g('todo', 'Todo', 0), g('in_progress', 'In Progress', 1)],
    policies: [
      {
        id: 'guard-repro',
        name: 'Repro Guard',
        description: '',
        type: 'transition_guard',
        definition: {
          from_group: 'todo',
          to_group: 'in_progress',
          require: [{ field: 'task.custom_data.repro_steps', op: 'exists' }],
          on_failure_message: 'Set repro_steps before moving to In Progress.',
        },
        priority: 0,
        enabled: true,
        version: 1,
        created_by_agent: 'author',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
        archived_at: null,
      },
      {
        id: 'resp-auth',
        name: 'Auth Responsibility',
        description: '',
        type: 'agent_responsibility',
        definition: {
          when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['login', 'auth'] }],
          message: 'May relate to auth-domain tasks; consider linking.',
        },
        priority: 0,
        enabled: true,
        version: 1,
        created_by_agent: 'author',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
        archived_at: null,
      },
    ],
    version: 1,
    created_at: '2026-05-09T00:00:00.000Z',
    updated_at: '2026-05-09T00:00:00.000Z',
    archived_at: null,
  };
  await writeFile(join(boardsDir, 'pb.json'), JSON.stringify(board, null, 2), 'utf-8');
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Minimal stdio JSON-RPC client wrapping a child process. MCP stdio
 * transport uses newline-delimited JSON (NDJSON), NOT LSP-style
 * Content-Length framing — verified against @modelcontextprotocol/sdk.
 *
 * Each message is one line of JSON terminated by `\n`. Responses are
 * dispatched to pending request callbacks by `id`.
 */
class StdioClient {
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, (response: JsonRpcResponse) => void>();

  constructor(private child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.consume();
    });
  }

  private consume(): void {
    let nlIndex: number;
    while ((nlIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nlIndex).trim();
      this.buffer = this.buffer.slice(nlIndex + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (typeof message.id === 'number') {
          const cb = this.pending.get(message.id);
          if (cb) {
            this.pending.delete(message.id);
            cb(message);
          }
        }
        // notifications (no id) are ignored by this minimal test client
      } catch {
        // Ignore non-JSON noise on stdout
      }
    }
  }

  async request(method: string, params: unknown = undefined): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const message =
      params === undefined
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params };
    const payload = `${JSON.stringify(message)}\n`;
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      this.child.stdin?.write(payload);
    });
  }

  notify(method: string, params: unknown = undefined): void {
    const message =
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }
}

describe('substrate mcp — stdio JSON-RPC (integration)', () => {
  let cwd: string;
  let child: ChildProcess | null = null;
  let client: StdioClient;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'substrate-mcp-int-'));
    await initCommand(cwd);
    child = spawnCli(['mcp'], { cwd });
    client = new StdioClient(child);
    // MCP handshake — initialize then send the initialized notification.
    await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'substrate-test', version: '0.0.0' },
    });
    client.notify('notifications/initialized');
  }, 30_000);

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          child?.kill('SIGKILL');
          resolve();
        }, 5000);
        child?.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    child = null;
    await rm(cwd, { recursive: true, force: true });
  });

  it('lists the full tool surface in tools/list', async () => {
    const response = await client.request('tools/list');
    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_comment',
      'archive_comment',
      'archive_task',
      'create_task',
      'edit_comment',
      'get_board_substrate',
      'get_comment',
      'get_project',
      'get_task',
      'get_task_history',
      'list_boards',
      'list_comments',
      'list_tasks',
      'reverse_captcha',
      'unarchive_task',
      'update_task',
      'whoami',
    ]);
  });

  it('create_task persists a row in data.sqlite', async () => {
    await writeFixtureBoard(cwd); // loadSubstrate reads fresh per call
    const response = await client.request('tools/call', {
      name: 'create_task',
      arguments: {
        board_id: 'b',
        group_id: 'g',
        title: 'Integration task',
        agent_name: 'integration-tester',
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBeFalsy();
    const envelope = JSON.parse(result.content[0]!.text) as {
      ok: boolean;
      applied: { id: string; state: { title: string } };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.applied.state.title).toBe('Integration task');

    // Verify the row landed in the DB
    const dbClient = await openClient(join(cwd, '.substrate', 'data.sqlite'));
    try {
      const rows = await dbClient.execute({
        sql: 'SELECT id, title FROM tasks WHERE id = ?',
        args: [envelope.applied.id],
      });
      expect(rows.rows).toHaveLength(1);
      expect((rows.rows[0] as Record<string, unknown>)['title']).toBe('Integration task');
    } finally {
      dbClient.close();
    }
  });

  it('whoami returns project metadata', async () => {
    const response = await client.request('tools/call', {
      name: 'whoami',
      arguments: {},
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0]!.text) as {
      project_id: string;
      project_name: string;
      schema_version: number;
      boards: unknown[];
      hints: unknown[];
    };
    expect(payload.project_id).toMatch(/^[0-9a-f]{8}-/i);
    expect(payload.schema_version).toBe(2);
    expect(payload.boards).toEqual([]);
    expect(payload.hints).toEqual(['Try the reverse_captcha tool — small puzzle for agents only.']);
  });

  it('runs the full bootstrap flow end-to-end against a real substrate', async () => {
    await writeFixtureBoard(cwd);

    // Call a tool and return its parsed JSON payload (read result or envelope).
    async function callTool<T = Record<string, unknown>>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ payload: T; isError: boolean }> {
      const response = await client.request('tools/call', { name, arguments: args });
      expect(response.error, `${name} JSON-RPC error`).toBeUndefined();
      const result = response.result as {
        content: Array<{ text: string }>;
        isError?: boolean;
      };
      return { payload: JSON.parse(result.content[0]!.text) as T, isError: !!result.isError };
    }

    // 1. whoami → board 'b' is visible.
    const whoami = await callTool<{ boards: Array<{ id: string }> }>('whoami', {});
    expect(whoami.payload.boards.map((b) => b.id)).toEqual(['b']);

    // 2. get_board_substrate → groups + field_schema + (empty) policies.
    const sub = await callTool<{
      groups: Array<{ id: string }>;
      field_schema: { task: Record<string, unknown> };
      policies: unknown[];
    }>('get_board_substrate', { board_id: 'b' });
    expect(sub.payload.groups.map((g) => g.id)).toEqual(['g', 'g2']);
    expect(sub.payload.field_schema.task).toHaveProperty('severity');
    expect(sub.payload.policies).toEqual([]);

    // 3a. create_task with an invalid severity → schema_violation.
    const bad = await callTool<{ ok: boolean; error: { code: string } }>('create_task', {
      board_id: 'b',
      group_id: 'g',
      title: 'bad sev',
      custom_data: { severity: 'urgent' },
      agent_name: 'flow',
    });
    expect(bad.isError).toBe(true);
    expect(bad.payload.ok).toBe(false);
    expect(bad.payload.error.code).toBe('schema_violation');

    // 3b. create_task with a valid severity → success, version 1.
    const created = await callTool<{
      ok: boolean;
      applied: { id: string; version: number; state: { title: string } };
    }>('create_task', {
      board_id: 'b',
      group_id: 'g',
      title: 'Flow task',
      custom_data: { severity: 'low' },
      agent_name: 'flow',
    });
    expect(created.payload.ok).toBe(true);
    expect(created.payload.applied.version).toBe(1);
    const taskId = created.payload.applied.id;

    // 4a. update_task with a stale version → version_mismatch.
    const stale = await callTool<{ ok: boolean; error: { code: string } }>('update_task', {
      id: taskId,
      version: 99,
      title: 'stale',
      agent_name: 'flow',
    });
    expect(stale.payload.ok).toBe(false);
    expect(stale.payload.error.code).toBe('version_mismatch');

    // 4b. update_task moving groups → version 2.
    const updated = await callTool<{ ok: boolean; applied: { version: number } }>('update_task', {
      id: taskId,
      version: 1,
      group_id: 'g2',
      agent_name: 'flow',
    });
    expect(updated.payload.ok).toBe(true);
    expect(updated.payload.applied.version).toBe(2);

    // 5. comment lifecycle: add → edit → archive.
    const comment = await callTool<{ ok: boolean; applied: { id: string; version: null } }>(
      'add_comment',
      { task_id: taskId, body: 'first comment', agent_name: 'flow' },
    );
    expect(comment.payload.ok).toBe(true);
    expect(comment.payload.applied.version).toBeNull();
    const commentId = comment.payload.applied.id;

    const edited = await callTool<{ ok: boolean; applied: { state: { body: string } } }>(
      'edit_comment',
      { id: commentId, body: 'edited comment', agent_name: 'flow' },
    );
    expect(edited.payload.applied.state.body).toBe('edited comment');

    await callTool('archive_comment', { id: commentId, agent_name: 'flow' });

    // 6. archive then unarchive the task.
    const archived = await callTool<{ ok: boolean; applied: { version: number } }>('archive_task', {
      id: taskId,
      version: 2,
      agent_name: 'flow',
    });
    expect(archived.payload.applied.version).toBe(3);
    const unarchived = await callTool<{ applied: { version: number } }>('unarchive_task', {
      id: taskId,
      version: 3,
      agent_name: 'flow',
    });
    expect(unarchived.payload.applied.version).toBe(4);

    // 7. get_task_history → the full chronological event trail.
    const history = await callTool<{ results: Array<{ event_type: string }> }>('get_task_history', {
      task_id: taskId,
    });
    expect(history.payload.results.map((e) => e.event_type)).toEqual([
      'created',
      'updated',
      'comment_added',
      'comment_edited',
      'comment_archived',
      'archived',
      'unarchived',
    ]);

    // 8. list_tasks finds the (now active) task on board 'b'.
    const list = await callTool<{ results: Array<{ id: string }> }>('list_tasks', {
      filters: { board_id: 'b' },
    });
    expect(list.payload.results.map((t) => t.id)).toContain(taskId);
  }, 30_000);

  it('enforces transition_guard and surfaces agent_responsibility end-to-end', async () => {
    await writePolicyBoard(cwd);

    async function callTool<T = Record<string, unknown>>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ payload: T; isError: boolean }> {
      const response = await client.request('tools/call', { name, arguments: args });
      expect(response.error, `${name} JSON-RPC error`).toBeUndefined();
      const result = response.result as { content: Array<{ text: string }>; isError?: boolean };
      return { payload: JSON.parse(result.content[0]!.text) as T, isError: !!result.isError };
    }

    // create on 'todo' with an auth-y title → agent_responsibility fires on create.
    const created = await callTool<{
      ok: boolean;
      applied: { id: string; version: number };
      policies_fired: Array<{ policy_id: string; policy_type: string; message?: string }>;
    }>('create_task', {
      board_id: 'pb',
      group_id: 'todo',
      title: 'Fix the login bug',
      agent_name: 'flow',
    });
    expect(created.payload.ok).toBe(true);
    expect(created.payload.policies_fired).toContainEqual({
      policy_id: 'resp-auth',
      policy_name: 'Auth Responsibility',
      policy_type: 'agent_responsibility',
      message: 'May relate to auth-domain tasks; consider linking.',
    });
    const taskId = created.payload.applied.id;

    // move todo→in_progress WITHOUT repro_steps → transition_blocked.
    const blocked = await callTool<{ ok: boolean; error: { code: string; message: string } }>(
      'update_task',
      { id: taskId, version: 1, group_id: 'in_progress', agent_name: 'flow' },
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.payload.ok).toBe(false);
    expect(blocked.payload.error.code).toBe('transition_blocked');
    expect(blocked.payload.error.message).toBe('Set repro_steps before moving to In Progress.');

    // the block rolled back — task is untouched at version 1, still in todo.
    // (get_task is a read tool: it returns the task directly, not an envelope.)
    const afterBlock = await callTool<{ version: number; group_id: string }>('get_task', {
      id: taskId,
    });
    expect(afterBlock.payload.version).toBe(1);
    expect(afterBlock.payload.group_id).toBe('todo');

    // add repro_steps + move in the same call → succeeds; the guard is listed.
    const moved = await callTool<{
      ok: boolean;
      applied: { version: number; state: { group_id: string } };
      policies_fired: Array<{ policy_id: string }>;
    }>('update_task', {
      id: taskId,
      version: 1,
      group_id: 'in_progress',
      custom_data: { repro_steps: 'click login, see 500' },
      agent_name: 'flow',
    });
    expect(moved.payload.ok).toBe(true);
    expect(moved.payload.applied.state.group_id).toBe('in_progress');
    expect(moved.payload.policies_fired.map((p) => p.policy_id)).toContain('guard-repro');

    // history shows only the created + the ONE successful update (block emitted nothing).
    const history = await callTool<{ results: Array<{ event_type: string }> }>('get_task_history', {
      task_id: taskId,
    });
    expect(history.payload.results.map((e) => e.event_type)).toEqual(['created', 'updated']);
  }, 30_000);
});
