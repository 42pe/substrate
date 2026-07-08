# docs/ — specs & plans

Specs and plans for `dev`-board work live here as **self-contained HTML documents**
(openable in a browser, no build step):

- `docs/specs/<slug>.html` — the **spec**: problem, goals / non-goals, scope,
  acceptance criteria.
- `docs/plans/<slug>.html` — the **plan**: approach, step-by-step work, risks,
  test strategy.

One `<slug>` per task (a short kebab-case name), linked from the task's `spec_doc`
field on the `dev` board. A spec + plan needs Diego's approval (`plan_approved`)
before the task can move Spec & Plan → Build & Test — an agent cannot self-approve
(run `substrate approve <task_id> plan_approved`).

> The older phase specs/plans in `.agents/plans/` are historical (markdown). New
> work uses this folder + HTML.
