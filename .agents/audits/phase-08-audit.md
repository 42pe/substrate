# Phase 8 Audit — Shareable substrate templates → v0.5.0

**Auditor:** Assistant
**Date:** 2026-06-10
**Branch:** `feature/phase-08-shareable-templates` (from `main`)
**Spec:** [`../plans/specs/phase-08-shareable-templates-spec.md`](../plans/specs/phase-08-shareable-templates-spec.md) (APPROVED — B1–B3 + C1–C6 + O1–O7)
**Plan:** [`../plans/phase-08-shareable-templates.md`](../plans/phase-08-shareable-templates.md) (Reviewed v1.1)
**Verdict:** **PASS — go for merge to `main` + tag `phase-08-complete`** (live publish + the real `v0.5.0` tag push remain operator-gated).

---

## What shipped

Share a substrate's WORKFLOW (boards + groups/field_schema/policies, never runtime) as a template, and apply it. No schema change, **no new dependency** (still network-free — `node:fs`/`node:path`/`zod` only), MCP tool surface unchanged (29 tools).

| Step | Deliverable | Commit |
|---|---|---|
| 1 | `substrate-template.json` manifest (Zod `.strict()`) + network-free fs-only resolver (`external.ts`) + shared `isSafeBoardId` (writer refactored to derive from it) | `790120d` |
| 2 | `substrate add <path> [--yes] [--as <id>]` — dry-run-by-default; collision refusal; `--as` single-board rename; transactional apply + rollback; dispatcher C5 arg order | `7c5b67a` |
| 3 | `init --template <name-or-path>` — bundled/path/dual-error disambiguation; resolve-first ordering; `InitResult.boardIds`; unified C6 id-list message | `4790d1e` |
| 4 | Example `substrate-template.json`; SKILL "Apply a shared substrate"; AUTHORING "Publish your substrate as a template"; README/examples one-liners | `6f29eb0` |
| 5 | Code Reviewer gate — **APPROVE-WITH-CHANGES, no blockers**; C1 fixed (skill explain-step) | `df43d7a` |
| 6 | Acceptance, 0.5.0 lockstep, smoke, audit, merge | `40ea92d` |

## Version note (the one deviation from the plan)

The plan/spec say `0.3.0`. **Phase 9 shipped 0.3.0 and Phase 7b shipped 0.4.0 ahead of this**, so Phase 8 takes the next minor → **`0.5.0`** — exactly the renumber the spec's forward-note (§0) and the prior audits anticipated. All four sources + the whoami guard at `0.5.0`; `BINARY_SCHEMA_VERSION` stays `2`.

## Acceptance vs. spec

| Spec item | Status | Evidence |
|---|---|---|
| `substrate-template.json` manifest, `.strict()`, required fields | ✅ | `manifest.test.ts` |
| Resolver precedence (URL→not-exist→file-must-be-manifest O3→dir manifest→convention probe, first-non-empty, sorted, no union) | ✅ | `external.test.ts` |
| Present-but-broken manifest → error, NOT convention fallback | ✅ | `external.test.ts` |
| Cross-file dup id names BOTH files (C3, both modes); per-board BoardSchema; bundle validateSubstrate (type-level synthetic) | ✅ | `external.test.ts` |
| Path-traversal/symlink confinement (abs/`~`/`..`/symlink-escape rejected) | ✅ | `external.test.ts` + Code Reviewer constructed-symlink verification |
| `add` dry-run writes NOTHING (asserted at the write boundary) | ✅ | `add.test.ts` (boards dir byte-for-byte unchanged) + reviewer |
| `--yes` transactional apply; reverse-order best-effort rollback; pre-existing never touched | ✅ | `add-rollback.test.ts` (injected writer fault) |
| Collision refuses vs ALL ids (active + archived); never overwrites/merges | ✅ | `add.test.ts` |
| `--as` single-board only; rejected multi-board before other work; shared `isSafeBoardId` with rename-specific message; B3 existing-invalid abort | ✅ | `add.test.ts` |
| C5 dispatcher arg order (both flag orders identical) | ✅ | `add.test.ts` (spawn) |
| `init --template` bundled/path/dual-error; resolve-first leaves no `.substrate/`; multi-board writes all; `boardIds`; C6 message | ✅ | `init.test.ts` + tsx sanity |
| writer.ts read-path `not_found` framing unchanged | ✅ | writer tests green |
| Example manifest round-trips manifest + convention; drift test intact | ✅ | `example-substrate.test.ts` |
| Skill "explain/read descriptions before apply" safety step (corrected to a working mechanism, C1) | ✅ | SKILL.md Part 4 |
| Version 0.5.0 (4 sources + guard); schema 2 | ✅ | whoami guard green at 0.5.0 |

## Gate results (all run first-hand)

