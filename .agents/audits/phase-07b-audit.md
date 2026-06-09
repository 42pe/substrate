# Phase 7b Audit — Error logging & reporting → v0.4.0

**Auditor:** Assistant
**Date:** 2026-06-09
**Branch:** `feature/phase-07b-error-logging` (from `main`)
**Spec:** [`../plans/specs/phase-07b-error-logging-spec.md`](../plans/specs/phase-07b-error-logging-spec.md) (APPROVED — CONCERN-1/2/3 + R1–R7)
**Plan:** [`../plans/phase-07b-error-logging.md`](../plans/phase-07b-error-logging.md) (Reviewed v1.1)
**Verdict:** **PASS — go for merge to `main` + tag `phase-07b-complete`** (live publish + the real `v0.4.0` tag push remain operator-gated).

---

## What shipped

A persistent error log + reporting wiring. No schema change, **no new dependency** (plain Node `fs`), no MCP tool-surface change (still 29 tools).

| Step | Deliverable | Commit |
|---|---|---|
| 1 | File sink in `shared/logger.ts` (`buildSafeContext` strips reserved `err`; `formatForFile`; best-effort `writeEvent`; 5 MiB rotation) + `paths.logFile`/`logsDir` | `667020f` |
| 2 | `configureFileSink` in `mcp`/`serve` (after the `.substrate/`-guard); `err: e` at all 12 boundary sites | `0975ba9` |
| 3 | `substrate logs [-n <N>] [--errors]` + shared `log-read.ts` (HEADER_RE, rotation-aware read, next-header-anchored parse) | `0ab4155` |
| 4 | diagnose recent-errors section; gitignore `.substrate/logs/` (both places); bug-report/SUPPORT/README wiring | `3b81bff` |
| 5 | Code Reviewer gate — **APPROVE, no blockers/concerns** (no fix commit needed) | — |
| 6 | Version → 0.4.0, CHANGELOG, manual-smoke logs steps, audit, merge | (this step) |

## Acceptance vs. spec

| Spec item | Status | Evidence |
|---|---|---|
| File at `.substrate/logs/substrate.log`; `warn`+`error` written, `info` not | ✅ | `logger.test.ts` |
| Full detail incl. stack to the file via reserved `err`; boundary envelope generic | ✅ | `wrapper.test.ts` asymmetry test (file has stack+message; envelope `internal_error`) |
| `buildSafeContext` strips `err` from EVERY serialized context (console + file) | ✅ | `logger.test.ts` (console line & file header JSON both exclude `err`) |
| `agent_name` sanitized in the file (only required redaction) | ✅ | `logger.test.ts` (`[badname]` in file header) |
| One `appendFileSync` per composed event | ✅ | one-contiguous-event test + Code Reviewer confirmation |
| Whole sink (stat+rotate+append) never throws into the caller; synchronous | ✅ | un-writable-sink test (no crash, console still emitted) |
| 5 MiB single-generation rotation, best-effort, on-disk ≤ ~2× cap | ✅ | rotation test (`.1` appears, both files < cap) |
| Sink configured ONLY in `mcp`/`serve`, after the `.substrate/`-exists guard | ✅ | `mcp.ts`/`serve.ts` |
| `substrate logs`: 2 distinct empty-states; `-n` default 50 + non-pos-int rejected; `--errors`; rotation-aware; `--bogus` rejected | ✅ | `logs.test.ts` (10) + dispatch smoke |
| Next-header-anchored stack-block parse | ✅ | `parseEvents` boundary test |
| diagnose recent-errors: 5 headers, stacks excluded, pointer; exit code unchanged | ✅ | `diagnose.test.ts` (3) |
| gitignore `.substrate/logs/` in BOTH places; `*.log` misses `.1` | ✅ | `init.test.ts` + Code Reviewer's `check-ignore` proof |
| bug_report optional field (auto-close workflow unchanged); SUPPORT/README | ✅ | non-required field absent from the workflow's hardcoded required array |
| Version → 0.4.0 (4 sources + 1 guard); schema stays 2 | ✅ | version.ts/package.json/ui/whoami all 0.4.0; whoami guard green |
| Test isolation: no leaked `sinkPath` | ✅ | `afterEach(resetFileSink)` in both sink-configuring suites |

## Gate results (all run first-hand)

