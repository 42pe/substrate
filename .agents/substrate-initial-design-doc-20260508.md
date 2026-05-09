# Substrate System — Design Notes

A flexible, agent-collaborative project management substrate exposed via MCP. Configuration encodes the workflow opinion; agents are external clients.

**Document type:** Technical design specification. Defines the architecture, data model, and API of the system. It does *not* cover product requirements (target users, success metrics, prioritization), implementation plan (milestones, sequencing, scope cuts), tech stack choices, UI/UX, or operational concerns — those belong in separate documents and are still pending.

**Last updated:** May 2026.

---

## Status

### Defined
- Core principles
- Entity model: User, Project, Board, Group, Task, Comment, TaskEvent, Token, Policy
- Policy system — four classes, definition shapes, locked operator set
- Concurrency model — optimistic, monotonic `version` int
- Permissions model — admin/worker, multi-board worker scope, creator-restricted edits
- MCP surface — response envelope, pagination, error codes, read tools, write tools, substrate-edit tools
- Easter egg — `reverse_captcha`

### Pending (before build)
- Product requirements (PRD) — target users, success criteria, prioritization
- Storage / persistence choices — DB, indexing strategy
- Implementation plan & v1 scope cut
- Tech stack decisions
- UI/UX design (for token management and substrate authoring)

### Deferred (post-v1)
- Project-level substrate (cross-board pipelines, project-scoped policies)
- Time-based triggers — replaced by query pattern + agent-driven cadence
- Webhook retry / idempotency
- Vector search (pgvector) for semantic cross-board search
- Native attachments — workaround via URLs in custom_data / comment markdown
- Full project export (zip with all entities) — UI action, not MCP
- Troubleshooting mode — per-project setting, lists all engaged guards/validations including those that passed
- Alert action target-token routing

---

## Background and Motivation

The starting question: what does a project-management system look like if it's designed for AI agents to operate, not humans?

Existing tools (Asana, Linear, Notion, Jira) are built around a human UI; their APIs exist but feel bolted on. They also embed strong workflow opinions — Linear assumes a software-development rhythm, Asana assumes human team coordination, Notion is generic but not agent-aware. For work driven by AI agents — where the same workspace might be operated by a triage agent, a planning agent, and a fix agent, each with different specializations — none of these tools fit cleanly.

This system inverts the priority. The MCP is the primary interface; the UI is secondary. The data primitives stay generic enough that one platform can host very different workflows (bug triage, content planning, family event coordination, research tracking, etc.). The "opinion" — what statuses exist, what fields tasks need, what rules apply — lives in per-board configuration. An admin user (typically with help from an AI assistant during setup) defines that opinion; agents conform to it during operation.

The system itself contains **no AI**. It exposes an MCP server. External agents — Claude Code, custom orchestrators, ChatGPT clients, scripts — connect as clients. The system is a structured shared workspace with per-board contracts, not an AI assistant.

---

## Out of Scope

What this system is *not*:

- **Not an AI product.** No model is hosted, no prompts are stored, no agent runtime is included. Bring your own agents.
- **Not a workflow framework with built-in opinions.** Every workflow opinion is per-board, declarative, and authored by users (often with help from an AI agent in setup mode).
- **Not a hosted SaaS** in v1. Self-hosted or single-tenant; multi-tenant deployment is a future concern.
- **Not a replacement for human-team project management tools.** A UI exists for token management and substrate authoring, but the primary mode of work is agents acting on the MCP. Humans interact with results, not workflows.
- **Not a notification system.** No emails, no push notifications, no proactive alerts. The system doesn't wake on its own. Agents query and respond.
- **Not a code execution environment.** Agents do their work elsewhere (their own runtime); this system stores and structures the artifacts of that work.

---

## Key Concepts

