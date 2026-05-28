import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { z } from 'zod';
import {
  createTaskHandler,
  createTaskSchema,
  createTaskShape,
  type CreateTaskInput,
} from './create-task.js';
import { openDatabaseAndMigrate } from '../../../storage/client.js';
import { getTask } from '../../../storage/repositories/tasks.js';
import type { ToolDeps } from '../../deps.js';
import type { Config } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  schema_version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
};

describe('createTaskSchema (input validation)', () => {
  it('accepts a minimal valid payload', () => {
    const result = createTaskSchema.safeParse({
      board_id: 'b',
      group_id: 'g',
      title: 'Hello',
      agent_name: 'tester',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing agent_name', () => {
    const result = createTaskSchema.safeParse({
      board_id: 'b',
      group_id: 'g',
      title: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = createTaskSchema.safeParse({
      board_id: 'b',
      group_id: 'g',
      title: '',
      agent_name: 'tester',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty agent_name', () => {
    const result = createTaskSchema.safeParse({
      board_id: 'b',
      group_id: 'g',
      title: 'Hello',
      agent_name: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional description, parent_id, custom_data', () => {
    const result = createTaskSchema.safeParse({
      board_id: 'b',
      group_id: 'g',
      title: 'Hello',
      agent_name: 'tester',
      description: 'desc',
      parent_id: 'parent-1',
      custom_data: { priority: 'high' },
    });
    expect(result.success).toBe(true);
  });
});

describe('createTaskHandler', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-create-task-'));
    const dbPath = join(dir, '.substrate', 'data.sqlite');
    client = await openDatabaseAndMigrate(dbPath);
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [] }),
    };
  });

  afterEach(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function call(input: CreateTaskInput) {
    return createTaskHandler(input, deps);
  }

  it('returns a success envelope with the created task', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'First task',
      agent_name: 'tester',
    });
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.entity).toBe('task');
    expect(env.applied.version).toBe(1);
    expect(env.applied.state.title).toBe('First task');
    expect(env.applied.state.created_by_agent).toBe('tester');
    expect(env.policies_fired).toEqual([]);
  });

  it('generates a UUID for id', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
    });
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('defaults optional fields per Phase 1 spec', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
    });
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.description).toBe('');
    expect(env.applied.state.custom_data).toEqual({});
    expect(env.applied.state.parent_id).toBeNull();
    expect(env.applied.state.origin_task_id).toBeNull();
    expect(env.applied.state.archived_at).toBeNull();
  });

  it('preserves provided optional fields', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
      description: 'a description',
      parent_id: 'parent-1',
      custom_data: { tags: ['a', 'b'] },
    });
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.description).toBe('a description');
    expect(env.applied.state.parent_id).toBe('parent-1');
    expect(env.applied.state.custom_data).toEqual({ tags: ['a', 'b'] });
  });

  it('persists to SQLite (round-trip via getTask)', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'persisted',
      agent_name: 'a',
    });
    if (!env.ok) throw new Error('expected success');
    const read = await getTask(client, env.applied.id);
    expect(read.title).toBe('persisted');
    expect(read.id).toBe(env.applied.id);
  });

  it('emits created_at == updated_at on creation', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
    });
    if (!env.ok) throw new Error('expected success');
    expect(env.applied.state.created_at).toBe(env.applied.state.updated_at);
  });
});

describe('createTaskHandler — unknown error handling (C3)', () => {
  it('returns a generic internal_error envelope and does NOT leak the underlying message', async () => {
    // Stub client whose .execute throws a non-SubstrateError with a secret-y message.
    const stubClient = {
      execute: () => {
        throw new Error('libsql failed: connection string was hunter2@db.internal/secrets');
      },
      close: () => undefined,
    } as unknown as Client;

    const deps: ToolDeps = {
      client: stubClient,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve({ config: fixtureConfig, boards: [] }),
    };

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const env = await createTaskHandler(
      { board_id: 'b', group_id: 'g', title: 't', agent_name: 'a' },
      deps,
    );

    if (env.ok) throw new Error('expected error envelope');
    expect(env.error.code).toBe('internal_error');
    expect(env.error.message).toBe('Internal error');
    // Critical: the underlying message must not appear in the envelope
    expect(env.error.message).not.toContain('hunter2');
    expect(env.error.message).not.toContain('libsql');
    expect(env.error.message).not.toContain('db.internal');

    // But the server-side log SHOULD have it for debugging
    const logCall = errorSpy.mock.calls[0]?.[0] as string;
    expect(logCall).toContain('Unhandled error in create_task handler');
    expect(logCall).toContain('hunter2'); // confirm scrubbing of the *message* only, not the log

    errorSpy.mockRestore();
  });
});

// Snapshot test on the schema shape — guards the MCP tools/list contract.
// When this snapshot needs updating, the input contract has changed and
// agent configs / docs may need to follow.
describe('create_task input schema (contract)', () => {
  it('matches the locked Phase 1 contract', () => {
    // We reconstruct the ZodObject for snapshotting (the shape is passed to
    // McpServer.tool() as a raw shape, but Zod wraps it the same way we do).
    const schema = z.object(createTaskShape);
    const keys = Object.keys(schema.shape).sort();
    expect(keys).toMatchInlineSnapshot(`
      [
        "agent_name",
        "board_id",
        "custom_data",
        "description",
        "group_id",
        "parent_id",
        "title",
      ]
    `);

    // Required vs optional split is part of the contract.
    const requiredKeys = keys.filter((k) => {
      const field = schema.shape[k as keyof typeof schema.shape];
      // Zod 4: optional() wraps the inner type; .isOptional() exists on the wrapper
      return !field.isOptional();
    });
    expect(requiredKeys.sort()).toMatchInlineSnapshot(`
      [
        "agent_name",
        "board_id",
        "group_id",
        "title",
      ]
    `);
  });
});
