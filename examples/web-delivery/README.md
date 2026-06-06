# Example: Web Delivery

A **stack-agnostic web-development delivery process** expressed as a Substrate
board. It encodes a Spec → Plan → Build → Review → QA → Done workflow with
**policy gates** that block a task from advancing until each stage's exit
criteria are met, plus **suggestion policies** that surface conventions at the
right moment. Nothing here is tied to a specific framework — adapt the fields
and gates to your stack.

It's a single board (`boards/delivery.json`) with no runtime data, so you can
drop it into any project.

## Stages (groups)

`Backlog → Spec → Plan → In Progress → Code Review → QA → Done`

## Per-task fields (`field_schema`)

| Field | Type | Purpose |
| --- | --- | --- |
| `type` | enum (feature/bug/chore/infra/docs) | What kind of work |
| `scope` | enum (small/medium/large/infra/user_facing) | Blast radius |
| `priority` | enum (low/medium/high/urgent) | Ordering |
| `acceptance_criteria` | markdown | Definition of "works" |
| `spec_doc` / `plan_doc` / `audit_doc` | string | Links/paths to the docs |
| `branch` | string | Feature branch |
| `spec_approved` / `plan_approved` / `tests_passing` / `review_cleared` / `audited` | boolean | **Gate inputs** — set these `true` as each gate is satisfied |

## Gates (`transition_guard` policies — these BLOCK)

| Move | Requires |
| --- | --- |
| Spec → Plan | `spec_approved = true` |
| Plan → In Progress | `plan_approved = true` |
| In Progress → Code Review | `tests_passing = true` |
| Code Review → QA | `review_cleared = true` |
| _any_ → Done | `tests_passing` **and** `review_cleared` **and** `audited` all `true` |

A blocked move returns a `transition_blocked` error with a message telling the
agent which flag to set. Set the flags via `update_task`'s `custom_data` (e.g.
`{ "spec_approved": true }`) — `custom_data` merges key-by-key.

## Suggestions (`agent_responsibility` policies — these never block)

- **In Progress** → "write tests during development, keep lint/format/types/build
  clean, use small logical commits."
- **`scope = user_facing`** → "update the spec and user-facing docs before Done."
- **QA** → the full definition-of-done checklist.

These appear in the `policies_fired` array of every write that matches.

## Use it

**Option A — copy the board into your project:**

```sh
# in your project
npx @diegoferreyra/substrate init          # or: substrate init  (while unpublished)
cp <substrate-repo>/examples/web-delivery/.substrate/boards/delivery.json .substrate/boards/
```

Then your agent (or you) can create tasks on the `delivery` board and the gates
apply immediately — boards are read fresh on every call.

**Option B — explore it as-is:**

```sh
cd <substrate-repo>/examples/web-delivery
substrate serve            # open http://localhost:7475 to browse the board
```

## Adapting it

It's just JSON (`boards/delivery.json`). Common tweaks:

- **Fewer columns?** Archive a group you don't use (set its `archived_at`) or
  delete it — and drop the matching gate.
- **Different gates?** Edit a policy's `definition.require` conditions, or set
  `enabled: false` to keep it as documentation without enforcing it.
- **More fields?** Add entries to `field_schema.task`; reference them in policy
  conditions as `task.<field>` (it resolves a literal field, then falls back to
  `custom_data.<field>`).
