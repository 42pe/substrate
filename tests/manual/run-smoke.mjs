#!/usr/bin/env node
// Manual MCP-client smoke runner (Procedure C from tests/manual/README.md).
//
// Uses the official @modelcontextprotocol/sdk `Client` + `StdioClientTransport`
// — the same SDK that MCP Inspector and most agent runtimes use internally.
// More rigorous than Procedure A (Inspector UI) because the assertions are
// programmatic, and more reproducible than Procedure B (Claude Code) because
// no LLM is in the loop.
//
// Run from the repo root:
//   node tests/manual/run-smoke.mjs
//
// Exit code 0 = PASS. Any non-zero = a step failed; stderr explains.
//
// What it does:
//   1. Initializes a fresh .substrate/ in a temp dir.
//   2. Spawns `npx tsx src/cli/index.ts mcp` via StdioClientTransport, cwd=tempdir.
//   3. SDK initialize handshake.
//   4. listTools() → asserts create_task + whoami both present.
//   5. callTool('whoami') → asserts project_id matches the temp substrate's.
//   6. callTool('create_task') → asserts envelope ok:true, returns task id.
//   7. Opens data.sqlite directly, asserts the row was persisted.
//   8. Clean shutdown.
//   9. Removes the temp dir.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_ENTRY = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');

function pad(label) {
  return label.padEnd(22, ' ');
}
function pass(label, detail = '') {
  console.log(`✓ ${pad(label)} ${detail}`);
}
function fail(label, detail = '') {
  console.error(`✗ ${pad(label)} ${detail}`);
  process.exitCode = 1;
}

const cwd = await mkdtemp(join(tmpdir(), 'substrate-manual-smoke-'));
console.log(`\n=== Manual MCP smoke (Procedure C) ===`);
console.log(`cwd: ${cwd}\n`);

