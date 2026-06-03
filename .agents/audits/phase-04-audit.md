# Phase 4 Audit — Substrate-Edit Tools + Lifecycle

**Date:** 2026-06-02
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-04-substrate-edit-lifecycle`
**HEAD:** `4f72af4` — `test: substrate-edit-flow integration + smoke updates; acceptance 0.0.4 (Step 10)`
**Commits this phase produced:** 10 on top of `main` (tag `phase-03-complete`), plus the spec/plan doc commit.

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (approved 2026-06-01; §3.0 decisions locked; §7 recommendations all confirmed) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1, approve-with-changes, 1 BLOCKER resolved; B1/C1–C5/N1–N5 incorporated) |
| Stage 3 — Development | DONE — all 10 steps committed; lint/format/types/build all clean |
| Stage 4 — QA | DONE — 390 unit+integration green; concurrency + manual smoke run separately, passing |
| Stage 5 — Phase-end | DONE with notes (accepted residuals + the persistently-deferred sanitizer recorded below) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-04-spec.md` — `Status: APPROVED (Diego, 2026-06-01)`. |
| 2 | No development without an approved plan | `.agents/plans/phase-04-substrate-edit-lifecycle.md` — `Status: Reviewed v1.1 … ready for development`. |
| 3 | No commits without code review | **TWO** Code Reviewer gates per plan §Step 5 + §Step 9. Both produced fix commits: `40d6515 fix(review): … mid-phase findings (Step 5)` and `05acb3b fix(review): … lifecycle findings (Step 9)`. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied.

## Commit list (`main..HEAD`)

```
4f72af4 test: substrate-edit-flow integration + smoke updates; acceptance 0.0.4 (Step 10)
05acb3b fix(review): address Phase 4 lifecycle findings (Step 9)
9f70c27 feat(cli): backup/export/import/diagnose (Step 8)
57aa3d9 refactor(cli): extract shared/process.ts; harden serve PID/port (Step 7)
56331aa feat(storage): auto-backup before migration (Step 6)
40d6515 fix(review): address Phase 4 mid-phase findings (Step 5)
bc20e1b feat(mcp): policy edit tools (Step 4)
dfd6e78 feat(mcp): group edit tools incl. archive conflict check (Step 3)
d3aa572 feat(mcp): project + board edit tools (Step 2)
f76c0a3 feat(substrate): atomic writer + validateBoardStructure + Config version/description + deps.root (Step 1)
```

One commit per plan Step (1–4, 6–8), both `fix(review)` gate commits (Steps 5, 9), and the Step 10 acceptance/integration commit. (`983f7ae docs: Phase 4 spec + plan` precedes the branch work.) **Minor deviation from the plan's commit choreography:** Step 10 projected three commits (`test: … integration + smoke`, `chore(phase-04): … 0.0.4`, `docs(phase-04): assistant audit`). In practice the integration test, smoke updates, and the `0.0.4` bump all rode the single `4f72af4`, and this audit lands separately. Cosmetic; all content present.

