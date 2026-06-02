# Phase 4 Plan — Substrate-Edit Tools + Lifecycle

**Status:** Reviewed v1.1 (Architect Reviewer: approve-with-changes; 1 BLOCKER resolved) — ready for development
**Author:** Architect (revised after review)
**Last updated:** 2026-06-01
**Spec:** [`specs/phase-04-spec.md`](specs/phase-04-spec.md) (APPROVED 2026-06-01)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) §5 Phase 4
**Workflow:** [`../workflow.md`](../workflow.md)
**Feature branch:** `feature/phase-04-substrate-edit-lifecycle`
**Review notes:** Incorporated B1 (serve PID/port already exists on main — reframe Step 7 as extract+harden, preserve the post-bind `wx` write / C-4 race fix), C1 (`validateBoardStructure` → `schema_violation`, separate from load-path `validateSubstrate` → `internal_error`), C2 (config write-side requires the new fields; CAS-through-defaulted-version test), C3 (archive_group DB→file race named as accepted residual R7), C4 (**TWO review gates** — mid-phase after edit tools + lifecycle), C5 (zip-slip invariant + refuse-import-if-live-PID), nits N1–N5.

---

## 1. Overview

The *what* is in the spec. This plan is the *how*: file-by-file work, order, the **two** Code Reviewer gates, and merge strategy.

Phase 4 adds the substrate **writer** + 13 substrate-edit MCP tools, plus the **lifecycle** layer (auto-backup before migration, `serve` PID/port hardening, and the `backup`/`export`/`import`/`diagnose` CLIs). **No `BINARY_SCHEMA_VERSION` bump** (no schema migration this phase). `BINARY_VERSION` → `0.0.4` at acceptance.

**10 steps, TWO Code Reviewer passes** (C4): a mid-phase gate after the edit tools (Step 5) and a lifecycle gate (Step 9). Rationale: the writer (Step 1) is the foundation all 13 tools build on — a defect found only at a single end-of-phase review would force re-touching every tool. Edit tools land before lifecycle so the riskier concurrency/atomicity surface is built and reviewed first.

## 2. Branching & merge strategy

- Create `feature/phase-04-substrate-edit-lifecycle` from `main` (tag `phase-03-complete`).
- Commit per step. Two Code Reviewer passes (Steps 5 + 9).
- Fast-forward merge to `main`, no squash, tag `phase-04-complete`.
- **No dev-DB footgun** — no schema bump. The `Config` `version`/`description` additions are optional-with-defaults on read, so old `config.json` files load unchanged.

## 3. Dependencies

- No new deps for the writer or edit tools (Node `fs` + existing Zod).
- **Tarball for backup/export/import (Step 8 decision):** evaluate the `tar` npm package (widely used, no native bindings) vs. a dependency-free store-only tar + `node:zlib` gzip; pick the lower-risk option and document it. The **zip-slip safety invariant (R3/§Step 8) is mandatory regardless of the choice.**

## 4. Implementation order

### Step 1 — Writer + Config extension + deps wiring (Backend Engineer)

Foundation for all edit tools. No MCP surface yet.

