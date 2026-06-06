# Phase 7 Audit — `substrate init --template web-delivery` + `substrate explain` (v0.2.0)

**Date:** 2026-06-06
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-07-init-templates-and-explain`
**HEAD:** `b8ea860` — `chore(phase-07): acceptance pass + 0.2.0 lockstep (Step 4)`
**Commits this phase produced:** 4 on top of `main` (`f2142f8`, which already carries the Phase 7 spec+plan doc commit).

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (APPROVED 2026-06-06; §3.0 product-owner decisions locked — inline SVG over Mermaid, opt-in template, default `./substrate-explain.html`; Architect Reviewer CONCERN 1/3/4 + NIT 5/6 folded in) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1 APPROVE-WITH-CHANGES; B1 head-compare flag fix + C1–C4 + N1 incorporated; 4 steps, ONE consolidated review gate) |
| Stage 3 — Development | DONE — Steps 1–4 committed (4 commits, 1:1 with the plan's steps); lint/format/types/build all clean |
| Stage 4 — QA | DONE — 472 server tests + 10 ui green; concurrency smoke (60s) green; dry-run ships the bundled template; first-hand init/explain end-to-end smoke green |
| Stage 5 — Phase-end | DONE with notes (accepted residuals: 3 Code-Reviewer NITs left open; template duplicates the example board under a parse-equal drift guard; 413 KB UI bundle carried forward; CI unproven on this branch; OPERATOR-ONLY publish boundary) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-07-init-templates-and-explain-spec.md` — `Status: APPROVED (incorporates Architect Reviewer changes + product-owner rendering decision) — ready for planning.` |
| 2 | No development without an approved plan | `.agents/plans/phase-07-init-templates-and-explain.md` — `Status: Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES; B1 + C1–C4 + N1 incorporated) — ready for development.` |
| 3 | No commits without code review | **Concrete in-repo artifact this phase:** `943bc56 fix(review): address Phase 7 Code Reviewer findings (Step 3)`. The review found **no BLOCKERs**; it fixed 3 CONCERNs (C1 archived-group edge orphan, C2 dead `conditionalSuggestions` not rendered + dead `boardSvg` wrapper, C3 a real parse-gate rejection test) and **honestly named the 3 NITs left open** in the commit body. Verified the commit's diff matches its message (flow.ts edges over live groups only; render.ts now renders the conditional-suggestions section; svg.ts `boardSvg` removed; +2 tests). The strongest Gate-3 trail of the recent phases. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied. Gate 3 has a substantive `fix(review)` commit (like Phase 5b, stronger than Phase 6's folded-in finding).

## Process deviations (verified, documented honestly)

1. **The spec+plan doc landed on `main` before the feature branch** (same as Phase 6). `main` is at `f2142f8 docs: Phase 7 spec + plan (reviewed) …`, and the first feature commit `83ad857`'s parent is `f2142f8` — so the 4 implementation commits branch off the doc commit that already sits on `main`. The canonical flow would keep the doc commit on the feature branch too; here it was committed to `main` first. **Non-blocking; identical to the Phase 6 pattern; `main` was not pushed.** `main..HEAD` is exactly the 4 implementation commits.

2. **No deviation in commit choreography (unlike Phase 6).** The 4 commits map 1:1 to the plan's 4 steps: Step 1 (`83ad857`), Step 2 (`aad09fa`), Step 3 (`943bc56`), Step 4 (`b8ea860`). The planned `docs(phase-07): assistant audit` is this document, landing separately. All 4 carry the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer. Working tree is clean at `b8ea860`.

## Commit list (`main..HEAD`)

```
b8ea860 chore(phase-07): acceptance pass + 0.2.0 lockstep (Step 4)
943bc56 fix(review): address Phase 7 Code Reviewer findings (Step 3)
aad09fa feat(cli): substrate explain — self-contained inline-SVG HTML map (Step 2)
83ad857 feat(cli): init --template web-delivery (bundled .ts template + registry) (Step 1)
```