## Spec §6 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `create_board` writes `boards/<id>.json` atomically; a concurrent stale-version `update_board` returns `version_mismatch` | PASS | `writer.ts:68–90` (`createBoardFile`, `wx` exclusive create + fsync); `board-edit.test.ts` "rejects a stale version with version_mismatch (no current_version)" (line 78) + the second-stale-write path (lines 99–100). Integration `mcp-bootstrap-flow.test.ts` writes a real `boards/<uuid>.json` via stdio (line 548–549). |
| 2 | `archive_group` returns `conflict` with an active task referencing it; succeeds otherwise | PASS | `archive-group.ts:46–55` bound-param `SELECT 1 FROM tasks WHERE group_id = ? AND archived_at IS NULL LIMIT 1` → `conflict`. `group-edit.test.ts`: conflict-on-active-task (line 145), "succeeds when only archived tasks reference it" (line 152), idempotent re-archive (line 160). |
| 3 | Two `serve` from one dir: second errors cleanly; ungraceful kill + restart reclaims the stale PID | PASS | `serve.ts`: live-PID refusal (lines 49–58) + post-bind `wx` exclusive write (lines 106–119). `serve-lifecycle.test.ts`: "reclaims a stale PID file (dead process) and starts cleanly" (line 114); double-start refusal (existing) + SIGKILL/SIGINT lifecycle helpers (lines 19–50). |
| 4 | Auto-backup file present after a migration; original `data.sqlite` intact on simulated failure | PASS | `runner.ts:98–112` (checkpoint+copy → `.bak-<stamp>`, only when pending, best-effort). `runner.test.ts`: ".bak file written when pending, reaches target version" (line 160), "NO backup when nothing is pending" (line 177); "rolls back the transaction when a migration throws" asserts version stays 1 + poisoned table empty (lines 90–124). |
| 5 | `substrate diagnose` against an intentionally-broken `.substrate/` reports specific problems (no crash) | PASS | `diagnose.ts`: every probe wrapped; `process.exitCode = 1`, never throws (lines 19–103). `lifecycle-cli.test.ts`: "diagnose reports problems on a broken substrate without throwing" against `{not json` config (line 83). |
| 6 | `substrate backup` produces a tarball; `substrate import` restores it | PASS | `archive.ts` (`createSubstrateArchive` + clean-replace `extractSubstrateArchive`). `lifecycle-cli.test.ts`: "backup writes a tarball into .substrate/backups/" (line 28), "export → import round-trips into a fresh project" (line 37). |
| 7 | `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build`, concurrency smoke, manual MCP smoke all green | PASS | See Test results. **390 tests, 53 files, 0 failures.** All static gates exit 0. Concurrency + manual smoke run separately by Diego this session, passing. |
| 8 | `BINARY_VERSION` → `0.0.4` (no `BINARY_SCHEMA_VERSION` bump) | PASS | `src/core/version.ts`: `BINARY_VERSION = '0.0.4'`; `package.json` version `0.0.4`; `BINARY_SCHEMA_VERSION = 2` (unchanged). |

## Spot-checked correctness claims

