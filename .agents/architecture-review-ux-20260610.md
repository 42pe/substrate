# Architecture review — the UX it yields for humans and agents — 2026-06-10

**Reviewer:** external architecture pass (Claude, requested by Diego). Companion to
[product-review-docs-20260609.md](product-review-docs-20260609.md).
**Scope reviewed:** src/mcp/ (tools, wrapper, registry), src/policy/, src/substrate/
(loader, writer, validator, field-validator, schemas), src/storage/, src/core/
(envelope, errors, pagination, types), src/cli/, src/http/, src/shared/, src/explain/,
ui/src/. Bug-level claims verified directly in code.
**Question asked:** does the architecture serve the UX the product promises — agents
that follow process without holding it in memory, humans that gain visibility?

**Verdict:** the foundations are disciplined and don't need rework. What needs
addressing: the architecture is *quiet* in exactly the places the product needs to be
*loud* — policy authoring, policy activity, and substrate corruption. Five themes
below, in priority order. Themes 1–3 are pre-dogfood material: they change what the
dogfood can even measure.

## What's solid (don't touch)

- Read-only UI is enforced structurally: `ApiDeps` (src/http/routes/api/index.ts)
  excludes the write root, so HTTP handlers *cannot* reach writer code. Zero write
  endpoints exist.
- Writes are atomic temp-write-and-rename with version CAS (src/substrate/writer.ts);
  the event log is append-only and transactional with every write.
- Error envelopes are structured with actionable messages; Zod input errors tell the
  agent exactly what to fix.
- The UI is honest about freshness: live/reconnecting/paused indicator + "updated Ns
  ago" (ui/src/components/LiveIndicator.tsx, usePolling.ts, ~4s poll, pauses on
  hidden tab, keeps last-good data on failure).
- Substrate-as-code re-read per call works as designed; the HTTP server picks up
  hand-edits per request.
- `substrate diagnose` / `substrate logs` (0.4.0) give a real support path; agent
  names are sanitized before logging.

---

## Theme 1 — The policy system fails silently, and policy activity is never recorded (HIGHEST PRIORITY)

Policies are the product's whole differentiation. Three gaps compound:

### 1a. `create_policy` accepts any `definition` unvalidated

- `definition: z.record(z.string(), z.unknown())`, stored as-is. The code comment
  says it outright: "the Phase 3 engine tolerates malformed definitions"
  (src/mcp/tools/write/create-policy.ts:17–19, verified). Same for `update_policy`.
- A guard with a typo'd `from_group` or a non-string `message` loads fine and
  **never engages**: `parseGuardDefinition` / `parseResponsibilityDefinition` return
  `null` on malformed input and the engine silently skips
  (src/policy/transition-guard.ts:26–29, src/policy/agent-responsibility.ts:20–24,
  src/policy/engine.ts:57–59, 91–95). Same hole on load: PolicySchema in
  src/substrate/schemas.ts:41 doesn't validate `definition`.
- AUTHORING.md §5's probe-task ritual is documentation compensating for an
  architecture hole.
- **Fix:** the definition shapes are known discriminated unions (GuardDef,
  ResponsibilityDef). Validate them with a zod discriminated union at
  `create_policy`/`update_policy` time AND on load (warn, see Theme 3). Reject with
  `schema_violation` naming the bad key. This is the single highest-leverage change
  in the codebase.

### 1b. The policy DSL is invisible to an agent without the skill

- The MCP `tools/list` schema shows only `Record<string, unknown>`; the DSL lives
  exclusively in skills/substrate/AUTHORING.md. Likewise `field_schema` comes back
  raw from `get_board_substrate` with no shape documentation.
- **Fix:** embed the definition shape (or one compact example per policy type) in the
  `create_policy`/`update_policy` tool descriptions, and document the
  FieldSchemaEntry shape in `get_board_substrate`'s description. The MCP surface
  should be self-sufficient without the skill.

### 1c. Policy activity is completely ephemeral — nothing is recorded, nowhere

- When a guard **blocks** a move, the error goes to the agent once and vanishes. No
  `move_blocked` event type exists (src/core/types.ts TaskEventType); nothing in task
  history; nothing in the UI. The human watching the kanban cannot see enforcement
  working — the product's core value is invisible to its visibility surface.
- When policies **fire** on a successful write, `policies_fired` exists only in the
  MCP envelope; it is not persisted and the HTTP API never exposes it. Suggestions
  are visible only inside the agent's context.
- **Consequence for the PRD: kill criterion 3 is currently unmeasurable.** "% of
  writes engaging ≥1 `agent_responsibility`" cannot be computed at week 8 because
  engagements are not stored anywhere. This instrumentation must exist **before**
  the dogfood starts or the dogfood can't be evaluated.
- **Fix:** record policy activity in the event log — a `move_blocked` event
  (with `policy_id`, `from_group`, `to_group`, failing fields) and persist
  `policies_fired` on write events (or a counter table). This one change fixes the
  silent-failure visibility gap, makes the kill-criterion metric computable, and
  feeds the activity feed (Theme 4).

## Theme 2 — Archival semantics are inconsistent (bug-level, cheap, verified)

- `archive_board` has **no active-task check** — a board can be archived with live
  tasks on it (src/mcp/tools/write/archive-board.ts, verified). Asymmetric with
  `archive_group`, which refuses when active tasks reference the group
  (archive-group.ts:45–55).
