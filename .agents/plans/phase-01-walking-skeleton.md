# Phase 1 Plan — Walking Skeleton + Security Floor + Version Stamp

**Status:** Revised v1.1 (post Architect Reviewer pass — ready for development)
**Author:** Architect (revised after review)
**Last updated:** 2026-05-09
**Spec:** [`specs/phase-01-walking-skeleton-spec.md`](specs/phase-01-walking-skeleton-spec.md) (approved)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md)
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-01-walking-skeleton`
**Review notes:** 7 reviewer findings incorporated; spec updated to defer atomic-write smoke to Phase 4; workflow.md WASM reference corrected.

---

## 1. Overview

This plan tells *how* to build Phase 1. The *what* lives in the spec. This plan covers implementation order, file-by-file work, exact dependencies, test mapping, code review checkpoints, and merge strategy.

## 2. Branching & merge strategy

- Create `feature/phase-01-walking-skeleton` from `main` (commit `823eb7c`).
- Commit in logical increments named per Step (§4) below.
- **Code Reviewer agent runs after Steps 4, 6, 7, and 9** (workflow.md Hard Gate #3). Findings batched into a single commit if needed.
- After all acceptance criteria pass + audit completes: fast-forward merge to `main`. No squash; preserve per-Step history for "reference checkpoints if we need to go back."
- Tag the merge commit `phase-01-complete`.

## 3. Dependencies

**Versions are pinned exactly in `package.json`**, not caret-on-major (reviewer concern #1). Resolved at first install; lockfile committed in Step 1.

### Runtime dependencies (exact versions to verify at install; placeholders below are the latest known stable as of plan drafting)

| Package | Pinned version | Notes |
|---|---|---|
| `@libsql/client` | `0.17.3` | Native binding (Phase 0 spike). Has prebuilds for mac arm64/x64, linux x64/arm64, windows x64. |
| `@modelcontextprotocol/sdk` | `1.x.y` (pin minor) | SDK has shifted through 2025; **must pin** minor + patch on first install to avoid surprise breaks during Phases 2-6. Step 1 records the resolved version in CHANGELOG-internal notes (the audit file). |
| `hono` | `4.x.y` (pin minor) | |
| `@hono/node-server` | `1.x.y` (pin minor) | Required adapter — Hono's default targets edge runtimes. |
| `zod` | `3.x.y` (pin minor) | Used for input validation + `toJsonSchema()` for MCP `tools/list`. Note: `exactOptionalPropertyTypes: true` interacts with Zod's `.optional()` chains; address in Step 5 tests. |

### Dev dependencies

| Package | Pinned version |
|---|---|
| `typescript` | `5.x.y` |
| `tsx` | `4.x.y` |
| `vitest` | `3.x.y` |
| `@vitest/coverage-v8` | matches vitest |
| `eslint` | `9.x.y` |
| `@typescript-eslint/parser` | `8.x.y` (floor: 8.7+ for ESLint 9 compat) |
| `@typescript-eslint/eslint-plugin` | matches parser |
| `eslint-plugin-import` | `2.x.y` |
| `prettier` | `3.x.y` |
| `@types/node` | `20.x.y` |

### UI dependencies (`ui/package.json`, pinned similarly)

| Package | Pinned version |
|---|---|
| `react` | `18.x.y` |
| `react-dom` | `18.x.y` |
| `vite` | `6.x.y` |
| `@vitejs/plugin-react` | `4.x.y` or `5.x.y` (Vite 6 compat — verify) |
| `tailwindcss` | `4.x.y` |
| `@tailwindcss/vite` | `4.x.y` (matches tailwindcss minor) |

**Resolution at Step 1:** `pnpm install` runs against the placeholder ranges, then `package.json` is rewritten with the resolved exact versions before committing. Lockfile committed alongside.

## 4. Implementation order

12 sequential Steps. Code Reviewer checkpoints called out explicitly.

### Step 1 — Repo bootstrap (Backend Engineer)

Create:
- `package.json` (server-side) with exact-pinned versions (see §3)
- `tsconfig.json` (IDE-facing; **no `rootDir`**)
- `tsconfig.build.json` (server build target; **with `rootDir: "./src"`**)
- `eslint.config.js` (flat config)
- `.prettierrc.json`
- `vitest.config.ts` with **multi-project setup**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/policy/**', 'src/storage/**'],
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    },
  },
});
```

