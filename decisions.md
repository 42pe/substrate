# Substrate — Decisions Log

Non-obvious product/scope decisions. One paragraph max per entry. This file outlives the PRD.

Format: **Decision** — Alternatives — Why — Date.

---

## Dogfood fixes (2026-07-07)

### "Pending human approval" — a derived signal + a UI pill (sprint pending-approval)
**Decision:** A task is **pending human approval** when advancing it is gated on a human
decision: an active `transition_guard` engages on a move OUT of the task's current group, its
`require` references ≥1 `human_only` field (B3), and that field is currently unset. It's a pure,
board-derived function (`pendingApprovalFor(board, task)`) — no new task state — surfaced three
ways off one aggregate (`listPendingApprovals`): the `list_pending_approvals` MCP tool, the
`substrate pending-approval` CLI, and `GET /api/pending-approvals`; plus a per-task flag on the
kanban columns payload and a `GET /api/tasks/:id/approval` for the detail view. The UI shows a
distinct **violet "pending approval" pill** (its own `--pending` token — deliberately NOT the
amber `missing_required` style, so the two signals are visually separable). **Scope decisions
(Diego-approved plan):** (4) start simple — report every task in a human-gate's `from_group`
with the human field unset; a `human_only` field is "awaiting" when its leaf doesn't pass
standalone (positive `exists`/`eq` gates are exact; a `human_only` field buried in a `none_of`
is leaf-evaluated, accepted until dogfood shows noise). Same-group no-op moves and already-past
tasks are excluded (matches the write path / `check_transition`). (2) Pill ships on kanban card
+ task detail; List filter / Overview roll-up deferred as nice-to-have. (3) No dedicated `/pending`
UI route — the pill + CLI/skill cover it. **Why:** Diego's StackChan-style pipeline runs agents
unattended to a human gate; "what's waiting on me?" must be a first-class, cross-board question,
and a blocked task must look blocked. See `.agents/plans/pending-approval-and-md-fix.md`.

### Task-detail markdown was stale-serve, not a code bug (sprint pending-approval, item C)
**Decision:** The reported "description renders as plain text / no line breaks" was a **stale
running `serve`** serving a pre-Phase-12 `dist/ui` — the code on `main` was already correct
(`marked` with `breaks: true` → DOMPurify → `.markdown` styles). Verified by reproducing on a
fresh build (renders correctly). Hardened anyway: removed the redundant outer `.markdown` class
on the description/comment `CardContent` (the `<Markdown>` component already emits its own
`.markdown` div — the double-nesting made `.markdown > :first-child` target the wrapper). The
Playwright smoke now asserts a `<strong>` AND a `<br>` (from a single `\n`) render in the built
app, so the symptom can't regress silently. **Takeaway for the runbook:** restart `serve` after
updating Substrate — a long-lived `serve` serves the old bundle until restarted.