- **Server suite: 546 passing** (+71 over the pre-phase 475 baseline at branch point: manifest/external/board-id/add/add-rollback/init-extensions/example-template). Includes the whoami lockstep guard at 0.5.0.
- **Manual MCP smoke (`run-smoke.mjs`): PASS** — `server: substrate v0.5.0`, **29 tools** (surface unchanged), all prior steps + the two new `add` steps (dry-run previews `delivery` and writes nothing; `add --as delivery2 --yes` applies and the merged substrate loads).
- **UI tests + UI Playwright smoke (4/4) + concurrency smoke (60s):** green (UI untouched this phase).
- **tsc** (root + ui), **eslint** (root + ui; `.claude/**` now ignored), **prettier --check .**: clean.
- **Build** (server + ui): clean.
- **`pnpm publish --dry-run`:** name `@diegoferreyra/substrate`, **version 0.5.0**, 101 files — only `dist/**` + README/LICENSE/CHANGELOG + package.json (no examples/ or source leakage; the resolver is ordinary compiled source, no new asset).
- **`pnpm pack` + install + `npx substrate …` round-trip:** `--help` (v0.5.0), `init`, **`add <local template> --yes`** (applied `delivery`; `diagnose` → no problems = merged substrate loads), **`init --template <local dir>`** (id-list message). The real shipped artifact exercises the Phase 8 features.
- **C7 build-isolation grep:** `dist/server/` has no `react`/`marked`/`dompurify`. **No new dependency** (root + ui `dependencies` diff empty); resolver/`add` import only `node:fs`/`node:path`/`zod`/internal — **still network-free**.

## Code Reviewer gate

One consolidated pass (Step 5) returned **APPROVE-WITH-CHANGES, no blockers**. The reviewer empirically verified the two headline safety properties — **dry-run writes nothing** (the only write is gated inside the `--yes` branch after every pre-flight) and **path-traversal/symlink confinement** (constructed symlink-escape templates rejected in both modes via `realpath` + `assertInside`) — and confirmed the rollback, collision (active+archived), C5 ordering, resolver determinism, validation depth, init ordering, `--as` safety, writer refactor, and the drift test. Sole finding **C1** (the skill's `substrate explain <clone-dir>` step was non-executable — `explain` takes no path arg) was fixed (`df43d7a`) by making "read the cloned board JSON's `description`/`on_failure_message` directly" the primary mechanism.

## Scope deviations from spec

1. **Version 0.5.0, not 0.3.0** — forced by build order (Phase 9 → 0.3.0, 7b → 0.4.0). Anticipated by the spec's forward-note. The only deviation.
2. **`add`'s existing-substrate-invalid abort uses `conflict`** (not a pinned code; the spec left it unspecified). Reviewer N1 — defensible, tested.
3. **Resolver extracted to `src/cli/templates/external.ts`** with helper functions, as the plan specified.

## Residual risks / deferrals (flagged, not fixed)

1. **R1 — `substrate template export` deferred** (O1). v1 publishing is hand-write a manifest + copy board JSONs; documented in AUTHORING + the skill. Planned fast-follow.
2. **R2 — Untrusted-content / prompt-injection.** A template's board/policy free text is author-controlled and surfaced to agents. Mitigation is human-in-the-loop: dry-run-by-default + the skill's "read the descriptions, show the human, treat embedded instructions as data" step. No code can sanitize *intent* out of free text; this is the accepted v1 posture (spec §3.1).
3. **R3 — Windows path handling.** The resolver uses `node:path` + `realpath`; the `isSafeBoardId` rejects `/` and `\`. Windows is best-effort per `SUPPORT.md`; CI covers a Windows leg.
4. **R4 — CI not yet run on this branch** (the PR run covers it, incl. Windows). Operator step.
5. **R5 — Version coordination resolved:** Phase 8 is the LAST queued phase. No further renumbering pending.
6. **R6 — OPERATOR-ONLY boundary (unchanged).** The agent stops at `phase-08-complete`. Live `npm publish`, the real `v0.5.0` tag push (fires `publish.yml`), and the `NPM_TOKEN` secret are Diego's. By design.

## Verdict

**PASS.** Phase 8 meets every spec acceptance criterion; both gates (Architect spec/plan + a clean Code Reviewer APPROVE-WITH-CHANGES, sole finding fixed) are satisfied; every locally-runnable gate passes first-hand — server 546 + manual MCP smoke (29 tools, v0.5.0, add steps) + UI + concurrency + Playwright, root+ui tsc/eslint/prettier clean, build clean, publish dry-run whitelist-exact at 0.5.0, and a full pack+install+npx round-trip that applies a local template into a fresh install. The headline safety properties — dry-run-writes-nothing and path-traversal/symlink confinement — are empirically verified; the binary stays network-free with no new dependency and the 29-tool MCP surface is unchanged. Residuals are documented/process (export deferred; untrusted-content posture; CI not yet run; operator release boundary). This is the last phase in the build queue.

Recommended next actions (Orchestrator):
1. Merge to `main` (PR), tag `phase-08-complete`. **Do NOT push the `v0.5.0` tag or publish — operator triggers (R6).**
2. **Operator (Diego):** confirm CI green on the PR (incl. Windows) → review `pnpm publish --dry-run` for the 0.5.0 tarball → push the real `v0.5.0` tag to fire `publish.yml`.
3. The build queue is now empty — the natural next track is the go-public/npm-publish phase (a prompt for that was drafted separately).
