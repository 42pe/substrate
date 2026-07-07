# Failure visibility & OCC ergonomics — Spec (dogfood fix cluster B4 / B5 / `--help`)

**Status:** Draft for Diego's review
**Author:** Architect (synthesizing the Reliability+DX spec analyst report)
**Date:** 2026-07-07
**Companion plan:** [dogfood-fix-observability.md](../dogfood-fix-observability.md)
**Source signals:** [dogfood/rollup.md](../../dogfood/rollup.md) (B4, B5, `--help` in the B-list) +
[projects/mailsimp.md](../../dogfood/projects/mailsimp.md) +
[projects/astrology-mobile-app.md](../../dogfood/projects/astrology-mobile-app.md) +
[projects/stackchanexperiments.md](../../dogfood/projects/stackchanexperiments.md).
**Scope discipline:** these are bug/DX fixes surfaced by real dogfood demand (per PRD §9 /
[prd.md](../../../prd.md)). **B7** (empty `data.sqlite` despite committed boards) is being implemented
separately and is **out of scope** here — referenced only for breadcrumb-wording coordination (§Item 1).

---

## 1. Problem & motivation

Three independently-reported dogfood findings converge on **failure visibility and OCC ergonomics** —
the agent-facing "what went wrong, and can I recover cheaply?" surface:

- **B4 (MED):** After an MCP session that hit errors, `.substrate/logs/` is often **never created**, so
  `substrate logs --errors` reports "No log file yet…" in the exact post-mortem scenario it exists for
  (mailsimp: "empty — `.substrate/logs/` never created despite ~30 MCP calls and multiple `not_found`
  errors", `projects/mailsimp.md:14`; astrology: "`.substrate/logs/` does not exist at all",
  `projects/astrology-mobile-app.md:14`; rollup convergent finding #2, `rollup.md:78`).
- **B5 (MED):** `version_mismatch` omits `current_version`, forcing an honest concurrent writer to spend a
  wasted `get_task` just to learn the integer to retry with. **3 agents now ask for it** (`rollup.md:101`).
  This **reopens a PRD-locked decision** (§6.11) and needs Diego's ratification.
- **`--help` (DX, cheap):** every per-subcommand `--help`/`-h` prints "Unknown flag" and exits 1 (astrology:
  "`mcp --help`/`init --help` → `Unknown flag`", `projects/astrology-mobile-app.md:14`; mailsimp:
  "`logs` supports only `-n`/`--errors` (no `--help`…)", `projects/mailsimp.md:14`; rollup B-list,
  `rollup.md:112`).

All three are small, mostly independent, and can land in one PR. Only B5 touches a locked decision.

## 2. Goals / non-goals

**Goals**
- **B4:** an MCP session that hits *any* error leaves a **diagnosable on-disk trace**; `substrate logs`
  shows the trail and `logs --errors` shows *genuine* faults. Answer "did the MCP server ever run?"
  affirmatively for *any* session (even a clean one).
- **B5:** kill the mandatory wasted `get_task` on a version conflict by returning `current_version` in
  `details`, **while preserving the anti-blind-overwrite intent** the withholding was protecting (guidance
  stays in the message).
- **`--help`:** `substrate <cmd> --help` / `-h` prints a per-subcommand usage stanza and exits **0**.

**Non-goals**
- **Not** logging every expected `not_found`/`version_mismatch` at ERROR level — that would regress
  `--errors` signal quality (an ID-probing agent generates dozens of expected errors that are normal
  control flow, recovered from the message alone; `rollup.md:126,149`). Expected errors log at **WARN**.
- **Not** an OCC redesign, retry helper, or any "compute next version for the agent" convenience (that is
  precisely the blind-overwrite the OCC lock guards against).
- **Not** B7 (empty `data.sqlite` warning) — separate work. Coordinate only the startup-breadcrumb wording.
- **Not** a new log format, rotation change, or `logs` filter surface (`log-read.ts`/`logs.ts` internals
  are untouched beyond what B4 needs).

## 3. Root causes (grounded in code)

### 3.1 B4 — the cause is the log-*emission* policy, not the launch path

The dogfood hypothesis ("only a CLI-launched serve/mcp writes logs") is **wrong about the mechanism**.
Both commands configure the sink identically:
- `src/cli/commands/mcp.ts:40` — `configureFileSink(p.logFile)`
- `src/cli/commands/serve.ts:47` — `configureFileSink(p.logFile)`

So `substrate mcp` (the process the MCP client spawns) **does** configure the file sink. No file appears
because of the **write policy**:

1. The sink only materializes a file on the first `warn`/`error`. `writeEvent` lazy-mkdirs + appends
   (`src/shared/logger.ts:117-139`); it is a no-op until `logger.warn`/`logger.error` fires. `info` is
   console-only (`logger.ts:143-145`, comment "info never hits the file").
2. **Expected `SubstrateError`s are returned as envelopes, never logged.** The wrapper's catch
   (`src/mcp/wrapper.ts:80-84`) logs **only** the *unhandled* branch (`logger.error` at `:82`). Any
   `SubstrateError` returns via `errorEnvelope(e)` at `wrapper.ts:81` **without touching the logger**. Same
   in the handlers' own catches (`update-task.ts:183-190` returns the envelope; only the *internal_error*
   branch at `:192` logs; `substrate-edit.ts:34-35` same).