### `human_only` fields — a gate an autonomous agent can't self-clear (B3)
**Decision:** `FieldSchemaEntry` gains an optional `human_only: boolean`. When a task field is
`human_only`, the agent-facing MCP write tools (`create_task`/`update_task`) **refuse** to set
it (`forbidden`, naming the field + the `substrate approve` remedy); the only way to set it is
the **human channel** — a new `substrate approve <task_id> <field> [value=true]` CLI that stamps
the change as `human:<os-user>` in the event log (the UI is the other channel, once it can
write). **Why:** three dogfood agents (esp. the near-autonomous StackChan run) exposed that a
`transition_guard` requiring a boolean gate field is only advisory against an agent working
unattended — the agent can flip its own `spec_approved=true` and sail through. `human_only` +
a guard that requires the field turns "advisory checkbox" into a real human approval gate: the
agent's write tools refuse to *set* the field, and `update_board` refuses to *downgrade* it
(clear the flag / delete / drop it in a full-schema replace — that would be a two-call
self-approval), so an agent can neither set the value nor un-protect it. **Honest residual:**
the guard policy itself is still substrate-as-code — an agent could `archive_policy`/rewrite the
guard to escape it. That is a louder, git-visible, event-logged act than quietly ticking a box,
not a silent bypass; extending `human_only` protection to guards that *reference* a human_only
field is a documented future hardening. **Alternatives:**
(a) a write-capable approval UI as the only human channel (rejected as the *first* increment —
a CLI ships the enforcement now without the web-write surface; the UI is additive later);
(b) provenance-by-convention, no enforcement (rejected — the whole point is that an unattended
agent won't honor a convention). **Approved by Diego 2026-07-07 (Option A).** See
`.agents/plans/policy-integrity.md`.

### `check_transition` read tool — dry-run a gated move without a throwaway task (B3)
**Decision:** New read-only MCP tool `check_transition({task_id, to_group})` runs the same
`runTransitionGuards` the write path runs and returns `{allowed, from_group, to_group}` or, when
blocked, `{allowed:false, blocked_by:{policy_id, message}}` — **writing nothing**. **Why:** the
AUTHORING validation ritual (create a probe task, attempt the move, read the block, set the gate,
retry, archive the probe) is the only way to confirm a gate fires, and dogfood agents kept
leaving probe tasks behind or skipping the check. A dry-run makes "would this move be allowed?"
a first-class question. It brings the tool count to 30.

### `substrate validate` — server-less lint of boards + policies (B3)
**Decision:** New `substrate validate` CLI loads the substrate without starting `mcp`/`serve`: a
corrupt/unloadable substrate prints the actionable error + `fix_prompt` and **exits non-zero**
(CI-usable); a substrate that loads additionally gets logical-smell **warnings** the load
doesn't raise (today: a `transition_guard` whose `from_group === to_group` can never fire on a
real move). Warnings are advisory (exit 0); only a failed load fails the command. **Why:** the
heavy structural validation already runs on load, but the only way to trigger it was to boot a
server; `validate` surfaces it in CI, and the lint layer catches malformed-but-loadable gates
that would otherwise fail silently. See `.agents/plans/policy-integrity.md`.

### `version_mismatch` now includes `current_version` (B5 — reverses the PRD §6.11 lock)
**Decision:** `version_mismatch` errors now carry `current_version` in `error.details` (the
message still requires "re-read and reconcile before retrying"). This **reverses** the
Phase-2 / PRD §6.11 decision that deliberately withheld the number to force a full re-read.
**Why:** three independent dogfood agents flagged that, with the number withheld, a
concurrent writer must burn a wasted `get_task`/re-read just to fetch the integer before
retrying — real cost for weak protection, since a determined agent can blind-overwrite
anyway by reading and ignoring the diff. The honest safeguard is the message + the
requirement to reconcile, not the missing integer. **Scope:** added at the OCC version-CHECK
sites (`tasks.ts` update/archive/unarchive + `assertVersion` for board/group/policy/project);
the rare CAS-race sites (`rowsAffected === 0`) keep `{id}` only — there no fresh version was
read, so there is no correct integer to report. That branch is effectively unreachable
single-threaded, so it is intentionally left untested. **Approved by Diego 2026-07-07.** See
`.agents/plans/dogfood-fix-observability.md`.

### Handled tool errors are logged (B4)
The MCP wrapper now logs handled `SubstrateError`s to the persistent log at ERROR (so
`substrate logs --errors` shows an agent session's error trail — previously handled errors
were returned in the envelope but never logged), **excluding** the expected control-flow
codes `transition_blocked`/`version_mismatch` (normal outcomes, already surfaced via events
+ OCC) **and `internal_error`** (already logged with its stack by the handler — logging the
scrubbed generic again would be a thinner duplicate). The error is attributed to the acting
`agent_name` when present. Agent-derived content rides in the JSON-escaped context, so it
can't forge a log line.

## Architecture-review follow-ups (2026-06-22/23)

