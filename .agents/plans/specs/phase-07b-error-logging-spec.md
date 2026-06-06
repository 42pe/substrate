# Phase 7b Spec — Error logging & reporting

**Status:** APPROVED (incorporates Architect Reviewer changes; CONCERN-1/2/3 + NITs; R1–R7 resolved) — ready for planning.
**Standing directive:** Diego's standing instruction is to proceed without per-phase approval pauses; no separate confirmation gate is required before planning begins.
**Author:** Spec Team
**Last updated:** 2026-06-06
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) (post-v1 adoption/ergonomics work)
**Predecessor:** Phase 7 (`phase-07-complete`, v0.2.0) — `init --template web-delivery` + `substrate explain` (self-contained inline-SVG HTML map). Phases 1–7 are merged; the package is in-repo + dry-run-verified, unpublished, repo private at `42pe/substrate`.
**Successor (planned, not built):** Phase 8 (shareable substrate templates) — spec + plan committed, NOT built. **Forward note:** Phase 8's plan currently bumps to `0.3.0`; once **this** precursor takes `0.3.0` (§3.6), Phase 8 re-numbers its bump to `0.4.0` **when it is built** — a forward note only, no Phase 8 doc edit in this phase.

This is a **small precursor before Phase 8 ("Phase 7b" — a precursor, not a split)**, motivated by the product owner about to dogfood Substrate on real projects: errors must be **diagnosable and reportable** after the fact.

---

## 1. Goal

Substrate keeps **no persistent error log**. `src/shared/logger.ts` is a thin wrapper over `console` (stdout/stderr) — no file. The SQLite append-only log is for **task** events, not errors. So errors are **ephemeral**: an MCP-session error's full detail is written (scrubbed) to the mcp child's **stderr** while the agent across the stdio boundary gets only a generic `internal_error` envelope (raw messages are deliberately never sent across that boundary). If the agent runtime swallows that stderr, the detail is **lost**. There is no "what errored last?" you can run after the fact.

This phase adds a **persistent, size-bounded error log file** under `.substrate/`, a way to **read it after the fact** (`substrate logs` + a "recent errors" section in `substrate diagnose`), and **wires it into bug reporting** (issue template + `SUPPORT.md` + README). A bug report then becomes, in most cases, just `substrate diagnose` + the log.

Three deliverables:

1. **A persistent error log file** at `.substrate/logs/substrate.log`. `logger.error` and `logger.warn` ALSO append to it — timestamped, level, message, sanitized context, and **for unexpected errors the stack**. Because it is the user's own machine, the **file may carry the full internal detail** (message + stack) even though the agent across the stdio boundary still gets the generic scrubbed envelope. The existing `agent_name` sanitization is **kept** (log-injection defense). Size-bounded via simple rotation. Gitignored (runtime state, like `data.sqlite`).
2. **`substrate logs [-n <N>] [--errors]`** — print the last N lines (or the last N `ERROR` entries), plus a **"recent errors" section in `substrate diagnose`** so a report is often just diagnose + the log.
3. **Reporting wiring** — `.github/ISSUE_TEMPLATE/bug_report.yml` + `SUPPORT.md` + README ask for the error log alongside `diagnose`, and document where it lives.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. Additive feature → `BINARY_VERSION` → **`0.3.0`** at acceptance (§3.6).

## 2. Scope

**In scope:**
- **A file sink in `src/shared/logger.ts`** that `logger.warn` / `logger.error` append to when configured, reusing the existing `sanitizeAgentName` / `format` path (§3.2). New paths helper `paths(root).logsDir` + `logFile` in `src/shared/paths.ts` (§3.1).
- **Sink configuration at process start** in the long-lived processes — `mcpCommand` and `serveCommand` call `logger.configureFileSink(path)` after `root` is known and `.substrate/` is confirmed present (§3.3).
- **Stack capture for unexpected errors**: a small, backward-compatible extension so the wrapper / HTTP error-handler / CLI top-level can pass the `Error` (with stack) to the file sink **without** changing what crosses the stdio boundary (§3.4).
- **Size-bounded rotation** (§3.5): cap the file; on overflow rotate `substrate.log` → `substrate.log.1` (single generation), truncate-and-restart.
- **`substrate logs` command** (`src/cli/commands/logs.ts`) + dispatch + HELP + `ALLOWED_FLAGS_BY_COMMAND.logs` + `-n` value-flag parsing via the established `extractFlagValue` pattern (§3.7).
- **`diagnose` "recent errors" section** (§3.8).
- **Gitignore**: add `.substrate/logs/` to both the repo `.gitignore` "Substrate runtime" block AND the `GITIGNORE_BLOCK` that `init` writes (§3.9).
- **Reporting docs**: `bug_report.yml` gains an error-log field; `SUPPORT.md` + README document the log location + `substrate logs` (§3.10).
- **Version bump** to `0.3.0` across the 4 lockstep sources + the 1 drift-guard test (§3.6).
- **CHANGELOG** `0.3.0` entry.