So in a normal session whose only failures are the *expected, actionable* errors (exactly what dogfood hit),
**zero `logger.error` calls fire, the sink never writes, and `logs/` is never created** → `logs.ts:31-37`
prints "No log file yet…". This is **not** MCP-vs-CLI; a `serve` that only ever returned expected errors
would be equally empty. Corroboration: mailsimp's "~30 MCP calls and multiple `not_found`" + no file
(`projects/mailsimp.md:14`) — `not_found` is a returned envelope, never a `logger.error`.

### 3.2 B5 — the omission is deliberate and locked in three places

- **PRD §6.11** (`prd.md:219`): *"`version_mismatch` does not return current version — forces re-read."*
- **PRD R4** (`prd.md:290`): *"`version_mismatch` UX with no `current_version`. Naive agents may livelock."*
- **Tasks path:** `tasks.ts:144-156` docstring (*"NO `current_version` … forces a re-read, per PRD §6.11"*);
  throws `versionMismatch(..., { id })` at `tasks.ts:172,200,238,245,268,275`.
- **Substrate-edit path:** `substrate-edit.ts:15-20` — `assertVersion` throws `versionMismatch(msg, { id })`,
  comment *"(no `current_version`, per the Phase 2 OCC lock)."*

Intent: withholding the integer forces the writer to re-read, *see the reconciled state*, and re-decide —
not mechanically bump `version+1` and clobber a concurrent change. The `VERSION_MISMATCH_MESSAGE`
(`substrate-edit.ts:11-13`, `tasks.ts:140-142`) already carries that guidance. **Dogfood counter-evidence:**
astrology explicitly asked *"Put `current_version` in the error"* (`projects/astrology-mobile-app.md:21`,
signal `unrecoverable-error:version_mismatch(partial)`); rollup: *"3 agents now ask for it"* (`rollup.md:101`);
real OCC contention is materializing (StackChan concurrent sessions, `rollup.md:146`).

### 3.3 `--help` — no `--help` in any allowlist

`rejectUnknownFlags` (`args.ts:24-37`) checks a fixed per-command allowlist (`args.ts:6-17`); **none** include
`--help`/`-h`, and `serve`/`mcp`/`backup`/`diagnose` have **empty** allowlists (`args.ts:8-13`). So
`substrate mcp --help` hits `rejectUnknownFlags` → *"Unknown flag for 'mcp': --help"* + `process.exit(1)`
(`args.ts:30-35`). Top-level `--help` is handled only as a *command* (`index.ts:158-161`), never as a
per-subcommand flag.

## 4. Decisions

### D1 — B4: log returned `SubstrateError`s at WARN in the wrapper + one startup breadcrumb (RECOMMENDED)