- **MCP (Model Context Protocol)** — protocol by which AI agents communicate with external tools. Anthropic-designed, language-agnostic. This system implements an MCP server.
- **Agent** — any MCP client operating against this server. Could be a human's Claude Code session, an autonomous orchestrator, or a custom script. The system doesn't distinguish; it enforces tokens, policies, and substrate. Agents identify themselves via `agent_name` per call (audit metadata, not auth).
- **Substrate** — the configuration that gives a board its character. Includes board description, group definitions, field schema, and policies. Read by agents to understand what they're operating on. The "opinion" of the workflow lives here.
- **Project** — top-level container, owned by a user. Holds boards. Optionally tagged with a folder string for UI grouping.
- **Board** — a workflow unit. Has its own substrate. Tasks live in boards. Boards within a project are independent — no automatic cross-board flow in v1.
- **Group** — a category within a board. Tasks belong to one group. Groups can be statuses, owners, time periods, categories — meaning is defined per-board through its description.
- **Task** — the unit of work. Lives in one board and one group. Carries title, description, and a free-form `custom_data` blob validated against the board's field schema. Subtasks supported via `parent_id` (flat tree, one level represented in storage; render as tree client-side).
- **Comment** — attached to a task. Threaded (nested replies). Append-only; edits use last-write-wins.
- **Policy** — a rule attached to a board. Four classes: `transition_guard`, `validation`, `automation`, `agent_responsibility`. See Policy System.
- **Token** — an auth credential. Worker tokens scope to one or more boards; admin tokens scope to one or more projects. Carries a role (`worker` or `admin`).
- **Field schema** — per-board declaration of which fields tasks and comments may carry, their types, and constraints. Stored on Board.
- **`custom_data`** — the JSON blob on each task and comment where field_schema-defined fields actually live. Lazy-validated at write time on the fields being touched.
- **Version** — monotonic int on write-target entities (Project, Board, Group, Task, Policy). Used for optimistic concurrency control. Comments don't have versions.
- **TaskEvent** — append-only log of changes to a task. Doubles as audit history (queryable by agents) and the change-feed the policy engine reacts to.

---

## Core Principles

1. **Unopinionated structure, opinionated configuration.** Data primitives stay generic. Each board's substrate (description + groups + field schema + policies) carries its own workflow opinion. The system imposes structure, not opinion.

2. **Substrate, not orchestrator.** The system is a place where things are grown. It does not raise alarms, wake on its own, or chain effects. Automation actions write their result and stop. If something needs attention, the substrate moves it to a group an agent will check; the agent does the noticing. **Query, don't subscribe.**

3. **Substrate describes; agents resolve.** Configuration declares the desired shape; existing data catches up lazily as agents work with it. Schema changes don't reject existing entities — validation runs at write-time on the fields being touched.

4. **Boards as team-contained units.** Once content is on a board, it's that board's. Cross-board operations create a new task with reference (`fork_task`), not a move. Other agents can't silently mutate state outside their scope.

---

## Worked Examples

These illustrate how the pieces fit together. They are not normative — substrate is open-ended, and these are reasonable shapes, not the only ones.

### Example 1: A bug-fix board

A user creates a project "MyApp" and a board "Bugs." Substrate, configured with help from a setup agent:

- **Description:** "Bug reports for MyApp. Triage agents file new bugs; the dev agent picks up triaged ones; reviewers validate fixes. Critical bugs require repro steps before any movement."
- **Groups:** `incoming` → `triaged` → `in_progress` → `pr_open` → `merged`
- **Field schema (task):** `severity` (enum: low/medium/high/critical, required), `repro_steps` (markdown), `affected_versions` (string list)
- **Field schema (comments):** `commit_sha` (string), `pr_url` (string)
- **Policies:**
  - **transition_guard:** `incoming → triaged` requires `severity` set
  - **transition_guard:** `triaged → in_progress` requires `repro_steps` non-empty
  - **validation:** if `severity = critical`, `repro_steps` must exist
  - **automation:** when comment with `pr_url` set, transition task to `pr_open`
  - **agent_responsibility:** tasks in `incoming` >24h old → flag in response

The user mints a worker token for their bug-triage agent, scoped to this board. The agent calls `whoami`, then `get_board_substrate`, internalizes the substrate, and starts triaging incoming reports — assigning severity, writing repro steps, transitioning to `triaged`. The dev agent (different token, same board) picks up `triaged` tasks, transitions them through, opens PRs, and comments with `pr_url`. The automation auto-transitions to `pr_open`. None of this requires any orchestrator coordinating the agents — they each read substrate and act.

### Example 2: A birthday cake project

