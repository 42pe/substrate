# Interactive Web UI — making the board human-writable — Spec (umbrella)

**Status:** Draft for Diego's review
**Author:** Architect (synthesizing a server write-path map + a UI map)
**Date:** 2026-06-29
**Companions (per-phase plans):**
[Phase 12](../phase-12-interactive-write-foundation.md) ·
[Phase 13](../phase-13-task-authoring-comments.md) ·
[Phase 14](../phase-14-column-board-authoring.md)
**Supersedes the v1 non-goal:** v1-architecture §Phase 5 listed *"Authoring UI (no
CRUD forms for v1)"* as out of scope. This is the deliberate **v1.x** lift that
takes it on. The architecture doc's module rules are respected (see §6).

---

## 1. Problem & motivation

The web UI is a **read-only inspector** today (the footer literally says so). Every
mutation — moving a card, creating a task, leaving a comment, adding a column —
must be done by an agent over MCP, or by hand-editing JSON. A human watching the
board cannot *touch* it. That's a real gap: the human is the authority on a local
project, and the most natural way to nudge a board ("drag this to Done", "add a
quick task", "reply to the agent's comment") is closed to them.

This feature makes the board **interactive**: a human can modify it directly from
the browser. It is **local and single-user** — *no authentication* (per Diego),
consistent with the rest of v1's local-only stance.

## 2. The load-bearing finding (why this is tractable)

The write path is **already framework-neutral and reusable**:

- **Repositories** (`src/storage/repositories/*`) are `Executor`-aware pure
  functions — they take a `Client | Transaction`, never open their own tx
  (`createTask`/`updateTask`/`archiveTask` at `tasks.ts:88,157,227`;
  `appendEvent` at `events.ts:66`).
- **The policy engine** is pure I/O-free functions (`runTransitionGuards`,
  `runAgentResponsibilities` at `engine.ts:48,83`).
- **Envelope builders** (`core/envelope.ts:24`) and the **substrate writer's**
  closure pattern (`mutateBoardFile` at `writer.ts:120`, atomic temp→fsync→rename)
  are framework-agnostic.
- The transaction is owned by the **handler**, not the repo (`withTransaction`,
  `client.ts:99`) — policy-check + SQLite write + event emit all happen in one
  atomic closure (`update-task.ts:51–199` is the canonical shape).

The **only** thing coupled to MCP is the tool *wrappers* (zod parse + MCP
transport framing). So the clean design is to lift the orchestration **out of**
`src/mcp/tools/write/*` into a neutral **operations layer** that both `mcp` and
`http` call. No behavior change; existing MCP tests pin it.

## 3. Goals / non-goals

**Goals**
- A human can, from the browser, with no auth: **move** a card between columns
  (drag), **create / edit / archive** a task, **comment**, and **manage columns
  and boards** — each through the *same* policy-checked, event-logged, OCC-guarded
  write path agents use.
- Human edits are **first-class and attributed** — the activity feed distinguishes
  a human's move from an agent's.
- Policy stays in force: a `transition_guard` that would block an agent's move
  **also blocks a human's**, surfaced clearly (not silently bypassed).
- The browser write surface is **safe by default** for a no-auth local server
  (cross-origin drive-by writes are rejected).

**Non-goals**
- Authentication, users, roles, sharing, multi-tenant. Local single-user only.
- Real-time push (WebSocket/SSE). The existing 4s polling stays; mutations trigger
  an immediate refetch. (SSE is a possible later optimization, not in scope.)
- A visual **policy-DSL builder** (see §5, Phase 15 — deferred).
- Remote access / exposing the server beyond localhost.

## 4. Cross-cutting design decisions

These apply across all phases and are the heart of the spec.

**D1 — Human edits go through the policy engine (no silent bypass).**
A human move/edit calls the same operations layer, so `transition_guard`s evaluate
and can **block** it. Rationale: single source of truth, the human authored the
guard, and the board must never end up violating its own rules through the UI.
The UI surfaces a `transition_blocked` with the guard's `on_failure_message` and
**reverts** the optimistic move. `agent_responsibility` suggestions surface as a
non-blocking toast. The existing escape hatch is unchanged: hand-editing the board
JSON bypasses policy (policies only run on writes-through-operations). **No
"override" button in this scope** — revisit only if dogfood shows the human is
fighting their own guards.

**D2 — Human identity is stamped server-side.**
Writes require `agent_name` (`update-task.ts:45`). The HTTP write layer **injects**
it — the browser never sends it — as `human:<os-username>` (from
`os.userInfo().username`), overridable via a new `config.json` field
`ui_actor_name`. The `human:` prefix lets the activity feed / badges distinguish
human vs agent edits. Stamping server-side avoids client spoofing and keeps the
audit honest.

**D3 — CSRF/origin hardening for a no-auth local server.**
Keep the existing Origin/Host allowlist (`origin-allowlist.ts:29`, runs on `*`).
For **state-changing methods** (POST/PATCH/DELETE) add a write-guard requiring
**both**: (a) `Sec-Fetch-Site: same-origin` (or `none`) when the header is present
(modern browsers send it; blocks cross-site), and (b) a custom request header the
UI client always sets (e.g. `X-Substrate-Client: ui`) — a cross-origin page cannot
set a custom header without a CORS preflight, which the origin allowlist denies.
Belt-and-suspenders, **no tokens, no login**. Threat note: a malicious *local
native* process could still satisfy these — but it can already write the
SQLite/JSON files directly, so the threat model is not meaningfully widened.
Documented in SECURITY.md/SUPPORT.md on ship.

**D4 — Concurrency: optimistic UI + OCC + reconcile.**
Tasks carry a `version`; the move/edit sends it and the server does a CAS
(`tasks.ts:196`, `WHERE id=? AND version=?`). On `version_mismatch` (no
`current_version` returned, by design) the UI **refetches** the column/task and
reverts/replays, with a "changed underneath you — re-applied" toast. The 4s poll
already updates in place; a mutation forces an immediate refetch so the human and
any concurrent agent converge fast.

**D5 — Drag-and-drop via `@dnd-kit`.**
No DnD lib exists. Choose **@dnd-kit** (tree-shakeable, accessible — keyboard
sensors out of the box, React 19 compatible) over `@hello-pangea/dnd` (heavier,
RBD-lineage, shakier React 19 story). Every drag has a **keyboard/menu-accessible
equivalent** ("Move to…" on the card) so interactivity isn't mouse-only.

**D6 — Forms: minimal vendored primitives, no form lib (yet).**
No form lib today; the surface is small. Vendor a few ShadCN primitives (`Button`,
`Input`, `Textarea`, `Label`, `Select`, `Dialog`, `Toast`) and hand-roll
controlled forms. Revisit `react-hook-form` only if Phase 13/14 forms grow
unwieldy.

**D7 — Optimistic for moves, pending-state for forms.**
Drag is optimistic (snappy, revert on failure). Create/edit/comment await the
response with a pending state, then refetch — simpler and forms can show errors
inline.

**D8 — `field_schema`-driven task editing (server is source of truth).**
The task-edit form renders inputs from the board's `field_schema` (required marks,
enums → selects, types → input kinds). The server still validates and may return
`schema_violation`, surfaced on the field.