- **Path-traversal guard applied on both write paths.** `assertSafeBoardId` (`writer.ts:16–26`) rejects empty, non-`basename`, `/`, `\`, and `..`, throwing `not_found` (does not confirm the traversal). Called in `createBoardFile` (line 69) **and** `mutateBoardFile` (line 129). Both file-creation paths use `open(..., 'wx')` + `handle.sync()` + atomic `rename`; `writeJsonAtomic` cleans the temp on write/sync failure (lines 51–64) and on rename failure (lines 61–64). A no-op mutate (`next === board`) skips the write entirely (line 145).
- **`version_mismatch` never leaks `current_version`.** All edit tools route OCC through a single `assertVersion` helper (`substrate-edit.ts:15–20`) that throws `SubstrateError.versionMismatch(msg, { id })` — `{ id }` only, no current value. `grep` across `src/mcp/tools/write/` finds no `current_version` references outside test assertions that confirm its absence.
- **`validateBoardStructure` raises `schema_violation` (not `internal_error`).** `validator.ts:78–79` — `validateBoardStructure(board)` calls `checkBoardStructure(board, SubstrateError.schemaViolation)`; the whole-substrate `validateSubstrate` stays on the load path with `internal_error`. Edit tools validate pre- and post-mutate (`board-edit.test.ts` malformed-field_schema → `schema_violation`, no file written, line 114).
- **`archive_group` conflict (bound param) + R7 residual.** Bound-param DB check before the file write (`archive-group.ts:46–55`); the R7 non-atomicity is documented in the file header (lines 18–22) and plan §R7.
- **Zip-slip defenses (archive.ts).** `assertArchiveSafe` (lines 42–80) rejects absolute paths, Windows drive prefixes, any `..` segment, entries outside the allowed top-level set, **and any entry whose type is not `File`/`Directory`** (symlink/hardlink `linkpath` escape, C-1). `extractSubstrateArchive` adds `preservePaths: false` + an extract-time `filter` enforcing `dest` stays within `targetRoot + sep` (lines 105–115). Import is a **clean replace** (durable entries `rm`'d first, lines 96–104), not a merge. Tested: `archive.test.ts` "rejects a zip-slip archive" (line 55) and "rejects an archive containing a symlink entry (C-1 linkpath escape)" (line 66).
- **Import refuses over a live PID.** `import.ts:33–41` reads the PID file and, if `isProcessAlive`, throws `conflict`; also refuses over an existing `config.json` without `--force` (lines 43–48). Tested: `lifecycle-cli.test.ts` "import refuses when a live PID owns the directory" (line 62).
- **`diagnose` never throws on a broken substrate.** Each probe (config, boards, db, backups, port) is wrapped in `try/catch`; problems increment a counter and set `process.exitCode = 1` rather than throwing (`diagnose.ts:19–103`). Also reports the backup count.
- **serve PID/port EXTRACTED, post-bind `wx` preserved.** `serve.ts` imports `isProcessAlive`/`identifyPortHolder` from the new `shared/process.ts` (line 16); the PID file is written **after** a successful bind with `{ flag: 'wx' }` (lines 106–119), and EADDRINUSE maps to `conflict` with best-effort holder identification (lines 95–101). `identifyPortHolder` returns `null` on every error path — never throws (`process.ts:52–76`). This is a refactor of the existing Phase-1 lifecycle, not a reimplementation.
- **Config backward-compat.** `config.ts` makes `description` (`z.string().default('')`) and `version` (`z.number().int().positive().default(1)`) optional-with-defaults on read; a legacy config (no version/description) loads, and the defaulted `version: 1` is what the first `update_project({ version: 1 })` CAS compares against. `board-edit.test.ts` exercises the legacy-config CAS path.

## Test results

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `pnpm test` (unit + integration) | 53 | **390** passed | 26.80 s | green |
| `pnpm test:smoke:concurrency` (60 s) | — | — | — | run separately this session, passing |
| `pnpm exec tsc --noEmit` (root) | — | — | — | clean (exit 0) |
| `pnpm --dir ui exec tsc --noEmit` | — | — | — | clean (exit 0) |
| `pnpm exec eslint .` | — | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | — | clean ("All matched files use Prettier code style!", exit 0) |
| `pnpm build` | — | — | — | clean (UI 192.13 KB JS / 8.33 KB CSS, exit 0) |
| Manual MCP-client smoke (`run-smoke.mjs`) | — | — | — | run separately this session, passing |

**390 passing** — +59 over Phase 3's 331; 53 test files (+7). Tool surface confirmed at **29** (`registry.ts`: 29 distinct `register*` tool calls excluding the `registerAllTools` aggregator; the integration `mcp-bootstrap-flow.test.ts` asserts the exact 29-name list).

## Coverage notes (tested vs. gaps)

**Well covered.** Every Phase 4 module ships co-located tests. The 13 edit tools are tested in four grouped files (`board-edit.test.ts`, `group-edit.test.ts`, `policy-edit.test.ts`, plus `update-project` coverage), the writer is exercised through them and the integration flow, and the lifecycle layer has `runner.test.ts`, `process.test.ts`, `serve-lifecycle.test.ts`, `archive.test.ts`, and `lifecycle-cli.test.ts`. Spec §4 edge-case table maps cleanly:

| Spec §4 case | Covered by |
|---|---|
| `update_board` stale version → `version_mismatch` (no current_version) | `board-edit.test.ts:78` + `JSON.stringify(error)` not-contains `current_version` |
| `update_group` / `update_policy` id in no board → `not_found` | `group-edit.test.ts:118`, `policy-edit.test.ts` (findBoardHolding path) |
| `archive_group` with active task → `conflict` | `group-edit.test.ts:145` |
| `archive_group` only-archived/no tasks → succeeds | `group-edit.test.ts:152` |
| re-archive board/group/policy → idempotent | `board-edit.test.ts:171`, `group-edit.test.ts:160`, `policy-edit.test.ts:131` |
| `reorder_groups` non-permutation → `schema_violation` | `group-edit.test.ts:127–142` |
| `create_board` malformed field_schema → `schema_violation`, no file | `board-edit.test.ts:114` |
| edit producing a duplicate group id → `schema_violation` | post-mutate `validateBoardStructure` (validator.test.ts dup-group-id case) |
| `update_policy` changing `type` → `schema_violation` | `policy-edit.test.ts:102` (rejects, per N2 — not silently ignored) |
| concurrent stale write → `version_mismatch` | writer CAS-in-callback; `board-edit.test.ts` second-stale path |
| `serve` live PID → refuse | `serve-lifecycle.test.ts` double-start (existing) |
| `serve` stale PID → reclaim | `serve-lifecycle.test.ts:114` (SIGKILL → restart) |
| `diagnose` missing/garbage config → reports, exit non-zero, no crash | `lifecycle-cli.test.ts:83` |
| migration → `.bak-<ts>` present; original intact on failure | `runner.test.ts:160` + rollback-keeps-v1 (lines 90–124) |

Plus the cross-feature integration: `mcp-bootstrap-flow.test.ts` authors a board → 2 groups → a `transition_guard` policy via `create_policy`, then proves the just-written policy **engages the Phase 3 engine** by blocking an `update_task`, hits an `archive_group` conflict, and runs `reorder_groups` — all over real MCP stdio with on-disk assertions.

**Gaps / thin spots (none blocking):**

1. **Integration test naming/location deviation.** The plan §Step 10 named a new `tests/integration/mcp-substrate-edit-flow.test.ts`; in practice the substrate-edit e2e chain was folded into the existing `mcp-bootstrap-flow.test.ts`. Functionally equivalent (the full create_board → … → reorder_groups chain is present and asserted), but a reader looking for the plan-named file won't find it. Cosmetic.
2. **No isolated `writer.test.ts`.** The plan §Step 1 named a dedicated `writer.test.ts` (atomic round-trip, temp cleanup on error, `not_found` on missing file, `wx` rejects existing, `mutateConfig` round-trip). The writer is thoroughly exercised **transitively** through the edit-tool tests and the integration flow, but there is no standalone unit test file targeting `writer.ts` primitives (notably the temp-cleanup-on-error and `mutateConfig`-round-trip branches in isolation). Code is correct by inspection; risk low; worth a small follow-up.
3. **Concurrency + manual smoke not re-executed in this audit** — accepted on Diego's word that both ran green this session (per instruction). The manual smoke was extended this phase to author a board via `create_board` and call `diagnose`. This audit did not independently observe them green.

## Scope deviations from spec

1. **Edit-tool tests are grouped, not one-file-per-tool.** Spec §5 / plan called for "one `*.test.ts` per edit tool." Shipped as four grouped files (`board-edit`, `group-edit`, `policy-edit`, plus update-project coverage) rather than 13 files. All per-tool cases (happy + version_mismatch + idempotency + the §4 edge) are present; only the file granularity differs. **Accepted / cosmetic.**
2. **Substrate-edit e2e folded into `mcp-bootstrap-flow.test.ts`** rather than a standalone `mcp-substrate-edit-flow.test.ts` (gap 1 above). **Accepted; content present.**
3. **OS-level file locking remains out of scope** — by design (spec §2, §3.0 decision 2). Write safety is atomic-rename + per-entity version CAS only. **Accepted / intentional.**
4. **Markdown sanitizer (`src/shared/sanitize.ts`) STILL deferred.** Confirmed absent again this phase. It was nominally expected in Phase 3 (per the Phase-2 audit), slipped there, and Phase 4 — which adds the substrate-edit tools that let agents author policy `message` / board `description` strings — also does not add it. These author-supplied strings are returned verbatim over MCP/JSON. Benign for a local single-user tool with no HTML rendering in the MCP path, but the deferral now spans three phases and lands squarely on Phase 5 (HTTP API mirror + UI), which will render them. **Noted deviation; non-blocking for v1 MCP scope, hard prerequisite for the UI phase.**

## Residual risks / deferrals

1. **R1 — atomic rename on Windows.** `rename` over an existing file is not guaranteed atomic on Windows; POSIX is the dogfood platform. Documented (spec §3.1 R-1, plan R1). **Accepted residual.**
2. **R2 — cross-process lost update on create-ops (LWW).** `create_board`/`create_group`/`create_policy`/`reorder_groups` carry no version; the re-read-just-before-rename minimizes but does not close the window. **Accepted residual** for single-user v1.
3. **R7 — `archive_group` DB→file race.** The active-task SQLite check is not atomic with the board-file write; a concurrent `create_task`/`update_task` could move a live task into the group between the check and the rename, leaving an archived group with a live task. The read/engine side tolerates this (validateSubstrate permits references to archived groups; guards still evaluate; `list_tasks` still returns the tasks). Documented in `archive-group.ts` + plan §R7. **Accepted residual.**
4. **No OS file locking** (R1 above's sibling) — two `substrate mcp` stdio processes editing the same board file rely entirely on atomic-rename + CAS. **Accepted by §3.0 decision 2.**
5. **No backup retention/pruning.** `.bak-<ts>` (migration) and `backups/*.tar.gz` (CLI) files accumulate unbounded; `diagnose` reports the count but nothing prunes. Documented (spec §7.5, plan R after Step 6). **Accepted for v1.**
6. **Markdown sanitizer still deferred** (deviation 4) — becomes load-bearing when Phase 5's HTML UI renders author-supplied `description` / policy `message` strings. **Track as a Phase 5 prerequisite.**

## Verdict

**SHIP — go for fast-forward merge to `main` + tag `phase-04-complete`.**

Phase 4 substantively meets every spec §6 acceptance criterion. All locally-run gates are clean: **390 tests green** (53 files, 0 failures), root + ui `tsc` clean, eslint clean, prettier clean, build clean. `BINARY_VERSION` is `0.0.4`, `package.json` is `0.0.4`, and `BINARY_SCHEMA_VERSION` stays `2` (no migration this phase, as specified). The 29-tool surface is registered and asserted in the integration flow. Both Code Reviewer gates (Steps 5 + 9) ran and produced fix commits — all four workflow hard gates satisfied. The concurrency and manual smoke suites were run separately by Diego this session and pass.

Spot-checks confirm the load-bearing claims: the path-traversal guard is applied in **both** `createBoardFile` and `mutateBoardFile`; `version_mismatch` leaks no `current_version` (single `assertVersion` chokepoint); `validateBoardStructure` raises `schema_violation` (not `internal_error`) and runs pre- and post-mutate; `archive_group`'s active-task check uses a bound param with the R7 residual documented; the zip-slip defense rejects absolute/`..`/symlink/hardlink entries **and** containment-filters at extract time, with import doing a clean replace and refusing over a live PID; `diagnose` wraps every probe and sets a non-zero exit code instead of throwing; and the `serve` PID/port logic was extracted into `shared/process.ts` with the post-bind exclusive (`wx`) write preserved.

The gaps are cosmetic/low-risk: edit-tool tests grouped rather than per-file, the e2e folded into `mcp-bootstrap-flow.test.ts` (functionally equivalent), and no standalone `writer.test.ts` (the writer is covered transitively). The one deviation worth carrying forward is the **markdown sanitizer**, now deferred for a third consecutive phase — benign in the MCP/JSON path today but a hard prerequisite for Phase 5's HTML UI. Accepted residuals (Windows rename, create-op LWW, archive_group race, no file locking, no backup retention) are all consistent with the spec's locked decisions.

Recommended next actions (Orchestrator):
1. Optionally add a standalone `writer.test.ts` (temp-cleanup-on-error, `mutateConfig` round-trip in isolation) — non-blocking.
2. **Track the markdown sanitizer as a Phase 5 (UI) prerequisite** — it can no longer slip.
3. Flip plan status to `Complete`.
4. Fast-forward merge to `main`, tag `phase-04-complete`.