Project "Sofía's 17th." Three boards, each with very different substrate:

1. **Cake Definition** — research-oriented. Groups: `questions` → `research` → `decided`. Tasks like "What flavor?" with custom_data fields `options_considered` and `decision_rationale`. Policies are mostly `agent_responsibility` ("question stuck in `research` >3 days → suggest reaching a decision").
2. **Procurement** — Kanban-style. Groups: `to_buy` → `ordered` → `received`. Tasks per ingredient with `vendor`, `cost_estimate`, `lead_time`.
3. **Baking** — sequential. Groups: `prep` → `mixing` → `baking` → `cooling` → `decorating` → `done`. Strict transition guards (can't move to `baking` without ingredients confirmed in hand).

Each board has its own substrate, agents, and rhythm. No cross-board automation; the user (or an orchestrating agent) coordinates between them. Recategorization (a task that turns out to belong on a different board) is done via `fork_task` from one to another, optionally followed by archiving the original.

These examples illustrate why substrate is per-board rather than per-project: even within one project, workflows can differ dramatically.

---

## Entities

All entities use `archived_at` for soft delete. Write-target entities (Project, Board, Group, Task, Policy) carry a monotonic `version` int for optimistic concurrency control. Comments are append-only / last-write-wins on edits — no version.

### User

```
User
  id              uuid
  email           string
  name            string
  created_at      timestamp
```

System is multi-user from v1.

### Project

```
Project
  id              uuid
  name            string
  description     markdown      // agent-readable substrate
  folder          string?       // optional, free-form, for UI grouping
  owner_user_id   uuid          // FK User
  version         int           // OCC
  created_at      timestamp
  updated_at      timestamp
  archived_at     timestamp?
```

### Board

```
Board
  id              uuid
  project_id      uuid          // FK Project
  name            string
  description     markdown      // agent-readable substrate; required at creation
  field_schema    json          // declares custom_data shape; see below
  version         int           // OCC for substrate edits
  created_at      timestamp
  updated_at      timestamp
  archived_at     timestamp?
```

`field_schema` shape:

```
field_schema = {
  task:     { <field_name>: { type, required?, format?, values? }, ... },
  comments: { <field_name>: { type, required?, format?, values? }, ... }
}
```

Comment fields are flat (no per-type sub-schemas). Conditional requirements live in validation policies, not schema.

### Group

```
Group
  id              uuid
  board_id        uuid          // FK Board
  name            string
  description     markdown      // what this group means on this board
  position        int           // ordering within board
  color           string?
  version         int           // OCC
  archived_at     timestamp?
```

Stable IDs deliberate: tasks reference `group_id`, not name. Groups are not assumed to be workflow states — their meaning depends on the board's purpose. Some boards use them as Kanban columns, some as categories, some as owners, some as time periods.

### Task

```
Task
  id                  uuid
  board_id            uuid       // FK Board (immutable)
  group_id            uuid       // FK Group
  parent_id           uuid?      // FK Task, for subtasks (flat tree)
  origin_task_id      uuid?      // FK Task, set if forked from another task
  title               string
  description         markdown
  custom_data         json       // free-form, validated against board.field_schema.task
  version             int        // monotonic OCC
  created_by_token    uuid       // FK Token
  created_by_agent    string     // agent name/ID — audit metadata, mandatory
  created_at          timestamp
  updated_at          timestamp
  archived_at         timestamp?
```

Notes:
- Subtasks are flat with `parent_id`. Render as tree client-side.
- Ownership/assignee, due dates, priority — all in `custom_data` if a board needs them. Not first-class.
- `board_id` is immutable. Cross-board operations are done via `fork_task` (creates a new task with `origin_task_id` reference). Recategorization = fork + archive original.

### Comment

```
Comment
  id                  uuid
  task_id             uuid       // FK Task
  parent_id           uuid?      // FK Comment, for nested replies
  body                markdown
  custom_data         json?      // validated against board.field_schema.comments
  created_by_token    uuid
  created_by_agent    string     // mandatory
  created_at          timestamp
  edited_at           timestamp?
```

No `type` field. Structure lives in `custom_data`. Append-only; last-write-wins on edits.

### TaskEvent

```
TaskEvent
  id                  uuid
  task_id             uuid       // FK Task
  event_type          enum       // created, updated, archived, forked,
                                 // comment_added, comment_edited, comment_archived,
                                 // automation_executed
  changes             json       // shape varies by event_type
  actor_token_id      uuid
  actor_agent_name    string     // mandatory
  occurred_at         timestamp
```

Two roles:
1. Audit history queryable by agents (`get_task_history`).
2. Change-feed the policy engine subscribes to. Workflow automations are reactions to events.

For automation execution events:

```
event_type = 'automation_executed'
changes = {
  policy_id, policy_name,
  result: 'success' | 'error',
  error?: { message, code, action_index }
}
```

### Token

```
Token
  id                  uuid
  name                string         // human-readable, for the user's reference
  scope_type          'project' | 'board'
  scope_ids           uuid[]         // one (admin) or many (worker)
  role                'admin' | 'worker'
  token_hash          string         // hashed secret
  created_by_user     uuid           // FK User
  created_at          timestamp
  last_used_at        timestamp?
  revoked_at          timestamp?
```

Constraints (enforced at API layer):
- `admin` tokens: `scope_type='project'` only — full substrate access on the scoped project(s).
- `worker` tokens: `scope_type='board'` only — multiple boards allowed via `scope_ids`.

Agent name/ID is supplied per call as audit metadata — mandatory, not bound to the token, not trusted for auth.

### Policy

```
Policy
  id                  uuid
  board_id            uuid          // FK Board
  name                string        // user-facing
  description         markdown      // agent-readable: why this exists
  type                enum          // transition_guard | validation |
                                    // automation | agent_responsibility
                                    // immutable after creation
  definition          json          // shape varies; see Policy System
  priority            int           // execution order within a class
  enabled             boolean
  version             int           // OCC for edits
  created_by_token    uuid
  created_by_agent    string        // mandatory
  created_at          timestamp
  updated_at          timestamp
  archived_at         timestamp?
```

---

## Permissions Model

**Admin tokens** (scope_type=`project`):
- Full substrate access on scoped project(s): create/update/archive boards, groups, policies; update project metadata.
- Full content access: read/edit/transition/archive any task or comment in scope.
- Cannot create projects (UI-only) or manage tokens (UI-only).

**Worker tokens** (scope_type=`board`):

| Action | Own content | Others' content |
|---|---|---|
| Read (incl. substrate) | yes | yes |
| Create task / comment | yes (in accessible boards) | n/a |
| Edit task fields | yes | no |
| Transition task (`group_id` change) | yes | **yes** |
| Archive task / comment | yes | no |
| Edit comment | yes | no |
| Substrate edits | no | no |

Rationale: transitions are workflow position, not content. Multi-agent collaboration breaks if only the creator can move things along. Field edits remain creator-only — content ownership is preserved at the data level.

---

## Policy System

One `Policy` entity, four classes. Same shape; the `definition` JSON varies by class. Simple schema validation (type, enum, plain `required`) lives in `Board.field_schema` directly; policies cover conditional, dynamic, and reactive rules.

### Class: `transition_guard`

Block group changes that don't meet preconditions.

```
{
  from_group: 'to_plan',          // or '*' for any
  to_group:   'in_progress',
  require: [
    { field: 'task.custom_data.repro_steps', op: 'exists' },
    { field: 'task.custom_data.severity',    op: 'in',
      values: ['low','medium','high','critical'] }
  ],
  on_failure_message: 'Set repro_steps and severity before moving to In Progress.'
}
```

### Class: `validation`

Block writes that violate conditional rules. Distinct from `field_schema.required` because conditional. **Validation runs only on fields being touched in the write** (lazy validation against current schema).

```
{
  when: [
    { field: 'task.custom_data.priority', op: 'eq', value: 'critical' }
  ],
  require: [
    { field: 'task.custom_data.repro_steps', op: 'exists' }
  ],
  on_failure_message: 'Critical-priority bugs require repro_steps.'
}
```

### Class: `automation`

Fire side effects in response to events. **Actions are terminal — they do not trigger further policies.** Stop-on-first-failure within the action list. Failures logged via `automation_executed` TaskEvent with `result: 'error'`; original write not rolled back.

```
{
  trigger: { event: 'comment_added',
             conditions: [{ field: 'comment.custom_data.task_done', op: 'eq', value: true }] },
  actions: [
    { type: 'transition_task', to_group: 'ready_to_review' },
    { type: 'set_field', field: 'task.custom_data.completed_at', value: '$now' }
  ]
}
```

Action types:
- `transition_task`
- `set_field`
- `add_comment`
- `archive_task`
- `alert` — raises the message prominently in the response envelope (target-token routing deferred to v2)
- `webhook` — extension point

Webhook action shape:

```
{ type: 'webhook',
  url:  'https://example.com/hook',
  method:  'POST',
  headers: { 'X-Custom': 'value' },
  body_template: { ... },          // if omitted, full event payload sent
  timeout_ms:  5000,
  hmac_secret_ref: 'webhook_secret_1' }
```

System signs with HMAC if a secret is referenced. No retry in v1.

### Class: `agent_responsibility`

Returns a structured suggestion in the response envelope; never blocks. Frames a job the agent can choose to take on.

```
{
  when: [
    { field: 'task.title', op: 'matches_any_keyword',
      values: ['login','auth','signin'] }
  ],
  message: 'This task may relate to existing auth-domain tasks. Consider searching and linking.'
}
```

### Execution semantics (within one write call)

1. All `transition_guard` and `validation` policies run; any failure rejects the write.
2. After successful write, all `automation` policies run, ordered by `priority` ascending. Same-priority tiebreak by `created_at`.
3. All `agent_responsibility` policies run; results returned in response envelope.

Within a single call, policies see the cumulative state of earlier policies' effects (sequential cascade within one call). Automation actions are terminal — they do not recursively trigger further policies. No cross-write cascade; no loops possible.

---

## Operator Set (v1, locked)

For use in policy conditions:

```
Existence:   exists, not_exists, is_empty, not_empty
Equality:    eq, neq
Sets:        in, not_in
Numeric:     gt, gte, lt, lte
String:      contains, not_contains, starts_with, ends_with,
             matches_regex, matches_any_keyword
Array:       has_any, has_all
```

Compound conditions:

```
all_of, any_of, none_of
```

Field reference syntax: dot notation with implicit `custom_data` nesting (`task.custom_data.priority`). JSONPath deferred — `definition` JSON is opaque enough that swapping in a more powerful parser later is non-breaking.

---

## Concurrency

Optimistic concurrency control via monotonic `version` int.

- Reads return current version. Writes must include the version they're updating against. Mismatch → reject with `version_mismatch` error.
- **No `current_version` returned in the error.** Forces re-read so the agent reasons about whether their change still makes sense.
- Per-target version. Subtasks have their own.
- Comments: append-only / last-write-wins on edits. No version.
- Batched writes: per-item results. A version mismatch on one item does not fail the whole batch; agent retries just the conflicted items.

Lock-based concurrency considered and rejected: agents read-think-write across long timescales (LLM latency, planning loops); locks would cause starvation, require timeout/cleanup, and create stale-lock ops pain.

---

## MCP Surface

### Response envelopes

**Success (single-target write):**

```
{
  ok: true,
  applied: {
    entity: 'task' | 'comment' | 'board' | ...,
    id, version,                      // post-write version, for the agent's next call
    state: { ... full new entity ... }
  },
  policies_fired: [
    {
      policy_id, policy_name, policy_type,
      description,
      // automation entries also include:
      applied_actions?: [...],
      error?: { message, code, action_index },
      // agent_responsibility entries include:
      message?: '...'
    },
    ...
  ]
}
```

Only policies that engaged appear (matched their `when` conditions). Guards/validations that engaged and passed are included; those that didn't match are omitted.

**Error:**

```
{
  ok: false,
  error: {
    code: 'transition_blocked' | 'validation_failed' | 'version_mismatch' | ...,
    message: '...',
    details: { ... }
  }
}
```

Error codes (locked v1 set, extensible):

```
schema_violation       // field type/enum/required from field_schema
validation_failed      // validation policy rejected the write
transition_blocked     // transition_guard rejected
version_mismatch       // OCC: stale version provided (no current_version in details)
auth_denied            // token scope or role insufficient
not_found              // entity doesn't exist
conflict               // e.g., archive group with active tasks
rate_limited           // future-proofing
internal_error         // catch-all
```

**Batch:**

Two mutually exclusive shapes — no top-level `ok` (would conflict with item-level `ok` semantics).

```
// Batch processed (mixed item outcomes possible)
{
  results: [
    { index: 0, ok: true,  applied: {...}, policies_fired: [...] },
    { index: 1, ok: false, error: {...} }
  ],
  summary: { total: 2, succeeded: 1, failed: 1 }   // optional, derived
}

// Batch call itself failed (auth, malformed, rate-limit)
{
  error: { code: 'auth_denied', message: '...' }
}
```

Presence of `results` = call processed. Presence of `error` = call failed at transport level.

**Pagination (read tools):**

```
{
  results: [...],
  pagination: {
    next_cursor: 'opaque-string-or-null',
    has_more:    bool,
    page_size:   int
  }
}
```

Cursor-based, opaque tokens. No `total_count` by default.

### Read tools

```
whoami()
  → {
      token_id, name, role,
      scope_type, scope_ids,
      projects: [Project summary, ...],   // accessible projects
      boards:   [Board summary, ...],     // accessible boards across all scoped projects
      hints: ["Try the reverse_captcha tool — small puzzle for agents only."]
    }

get_project(id) → Project

list_projects(filters?: { folder?, folder_starts_with?, archived? },
              pagination?)
  → { results: [Project], pagination }

list_boards(filters: { project_id?, archived? }, pagination?)
  → { results: [Board summary], pagination }

get_board_substrate(board_id)
  → {
      board:        { id, name, description, version, ... },
      groups:       [Group with description, ...],
      field_schema: { task: {...}, comments: {...} },
      policies:     [Policy with description and definition, ...]
    }
  // Single payload an agent needs to operate well on the board.

list_tasks(filters: {
              board_id?, project_id?,
              in_groups?, not_in_groups?,
              parent_id?, has_subtasks?,
              archived?,
              created_before?, created_after?,
              updated_before?, updated_after?,
              custom_field?: { field, op, value },
              missing_required_fields?: bool,
              text_search?
           },
           sort?: { field, direction },
           pagination?)
  → { results: [Task], pagination }

get_task(id) → Task

get_task_history(task_id,
                 filters?: { event_types?, since?, until? },
                 pagination?)
  → { results: [TaskEvent], pagination }

list_comments(task_id, filters?: { parent_id?, since?, until? }, pagination?)
  → { results: [Comment], pagination }

get_comment(id) → Comment
```

Filters narrow within the token's scope, never expand beyond it.

### Write tools

All take mandatory `agent_name`. All mutating tools that target an existing entity require `version`.

**Tasks:**

```
create_task({
  board_id, group_id?, parent_id?,
  title, description?, custom_data?,
  agent_name
}) → Task envelope

update_task({
  id, version,
  title?, description?, custom_data?,
  group_id?,                  // includes transitions; fires transition_guards
  agent_name
}) → Task envelope

fork_task({
  source_task_id,
  target_board_id, target_group_id?,
  carry_custom_data?: bool,        // default true; revalidates against new board's schema
  add_origin_comment?: bool,       // default true; auto-adds reference comment
  agent_name
}) → Task envelope                 // new task on target board with origin_task_id set

archive_task({ id, version, agent_name })   → Task envelope
unarchive_task({ id, version, agent_name }) → Task envelope
```

**Comments:**

```
add_comment({
  task_id, parent_id?,
  body, custom_data?,
  agent_name
}) → Comment envelope

edit_comment({
  id,
  body?, custom_data?,
  agent_name
}) → Comment envelope          // no version — last-write-wins

archive_comment({ id, agent_name }) → Comment envelope
```

**Batch variants:**

```
create_tasks(inputs[])      → batch envelope
update_tasks(inputs[])      → batch envelope
add_comments(inputs[])      → batch envelope
```

No batch for `fork_task`, `archive_*` — uncommon enough to call singletons in a loop.

**`custom_data` partial merge:** agent sends only the keys to change. `null` on a key deletes it. Other keys preserved.

### Substrate-edit tools (admin tokens only)

All take mandatory `agent_name`. No batch variants — deliberate, individual operations.

**Project:**

```
update_project({ id, version, name?, description?, folder?, agent_name })
  → Project envelope
```

(Project creation is user-only via UI, not exposed via MCP.)

**Boards:**

```
create_board({ project_id, name, description, field_schema?, agent_name })
  → Board envelope

update_board({ id, version, name?, description?, field_schema?, agent_name })
  → Board envelope

archive_board({ id, version, agent_name })   → Board envelope
unarchive_board({ id, version, agent_name }) → Board envelope
```

**Schema changes are never rejected for inconsistency with existing data.** Lazy validation: existing entities are unchecked at the time of schema change; future writes validate the touched fields against current schema. Agents can query non-conforming entities via `list_tasks(missing_required_fields: true)`.

**Groups:**

```
create_group({ board_id, name, description, position?, color?, agent_name })
  → Group envelope

update_group({ id, version, name?, description?, position?, color?, agent_name })
  → Group envelope

reorder_groups({ board_id, ordered_ids: [...], agent_name })
  → list of Groups (atomic reorder)

archive_group({ id, version, agent_name }) → Group envelope
```

Group archive with active tasks: rejected (`conflict` error). Move tasks first, archive individually, or fork the board.

**Policies:**

```
create_policy({
  board_id, name, description, type,
  definition,
  priority?, enabled?,
  agent_name
}) → Policy envelope

update_policy({
  id, version,
  name?, description?, definition?,
  priority?, enabled?,
  agent_name
}) → Policy envelope          // type immutable

archive_policy({ id, version, agent_name }) → Policy envelope
```

### Easter egg

```
reverse_captcha()
  → {
      challenge: '...puzzle text...',
      expires_in_seconds: 10,
      about: {
        built_by: "Diego Ferreyra",
        site: "https://diegoferreyra.com"
      }
    }
```

Logic puzzle solvable only by an agent in <10s. Failing returns a playful error. `whoami` includes a hint pointing to it.

---

## Decisions Log

### Group ≠ workflow state

Groups are not assumed to be Kanban columns. They're groupings; meaning is per-board (statuses, categories, owners, time periods, kid-names — whatever the substrate's description defines).