**Out of scope (locked):**
- **No structured logging library** (pino, winston, etc.) — `logger.ts`'s header already defers that to v1.x; this phase keeps the line-oriented format and adds only a file sink. Zero new runtime dependencies.
- **No log levels below `warn` in the file** — `info` stays console-only (it is operational chatter: "Substrate running on …", "shutting down"). The file is for problems (§3.4).
- **No errors persisted to SQLite** — the append-only log stays task-events-only; this is a flat file, not a new table or migration.
- **No log shipping / telemetry / network** — the file is local, gitignored, never transmitted. Substrate's "no telemetry" promise is unchanged.
- **No per-call-site changes to the ~12 `logger.error` sites' *console* behavior** — they keep printing exactly as today; the file sink is purely additive.
- **No UI / HTTP route for logs** (no served log viewer) — `substrate logs` is CLI-only, consistent with `explain` (Phase 7) being CLI-only.

**Out of scope (not this phase):**
- A configurable log path / size / rotation count (hardcoded defaults in v1; a v1.x knob).
- Multi-generation rotation (`.1`, `.2`, …) or time-based rotation — one generation is enough for a dogfooding bug-report aid.
- Auto-deriving `BINARY_VERSION` from `package.json` (still manual lockstep).

## 3. Design

### 3.0 Locked decisions (product owner + Architect Reviewer)

All decisions are now **locked**. §7 records the reviewer's R1–R7 answers (all approved) for traceability.

1. **The log file lives at `.substrate/logs/substrate.log`** (a `logs/` subdir, not a bare `.substrate/error.log`) — matches the `boards/`/`attachments/`/`backups/` layout, leaves room for a future second file, groups runtime byproducts. **Locked (R1).**
2. **`warn` + `error` go to the file; `info` does not.** The file is the "what went wrong" record (§3.4). `info` is operational stdout chatter and stays console-only.
3. **The file carries full internal detail** — message + sanitized context + (for unexpected errors) the **stack** — because it is the user's own machine and the file is gitignored and never transmitted. **The stdio/HTTP boundary is unchanged**: the agent/client still gets the generic scrubbed `internal_error` envelope; only the **local file** gains the stack (§3.4). This is the core asymmetry the feature exists to create.
4. **`agent_name` sanitization is kept** in the file sink (the existing `sanitizeAgentName` — strip control chars, truncate, bracket). It is the **only** sanitization required: agent-supplied identity is the one untrusted string that reaches the log, and log-injection via newlines/control-chars is the one threat. **Keystone assumption (the privacy model rests on this): there are no secrets in Substrate to leak** (no tokens, no credentials, no cloud config) — confirmed by the product owner; the file may carry board/task ids and error messages, which is fine on the user's own gitignored machine (§3.11). **Forward note:** if a future feature introduces secrets (e.g. cloud config / auth tokens), this whole "full internal detail to the file with only `sanitizeAgentName`" design **must be revisited** — the keystone no longer holds.
5. **Only the long-lived processes (`mcp`, `serve`) configure the file sink.** One-shot CLI commands (`init`, `add`, `diagnose`, `explain`, `backup`, …) already print errors to stderr where the user sees them immediately, and may run with **no `.substrate/` yet**. The high-value target is `mcp`/`serve`, whose stderr the agent runtime can swallow. One-shots do **not** configure the sink (§3.3, R2).
6. **Sink configuration is explicit** — `logger.configureFileSink(path)` called once at process start by `mcpCommand`/`serveCommand` (after their `.substrate/`-exists guard) — **not** lazy cwd resolution, **only** these two long-lived processes. The logger stays a stateless-until-configured singleton; if never configured (one-shots, tests) it behaves exactly as today (console only). Locked (R2; §3.2).
7. **Size-bounded by simple single-generation rotation** (§3.5): a byte cap (default **5 MiB**); when an append would exceed it, rename `substrate.log` → `substrate.log.1` (replacing any prior `.1`) and start a fresh `substrate.log`. Bounded at ~2× the cap on disk. Single-generation; best-effort under a rotate race (a lost/overwritten `.1` is tolerated — a local error log is a bug-report aid, not an audit trail). Locked over truncate-oldest (R7).
8. **Multi-process append is acceptable as-is, one shared file via `O_APPEND` (no per-pid).** `mcp` + `serve` + concurrent agent `mcp` children may append the same file. Each logged event is written as **one** `appendFileSync` call (header line + stack block composed in memory first — §3.2/§3.5), so a single `O_APPEND` write of a whole event is effectively atomic up to ~PIPE_BUF on POSIX; interleaving-without-corruption is the worst case — fine for a log. The **Windows** caveat (no `O_APPEND` atomicity guarantee) is **noted, accepted** (Windows is already best-effort per `SUPPORT.md`); we do **not** split per-process files (R3; §3.5).
9. **Version → `0.3.0`** (minor; additive). `BINARY_SCHEMA_VERSION` stays `2`. Forward note: not-yet-built Phase 8 re-numbers to `0.4.0` when built.