The task DoD says *"after an MCP session that errored, `logs --errors` must show it."* The honest reading of
its **spirit** is "the session left a diagnosable on-disk trace" — because forcing every expected
`not_found` into ERROR would regress `--errors` signal quality (§2 non-goals). Three options were weighed:

- **Option A — log returned `SubstrateError`s at WARN, centralized in the wrapper.** `warn` persists to the
  file (`logger.ts:146-148`) but stays out of the `--errors` ERROR filter (`logs.ts:42`). Pro: file
  materializes on the first error; full trail via `substrate logs`; severity honesty (an expected
  `not_found` is a WARN, not an ERROR); one edit point. Con: `logs --errors` is still empty for a session
  that had *only* expected errors.
- **Option B — session lifecycle breadcrumbs** (startup line + shutdown summary with an error counter). Pro:
  a file exists for *any* session, disambiguating "MCP never ran" from "ran cleanly"; a summary at ERROR
  when count>0 satisfies the literal `--errors` DoD. Con: new lifecycle code on the stdin-close path; a
  shared mutable counter.
- **Option C — escalate only genuine faults to ERROR, leave the rest as envelopes.** Smallest change, but
  does not satisfy the DoD for an ordinary errored session; punts the core complaint.

**Recommendation: A + the startup-breadcrumb slice of B (small).**
1. **Wrapper (`wrapper.ts:81`):** in the `SubstrateError.is(e)` branch, `logger.warn` with `code`, `tool`,
   `agent_name` before returning the (unchanged) envelope. The file materializes on the agent's first error;
   the full trail is visible via `substrate logs`.
2. **`mcp.ts` (after `configureFileSink`, `:40`):** emit ONE `logger.warn`-level startup breadcrumb ("MCP
   stdio session started", `pid`) so a file exists even before the first tool error and "did the MCP server
   ever run?" is answerable. (A startup line at `info` would not persist — info is console-only — hence
   WARN; this is a deliberate, documented severity choice, not a fib.)
3. **Redefine the DoD honestly** (see §8 Open questions): after an errored session, `substrate logs` shows
   the trail and `logs --errors` shows any *genuine* faults. If Diego insists expected errors appear under
   `--errors` specifically, that is **Option-B-full** (a session-summary logged at ERROR when error-count>0),
   at a documented signal-noise cost.

**Why not "make mcp write logs like serve does":** they already configure the sink identically
(`mcp.ts:40` == `serve.ts:47`) — copying serve changes nothing. The fix is emission policy, not launch path.

### D2 — B5: include `current_version` in `version_mismatch` details, keep the reconcile message
**— RECOMMENDED, needs Diego (reopens PRD §6.11).**

- **Option A (recommended):** add `current_version` to the `versionMismatch` details at every throw site;
  keep the message text unchanged (so the reconcile guidance still lands). `errorEnvelope` already passes
  `details` through verbatim (`envelope.ts:67-85`) — **no envelope/schema change**. The integer removes the
  "I can't even retry without another call" friction; the *state* still requires a re-read to reconcile
  *what* changed, which the message keeps steering toward.
- **Option B:** keep it withheld; instead return a "changed fields" hint. Preserves the lock's letter but
  doesn't address the actual ask (they want the integer) and adds real diff work = scope creep.
- **Option C:** include it only for substrate-edit, withhold for tasks. Inconsistent surface across entity
  types = worse DX. Reject.

**Recommendation: Option A**, because the anti-blind-overwrite intent is carried by the **message and the
re-read guidance**, not by withholding the integer — withholding only taxes the *honest* writer with a
mandatory round-trip; a determined blind-overwriter could always `get_task` then bump anyway. 3 independent
agents asked, 0 asked to keep it hidden, and concurrency contention is now real (StackChan, `rollup.md:146`)
— exactly the "dogfood demand now shown" signal PRD §9 says to act on.

**Guardrails (part of the package Diego ratifies):**
1. Strengthen the message so the integer's presence doesn't invite mechanical retry, e.g. *"…has been
   updated (now at version N). Re-read with get_task, reconcile your changes against the current state,
   then retry — do NOT blindly resend with version N."*