Smoke tests live outside both projects and run via explicit `vitest run tests/smoke/<file>` invocations (the `pnpm test:smoke:*` scripts).

- **Critical: post-build shebang + chmod script.** `tsc` does not preserve shebangs. Add `scripts/post-build.mjs`:

```js
// scripts/post-build.mjs — prepend shebang + chmod +x on the CLI entry
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
const cliPath = './dist/server/cli/index.js';
const SHEBANG = '#!/usr/bin/env node\n';
const content = readFileSync(cliPath, 'utf-8');
if (!content.startsWith('#!')) writeFileSync(cliPath, SHEBANG + content);
chmodSync(cliPath, 0o755);
```

Wire into `package.json`:
```jsonc
"scripts": {
  "build": "pnpm build:server && pnpm build:ui",
  "build:server": "tsc -p tsconfig.build.json && node scripts/post-build.mjs",
  "build:ui": "pnpm --dir ui build",
  ...
}
```

- `tsconfig.json` (IDE — no rootDir):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist", "ui"]
}
```

- `tsconfig.build.json` (build — with rootDir, excludes tests):

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./dist/server",
    "rootDir": "./src",
    "sourceMap": false
  },
  "exclude": ["node_modules", "dist", "ui", "tests", "src/**/*.test.ts"]
}
```

