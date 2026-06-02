# Phase 4 Spec — Substrate-Edit Tools + Lifecycle

**Status:** APPROVED (Diego, 2026-06-01) — §3.0 decisions locked; §7 recommendations all confirmed.
**Author:** Spec Team
**Last updated:** 2026-06-01
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 4
**Design doc:** [`../../substrate-initial-design-doc-20260508.md`](../../substrate-initial-design-doc-20260508.md) §Tool Surface
**Predecessor:** Phase 3 (`phase-03-complete`) — policy engine, 17 tools, all reads + task/comment writes.

---

## 1. Goal

Make the substrate *authorable through MCP* (until now `boards/*.json` could only be hand-edited), and add the operational lifecycle pieces a real install needs. Two halves in one phase (Diego, 2026-06-01: combined, not split):

- **Substrate-edit tools** — 13 singleton write tools that mutate `config.json` and `boards/*.json` atomically with version CAS.
- **Lifecycle** — auto-backup before migration, `serve` PID file + port pinning, and the `backup` / `export` / `import` / `diagnose` CLIs.

## 2. Scope

**In scope:**
- `src/substrate/writer.ts` — atomic read-modify-write-rename with per-entity version CAS (§3.1).
- ID generation for boards/groups/policies (§3.2); `Config` gains `version` + `description` for `update_project` (§3.3).
- Substrate-edit MCP tools (§3.4): `update_project`; `create_board`/`update_board`/`archive_board`/`unarchive_board`; `create_group`/`update_group`/`reorder_groups`/`archive_group`; `create_policy`/`update_policy`/`archive_policy`.
- `ToolDeps` gains the substrate root (§3.5).
- Auto-backup before migration (§3.6).
- `serve` PID file + port pinning at 7475 (§3.7).
- CLIs: `substrate backup` / `export` / `import` / `diagnose` (§3.8).
- `src/shared/process.ts` — platform-branched port/PID helpers (§3.9).

**Out of scope:**
- OS-level file locking (`O_EXLOCK` / Windows `.lock` sentinel) — **deferred** (Diego: atomic rename + version CAS only; §3.1 R-1).
- A throwaway test migration 003 — **dropped** (Diego: 001→002 already exercised the runner; the migration work this phase is auto-backup; §3.6).
- HTTP API mirror + UI (Phase 5).
- `move_task` / cross-board ops (design doc: fork + archive, not a v1 primitive).
- Group/board *deletion* — only soft archive (consistent with tasks/comments).

## 3. Design

### 3.0 Locked scope decisions (Diego, 2026-06-01)

1. **Combined Phase 4** (edit tools + lifecycle in one phase/branch/review/merge).
2. **Write safety = atomic rename + per-entity version CAS only.** No OS file locking.
3. **No migration 003.** Migration work = auto-backup-before-migration, tested against the existing 001→002 chain.

### 3.1 Substrate writer (`src/substrate/writer.ts`)

The board file is the atomic write unit; CAS is per-entity (board/group/policy each carry a `version`). One core primitive:

```ts
// Read the board file fresh, locate + version-check the target entity, apply the
// mutation, bump versions + updated_at, write to a temp file, fsync, atomic-rename.
export async function mutateBoardFile<T>(
  root: string,
  boardId: string,
  mutate: (board: Board) => { result: T; next: Board },
): Promise<T>;
```

- **Read-modify-write, read as late as possible.** The fresh read happens inside the critical section immediately before the version check + write, minimizing the TOCTOU window between two `substrate mcp` processes.
- **Version CAS.** `update_*` / `archive_*` tools pass the entity's `version`; the writer (or the tool's `mutate` fn) compares against the freshly-read value → `version_mismatch` (no `current_version`, per the Phase 2 lock) on a stale write. Bumps that entity's `version` and the **board file's** `version` (the file changed), and sets `updated_at`.
- **Atomic rename.** Write to `boards/<id>.json.tmp-<rand>`, `fsync`, `rename` over the target (atomic on POSIX; near-atomic on Windows — documented gap).
- **`config.json`** uses the same write-temp-rename via a sibling `mutateConfig(root, mutate)`.

**R-1 (no OS lock — accepted residual):** atomic rename guarantees a reader never sees a half-written file, and version CAS catches the common case (two sessions editing the same entity). A narrow cross-process TOCTOU window remains for *create* ops (which carry no version — see below) and between a writer's re-read and its rename. Acceptable for a local single-user tool; revisit if dogfooding surfaces real loss.

**Create ops carry no version** (per design-doc signatures: `create_board`/`create_group`/`create_policy`/`reorder_groups` take no `version`). They are last-write-wins: the writer re-reads, appends/reorders, renames. The lost-update window is the R-1 residual.

### 3.2 ID generation