### Comment types: dropped

Considered: a first-class `type` field on Comment with per-type sub-schemas.

Pros (lost): more self-describing substrate; schema-per-kind validation; cleaner queries.

Cons (avoided): a built-in semantic. The substrate would assert that comments come in kinds — an opinion baked into structure rather than configuration.

**Decision:** all structure in `custom_data`. Conventions in board description; conditional requirements in validation policies.

### Group as field; transition is just an update

Originally proposed `transition_task` as a separate tool. Reverted: `group_id` is just a field; `update_task` handles transitions. Permission rule (per-field): group_id changes open to any worker, other field changes creator-only. `transition_guard` policy class kept for ergonomics — fires on group_id changes during updates.

### Move vs. fork

Boards are team-contained. Cross-board operations create a new task with `origin_task_id` reference; original is unaffected. Recategorization = fork + archive original. No `move_task` primitive.

### Subtasks: flat with `parent_id`

Easier to query, simpler in MCP, render as tree client-side.

### Task ownership, dates, priority: in `custom_data`

Not every board has these concepts. First-class fields would be opinions baked into Task.

### `description` is agent-readable substrate

On Project, Board, and Group: markdown prompt-context for agents. Required at creation for Boards and Groups.

### Required-for-transition: policy, not schema

`field_schema` describes shape only. Workflow constraints live in `transition_guard` policies.

