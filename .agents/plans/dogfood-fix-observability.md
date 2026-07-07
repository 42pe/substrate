# Dogfood fix — Failure visibility & OCC ergonomics

**Status:** Draft for Diego's review (authored directly — workflow draft stage infra-limited)
**Author:** Architect
**Date:** 2026-07-07
**Source:** [.agents/dogfood/rollup.md](dogfood/rollup.md) (B4, B5) + the arch doc's Phase A (B7)
**CI:** billing-blocked → validate **locally**.

---

## Problem & decisions

### B4 — the MCP-spawned server writes no `.substrate/logs/` (MED)
**Root cause:** the file logger is wired by `serve` but **not** by `substrate mcp`, so an MCP server
spawned by an MCP client leaves no on-disk error trail — `logs --errors` is empty in exactly the
scenario it exists for (all 3 dogfood agents hit this). **Decision:** initialize the same file
logger (`src/shared/logger.ts`) in `mcpCommand` (`src/cli/commands/mcp.ts`) as `serve` does, writing
warnings + errors (with stack traces) to `.substrate/logs/substrate.log`. After an MCP session that
errored, `logs --errors` must show it. Confirm the log is gitignored (it is) and never contains
secrets (agent_name is scrubbed per existing logger design).

### B5 — `version_mismatch` omits `current_version` (MED — reopens a locked decision)
**Root cause:** by the Phase-2 OCC lock (PRD §6.11, `decisions.md`), `version_mismatch` deliberately
omits `current_version` to force a full re-read (`src/mcp/tools/write/substrate-edit.ts:15`,
`src/storage/repositories/tasks.ts`). 3 dogfood agents independently asked for it — a concurrent
writer needs a wasted `get_task` just to fetch the integer. **Decision (needs Diego — reopens a
locked decision):** *(Recommended)* include `current_version` in `error.details` **while keeping the
"you must re-read and reconcile before retrying" guidance in the message.** Rationale: the anti-blind
-overwrite intent is served by the *message + the requirement to reconcile*, not by hiding one
integer; withholding it just adds a round-trip. Alternative: keep it hidden (status quo). This is a
contract change to a locked decision — do not ship without Diego's sign-off; record the reversal in
`decisions.md`.

### B7 — cause-aware missing-DB diagnostic (the greenlit warn, sharpened)
**Root cause:** `substrate mcp` refuses only if `.substrate/` is missing (`mcp.ts:32-35`); libsql
**creates `data.sqlite` on open** (`client.ts:36-40`), so a git worktree (committed boards, gitignored
DB) silently gets a fresh empty board. **Decision (greenlit by Diego):** replace the silent create
with a **cause-aware startup diagnostic** — full design in
[shared-db-architecture-20260707.md](../shared-db-architecture-20260707.md) §4 Phase A:
- **Broken explicit pointer** (env/link/registry → path missing) ⇒ **ERROR, do not create**: "…Did
  you move or rename this project? Re-point with `substrate link <path>`."
- **Fresh worktree/clone** (boards present, DB just-created empty, no pointer) ⇒ **WARN, proceed**:
  "task state isn't shared — `substrate link <main>/.substrate`."
- Surface the **resolved root + how it was resolved** in `substrate diagnose`.
(The pointer/link/registry resolution itself is Phase B of the arch doc — this plan ships only the
*diagnostic*; it degrades gracefully to just the fresh-worktree WARN until Phase B lands.)

### DX — per-subcommand `--help` (LOW)
`substrate logs --help` / `mcp --help` / `init --help` → `Unknown flag` (`src/cli/index.ts`). Add
per-subcommand help output. Small; include if cheap.

## Implementation order
1. **B4** — wire `shared/logger.ts` file logging into `mcpCommand`; add an integration test that
   spawns `substrate mcp`, triggers a handled error, and asserts `.substrate/logs/substrate.log`
   contains it (and `logs --errors` prints it).
2. **B7** — the fresh-worktree WARN in the DB-open path (`mcp.ts`/`serve.ts` → `client.ts` open),
   guarded on "boards present + DB just created" (return a `created: boolean` from
   `openDatabaseAndMigrate`); diagnose provenance line. (Broken-pointer ERROR arrives with Phase B.)
3. **B5** — *pending Diego* — add `current_version` to `version_mismatch` details; keep the message;
   update the tool descriptions + `decisions.md`.
4. **`--help`** — per-subcommand usage in the CLI dispatcher.

## Acceptance criteria (validate locally)
- After an MCP session that errored, `substrate logs --errors` shows it (was: empty).
- A simulated worktree (committed `.substrate/` + no `data.sqlite`) → running `substrate mcp` prints
  the fresh-worktree WARN and `diagnose` shows the resolved root + provenance; a real first `init`
  does **not** warn.
- *(if approved)* `version_mismatch.details.current_version` is present; message still says re-read.
- `pnpm lint`/`format`/`tsc`/tests green.

## Risks
- **R1 (B5):** reopening a locked OCC decision — Diego sign-off required; document the reversal.
- **R2 (B4):** two processes (serve + mcp) writing one log file → ensure the logger append is
  concurrency-safe (or per-process log naming). Verify with the concurrency smoke.
- **R3 (B7):** false-positive WARN on legitimate empty boards — gate strictly on "boards exist AND
  data.sqlite was created THIS open," not merely "zero tasks."

## DoD
Branch `fix/dogfood-observability`; step commits; local validation green; merge; `decisions.md`
updated if B5 is approved. B7 cross-references the arch doc Phase A.