### 3.1 Paths — `logs/` under `.substrate/`

Add to `SubstratePaths` (`src/shared/paths.ts`), derived from `root` like every other path (no caller hand-builds `.substrate/logs/...`):

```ts
readonly logsDir: string;   // join(root, 'logs')
readonly logFile: string;   // join(root, 'logs', 'substrate.log')
```

The rotated sibling is `${logFile}.1` (computed by the sink, not a separate field). The `logs/` dir is created lazily by the sink on first write (`mkdir(logsDir, { recursive: true })`), so `init` does **not** need to pre-create it — but **see §3.9**: `init`'s gitignore block lists `logs/` regardless.

### 3.2 Logger file sink (`src/shared/logger.ts`)

The logger stays the imported singleton. Add **module-private sink state** + a configure function; `warn`/`error` gain a file-append branch that runs **only when configured**. `configureFileSink` is the **only** setter and `resetFileSink` the **only** clearer; production code **never** calls `resetFileSink` (it exists solely for test isolation — see CONCERN-1 below):

```ts
let sinkPath: string | undefined;            // set by configureFileSink
export function configureFileSink(path: string): void { sinkPath = path; }
export function resetFileSink(): void { sinkPath = undefined; }   // tests only
```

- **Shared safe-context helper (CONCERN-3, LOCKED).** Factor a single `buildSafeContext(ctx)` that (a) sanitizes `agent_name` via `sanitizeAgentName` and (b) `delete`s the reserved `err` key. **BOTH** the console `format()` path **and** the file `formatForFile()` path build their serialized context through this one helper — the `agent_name` regex is written once, and `err` is provably excluded from every serialized context (console line AND file line's context JSON). Document `err` as a **reserved `LogContext` key** in the `LogContext` JSDoc so a future caller does not put real data there.
- `format(level, msg, ctx)` is **reused unchanged** for the console line (now sourcing its context from `buildSafeContext`). For the file, a sibling `formatForFile(level, msg, ctx)` produces the same header line using `buildSafeContext(ctx)`, PLUS — when the **raw** `ctx.err?.stack` is present (unexpected errors) — a following indented stack block. The file sink reads `ctx.err?.stack` **DIRECTLY from the raw context**, never from the serialized (safe) context; only the rendered stack block carries the stack, never the context JSON.
- **One write per logged event (CONCERN-2a, LOCKED).** `formatForFile` composes the **full** event in memory — `header line + '\n' + indented stack block + '\n'` — and the sink writes it in a **single** `appendFileSync` call (one syscall), NOT line-by-line. A single `O_APPEND` write is atomic up to ~PIPE_BUF on POSIX (most stacks fit), so concurrent events cannot interleave mid-event. "One write per logged event" is an explicit requirement.
- `warn`/`error` keep their existing `console.warn`/`console.error` call (no console regression), then, if `sinkPath` is set, write the composed event. `info` is unchanged (console only).
- **The WHOLE sink (stat + rotate + append) never throws into the caller (R4, LOCKED).** A failed `stat`/`rename`/write (disk full, permission, racing rotation) is swallowed — a logging failure must never crash the process. (Mirrors the existing "best-effort" idioms in `serve.ts`/`runner.ts`.) The console line is the always-on guarantee; the file is the durable convenience. A test asserts an un-writable sink path does **not** turn a logged error into a crash.
- **Synchronous I/O (R4, LOCKED).** The sink uses `appendFileSync`/`statSync`/`renameSync`, keeping the logger's three methods synchronous. The line must land before a possible crash; `serve`'s shutdown / `beforeExit` paths cannot `await`, so an un-awaited async append could be lost. Not a hot path.
- **Test isolation (CONCERN-1, LOCKED).** The module-global `sinkPath` leaks across vitest tests in a worker. **Every suite that configures the sink** — `logger.test`, the sink-wiring integration test, the diagnose integration test — **MUST call `resetFileSink()` in an `afterEach` (or `beforeEach`) hook.** Invariant: **no test leaves `sinkPath` set.**

### 3.3 Configuring the sink at process start

The natural place is where `root` is computed and `.substrate/` presence is already asserted:

- **`mcpCommand` (`src/cli/commands/mcp.ts`):** after the `existsSync(root)` guard and before `openDatabaseAndMigrate`, call `logger.configureFileSink(paths(root).logFile)`. Now any `logger.error` from a tool handler during the session lands in the file.
- **`serveCommand` (`src/cli/commands/serve.ts`):** same — after the `existsSync(root)` guard, before opening the DB. The existing `logger.info("Substrate running …")` stays console-only (info), and the shutdown-handler `logger.error('Error during shutdown', …)` now also reaches the file.
- *(The plan/impl re-locate these two insertion points by CONTENT — the existing `existsSync(root)` guard in each file — not by line number.)*
- **One-shot commands do not configure the sink** (§3.0-5). They print to stderr and exit; the user sees the error directly. If a future need arises (e.g. `backup` failures), it is a one-line addition — but **not in scope** here.

The sink is configured **after** the `.substrate/`-exists check, so we never create `.substrate/logs/` for a directory that has no substrate (the `mkdir` in the sink only runs on an actual write, and writes only happen post-config).

### 3.4 What goes in the file (levels + stack)

| Source call site | Console (today, unchanged) | File (new) |
|---|---|---|
| `logger.info(...)` | stdout | — (not written) |
| `logger.warn(...)` | stderr | line: ts, `WARN`, msg, sanitized ctx |
| `logger.error(msg, ctx)` | stderr | line: ts, `ERROR`, msg, sanitized ctx |
| unexpected error at a boundary | stderr (scrubbed/generic) | line **+ stack block** |

**The boundary asymmetry (locked, §3.0-3):** the wrapper (`src/mcp/wrapper.ts`), the HTTP error-handler (`src/http/middleware/error-handler.ts`), and the CLI top-level (`src/cli/index.ts` `main().catch`) all currently log `{ error: message }` and return/print a **generic** envelope/message. The **envelope/printed text is unchanged** (no stack across the boundary). What changes: these sites pass the **Error object** to the logger so the **file** captures the stack.

To do that without breaking the `LogContext` shape, add an **optional stack-carrying convention** to `logger.error`/`warn` (R5, LOCKED): a **reserved** context key `err?: unknown` (the raw error). The file sink reads `err.stack` directly; `buildSafeContext` (§3.2) `delete`s `err`, so it is **excluded from the console line AND from every JSON-serialized context** (console behavior byte-identical to today; no stack leaks as structured context). **Re-confirmed:** the agent-facing envelope is built by `errorEnvelope(...)` — a **separate statement** from the `logger.error(...)` call — so the stack provably cannot reach the stdio/HTTP boundary; only the file sink, reading the reserved `err`, ever sees it. Call sites become:

```ts
logger.error(`Unhandled error in ${toolName}`, { error: (e as Error).message, err: e });
```

- The **~12 `logger.error` sites** (wrapper, the 8 write-tool handlers, HTTP error-handler, `serve.ts` shutdown, `runner.ts` pre-migration-backup) keep their existing `{ error: message, agent_name? }` context and **add `err: e`** where an unexpected `Error` is in hand. The write-tool handlers already carry `agent_name` — that stays sanitized.
- **`src/cli/index.ts` `main().catch`** already prints the stack to stderr for unknown errors. It does **not** route through `logger` (the sink isn't configured for one-shots anyway, §3.3). No change required there beyond noting it; the CLI stack-to-stderr behavior is unchanged.

### 3.5 Rotation (size bound)

- Constant `LOG_MAX_BYTES = 5 * 1024 * 1024` (5 MiB) in `logger.ts` (R7).
- Before each file append, the sink checks the current size (`statSync`, swallow ENOENT → size 0). If `size + event.length > LOG_MAX_BYTES` (where `event` is the **whole** composed event — header + stack block, §3.2): `renameSync(logFile, ${logFile}.1)` (overwriting any existing `.1`), then write the event in a **single** `appendFileSync` to a fresh `logFile`. The composed event is written in one syscall — never split across the rotation. On-disk footprint is bounded at ~`2 × LOG_MAX_BYTES`.
- Rotation is **best-effort** like the append: a failed `stat`/`rename` falls through to a plain append (never throws). A single over-cap event is tolerated rather than risking data loss.
- **Multi-process note (§3.0-8, R7):** concurrent appenders mean two processes could both decide to rotate near the cap; worst case is a redundant rename, a slightly-early rotation, or a lost/overwritten `.1` under the race — all **tolerated** (the log is a bug-report aid, not an audit trail). We do **not** add a lockfile (over-engineering for a log).

### 3.6 Version bump → 0.3.0

Additive feature, no schema change. Version → **`0.3.0`**. **4 *sources*** + **1 *guard*** (matching Phase 7 §3.6's counting). `BINARY_SCHEMA_VERSION` stays `2`.

**The 4 sources:**
- `src/core/version.ts` `BINARY_VERSION` → `'0.3.0'`.
- `package.json` `version` → `0.3.0`.
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → **`'v0.3.0 (error logging)'`** (replacing `'v0.2.0 (init templates + explain)'`).
- `CHANGELOG.md` → a `0.3.0` entry (added: persistent error log at `.substrate/logs/substrate.log`; `substrate logs [-n <N>] [--errors]`; diagnose "recent errors").

**The guard (not a source):**
- `src/mcp/tools/read/whoami.test.ts` — the `PHASE_STRING ⊇ v${BINARY_VERSION}` invariant holds; its copy assertion (currently `/init templates|explain/`) updates to the new phase string (e.g. `/error log/`). Health endpoint + MCP server name/version read `BINARY_VERSION` already — no edit.

### 3.7 `substrate logs` command

- New command `logs` in the dispatch `switch` (`src/cli/index.ts`); `import { logsCommand } from './commands/logs.js'`.
- `ALLOWED_FLAGS_BY_COMMAND.logs = new Set(['-n', '--errors'])` (`src/cli/args.ts`).
- **`-n <N>`** is a **value flag** → parse with the established `extractFlagValue(rest, '-n')` pattern (supports `-n 50` and `-n=50`; bare `-n` errors), then `rejectUnknownFlags('logs', logsRest)`. `--errors` is a boolean flag (`rest.includes('--errors')`). N defaults to **50**; must parse to a positive integer (else a clear error).
- `logsCommand(cwd, opts: { n?: string; errors?: boolean })`:
  1. `root = substrateRootFromCwd(cwd)`; `logFile = paths(root).logFile`.
  2. If `.substrate/` is **absent** → a normal `SubstrateError.notFound` via the top-level handler (consistent with `mcp`/`serve`/`diagnose`'s framing).
  3. If `.substrate/` exists but the **log file is absent** → print `No log file yet at <path>. Errors are recorded once a long-lived 'substrate mcp' or 'substrate serve' process has logged one.` and **exit 0**. This is a **distinct** empty-state from "ran cleanly, no errors" (step 4 `--errors`): file-absent means the **sink never ran**; it tells a reporter something different (§4).
  4. Read the file (and `.1` if needed to satisfy N — see below), split into lines.
     - **default:** print the **last N lines**.
     - **`--errors`:** filter to `ERROR` events, print the **last N** of those, each **including its following indented stack block**. If there are **no `ERROR` lines** (file present but only `WARN`/`info`), print `no errors in the log` and **exit 0** — a **distinct** message from step 3 (sink ran cleanly vs sink never ran).
  5. Print the absolute path read at the end (so a report can cite it).
- **Stack-block boundary parse rule (CONCERN-2b, LOCKED).** The reader defines a stack block by **anchoring on the next header**, NOT by "indented": a stack block is the run of lines after an `ERROR` header up to (but **not** including) the next line matching `^<ISO-timestamp> (INFO|WARN|ERROR) `. Under interleaving, "indented alone" is not a reliable delimiter — anchoring on the next header line is. `--errors` emits each matched `ERROR` header plus its boundary-delimited block.
- **Reading across rotation (R6, LOCKED):** to honor `-n` when the current file is short and a `.1` exists, read `.1` then the current file and concatenate (oldest-first), bounded at ~2× the cap, before taking the last N.
- HELP text: `substrate logs [-n <N>] [--errors]   Print recent log lines (default last 50; --errors filters to errors)`.

### 3.8 `diagnose` "recent errors" section

`src/cli/commands/diagnose.ts` gains a final section (after `backups/`, inside the `existsSync(root)` branch), wrapped like every other probe so it never crashes the command:

- Read the last **5 `ERROR` header lines** from `paths(root).logFile` (current file is sufficient; do not bother crossing rotation here).
- If the log is absent or has no errors: `ok('logs/', 'no recent errors')`.
- If errors exist: print a `Recent errors:` block listing the **5 ERROR header lines only** — message + truncated context, ~200 chars each — **explicitly NOT the multi-line stack blocks** (the full stacks would bloat the diagnose dump that goes into bug reports). The stacks live behind the pointer line: `Full log: <abs path> — run 'substrate logs --errors' for more.` So: **5 ERROR header lines, stacks excluded/collapsed.** Recent errors **do not** increment `problems` (they are historical, not a current-health failure) — diagnose's exit code is unchanged by this section.
- Goal (§1): a bug report becomes **`substrate diagnose` + the log file**, and often diagnose alone already surfaces the smoking gun.

### 3.9 Gitignore (both places)

- **Repo `.gitignore`**, in the **"Substrate runtime" comment block** (re-located by that comment, NOT by line number): add `.substrate/logs/`. This entry is **REQUIRED, not merely "clearer"** and must not be "simplified" away: the top-level `*.log` glob matches `substrate.log` but **NOT** `substrate.log.1`. The `.substrate/logs/` dir entry covers the whole directory — **both** `substrate.log` and `substrate.log.1` — matching the `data.sqlite`/`attachments/` pattern.
- **`init`'s `GITIGNORE_BLOCK`** (`src/cli/commands/init.ts`): add the same `.substrate/logs/` (the `logs/` dir, so `.1` is covered too) alongside `.substrate/attachments/`. The `GITIGNORE_MARKER` and idempotency logic are unchanged (the block is matched by its marker line, not line count — confirmed in `init.ts`).
- The entry goes in **BOTH** places (repo `.gitignore` AND init's `GITIGNORE_BLOCK`).

### 3.10 Reporting wiring

- **`.github/ISSUE_TEMPLATE/bug_report.yml`:** add an **optional** `textarea` (`id: error-log`, label `` `substrate logs --errors` output (if any) ``, `render: text`, `required: false`). Optional because the log may be empty for a non-mcp/serve bug. **Coupling caveat (top-of-file comment):** field `label`s render as `### <label>` headings that the auto-close workflow greps for its **required** list — a *new optional* field does **not** touch that required list, so the auto-close workflow needs **no change**. The plan must verify this (the field is non-required, so it is not added to the workflow's `required` greps).
- **`SUPPORT.md`:** in "Best way to get help", add: include the output of `npx @diegoferreyra/substrate logs --errors` (or attach `.substrate/logs/substrate.log`) when the bug involves the MCP server or the running UI; note the log lives at `.substrate/logs/substrate.log` and is local + gitignored.
- **README:** the **"Other commands" line** (re-located by that content, NOT by line number) gains `substrate logs` ("print recent error log lines — useful for bug reports"); a one-liner notes errors are recorded to `.substrate/logs/substrate.log` by the long-lived `mcp`/`serve` processes.

### 3.11 Privacy / PII

- The file may contain board/task ids, error messages, and (for unexpected errors) stack traces with internal file paths. This is on the **user's own machine**, the file is **gitignored** (§3.9) and **never transmitted** (no telemetry — unchanged).
- The **only** required sanitization is the existing `agent_name` one (`sanitizeAgentName`), kept in the file sink (§3.0-4). **Keystone (the privacy model rests on it): Substrate holds no secrets** (no tokens, credentials, or cloud config) — there is nothing sensitive to redact beyond the log-injection defense already in place. **Forward note:** introduce secrets later (e.g. cloud config) and this design must be revisited (§3.0-4).
- When a user pastes the log into a bug report they do so deliberately; `SUPPORT.md` notes the log is local so they can review before sharing.

## 4. Edge cases

| Case | Expected |
|---|---|
| `logger.error` with sink **unconfigured** (one-shot, tests) | console only, exactly as today; no file written |
| `logger.error` with sink configured | console line (unchanged) **+** file append |
| `logger.warn` with sink configured | console + file line at `WARN` |
| `logger.info` with sink configured | console only — `info` never hits the file |
| unexpected error at a boundary (wrapper/HTTP/serve) | generic envelope/message across boundary (unchanged) **+** file line with **stack block** |
| `agent_name` with control chars / newlines in a logged error | sanitized via `sanitizeAgentName` in the file too (no log injection) |
| file append fails (disk full / permission / race) | swallowed; console line still printed; no throw into caller |
| append would exceed `LOG_MAX_BYTES` | `substrate.log` → `substrate.log.1`; fresh `substrate.log`; on-disk ≤ ~2× cap |
| two processes rotate near the cap simultaneously | redundant rename / slightly-early rotation; no corruption; acceptable |
| `mcp` + `serve` + N agent `mcp` children appending concurrently (POSIX) | interleaved whole **events** (one `appendFileSync` per event), no mid-event corruption (`O_APPEND`, ≤ ~PIPE_BUF) |
| same, on Windows | best-effort (noted in `SUPPORT.md`); no atomicity guarantee, accepted |
| `substrate logs` with no `.substrate/` | `SubstrateError.notFound` via top-level handler; exit 1 |
| `substrate logs` with `.substrate/` but no log file | "No log file yet …" (sink never ran); exit 0 — distinct from "no errors in the log" |
| `substrate logs` (default) | last 50 lines printed; abs path printed |
| `substrate logs -n 10` / `-n=10` | last 10 lines |
| `substrate logs -n` (no value) | `-n requires a value` error |
| `substrate logs -n abc` | clear "must be a positive integer" error |
| `substrate logs --errors` | last N `ERROR` lines + their stack blocks |
| `substrate logs --errors` with only `WARN`/`info` history | "no errors in the log" (ran cleanly); exit 0 — distinct from "No log file yet" |
| `substrate logs --errors`, stacks present | each `ERROR` header + its block, where the block runs to the next `^<ISO> (INFO|WARN|ERROR) ` header (boundary parse rule, §3.7) |
| `-n` larger than current file, `.1` exists | reads `.1` + current (oldest-first, ~2× cap) to satisfy N (R6) |
| `substrate logs --bogus` | rejected by `rejectUnknownFlags` (not in logs allowlist) |
| `substrate diagnose` with recent errors | "Recent errors:" block = 5 ERROR **header lines only** (stacks excluded/collapsed) + full-log pointer; exit code unaffected by the errors |
| `substrate diagnose` with empty/absent log | `ok('logs/', 'no recent errors')` |
| `init` (fresh) then `serve`/`mcp` logs an error | `.substrate/logs/substrate.log` created on first write; gitignored |
| repo `.gitignore` + init's block | both list `.substrate/logs/`; idempotent (marker-matched) |

## 5. Test strategy

- **Test-isolation invariant (CONCERN-1, MANDATED):** every suite that configures the sink — `logger.test`, the sink-wiring integration test, the diagnose integration test — calls `resetFileSink()` in an `afterEach`/`beforeEach`. No test leaves `sinkPath` set.
- **Logger unit tests (`logger.test.ts` extended):**
  - sink unconfigured → no file written; console behavior byte-identical to today (existing assertions pass).
  - `configureFileSink(tmp)` → `error`/`warn` append an event to the file; `info` does **not**.
  - **`err` exclusion (CONCERN-3):** `err`-carrying context → file event has a stack block; **assert the `err` key is excluded from console output AND that the file line's serialized context JSON also excludes `err`** — only the rendered stack block carries the stack.
  - **one write per event (CONCERN-2a):** a logged error with a stack is written via a **single** `appendFileSync` (e.g. spy/mock the fs call and assert one call carrying the full `header + '\n' + stack + '\n'`), not line-by-line.
  - `agent_name` with control chars / newline → sanitized identically in the file event via the shared `buildSafeContext`/`sanitizeAgentName` path.
  - **un-writable sink (R4):** point the sink at an un-writable path → the whole sink (stat+rotate+append) swallows the failure, **no crash**, console line still emitted.
  - `resetFileSink()` restores console-only.
- **Rotation unit test:** drive appends past `LOG_MAX_BYTES` (inject a small cap, or write large events) → `substrate.log.1` appears, `substrate.log` restarts, on-disk ≤ ~2× cap; a rotation failure falls through to a plain append; each event lands in one write (never split across the rotation).
- **`substrate logs` tests (`logs.test.ts` + integration):** no `.substrate/` → notFound; `.substrate/` no log → "No log file yet" + exit 0; seeded log → last N lines; `-n`/`-n=` forms; bare `-n` errors; `-n abc` errors; `--errors` filters to `ERROR` + includes each block; **boundary parse (CONCERN-2b):** a stack block is delimited by the next `^<ISO> (INFO|WARN|ERROR) ` header (test with an interleaved log where a following line is NOT indented yet belongs/does-not-belong correctly); `--errors` with no errors → "no errors in the log" (distinct from "No log file yet"); rotation-spanning read (`.1` + current, R6); unknown flag rejected.
- **`diagnose` integration:** init → configure sink via a `serve`/`mcp` that errors (or seed the log file directly) → `diagnose` shows the "Recent errors:" block (**5 header lines, stacks excluded**) + pointer; empty/absent log → `no recent errors`; exit code unchanged by historical errors.
- **Sink-wiring integration:** a `mcp` session that triggers an unexpected handler error writes a stack-bearing line to `.substrate/logs/substrate.log` while the MCP envelope returned to the client stays the generic `internal_error` (assert both — the asymmetry is the feature).
- **Gitignore tests:** `init` writes a block containing `.substrate/logs/`; idempotent re-run does not duplicate; repo `.gitignore` lists `.substrate/logs/`.
- **Version drift guard:** `whoami.test.ts` updated; `PHASE_STRING ⊇ v${BINARY_VERSION}` holds.
- **Manual smoke (`tests/manual/run-smoke.mjs`):** add a step that runs `substrate logs` (asserts exit 0 + the "no log file yet" or a printed line) after an init, and a `--errors` path.
- **Full suite green:** `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build`, concurrency smoke, manual MCP smoke. `pnpm publish --dry-run` unaffected (no new asset, no dep — the sink is plain Node `fs`).

## 6. Operator tasks (NOT done by the agent)

Unchanged from Phase 6/7 §6: live `npm publish`, the real `v0.3.0` tag push, and npm token/secret config remain Diego's. This phase ships in-repo + dry-run-verified; the `0.3.0` release is cut by the existing `publish.yml` on the operator's tag push. The agent does **not** publish.

## 7. Reviewer decisions (R1–R7, all APPROVED)

The Architect Reviewer resolved all seven; each is now LOCKED in §3.

1. **R1 — log file name/location → `.substrate/logs/substrate.log`** (a `logs/` subdir, matching the `boards/`/`attachments/`/`backups/` layout). **Approved.** (§3.0-1, §3.1)
2. **R2 — sink scope/mechanism → explicit `configureFileSink(path)`, called ONLY by `mcpCommand`/`serveCommand`** after their `.substrate/`-exists guard — long-lived processes only; one-shots (init/add/backup/diagnose) keep stderr-only (visible). **Approved.** (§3.0-6, §3.3)
3. **R3 — multi-process → one shared file via `O_APPEND`, no per-pid**; Windows best-effort documented (plus CONCERN-2's one-write-per-event rule). **Approved.** (§3.0-8, §3.5)
4. **R4 — sync write → `appendFileSync`/`statSync`/`renameSync`** (the line must land before a possible crash; serve's shutdown/`beforeExit` paths can't await; keeps the logger sync). The WHOLE sink (stat+rotate+append) is wrapped so a write/rotate failure NEVER throws into the caller; the un-writable-sink-no-crash test is kept. **Approved.** (§3.2)
5. **R5 — reserved `err` context key carries the stack to the FILE but never to the envelope.** Re-confirmed: the agent-facing envelope is built by `errorEnvelope(...)`, a separate statement from `logger.error`, so the stack provably can't reach the stdio boundary. **Approved.** (§3.2, §3.4)
6. **R6 — `substrate logs -n N` reads `.1` then current** (concat oldest-first, bounded ~2× cap) to satisfy N across a rotation. **Approved.** (§3.7)
7. **R7 — 5 MiB cap, single-generation `.1` rotation, best-effort** (tolerate a lost/overwritten `.1` under a rotate race — a local error log is a bug-report aid, not an audit trail). **Approved.** (§3.0-7, §3.5)

## 8. Definition of Done (for this spec)

**Status: APPROVED (incorporates Architect Reviewer changes; CONCERN-1/2/3 + NITs; R1–R7 resolved) — ready for planning.** Locked: the file lives at `.substrate/logs/substrate.log`; `warn`+`error` (not `info`) go to it; the file carries full detail incl. stack for unexpected errors while the stdio/HTTP boundary stays generic (envelope built by a separate `errorEnvelope(...)` statement); `agent_name` sanitization is kept via a shared `buildSafeContext` that also excludes the reserved `err` key, and is the only sanitization needed (**keystone: no secrets exist** — revisit if that changes); only `mcp`/`serve` configure the sink, explicitly, after their `.substrate/`-exists guard; **one `appendFileSync` per logged event** (header + stack block composed in memory); the WHOLE sink (stat+rotate+append) never throws into the caller; size-bounded by single-generation 5 MiB rotation, best-effort under a rotate race; multi-process shared-file append accepted (Windows best-effort); `substrate logs [-n <N>] [--errors]` with a **next-header-anchored** stack-block parse rule and **two distinct empty-states**; a diagnose "recent errors" section of **5 ERROR header lines, stacks excluded**; gitignore `.substrate/logs/` **REQUIRED** in BOTH the repo `.gitignore` and init's `GITIGNORE_BLOCK` (the `*.log` glob misses `substrate.log.1`); bug-report/SUPPORT/README wiring (edit points re-located by content, not line number); version → `0.3.0` (4 sources + 1 guard), `BINARY_SCHEMA_VERSION` stays `2`, forward note that Phase 8 re-numbers to `0.4.0` when built. **Test isolation MANDATED:** every sink-configuring suite calls `resetFileSink()` in teardown (invariant: no test leaves `sinkPath` set). **Reviewer decisions (§7):** R1–R7 all approved. Per Diego's standing directive there is no separate approval pause: Architect drafts the Phase 7b plan → development.
