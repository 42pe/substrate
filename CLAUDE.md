# CLAUDE.md — Substrate (working in this repo)

This is the Substrate source repo. **We dogfood Substrate to track its own
development**, using the globally-installed release binary (not this repo's dev
build) so operating the board never breaks mid-edit.

## Work tracking — use the `dev` board

This project has a `.substrate/` with a **`dev`** board (`substrate` MCP server,
registered in `.mcp.json`). Before planning or starting work:

1. Call the **`whoami`** MCP tool, then `get_board_substrate` for `dev` and
   `list_tasks` — reconcile your plan with what's already there.
2. Record work as tasks and move them across the board as you go; use comments
   for decisions.

The `dev` board models how we ship: **Backlog → Spec & Plan → Build & Test →
Review → Awaiting Diego → Merged**, with three gates:

- **Build → Review** requires `tests_green` — set it only after build + tsc +
  lint + format + all tests pass **locally** (CI is billing-blocked; validate
  locally — see [memory: CI Actions billing limit]).
- **Review → Awaiting Diego** requires `reviews_approved` — set it only after
  **both** independent reviewers APPROVE. Spawn ≥2 adversarial reviewers with
  distinct lenses, wait for both, re-run any that die, fold in blocking findings
  and re-review the fix round. **Never self-grade a review.**
- **Awaiting Diego → Merged** requires `diego_approved`, a **human-only** field
  (B3) — an agent's write tools refuse it. Diego signs off with
  `substrate approve <task_id> diego_approved`. Run `substrate pending-approval`
  to see what's waiting on him.

## Gotchas

- **One checkout.** `.substrate/data.sqlite` (the tasks) is gitignored — it does
  not travel with git worktrees or clones. Drive Substrate from the main checkout
  only, or task state silently diverges (Substrate warns on a fresh/empty DB).
- **Global vs dev binary.** The board is driven by the global `substrate`
  (a stable release). After cutting a release, reinstall it — see `RELEASING.md`.

See `skills/substrate/SKILL.md` for full conventions and `AUTHORING.md` for the
board/policy model.
