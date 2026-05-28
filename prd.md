# Substrate — PRD

**Status:** Draft v0.3
**Author:** Diego Ferreyra
**Last updated:** 2026-05-09
**Companion docs:** [design doc](.agents/substrate-initial-design-doc-20260508.md), [decisions log](decisions.md)

> **v0.3 incorporates:** independent reviewer feedback on v0.2 (12 consensus items applied), four major disagreement calls (policy-class cut, minimum security middleware, explicit kill criteria, OSS-only as default productization path), and storage choice (SQLite gitignored). See §11 *Pivot log* for v0.2 → v0.3 deltas.

---

## 1. Problem & context

Agent fleets do not have a structured shared workspace built for them. The two existing fallbacks both fail differently:

- **Markdown files in a repo** lose structure under multi-stage workflows and concurrent agents.
- **Human PM tools (Linear, Asana, Notion, Jira)** force agents to reason about *both* the work and the workflow on every call, add network round-trips, and impose an account model that doesn't fit "agents working on local code."

Substrate offloads workflow into per-board declarative configuration, so the agent can focus on the work. It runs locally, next to the code, accessible to agents over MCP. (design doc, *Background*.)

**Why local-first.** The primary client is an agent already running on the user's machine (Claude Code or similar). Substrate sits next to the code, in the repo, version-controlled with the code.

**The specific paradigm bet** (sharpened in v0.3): the most-used policy class is expected to be `agent_responsibility` — soft suggestions returned in the response envelope that agents read and choose to act on. The pitch is "substrate hints at what to do next," not "substrate autonomously moves things." Autonomous state changes (`automation`) are deferred to v1.x unless dogfood demands them.

## 2. Users & JTBD

**Primary persona — the engineer with an agent fleet.** Technical user running one or more agents against a project they own. Comfortable with `npx`, a local web UI, and editing JSON files in their editor.

Secondary domains (PM, researcher) served by the same primitives as long as the user is technical enough to run a local server. **The "father organizing chores" and "movie director" personas are out of v1** — they need a desktop wrapper that doesn't ship in v1.

**Jobs-to-be-done:**

1. **"Give my agents a structured workspace they understand on their own."**
2. **"Get useful suggestions back from the substrate when I'm writing through it."** (Sharpened: this is the load-bearing JTBD in v0.3.)
3. **"Stop being the orchestrator."** Agents coordinate via shared substrate, not by being told what to do each turn.
4. **"Keep substrate in the repo, version-controlled with the code."** Diff policies across branches, roll back bad changes, merge new boards from PRs.
5. **"See who claimed to do what."** Agent-identity tags on every write. (Reframed from v0.2: not a hard "audit trail" — actors self-attest via free-form strings; useful for debugging, not forensic.)
6. **"Try this in under 5 minutes with zero infra."**

## 3. Goals / Non-goals

### Goals (v1)
- `npx substrate init` in a repo creates working substrate skeleton in under 30 seconds (after first-time package fetch).
- `npx substrate` starts MCP server + web UI in under 3 seconds.
- Engineer can author a minimal useful substrate (one board, three groups, two policies) by editing JSON in under 10 minutes.
- Agent can bootstrap (`whoami` → `get_board_substrate`) and reach a useful first write in one MCP session.
- Diego personally uses it on ≥2 real projects for ≥8 consecutive weeks.
- Repo public and OSS (MIT) from day one.

### Non-goals (v1) — *required, not optional*
- Not a hosted SaaS, not a service, not multi-user. One project, one user, one machine. Period.
- Not remotely accessible. Listens on localhost only.
- Not multi-tenant, multi-team, or multi-org.
- No authentication. No tokens. No access control beyond the security middleware in §6.10.
- No notifications. Agents poll.
- No agent runtime, no model hosting, no prompts stored.
- No human-team PM features (assignees, due dates, priorities as first-class). Use `custom_data`.
- No time-based / cron triggers. Query-on-cadence only.
- No cross-project sync.
- No `automation` policy class in v1 (deferred to v1.x).
- No `validation` policy class in v1 (deferred; mostly redundant with `field_schema.required` for v1).