- `create_task` validates board/group **existence** but never checks `archived_at` —
  tasks can be created on archived boards and in archived groups
  (src/mcp/tools/write/create-task.ts:50–64, verified: no archived check).
- **Fix:** make the checks symmetric — `archive_board` conflicts on active tasks;
  `create_task` (and group moves in `update_task`) reject archived targets with a
  clear `conflict`/`not_found`-style message.

## Theme 3 — One corrupted board file bricks the entire substrate

- The loader strict-fails the **whole** load if any single board JSON is malformed or
  shape-invalid — every MCP call then returns `internal_error` until the file is
  fixed (src/substrate/loader.ts:52–76; confirmed by loader.test.ts "strict-fails the
  whole load").
- Two problems with that as UX: (a) hand-editing is a documented first-class
  authoring path, so a typo in one board shouldn't take down tool access to *all*
  boards; (b) `internal_error` tells the agent "system bug" when the truth is "your
  file — here's the path, fix it" (and write-path failures use `schema_violation`
  for the same class of problem — inconsistent semantics).
- Related hand-edit hazard: schemas don't use `.strict()`, so unknown keys in a
  hand-edited board JSON are silently dropped on the next tool write — quiet data
  loss (src/substrate/schemas.ts).
- **Fix (pick one):** degrade to per-board failure — broken boards are excluded from
  the load and surfaced as a loud warning in `whoami`, the write envelope, and the
  UI; or keep strict-fail but give it a dedicated error code
  (e.g. `substrate_corrupt`) with file path + remediation in the message. Either
  way, warn on unknown keys instead of silently dropping them.

## Theme 4 — Human visibility is per-task only; the corrective path gets no help

- The event log already records `actor_agent_name` on every write, but the UI
  surfaces it only inside one task's Events tab. There is **no cross-board activity
  feed** — "who did what, when, across the project" — which is the actual product
  pitch for humans. The data already exists; this is a read endpoint + a UI route.
  Combined with Theme 1c (blocked moves + fired policies as events), this is what
  turns the UI from "kanban screenshot" into oversight.
- A task can violate its own `field_schema` (missing required fields) and look
  perfectly green on the board. The server can already compute this
  (`list_tasks(missing_required_fields)`), but the UI never shows it.
  **Fix:** a badge on cards/detail for missing required fields.
- When a human spots a wrong state, their only recourse is to ask an agent (correct
  stance — keep read-only). But acknowledge the path in the UI (e.g. easy copy of
  task id / a "fix via your agent" affordance) rather than leaving a dead end.
- Smaller: `substrate explain` output is not discoverable from the UI (CLI-only);
  the schema-version badge in Overview isn't actionable; stale-PID reclamation is
  silent; port-conflict message degrades silently when `lsof` is unavailable.

## Theme 5 — Watch-list (defensible designs; monitor in dogfood, don't fix yet)

- **`version_mismatch` omits `current_version`** by design (forces re-read; verified
  in tests). Reasonable anti-blind-overwrite stance, but PRD R4's livelock risk is
  real: a naive agent retrying the same version loops forever. Watch retry behavior
  in dogfood before softening.
- **`transition_blocked` details** carry `policy_id`/`from_group`/`to_group` but not
  the failing conditions (src/policy/engine.ts:65–73) — agents must parse prose to
  know which field to set. A structured `failed_conditions` array would make
  recovery mechanical. Cheap; bundle with Theme 1 if convenient.
- **Suggestions are skimmable:** the `agent_responsibility` message is an optional
  field buried inside `policies_fired[]` (src/core/envelope.ts:13–20). Given the PRD
  bets everything on agents acting on these, consider a top-level `suggestions: [...]`
  key in the envelope — make the load-bearing feature impossible to miss.
- **TOCTOU window** between a writer's re-read and rename: a concurrent hand-edit can
  be silently overwritten (documented accepted residual, writer.ts:33–36). Fine for
  v1; slightly undercuts "hand-editing is safe" in the docs — say so there.
- **Lazy `required` validation** (writes never blocked; violations only via explicit
  query; untouched stale fields never re-validated — field-validator.ts) is a fine
  design *if* the UI badge from Theme 4 exists. Without it, it's a silent
  data-quality hole.
- **Group-archive race (R7):** active-task check isn't atomic with the write —
  accepted residual, fine.
- Low-priority notes: `update_task` reads the substrate inside the transaction, so a
  deleted/broken board orphans its tasks (clear error, no recovery tool);
  custom_data event diffs are whole-object, not per-key; event-log retention is
  forever (fine for v1).

---

## Suggested implementation order

1. **Validate policy definitions** at create/update + on load (1a) and **embed the
   DSL in tool descriptions** (1b). Small, surgical, kills the worst silent failure.
2. **Persist policy activity as events** — `move_blocked` + fired policies (1c).
   Prerequisite for the PRD's kill-criterion metric and for the activity feed.
3. **Archival symmetry fixes** (Theme 2). Bug fixes, small.
4. **Per-board load degradation or dedicated corrupt-file error** + unknown-key
   warning (Theme 3).
5. **Activity feed + missing-required badge in the UI** (Theme 4).
6. Watch-list items (Theme 5) only as dogfood demands.

Items 1–4 are pre-dogfood. Item 5 strengthens the human half of the pitch and is the
demo surface. Nothing here expands v1 scope into the cut policy classes — it makes
the two shipped classes observable and trustworthy.
