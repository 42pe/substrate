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
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
  const expected = ['create_task', 'whoami'];
  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    fail('tools/list', `got ${JSON.stringify(toolNames)}, expected ${JSON.stringify(expected)}`);
  } else {
    pass('tools/list', toolNames.join(', '));
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
      fail(
        'create_task',
        `policies_fired should be [] in Phase 1, got ${JSON.stringify(envelope.policies_fired)}`,
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
    }
  }

  // Step 7 — clean shutdown
  await client.close();
  pass('clean shutdown');
} finally {
  await rm(cwd, { recursive: true, force: true });
}

console.log('');
if (process.exitCode && process.exitCode !== 0) {
  console.error('=== SMOKE FAILED ===\n');
} else {
  console.log('=== SMOKE PASSED ===\n');
}