Create / modify:
- `src/substrate/writer.ts` (new) — `mutateBoardFile(root, boardId, mutate)` and `mutateConfig(root, mutate)` per spec §3.1: read fresh → `mutate` (version-checks + bumps inside the callback) → write `*.tmp-<rand>` → `fsync` → `rename`. Helpers: `writeJsonAtomic(path, value)` (temp+fsync+rename; **create-only paths use `{flag:'wx'}`**, N1), `findBoardHolding(substrate, entityId, kind)` to locate the board owning a group/policy id (note: O(boards) scan — deliberate non-optimization for v1 scale, N5).
  - **CAS placement:** the `mutate` callback owns version semantics (it can't be generic — create-ops carry no version; different tools bump board vs group vs policy). The writer owns atomic-rename mechanics. A stale version → `version_mismatch` (no `current_version`, Phase 2 lock).
- `src/substrate/validator.ts` — **extract a pure `validateBoardStructure(board): void` that throws `schema_violation`** (C1) covering the per-board structural rules (enum field_schema entries need `values`; duplicate group ids within the board). The existing whole-substrate `validateSubstrate(substrate): void` stays on the LOAD path and keeps throwing `internal_error`. Edit tools call `validateBoardStructure` pre-write (on input) AND post-mutate (on the result) so a write can never produce a structurally-invalid board; both surface `schema_violation`.
- `src/shared/config.ts` — add `version` + `description` to `ConfigSchema` **optional-with-defaults on READ** (`version`⇒1, `description`⇒''). The **WRITE path requires both** (defaults are a read affordance only) so a read-default→mutate→write round-trip materializes them. Assert in a comment: config is only written by `init` and `mutateConfig`/`update_project`. `core/types.ts` `Config` gains `version: number` + `description: string`.
- `src/mcp/deps.ts` — `ToolDeps` gains `root: string`; `mcp.ts` passes it (already in scope). Update existing tool-test `ToolDeps` literals to include `root` (mechanical).

Tests:
- `writer.test.ts` — atomic round-trip; temp cleaned on success + on error; `mutateBoardFile` not_found on missing file; create with `wx` rejects an existing file; `mutateConfig` round-trip.
- `validator.test.ts` extend — `validateBoardStructure` throws `schema_violation` on enum-without-values and dup group id; accepts a clean board.
- `config.test.ts` extend — legacy config (no version/description) loads with defaults; read-default→write round-trip materializes them; new config round-trips both.

_Reviewer focus (Step 5):_ atomic-rename (temp+fsync+rename, temp cleanup on error); CAS in the callback, no `current_version` leak; `validateBoardStructure` error code is `schema_violation` (not `internal_error`); config write-side carries the new fields; no path traversal (boardId → `paths(root).boardJson(id)` only).

Commit: `feat(substrate): atomic writer + validateBoardStructure + Config version/description + deps.root (Step 1)`.

### Step 2 — Project + board edit tools (Backend Engineer)

Create in `src/mcp/tools/write/`:
- `update-project.ts` — `mutateConfig`, CAS `config.version`, set name/description, bump. Envelope entity `project`.
- `create-board.ts` — `randomUUID()` id; build `Board` (empty groups/policies, version 1); `validateBoardStructure` on the input field_schema → `schema_violation`; write `boards/<uuid>.json` with `{flag:'wx'}` (N1); `project_id?` validated against config if present.
- `update-board.ts` — `mutateBoardFile`, CAS board.version, patch name/description/field_schema; `validateBoardStructure` on the result before commit.
- `archive-board.ts` / `unarchive-board.ts` — idempotent; set/clear board.archived_at.
- Register all in `registry.ts`.

Tests: per tool — happy + version_mismatch + idempotency + create-board malformed field_schema → schema_violation (no file) + **legacy-config CAS path: `update_project({version:1})` succeeds → version 2, a second `update_project({version:1})` → version_mismatch** (C2).

_Reviewer focus (Step 5):_ pre+post `validateBoardStructure`; create-board uuid + `wx` no-overwrite; envelope entity/version; update_project CAS through a defaulted version.

Commit: `feat(mcp): project + board edit tools (Step 2)`.

### Step 3 — Group edit tools (Backend Engineer)

Create:
- `create-group.ts` — append (uuid, version 1, position default = max+1); LWW.
- `update-group.ts` — `findBoardHolding` → not_found if none; CAS group.version; patch name/description/position/color.
- `reorder-groups.ts` — `ordered_ids` must be a permutation of the board's group ids → else `schema_violation`; rewrite `position`s; atomic via `mutateBoardFile`.
- `archive-group.ts` — locate board; CAS group.version; **before archiving, query SQLite `SELECT 1 FROM tasks WHERE group_id = ? AND archived_at IS NULL LIMIT 1` (bound param)** → `conflict` if found; else idempotent soft-archive. (See R7 — the check is not atomic with the file write; accepted residual.)
- Register in `registry.ts`.

Tests: per tool — happy + version_mismatch + not_found + reorder non-permutation → schema_violation + **archive_group conflict against a seeded active task** + archive_group succeeds with only-archived/no tasks + idempotent re-archive.

_Reviewer focus (Step 5):_ `findBoardHolding`; archive_group DB check (bound param, right board file) + the R7 residual; reorder permutation validation + atomicity.

Commit: `feat(mcp): group edit tools incl. archive conflict check (Step 3)`.

### Step 4 — Policy edit tools (Backend Engineer)

Create:
- `create-policy.ts` — append (uuid, version 1); `type` enum check; `definition` stored as-is (unstructured, Phase 3).
- `update-policy.ts` — `findBoardHolding`; CAS policy.version; patch name/description/definition/priority/enabled; **`type` immutable → `schema_violation` if a differing `type` is sent** (N2: reject, not silently ignore).
- `archive-policy.ts` — idempotent soft-archive.
- Register in `registry.ts`.

Tests: per tool — happy + version_mismatch + not_found + **type-change → schema_violation** + idempotent re-archive + a `transition_guard` authored via `create_policy` then enforced by `update_task` (cross-feature: the written policy actually engages the Phase 3 engine).

_Reviewer focus (Step 5):_ type immutability rejects; definition stored unmodified; created policy is loadable + evaluable by the engine.

Commit: `feat(mcp): policy edit tools (Step 4)`.

### Step 5 — 🛑 Mid-phase Code Reviewer pass (writer + Config + 13 edit tools) (C4)

The high-leverage gate: review the concurrency/correctness foundation BEFORE lifecycle builds on a settled base. One Code Reviewer over `git diff main...HEAD` so far. Concentrate on:
- Writer (Step 1): atomic rename, temp cleanup, CAS-in-callback no-leak, no path traversal, `wx` on create.
- validateBoardStructure: `schema_violation` (not internal_error); pre+post-write placement.
- Config (Step 1): backward-compat read, write-side carries new fields, CAS-through-default.
- Edit tools (Steps 2–4): version_mismatch semantics, archive_group DB conflict + R7 residual, reorder permutation, type immutability, idempotency, envelope shapes.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit before proceeding.

Commit: `fix(review): address Phase 4 mid-phase findings (Step 5)` (only if findings).

### Step 6 — Auto-backup before migration (Backend Engineer)

Modify:
- `src/storage/migrations/runner.ts` — before applying pending migrations (only when some are pending), copy `data.sqlite` → `data.sqlite.bak-<ISO-timestamp>` (fsync). Original untouched on failure (migrations already transactional). No retention/pruning in v1 (documented; `diagnose` can note the count).

Tests:
- `runner` test — apply against a v1-stamped fixture → `.bak-<ts>` present + v2 state; simulated mid-migration throw → original `data.sqlite` unchanged, backup present.

_Reviewer focus (Step 9):_ backup only when migrations pending; original integrity on failure; timestamp collision-safe.

Commit: `feat(storage): auto-backup before migration (Step 6)`.

### Step 7 — Process helpers + serve PID/port EXTRACT & HARDEN (Backend Engineer)

**B1 — the serve PID/port lifecycle ALREADY EXISTS on `main` (Phase 1): `serve.ts` writes the PID with `{flag:'wx'}` AFTER a successful bind (the C-4 race fix), refuses on a live PID, reclaims a stale PID (ESRCH), binds 7475, maps EADDRINUSE → `conflict`, and cleans the PID file on SIGINT/SIGTERM/beforeExit. `serve-lifecycle.test.ts` proves double-start refusal + clean exit.** This step is therefore **extract + harden, NOT implement** — do not rebuild it from the spec's simpler prose, and **preserve the post-bind exclusive (`wx`) PID write**.

Create / modify:
- `src/shared/process.ts` (new) — extract the existing `isProcessAlive(pid)` (ESRCH→dead, EPERM→alive) into here; add `isPortInUse(port)` and `identifyPortHolder(port)` (`lsof -i` POSIX / `netstat` Windows; **null if unidentifiable, never throws**). Structured for mock injection.
- `src/cli/commands/serve.ts` — refactor to consume `shared/process.ts`; **keep the post-bind `wx` write ordering**; add port-holder identification to the existing EADDRINUSE → `conflict` message (best-effort, append holder or "could not identify").
- **mcp stdio still writes NO pid file** (Phase 1 decision) — unchanged.

Tests:
- `process.test.ts` — port-in-use via an ephemeral bound socket; isProcessAlive on `process.pid` (true) + an unused pid (false); identifyPortHolder mocked + never-throws.
- Lifecycle integration — extend `serve-lifecycle.test.ts`: second `serve` refuses (existing); **add a spawn → SIGKILL → restart test asserting the stale PID is reclaimed** (gap the reviewer flagged).

_Reviewer focus (Step 9):_ no regression of the post-bind `wx` write; stale-PID reclaim (ESRCH vs EPERM); PID cleanup on all exit paths; holder identification never throws.

Commit: `refactor(cli): extract shared/process.ts; harden serve PID/port (Step 7)`.

### Step 8 — backup / export / import / diagnose CLIs (Backend Engineer)

- Pick the tar approach (§3) and document it.
- `src/cli/commands/{backup,export,import,diagnose}.ts` (new) + wire into `src/cli/index.ts`. **N4: update the HELP text and remove the stale "Future subcommands (Phase 4+)" note.**
  - `backup` → `.substrate/backups/substrate-<ts>.tar.gz` (config + boards/ + a consistent data.sqlite snapshot: `wal_checkpoint(TRUNCATE)` then copy; exclude wal/shm/pid/backups). Print path.
  - `export <path>` → same tarball to an arbitrary path.
  - `import <path>` → **zip-slip invariant (R3, mandatory regardless of tar choice): every entry's resolved path must be within the target dir (`path.resolve(target, name)` starts with `target + sep`); reject absolute paths, `..` segments, and symlink entries; abort the whole extract on any violation.** Refuse if `.substrate/config.json` exists unless `--force`; **also refuse if `substrate.pid` exists and the PID is alive** (don't import over a live DB — C5). Validate archive shape before extracting.
  - `diagnose` → Node version, OS/arch, port-7475 status, schema version (if DB openable), substrate integrity (config parse, board parse + counts), backup count, key paths. **Never throws** — each probe wrapped; a broken/garbage `config.json` yields a diagnostic line + non-zero exit.