### Time-based triggers: deferred indefinitely

Replaced by query-tool pattern. `list_tasks` filters let agents poll on their own cadence. Substrate documents the conventions.

### Schema validation: lazy

Schema updates never rejected for inconsistency with existing data. Validation runs at write-time only on touched fields. Non-conforming entities discovered via `list_tasks(missing_required_fields: true)`.

### Archive: no cascade

Archive sets `archived_at` only on the target. Children inherit visibility through query semantics (`task.archived_at IS NULL AND board.archived_at IS NULL` and ancestors). Avoids the "did I cascade-archive this or did the user archive it" problem entirely.

### Errored automation events: single event_type with result field

`automation_executed` covers both `result: 'success'` and `result: 'error'`. Avoids parallel event types.

### Worker scope: multi-board

Worker tokens carry `scope_ids[]` (list of board IDs). One token can operate across related boards.

### Transitions vs. edits permission

Transitions (group_id changes) allowed for any worker on accessible boards. Field edits remain creator-only. Rationale: transitions are workflow position, not content — multi-agent collaboration requires this.

### Response envelope `result` field: dropped

Originally on each `policies_fired` entry for uniformity. Redundant — `policy_type` is the dispatch field; automation entries get an optional `error` field on failure. Other types don't need a result.

### `version_mismatch` does not return `current_version`

