# Phase 7b Plan — Error logging & reporting → v0.4.0

**Status:** Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES; B1 + C1–C2 incorporated) — ready for development.
**Author:** Architect
**Last updated:** 2026-06-09
**Spec:** [`specs/phase-07b-error-logging-spec.md`](specs/phase-07b-error-logging-spec.md) (APPROVED — CONCERN-1/2/3 + R1–R7 folded in)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md)
**Predecessor:** Phase 9 (`phase-09-complete`, **v0.3.0** — kanban inspector). Phases 1–7 + 9 are merged; Phase 8 (shareable templates) is specced+planned but NOT built. Repo private at `42pe/substrate`, unpublished.
**Feature branch:** `feature/phase-07b-error-logging` (from `main`).

---

## 0. Version coordination — this phase is **0.4.0**, NOT 0.3.0 (overrides spec §3.6)

The spec was written when `0.3.0` was free and says bump to `0.3.0`. **Phase 9 has since shipped `0.3.0`.** Per the spec's own forward-note (§0/§3.0-9) and the Phase 9 audit (R6), this phase takes the **next available minor → `0.4.0`**, and `PHASE_STRING` becomes **`v0.4.0 (error logging)`**. Everywhere the spec says `0.3.0`/`v0.3.0 (error logging)`, this plan substitutes `0.4.0`/`v0.4.0 (error logging)`. `BINARY_SCHEMA_VERSION` stays `2`. **(Phase 8, when built, then takes `0.5.0`.)** This is the single deliberate deviation from the spec; everything else is faithful.

## 1. Overview

Substrate keeps **no persistent error log** — `src/shared/logger.ts` is a thin console wrapper, and an MCP-session error's detail goes only to the child's stderr (which the agent runtime can swallow) while the agent gets a generic scrubbed `internal_error` envelope. This phase adds a **persistent, size-bounded error log** at `.substrate/logs/substrate.log`, a way to **read it after the fact** (`substrate logs` + a "recent errors" section in `substrate diagnose`), and **bug-report wiring** (issue template + `SUPPORT.md` + README) — so a report becomes, in most cases, `substrate diagnose` + the log.

**The core asymmetry the feature creates:** the local file may carry **full internal detail (message + sanitized context + stack)** because it's the user's own gitignored machine, while the **stdio/HTTP boundary is unchanged** — the agent/client still gets the generic scrubbed envelope. The stack reaches only the file, via a reserved `err` context key that `buildSafeContext` strips from every serialized context.

**Keystone (the privacy model rests on it):** Substrate holds **no secrets** — no tokens, credentials, or cloud config — so `agent_name` sanitization (log-injection defense) is the only redaction needed. If a future phase introduces secrets, this design must be revisited (spec §3.0-4, §3.11).

**No schema change**, **no new dependency** (plain Node `fs`). **6 steps, ONE consolidated Code Reviewer gate (Step 5).** Foundations land bottom-up (sink → wiring → `logs` → diagnose/gitignore/docs), then the single reviewer pass, then acceptance + version bump + audit + merge (Step 6).

## 2. Branching & merge strategy

- Create `feature/phase-07b-error-logging` from `main`.
- Commit per step. ONE Code Reviewer pass (Step 5).
- Fast-forward merge to `main`, no squash, tag **`phase-07b-complete`**.
- The release tag (`v0.4.0`) is NOT pushed by the agent — it's the operator trigger for `publish.yml`. The agent stops at `phase-07b-complete`, everything dry-run-verified.

## 3. Implementation order

### Step 1 — The logger file sink (Backend Engineer)

The core (spec §3.1, §3.2, §3.5). All synchronous `fs`; the whole sink never throws into the caller.

**Paths (`src/shared/paths.ts`).** Add to `SubstratePaths`, derived from `root` like every other entry:
```ts
readonly logsDir: string;   // join(root, 'logs')
readonly logFile: string;   // join(root, 'logs', 'substrate.log')
```
The rotated sibling `${logFile}.1` is computed by the sink, not a field. `logs/` is created lazily by the sink on first write (`mkdirSync(logsDir, { recursive: true })`) — `init` does not pre-create it.