Board, group, and policy IDs are **UUID v4** (`randomUUID()`), consistent with tasks/comments and collision-free. The board *filename* is `boards/<board_uuid>.json` (the loader already keys boards by the `id` field in content, not the filename). Friendly slugs are a v1.x nicety, not v1 (slug collision + rename complexity not worth it now).

### 3.3 `Config` extension for `update_project`

`config.json` currently has `{ project_id, project_name, schema_version, created_at }` — no `version` (for CAS) and no `description`. Phase 4 adds both:

- `Config.version: number` (OCC for `update_project`) and `Config.description: string`.
- `ConfigSchema` makes them **optional on read with defaults** (`version` ⇒ 1, `description` ⇒ '') so configs written by Phases 1–3 still load. `substrate init` writes them going forward.
- The design doc's `update_project` `folder` field is **dropped** (no folders in local-first).
- `update_project({ version, name?, description?, agent_name })` → project envelope. No `id` (singular project).

### 3.4 Substrate-edit MCP tools

All take a mandatory `agent_name`; all return a `SuccessEnvelope` (`entity` ∈ `project|board|group|policy`, `version` = the entity's new version, `policies_fired: []` — substrate edits don't fire policies). No batch variants. Routed through `wrapToolHandler`.

| Tool | Shape (beyond agent_name) | Notes |
|---|---|---|
| `update_project` | `version, name?, description?` | edits `config.json` (CAS on config.version) |
| `create_board` | `name, description, field_schema?` | new `boards/<uuid>.json`; `project_id?` validated against config if passed; empty groups/policies |
| `update_board` | `id, version, name?, description?, field_schema?` | CAS board.version |
| `archive_board` | `id, version` | idempotent; sets board.archived_at |
| `unarchive_board` | `id, version` | idempotent |
| `create_group` | `board_id, name, description?, position?, color?` | appends; LWW |
| `update_group` | `id, version, name?, description?, position?, color?` | CAS group.version; resolves the group's board file |
| `reorder_groups` | `board_id, ordered_ids[]` | atomic; `ordered_ids` must be a permutation of the board's group ids → else `schema_violation`; rewrites `position`s |
| `archive_group` | `id, version` | **`conflict` if an active (non-archived) task references the group** (checked against SQLite); else idempotent soft-archive |
| `create_policy` | `board_id, name, description, type, definition, priority?, enabled?` | appends |
| `update_policy` | `id, version, name?, description?, definition?, priority?, enabled?` | CAS policy.version; **`type` immutable** |
| `archive_policy` | `id, version` | idempotent |

- **Group/policy lookups by id** require scanning board files (groups/policies are nested). The handler loads substrate, finds which board holds the id, then mutates that board file. `not_found` if no board holds it.
- **`field_schema` on create/update_board** is validated structurally (enum entries need `values`, etc. — reuse the Phase 2 `validateSubstrate` checks) → `schema_violation` on a malformed schema, before writing.
- **`create_policy` / `update_policy` definition** is stored as-is (unstructured, per Phase 3) — no condition-tree validation at write time (the engine already tolerates malformed definitions). A structural `type` enum check applies.
- Writing a board file then re-running `validateSubstrate` over the resulting substrate (post-write, in-memory) guards against producing an invalid substrate (e.g. duplicate group id) → `schema_violation`, no write committed.

### 3.5 `ToolDeps` change

`ToolDeps` gains `root: string` (the `.substrate` path) so edit tools can write files. `loadSubstrate` stays (reads). The CLI (`mcp.ts`) already has `root`; pass it through.

### 3.6 Auto-backup before migration

In `storage/migrations/runner.ts`, before applying any pending migration: copy `data.sqlite` to `data.sqlite.bak-<ISO-timestamp>` (best-effort `fsync`). If the migration run throws, the original `data.sqlite` is untouched (migrations already run in a transaction) and the backup remains. No retention/pruning in v1 (documented). Skipped when there are no pending migrations (no-op open).

### 3.7 `serve` PID file + port pinning

- `serve` writes `.substrate/substrate.pid` with its PID. On start, if the file exists and `process.kill(pid, 0)` shows the process **alive**, refuse to start (`conflict`, message points at the PID). If the PID is **stale** (kill throws ESRCH), reclaim it and continue. Remove the file on graceful shutdown.
- Port pinned at **7475**. If in use, refuse with a clear error; best-effort identify the holder (`lsof -i` POSIX / `netstat` Windows) and include it, or say "could not identify".
- **Note:** the `mcp` stdio command writes NO PID file (Phase 1 decision — multiple stdio children co-exist). PID/port logic is `serve`-only.

### 3.8 CLIs

