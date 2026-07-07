# Shared-DB across worktrees/teams — Architecture exploration

**Status:** EXPLORATION doc for a "discuss later" decision — **not** an approved spec or a build plan
**Author:** Architect (synthesizing 5 option analyses: software · reliability · DX · security lenses)
**Date:** 2026-07-07 · **Updated 2026-07-07** to fold in Diego's **pointer/registry** decision (now the recommended near-term fix) + the **cause-aware missing-DB diagnostic**
**Grounds in:** actual code (cited `file:line`) · dogfood `.agents/dogfood/journal.md:49-66` (worktree footgun, verified in code) + `rollup.md:141-152` (concurrency demand shown) · `prd.md` §3/§6.2/§6.3/§6.11/§7/§9/§340 · `decisions.md:12,35`
**Scope discipline:** This is the **PRD §340 v1.x path**, gated on dogfood demand — which is **now shown** (3 concurrent sessions on one project, `journal.md:49`). It does **not** re-open PRD non-goals (no hosted SaaS, no auth in v1). It picks ONE recommendation with a phased path and leaves the deeper lift as an open question for Diego.
**CI note:** GitHub Actions is billing-blocked (phase-12 plan §2). Every acceptance bar below says **"validate locally"** (`pnpm test`, `test:smoke:concurrency`, manual two-worktree repro).

---

## 1. Problem statement (grounded in the actual code)

The worktree footgun is **verified in code**, not speculation (`journal.md:49-66`):

- Task **state** (status, version, custom_data, comments, events) lives in `.substrate/data.sqlite`, which is **gitignored** (`init.ts` gitignores `data.sqlite*`). Only board **structure** — `config.json` + `boards/*.json` — is committed.
- The DB root is resolved **purely from cwd**: `substrateRootFromCwd(cwd) = join(cwd, '.substrate')` (`src/shared/paths.ts:41-43`); `paths(root).dataSqlite = join(root, 'data.sqlite')`.
- `mcpCommand` refuses **only** if `.substrate/` is missing — `existsSync(root)` (`src/cli/commands/mcp.ts:32-35`). A `git worktree add` copies the committed `.substrate/boards/` + `config.json`, so the dir **exists**, the guard **passes**, and **no "run init" error fires**.
- Then `openClient` opens `file:${dbPath}` and **libsql creates the file on open** — "libsql's `file:` URL will create the file if missing" (`src/storage/client.ts:25`, code at `:36-40`). `openDatabaseAndMigrate` `mkdir`s the parent and migrates a fresh empty file with **no "should this be empty?" check** (`client.ts:62-67`).

⇒ **Every worktree silently gets its own fresh empty `data.sqlite`, sees none of the others' moves, with no warning.** This is the PRD §9 "board diverges from reality" kill-criterion — the failure mode to "watch hardest" — materialized structurally by concurrency.

**Today's only fix** (`journal.md:60-61`): the **cwd-targeting trick** — point every worktree's `substrate mcp` at the *one main* `.substrate/` via `.mcp.json` `cwd`. It works (WAL + `busy_timeout=5000` make concurrent multi-process access safe — `client.ts:38,65`; proven by `test:smoke:concurrency`, 4 procs / 0 errors, `decisions.md:31`), but it's a manual per-worktree edit a fresh `git worktree add` silently drops. PRD §340 pre-registered this exact pain and its escalation path.

**Two state stores, only one is broken.** `boards/*.json` (structure) is *already* shared via git — that's the boards-as-code invariant. Only the **SQLite** half diverges. Any option must be judged on the SQLite half, and must not accidentally create a *new* split-brain between centralized state and per-worktree JSON (see §5, R1).

---

## 2. Options considered

Five shapes were analyzed in depth; a **sixth — pointer/registry root-resolution (Diego, 2026-07-07)** — is folded in here. They group into four families:

