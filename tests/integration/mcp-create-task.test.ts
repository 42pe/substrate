import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { initCommand } from '../../src/cli/commands/init.js';
import { openClient } from '../../src/storage/client.js';
import { spawnCli } from '../helpers/spawn.js';

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

  it('lists the Phase 2 read tools plus create_task in tools/list', async () => {
    const response = await client.request('tools/list');
    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'create_task',
      'get_board_substrate',
      'get_comment',
      'get_project',
      'get_task',
      'get_task_history',
      'list_boards',
      'list_comments',
      'list_tasks',
      'whoami',
    ]);
  });

  it('create_task persists a row in data.sqlite', async () => {
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
    expect(payload.hints).toEqual([]);
  });
});