**D9 — Substrate-as-code edits change git-tracked files.**
Column/board edits write `boards/*.json` (committed), not just SQLite. The UI must
make clear these are *source* edits (a subtle "this changes a tracked file" cue),
so the human knows to commit. Task/comment edits hit SQLite (gitignored) — no such
cue needed.

## 5. Phasing

Split into three build phases + one deferred, smallest-blast-radius first:

| Phase | Title | Headline | Surface |
|---|---|---|---|
| **12** | Interactive write **foundation** + task moves | "The board comes alive" | operations-layer extraction, HTTP write transport, CSRF guard, UI mutation layer, **drag-to-move**, task create/edit/archive |
| **13** | Task **authoring** + comments | "Full task editing & the conversation" | `field_schema`-driven custom-data editing, add/edit/archive comments, actionable missing-required badge |
| **14** | **Column & board** authoring | "Manage the board's structure" | group create/rename/recolor/reorder/archive, board create/rename/archive, project rename (substrate-as-code) |
| **15** *(deferred / stretch)* | **Policy & field_schema** authoring | "Edit the rules from the UI" | GUI for the policy DSL + field_schema. **Recommended deferred** — keep policies agent-authored / hand-edited; the DSL is a large GUI design space and the recent validation + `substrate_corrupt` recovery already make code-editing safe. |