Tests:
- CLI integration — `backup` produces a readable tarball with expected entries; `export`→`import` round-trip into a fresh dir; **`import` rejects a zip-slip entry** (crafted `../` path); `import` refuses over an existing project without `--force` and refuses over a live PID; `diagnose` against (a) healthy and (b) garbage-config `.substrate/` reports specifics + exit codes.

_Reviewer focus (Step 9):_ zip-slip rejection; diagnose-never-crashes; backup snapshot consistency (checkpoint before copy); import live-PID guard.

Commit: `feat(cli): backup/export/import/diagnose (Step 8)`.

### Step 9 — 🛑 Code Reviewer pass (lifecycle half)

One Code Reviewer over the Step 6–8 diff. Concentrate on:
- Auto-backup (Step 6): original integrity on failure.
- Lifecycle (Step 7): no regression of post-bind `wx`; stale-PID reclaim; PID cleanup; holder id never throws.
- CLIs (Step 8): zip-slip safety, diagnose-never-crashes, backup consistency, import live-PID guard.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 4 lifecycle findings (Step 9)` (only if findings).

### Step 10 — Acceptance + integration + audit + merge (Backend Engineer → Assistant)

- New `tests/integration/mcp-substrate-edit-flow.test.ts`: over real MCP stdio — `create_board` → `create_group` ×2 → `create_policy` (a transition_guard) → `create_task` → `update_task` blocked by the just-authored guard → `archive_group` conflict on the task's group → `reorder_groups`. Asserts files on disk + version bumps + envelopes.
- Extend `tests/manual/run-smoke.mjs`: author a board via `create_board` (not a hand-written fixture) then run a task through it; call `diagnose`.
- Acceptance gate: `pnpm build`, `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm test:smoke:concurrency`, `node tests/manual/run-smoke.mjs`, `npm pack --dry-run`. Bump `BINARY_VERSION` → `0.0.4`.
- Spawn Assistant → `.agents/audits/phase-04-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag `phase-04-complete`.