### Windows CI: best-effort temp cleanup + a few `skipIf(win32)`, libsql is the cause (2026-06-29)
**Decision:** Make the Windows CI leg pass. Root cause, diagnosed on a real Windows VM (UTM, Win11 ARM64, driven over SSH): **`@libsql/client`'s native `close()` does not release the SQLite file handle on Windows** — the built-in `node:sqlite` opens, closes, and deletes the *same* WAL database cleanly, but libsql leaves `data.sqlite`/`-wal`/`-shm` held until the process exits. So a test's `rm(tempDir)` in teardown threw `EBUSY`. **Fixes:** (1) a shared `rmrf`/`rmrfSync` helper (`tests/helpers/tmp.ts`) for all teardown — **one attempt, swallow on failure, leak the temp dir** (OS reclaims `%TEMP%`); critically **no `maxRetries`**, because VM measurement showed `rm` retries spin ~3.3s *per held file* (×3 WAL files ≈ vitest's 10s hook timeout → a 35-min hang on the first retry attempt, [#11], closed). (2) Three real cross-platform test bugs fixed (hardcoded `/` path, `npx` needing `shell:true`, an explain test routed through `rmrf`). (3) Three tests `skipIf(process.platform==='win32')` — `init` re-create, `archive` import (both must delete a libsql-held `data.sqlite` in-process, impossible on Windows), and `serve` SIGINT (Windows has no POSIX SIGINT). **Alternatives:** retry harder (rejected — caused the hang, and the leak is permanent within the process so retries can't succeed); pin/upgrade libsql (rejected — we're current, 0.17.3; no fix available). **Also found:** `@libsql/client` has **no `win32-arm64` prebuild** → Substrate can't run on Windows-on-ARM (SUPPORT.md updated). **Windows leg kept non-blocking** for now: it passes, but the libsql sharp edges (any new DB test not using `rmrf`, any new held-file delete) could reintroduce flakes; revisit promoting it to blocking after it's been stably green and after a CONTRIBUTING note lands requiring `rmrf` in teardown. **Postscript (same day):** the very next (docs-only) run hit an *intermittent* native crash — `worker-0 exit code 0xC0000005` (access violation) — in the 4-process `smoke:concurrency` stress on Windows, i.e. libsql's binding isn't rock-solid under concurrent multi-process WAL writes on Windows. Single-process use is unaffected. This concretely validates keeping the leg non-blocking and is a real caveat for the "multiple agents on one substrate" scenario on Windows (noted in SUPPORT.md). **Date:** 2026-06-29.

### New error code `substrate_corrupt` for a broken board file on load (Theme 3)
**Decision:** Add a dedicated error code `substrate_corrupt` (the eighth in the otherwise-locked v1 set) for the load path when a `boards/*.json` is malformed or structurally invalid. The whole-substrate strict-fail is **kept** (one broken board still fails the load — a broken gate must never silently vanish), but the error is now actionable: it names the exact file and embeds a paste-able prompt (also in `details.fix_prompt`) that a human can hand to an AI agent to repair the file. All load-path raises (JSON parse, board-shape, duplicate board/group ids, enum-without-values, dangling group refs, malformed policy definitions) now use it via `substrate/corrupt.ts`; the write path keeps `schema_violation` (there the edit *input* is at fault). **Alternatives:** (a) per-board degradation — skip the broken board, load the rest, warn loudly (rejected for now: more code, and silently dropping a board risks an agent acting against an incomplete substrate; revisit if hand-edit friction dominates the dogfood journal); (b) keep the generic `internal_error` (rejected — reads as "server bug" when it's a user-fixable config file). **Why:** the review flagged that `internal_error` misattributes a fixable authored-file problem to a server fault; a dedicated code + remediation prompt makes the failure self-service without weakening the strict-load guarantee. HTTP status stays 500 (the request was fine; server-side state is broken) but the message carries the fix. PRD §6.4 updated. **Date:** 2026-06-23.

## v0.3 era (post-reviewer pivot, 2026-05-09)

### Product-review follow-ups: doc reframe, gate honesty, naming, scope floor (2026-06-09)
**Decision:** Acting on an external product review of the docs (`.agents/product-review-docs-20260609.md`), four resolutions: **(1) Lead the docs with the problem, not the mechanism** — durable cross-session state is the everyday value prop (R8 resolution: one agent team at a time today, multiple teams as the trajectory), with write-time enforcement second and a "Why not TodoWrite / CLAUDE.md / GitHub Issues?" section up top. **(2) Be honest that gates gate the _report_, not reality** — a `transition_guard` is a real rail on the *transition* but its field is **self-attested** (a confession step, not a control); say so wherever gates are pitched (README, examples, AUTHORING). **(3) Keep the name "Substrate," tune keywords only** — accept the SEO collision with Polkadot's Substrate framework rather than rebrand; disambiguate via tagline/keywords ("agent task manager / MCP work-tracker") and a one-line README disclaimer. Revisit only if discoverability proves fatal before/after the public push. **(4) A weak `agent_responsibility` kills the _class_, not the tool** — PRD kill-criterion 3 reframed: durable state + working guards justify a lean guards-plus-state tracker independently, so reduce scope, don't shelve. **Alternatives:** rebrand to a distinct name (rejected — highest effort, repo still private so deferrable); leave the "enforceable gates" framing as-is (rejected — oversells; the internal docs were already honest, the product framing wasn't); treat criterion-3 firing as paradigm-fatal (rejected — discards the independently-load-bearing durable-state value). **Why:** the review's verdict was "not a gimmick, but the value is narrower than the docs frame it and concentrated in two undersold mechanisms (write-time enforcement, durable state)"; these changes align the framing with what's actually load-bearing without overclaiming. **Roadmap notes (NOT built now):** gates backed by *verifiable evidence* (command exit codes / CI status / file existence) — where enforcement becomes real, a v1.x/v2 candidate; and a *slimmer default MCP toolset* (substrate-edit tools opt-in) to cut the 29-tool context tax — a future phase, trade-off acknowledged in the meantime. **Date:** 2026-06-09.

### Phase 1 install resolved newer-than-planned versions; accepted
**Decision:** Accept the newer versions pnpm pulled during Phase 1 dependency install: React **19.2.6** (plan said 18), Vite **8.0.14** (plan said 6), TypeScript **6.0.3** (plan said 5), Vitest **4.1.7** (plan said 3), Zod **4.4.3** (plan said 3), ESLint pinned back to **9.39.4** (briefly pulled 10, downgraded for eslint-plugin-import compat). **Alternatives:** pin to plan-documented majors (would require explicit `pnpm add <pkg>@N`); freeze on plan versions and re-plan if needed. **Why:** the plan's version notes were written conservatively when current versions were unknown; the newer majors all work in Phase 1 with no source-level changes required, and they're already exact-pinned in package.json so future installs reproduce. Phase 1 audit confirmed all gates pass. **Caveat for Phase 5:** React 19 has known interaction notes with some Radix primitives (ShadCN); flag in the Phase 5 plan. Zod 4 API differs slightly from 3; `.optional()` and `.isOptional()` both work in our usage. **Date:** 2026-05-26.



### Tech stack locked (2026-05-09)
**Decision:** Node ≥20 LTS / TypeScript / `@libsql/client` (native binding — see "libsql WASM rejected" entry below) / Hono HTTP / React 18 + Tailwind v4 + ShadCN + Vite + TanStack Router / marked + DOMPurify for markdown / official MCP TS SDK on stdio. Independent-process architecture, shared SQLite via WAL. npm name `@diegoferreyra/substrate`. Repo `diegoferreyra/substrate`. MIT. **Alternatives considered and rejected:** `better-sqlite3` (sync API doesn't match the async-everywhere stack; libsql is the modern equivalent with prebuilds for the same platforms); Fastify (Hono is lighter for our needs); HTMX + server-rendered HTML (cuts off ShadCN's component leverage); single-long-lived-process with IPC (adds plumbing complexity without payoff — SQLite WAL handles multi-process natively); `substrate-mcp` unscoped name (scoping resolves namespace ambiguity, signals authorship, leaves room for sibling packages). **Why:** the combination optimizes for (a) acceptable OSS install on every platform via npm prebuilds, (b) modern TypeScript ergonomics throughout, (c) a UI path that can leverage existing component libraries (ShadCN), (d) processes that just-work via WAL with no IPC code. **Date:** 2026-05-09.

### Phase 0 spike result: libsql WASM rejected; native binding accepted
**Decision:** Use `@libsql/client` native binding, not `@libsql/client-wasm`. The original v0.3 stack-lock specified WASM for "no native deps"; Phase 0 spike (2026-05-09) proved WASM doesn't fit the use case. **Spike findings (macOS arm64, Node 24.15):** (a) `@libsql/client-wasm` returns `SQLITE_CANTOPEN` immediately when given a `file:` URL — it uses `@libsql/libsql-wasm-experimental`, designed for browser/edge contexts (Cloudflare Workers, etc.) without filesystem access. (b) `@libsql/client` native binding: 4 concurrent processes for 60 seconds wrote 8,821 rows total, zero errors, persisted count matched reported count exactly. **Engineering implications:** schema bootstrap must be centralized (only `substrate init` and migration runner touch DDL); every connection sets `PRAGMA busy_timeout = 5000`; `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` set once at init. **Alternative considered:** switch to `better-sqlite3` (same native-dep class, more battle-tested, sync API). Rejected because the rest of the stack (Hono, MCP SDK) is async; libsql's async API matches; and Turso/libsql is forward-compatible with a hypothetical hosted-sync v2. **Date:** 2026-05-09. *Spike artifacts retained at `/Users/diegoferreyra/WebDevelopment/substrate-spike-libsql/` for verification.*



### Process model: independent processes, shared SQLite via WAL
**Decision:** `npx substrate` (HTTP UI) and `npx substrate mcp` (stdio MCP) are independent Node processes. Each opens its own SQLite connection to `.substrate/data.sqlite`. WAL mode handles concurrent access across processes. **Alternatives:** single-long-lived process with IPC (Unix domain sockets or named pipes) for stdio MCP to proxy to the master process. **Why:** SQLite WAL is built for this — multi-process concurrent access to one file is its native pattern. IPC adds lifecycle management, error paths, and a class of bugs not justified by the consistency wins. User UX is unchanged: one command (`npx substrate`) starts the UI; agents spawn their own MCP children via `.mcp.json`. Agents work without the UI running. **Date:** 2026-05-09.

### NPM name uses Diego's scope, not the bare `substrate`
**Decision:** `@diegoferreyra/substrate` published to npm. CLI binary named `substrate` after install. Product name remains "Substrate" in all docs and UI. **Alternatives:** unscoped `substrate-mcp`, `agent-substrate`, `subst`; scoped under a future `@404pe` org. **Why:** scoping guarantees namespace availability now and for sibling packages later (`@diegoferreyra/substrate-sync`, etc.). The scope only appears at install/publish time — once installed, the binary is just `substrate`. Forward path to a different scope (`@404pe` or org rename) remains open via npm's deprecation + re-publish flow. **Date:** 2026-05-09.



### Storage: SQLite, gitignored by default
**Decision:** Use SQLite via `better-sqlite3` for runtime state (tasks, comments, events). `data.sqlite*` and `attachments/` gitignored by default; engineer can flip. Substrate JSON (`boards/*.json`, `config.json`) tracked in git as before. **Alternatives:** SQLite via WASM (sql.js / libsql wasm) for cleaner OSS install; JSONL event-sourced log with snapshot for naturally text-based / git-mergeable state; one JSON file per entity (filesystem-as-DB); single state.json (lowdb). **Why:** simplest path, well-trodden, SQLite gives indexes/transactions/JSON1 for free. Gitignore removes the binary-merge-conflict footgun. Native-dep edge case on uncommon platforms accepted as v1 risk; revisit if OSS friction proves significant. JSONL was philosophically attractive (event log = canonical store, matches design doc's TaskEvent concept) but ~1 extra week of build time; defer until SQLite limits hurt. **Date:** 2026-05-09.

### Policy classes in v1: `transition_guard` + `agent_responsibility` only
**Decision:** Ship two of the four design-doc classes in v1. Defer `automation` and `validation`. Add when dogfood produces concrete demand. **Alternatives:** all four (status quo PRD v0.2); `transition_guard` only (PM reviewer); `agent_responsibility` + `automation` (pragmatic reviewer); current pick is the middle ground. **Why:** Diego self-reported `agent_responsibility` as the class he'll lean on most — so it must ship. `transition_guard` is the cheapest class to build (~3 days) and validates engine plumbing. `automation` is the heaviest (~2 weeks for action executor + cascade + 5 action types) and has the highest "designed wrong before usage" risk per the PRD's own R4. `validation` is mostly redundant with `field_schema.required` in v1. Cutting both materially shortens time-to-dogfood. **Date:** 2026-05-09.

### Paradigm bet is on `agent_responsibility` (envelope suggestions), not `automation` (autonomous state changes)
**Decision:** v0.3 sharpens the paradigm framing. The pitch is "substrate hints at what to do next via response-envelope suggestions" rather than "substrate autonomously moves things." Diego's stated usage pattern drives this. **Alternatives:** keep autonomous-state-changes as the headline (design doc framing); equal-weight both. **Why:** Diego will use `agent_responsibility` most. The PRD shouldn't oversell what v1 actually does. Sharpening the framing now keeps the metric load-bearing on the right axis (envelope engagement, not transition automation). **Date:** 2026-05-09.

### Minimum security middleware in v1: Origin/Host allowlist + path canonicalization + markdown sanitization
**Decision:** Three security layers ship in v1. Reject HTTP requests where `Origin`/`Host` doesn't match the localhost allowlist. Canonicalize attachment paths and reject `..`-traversal. Sanitize all rendered markdown. **Alternatives:** no middleware ("localhost-only is the security model"); full per-install random token + Origin checks. **Why:** "localhost only" doesn't defeat DNS rebinding or browser CSRF, which are realistic attacks against local HTTP servers. ~1 day of work covers the high-likelihood threats. Per-install token adds friction (every agent config needs it) for marginal benefit *over* Origin checks. **Date:** 2026-05-09.

### MCP transport: stdio only in v1
**Decision:** v1 ships stdio MCP transport (`npx substrate mcp`). HTTP+SSE MCP transport deferred. The HTTP server in v1 serves only the read-only web UI. **Alternatives:** dual transport (v0.2); HTTP+SSE only. **Why:** Claude Code (and most agent runtimes) use stdio MCP natively. Dual transport doubles the surface, doubles testing, adds CORS thinking, adds port-conflict considerations. v1 = Claude-Code-first; other clients are best-effort. Add HTTP transport in v1.x if a non-Claude client demands it. **Date:** 2026-05-09.

### Substrate-authoring UI cut to read-only inspector in v1
**Decision:** Web UI ships read-only views only — project, boards, tasks, events, substrate inspector. No CRUD forms for boards/groups/policies. Authoring is via editor + setup-agent. **Alternatives:** ship CRUD-over-JSON (v0.2 plan); skip web UI entirely. **Why:** UI gravitational pull is the biggest scope-creep risk per all three reviewers. CRUD forms invite "small" UI improvements that compound. Read-only inspector + editor + setup-agent covers the use case at a fraction of the build cost. The UI stays deliberately spartan. **Date:** 2026-05-09. *Tightens the v0.2 decision.*

### No hot-reload; substrate JSON re-read on every MCP call
**Decision:** No file watcher. Substrate JSON (boards/groups/policies) is read fresh from disk on every MCP call. **Alternatives:** chokidar-based file watcher with debounce; in-memory cache with manual reload command. **Why:** 5–50 KB of JSON per call is cheap; profile later if it matters. Eliminates a 1–2 week chunk of work, an entire class of cross-platform bugs (WSL inotify, macOS FSEvents, Windows ReadDirectoryChangesW), and all "what about in-flight requests during reload" semantics. **Date:** 2026-05-09.

### Board filenames use `<board_id>.json`, not slugs
**Decision:** Board JSON files named `boards/<board_id>.json` where `board_id` is a stable UUID. Board name lives inside the JSON as a field. **Alternatives:** `<slug>.json` (more human-readable); two-level scheme. **Why:** slug-in-filename creates board-rename hazards — renaming a board renames the file, git sometimes detects as rename and sometimes as delete+add, and tasks in SQLite reference the board by ID anyway. ID-in-filename is robust to all renames; cosmetic ugliness only. **Date:** 2026-05-09.

### Policy references use group IDs, not names
**Decision:** `transition_guard` policies reference `from_group` and `to_group` by group ID (UUID), not name. **Alternatives:** name-based references (more human-readable JSON). **Why:** group renames must not break policies. IDs are stable; names are user-facing. **Date:** 2026-05-09.

### Operator set trimmed in v1
**Decision:** Ship 11 operators in v1 (`exists`, `not_exists`, `is_empty`, `not_empty`, `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`) + 3 compound (`all_of`, `any_of`, `none_of`). Cut `matches_regex`, `matches_any_keyword`, `starts_with`, `ends_with`, `has_any`, `has_all`. **Alternatives:** ship full design-doc set; ship a minimal 5-operator core. **Why:** cut operators are easy to add when a policy needs them. Each shipped operator is implementation + tests; cutting half removes ~3-4 days of work. `matches_regex` specifically has DOS-risk considerations that aren't worth thinking about for v1. **Date:** 2026-05-09.

### Schema migration: pragma user_version stamp, transactional, auto-backup
**Decision:** SQLite `data.sqlite` stamps schema version in `PRAGMA user_version`. Startup refuses to open if file's version > binary's expected version. Migrations run forward-only inside a transaction, with automatic backup-before-migration to `.substrate/data.sqlite.bak-<timestamp>`. **Alternatives:** no version stamp (binary discovers schema by inspection); manual user-run migrations; reversible migrations. **Why:** "older binary against newer file" is a data-loss path that none of `user_version` + refuse-to-open + transactional + auto-backup is expensive. Forward-only + auto-backup matches the conventional "users won't manage migrations" reality. **Date:** 2026-05-09.

### MCP server lifecycle: port 7475 pinned, refuse on conflict, PID file
**Decision:** HTTP UI server pins port 7475. If taken, refuse to start with a clear error pointing at the conflicting process. Write `.substrate/substrate.pid` to prevent second-instance from same directory. **Alternatives:** pick next free port (v0.2 plan); ephemeral port advertised via discovery file. **Why:** "next free port" makes `.mcp.json` configs drift between runs — agents pointing at `localhost:7475` break silently if the port changes. Pinning is brittle but discoverable. PID file is hygiene. **Date:** 2026-05-09.

### Two engineers on one repo: per-machine state, JSON syncs via git
**Decision:** Each engineer running Substrate against the same repo has their own local `data.sqlite` (gitignored). Substrate JSON syncs via git as usual. Runtime state (tasks/comments/events) diverges across machines. Sharing state requires explicit `substrate export` / `substrate import`. **Alternatives:** sync state via git (v0.2 plan, footgun); refuse to run if `data.sqlite` is missing; warn loudly. **Why:** the only way to make multi-machine state coherent is to build a sync layer, which v1 doesn't. Per-machine state is the honest model. Documented in Flow E of the PRD. **Date:** 2026-05-09.

### `agent_name` framed as "agent-identity-tag," not "audit trail"
**Decision:** Drop "audit trail" language in PRD body. `agent_name` is a self-attested free-form string; useful for debugging and informal attribution, not forensic. **Alternatives:** keep "audit" language; build cryptographic attestation. **Why:** all three reviewers flagged the overstatement. Self-attestation isn't audit. Reframe to match reality. **Date:** 2026-05-09.

### Explicit paradigm-failure kill criteria in v1
**Decision:** Add four explicit kill criteria to §9 that, if any fire by week 8 of dogfood, halt feature additions. (1) Diego silently bailed for ≥2 weeks. (2) Fewer than 3 logged "markdown would have failed me" moments. (3) `agent_responsibility` engagement <15%. (4) Fewer than 3 distinct policy patterns. **Alternatives:** keep failure conditions soft in §8 risks (status quo). **Why:** without explicit kill thresholds, every dogfood signal trends toward "keep building." Pet projects that fizzle do so via sunk-cost rationalization. Writing the thresholds down is the only forcing function for honest evaluation. Numbers are guesses; the act of pre-committing is what matters. **Date:** 2026-05-09.

### Productization path: OSS-only is the explicit default at v2
**Decision:** Reframe §9 v2 with OSS-only as the explicit default outcome. Paid hosted sync layer is pursued *only* if specific evidence appears (≥10 teams hacking sync, non-trivial semantics, willingness to pay). Shelve is a legitimate third outcome. **Alternatives:** three v2 paths weighted equally (v0.2); commit to OSS-only now; commit to product now. **Why:** paid hosted sync is effectively "rebuild Linear's backend." Diego solo at 8–20 hrs/week cannot build it. The default outcome for similar OSS projects is OSS-only indefinitely; treating it as the third option among three biases v1 toward feature-hedging for a SaaS that probably won't happen. Honesty about default outcome lets v1 ship leaner. **Date:** 2026-05-09.

### Dogfood journal required artifact during v1 dogfood
**Decision:** Diego maintains a written log during the 8-week dogfood capturing: specific moments markdown/Linear would have failed, policy patterns authored, friction points, times he silently bailed back to markdown, and *moments where he worked around a missing feature*. **Alternatives:** rely on memory; rely on metrics alone. **Why:** the kill criteria can't be evaluated without it. The "worked around the missing feature" entries specifically catch the failure mode where Diego mentally routes around an absent `automation` and doesn't realize he wanted it. **Date:** 2026-05-09.

### OSS artifacts must ship before public push
**Decision:** Before making the repo public or promoting it: README with platform support statement, ISSUE_TEMPLATE.md with required fields, SUPPORT.md (best-effort, weekly triage, no SLAs), CONTRIBUTING.md, examples/ directory with Diego's real boards, and a `substrate diagnose` CLI command. Listed as v1 scope in §6.16. **Alternatives:** push public early and add artifacts as issues arrive. **Why:** support burden compounds. Strangers' issues without these artifacts force Diego into either burning hours or alienating early users. ~2 days of work upfront saves weeks of triage friction. **Date:** 2026-05-09.

---

## v0.2 era (local-first OSS pivot, kept entries)

### Local-first, per-project TypeScript binary; not a hosted service *— KEPT*
Substrate ships as an npm package (`npx substrate init` / `npx substrate`). One project per instance. One user. Local-only. v0.3 strengthens by removing dual MCP transport, narrowing UI scope, and adding security middleware.

### Drop `User` and `Token` entities; agent identity is a free-form audit string *— KEPT, reframed*
No users table, no tokens table, no auth. `agent_name` is the audit string. v0.3 reframes "audit" as "agent-identity-tag" — not forensic.

### `Project` entity kept but implicit *— KEPT*
One per substrate instance, auto-created. Stored in `config.json`.

### Attachments folder in v1 *— KEPT, with path canonicalization added in v0.3*
`.substrate/attachments/<task_id>/`. v0.3 adds path canonicalization at serve time.

### Open source from day one, repo public *— KEPT*
MIT (default). v0.3 adds explicit pre-public artifact checklist (§6.16).

### Stack: TypeScript + Node + SQLite, locked *— KEPT*
Confirmed in v0.3.

### No remote access in v1 *— KEPT*
Localhost only. v0.3 adds security middleware.

### Cross-project agents: multiple MCP connections *— KEPT*
Stdio MCP per project; agent config lists N endpoints.

### FSM-shaped automation: not in v1; consider as authoring sugar over ECA in v2 *— KEPT, but now moot for v1*
With `automation` itself deferred from v1, FSM consideration moves further out. Re-examine in v1.x → v2 only.

### Schema migrations: forward-only, with backup *— EXTENDED in v0.3*
v0.3 adds explicit version-stamp + refuse-to-open + transactional migrations + auto-backup. See current entry above.

---

## v0.1 era (hosted-service draft, fully superseded 2026-05-09)

The v0.1 hosted-service decisions are all superseded by the v0.2 local-first pivot. Kept for history only:

- Persona broad — *superseded*; v0.3 narrows to "engineer with agent fleet."
- v1 ships all four policy classes — *superseded*; v0.3 cuts to two.
- Postgres locked — *superseded*; SQLite in v0.2+.
- v1 multi-user per-user isolation — *superseded*; single-user in v0.2+.
- Closed-beta hosting on Diego's instance — *superseded*; no instance.
- Productization trigger "3 humans on Diego's instance" — *superseded*; "3 humans confirmed running their own."
- Substrate authoring as MCP-only with read-only UI — *partly superseded*; v0.2 added CRUD UI, v0.3 reverted to read-only.
- Webhook automation action cut — *kept* (and now `automation` itself cut from v1).
- Batch write tools cut — *kept*.
- `fork_task` cut — *kept*.
- Easter egg ships — *kept*.