- **Pointer/registry (recommended near-term — §4 Phase B)** — teach `substrateRootFromCwd` (`paths.ts:41`) to resolve the root as *env `SUBSTRATE_ROOT` → `.substrate/link` file → global registry keyed by `git rev-parse --git-common-dir` (identical across every worktree → auto, zero per-worktree setup) → else `cwd/.substrate`*, pointing at the whole shared **root** (not just the DB). Automates today's cwd-trick and removes its fragility; keeps the **N-stdio-process / one-WAL-file** model the Phase-0 spike proved safe. **No server, no socket, no new process, stays local-first.** Single hook + a small registry read/write + a `substrate link` command.
- **HTTP MCP transport** — one long-lived `substrate serve` owns the one DB; worktrees connect to `http://127.0.0.1:7475/mcp` instead of spawning cwd-scoped stdio children. Reuses the transport-agnostic `buildServer(deps)` (`src/mcp/server.ts:12-41`) + the existing Hono server (`serve.ts:38-175`). **No new dependency** — `@modelcontextprotocol/sdk@1.29.0` already ships the Web-standard streamable-HTTP transport that mounts natively into Hono.
- **libsql server (`sqld`/`turso dev`)** — a localhost DB daemon owns the file; the *client* switches `file:` → `http://127.0.0.1:<port>`. The pinned `@libsql/client` already speaks this (scheme dispatch, `node_modules/@libsql/client/lib-esm/node.js:14-18`), so it's a URL branch, not a rewrite.
- **Heavier hosts — Docker / bespoke desktop-daemon** — a container or a new OS-integrated service wrapping one of the above. Both add an install/lifecycle/maintenance layer with no benefit a plain localhost server doesn't already give a single-user local tool.

