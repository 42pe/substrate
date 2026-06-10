# Authoring a substrate from a process

This is the reference for **building or modifying a substrate to mirror a
development process** — turning a team's workflow (from their docs, their README,
your knowledge of the project, or a conversation) into boards, stages, fields,
and **enforceable gates**. Read it whenever a human asks you to "set up a
substrate for our process", "mirror how we work", or "add a gate/rule".

The hard part is **policies** — their `definition` is free-form JSON, so the MCP
tool schema won't tell you the shape. This document is that shape. A policy with
a malformed definition **loads fine but silently never engages**, so authoring
without this guide produces gates that don't actually enforce anything. Always
finish with the [validation step](#5-validate-the-gates-actually-fire).

The canonical worked example is [`examples/web-delivery`](../../examples/web-delivery/) —
read its `boards/delivery.json` alongside this guide.

---

## How authoring works

Substrate-as-code (boards/groups/field_schema/policies) is **read fresh on every
call**. Two equivalent ways to author:

- **MCP substrate-edit tools** — `create_board`, `create_group`, `reorder_groups`,
  `create_policy`, `update_*`, `archive_*`. Each needs `agent_name`; updates need
  the current `version` (optimistic concurrency).
- **Edit the JSON directly** — write `.substrate/boards/<id>.json`. The change
  takes effect on the next read. Good for authoring a whole board at once.

Either way the shapes below are what must end up in the file.

---

## 1. Stages → groups

Each workflow stage becomes a `group`. Order them with `position` (0,1,2,…) —
that's the left-to-right flow. Fields: `id`, `name`, `description`, `position`,
`color` (or `null`), `version` (1), `archived_at` (`null`).

## 2. Per-work-item metadata → field_schema.task

Custom fields each task may carry. A `FieldSchemaEntry` is:

```json
{ "type": "string|number|boolean|enum|markdown|string_list", "required": false, "values": ["..."] }
```

`values` is required when `type` is `enum`. Add a **boolean "gate field"** for
each exit criterion you'll enforce (e.g. `spec_approved`, `tests_passing`,
`review_cleared`) — the agent flips these via `update_task` `custom_data` as each
criterion is met. `field_schema.comments` works the same for comment metadata.

## 3. The policy DSL

A `policy` is `{ id, name, description, type, definition, priority, enabled,
version, created_by_agent, created_at, updated_at, archived_at }`. `type` is
`transition_guard` or `agent_responsibility`; everything below is the
`definition`.

### transition_guard — BLOCKS a group move

```json
{
  "from_group": "spec",          // group id, or "*" for any
  "to_group": "plan",            // group id, or "*" for any
  "require": [ <Condition>, ... ], // implicit all_of, evaluated on the POST-move task
  "on_failure_message": "Set spec_approved=true once the spec is signed off."
}
```

The guard **engages** when `from_group`/`to_group` match the move (`"*"` is a
wildcard). When engaged, the move is **blocked** (`transition_blocked` error)
unless **every** `require` condition passes against the task as it would look
after the move. Use a `"*" → done` guard for a definition-of-done gate.

### agent_responsibility — attaches a SUGGESTION, never blocks

```json
{
  "when": [ <Condition>, ... ],  // empty/absent ⇒ always matches
  "message": "Write tests during development, not after."
}
```

When `when` matches a written task, the policy appears in that write's
`policies_fired` with the `message`. Use it for conventions and reminders.

### Conditions

A leaf condition:

```json
{ "field": "task.tests_passing", "op": "eq", "value": true }
```

**Field references resolve literal-first, then `custom_data`:** `task.tests_passing`
checks `task.tests_passing`, then falls back to `task.custom_data.tests_passing`.
So your custom/gate fields are referenced as `task.<name>`. Built-in task fields
are also available: `task.group_id`, `task.title`, `task.description`,
`task.parent_id`, etc.

**Operators** (`value` for scalar ops, `values` for set/array ops, neither for
existence ops):

| Group | Operators |
| --- | --- |
| existence | `exists`, `not_exists`, `is_empty`, `not_empty` |
| equality | `eq`, `neq` |
| sets | `in`, `not_in` (use `values`) |
| numeric | `gt`, `gte`, `lt`, `lte` |
| string | `contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex`, `matches_any_keyword` (`values`) |
| array | `has_any`, `has_all` (`values`) |

**Compounds** nest conditions: `{ "all_of": [ ... ] }`, `{ "any_of": [ ... ] }`,
`{ "none_of": [ ... ] }`. (A guard's `require` is already an implicit `all_of`.)

## 4. The mapping recipe

| In the process | Becomes |
| --- | --- |
| Workflow stages (idea → spec → build → review → done) | **groups**, ordered by `position` |
| What each item tracks (type, priority, owner, links, acceptance criteria) | **field_schema.task** entries |
| Stage exit criteria / hard gates ("no build without an approved plan") | **transition_guard** with `require` on the gate field(s) |
| Definition of done | a `"*" → done` **transition_guard** requiring the key flags |
| Conventions & reminders ("write tests during dev", "update docs for user-facing work") | **agent_responsibility** with `when` matching the stage/scope and the convention as `message` |

Extract those five things from the process docs (or ask the human), then author
the board. Prefer reusing/extending an existing board over inventing new ones.

## 5. Validate the gates actually fire

A guard enforces the **transition** — it blocks the move when the gate field is
unset and returns `transition_blocked`. It does **not** verify the field is
_true_: the agent self-attests `tests_passing` etc.; nothing here runs the tests.
"Enforceable" means the rail fires on demand, not that the work was checked — so
"validate" below means _prove the rail fires_, not _prove the work happened_.

Policies fail **silently** if malformed, so prove them before declaring done:

1. `create_task` on the new board in the stage before a gate, with the gate field
   unset/false.
2. `update_task` to move it across the gate — expect a **`transition_blocked`**
   error naming the field.
3. Set the gate field (`update_task` `custom_data: { "<field>": true }`) and move
   again — expect **success**, and check the `policies_fired` envelope.
4. For an `agent_responsibility`, write a matching task and confirm the `message`
   appears in `policies_fired`.
5. `archive_task` the probe task(s).

If a guard didn't block when it should have, the `definition` is wrong (check
`from_group`/`to_group` ids and the `field` paths) — re-read §3.

## Tips

- Keep `id`s stable and human-readable (`spec`, `gate-done`) — they're referenced
  by policies and tasks.
- `enabled: false` keeps a policy as documentation without enforcing it.
- Archive a stage you don't use (set `archived_at`) and drop its gate.
- Start from `examples/web-delivery` and adapt rather than authoring from scratch.