Maps 1:1 to the plan's 4-step choreography. The version bump + acceptance pass folds into `b8ea860` (Step 4). This audit doc lands separately as the planned `docs(phase-07): assistant audit`. **No commit-consolidation deviation** — every planned commit (including the conditional `fix(review)`) is present.

## Spec §4 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `substrate init` (no flag) → unchanged blank `.substrate/`, gitignore block, no board | PASS | `init.ts` writes a board only inside `if (opts.template !== undefined …)`; bare-init tests pass unchanged. First-hand: bare `init` leaves `boards/` empty. |
| 2 | `init --template web-delivery` → blank init **plus** `boards/delivery.json`; loads + validates; Done gate engages | PASS | First-hand via the built dist binary: prints `Starter board 'delivery' added (template: web-delivery).` and writes `delivery.json`. `example-substrate.test.ts` round-trips `loadSubstrate` + asserts the `* → done` gate blocks/passes. |
| 3 | `init --template=web-delivery` (equals form) | PASS | `extractFlagValue` splits on `=`; `args.test.ts` covers it; first-hand `--template=web-delivery` wrote the board. |
| 4 | `init --template bogus` → error listing templates; `.substrate/` **NOT** created | PASS | `init.ts` validates the name **first** (`isTemplateName`) and throws `schemaViolation` before `existsSync`/any fs work. First-hand: `test ! -d .substrate` after a bogus run. `init.test.ts` asserts `!existsSync(root)`. |
| 5 | `init --template` (no value) → error `--template requires a value` | PASS | `extractFlagValue` exits with `--template requires a value: --template <value>` when the next token is absent or `-`-prefixed. |
| 6 | `--template` on a non-init command → rejected | PASS | `rejectUnknownFlags` head-compares `arg.split('=')[0]` against the per-command allowlist; `--template` not in any other set. |
| 7 | `init --template bogus` when `.substrate/` exists → **template-name error wins** | PASS | Name validation precedes the conflict check in `init.ts` (locked ordering). `init.test.ts` covers it. |
| 8 | `init --template web-delivery` when `.substrate/` exists → existing `conflict` | PASS | name OK → `existsSync(root)` fires `SubstrateError.conflict`. |
| 9 | template write fails mid-init → partial `.substrate/` rolled back | PASS (by read) | board written inside the existing try/`catch → rm(root)` window, after the db init and before `updateGitignore`. **NIT:** no dedicated mid-write-failure rollback test (see Residuals). |
| 10 | `explain` with no `.substrate/` → normal `SubstrateError`; no file written | PASS | `explain.ts` throws `notFound` on `!existsSync(root)`; `explain-cli.test.ts` asserts the error **and** no file written. |
| 11 | `explain` empty substrate → valid HTML "No boards yet"; exit 0 | PASS | `render.ts` short-circuits to a "No boards yet" `pageShell`; `explain-cli.test.ts` "renders 'No boards yet'". First-hand bare-init → explain produced the file. |
| 12 | `explain --out path` / default `./substrate-explain.html`; prints abs path | PASS | `resolve(cwd, opts.out ?? 'substrate-explain.html')`; stdout `Wrote substrate explanation to <abs path> (<N> board(s)).` `explain-cli.test.ts` "honors --out". |
| 13 | `"*" -> done` guard → one gate annotation on `done`, NOT an edge from every group | PASS | `flow.ts` rule 3: wildcard target sets `node.gated=true` + one edge from synthetic `__any__`. `flow.test.ts` "ONE gate annotation, not an edge from every node" (asserts exactly 1 wildcard edge, `done.gated===true`). |
| 14 | guard referencing a missing group id → listed in policy section, edge skipped, no invented node | PASS | `flow.ts` guards on `liveIds.has(fromGroup/toGroup)`; `flow.test.ts` "a guard referencing a missing group draws no edge". `render.ts` still lists it via `guardDetail`. |
| 15 | multiple concrete guards on one `from→to` edge → ONE edge (`N gates`); all listed | PASS | `flow.ts` groups by `${from} ${to}` key; label `${n} gates` when `conds.length>1`. `flow.test.ts` "collapse to ONE '2 gates' edge". |
| 16 | non-adjacent concrete guard (`backlog → done`) → truthful long labeled edge; backbone only suppresses the adjacent plain edge | PASS | suppression keyed on the exact adjacent pair only; `flow.test.ts` "non-adjacent … truthful long edge; backbone still connects neighbors" (asserts both `a→b` and `b→c` backbone survive alongside `a→c` guard). |
| 17 | archived group present → rendered, styled + `(archived)`; NOT on the backbone | PASS | `flow.ts` splits active/archived; backbone iterates `nodes` (active) only; `svg.ts` `archived` class + `(archived)` tspan. `flow.test.ts` "archived groups are off the backbone but still rendered". |
| 18 | guard/responsibility on `task.group_id` → literal `group_id` (no `custom_data` fallback) | PASS | `conditions.ts` `fieldName` strips the `task.` prefix; the page LEGEND carves out the literal fields (`group_id`, `title`, …). `conditions.test.ts` covers literal-vs-custom. |
| 19 | `agent_responsibility` `when` on `scope` / empty `when` → not on graph; in conditional list | PASS | `flow.ts` `groupScopedTarget` returns non-null only for a single `task.group_id eq` leaf; everything else → `conditionalSuggestions`. `flow.test.ts` rule 4 asserts attach vs. conditional. |
| 20 | name with `" < > & ' <script>` / newlines → HTML-escaped in HTML, XML-escaped in SVG; file valid + renders | PASS | First-hand hostile-board render (below): no raw `<script>`/`<img onerror>`, all escaped to `&lt;…&gt;`, zero `<script>` tags, valid `<svg`. `html.test.ts` covers `escHtml`/`escXml`/`slugify`. |
| 21 | malformed `definition` in a schema-valid board → `(unparseable condition)`; no crash | PASS | `conditions.ts` degrades to `(unparseable condition)` on any unrecognized shape (never throws). `conditions.test.ts` covers it. |
| 22 | `explain` with `.substrate/` but no `data.sqlite` → works (DB never opened) | PASS | `explain.ts` calls `loadSubstrate` only; first-hand: removed `data.sqlite`, `explain` still wrote the map. `explain-cli.test.ts` "works with data.sqlite absent". |
| 23 | shipped `.ts` template diverges from `examples/` → parse-equal drift test fails | PASS | `example-substrate.test.ts` canonicalizes (key-sorted, deep) both the `.ts` `WEB_DELIVERY_BOARD` and the `examples/` JSON and asserts equality — fails on divergence; not byte-identity. |