Commits: `test: substrate-edit-flow integration + smoke updates (Step 10)`, `chore(phase-04): acceptance pass + 0.0.4 (Step 10)`, `docs(phase-04): assistant audit (Step 10)`.

## 5. Test mapping (spec §5 → plan)

| Spec test requirement | Plan location |
|---|---|
| writer atomic + CAS | Step 1 |
| validateBoardStructure | Step 1 |
| config backward-compat + CAS-through-default | Steps 1–2 |
| project/board edit tools | Step 2 |
| group edit tools + archive conflict | Step 3 |
| policy edit tools | Step 4 |
| auto-backup + failure integrity | Step 6 |
| process helpers + serve lifecycle (incl. SIGKILL reclaim) | Step 7 |
| backup/export/import/diagnose + zip-slip | Step 8 |
| substrate-edit e2e | Step 10 |

## 6. Risks

- **R1 (atomic rename on Windows):** `rename` over an existing file isn't guaranteed atomic on Windows. Documented gap (spec §3.1 R-1); POSIX is the dogfood platform.
- **R2 (cross-process lost update on create ops):** create_* carry no version (LWW). Re-read-just-before-write minimizes the window; documented residual.
- **R3 (zip-slip on import):** mandatory per-entry path containment check + reject absolute/`..`/symlink entries; abort on violation. Tested (Step 8), reviewed (Step 9).
- **R4 (backup snapshot torn under concurrent writes):** `wal_checkpoint(TRUNCATE)` then copy; acceptable for single-user. Documented.
- **R5 (diagnose crashing on broken substrate):** every probe wrapped; tested against a garbage config.
- **R6 (Config shape change):** old configs lack version/description → optional-with-defaults on read; write-side requires them; Step 1 tests the round-trip.
- **R7 (archive_group DB→file race — NEW, C3):** the active-task SQLite check is not atomic with the board-file write; a concurrent `create_task`/`update_task` could move a live task into the group between the check and the rename, leaving an archived group with a live task. **Accepted for single-user v1** — the read/engine side tolerates it (`validateSubstrate` permits references to archived groups; transition guards still evaluate; `list_tasks` still returns the tasks). Documented, not closed.

## 7. Definition of Done

- All step commits on `feature/phase-04-substrate-edit-lifecycle`.
- BOTH Code Reviewer passes (Steps 5 + 9) done; BLOCKER/CONCERN findings resolved.
- Spec §6 acceptance criteria met.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-04-complete`.