- `substrate backup` → writes `.substrate/backups/substrate-<timestamp>.tar.gz` containing `config.json` + `boards/` + a consistent snapshot of `data.sqlite` (use the SQLite backup API or copy after a `wal_checkpoint(TRUNCATE)`; exclude `-wal`/`-shm`/`.pid`). Prints the path.
- `substrate export <path>` → same tarball written to an arbitrary path (for moving a project).
- `substrate import <path>` → restores a tarball into `.substrate/` (refuses if `.substrate/` already has a `config.json`, unless `--force`). Validates the archive shape before extracting.
- `substrate diagnose` → prints Node version, OS/arch, port-7475 status, schema version (from DB if openable), substrate integrity (config present + parseable, boards parse, counts), key paths. **Must run even when substrate is broken** — a missing/garbage `config.json` yields a diagnostic line, never a crash/throw.

### 3.9 `src/shared/process.ts`

Platform-branched helpers, unit-testable via injection/mocks:
- `isPortInUse(port): Promise<boolean>` (attempt to bind 127.0.0.1:port).
- `identifyPortHolder(port): Promise<string | null>` (`lsof`/`netstat`; null if unidentifiable).
- `isProcessAlive(pid): boolean` (`process.kill(pid, 0)` with ESRCH handling).

## 4. Edge cases

| Case | Expected |
|---|---|
| `update_board` with stale `version` | `version_mismatch` (no current_version) |
| `update_group` / `update_policy` id not in any board | `not_found` |
| `archive_group` with an active task in the group | `conflict` |
| `archive_group` with only archived tasks (or none) | succeeds |
| re-`archive_board` / re-`archive_group` / re-`archive_policy` | idempotent no-op |
| `reorder_groups` ordered_ids not a permutation | `schema_violation` |
| `create_board` with malformed `field_schema` (enum w/o values) | `schema_violation`, no file written |
| edit that would create a duplicate group id | `schema_violation`, no write |
| `update_policy` attempting to change `type` | `type` ignored / `schema_violation` (lock: type immutable) |
| concurrent stale substrate write | `version_mismatch` (CAS) |
| `serve` with a live PID file | refuse, point at PID |
| `serve` with a stale PID file | reclaim, start |
| `diagnose` against a missing `config.json` | reports the problem, exit non-zero, no crash |
| migration run | `data.sqlite.bak-<ts>` present; original intact on failure |

## 5. Test strategy

- `writer.test.ts` — atomic rename round-trip; version CAS happy + mismatch; temp file cleaned; concurrent-stale simulated.
- One `*.test.ts` per edit tool — happy + version_mismatch + idempotency + the §4 edge for that tool; `archive_group` conflict against a seeded active task.
- `migrations/runner` — auto-backup file present after apply; original unchanged on simulated mid-migration failure.
- `shared/process.test.ts` — port-in-use + process-alive via mocks/ephemeral sockets.
- Lifecycle integration — two `serve` spawns (second refuses); kill-and-restart reclaims stale PID.
- CLI integration — `backup` produces a tarball; `import` round-trips; `diagnose` against a broken `.substrate/` reports specifics.

## 6. Acceptance criteria

- `create_board` writes `boards/<id>.json` atomically; a concurrent stale-version `update_board` returns `version_mismatch`.
- `archive_group` returns `conflict` with an active task referencing it; succeeds otherwise.
- Two `serve` from one dir: second errors cleanly; ungraceful kill + restart reclaims the stale PID.
- Auto-backup file present after a migration; original `data.sqlite` intact on simulated failure.
- `substrate diagnose` against an intentionally-broken `.substrate/` reports specific problems (no crash).
- `substrate backup` produces a tarball; `substrate import` restores it.
- `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build`, concurrency smoke, manual MCP smoke all green.
- `BINARY_VERSION` → `0.0.4` (no `BINARY_SCHEMA_VERSION` bump — no schema migration this phase).

## 7. Recommended decisions — ALL CONFIRMED (Diego, 2026-06-01)

1. **Board/group/policy IDs = UUID v4** (not name-slugs). Recommend confirm.
2. **`Config` gains `version` + `description`, optional-with-defaults on read** so old configs still load. Recommend confirm.
3. **`update_project` drops `folder`** (no folders in local-first). Recommend confirm.
4. **Post-write `validateSubstrate` guard** — a substrate edit that would yield an invalid substrate (dup group id, enum w/o values) is rejected before commit. Recommend confirm.
5. **No backup retention/pruning** in v1 (`.bak-<ts>` files accumulate; `diagnose` can note count). Recommend confirm.
6. **`create_*` ops are last-write-wins** (no version param per design doc); lost-update window is the documented R-1 residual. Recommend confirm.

## 8. Definition of Done (for this spec)

Approved by Diego when §3.0 decisions stand and the §7 recommendations are confirmed or amended. Then per workflow.md Stage 2: Architect drafts the Phase 4 plan → Architect Reviewer → revision → Diego approves → development.
