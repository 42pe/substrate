# CLAUDE.md — Substrate (working in this repo)

This is the Substrate source repo. **We dogfood Substrate to track its own
development**, using the globally-installed release binary (not this repo's dev
build) so operating the board never breaks mid-edit.

## Branching model

- **Feature work happens on a `dev` branch and merges to `dev` — never straight to
  `main`.** Cut a feature branch off `dev`, PR it into `dev`.
- **`main` only advances on a release** (`dev` → `main` + a `vX.Y.Z` tag). That's a
  separate, gated flow tracked on the **`release`** board (below), per `RELEASING.md`.

## Work tracking — use the `roadmap`, `dev`, and `release` boards

This project has a `.substrate/` with a **`roadmap`** board, a **`dev`** board, and a
**`release`** board (`substrate` MCP server, registered in `.mcp.json`). Before planning
or starting work:

1. Call the **`whoami`** MCP tool, then `get_board_substrate` for the board and
   `list_tasks` — reconcile your plan with what's already there.
2. Record work as tasks and move them across the board as you go; use comments
   for decisions.

The **`roadmap` board** is where **product** ideas get shaped — **Ideas → Shaping →
Roadmap-Ready** — PRODUCT thinking only (problem, who it's for, value, how it fits the
product, scope + non-goals); **no tech design, schemas, or code**. The final step is
human-only:

- 🔒 **Shaping → Roadmap-Ready** requires `roadmap_approved` — Diego approves a fully
  fleshed product plan (`substrate approve <task_id> roadmap_approved`). Agents can't
  self-approve.

An agent then **copies each Roadmap-Ready feature into the `dev` board's Ready to Start
column** to begin technical work (reference the roadmap task id for lineage). Small
technical/internal improvements can be created in Ready to Start directly, skipping the
roadmap board.

The **`dev` board** models how we ship a change: **Ready to Start → Spec & Plan →
Build & Test → Review → Pending Review and Approval → Merged (dev)**, with four
gates (two human-only, marked 🔒):

- **Ready to Start** — the intake column: approved product features copied from the
  roadmap, plus direct technical items. Move one to Spec & Plan to begin.
- **Spec & Plan** — author the spec + plan as **self-contained HTML docs** in
  `docs/specs/<slug>.html` and `docs/plans/<slug>.html`, linked from the task's
  `spec_doc`. See `docs/README.md`.
- 🔒 **Spec & Plan → Build & Test** requires `plan_approved` — Diego approves the
  spec + plan before implementation (`substrate approve <task_id> plan_approved`).
- **Build → Review** requires `tests_green` — set it only after build + tsc +
  lint + format + all tests pass **locally** (CI is billing-blocked; validate
  locally — see [memory: CI Actions billing limit]).
- **Review → Pending Review and Approval** requires `reviews_approved` — set it
  only after **both** independent reviewers APPROVE. Spawn ≥2 adversarial
  reviewers with distinct lenses, wait for both, re-run any that die, fold in
  blocking findings and re-review the fix round. **Never self-grade a review.**
- 🔒 **Pending Review and Approval → Merged (dev)** requires `diego_approved`, a
  **human-only** field (B3) — an agent's write tools refuse it. Diego signs off
  with `substrate approve <task_id> diego_approved`, then the PR merges to `dev`.
  Run `substrate pending-approval` to see what's waiting on him.

The **`release` board** models cutting a release (`dev` → `main` + tag): **Ready →
Docs Verified → Versioned → Validated → Approved → Released**. Its gates carry the
guidelines inline — verify docs against the code, bump the three version sites +
rotate the CHANGELOG (`pnpm release`), validate locally, get Diego's `human_only`
`release_approved`, then tag `vX.Y.Z` / merge `dev`→`main` / reinstall the global
binary. Full runbook: `RELEASING.md`.

## Gotchas

- **One checkout.** `.substrate/data.sqlite` (the tasks) is gitignored — it does
  not travel with git worktrees or clones. Drive Substrate from the main checkout
  only, or task state silently diverges (Substrate warns on a fresh/empty DB).
- **Global vs dev binary.** The board is driven by the global `substrate`
  (a stable release). After cutting a release, reinstall it — see `RELEASING.md`.

See `skills/substrate/SKILL.md` for full conventions and `AUTHORING.md` for the
board/policy model.