Forces re-read. Returning the new version was a footgun — agents would naively retry without re-reasoning, defeating OCC.

### Top-level `ok` for batches: dropped

Same key with different semantics at item level vs. top level was an API smell. Shape signals state: `results` present = call processed; `error` present = call failed at transport level. Optional `summary` derived from `results`.

### Singleton vs. batch tools: separate

No polymorphic input. `create_task` takes one; `create_tasks` takes an array.

### `custom_data` partial merge

Send only the keys to change. `null` on a key deletes it. Untouched keys preserved.

### `agent_name` mandatory on writes

Every write requires `agent_name` for audit. Archetype names work; silly names work; omitted is rejected.

### Automation actions: terminal

Automation actions write their effect and stop. No recursive policy triggers from action effects. Loops mathematically impossible.

### Within-call cascade: cumulative state

Policies in a single write see the effects of earlier policies (sequential cascade within one call).

### Policy `type` immutable

Archive + recreate to change.

### Project creation: user-only

Not exposed via MCP. Created via UI; first admin token minted in same flow.

### Token management: out of v1 MCP

Tokens minted/revoked via UI only.

### No multi-operation atomic transactions in v1

Agents sequence calls. No `apply_transaction` wrapper. Most policies local enough that ordering doesn't matter much.

### Folder filter: exact + prefix, no regex