2. **No** convenience that computes "next version."
3. On approval: a dated `decisions.md` entry + annotate PRD §6.11 and R4.

### D3 — `--help`: intercept per-subcommand `--help`/`-h` before `rejectUnknownFlags` (RECOMMENDED cleaner shape)

Two shapes: (minimal) inline `if (rest.includes('--help')||rest.includes('-h'))` at the top of each `case`
in `index.ts`; (cleaner) add a `SUBCOMMAND_HELP` map + a `maybePrintSubHelp(cmd, argv): boolean` helper in
`args.ts` (co-located with the flag allowlist, unit-testable like the rest of `args.ts`). **Recommend the
cleaner variant.** `--help` must be caught **before** `extractFlagValue`/`rejectUnknownFlags` so it isn't
consumed or rejected, and must exit **0** (success), not 1.

## 5. API / contract changes

- **`version_mismatch` error `details`** gains `current_version: number` (D2). This is **additive** —
  `ErrorEnvelope` shape is unchanged (`envelope.ts:40-47`); `details` already flows through
  (`envelope.ts:67-85`). Message text changes (guardrail 1). No MCP tool schema (`tools/list`) change.
- **Log file behavior** (D1): a file now materializes for any MCP session (breadcrumb) and on the first
  returned `SubstrateError` (WARN). No change to the log line *format* (`logger.ts:66-92`), rotation
  (`logger.ts:117-139`), or `logs`/`log-read` reader.
- **CLI** (D3): `substrate <cmd> --help|-h` becomes a success path printing a usage stanza. No change to any
  real flag's behavior.

## 6. Edge cases

**B4**
- **Chatty session volume:** warn-per-expected-error raises log volume; the 5 MB cap + single-generation
  rotation (`logger.ts:37,128-134`) already bounds it. A very probey agent could rotate real errors out —
  `--errors` (ERROR-only) stays the durable-signal view; genuine faults are ERROR and survive longer.
- **`agent_name` safety:** already sanitized on the file path via `buildSafeContext` (`logger.ts:57-64`) —
  the new WARN lines inherit that; do NOT hand-format agent names into the message.
- **Concurrent MCP children** (StackChan) all append to the same `substrate.log`; `appendFileSync` is atomic
  up to PIPE_BUF and the reader anchors on headers (`log-read.ts` CONCERN-2b) — a per-child startup
  breadcrumb is fine.
- **B7 coordination:** if B7 adds its own mcp-startup warning, the two startup lines must read as
  complementary (B4 = "session started"; B7 = "DB empty despite committed boards"), not duplicative.

**B5**
- **CAS-fallback throws** (`tasks.ts:200,245,275`, after `rowsAffected===0`): these are the **defense-in-depth**
  CAS. In the MCP path the SELECT (`getTask`, `tasks.ts:164`) and the UPDATE (`tasks.ts:195`) run inside the
  **same** `withTransaction` (`update-task.ts:57`), so a concurrent writer cannot slip between them for that
  caller — the SELECT-check (`current.version !== expectedVersion`, `tasks.ts:171`) already handles the real
  conflict, and `current.version` is a **safe** value to return there. For the CAS-fallback branch, the
  in-scope `current.version === expectedVersion` (it passed the SELECT-check), so returning it would echo the
  *caller's stale* value, which is misleading. **Decision for the plan:** in the CAS-fallback branch, return
  `current_version: expectedVersion + 1` is NOT safe either (assumes a single bump). Prefer **(a)** re-`SELECT
  version` before throwing on the rare CAS-race path and return the true current, or **(b)** omit
  `current_version` on the CAS-fallback throws only, documenting the integer as best-effort. **Recommend (b)**
  — the CAS-fallback is unreachable for the transactional MCP caller and re-selecting adds a read to a path
  that (for MCP) can't fire; the SELECT-check branch (the one that actually fires) carries the integer. Never
  return the stale in-scope value.
- **bigint coercion:** put the **coerced `number`** (`coerceVersion`, `tasks.ts:48-55`) in details, never a
  raw bigint (JSON-unsafe). For tasks, `current.version` is already coerced by `rowToTask` (`tasks.ts:76`).