## 4. Success metrics

| Metric | 3-month target | 12-month target |
|---|---|---|
| Diego active dogfooding (continuous weeks on ≥1 real project) | ≥ 8 weeks | ≥ 32 weeks |
| `npm install` count (cumulative) | ≥ 50 | ≥ 500 |
| GitHub stars | ≥ 25 | ≥ 250 |
| Distinct non-Diego humans confirmed using it (issues, discussions, DMs, in-person) | ≥ 3 | ≥ 15 |
| Real projects Diego has run on it | ≥ 2 | ≥ 5 |
| **% of writes engaging ≥1 `agent_responsibility` policy** *(Diego's projects)* | ≥ 20% | ≥ 35% |
| % of writes engaging ≥1 `transition_guard` *(hygiene check; just confirms guards fire)* | ≥ 30% | ≥ 50% |
| Median policies-per-board excluding `transition_guard` *(Diego's projects)* | ≥ 2 | ≥ 4 |
| Median time from `npx substrate init` → first successful agent write | ≤ 5 min | ≤ 2 min |
| Distinct policy patterns Diego has authored across all boards | ≥ 3 by week 8 | ≥ 10 by month 12 |
| Diego's productization decision made (OSS-only / OSS + sync / shelve) | — | decided |

**Load-bearing metric:** `agent_responsibility` engagement. Diego has flagged this as the class he expects to use most. If it greens, the paradigm bet pays off. If it stays low while transition_guard greens, Substrate is a worse Linear with extra JSON.

Engagement metrics are measured against Diego's own usage during dogfood — no telemetry from OSS users in v1 (deferred). Diego's projects are the canary.

**Note on measurement:** "distinct non-Diego humans confirmed" is qualitative. Without telemetry, "confirmed" = self-reports (GitHub issues showing real use, DMs, in-person, etc.). Treat as a binary gate, not a precise count.

## 5. User stories / core flows

**Flow A — Engineer initializes substrate.**
1. `cd ~/code/myapp && npx substrate init`
2. Creates `.substrate/` directory: `config.json`, `boards/`, `attachments/`, `data.sqlite` (gitignored by default).
3. Substrate writes a `.gitignore` entry for `data.sqlite*` and `attachments/` (engineer can override).
4. Optional: prompts for a starter board.
5. Engineer commits `.substrate/boards/` and `.substrate/config.json` to git.

**Flow B — Engineer runs substrate and connects an agent.**
1. `npx substrate` from repo root → server starts on `http://localhost:7475`. If 7475 is taken, refuse to start with a clear error.
2. Engineer adds Substrate as an MCP server in their agent config via stdio: `npx substrate mcp` (a separate command for the stdio MCP server, distinct from the HTTP UI server).
3. Agent connects via stdio, calls `whoami`, then `get_board_substrate`, then works.

**Flow C — Engineer authors substrate.**
Two paths:
1. **Editor:** open `.substrate/boards/<board_id>.json` in your editor, save. Substrate re-reads on next MCP call (no hot-reload; no file watcher).
2. **Setup agent:** ask a setup agent in your normal Claude Code session to make changes via MCP substrate-edit tools.

The web UI does *not* provide CRUD for substrate authoring in v1 — it's a read-only inspector. (Cut from v0.2 per pragmatic reviewer's recommendation.)

**Flow D — Engineer pulls a colleague's PR with substrate changes.**
1. `git pull` — substrate JSON files merge like any source.
2. `data.sqlite` is gitignored and stays per-machine. Runtime state diverges across machines; this is the v1 single-machine assumption.

**Flow E — Two engineers on one repo (documented explicitly).**
Each engineer has their own local `data.sqlite` (gitignored). Substrate JSON (rules) syncs via git. Tasks/comments/events created on engineer A's machine do *not* appear on engineer B's machine. If they want to share runtime state, use `substrate export` / `substrate import` explicitly. Multi-machine task sharing is not a v1 feature.

**Flow F — Agent operates across multiple projects.**
Agent config lists multiple Substrate MCP endpoints (one per project, each via `npx substrate mcp` in that project's directory). Each is its own world. No cross-project queries.

## 6. Functional requirements

### 6.1 Entities (v1)
- **Removed from design doc:** `User`, `Token`.
- **Implicit:** `Project` — auto-created on init, one per instance.
- **Kept:** `Board`, `Group`, `Task`, `Comment`, `TaskEvent`, `Policy`. Field shapes per design doc §*Entities*, minus user/token FKs. `actor_agent_name` on TaskEvent stays (free-form audit-tag string).

### 6.2 Persistence

```
.substrate/
  config.json                    # { project_id, project_name, schema_version }
  boards/
    <board_id>.json              # board metadata, groups[], field_schema, policies[]
                                 # filename uses stable board_id, not slug, to avoid rename hazard
  data.sqlite                    # gitignored by default
                                 # tasks, comments, task_events
                                 # schema_version stamped in pragma user_version
  attachments/                   # gitignored by default
    <task_id>/<filename>
```

**Gitignored by default:**
- `data.sqlite`, `data.sqlite-wal`, `data.sqlite-shm`
- `attachments/`

**Tracked in git by default:**
- `config.json`
- `boards/*.json`

Engineer can flip these by editing `.gitignore`. v1 ships safer defaults.

**Substrate JSON files are re-read on every MCP call.** No file watcher, no hot-reload, no cross-platform fragility. Reading 5–50 KB of JSON per call is cheap; profile later if it matters.

**Schema migrations** (SQLite): stamped in `PRAGMA user_version`. On `npx substrate` startup, refuse to open `data.sqlite` if file's `user_version` > binary's expected version. Migrations are forward-only, run inside a transaction, with automatic backup-before-migration to `.substrate/data.sqlite.bak-<timestamp>`.

### 6.3 MCP server
- **Transport: stdio only** in v1. Agent runtimes (Claude Code, etc.) spawn `npx substrate mcp` as a stdio child process.
- HTTP server runs the local web UI on `http://localhost:7475`. Not the MCP transport.
- This is **two server modes from one binary**: `npx substrate` (HTTP UI), `npx substrate mcp` (stdio MCP). Same in-process state via the substrate filesystem + SQLite.

  > [OPEN: do we run both modes from a single long-lived process, or as two short-lived processes that both touch the same `.substrate/`? Two processes is simpler conceptually but means SQLite contention is real. Lean: single process with both transports, spawn-on-demand for stdio MCP via IPC.]

- Port 7475 pinned. If taken, refuse to start with a clear error explaining what's running there.
- PID file at `.substrate/substrate.pid` to prevent second-instance.

### 6.4 Security middleware (v1)
Three layers, all in v1:
- **Origin/Host header allowlist** on HTTP endpoints. Accept requests where `Origin` is absent (curl, server-to-server) or matches `http://localhost:7475`/`http://127.0.0.1:7475`. Accept requests where `Host` is `localhost:7475` or `127.0.0.1:7475`. Reject otherwise with 403 + error envelope `{ code: "forbidden" }`. Defeats DNS rebinding and browser CSRF.
- **Attachment path canonicalization.** Any request that serves a file resolves the path absolutely and verifies it sits under `.substrate/attachments/`. Reject otherwise with 403 + `forbidden`.
- **Markdown sanitization** in UI rendering. All markdown bodies and descriptions piped through a sanitizer (DOMPurify, rehype-sanitize, or equivalent) with `<script>`, `on*` attrs, and `javascript:` URLs stripped.

No tokens, no per-install secrets in v1. (Deferred.)

**Error codes (v1):** `schema_violation`, `transition_blocked`, `version_mismatch`, `not_found`, `conflict`, **`forbidden`** *(added 2026-05-09 for Origin/Host and path-canonicalization rejections)*, `internal_error`. No `auth_denied` (no tokens in v1) and no `validation_failed` (no `validation` policy class in v1).

### 6.5 Read tools (v1)
- `whoami()` → project name, board summaries, easter-egg hint.
- `get_project()`
- `list_boards(filters?, pagination?)`
- `get_board_substrate(board_id)` → board + groups + field_schema + policies in one payload.
- `list_tasks(filters, sort?, pagination?)` — full filter set per design doc.
- `get_task(id)`
- `get_task_history(task_id, filters?, pagination?)`
- `list_comments(task_id, filters?, pagination?)`
- `get_comment(id)`

`list_projects` removed (always one project).

### 6.6 Write tools (v1, singletons only)
`create_task`, `update_task`, `archive_task`, `unarchive_task`, `add_comment`, `edit_comment`, `archive_comment`. All take mandatory `agent_name` string.

### 6.7 Substrate-edit tools (v1)
`create_board`, `update_board`, `archive_board`, `unarchive_board`, `create_group`, `update_group`, `reorder_groups`, `archive_group`, `create_policy`, `update_policy`, `archive_policy`, `update_project`. All take `agent_name`.

### 6.8 Policy classes (v1) — TWO ONLY
- **`transition_guard`** — block group changes that don't meet preconditions.
- **`agent_responsibility`** — return non-blocking suggestions in the response envelope.

**Cut from v1:**
- `automation` (deferred to v1.x or v2 — heaviest class; 2+ weeks of build for action executor, cascade semantics, 5 action types. Build when dogfood demands it).
- `validation` (deferred; conditional rules can use `transition_guard` or be lifted to `field_schema.required` in v1).

Policy reference semantics: `from_group` / `to_group` reference **group IDs**, not names. Robust to renames.

### 6.9 Operator set (v1, trimmed)
```
Existence:   exists, not_exists, is_empty, not_empty
Equality:    eq, neq
Sets:        in, not_in
Numeric:     gt, gte, lt, lte
String:      contains
```
Compound: `all_of`, `any_of`, `none_of`.

Other operators from the original design (`matches_regex`, `matches_any_keyword`, `starts_with`, `ends_with`, `has_any`, `has_all`) **cut from v1**. Add when a real policy demands one.

Field reference: dot notation with implicit `custom_data` nesting (`task.custom_data.priority`).

### 6.10 Schema validation
Lazy validation on touched fields against `field_schema`. Schema changes never reject existing data. `list_tasks(missing_required_fields: true)` available. (design doc §*Schema validation: lazy*.)

### 6.11 Concurrency
Optimistic concurrency on `version` int. Per-task version in SQLite. Per-board/group/policy version stored inside each JSON file, bumps on save. Substrate-edit writes use atomic write-temp-and-rename pattern with version CAS. `version_mismatch` does not return current version — forces re-read.

SQLite WAL mode handles concurrent agent writes natively.

### 6.12 Attachments
Folder at `.substrate/attachments/<task_id>/<filename>`. Referenced from `custom_data` or markdown bodies via relative path. Path canonicalized on serve (see §6.4). Gitignored by default. No size limits enforced.

### 6.13 Local web UI (v1, read-only)
Browser at `http://localhost:7475`. Read-only views only:
- Project overview: board list, board summaries.
- Per-board task list with filters.
- Per-task detail with comments and event history.
- Substrate inspector: rendered view of board + groups + field_schema + policies in one page.

**No authoring forms in v1.** Substrate is authored via editor + setup-agent only. Eliminates UI gravitational pull.

### 6.14 CLI surface (v1)
- `npx substrate init [--no-starter-board]`
- `npx substrate` (alias: `npx substrate serve`) — HTTP UI server.
- `npx substrate mcp` — stdio MCP server.
- `npx substrate backup [--out path]` — tarball `.substrate/`.
- `npx substrate export [--format json]` — text dump of all substrate + runtime state.
- `npx substrate import <path>` — restore from export.
- `npx substrate diagnose` — prints Node version, OS, port-conflict checks, schema version, file integrity, paths. (For OSS support.)

### 6.15 Easter egg
`reverse_captcha` MCP tool. `whoami` hints at it. (design doc §*Easter egg*.)

### 6.16 OSS artifacts (v1, ship before going public)
- **README** with: what Substrate is, quick start (3 commands), supported platforms (macOS + Linux primary; Windows/WSL best-effort, may have known issues with file paths and native deps), license, link to examples.
- **`ISSUE_TEMPLATE.md`** requiring: Node version, OS, `npx substrate diagnose` output, exact reproduction steps. Auto-close issues that fail the template (via GitHub Action).
- **`SUPPORT.md`** stating: solo project, weekly triage cadence, no SLAs, Windows/WSL best-effort.
- **`CONTRIBUTING.md`**: PRs welcome for bugs with repro; architecture-changing PRs declined by default; set tone before strangers PR.
- **`examples/`** directory with Diego's actual dogfood boards (sanitized) as reference substrate.

### 6.17 Cut from v1
- Batch write tools, `fork_task`, webhooks, vector search, telemetry.
- `automation` and `validation` policy classes.
- Substrate-authoring UI (read-only inspector only in v1; CRUD via editor or setup-agent).
- Hot-reload of substrate JSON (re-read per call instead).
- HTTP+SSE MCP transport (stdio only).
- Multi-user, multi-tenant, auth, tokens, sign-up — out forever in their original SaaS shape.

## 7. Technical constraints & dependencies

Stack locked 2026-05-09:

- **Runtime:** Node ≥ 20 LTS.
- **Language:** TypeScript.
- **Database:** SQLite via **`@libsql/client`** (native binding). Async API. Native deps accepted: ships prebuilds for mac arm64/x64, linux x64/arm64, windows x64; node-gyp fallback only triggers on exotic platforms. Same friction class as better-sqlite3 or sharp. *(Original v0.3 plan was libsql WASM for cleaner install; Phase 0 spike proved `@libsql/client-wasm` doesn't support `file:` URLs in Node — uses an experimental browser/edge SQLite-WASM. See spike result in decisions log.)*
- **MCP:** official `@modelcontextprotocol/sdk`, **stdio transport only** in v1.
- **HTTP framework:** **Hono** (small, anywhere-runtime, simple middleware).
- **UI framework:** **React 18 + TypeScript + Tailwind v4 + ShadCN**, built with **Vite**, routed with **TanStack Router**. Client-side rendered SPA. The published npm package ships pre-built static assets; end-users do not run Vite. *(Phase 1 dependency install pulled React 19.2.6, Vite 8.0.14, TypeScript 6.0.3 — newer than this section assumed. Not a problem for v1; documented in decisions.md.)*
- **Markdown rendering:** **`marked`** for parse → **`DOMPurify`** (`isomorphic-dompurify` for cross-env) for sanitize → React via `dangerouslySetInnerHTML`.
- **Process architecture:** independent processes. `npx substrate` runs the long-lived HTTP UI server; `npx substrate mcp` is spawned per-agent-session by the agent runtime via `.mcp.json`. All processes share state via SQLite WAL. User runs at most one command (`npx substrate`); the HTTP UI is optional for agent operation (agents work without it).
- **npm package name:** **`@diegoferreyra/substrate`** (scoped). Product name displayed everywhere is "Substrate." CLI binary is `substrate`.
- **GitHub repo:** `diegoferreyra/substrate` (public, day one).
- **License:** MIT.
- **Packaging:** npm package, runnable via `npx @diegoferreyra/substrate <command>`. Postinstall scripts kept minimal.
- **Capacity:** solo, 8–20 hrs/week, no ship date.
- **Infra costs:** zero.

## 8. Risks & open questions

### Riskiest assumption (Diego-flagged)
**"Query, don't subscribe" will not feel broken.** In the local model this is easier to live with — agents are right there, can wire their own cron if needed. Still the principle to watch.

### Other risks
- **R1: `agent_responsibility`-as-load-bearing is an untested bet.** v1 hinges on this class being useful. If it turns out agents ignore envelope suggestions, the v1 cut is wrong and we shipped a worse Linear.
- **R2: persona broad enough to fail.** "Technical user with an agent fleet" is wide. Some users will be Claude-Code-with-MCP; others will be custom Python orchestrators. v1 optimizes for the former; the latter may have a rougher edge.
- **R3: policy mental model heavy even at two classes.** If guards + responsibility don't get used, simplify in v1.x.
- **R4: `version_mismatch` UX with no `current_version`.** Naive agents may livelock. Watch for retry storms.
- **R5: SQLite native-dep install friction.** First OSS user on Windows or an exotic platform may file an `npm install` failure. Mitigation: documented in SUPPORT.md; revisit if frequent.
- **R6: Schema migration robustness.** Forward-only, transactional, with auto-backup — but the first breaking migration must be done with care.
- **R7: OSS support burden.** Solo dev + public repo. Triage cadence + issue template + SUPPORT.md are the mitigations.
- **R8 (structural, new): the dogfood may validate the wrong thing.** Adversarial reviewer's point: Substrate is infrastructure for an agent-fleet workflow Diego may not actually run daily. If Diego's actual working pattern is one agent on one project at a time, the 8-week dogfood tests Substrate against a workflow he doesn't have. The qualitative criterion in §9 partly catches this, but worth confronting before build: **do you actually run multiple concurrent agents on one repo, or are you building for a future workflow that hasn't materialized?**

### Open questions
- Primary dogfooding scenario for the 8-week window — AgentPost is the leading candidate; concrete substrate shape and policies for it to be sketched separately.
- TaskEvent retention (keep forever for v1; revisit at scale).
- NPM scope setup on Diego's account (`@diegoferreyra` org config, publish access, two-factor — operational, not architectural).

## 9. Rollout / phasing

### v1 — "paradigm test, OSS, local-first" (target: when it's done)

Scope: §6.1–6.16. One binary, two transports (HTTP UI + stdio MCP), two policy classes, public from day one.

**Pre-public checklist:**
- All §6.16 OSS artifacts in place.
- License chosen, repo name picked.
- Diego has been dogfooding for ≥2 weeks already (so README "I use this" claim is true).

**Dogfood plan:**
Diego runs Substrate on ≥2 real projects for ≥8 consecutive weeks. Maintains a **dogfood journal** logging:
- Specific moments where markdown/Linear would have failed
- Policies authored (new patterns, not just instances)
- Friction points
- Times he silently bailed back to markdown

### Paradigm-failure kill criteria (added v0.3)

If by week 8 of dogfood **any** of the following is true, the paradigm bet has not paid off:

1. **Diego stopped using Substrate on his primary dogfood project for ≥2 consecutive weeks** without external reason (vacation, paid-work crunch). Silent bail.
2. **Fewer than 3 distinct "markdown/Linear would have failed me here" moments** logged in the dogfood journal. Vague "felt nice" doesn't count.
3. **`agent_responsibility` engagement <15% of writes** across dogfood projects. Given the v1 bet is on this class being the most-used, missing the floor means the bet didn't pay.
4. **Fewer than 3 distinct policy patterns authored** across all dogfood boards (not instances — different shapes).

**If 1 or 2 fires:** paradigm failed. Stop adding features. Freeze v1 as-is; do not invest in `automation` or v1.x policy expansion.

**If 3 or 4 fires:** engagement failed even if paradigm sound. Reduce engine to what got used; do not pre-build for hypothetical patterns.

These are pre-commitments. The act of writing them down is the forcing function.

### v1.x — "polish, if v1 passes" (gated by kill criteria)
- Schema-migration tooling solidified.
- UI polish based on dogfood pain.
- **HTTP MCP transport** — motivated by the multi-worktree / concurrent-phases pattern. v1 supports it via the `cwd`-targeting trick in `.mcp.json` (all worktrees spawn `npx substrate mcp` with `cwd` pointed at the main worktree), but if that proves awkward during dogfood, HTTP MCP at `http://localhost:7475/mcp` removes the trick.
- `automation` policy class — *only if dogfood produced concrete demand*. Otherwise defer further.
- Operator-set additions — *only if dogfood produced a policy that couldn't be expressed*.
- Optional: opt-in telemetry for OSS users.
- Optional: `validation` policy class — *only if dogfood produced rules that didn't fit `transition_guard` or `field_schema.required`*.

### v2 — productization decision at ~12 months (~May 2027)

**The default outcome is OSS-only, indefinitely.** Substrate is a library in the agent-tooling ecosystem; Diego maintains it as a side project; users self-host because there's nothing to host *for* them. This is what 95% of similar OSS tools become, and it's a fine outcome.

Two off-default paths exist only if specific evidence appears:

- **OSS + paid hosted sync layer.** Pursue *only if* by month 12: ≥10 teams have demonstrably hacked their own multi-machine sync on top of Substrate, the sync semantics they need are non-trivial (not just `rsync`), and at least one team has expressed willingness to pay for a managed version. Absent all three: do not pursue.
- **Shelve.** Legitimate outcome if v1 kill criteria fired or usage signal at month 12 is below sustaining level. Archive the repo with a note explaining the experiment.

**v1 should optimize for the default (OSS-only).** Do not pre-build for the paid path.

## 10. Out of scope

- Hosted SaaS in v1 or v2 (unless paid-sync evidence appears).
- Multi-tenancy / orgs / teams.
- Multi-user.
- Authentication / tokens / sign-up / per-install secrets in v1.
- Remote access. Localhost only. v2 may ship docs for "expose at your own risk."
- Push / email / SMS notifications.
- Agent runtime / model hosting / prompt management.
- Code execution sandbox.
- Cross-project automation or sync.
- Time-based / cron triggers.
- Polished human PM UI. The UI is for inspection only.
- Mobile app, native desktop app, browser extension.
- Public network API. MCP only.
- SSO / enterprise auth.
- Compliance certifications.
- i18n. English only.
- Plugin marketplace.
- `automation` policy class in v1.
- `validation` policy class in v1.
- Substrate-authoring UI forms in v1.
- Hot-reload of substrate JSON in v1.
- HTTP+SSE MCP transport in v1.
- Batch write tools, `fork_task`, webhook actions.

## 11. Pivot log (v0.2 → v0.3)

| Area | v0.2 | v0.3 |
|---|---|---|
| Storage location in git | SQLite tracked by default | **`data.sqlite*` gitignored by default**, `boards/*.json` tracked |
| Policy classes in v1 | All four | **Two: `transition_guard` + `agent_responsibility`** |
| MCP transport | Stdio + HTTP+SSE | **Stdio only** |
| Web UI scope | CRUD for substrate authoring + read-only inspector | **Read-only inspector only** |
| Hot-reload of substrate JSON | Yes, file watcher | **No. Re-read on each MCP call** |
| Security middleware | "Localhost only, no auth" | **Origin/Host allowlist + path canonicalization + markdown sanitization** |
| Kill criteria | Implicit (in risks) | **Explicit, in §9, four conditions** |
| Productization path framing | Three v2 outcomes equally weighted | **OSS-only as default; paid sync only on specific evidence** |
| Board filename | `<board-slug>.json` | **`<board_id>.json`** (rename-safe) |
| Policy group references | Mixed | **Group IDs only, not names** |
| Operator set | Full design-doc set | **Trimmed: cuts `matches_regex`, `matches_any_keyword`, `starts_with`, `ends_with`, `has_any`, `has_all`** |
| OSS artifacts | "TBD" | **Explicit checklist in §6.16, required before public push** |
| Schema version guard | Implicit | **Explicit: refuse to open if file version > binary version; backup-before-migration** |
| MCP server lifecycle | Underspecified | **Pinned port 7475, refuse on conflict, PID file** |
| Two engineers on one repo | Hand-waved | **Explicit Flow E: state is per-machine, runtime diverges** |
| `whoami` / `agent_name` framing | "Audit trail" | **"Agent-identity-tag" — self-attested, not forensic** |

---

## Critique

Adversarial pass on v0.3. What's still risky after all the resolutions.

### Three weakest claims

1. **"≥20% of writes engage `agent_responsibility` by month 3" — the load-bearing metric.** Diego said he'll use this class most. That's a self-prediction, not data. He may discover during dogfood that writing useful `agent_responsibility` policies is harder than he thought (the `when` clause has to actually match something interesting), or that the agents he uses don't read the envelope suggestions, or that the suggestions feel like noise. Number is a guess. **Mitigation:** kill criterion 3 in §9 catches the worst case (<15%). The actual learning will be qualitative — what *shapes* of policies feel useful, not what percentage fire.

2. **"`automation` deferred until dogfood demands it" assumes Diego can recognize the demand cleanly.** Real failure mode: he hits a case where `automation` would help, mentally codes around it ("I'll just have the agent do that itself"), and never logs the demand. By week 8 he's reported no need for `automation` not because there wasn't one but because he routed around it. **Mitigation:** dogfood journal must include "moments where I worked around the missing class," not just "moments where the present features helped."

3. **"v1 ships with read-only UI; authoring via editor or setup-agent."** Sounds clean. The reality is going to be: Diego opens `.substrate/boards/<uuid>.json`, sees a wall of JSON with nested policy `definition`s, and either (a) writes a setup-agent prompt every time he wants to add a policy (slow but works), or (b) hand-edits, makes a typo in a `from_group` UUID, gets a confusing error from the engine at write time. The "JSON-only" authoring path is fine as a constraint, but its UX is worse than the PRD makes it sound. **Mitigation:** none in v1 by design. Watch for it in the journal; if it dominates the friction list, build minimum UI forms in v1.x.

### One thing missing that will bite us during build

**The single-process vs. two-process architecture for the two transports.** §6.3 flags this as `[OPEN]` but it's a load-bearing build decision, not a config detail. If single-process: long-lived HTTP server that *also* serves stdio MCP on demand — how does it spawn the stdio MCP for an agent client that just launched? Process-as-server is normally one-and-done; agent clients expect a fresh stdio child. If two-process: two SQLite connections to the same file, WAL handles it but writes can lock briefly. Each path has gotchas; neither is trivially correct. **Resolve this on day 1 of build, before any architecture decisions cascade from it.**

### One scope-creep risk

**`automation` is gone from v1 but its absence creates pressure on everything else.** The dogfood journal will contain entries like "if I had `set_field` I could auto-stamp this," "if I had `transition_task` as an action I could chain these guards." Each entry is a small reasonable request. By week 8 the journal might justify building `automation` — exactly as designed. The risk is that *the journal becomes a feature request list* and v1.x silently morphs back into v0.2 scope. **The kill criteria help (they force evaluating dogfood at week 8), but the discipline is: ship v1, evaluate against criteria, then decide whether v1.x adds `automation` — don't drift into it.**

### One contradiction / hand-wave

**§6.3 "stdio only" + Flow E "Agent operates across multiple projects with one endpoint per project."** Stdio MCP means the agent runtime spawns `npx substrate mcp` per project. For Claude Code, that's fine — `.mcp.json` can list N entries. For other agent runtimes that don't natively support multiple stdio MCP servers, this is degraded. The PRD says "MCP supports multiple servers natively in major agent runtimes" but that's about *agent capability*, not stdio multiplexing. **This is fine for Claude Code but the PRD's "primary client" should be named more honestly.** v1 is *Claude-Code-first*. Other clients are best-effort.

---

*End of v0.3.*