- **Server suite (unit+integration): 502 passing** (+19 over the pre-phase 483: logger sink 7, wrapper asymmetry 1, logs 10, parseEvents 1, diagnose 3, init gitignore assert; minus none). Includes the whoami lockstep guard at 0.4.0.
- **Manual MCP smoke (`run-smoke.mjs`): PASS** — `server: substrate v0.4.0`, **29 tools** (surface unchanged), all prior steps + the two new `logs` steps (distinct "No log file yet"; `logs --errors` surfaces a seeded ERROR + stack).
- **UI Playwright smoke: 4/4** (UI unchanged this phase; confirms no regression).
- **Concurrency smoke: 1 passing** (60s).
- **tsc** (root build + ui), **eslint** (root + ui), **prettier --check .**: clean.
- **Build** (server + ui): clean.
- **`pnpm publish --dry-run`:** name `@diegoferreyra/substrate`, **version 0.4.0**, 97 files — only `dist/**` + README/LICENSE/CHANGELOG + package.json (includes `dist/server/cli/commands/logs.js` + `dist/server/shared/log-read.js`); no source/test leakage. **Dependencies unchanged** (root + ui diff empty but for the version line).

## Code Reviewer gate

One consolidated pass (Step 5) returned **APPROVE — no blockers, no concerns.** The reviewer independently verified the boundary asymmetry is provable (the reserved `err` is deleted from every serialized context; every envelope is a separate `SubstrateError.internalError(...)` statement), the sink's best-effort/synchronous/one-write guarantees, the rotation, the next-header-anchored parse, test isolation (every `configureFileSink` has a matching reset), the gitignore `*.log`-misses-`.1` claim (proved via `check-ignore`), no new dependency, and the auto-close-workflow non-impact. No fix commit was required.

## Scope deviations from spec

1. **Reader extracted into `src/shared/log-read.ts`** (HEADER_RE + `readRotatedLines`/`readCurrentLines`/`parseEvents`) rather than inlined in `logs.ts`/`diagnose.ts` with a shared `HEADER_RE`. A cleaner realization of the same "one shared `HEADER_RE`" intent; both `logs` and `diagnose` import it. **Improvement, in-spec.**
2. **`configureFileSink`/`resetFileSink` are standalone exports** (not methods on the `logger` object as the spec's `logger.configureFileSink(...)` illustration implied). Call sites import them directly. **Cosmetic, no contract impact.**

## Residual risks / deferrals (flagged, not fixed)

1. **R1 — Windows multi-process append.** `O_APPEND` atomicity is a POSIX guarantee; Windows is best-effort (interleaving without corruption is the worst case, and the log is a bug-report aid, not an audit trail). Documented in `SUPPORT.md`; accepted (spec §3.0-8).
2. **R2 — Multi-process rotation race.** Two appenders near the cap could both rotate (redundant rename / lost-`.1`). Tolerated, no lockfile (over-engineering for a log). Spec §3.5.
3. **R3 — Keystone: no secrets.** The file carries error messages + stack file-paths (fine on the user's own gitignored machine). If a future phase introduces secrets (tokens/cloud config), the "full detail to the file with only `agent_name` sanitization" design **must be revisited** (spec §3.0-4). Carried forward as a standing note.
4. **R4 — CI not yet run on this branch.** The three workflows are unchanged this phase; the Phase 7b diff has never hit the Actions matrix (incl. Windows). **Operator step** (the PR run covers it).
5. **R5 — Version coordination.** Phase 7b takes **0.4.0** (Phase 9 shipped 0.3.0). The **Phase 8 (shareable-templates)** spec+plan still say `0.3.0` while unbuilt — when built, Phase 8 takes **0.5.0** and updates its own 4 sources. **Flagged for whoever builds Phase 8 next.**
6. **R6 — OPERATOR-ONLY boundary (unchanged).** The agent stops at `phase-07b-complete`. Live `npm publish`, the real `v0.4.0` tag push (fires `publish.yml`), and the `NPM_TOKEN` secret are Diego's. **By design.**

## Verdict

**PASS.** Phase 7b meets every spec acceptance criterion; both gates (Architect spec/plan + a clean Code Reviewer APPROVE) are satisfied; every locally-runnable gate passes first-hand — server 502 + manual MCP smoke (29 tools, v0.4.0, new logs steps) + UI 4 + concurrency 1, root+ui tsc/eslint/prettier clean, build clean, publish dry-run whitelist-exact at 0.4.0 with dependencies unchanged. The feature's keystone — full detail (incl. stack) to the local gitignored file while the stdio/HTTP boundary stays generic — is provable and tested; the sink is best-effort and can never crash the process; `substrate logs` + the diagnose section + the report-doc wiring make a dogfooding bug reportable after the fact. Residuals are process/documented (CI not yet run; Phase 8's 0.5.0 renumber; the no-secrets keystone; Windows best-effort) — none block the merge.

Recommended next actions (Orchestrator):
1. Merge to `main` (PR or fast-forward), tag `phase-07b-complete`. **Do NOT push the `v0.4.0` tag or publish — operator triggers (R6).**
2. **Operator (Diego):** confirm CI green on the PR (incl. Windows) → review `pnpm publish --dry-run` for the 0.4.0 tarball → push the real `v0.4.0` tag to fire `publish.yml`.
3. When building Phase 8 next, renumber it off 0.3.0 → 0.5.0 (R5).