- **substrate-edit throws** (`assertVersion`, `substrate-edit.ts:16-20`): `actual` is in hand at all 8
  callers (`update-board.ts:40`, `update-group.ts:51`, `update-policy.ts:57`, `update-project.ts:34`,
  `archive-board.ts:58`, `unarchive-board.ts:32`, `archive-group.ts:63`, `archive-policy.ts:47`) — add
  `current_version: actual` in one place.
- **Comments carry no version** (`envelope.ts:29-34`, append-only) — no `version_mismatch` applies; no change.
- **Livelock watch (R4):** track retry-loop counts on `version_mismatch` in the dogfood methodology
  (`_template.md` "any retry loops?") to confirm the integer didn't *cause* storms.

**`--help`**
- `--help` must short-circuit even when another flag is present (`init --template x --help`,
  `logs -n 5 --help`) — check for it before `extractFlagValue`/`rejectUnknownFlags`.
- Exit code **0** for `--help` vs the current unknown-flag exit **1**.

## 7. Test strategy

**B4**
- Unit (wrapper): a wrapped handler throwing `SubstrateError.notFound` with the sink configured → the log
  file exists and contains a `WARN` line with the code; the returned envelope is unchanged (`ok:false`, same
  message).
- Unit (mcp startup): `mcpCommand` against a temp `.substrate/` → `logs/substrate.log` exists after startup
  even with zero tool calls.
- Integration: drive `substrate mcp` over stdio, trigger a `not_found`, disconnect → `substrate logs` shows
  the trail; if Option-B-full is chosen, `logs --errors` shows the summary.
- Regression: `logger.test.ts` warn/error routing + sink tests stay green; **audit tests that assert "no
  logging on an expected error"** — the wrapper now emits a WARN on that path, so any `console.warn`/`console.error`
  spy expecting silence must update.

**B5**
- Unit (tasks): stale-version `updateTask` → `details.current_version === current.version` (SELECT-check
  branch). Assert the message still contains the reconcile guidance (anti-blind-overwrite intent preserved).
- Unit (substrate-edit): stale-version `update_board`/`update_policy` → `details.current_version` equals the
  on-disk version.
- Update every test asserting `version_mismatch` details `=== { id }` / "no current_version"
  (`update-task.test.ts`, `archive-task.test.ts`, `board-edit.test.ts`, `group-edit.test.ts`,
  `policy-edit.test.ts` — confirm exact set at build time).

**`--help`**
- `args.test.ts`: `maybePrintSubHelp('mcp', ['--help'])` returns true + writes usage; `('logs', ['-h'])`
  same; a real unknown flag still rejects with exit 1; `substrate mcp --help` no longer prints "Unknown flag".

## 8. Open questions for Diego

1. **[B5 — ratify reopening PRD §6.11?]** D2 recommends including `current_version` in `version_mismatch`
   details (with the reconcile guidance kept/strengthened). This **contradicts a PRD-locked, Phase-2 OCC
   decision**. Approve the package (code change + strengthened message + `decisions.md` entry + PRD §6.11/R4
   annotation)? **Default if unanswered: hold B5; ship B4 + `--help` (they don't need a decision reversal).**
2. **[B4 — DoD wording]** Accept the honest DoD ("`substrate logs` shows the trail; `logs --errors` shows
   genuine faults", expected errors at WARN)? Or require expected errors under `--errors` specifically
   (Option-B-full: session-summary at ERROR when error-count>0), accepting the signal-noise cost?
3. **[B4 — breadcrumb wording vs B7]** OK to add a one-line WARN startup breadcrump in `mcp.ts`, coordinated
   with B7's empty-`data.sqlite` warning so they read as complementary?

## 9. Out of scope
- B7 (empty `data.sqlite` warning) — separate work.
- B1 (list_tasks filter shape), B2 (cross-board group), B3 (honor-system gates), B6 (passed-guard message) —
  other clusters.
- Any OCC retry helper, bulk/transaction writes, or `substrate validate` — v1.x, gated on demand.