## Version lockstep (spec §3.6 — 4 sources + 1 guard)

Independently verified — all four sources read `0.2.0`, `BINARY_SCHEMA_VERSION` stays `2`, no migration file added:

- `src/core/version.ts` `BINARY_VERSION` → `'0.2.0'`; `BINARY_SCHEMA_VERSION = 2` (unchanged).
- `package.json` `version` → `0.2.0` (build prints `@diegoferreyra/substrate@0.2.0`).
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` is **derived**: `` `v${BINARY_VERSION} (init templates + explain)` `` — cannot drift from `BINARY_VERSION`.
- `CHANGELOG.md` has a `[0.2.0]` entry (added: `init --template <name>` / `web-delivery`, `explain [--out]`, "No external assets").
- **Guard (test, not a source):** `whoami.test.ts:76` `expect(result.phase).toContain(\`v${BINARY_VERSION}\`)` preserves the `PHASE_STRING ⊇ BINARY_VERSION` invariant; line 77 `toMatch(/init templates|explain/)` is the updated copy assertion (the old `/public release/` is gone). The whole suite (472) is green, including this guard.

## `explain` feature/security review (the headline deliverable)

The load-bearing invariant is **no author string reaches the output unescaped, no markdown, no `<script>`/external refs**. Independently verified:

- **Two distinct escaping passes exist and are both used.** `html.ts` `escHtml` escapes `& < > " '` (HTML text/attribute); `escXml` escapes `& < > "` (SVG `<text>`/`<title>`). `render.ts` routes every HTML-context author string through `escHtml` — board/group/policy `name`+`description`, `config.project_name`+`description`, field `name`, field `type`, enum `values` (`.map(escHtml)`), `format`, the `from → to` transition, `describeConditions` output, `on_failure_message`, responsibility `message`, conditional-suggestion `policyName`/`when`/`message`. `svg.ts` routes every node/edge label and `<title>` tooltip through `escXml`+`truncate`.
- **Group ids in `id=`/`class=` are slugified, not escaped (attribute-injection vector closed).** `flow.ts` sets `slug: slugify(g.id)`; `html.ts` `slugify` strips to `[A-Za-z0-9_-]` and never returns empty (`'x'` fallback). `html.test.ts` proves a crafted `x" onload="alert(1)"><script>` id reduces to a safe slug.
- **First-hand hostile render.** I built `dist` and rendered a substrate whose every name/description/field/value/`on_failure_message`/policy-name was `<script>alert(1)</script>"><img src=x onerror=alert(2)>`. Result: `<script>alert(1)` absent, `<img … onerror=alert(2)>` absent, present as `&lt;script&gt;`, **zero `<script` tags**, no `<script src=`, a valid `<svg` block, and the evil id did not break any `id=` attribute. The only `http(s)://` substring in the output is the fixed SVG `xmlns="http://www.w3.org/2000/svg"` namespace literal (confirmed by isolating it — the empty-doc has none), **not** an external fetch.
- **No markdown in the CLI path.** `html.ts` header documents the deliberate choice; `render.ts` imports neither `marked` nor `DOMPurify`. The C7 build-isolation grep (`dist/server/` for `react|marked|dompurify`) returns no matches — `explain` pulled in no markdown library.
- **Reads substrate-as-code only.** `explain.ts` calls `loadSubstrate(root)` and never opens `data.sqlite`. First-hand: deleted `data.sqlite`, `explain` still produced the map.

## Edge-derivation correctness (spec §3.5.2 — the four locked rules)

Derivation routes through the **engine's own parsers**, not ad-hoc `definition[...]` reads:

- `flow.ts` imports `parseGuardDefinition` (`src/policy/transition-guard.ts`) and `parseResponsibilityDefinition` (`src/policy/agent-responsibility.ts`). `parseGuardDefinition` returns `null` when `from_group`/`to_group` aren't strings → such a guard draws **no edge** (verified by reading the parser: lines 27–29 `if (typeof from !== 'string' || typeof to !== 'string') return null`).
- **Rule 1 (backbone):** consecutive non-archived groups by `position`; suppressed only for the exact adjacent pair a concrete guard overlaps.
- **Rule 2 (concrete guards):** grouped by `from→to` key → one edge; `N gates` label on collapse; non-adjacent → truthful long arc; missing/archived target → no edge (policy-list only).
- **Rule 3 (`* → X`):** one gate annotation on X + one edge from the synthetic `__any__` node; never N edges.
- **Rule 4 (responsibility attach):** single `task.group_id eq <gid>` leaf attaches to that node; everything else → the per-board conditional-suggestions list (which is now actually **rendered** — the Step-3 C2 fix).
- **Step-3 C1 fix verified:** a `transition_guard` targeting an **archived** group now draws no edge (edges derived over `liveIds` only), and `hasAny` is set only when a wildcard targets a **live** node — closing the dangling-`any stage`-box bug. `flow.test.ts` "a guard targeting an ARCHIVED group draws no edge (no orphan/drop)" asserts `edges.some(e=>e.to==='done')===false` and `hasAny===false`.
- Determinism: nodes sorted by `position` then `id`; policies by `priority` then `created_at` then `id`. `flow.test.ts`/`svg.test.ts` assert byte-stable output.

## Bundled template (spec §3.2–3.3)

- **The `.ts` module compiles straight into `dist/` — no post-build copy.** First-hand `corepack pnpm@9.15.9 build` then `ls dist/server/cli/templates/` shows `web-delivery.board.js` (13 KB) + `index.js`. A "missing-from-dist" failure is structurally impossible — it is an ordinary module import.
- **`loadTemplateBoard` calls `BoardSchema.parse`** — verified in source (`index.ts:36`) **and** in the compiled `dist/server/cli/templates/index.js` (grep found `BoardSchema.parse`). This is the only validation gate (`createBoardFile` writes verbatim). The Step-3 C3 test proves the gate rejects a corrupt board (`BoardSchema.parse({ id:'x', name:'x' })` and a `groups:'nope'` mutation both throw).
- **Single source of truth + drift guard:** the `examples/web-delivery/.substrate/boards/delivery.json` JSON is authoritative; the `.ts` mirrors it; `example-substrate.test.ts` asserts canonicalized parse-equality (not byte-identity). The template's `gate-done` (`* → done`) + four sequential gates + three responsibilities are present and render correctly.

## npm packaging (spec §5)

- **`pnpm publish --dry-run` ships the template.** First-hand: `diegoferreyra-substrate-0.2.0.tgz`, **94 files** (+9 over Phase 6's 85 = the `explain/` modules + `templates/`), `dist/server/cli/templates/web-delivery.board.js` (12.8 kB) **present in the tarball listing**, all `explain/*.js` present. Whitelist-exact: only `dist/**` + `README.md` + `LICENSE` + `CHANGELOG.md` + `package.json` — **no `src/`, `tests/`, `examples/`, `.substrate/`, `ui/src`, `CONTRIBUTING`/`SUPPORT`, or dotfiles** (grep for leaks returned CLEAN). No vendored library, no new asset — the whitelist is unaffected, exactly as the spec predicted.
- **Bare `init` stays blank (opt-in)** — verified first-hand and in the unchanged init tests.
- **`explain` reads substrate-as-code only (no DB)** — verified first-hand with `data.sqlite` deleted.

## Test results (first-hand this audit)

| Suite | Files | Tests | Result |
|---|---|---|---|
| `corepack pnpm@9.15.9 test` (server unit + integration) | 62 | **472** passed | green (17.5 s) |
| Targeted: templates + init + args + explain + drift | 9 | **57** passed | green (0.9 s) |
| `corepack pnpm@9.15.9 --dir ui test` (jsdom) | 3 | **10** passed | green (1.2 s) |
| `corepack pnpm@9.15.9 exec tsc --noEmit` (root) | — | — | clean (exit 0) |
| `corepack pnpm@9.15.9 exec eslint .` (root) | — | — | clean (exit 0) |
| `corepack pnpm@9.15.9 exec prettier --check .` | — | — | clean ("All matched files use Prettier code style!") |
| `corepack pnpm@9.15.9 build` (server + ui) | — | — | clean (ui 413.35 KB JS / 15.55 KB CSS, exit 0) |
| `corepack pnpm@9.15.9 test:smoke:concurrency` (60 s) | 1 | 1 passed | green (60.4 s) |
| `pnpm publish --dry-run` (after build) | — | — | 94 files, whitelist-exact, template present, exit 0 |
| dist template + parse-gate + C7 isolation greps | — | — | `web-delivery.board.js` in dist; `BoardSchema.parse` compiled; no react/marked/dompurify in dist/server |
| First-hand CLI: `init --template` / `init --template=` / `init --template bogus` / bare `init` / `explain` / `explain --out` / `explain` DB-absent | — | — | all behave per spec (built-dist binary) |
| First-hand hostile-board `explain` render | — | — | no raw script/markup; all escaped; valid SVG; no external ref |

**472 server passing** — +50 over Phase 6's 422 (the `explain` generator suites — `conditions`/`flow`/`html`/`render` — plus the `init --template`, registry, drift, and arg-parsing tests). The manual MCP smoke (`run-smoke.mjs`) carries an `explain` step (asserts exit 0 + `<svg` + no `<script>`); I verified the step by reading it but did not spawn the full stdio manual smoke in this audit (carried green this session — see residual 5). Playwright UI smoke not re-executed (unchanged this phase; CI wires it on macOS).

## Coverage notes (tested vs. gaps)

**Well covered.** `explain` is the most-tested surface this phase: the condition→prose operator table, the four locked edge rules (each with a dedicated `flow.test.ts` case incl. the `*→done` "not N edges" and the Step-3 archived-target fix), the two escaping passes + slug sanitization + a hostile-name assertion, and a CLI integration test exercising default/`--out`/empty/DB-absent/no-`.substrate`. The template path is verified at three depths: registry parse-gate (rejects garbage), the canonicalized drift test, and a first-hand `init --template` round-trip. Packaging is verified by dry-run file list (template present) + C7 isolation grep.

**Gaps / thin spots (none blocking):**

1. **No mid-init write-failure rollback test (Code-Reviewer NIT, left open).** The board write sits inside the existing try/`rm(root)` rollback window (read-verified), but no test forces a write failure to assert the partial `.substrate/` is removed. Low risk — the rollback path is the same one Phase 1 exercised for db-init failure.
2. **Manual stdio MCP smoke + Playwright not re-executed in this audit** — the `explain` smoke step is verified by code read; the vitest + concurrency suites were re-run first-hand. Accepted on the same basis as prior phases.
3. **`explain` output not opened in a real browser this audit.** The spec's optional "open it by hand" check is documented, not automated. The file is asserted valid (`<!doctype html>`, `<svg`, no `<script>`) by test and first-hand grep; the live visual render is unobserved (low stakes — a self-contained local file).

## Scope deviations from spec

1. **`svg.ts` ↔ `flow.ts` split (vs. the spec's single `svg.ts`).** The spec/plan named `src/explain/svg.ts` as the board→SVG module. The implementation split it into `flow.ts` (pure edge-derivation model — `buildFlowModel`) + `svg.ts` (`renderModel` — model→SVG string). This is a cleaner separation (the model is testable without SVG string-matching) and `flow.test.ts` exercises the locked rules directly. **Improvement, not a gap; all spec'd `svg.test.ts` behaviors are covered by `flow.test.ts`.**
2. **`explain.ts` adds its own `existsSync(root)` → `notFound`** rather than relying solely on `loadSubstrate` to surface the no-`.substrate/` error. Same observable behavior (a `SubstrateError`, no file written), with a clearer message. **Non-blocking.**
3. **Dead `--no-starter-board` flag (Code-Reviewer NIT, left open).** It is in `ALLOWED_FLAGS_BY_COMMAND.init` and accepted by the parser, but `init.ts` never reads it (only `opts.template`). A leftover from an earlier design; harmless (accepted-but-ignored). **Flagged as residual.**

## Residual risks / deferrals (flagged, not fixed)

1. **R1 — 3 Code-Reviewer NITs left open (named in the `fix(review)` body).** (a) no mid-init write-failure rollback test (scope deviation 1); (b) the dead `--no-starter-board` flag (deviation 3); (c) a space-form `--out`/`--template` **value beginning with `-`** is read as a missing value and errors (`extractFlagValue` treats a `-`-prefixed next token as absent) — a filename like `-weird.html` must use the `=`-form (`--out=-weird.html`). All three are cosmetic/edge; **accepted, tracked for a follow-up.**
2. **R2 — the bundled template duplicates the example board.** `web-delivery.board.ts` mirrors `examples/web-delivery/.substrate/boards/delivery.json`. The duplication is **guarded by the canonicalized parse-equal drift test** (`example-substrate.test.ts`), which fails on divergence — so the two cannot silently drift. **Accepted; the drift test is the guardrail.**
3. **R3 — 413 KB single-chunk UI bundle (carried from 5b/6).** Unchanged this phase (`explain` is CLI-only, adds nothing to the UI). No code-splitting, no CI bundle budget. **Accepted for v1.**
4. **R4 — CI has not run on this branch.** `feature/phase-07-init-templates-and-explain` is not pushed to origin; no GitHub Actions run exists. The three workflows (ci/publish/auto-close) are unchanged this phase and ran green on Phase 6 (ubuntu+macos per the plan), but the Phase 7 diff has never been CI-exercised. **Operator step — confirming CI green on the real PR.**
5. **R5 — Manual MCP smoke + Playwright not re-executed in this audit.** The `explain` smoke step is verified by code read; carried green this session. **Accepted on the prior-phase basis.**
6. **R6 — OPERATOR-ONLY boundary (unchanged from Phase 6 §6).** The agent stops at `phase-07-complete`. The live `npm publish`, the real `v0.2.0` tag push (which fires `publish.yml`), and the npm token/`NPM_TOKEN` secret are **all Diego's**. This phase ships in-repo + dry-run-verified; nothing here pulls the release trigger. **By design.**

## Verdict

**PASS-WITH-NOTES — go for fast-forward merge to `main` + tag `phase-07-complete` (live publish + `v0.2.0` tag push remain operator-gated).**

Phase 7 substantively meets every spec §4 acceptance criterion. Both headline deliverables are correct and independently re-verified. **`init --template web-delivery`** is opt-in (bare `init` stays byte-for-byte blank, confirmed first-hand and by unchanged tests), validates the template name **first** (so `--template bogus` leaves no `.substrate/` and wins over the existing-dir conflict), bundles the board as a type-checked `.ts` module that compiles straight into `dist/` (verified `web-delivery.board.js` in both `dist/` and the dry-run tarball — a missing-from-dist failure is structurally impossible), and gates write-time validity through `loadTemplateBoard`'s `BoardSchema.parse` (the only validation, since `createBoardFile` writes verbatim — and a Step-3 test proves the gate rejects garbage). **`substrate explain`** emits one self-contained, offline HTML file with a hand-rolled inline-SVG diagram, reads substrate-as-code only (works with `data.sqlite` absent — confirmed first-hand), and is safe: a first-hand hostile-board render produced zero `<script>` tags, no unescaped markup, no external refs, and a valid SVG — every author string routes through `escHtml`/`escXml` and every group-id slug through `slugify`. The four locked edge-derivation rules hold, derived through the engine's own `parseGuardDefinition`/`parseResponsibilityDefinition` (a parser-`null`/non-engaging guard draws no edge), including the Step-3 fix that a guard targeting an archived group draws no edge (no orphan `any stage` box). Version lockstep is at `0.2.0` across all four sources with `PHASE_STRING` **derived** from `BINARY_VERSION` (cannot drift) and the `⊇` guard preserved; `BINARY_SCHEMA_VERSION` stays `2`, no migration.

All four workflow hard gates are satisfied — and Gate 3 has a **real, substantive `fix(review)` commit** (`943bc56`) that fixed 3 CONCERNs (no BLOCKERs) and honestly named the 3 NITs it left open. All locally-runnable gates pass: **472 server + 10 ui tests** (0 failures), root tsc/eslint/prettier clean, build clean, 60s concurrency smoke green, dry-run whitelist-exact (94 files, template present, no source/test leakage), C7 server-isolation grep clean.

The notes are residual/process, not code: 3 Code-Reviewer NITs left open (no mid-init rollback test; the dead `--no-starter-board` flag; a space-form value starting with `-` errors — use the `=`-form); the bundled template duplicates the example board (guarded by the parse-equal drift test); the 413 KB UI bundle carries forward unchanged; CI has not yet run on this branch; and the spec+plan doc landed on `main` before the feature branch (same as Phase 6, `main` not pushed). None block the merge; all are consistent with the spec's locked decisions and the OPERATOR-ONLY release boundary.

Recommended next actions (Orchestrator):
1. Fast-forward merge to `main`, tag `phase-07-complete`. **Do NOT push the `v0.2.0` tag or publish — operator triggers (§6).**
2. **Operator (Diego):** push the branch → confirm CI green on the real PR (the first CI exercise of the Phase 7 diff) → review `pnpm publish --dry-run` for the 0.2.0 tarball → push the real `v0.2.0` tag to fire `publish.yml`.
3. **Carry as a small follow-up:** the 3 open NITs (mid-init rollback test; remove the dead `--no-starter-board` flag; accept space-form values beginning with `-`); consider a CI bundle-size budget for the UI chunk.
4. Flip plan status to `Complete`.