Plus two lightweight adjuncts that are **transport-independent and should ship regardless**: the **empty-DB guard** (warn when `boards/*.json` exist but `data.sqlite` was just created empty — `journal.md:64`) and **atomic task-claiming/assignee** (the *duplicated-work* gap OCC doesn't cover — `journal.md:65`, `rollup.md:145`).

---

## 3. Comparison table

| Criterion | cwd-trick (today) | **HTTP MCP transport** | libsql server (`sqld`) | Docker | Bespoke daemon |
|---|---|---|---|---|---|
| **Cross-worktree sharing** | ✅ works, manual & fragile | ✅ solved cleanly (static URL, cwd-independent) | ✅ solved (one file, one owner) | ✅ solved | ✅ solved |
| **Concurrency (WAL/OCC)** | ✅ WAL-safe; N-process contention | ✅ **safer**: N procs → 1 writer; dodges Windows multi-proc libsql crash (`decisions.md:12`) | ✅ **safer**: collapses to 1 writer likewise | ✅ 1 writer | ✅ 1 writer |
| **Setup / npm friction** | 🟡 per-worktree `.mcp.json` edit | 🟡 static URL + "start `serve` first" precondition | ❌ 2nd binary/prereq; native-prebuild matrix pain | ❌ Docker Desktop prereq (multi-GB, install cliff) | ❌ launchd/systemd/Win-service ×3 |
| **Local-first / offline** | ✅ file-next-to-code | ✅ `127.0.0.1` only; fully preserved | ✅ localhost; but state can move out of tree | 🟡 service-not-file; mental-model shift | 🟡 service-not-file |
| **Security (localhost, no auth)** | ✅ stdio = no socket | 🟡 exposes **write** surface on a socket; needs Phase-13 D3 write-guard | 🟡 raw DB port; **not** behind Hono allowlist; bind loopback + local token | ⚠️ easy `0.0.0.0` publish footgun | 🟡 prefer UDS to remove browser reach |
| **Packaging / solo maint.** | ✅ zero new surface | 🟡 low; collapses toward **one** process (UI+read+MCP) | ❌ 2nd long-lived proc to version/support | ❌ Dockerfile, base-image CVEs, multi-arch, registry | ❌ **dealbreaker**: 3 service managers + version-skew |
| **Migration from stdio+cwd** | — (is the baseline) | ✅ **additive**, reversible; stdio stays default | ✅ additive behind a `db_url` flag | ⚠️ superset of HTTP-MCP work + container | ⚠️ additive but re-opens `decisions.md:35` |
| **New code delta** | none | small (1 route on existing server) | small (1 URL branch in `openClient`) | large (build HTTP-MCP *then* wrap it) | large (new lifecycle subsystem) |

**Reading of the table:** Docker and a bespoke daemon are **dominated** — they pay install + maintenance + local-first cost for sharing that HTTP-MCP or `sqld` already deliver on `127.0.0.1`. Docker's classic wins (env isolation, multi-host orchestration) are irrelevant to one user on one laptop who already has Node; a bespoke daemon re-opens a decision already made against it (`decisions.md:35`: "single long-lived process with IPC … adds lifecycle management, error paths, and a class of bugs not justified"). That leaves **HTTP MCP** vs **`sqld`** as the live choice.

---

## 4. RECOMMENDATION

**Phased, lightest-first. A: make the missing DB loud + cause-aware. B: a pointer/registry so all worktrees auto-resolve ONE shared root (Diego's direction — the lightest real fix). C: HTTP MCP transport, only if/when you outgrow single-machine-many-processes.**

### Phase A (now) — make the missing DB loud and *cause-aware*
Everything derives from one hook — `substrateRootFromCwd` (`paths.ts:41`) — and today `mcp.ts:32-35` refuses only when `.substrate/` is missing while `client.ts:36-40` silently creates the file. Replace the silent create with a **cause-aware diagnostic** (two distinct situations, two messages):
- **Broken explicit pointer** — an env/link/registry entry (Phase B) resolves to a path that no longer exists ⇒ **ERROR, do NOT create a fresh DB**: *"Substrate root `<path>` (from `<SUBSTRATE_ROOT | .substrate/link | registry key>`) not found. Did you move or rename this project? Re-point with `substrate link <path>`."*
- **Fresh worktree/clone** — committed `boards/*.json` present, `data.sqlite` just created empty, no pointer ⇒ **WARN, proceed**: *"boards present but no task DB — a fresh empty one was created; if this is a git worktree/clone its task state isn't shared — run `substrate link <main>/.substrate`."*
- Surface the **resolved root + how it was resolved** (env / link / registry / cwd) in `substrate diagnose`, so "where is my DB actually coming from?" is answerable on demand.

Small, transport-independent, and it kills the *dangerous* part (the silence) regardless of any later decision. (Folds together the original empty-DB guard, `journal.md:64`, with Diego's move-detection refinement.)

### Phase B (near-term, the real fix — lightest) — pointer/registry root-resolution
Make `root` resolve in order: **env `SUBSTRATE_ROOT` → `.substrate/link` file → global registry (`~/.substrate/roots.json`) keyed by `git rev-parse --git-common-dir` (identical across all worktrees → auto, zero per-worktree setup) → else `cwd/.substrate`**. A `substrate link <path>` / `use` command registers or repoints. This **automates the cwd-trick and removes its fragility** — a new `git worktree add` auto-resolves the shared root via the git-common-dir key, nothing to hand-edit — while keeping the **N-stdio-process + one-WAL-file** model the Phase-0 spike already proved safe (4 procs / 0 errors).

**Point at the whole `.substrate/` *root*, not just `data.sqlite` — this resolves R1 (split-brain):** boards, config, and DB all come from the one canonical root, so per-worktree branch divergence of `boards/*.json` is moot at runtime (trade: board-as-code edits happen in the canonical checkout). **One code hook (`paths.ts`), a small registry, one CLI command. No server, no socket, no new process, no lifecycle dependency, fully local-first.** Sharp edge: absolute paths are machine-local — moving/renaming the canonical checkout needs a re-`link` (caught loudly by Phase A's broken-pointer error).

### Phase C (v1.x, only if you outgrow one machine) — HTTP MCP transport
Add `substrate serve --mcp` mounting `/mcp` on the existing Hono app (transport-neutral `buildServer(deps)`, `server.ts:12-41`) so every worktree connects to a static `http://127.0.0.1:7475/mcp`. **Reserve this for when the pointer/registry model is insufficient:** cross-**machine** teams; a **single coordination point** (needed for atomic task-claiming — the *duplicated-work* gap OCC can't close with N independent writers); or to **collapse N writers → 1** and dodge the Windows multi-proc libsql crash (`decisions.md:12`). Opt-in, additive; stdio stays default. It carries the lifecycle (R2), socket-write-surface (R4 → reuse Phase-13 D3 guard) and request-serialization (R3) costs that the pointer/registry avoids. `sqld` is the alternative here if the "start `serve` first" precondition proves annoying — smaller code delta, larger operational cost.

**Why pointer/registry before HTTP-MCP:** both solve worktree sharing, but the pointer/registry is a *single resolution hook* with **no running-server precondition, no socket, no new process** — it just teaches the existing stdio model to find the one shared root, and it shares the *root* (resolving R1) rather than only the DB. It's strictly lighter for the single-machine case (Diego's case today). HTTP-MCP earns its extra lifecycle/security surface only when you need a single writer/coordinator or go cross-machine.

**Verdict on the heavier options: do NOT build Docker or a bespoke daemon** for v1 or v1.x. They're dominated (§3) and erode the local-first `npx`-and-go identity that is the product's wedge (PRD §17-21).

---

## 5. What it would take (Phase B, HTTP-MCP) + risks

**The lift is small because the code is already transport-neutral:**
- `buildServer(deps)` registers every tool and is *already* split from `startStdioServer` (`src/mcp/server.ts:12-41`) — adding `startHttpMcp(deps)` is a sibling, **zero tool rewrites**.
- `serve` already opens the DB once, PID-guards single-instance, binds `127.0.0.1:7475`, and handles SIGINT/SIGTERM (`serve.ts:38-175`) — `/mcp` mounts on the same `createApp` (`src/http/server.ts:51`), sharing the one `client`.
- `ToolDeps { client, config, loadSubstrate, root }` (`src/mcp/deps.ts:16-23`) is built once from the **server's** root — fixed, cwd-independent. That is precisely what kills the footgun.
- OCC is transport-independent: version-CAS `UPDATE … WHERE id=? AND version=?` (`tasks.ts:196`), `version_mismatch` re-read (`tasks.ts:171,200`), inside handler-owned `withTransaction` (`client.ts:99`).

**Acceptance bar (all validate-locally, CI billing-blocked):** a smoke test that spawns `serve --mcp`, connects an HTTP MCP client from **two simulated worktrees**, and asserts both see the same task after one writes; plus a **concurrent-POST serialization test** (see R3).

### Risks (single biggest, named)
- **R1 — Split-brain (structure vs state).** Sharing SQLite but **not** `boards/*.json` means two worktrees on different branches can share one task table while their *local* checked-out JSON defines **different** groups/policies/field_schema. The policy engine reads the **local** JSON via `loadSubstrate`, so the *same* task write could be evaluated against *different rules* depending on which worktree issued it — a new instance of the very "board diverges" class (rollup B2). **Any spec must decide:** is the shared surface **explicitly task-state-only**, with an enforced invariant that all worktrees run the *same committed* board revision? Until answered, "single shared DB" is only half a shared substrate. **Resolution (Diego, 07-07):** the **pointer/registry (Phase B) sidesteps R1 by sharing the whole *root*** — boards + config + DB from one canonical location — so per-worktree JSON divergence is moot at runtime (trade: board edits happen in the canonical checkout). The "task-state-only + same-committed-revision invariant" applies **only** to the HTTP-MCP path (Phase C) *if* structure is left per-worktree; pointing at the root is the cleaner answer and the recommended one.
- **R2 — Lifecycle: "server must be running" replaces "N self-healing children."** If `serve` isn't up (crash, port conflict — it refuses on a live PID/busy port, `serve.ts:100`), **every** worktree fails to connect. Diego's autonomous 4am StackChan pipeline (`rollup.md:141`) makes this acute. **Mitigation is first-class, not an afterthought:** a crisp, actionable "no Substrate server on 7475 — run `substrate serve`" error (matching the actionable-error investment dogfood praised, `rollup.md:149`), a documented supervisor pattern, and keeping stdio+cwd as the down-server fallback. A *vague* connection error would trade a silent footgun for a confusing one.
- **R3 — Concurrent `handleRequest` on one client.** The streamable transport lets requests arrive concurrently on the single `client`; `withTransaction` is atomic per call, but two overlapping requests could interleave `execute` outside a transaction. **Must land a serialized-write test / async-write-queue** — verified locally, not assumed.
- **R4 — Write surface on a socket.** HTTP-MCP puts mutating tools behind a listening port. Reuse Phase 13's **D3 write-guard** — `Sec-Fetch-Site: same-origin|none` + a custom `X-Substrate-Client` header on state-changing requests (`interactive-ui-spec.md` §D3) — not just the read-only Origin allowlist. No tokens, no login (PRD §6.4). The *local-attacker* surface isn't meaningfully widened (a local process can already write the files directly); the genuinely new exposure is **cross-origin browser drive-by writes**, which D3 closes.

---

## 6. Open questions for Diego

1. **Scope of "shared."** Task-state-only (accept R1 with a documented "all worktrees on the same committed board revision" invariant), or eventually centralize structure too (a much bigger lift — JSON stops being per-worktree working copies)?
2. **Priority vs. the silent-correctness bugs.** Dogfood ranks silent data-integrity bugs (B1 list_tasks filter, B2 cross-board group_id, B3 honor-system gate — `rollup.md:97-102`) above this: they bite the *single-worktree* happy path everyone hits, whereas the footgun has a documented workaround. Does the shared-DB lift wait behind those?
3. **Is the "start `serve` first" precondition acceptable** for the autonomous pipeline, or does that push toward `sqld` (no ordering — agents just open a URL) despite its extra binary/maintenance cost?
4. **Ship the two adjuncts now regardless?** The empty-DB guard (Phase A) and atomic task-claiming/assignee (the *duplicated-work* gap, `journal.md:65`) are transport-independent and separately demanded — do they proceed on their own track ahead of the transport decision?
5. **`sqld` as a documented fallback** — worth writing down now, or defer entirely until/unless HTTP-MCP's lifecycle proves awkward in dogfood?

---

**Key file:line references**
- Footgun root cause: `src/cli/commands/mcp.ts:32-35` · `src/storage/client.ts:25,36-40,62-67` · `src/shared/paths.ts:41-43`
- Transport reuse: `src/mcp/server.ts:12-41` · `src/mcp/deps.ts:16-23` · `src/cli/commands/serve.ts:38-175` · `src/http/server.ts:51`
- Concurrency/OCC: `src/storage/client.ts:38,65,99` · `src/storage/repositories/tasks.ts:171,196,200` · `test:smoke:concurrency` · `decisions.md:12,31`
- `sqld` feasibility: `node_modules/@libsql/client/lib-esm/node.js:14-18`
- Security to reuse: `src/http/middleware/origin-allowlist.ts` · `interactive-ui-spec.md` §D3
- Rejected-IPC precedent: `decisions.md:35`
- Evidence & scope: `.agents/dogfood/journal.md:49-66` · `.agents/dogfood/rollup.md:141-152` · `prd.md` §3/§9/§340