Phase 12 is the foundation: it builds the *transport and patterns* (ops layer,
`apiPost/apiPatch`, `useMutation`, toasts, CSRF guard, dnd) that 13 and 14 reuse,
so they get progressively lighter. Each phase still passes through the repo's
Stage-1 spec gate before its build (this umbrella spec seeds them).

## 6. Architecture / module-boundary impact

- **New module `src/operations/`** — framework-neutral write orchestration
  (one function per write op, returning `SuccessEnvelope | ErrorEnvelope`).
  Depends on `core, storage, substrate, policy, shared`. **Both `mcp` and `http`
  depend on `operations`; they still do not depend on each other** (v1-arch §4
  preserved, `import/no-cycle` holds). MCP write tools become thin zod-parse +
  call-op + format adapters; their behavior and tests are unchanged.
- **HTTP gains a write surface** — this is the one deliberate reversal of the
  "HTTP exposes reads only" stance (PRD §6.13). Documented as a v1.x decision in
  `decisions.md`; PRD/architecture annotated.
- **Security middleware gains a write-guard** (D3) layered on the origin allowlist.

## 7. Security summary (the part that earns scrutiny)

- Origin/Host allowlist (existing) + Sec-Fetch-Site + custom-header on writes (D3).
- Server-stamped actor (D2) — no client-supplied identity to spoof.
- Policy stays enforced on human writes (D1).
- All input re-validated server-side with the same zod schemas the MCP tools use;
  `schema_violation`/`transition_blocked`/`version_mismatch` surface as today.
- Markdown stays on the single sanitize path (`markdown.ts`) for any rendered
  user/agent text; the **edit** affordances are plain text/markdown-source inputs,
  rendered only through that path.
- No new network exposure; localhost binding unchanged.

## 8. Test strategy (across phases)

- **Operations layer:** the existing MCP write tests move/duplicate to target the
  ops functions directly (behavior pinned during extraction).
- **HTTP write integration:** spawn `serve`, POST/PATCH each route, assert envelope
  + DB/JSON state + emitted event + actor stamping.
- **CSRF middleware unit tests:** cross-origin POST → 403; missing custom header →
  403; same-origin + header → pass; GET unaffected.
- **Policy-on-human-write:** a board with a `transition_guard`; an HTTP move that
  violates it returns `transition_blocked` and writes nothing.
- **OCC:** stale-version HTTP move returns `version_mismatch`.
- **One Playwright interaction test** per phase (12: drag a card → persisted +
  event; 13: add a comment; 14: add a column) — extends the single existing smoke,
  staying within the "smoke, not full e2e" budget.

## 9. Open questions for Diego

1. **Sequencing vs. Phase 10 launch.** Ship the read-only inspector as v1 first and
   add interactivity as **v1.1** (clean story, smaller launch), or fold Phase 12
   into pre-launch? *Recommendation: launch read-only, then v1.1 interactive.*
2. **Actor naming.** `human:<os-username>` default with `config.json:ui_actor_name`
   override — good? Or a one-time "who are you?" prompt stored in localStorage?
3. **Policy authoring (Phase 15).** Confirm deferring the GUI policy editor and
   keeping policies agent-authored / hand-edited for now.
4. **DnD dep.** OK to add `@dnd-kit` (one well-maintained dependency) to the UI?