**Logger (`src/shared/logger.ts`).** Keep the imported singleton; add module-private sink state + the configure/reset setters, the shared safe-context helper, the file formatter, and the rotation+append:
- **Reserved `err` key.** Extend `LogContext` JSDoc to document `err?: unknown` as a **reserved** key (the raw Error; never put real data there).
- **`buildSafeContext(ctx)` (CONCERN-3).** One helper that (a) sanitizes `agent_name` via the existing `sanitizeAgentName` and (b) `delete`s `err`. **Both** `format()` (console) and the new `formatForFile()` build their serialized context through it — the `agent_name` regex is written once, and `err` is provably excluded from every serialized context (console line AND file context JSON).
- **`format()`** (console) reused, now sourcing its context from `buildSafeContext`. Console output stays **byte-identical** to today (the existing logger tests must still pass unchanged).
- **`formatForFile(level, msg, ctx)`** → the same header line (via `buildSafeContext`) PLUS, when the **raw** `ctx.err` is an `Error` with a `.stack` (unexpected errors), a following indented stack block. It reads `ctx.err.stack` **directly from the raw context**, never the safe one. Composes the **whole** event in memory: `header + '\n' + indentedStack + '\n'` (or just `header + '\n'` when no stack).
- **`configureFileSink(path)`** sets `sinkPath`; **`resetFileSink()`** clears it (tests only; production never calls it).
- **`warn`/`error`** keep their `console.warn`/`console.error` call (no regression), then if `sinkPath` is set, call the sink with the composed event. `info` is unchanged (console only — never hits the file).
- **The sink (`writeEvent`): stat → maybe-rotate → append, all best-effort (R4).** `mkdirSync(logsDir,{recursive:true})`; `statSync` (swallow ENOENT → size 0); if `size + event.length > LOG_MAX_BYTES` → `renameSync(logFile, logFile+'.1')` (overwrite any prior `.1`); then **one** `appendFileSync(logFile, event)` (one syscall per event — CONCERN-2a). The **entire** function is wrapped so any `stat`/`rename`/write failure is swallowed — a logging failure must never crash the process (mirrors the `serve.ts`/`runner.ts` best-effort idioms). A failed rotate falls through to a plain append.
- **`LOG_MAX_BYTES = 5 * 1024 * 1024`** (5 MiB), a module const (R7). On-disk bounded at ~2× cap (single generation).

**Tests (`logger.test.ts` extended + a rotation test):**
- sink unconfigured → no file; console byte-identical to today (existing assertions pass).
- `configureFileSink(tmp)` → `error`/`warn` append an event; `info` does NOT.
- **`err` exclusion (CONCERN-3):** an `err`-carrying error → file event has a stack block; the `err` key is excluded from the console line AND from the file line's serialized context JSON (only the rendered stack block carries the stack).
- **one write per event (CONCERN-2a):** spy `appendFileSync` → a stack-bearing error is written in a **single** call carrying `header + '\n' + stack + '\n'`.
- `agent_name` with control chars/newline → sanitized identically in the file via `buildSafeContext`.
- **un-writable sink (R4):** point the sink at an un-writable path → no crash, console line still emitted.
- **rotation:** inject a tiny cap (or write large events) → `substrate.log.1` appears, `substrate.log` restarts, on-disk ≤ ~2× cap; a forced rename failure falls through to a plain append; each event lands in one write.
- **MANDATED isolation (CONCERN-1):** `afterEach(resetFileSink)` — no test leaves `sinkPath` set.

Commit: `feat(logger): persistent error-log file sink + paths.logFile + rotation (Step 1)`.

### Step 2 — Wire the sink + carry the stack at the boundaries (Backend Engineer)

Spec §3.3, §3.4. Configure the sink only in the long-lived processes; pass `err: e` at the boundary log sites so the **file** gets the stack while the envelope stays generic.

**Configure (only `mcp`/`serve`, after the `.substrate/`-exists guard).**
- `src/cli/commands/mcp.ts`: after `if (!existsSync(root)) {…}` (line ~32) and before `openDatabaseAndMigrate`, `logger.configureFileSink(paths(root).logFile)`. **`mcp.ts` does not import `logger` today** (it imports `paths` only) — add `import { logger } from '../../shared/logger.js'` (C1). `serve.ts` already imports `logger`.
- `src/cli/commands/serve.ts`: after `if (!existsSync(root)) {…}` (line ~40), same. (Insertion points re-located by the `existsSync(root)` guard, not line number.)
- One-shots (`init`/`add`/`backup`/`diagnose`/`explain`/`logs`) do **not** configure the sink (spec §3.0-5).