- ESLint flat config (reviewer-confirmed shape):

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'ui/dist/**', 'ui/node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsparser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tseslint, import: importPlugin },
    rules: {
      ...tseslint.configs.recommended.rules,
      'import/no-cycle': ['error', { maxDepth: 10 }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
```

- `.prettierrc.json`:
```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

- `CHANGELOG.md` — **placeholder only** (reviewer concern #7):
```markdown
# Changelog

All notable user-facing changes will be tracked here starting with the first public release.

Per-phase internal build notes live in `.agents/audits/phase-{N}-audit.md`.
```

Commit: `chore: repo bootstrap (package.json with pinned deps, tsconfig split, eslint flat, prettier, vitest multi-project, shebang post-build)`.

### Step 2 — `src/core/` types and errors (Backend Engineer)

Create:
- `src/core/types.ts` — interfaces for `Task` (Phase 1 fields), `Config`, `Envelope` shapes. Stub `Comment`, `TaskEvent`, `Board`, `Group`, `Policy` as empty interfaces with TODO comments.
- `src/core/errors.ts` — `SubstrateError` class extending `Error`. `ErrorCode` union: `'schema_violation' | 'transition_blocked' | 'version_mismatch' | 'not_found' | 'conflict' | 'forbidden' | 'internal_error'`. Factory helpers. **Includes `httpStatusFor(code)` mapping** (used by Step 6 middleware): `forbidden → 403, schema_violation → 400, transition_blocked → 422, version_mismatch → 409, not_found → 404, conflict → 409, internal_error → 500`.
- `src/core/envelope.ts` — `successEnvelope({ entity, id, version, state })` and `errorEnvelope(error)`. Type-safe construction.
- `src/core/version.ts` — `BINARY_SCHEMA_VERSION = 1`.

Tests:
- `src/core/errors.test.ts`
- `src/core/envelope.test.ts`

Commit: `feat(core): types, errors with forbidden + httpStatusFor, envelope helpers`.

### Step 3 — `src/shared/` cross-cutting (Backend Engineer)

Module boundary fix (reviewer concern on §4 Step 3): config loader stays in `shared/` since it's bootstrap/lifecycle code; **board JSON loading** (which is real substrate-parsing logic) lives in `substrate/` and lands in Phase 2. Phase 1's `shared/config.ts` covers only `.substrate/config.json`.

Create:
- `src/shared/paths.ts` — pure functions over `.substrate/` root.
- `src/shared/config.ts` — `readConfig(root)`, `writeConfig(root, config)`. Zod schema. Throws `SubstrateError.notFound` if missing, `internalError` if malformed.
- `src/shared/logger.ts` — `info/warn/error` with `agent_name` sanitization.
- **`src/shared/db.ts`** — **shared `openDatabaseAndMigrate(dbPath)` helper** (reviewer concern on Step 5/7 lifecycle wiring). Returns a libsql client that has WAL/synchronous PRAGMAs set (only on first init), `busy_timeout` set, and migrations applied up to `BINARY_SCHEMA_VERSION`. Used by `init`, `serve`, `mcp`, *and* repo tests. One place that owns the DB lifecycle.

Tests:
- `src/shared/paths.test.ts`
- `src/shared/config.test.ts`
- `src/shared/logger.test.ts`
- `src/shared/db.test.ts` — opens against a temp file, asserts WAL set, asserts user_version == 1 after migration, asserts busy_timeout set.

Commit: `feat(shared): paths, config, logger, db lifecycle helper`.

### Step 4 — `src/storage/` libsql + migrations (Backend Engineer)

Create:
- `src/storage/client.ts` — re-exports `openDatabaseAndMigrate` from `shared/db.ts` (the lifecycle owner). Adds a separate `openExistingDatabase(dbPath)` for cases where migrations should NOT run automatically (e.g., the version-guard refuse-to-open path).
- `src/storage/migrations/001-initial.ts` — exports `{ id: 1, up: async (client) => { /* CREATE TABLE tasks + indexes per spec §3.6 */ } }`. **The `up()` does NOT set `PRAGMA user_version`** — the runner sets it (reviewer concern on Step 4 conflict).
- `src/storage/migrations/runner.ts`:
  - Imports migrations statically: `import { migration001 } from './001-initial.ts'`. List of migrations is `[migration001]` (no fs scan). Plan §8 reviewer flagged "static-import vs fs-scan" — going **static** for v1; documented.
  - Reads `PRAGMA user_version` via `SELECT user_version FROM pragma_user_version`.
  - For each migration with `id > current`, in id order: open a transaction, call `up()`, then `PRAGMA user_version = <id>`, commit. On failure: rolls back; error propagates.
  - Refuses if `current > max(migrations.id)`.
- `src/storage/repositories/tasks.ts` — `createTask(client, task)`, `getTask(client, id)`.

Tests:
- `src/storage/migrations/runner.test.ts` — apply 001 against empty file; refuse on `user_version > 1`; rollback on simulated failure.
- `src/storage/repositories/tasks.test.ts` — round-trip create + get against temp libsql file via `openDatabaseAndMigrate`.

Commit: `feat(storage): libsql client wrappers, migration runner, tasks repo, schema 001`.

**🛑 Code Reviewer checkpoint after Step 4.** Review focus: SQL injection safety in repos, transaction semantics, error code coverage.

### Step 5 — `src/mcp/` MCP server + tools (Backend Engineer)

Create:
- `src/mcp/server.ts` — sets up MCP `Server` from `@modelcontextprotocol/sdk`, registers tools via `src/mcp/registry.ts`, exposes `startStdioServer(deps)` that returns when stdin closes. Takes a `Deps` object (libsql client + config) injected from `cli/commands/mcp.ts`.
- `src/mcp/tools/write/create-task.ts` — Zod input schema. Exports both the handler and a `toJsonSchema()` for `tools/list`.
- `src/mcp/tools/read/whoami.ts` — returns minimal payload per spec §3.5.
- `src/mcp/registry.ts` — wires Phase 1 tools.

Tests:
- `src/mcp/tools/write/create-task.test.ts` — direct handler call with mock client. Assert envelope shape, required-fields validation, agent_name enforcement. **Snapshot test on `toJsonSchema()` output** (reviewer concern #6 — the schema IS a contract).
- `src/mcp/tools/read/whoami.test.ts` — direct handler call with fixture config.

Commit: `feat(mcp): server, create_task tool (with schema snapshot), whoami tool`.

### Step 6 — `src/http/` Hono server + middleware (Backend Engineer)

Create:
- `src/http/server.ts` — `createApp(deps)` returns Hono app; `serve(app, port)` uses `@hono/node-server`'s `serve()`.
- `src/http/middleware/origin-allowlist.ts` — per spec §3.4. Uses `httpStatusFor('forbidden') === 403`.
- `src/http/middleware/path-canonical.ts` — exports `assertPathUnder(absPath, baseDir)`. Phase 1 ships the function; mounted as no-op (no file-serving routes). Tests cover the function directly.
- `src/http/middleware/error-handler.ts` — catches `SubstrateError` → envelope + HTTP status via `httpStatusFor()`; catches anything else → 500 + `internal_error`, logs scrubbed.
- `src/http/routes/health.ts` — `GET /api/health`.
- `src/http/routes/static.ts` — fallback. **If `dist/ui/` doesn't exist (Phase 1 dev before Step 8 builds UI), serves a plain HTML response** with text "Substrate is running. UI ships when ui/ is built."

Tests:
- `src/http/middleware/origin-allowlist.test.ts` — uses `app.request()` Hono test client.
- `src/http/middleware/path-canonical.test.ts` — `..`-traversal, absolute path outside base.
- `src/http/routes/health.test.ts`.

Commit: `feat(http): hono server, security middleware (origin + path-canon + error-handler), health route`.

**🛑 Code Reviewer checkpoint after Step 6.** Review focus: security middleware completeness (DNS rebinding test crafted; CSRF-style POST blocked; markdown XSS not yet relevant — Phase 5).

### Step 7 — `src/cli/` commands (Backend Engineer)

Create:
- `src/cli/index.ts` — entry point. Hand-rolled argv parse. Starts with `#!/usr/bin/env node` shebang in source. Post-build script preserves it (Step 1).
- `src/cli/commands/init.ts` — per spec §3.2. Generates UUID, writes config, calls `openDatabaseAndMigrate` (which applies WAL + migration 001), updates `.gitignore`. Closes the DB explicitly after init.
- `src/cli/commands/serve.ts` — per spec §3.2. PID file dance, port bind via `@hono/node-server`. Uses `openDatabaseAndMigrate` (verifies schema_version via the runner's refuse-to-open behavior). SIGINT/SIGTERM handlers.
- `src/cli/commands/mcp.ts` — per spec §3.2. Same DB lifecycle. Starts MCP via stdio transport.

Tests:
- `src/cli/commands/init.test.ts` — temp-dir fixture, run init, verify `.substrate/` shape + `data.sqlite` schema + `.gitignore` updates. Second run → errors cleanly.
- `tests/integration/serve-lifecycle.test.ts` — spawn `tsx src/cli/index.ts serve` as child; **uses dynamic port via env var `SUBSTRATE_PORT_OVERRIDE` (Phase 1 test-only escape hatch)** to avoid the 7475 conflict between parallel test runs; fetches health, sends SIGINT, asserts clean exit + PID file removed. Spawn twice → second errors.
- `tests/integration/mcp-create-task.test.ts` — spawn `tsx src/cli/index.ts mcp` as child, send `tools/list` and `tools/call create_task` via stdio JSON-RPC; assert response shapes and SQLite state.
- `tests/integration/schema-version-guard.test.ts` — automated: run init, then `client.execute('PRAGMA user_version = 999')`, then spawn `serve` and assert non-zero exit + clear stderr error. *(Reviewer-added: spec said this was manual-only; reviewer wanted automated coverage.)*

> **Port override caveat.** `SUBSTRATE_PORT_OVERRIDE` is a Phase-1-test-only knob; not documented as a user feature. Removed or hidden in v1.x. Spec stays at "port 7475 pinned" for user-facing behavior.

Commit: `feat(cli): init, serve, mcp commands with schema-version guard test`.

**🛑 Code Reviewer checkpoint after Step 7.** Review focus: lifecycle correctness (PID file race, signal handling, DB close), CLI error UX, init idempotency edge cases.

### Step 8 — `ui/` Vite + React + Tailwind v4 bootstrap (Backend Engineer)

Note: Frontend Engineer role isn't spawned for this Step — UI scope is minimal (one page, no routing, no ShadCN). Backend handles it. Frontend Engineer activates in Phase 5.

Create:
- `ui/package.json` — separate package, plain subdir (no pnpm workspace). Pinned versions per §3.
- `ui/vite.config.ts` — uses `@vitejs/plugin-react` and `@tailwindcss/vite`. Builds to `../dist/ui/`.
- `ui/tsconfig.json` — extends a UI-specific config (different `lib`, includes `dom`).
- `ui/index.html`.
- `ui/src/main.tsx`, `ui/src/App.tsx` — fetches `/api/health` and displays project_name + version. Demonstrates the full client → server → DB path.
- `ui/src/styles.css` — `@import 'tailwindcss';`.
- `ui/tailwind.config.ts` (if needed for v4 — verify Vite plugin requirements).

`http/routes/static.ts` from Step 6 already handles the "UI not yet built" case (plain HTML fallback). After Step 8 + `pnpm build:ui`, `dist/ui/` exists and is served.

Tests: none in Phase 1. UI testing comes in Phase 5 (Playwright smoke).

Commit: `feat(ui): vite + react + tailwind v4 bootstrap (minimal hello)`.

### Step 9 — Concurrency smoke (Backend Engineer)

Atomic-write smoke test **dropped from Phase 1** per spec update + reviewer concern #2. Only concurrency smoke ships here.

Create:
- `tests/smoke/concurrency.test.ts` — spawns 1 serve + 3 mcp children, all writing for **60s** (matches spike; spec updated). Zero errors required.
- `tests/fixtures/SampleSaaS/config.json` — sanitized sample config (placeholder for Phase 2 expansion).

Commit: `test(smoke): concurrency 60s; SampleSaaS fixture skeleton`.

**🛑 Code Reviewer checkpoint after Step 9.** Review focus: smoke-test isolation, port-conflict handling in CI, fixture sanitation.

### Step 10 — Manual MCP-client smoke (Backend Engineer)

Create:
- `tests/manual/README.md` — step-by-step to connect MCP Inspector or Claude Code to `npx substrate mcp` and verify `create_task`. Includes exact `.mcp.json` snippet.
- Diego runs this once before audit; outcome recorded in audit file.

Commit: `docs: manual MCP-client smoke instructions`.

### Step 11 — Final build + acceptance pass (Backend Engineer)

- `pnpm build` → verify `dist/server/cli/index.js` exists, **starts with `#!/usr/bin/env node`**, and is `chmod +x`.
- `pnpm test` (unit + integration) → green.
- `pnpm test:smoke:concurrency` → green.
- `pnpm lint`, `pnpm format:check`, `tsc --noEmit` → green.
- `pnpm pack` (dry-run): inspect the tarball; verify only intended files included.
- Local install verification: `pnpm pack` produces a `.tgz`; `npx ./diegoferreyra-substrate-0.0.1.tgz init` in a fresh dir works.
- Manual: connect MCP Inspector per Step 10. Verify `create_task` end-to-end.

Commit: `chore(phase-01): final acceptance pass`.

### Step 12 — Audit + merge

- Spawn Assistant agent to walk workflow.md's Phase Completion Checklist.
- Assistant writes `.agents/audits/phase-01-audit.md`. Records:
  - Per-checklist-item status (DONE / NOT-APPLICABLE / MISSING)
  - Resolved versions of all dependencies (since §3 had placeholder pins)
  - The MCP SDK exact version (for future-phase reference if SDK breaks)
  - Manual MCP-Inspector smoke outcome (pass/fail with notes)
  - Test counts (unit / integration / smoke totals)
- Orchestrator resolves any flagged gaps.
- Fast-forward merge `feature/phase-01-walking-skeleton` to `main`.
- Tag the merge commit `phase-01-complete`.

## 5. SampleSaaS fixture

Sanitized substrate fixture used in tests from Phase 2 onward. Inferred from a generic engineering-team coordination workflow (phases through stages), renamed to "SampleSaaS" — a generic SaaS-product-being-built fixture.

**Phase 1 contribution:** `tests/fixtures/SampleSaaS/config.json` only:

```json
{
  "project_id": "00000000-0000-4000-8000-000000000001",
  "project_name": "SampleSaaS",
  "schema_version": 1,
  "created_at": "2026-05-09T00:00:00.000Z"
}
```

Phase 2 expands with `boards/phases.json` (Phases board with stages `proposed → spec → spec-review → plan → plan-review → develop → code-review → qa → audit → pr → merged`). Phase 3 adds policies (transition_guards + agent_responsibility hints).

## 6. Test mapping (spec § → plan §) — REVISED

Reviewer flagged missing rows in v1.0; restored here in full.

| Spec acceptance criterion | Test |
|---|---|
| Fresh-clone install/build/test green | Manual in Phase 1; CI in Phase 6 |
| `init` creates `.substrate/` with stamped data.sqlite | `src/cli/commands/init.test.ts` |
| `serve` starts; `/api/health` 200 | `src/http/routes/health.test.ts` + `tests/integration/serve-lifecycle.test.ts` |
| Origin/Host rejection 403 with `forbidden` | `src/http/middleware/origin-allowlist.test.ts` |
| `Host: external.com` rejection | Same as above (covered by allowlist test) |
| `mcp` JSON-RPC `create_task` persists | `tests/integration/mcp-create-task.test.ts` |
| Real-MCP-client smoke | Manual (`tests/manual/README.md`) — audit records outcome |
| Concurrency smoke 60s, 0 errors | `tests/smoke/concurrency.test.ts` |
| ~~Atomic-write smoke~~ | **Deferred to Phase 4** (spec updated) |
| Two `serve` from same dir → second refuses | `tests/integration/serve-lifecycle.test.ts` |
| Ctrl-C clean shutdown | `tests/integration/serve-lifecycle.test.ts` |
| Schema-guard refuse on `user_version > 1` | `tests/integration/schema-version-guard.test.ts` (automated, reviewer-added) |
| `lint`, `format:check`, `tsc --noEmit` clean | CI Phase 6 + pre-merge manual |
| `core/errors` correctness | `src/core/errors.test.ts` |
| `core/envelope` correctness | `src/core/envelope.test.ts` |
| `shared/paths` | `src/shared/paths.test.ts` |
| `shared/config` | `src/shared/config.test.ts` |
| `shared/logger` | `src/shared/logger.test.ts` |
| `shared/db` lifecycle | `src/shared/db.test.ts` |
| Migration runner | `src/storage/migrations/runner.test.ts` |
| Tasks repo | `src/storage/repositories/tasks.test.ts` |
| `create_task` MCP handler | `src/mcp/tools/write/create-task.test.ts` |
| `create_task` Zod schema → JSON schema | Snapshot test in same file |
| `whoami` MCP handler | `src/mcp/tools/read/whoami.test.ts` |
| `path-canonical` middleware function | `src/http/middleware/path-canonical.test.ts` |
| `init` idempotency edge cases | `src/cli/commands/init.test.ts` |

## 7. Risks

- **R1: Dependency version conflicts.** All caret-on-major risk is eliminated by pinning exact versions in Step 1. Residual: `@modelcontextprotocol/sdk` minor bumps during Phases 2-6 require deliberate upgrade.
- **R2: Hono `@hono/node-server` adapter compatibility.** Confirmed pattern; the adapter is the canonical Node path for Hono. Pin minor on first install.
- **R3 (corrected per reviewer):** Vitest port conflicts in parallel runs. **Mitigation: multi-project Vitest config** with `integration` project using `pool: 'forks', singleFork: true` + `SUBSTRATE_PORT_OVERRIDE` env var allowing dynamic port allocation in integration tests. Unit tests stay parallel.
- **R4: libsql native binding on Node 24 macOS arm64.** Confirmed by Phase 0 spike. Other platforms unvalidated until Phase 6 CI matrix.
- **R5: Tailwind v4 Vite plugin maturity.** If `@tailwindcss/vite` costs > 0.5 day to make happy, revert UI to Tailwind v3 for v1 and reconsider in v1.x.
- **R6 (new from reviewer):** Zod 3.x with `exactOptionalPropertyTypes: true` has edge cases in `.optional()` chains. Mitigation: explicit unit tests on schema typing in Step 5; document workarounds if encountered.
- **R7 (new from reviewer):** `bin` shebang + chmod +x. Mitigation: dedicated `scripts/post-build.mjs` runs as part of `build:server`; Step 11 verifies via `head -1` + `test -x`.

## 8. Outstanding from reviewer (acknowledged + resolved)

| Reviewer concern | Resolution |
|---|---|
| Dependency pinning | §3 rewrites to exact-version policy; lockfile committed in Step 1. |
| Atomic-write stub | **Dropped from Phase 1**; spec updated; moved to Phase 4. |
| Vitest pool config wrong | §4 Step 1 uses multi-project; integration uses `singleFork`; smoke tests run via dedicated scripts. |
| `bin` shebang missing | `scripts/post-build.mjs` ships in Step 1; verified in Step 11. |
| `rootDir` + tests interaction | Split: IDE `tsconfig.json` without rootDir + `tsconfig.build.json` with rootDir excluding tests. |
| Zod + `exactOptionalPropertyTypes` | Snapshot test on `toJsonSchema()` output in Step 5; risk documented R6. |
| CHANGELOG timing | Phase 1 ships placeholder only; first real entry in Phase 6. |
| Missing test rows | §6 expanded to full coverage. |
| 60s vs 30s concurrency | Restored to 60s (matches spike); spec & plan aligned. |
| Code Reviewer checkpoints | Explicit after Steps 4, 6, 7, 9. |
| Step 5 DB lifecycle ownership | `src/shared/db.ts` is the single owner; Step 5 mocks it for unit tests, Step 7 wires it for CLI. |
| Workflow.md WASM reference | Fixed in workflow.md. |
| Module boundary `substrate/` vs `shared/config` | Config stays in `shared/` (it's lifecycle, not substrate-parsing); board JSON loading lands in `substrate/` in Phase 2. |
| Static migration import | Going static (no fs scan) for v1; documented. |
| Schema-version guard test | Automated (`tests/integration/schema-version-guard.test.ts`); was manual-only in v1.0. |

## 9. Definition of Done

Phase 1 is complete when:
- All Step §4 commits land on `feature/phase-01-walking-skeleton`.
- All Code Reviewer checkpoint findings are resolved.
- All §6 tests pass on macOS arm64.
- All §8 spec acceptance criteria met.
- Manual MCP-client smoke confirmed and recorded in audit.
- Assistant audit (`.agents/audits/phase-01-audit.md`) reports DONE/NOT-APPLICABLE for every applicable checklist item.
- Fast-forward merge to `main` with tag `phase-01-complete`.
