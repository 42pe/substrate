import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmrf } from '../../../../tests/helpers/tmp.js';
import { mkdtemp } from 'node:fs/promises';
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
import { listEvents } from '../../../storage/repositories/events.js';
import type { ToolDeps } from '../../deps.js';
import type { Board, Config, Substrate } from '../../../core/types.js';

const fixtureConfig: Config = {
  project_id: '00000000-0000-4000-8000-000000000001',
  project_name: 'TestProject',
  description: '',
  version: 1,
  schema_version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
};

// Board 'b' with group 'g' and a `severity` enum field, so create_task's
// substrate validation passes for the happy-path tests.
const fixtureBoard: Board = {
  id: 'b',
  name: 'Board B',
  description: '',
  field_schema: { task: { severity: { type: 'enum', values: ['low', 'high'] } }, comments: {} },
  groups: [
    {
      id: 'g',
      name: 'Group',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
    {
      id: 'g-archived',
      name: 'Archived Group',
      description: '',
      position: 1,
      color: null,
      version: 1,
      archived_at: '2026-05-10T00:00:00.000Z',
    },
  ],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: null,
};

// An archived board (with an active group) for the archived-target tests.
const archivedBoard: Board = {
  id: 'b-arch',
  name: 'Archived Board',
  description: '',
  field_schema: { task: {}, comments: {} },
  groups: [
    {
      id: 'g',
      name: 'Group',
      description: '',
      position: 0,
      color: null,
      version: 1,
      archived_at: null,
    },
  ],
  policies: [],
  version: 1,
  created_at: '2026-05-09T00:00:00.000Z',
  updated_at: '2026-05-09T00:00:00.000Z',
  archived_at: '2026-05-10T00:00:00.000Z',
};

const fixtureSubstrate: Substrate = {
  config: fixtureConfig,
  boards: [fixtureBoard, archivedBoard],
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
      loadSubstrate: () => Promise.resolve(fixtureSubstrate),
      root: '/tmp/substrate-test',
    };
  });

  afterEach(async () => {
    client.close();
    await rmrf(dir);
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

  it('emits a created TaskEvent atomically with the row', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'with event',
      agent_name: 'a',
      custom_data: { severity: 'high' },
    });
    if (!env.ok) throw new Error('expected success');
    const { results } = await listEvents(client, env.applied.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.event_type).toBe('created');
    expect(results[0]!.changes).toMatchObject({
      initial_state: {
        board_id: 'b',
        group_id: 'g',
        title: 'with event',
        custom_data: { severity: 'high' },
      },
    });
  });

  it('rejects an unknown board with not_found', async () => {
    const env = await call({ board_id: 'ghost', group_id: 'g', title: 'x', agent_name: 'a' });
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toMatchObject({ entity: 'board', id: 'ghost' });
  });

  it('rejects creating a task on an archived board with conflict', async () => {
    const env = await call({ board_id: 'b-arch', group_id: 'g', title: 'x', agent_name: 'a' });
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
    expect(env.error.details).toMatchObject({ entity: 'board', id: 'b-arch' });
  });

  it('rejects creating a task in an archived group with conflict', async () => {
    const env = await call({ board_id: 'b', group_id: 'g-archived', title: 'x', agent_name: 'a' });
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('conflict');
    expect(env.error.details).toMatchObject({ entity: 'group', id: 'g-archived' });
  });

  it('rejects an unknown group with not_found', async () => {
    const env = await call({ board_id: 'b', group_id: 'ghost', title: 'x', agent_name: 'a' });
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('not_found');
    expect(env.error.details).toMatchObject({ entity: 'group', id: 'ghost' });
  });

  it('rejects custom_data that violates field_schema with schema_violation', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
      custom_data: { severity: 'urgent' }, // not in enum [low, high]
    });
    if (env.ok) throw new Error('expected error');
    expect(env.error.code).toBe('schema_violation');
  });

  it('accepts custom_data keys not declared in field_schema (free-form)', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
      custom_data: { undeclared: 123 },
    });
    expect(env.ok).toBe(true);
  });

  it('does not persist a task when field validation fails', async () => {
    const env = await call({
      board_id: 'b',
      group_id: 'g',
      title: 'x',
      agent_name: 'a',
      custom_data: { severity: 'urgent' },
    });
    if (env.ok) throw new Error('expected error');
    const rows = await client.execute('SELECT COUNT(*) AS n FROM tasks');
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(0);
  });
});

describe('createTaskHandler — policy engine', () => {
  let client: Client;
  let dir: string;
  let deps: ToolDeps;

  const policyBoard: Board = {
    ...fixtureBoard,
    policies: [
      {
        id: 'resp-1',
        name: 'Auth Responsibility',
        description: '',
        type: 'agent_responsibility',
        definition: {
          when: [{ field: 'task.title', op: 'matches_any_keyword', values: ['auth', 'login'] }],
          message: 'May relate to auth tasks.',
        },
        priority: 0,
        enabled: true,
        version: 1,
        created_by_agent: 'tester',
        created_at: '2026-05-09T00:00:00.000Z',
        updated_at: '2026-05-09T00:00:00.000Z',
        archived_at: null,
      },
    ],
  };
  const policySubstrate: Substrate = { config: fixtureConfig, boards: [policyBoard] };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'substrate-create-policy-'));
    client = await openDatabaseAndMigrate(join(dir, '.substrate', 'data.sqlite'));
    deps = {
      client,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(policySubstrate),
      root: '/tmp/substrate-test',
    };
  });
  afterEach(async () => {
    client.close();
    await rmrf(dir);
  });

  it('surfaces a matching agent_responsibility on create', async () => {
    const env = await createTaskHandler(
      { board_id: 'b', group_id: 'g', title: 'Fix login', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    const fired = {
      policy_id: 'resp-1',
      policy_name: 'Auth Responsibility',
      policy_type: 'agent_responsibility',
      message: 'May relate to auth tasks.',
    };
    expect(env.policies_fired).toContainEqual(fired);

    // The engagement is persisted in the `created` event (countable later).
    const { results } = await listEvents(client, env.applied.id);
    expect(results).toHaveLength(1);
    expect(results[0]!.changes).toMatchObject({ policies_fired: [fired] });
  });

  it('fires no responsibility when the title does not match', async () => {
    const env = await createTaskHandler(
      { board_id: 'b', group_id: 'g', title: 'Unrelated work', agent_name: 'a' },
      deps,
    );
    if (!env.ok) throw new Error('expected success');
    expect(env.policies_fired).toEqual([]);

    // No engagement → no `policies_fired` key on the event (keeps it clean).
    const { results } = await listEvents(client, env.applied.id);
    expect(results[0]!.changes).not.toHaveProperty('policies_fired');
  });
});

describe('createTaskHandler — unknown error handling (C3)', () => {
  it('returns a generic internal_error envelope and does NOT leak the underlying message', async () => {
    // Stub client whose .execute throws a non-SubstrateError with a secret-y message.
    // create_task now writes inside withTransaction, so the throwing surface is
    // the transaction's execute (the row insert), not the bare client.
    const stubClient = {
      transaction: () =>
        Promise.resolve({
          execute: () => {
            throw new Error('libsql failed: connection string was hunter2@db.internal/secrets');
          },
          commit: () => Promise.resolve(),
          rollback: () => Promise.resolve(),
        }),
      execute: () => Promise.resolve({ rows: [] }),
      close: () => undefined,
    } as unknown as Client;

    const deps: ToolDeps = {
      client: stubClient,
      config: fixtureConfig,
      loadSubstrate: () => Promise.resolve(fixtureSubstrate),
      root: '/tmp/substrate-test',
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
