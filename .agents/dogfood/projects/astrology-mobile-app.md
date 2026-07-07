# Dogfood — astrology-mobile-app (`code`)

## Profile

- **Slug / repo:** `code` — `/Users/diegoferreyra/WebDevelopment/astrology-mobile-app/code`
- **Kind of work:** mobile app build; sprint pipeline with human-approval + merge gates
- **Agents / roles:** claude-code (Opus 4.8), a **setup/probe** session (authoring + gate validation)
- **Boards:** `ideation` + `sprints` (authored this session)
- **Policies authored:** 12 counted; **5 gates** (`gate-closed`, `gate-idea-has-writeup`, `gate-product-plan-approved`, `gate-tech-plan-approved`, `gate-qa-approved`) + `note-tech-plans` suggestion. **Only 1 of 5 gates validated live.**
- **Report date:** 2026-07-07 · Substrate v0.5.0

## Instrumented data

- **`logs --errors`:** **`.substrate/logs/` does not exist at all** — MCP-runtime-spawned server leaves no on-disk trace; a silently-misfired gate would not be caught. `mcp --help`/`init --help` → `Unknown flag`.
- **Boards:** both authored by **hand-writing JSON files** (create_board/group/policy tools never used).

## Agent reports (normalized)

#### Report — astrology-mobile-app · claude-code (setup/probe) · 2026-07-07
- **Friction:** `whoami` dumped **~2.5 KB of static board descriptions** (config, not in-flight state) — "wrong payload, too big for orientation." No per-subcommand `--help`. create/update envelopes **well-sized** (no issue).
- **Errors hit:** `transition_blocked` (gate-closed) → **recovered from message alone** (named both missing fields + folder path); next update passed. `version_mismatch` → **`current_version` NOT in `details`** — only knew it was `2` from the prior envelope; a real concurrent writer needs a wasted `get_task` for the integer. **Put `current_version` in the error.**
- **Policy changed behavior?:** **partly** — the **GATE (`gate-closed`) genuinely redirected** (stopped an invalid Closed move; enforces merge/human-approval discipline an eager agent would skip = **real value**). The **SUGGESTION (`note-tech-plans`) was pure echo** (agent authored it). "Gates = signal, suggestions = noise when the acting agent is also the author."
- **Suggestions noticed & acted on?:** **acted on the block message** (drove exact next call); but on the **successful** move `policies_fired` listed `gate-closed` with **no `message` field** → bare clutter. Inconsistent: agent_responsibility carries a message, a passed guard carries nothing.
- **Bail moment?:** **yes — abandoned the board-authoring API entirely** (wrote JSON files). `sprints` alone ≈ 15 sequential MCP calls; two hand-written files were faster + reviewable as a diff. **AUTHORING.md itself blesses this** → the authoring tool surface loses to a text editor.
- **Missing capability:** **no `validate`/lint** (do policy `definition`s parse? do `from_group`/`to_group`/`field` refs resolve?) and **no dry-run** ("would moving X to `closed` be allowed?"). To test one gate needed create→block→pass→archive (4 calls + a soft-deleted corpse). `diagnose` counts policies but validates none.
- **Situational awareness from board alone?:** **no** — `whoami` gives *shape* (stages, gates), zero *state* (no per-group counts, nothing "blocked awaiting human"). Need `list_tasks` per board + manual aggregate; **no rollup**.
- **Staleness:** n/a this session (probe left boards clean) — but see the "silently-dead gate" risk below.
- **Biggest single change requested:** ship **`substrate validate`** (policy-definition + referential-integrity lint) **+ dry-run transition**. Verified only **1 of 5 gates**; the other 4 are unproven, and *"a silently-dead gate is worse than no gate — it looks enforced."*
- **Signal tags:** `friction:whoami` `unrecoverable-error:version_mismatch(partial)` `policy-redirect` `policy-noise` `suggestion-ignored` `bail` `missing:validate` `missing:dry-run` `awareness-gap`