**Carry the stack (add `err: e`, envelope unchanged).** At each boundary site, the agent/client-facing envelope/message is built by a **separate** statement (`errorEnvelope(...)` / the HTTP handler's JSON / the printed text) — unchanged. Only the `logger.error(...)` call gains `err: e`:
- `src/mcp/wrapper.ts:82` → `logger.error(\`Unhandled error in ${toolName}\`, { error: (e as Error).message, err: e })`.
- `src/http/middleware/error-handler.ts:20` → add `err: <the caught error>` to the existing context.
- `src/cli/commands/serve.ts:146` (shutdown) → add `err: err`.
- `src/storage/migrations/runner.ts` pre-migration-backup `logger.error`/`warn` (if it holds an `Error`) → add `err: e`. The **8 write-tool handlers** keep their existing `{ error, agent_name }` context and add `err: e` where an unexpected `Error` is in hand (their `agent_name` stays sanitized).
- `src/cli/index.ts` `main().catch` is **unchanged** (one-shots don't configure the sink; it already prints the stack to stderr). Note only.

**Test (sink-wiring integration — the asymmetry is the feature):** a `mcp` session that triggers an unexpected handler error writes a **stack-bearing** line to `.substrate/logs/substrate.log`, while the MCP envelope returned to the client stays the generic `internal_error` (assert BOTH). `afterEach(resetFileSink)`.

Commit: `feat(cli): configure the log sink in mcp/serve + carry stack via reserved err key (Step 2)`.

### Step 3 — `substrate logs [-n <N>] [--errors]` (Backend Engineer)

Spec §3.7. New command + dispatch + args + reader.

**Dispatch (`src/cli/index.ts`).** New `case 'logs'` in the switch (alongside `diagnose`/`explain`); `import { logsCommand } from './commands/logs.js'`. HELP line: `substrate logs [-n <N>] [--errors]   Print recent log lines (default last 50; --errors filters to errors)`.

**Args (`src/cli/args.ts`).** `ALLOWED_FLAGS_BY_COMMAND.logs = new Set(['-n', '--errors'])`. Parse with the established pattern: `extractFlagValue(rest, '-n')` (handles `-n 50` and `-n=50`; bare `-n` exits with "requires a value" — already built in), then `--errors` boolean via `logsRest.includes('--errors')`, then `rejectUnknownFlags('logs', logsRest)`.

**`logsCommand(cwd, opts: { n?: string; errors?: boolean })`** (`src/cli/commands/logs.ts`):
1. `root = substrateRootFromCwd(cwd)`; `logFile = paths(root).logFile`.
2. `.substrate/` absent → `SubstrateError.notFound` via the top-level handler (exit 1; matches `mcp`/`serve`/`diagnose` framing).
3. `.substrate/` present, log file absent → print `No log file yet at <path>. Errors are recorded once a long-lived 'substrate mcp' or 'substrate serve' process has logged one.` and **exit 0**. (Distinct empty-state: sink never ran.)
4. `N` = parsed `opts.n` (default **50**; must be a positive integer, else a clear "must be a positive integer" error). Read the file — and `.1` first if present, concatenated oldest-first, bounded ~2× cap (R6) — split into lines.
   - **default:** print the last N lines.
   - **`--errors`:** filter to `ERROR` events, print the last N, **each with its stack block**. No `ERROR` lines (file present, only `WARN`/`info`) → print `no errors in the log` and **exit 0** (distinct from step 3: sink ran cleanly vs never ran).
5. Print the absolute path read at the end (so a report can cite it).

**Stack-block boundary parse (CONCERN-2b, LOCKED):** a stack block is the run of lines after an `ERROR` header up to (but not including) the next line matching `^<ISO-timestamp> (INFO|WARN|ERROR) `. Anchor on the next header, NOT on "indented" (interleaving makes indentation unreliable). A shared `HEADER_RE` constant is used by both `logs --errors` and diagnose (Step 4).

**Tests (`logs.test.ts` + integration):** no `.substrate/` → notFound; `.substrate/` no log → "No log file yet" + exit 0; seeded log → last N; `-n`/`-n=` forms; bare `-n` errors; `-n abc` → "must be a positive integer"; `--errors` filters + includes each block; **boundary parse** (interleaved log where a following non-indented line correctly does/doesn't belong to a block); `--errors` with no errors → "no errors in the log" (distinct from "No log file yet"); rotation-spanning read (`.1` + current, R6); `--bogus` rejected by `rejectUnknownFlags`.

Commit: `feat(cli): substrate logs command (recent lines / --errors, rotation-aware) (Step 3)`.

### Step 4 — diagnose section + gitignore + reporting docs (Backend Engineer)

Spec §3.8, §3.9, §3.10.

**diagnose (`src/cli/commands/diagnose.ts`).** A final section inside the `existsSync(root)` branch (after `backups/`), wrapped like every probe so it never crashes:
- Read the last **5 `ERROR` header lines** from `paths(root).logFile` (current file only; don't cross rotation here), using the shared `HEADER_RE`.
- Absent log or no errors → `ok('logs/', 'no recent errors')`.
- Errors exist → a `Recent errors:` block of the **5 ERROR header lines only** (message + context truncated ~200 chars each), **stacks excluded/collapsed**, plus a pointer: `Full log: <abs path> — run 'substrate logs --errors' for more.`
- Recent errors **do not** increment `problems` (historical, not current-health) — diagnose's exit code is unchanged by this section.

**Gitignore (BOTH places — `.substrate/logs/`, REQUIRED).** The top-level `*.log` glob matches `substrate.log` but **NOT** `substrate.log.1`; the dir entry covers both:
- Repo `.gitignore`: add `.substrate/logs/` in the "Substrate runtime" block (after `.substrate/attachments/`).
- `init`'s `GITIGNORE_BLOCK` (`src/cli/commands/init.ts`): add `.substrate/logs/` alongside `.substrate/attachments/`. `GITIGNORE_MARKER` + idempotency logic unchanged (block matched by marker line).

**Reporting docs (spec §3.10).**
- `.github/ISSUE_TEMPLATE/bug_report.yml`: add an **optional** `textarea` (`id: error-log`, label `` `substrate logs --errors` output (if any) ``, `render: text`, `required: false`). **Verify** the auto-close workflow's required-field greps are unaffected (a non-required field is not in the required list — confirm by reading the workflow, no edit expected; if it greps the new label, that's a finding to surface).
- `SUPPORT.md`: in "Best way to get help", ask for `npx @diegoferreyra/substrate logs --errors` (or the file) for mcp/serve bugs; note the log lives at `.substrate/logs/substrate.log`, local + gitignored.
- `README`: the "Other commands" line gains `substrate logs`; a one-liner notes errors are recorded to `.substrate/logs/substrate.log` by the long-lived `mcp`/`serve` processes.

**Tests:** diagnose integration (seed a log with errors → "Recent errors:" block of 5 headers, **stacks excluded**, + pointer; empty/absent → `no recent errors`; exit code unchanged by historical errors); gitignore (init writes a block containing `.substrate/logs/`; idempotent re-run doesn't duplicate; repo `.gitignore` lists it).

Commit: `feat(cli): diagnose recent-errors section + gitignore .substrate/logs/ + report docs (Step 4)`.

### Step 5 — Code Reviewer gate (ONE consolidated pass)

Single pass over Steps 1–4. Focus:
- **Boundary asymmetry provable:** the stack reaches the file ONLY via the reserved `err`; the envelope/printed text is built by a separate statement and is byte-unchanged; `buildSafeContext` `delete`s `err` from every serialized context (console + file).
- **Sink never throws into the caller** (stat+rotate+append all swallowed); synchronous; un-writable path doesn't crash.
- **One `appendFileSync` per event**; rotation single-generation, best-effort, on-disk ≤ ~2× cap; the boundary parse anchors on the next header.
- **Sink configured only in `mcp`/`serve`, after the `.substrate/`-exists guard;** one-shots/tests behave exactly as today when unconfigured.
- **Test isolation:** every sink-configuring suite calls `resetFileSink()` in teardown (no leaked `sinkPath`).
- **Gitignore in BOTH places**; `*.log` glob really does miss `.1` (so the dir entry is load-bearing).
- **No new dependency**; `agent_name` still sanitized; no secrets assumption still holds.

Commit fixes as `fix(...) (Step 5 review)`.

### Step 6 — Acceptance, version bump, docs, audit, merge

- **Version → `0.4.0`** (§0). 4 sources + 1 guard: `src/core/version.ts` `BINARY_VERSION`; `package.json` `version`; `ui/package.json` `version` (keep lockstep); `whoami.ts` `PHASE_STRING` → `v0.4.0 (error logging)`; `CHANGELOG.md` — a **new `## [0.4.0]` section ABOVE the existing `## [0.3.0]` (kanban) block, which stays untouched** (C2): persistent error log at `.substrate/logs/substrate.log`; `substrate logs [-n <N>] [--errors]`; diagnose recent-errors. Guard: `whoami.test.ts` `PHASE_STRING ⊇ v${BINARY_VERSION}` holds; update its copy assertion (currently `/kanban inspector/`) to `/error log/`. `BINARY_SCHEMA_VERSION` stays `2`.
- **Manual smoke (`tests/manual/run-smoke.mjs`):** add a `substrate logs` step (after an init: assert exit 0 + the "No log file yet" message) and a `--errors` path.
- **Full gate:** `pnpm test` (unit+integration), `tsc` (root+ui), `eslint`, `prettier`, `pnpm build` (server+ui), concurrency smoke, manual MCP smoke. `pnpm publish --dry-run` lists only `dist/**` + the three root docs + `package.json`; confirm **no new dependency** (root + ui) — the sink is plain Node `fs`.
- **Assistant audit** (`.agents/audits/phase-07b-audit.md`): acceptance checklist vs. the spec DoD; record the 0.3.0→0.4.0 renumber and that Phase 8 now takes 0.5.0.
- **Merge:** fast-forward to `main`, no squash, tag `phase-07b-complete`. Agent does NOT push the `v0.4.0` release tag.

## 4. Risks & notes

- **Version renumber is the one spec deviation** (§0) — 0.4.0 not 0.3.0; easy to miss across the 4 sources + the whoami copy assertion + Phase 8's eventual 0.5.0.
- **The asymmetry is the whole feature** — a reviewer must confirm the stack cannot cross the boundary (Step 2/5). The reserved-`err`-stripped-by-`buildSafeContext` design is what makes that provable.
- **Best-effort everywhere** — the sink swallowing all I/O errors is intentional (a log must never crash the process); the un-writable-no-crash test is the guard.
- **Keystone: no secrets.** If a later phase adds secrets, the "full detail to the file" design must be revisited (spec §3.0-4).

## 4b. Plan Reviewer resolutions (v1.1)

Architect Reviewer verified the plan against the real code (APPROVE-WITH-CHANGES). Confirmed accurate: the boundary asymmetry is provable at every site (log call and `errorEnvelope(SubstrateError.internalError(...))` are separate statements — wrapper.ts:82/83, error-handler.ts:20/25, the 8 write handlers, serve shutdown, migrations backup); `*.log` really misses `substrate.log.1` (dir entry load-bearing); the auto-close workflow uses a hardcoded required-label array so a new optional field needs no workflow edit; `extractFlagValue` bare-`-n` already exits; the diagnose `backups/` probe is a clean wrapped insertion point that won't touch `problems`; `LogContext` already has an index signature so reserved `err` needs only JSDoc; the 12 `logger.error` sites reconcile. Incorporated:
- **B1** — the pre-migration-backup site is **`src/storage/migrations/runner.ts:108`**, not `src/storage/runner.ts` (corrected throughout).
- **C1** — `mcp.ts` must add `import { logger }` (it imports only `paths` today). (Step 2)
- **C2** — CHANGELOG: new `## [0.4.0]` section **above** the existing `## [0.3.0]` (kanban) block, which stays. (Step 6)
- **C3** (no change): the whoami copy assertion is `/kanban inspector/` today (spec §3.6's `/init templates|explain/` is stale) — the plan §6 already cites `/kanban inspector/ → /error log/` correctly; follow the plan, not the spec, on that line.

## 5. Definition of Done

Spec DoD met with the **0.4.0** version override: file sink at `.substrate/logs/substrate.log` (`warn`+`error`, not `info`); full detail incl. stack to the file via reserved `err`, boundary envelope byte-unchanged (separate statement); `buildSafeContext` sanitizes `agent_name` and strips `err` from every serialized context; sink configured only by `mcp`/`serve` after the `.substrate/`-exists guard; one `appendFileSync` per event; whole sink never throws; 5 MiB single-generation best-effort rotation; `substrate logs [-n <N>] [--errors]` with next-header-anchored stack-block parse + two distinct empty-states + rotation-aware read; diagnose recent-errors (5 headers, stacks excluded, pointer); `.substrate/logs/` gitignored in BOTH places; bug-report/SUPPORT/README wiring; test isolation mandated (no leaked `sinkPath`); full gate green; no new dependency; version `0.4.0` via the 4-source+1-guard lockstep, schema stays 2; `phase-07b-complete` tagged; the `v0.4.0` release tag left to the operator.