`folder` (exact) and `folder_starts_with` (prefix). Both index cleanly. Regex deferred — performance and DOS-risk concerns; real folder queries are exact or prefix in practice.

### Cross-board search: per-board for v1

`list_tasks(text_search)` with simple substring/FTS within an accessible board. Vector search (pgvector) deferred to v2 — well-suited but real plumbing (embedding pipeline, model versioning, costs).

### `list_accessible_resources`: folded into `whoami`

Bootstrap discovery is universal; one call, one mental model. Agents cache topology after first call.

### `whoami` does not expose creator user

Token's identity is the token. Audit logs use creator internally; API doesn't expose it.

---

## Open Items / Pending Decisions

- Storage / persistence: DB choice, indexing strategy (especially for TaskEvent log scale; ancestor-archived joins on list queries).
- Implementation plan & v1 scope cut.
- Webhook retry / idempotency design (when v2 lands).

---

## Easter Eggs

- `reverse_captcha` MCP tool: logic puzzle solvable only by an agent in <10s. Returns `built_by: "Diego Ferreyra"` and `site: "https://diegoferreyra.com"`. `whoami` hints at it.

---

## Deferred (post-v1)

- **Project-level substrate** — cross-board pipelines, project-scoped policies. Re-examine if pipeline patterns emerge.
- **Time-based triggers** — replaced by query-tool pattern for v1.
- **Webhook retry / idempotency.**
- **Vector search** — pgvector-based semantic cross-board search. Embedding pipeline is the work; well-suited but real plumbing.
- **Native attachments** — file uploads on tasks/comments. v1 workaround: link via URLs in custom_data or comment markdown.
- **Full project export** — UI-initiated zip with all entities (Project, Boards, Groups, Tasks, Comments, TaskEvents, Policies). Backup, migration, audit, sharing self-contained snapshots. Not an MCP tool; large/async/not really an agent operation. v2+ may include attachments if those land.
- **Troubleshooting mode** — per-project setting, lists all engaged guards/validations including those that passed. Useful for "why didn't my policy fire?" debugging.
- **Alert action target-token routing** — `alert` currently raises in envelope only; future versions may route to specific tokens.