try {
  // Step 1 — substrate init
  const initResult = spawnSync('npx', ['tsx', CLI_ENTRY, 'init'], { cwd, encoding: 'utf-8' });
  if (initResult.status !== 0) {
    fail('substrate init', `exit ${initResult.status}\n${initResult.stderr}`);
    process.exit(1);
  }
  pass('substrate init');

  const expectedConfig = JSON.parse(
    await readFile(join(cwd, '.substrate', 'config.json'), 'utf-8'),
  );

  // Step 1b — author a substrate board so the write tools have a real target.
  const boardsDir = join(cwd, '.substrate', 'boards');
  await mkdir(boardsDir, { recursive: true });
  await writeFile(
    join(boardsDir, 'smoke-board.json'),
    JSON.stringify(
      {
        id: 'smoke-board',
        name: 'Smoke Board',
        description: '',
        field_schema: {
          task: { severity: { type: 'enum', values: ['low', 'medium', 'high', 'critical'] } },
          comments: {},
        },
        groups: [
          {
            id: 'smoke-group',
            name: 'Todo',
            description: '',
            position: 0,
            color: null,
            version: 1,
            archived_at: null,
          },
          {
            id: 'done',
            name: 'Done',
            description: '',
            position: 1,
            color: null,
            version: 1,
            archived_at: null,
          },
        ],
        policies: [
          {
            id: 'guard-done',
            name: 'Done Guard',
            description: '',
            type: 'transition_guard',
            definition: {
              from_group: 'smoke-group',
              to_group: 'done',
              require: [{ field: 'task.custom_data.approved', op: 'eq', value: true }],
              on_failure_message: 'Approve before marking Done.',
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
      },
      null,
      2,
    ),
    'utf-8',
  );
  pass('author board');

  // Step 2 — connect MCP
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', CLI_ENTRY, 'mcp'],
    cwd,
  });
  const client = new Client({ name: 'manual-smoke', version: '0.0.0' });
  await client.connect(transport);
  pass(
    'connect MCP',
    `server: ${client.getServerVersion()?.name} v${client.getServerVersion()?.version}`,
  );

  // Step 3 — tools/list
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();
  const expected = [
    'add_comment',
    'archive_board',
    'archive_comment',
    'archive_group',
    'archive_policy',
    'archive_task',
    'create_board',
    'create_group',
    'create_policy',
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
    'reorder_groups',
    'reverse_captcha',
    'unarchive_board',
    'unarchive_task',
    'update_board',
    'update_group',
    'update_policy',
    'update_project',
    'update_task',
    'whoami',
  ];
  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    fail('tools/list', `got ${JSON.stringify(toolNames)}, expected ${JSON.stringify(expected)}`);
  } else {
    pass('tools/list', `${toolNames.length} tools`);
  }

  // Step 4 — whoami
  const whoamiRes = await client.callTool({ name: 'whoami', arguments: {} });
  const whoamiText = whoamiRes.content?.[0]?.text;
  if (!whoamiText) {
    fail('whoami', 'empty content');
  } else {
    const whoamiPayload = JSON.parse(whoamiText);
    if (whoamiPayload.project_id !== expectedConfig.project_id) {
      fail(
        'whoami',
        `project_id mismatch — server returned ${whoamiPayload.project_id}, config had ${expectedConfig.project_id}`,
      );
    } else if (whoamiPayload.schema_version !== 2) {
      fail('whoami', `schema_version=${whoamiPayload.schema_version}, expected 2`);
    } else {
      pass('whoami', `project_id ${whoamiPayload.project_id.slice(0, 8)}…`);
    }
  }

  // Step 5 — create_task
  const createRes = await client.callTool({
    name: 'create_task',
    arguments: {
      board_id: 'smoke-board',
      group_id: 'smoke-group',
      title: 'Hello from manual smoke',
      custom_data: { severity: 'low' },
      agent_name: 'manual-smoke-runner',
    },
  });
  if (createRes.isError) {
    fail('create_task', `isError flag set: ${createRes.content?.[0]?.text}`);
  } else {
    const envelope = JSON.parse(createRes.content[0].text);
    if (!envelope.ok) {
      fail('create_task', `envelope ok=false: ${JSON.stringify(envelope.error)}`);
    } else if (envelope.applied.state.title !== 'Hello from manual smoke') {
      fail('create_task', `title mismatch: ${envelope.applied.state.title}`);
    } else if (envelope.applied.version !== 1) {
      fail('create_task', `version=${envelope.applied.version}, expected 1`);
    } else if (envelope.applied.state.created_by_agent !== 'manual-smoke-runner') {
      fail(
        'create_task',
        `created_by_agent=${envelope.applied.state.created_by_agent}, expected manual-smoke-runner`,
      );
    } else if (!Array.isArray(envelope.policies_fired) || envelope.policies_fired.length !== 0) {
      // No agent_responsibility on this board → policies_fired is empty here.
      fail(
        'create_task',
        `policies_fired should be [] (no matching responsibility), got ${JSON.stringify(envelope.policies_fired)}`,
      );
    } else {
      pass('create_task', `task id ${envelope.applied.id.slice(0, 8)}…`);

      // Step 6 — SQLite persistence check via sqlite3 CLI
      const dbPath = join(cwd, '.substrate', 'data.sqlite');
      const sqlite = spawnSync(
        'sqlite3',
        [dbPath, `SELECT id || '|' || title FROM tasks WHERE id='${envelope.applied.id}'`],
        { encoding: 'utf-8' },
      );
      if (sqlite.status !== 0) {
        fail('sqlite persistence', `sqlite3 exit ${sqlite.status}: ${sqlite.stderr}`);
      } else {
        const row = sqlite.stdout.trim();
        const expectedRow = `${envelope.applied.id}|Hello from manual smoke`;
        if (row !== expectedRow) {
          fail('sqlite persistence', `got "${row}", expected "${expectedRow}"`);
        } else {
          pass('sqlite persistence', 'row visible via sqlite3');
        }
      }

      const taskId = envelope.applied.id;

      // Step 6b — update_task → version bumps to 2.
      const updateRes = await client.callTool({
        name: 'update_task',
        arguments: {
          id: taskId,
          version: 1,
          group_id: 'smoke-group',
          title: 'Updated',
          agent_name: 'manual-smoke-runner',
        },
      });
      const updateEnv = JSON.parse(updateRes.content[0].text);
      if (!updateEnv.ok || updateEnv.applied.version !== 2) {
        fail(
          'update_task',
          `expected ok + version 2, got ${JSON.stringify(updateEnv.applied ?? updateEnv.error)}`,
        );
      } else {
        pass('update_task', 'version → 2');
      }

      // Step 6c — add_comment → success envelope with version: null (no OCC).
      const commentRes = await client.callTool({
        name: 'add_comment',
        arguments: { task_id: taskId, body: 'a smoke comment', agent_name: 'manual-smoke-runner' },
      });
      const commentEnv = JSON.parse(commentRes.content[0].text);
      if (!commentEnv.ok) {
        fail('add_comment', `envelope ok=false: ${JSON.stringify(commentEnv.error)}`);
      } else if (commentEnv.applied.version !== null) {
        fail(
          'add_comment',
          `expected version: null, got ${JSON.stringify(commentEnv.applied.version)}`,
        );
      } else {
        pass('add_comment', 'version: null (no OCC)');
      }

      // Step 6d — get_task_history → created, updated, comment_added.
      const historyRes = await client.callTool({
        name: 'get_task_history',
        arguments: { task_id: taskId },
      });
      const historyPayload = JSON.parse(historyRes.content[0].text);
      const eventTypes = (historyPayload.results ?? []).map((e) => e.event_type);
      const expectedEvents = ['created', 'updated', 'comment_added'];
      if (JSON.stringify(eventTypes) !== JSON.stringify(expectedEvents)) {
        fail(
          'get_task_history',
          `got ${JSON.stringify(eventTypes)}, expected ${JSON.stringify(expectedEvents)}`,
        );
      } else {
        pass('get_task_history', eventTypes.join(' → '));
      }

      // Step 6e — transition_guard blocks an unapproved move to 'done'.
      const blockedRes = await client.callTool({
        name: 'update_task',
        arguments: { id: taskId, version: 2, group_id: 'done', agent_name: 'manual-smoke-runner' },
      });
      const blockedEnv = JSON.parse(blockedRes.content[0].text);
      if (blockedEnv.ok || blockedEnv.error?.code !== 'transition_blocked') {
        fail('transition_guard', `expected transition_blocked, got ${JSON.stringify(blockedEnv)}`);
      } else if (blockedEnv.error.message !== 'Approve before marking Done.') {
        fail('transition_guard', `unexpected message: ${blockedEnv.error.message}`);
      } else {
        pass('transition_guard', 'blocked unapproved → done');
      }
    }
  }

  // Step 6f — reverse_captcha returns the placeholder.
  const captchaRes = await client.callTool({ name: 'reverse_captcha', arguments: {} });
  const captchaEnv = JSON.parse(captchaRes.content[0].text);
  if (captchaEnv.error !== 'Coming in v0.1.0' || captchaEnv.about?.built_by !== 'Diego Ferreyra') {
    fail('reverse_captcha', `unexpected payload: ${JSON.stringify(captchaEnv)}`);
  } else {
    pass('reverse_captcha', 'placeholder response');
  }

  // Step 6g — author a board via create_board (Phase 4), add a group, run a task.
  const boardRes = await client.callTool({
    name: 'create_board',
    arguments: { name: 'Smoke Authored', agent_name: 'manual-smoke-runner' },
  });
  const boardEnv = JSON.parse(boardRes.content[0].text);
  if (!boardEnv.ok) {
    fail('create_board', `envelope ok=false: ${JSON.stringify(boardEnv.error)}`);
  } else {
    const authoredBoard = boardEnv.applied.id;
    const groupRes = await client.callTool({
      name: 'create_group',
      arguments: { board_id: authoredBoard, name: 'Todo', agent_name: 'manual-smoke-runner' },
    });
    const groupEnv = JSON.parse(groupRes.content[0].text);
    const taskRes = await client.callTool({
      name: 'create_task',
      arguments: {
        board_id: authoredBoard,
        group_id: groupEnv.applied.id,
        title: 'On an MCP-authored board',
        agent_name: 'manual-smoke-runner',
      },
    });
    const taskEnv = JSON.parse(taskRes.content[0].text);
    if (!taskEnv.ok) {
      fail('create_board flow', `task create failed: ${JSON.stringify(taskEnv.error)}`);
    } else {
      pass('create_board flow', `board ${authoredBoard.slice(0, 8)}… + task`);
    }
  }

  // Step 7 — clean shutdown
  await client.close();
  pass('clean shutdown');

  // Step 8 — diagnose against the (healthy) substrate runs and reports no problems.
  const diag = spawnSync('npx', ['tsx', CLI_ENTRY, 'diagnose'], { cwd, encoding: 'utf-8' });
  if (diag.status !== 0 || !/No problems found/.test(diag.stdout)) {
    fail('diagnose', `exit ${diag.status}: ${diag.stdout}\n${diag.stderr}`);
  } else {
    pass('diagnose', 'no problems found');
  }
} finally {
  await rm(cwd, { recursive: true, force: true });
}

console.log('');
if (process.exitCode && process.exitCode !== 0) {
  console.error('=== SMOKE FAILED ===\n');
} else {
  console.log('=== SMOKE PASSED ===\n');
}
