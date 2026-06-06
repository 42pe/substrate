# Phase 7 Plan — `init --template` + `substrate explain` → v0.2.0

**Status:** Reviewed v1.1 (Architect Reviewer APPROVE-WITH-CHANGES; B1 + C1–C4 + N1 incorporated) — ready for development.
**Author:** Architect
**Last updated:** 2026-06-06
**Spec:** [`specs/phase-07-init-templates-and-explain-spec.md`](specs/phase-07-init-templates-and-explain-spec.md) (APPROVED — Architect Reviewer changes + product-owner rendering decision folded in)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md) (post-v1 adoption/ergonomics work)
**Workflow:** [`../workflow.md`](../workflow.md)
**Predecessor:** Phase 6 (`phase-06-complete`, v0.1.0) — OSS artifacts + CI + npm publishing config + full `reverse_captcha`. Toolchain is now **pnpm 9.15.9** (`packageManager` pin via corepack); CI green on ubuntu + macos.
**Feature branch:** `feature/phase-07-init-templates-and-explain`

---

## 1. Overview

Phase 7 adds two **opt-in, additive** CLI features that make a substrate easier to **adopt** and easier to **understand**:

1. **`substrate init --template web-delivery`** — writes a bundled starter board (the `examples/web-delivery` delivery board) into `.substrate/boards/`. Opt-in only: **bare `substrate init` stays byte-for-byte blank** (no regression). The template ships as a **type-checked `.ts` module** compiled straight into `dist/` (no post-build copy, no `resolveJsonModule`, no side-car asset), so it works for `npx` users where `examples/` does not ship.
2. **`substrate explain [--out <file>]`** — generates one **self-contained, offline HTML file** explaining the substrate: per board a **hand-rolled inline-SVG** flow diagram (CSS `:hover` + SVG `<title>` tooltips — **zero new deps**, no Mermaid/CDN/vendored lib), the `field_schema` table, and the policy list with human-readable conditions. `explain` reads **substrate-as-code only** (`loadSubstrate`; never opens `data.sqlite`).

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. Additive features → `BINARY_VERSION` → **`0.2.0`** at acceptance (Step 4).

**4 steps, ONE consolidated Code Reviewer gate (Step 3).** Two independent features land first (Steps 1–2), then the single reviewer pass over the whole diff, then acceptance + version bump + audit + merge (Step 4).

## 2. Branching & merge strategy

- Create `feature/phase-07-init-templates-and-explain` from `main` (tag `phase-06-complete`).
- Commit per step. ONE Code Reviewer pass (Step 3).
- Fast-forward merge to `main`, no squash, tag **`phase-07-complete`**.
- **The `v0.2.0` release tag is NOT pushed by the agent** — it is the operator trigger that fires `publish.yml`. The agent stops at `phase-07-complete`, everything publish-ready + dry-run-verified.

## 3. Implementation order

### Step 1 — `init --template <name>` (Backend Engineer)

Add the opt-in starter-board template, bundled as a type-checked `.ts` module, wired into `initCommand` with the **locked error ordering**.

**Bundled template module + registry (spec §3.2, §7-R6):**
- **`src/cli/templates/web-delivery.board.ts`** (new) — `export const WEB_DELIVERY_BOARD = { /* the delivery board */ } as const satisfies Board;` (C1: this is the **one form that compiles** under the real tsconfig — `strict`, `exactOptionalPropertyTypes`, `nodenext`, `verbatimModuleSyntax`: bare `satisfies Board` WITHOUT `as const` fails because an enum field's `type: "enum"` widens to `string`, and `as const` on a *reference* is a TS1355 error — so `as const satisfies Board` **on the literal** is locked; drop any "or satisfies Board" phrasing). `Board` is a **type-only import** (`import type { Board }`); `BoardSchema` is a **value import** — both required under `verbatimModuleSyntax` (N1). Its content **mirrors** `examples/web-delivery/.substrate/boards/delivery.json` (the human-facing authoritative reference). tsc compiles it to `dist/server/cli/templates/web-delivery.board.js` like any other source file — **no post-build copy, no `resolveJsonModule`, no runtime file read**, so a "bundled-template-missing-from-dist" failure is *impossible* (it is an ordinary module import). It is **inside** `tsconfig.build.json`'s `include: ["src/**/*"]` and not in the `*.test.ts` exclude, so it ships.
- **`src/cli/templates/index.ts`** (new) — the registry:
  ```ts
  import { WEB_DELIVERY_BOARD } from './web-delivery.board.js';
  import { BoardSchema } from '../../substrate/schemas.js';
  import type { Board } from '../../core/types.js';
  export const TEMPLATES = {
    'web-delivery': { board: WEB_DELIVERY_BOARD, summary: 'Spec→Plan→Build→Review→QA→Done with policy gates' },
  } as const;
  export type TemplateName = keyof typeof TEMPLATES;
  export function isTemplateName(s: string): s is TemplateName { return s in TEMPLATES; }
  // BoardSchema.parse input is typed `unknown`, so the deep-readonly from `as const`
  // on WEB_DELIVERY_BOARD does NOT propagate to the returned mutable `Board` — fine.
  export function loadTemplateBoard(name: TemplateName): Board { return BoardSchema.parse(TEMPLATES[name].board); }
  export function templateNames(): string[] { return Object.keys(TEMPLATES); }
  ```
  - **`loadTemplateBoard` MUST call `BoardSchema.parse` before returning** (LOCKED). `createBoardFile` does **not** validate (confirmed: it only calls `assertSafeBoardId` then writes the board verbatim via a `wx` create). So this parse is the *only* guard that a corrupted bundled template fails loudly at write time rather than producing a board the binary later rejects.
  - Adding a future template = one `*.board.ts` module + one registry entry. No other code change.

**CLI surface (`src/cli/index.ts`, spec §3.1):**
- `ALLOWED_FLAGS_BY_COMMAND.init` → `new Set(['--no-starter-board', '--template'])`.
- **`rejectUnknownFlags` head-compare fix (B1, LOCKED — fixes the `=`-form):** today (`src/cli/index.ts:69–81`) it does `allowed.has(arg)` on the **whole token** and `process.exit(1)`s, so `--template=web-delivery` / `--out=x.html` are rejected **before any value extraction** (the space-form value is fine — it doesn't start with `-`). Change the check to compare the **flag head** `arg.split('=')[0]` against the allowlist, not the whole token. Add an arg-parsing unit test for this.
- **Value-consuming pre-extraction (B1):** the `--template <name>` (space) form makes the **next token** a value, not a flag — a flag-shaped value (e.g. `--template --x`) would misfire `rejectUnknownFlags`. So the `init` case **pre-extracts** `--template` + its value from `rest` (handling both `--template <name>` → consume next token, and `--template=<name>` → split on `=`) and passes the **residual argv** (flag + value removed) to `rejectUnknownFlags`. Same mechanism for `explain`/`--out`. A bare `--template` with no value → error `--template requires a value: --template <name>`.
- The `init` case extracts `template` from `rest` and calls `initCommand(cwd, { template })`.
- HELP text: add `substrate init --template <name>   Initialize with a starter board (templates: web-delivery)` and a one-line note that bare `init` is blank.
- Post-init stdout: when a template was used, add a line naming the board: `Starter board 'delivery' added (template: web-delivery).`

**`initCommand` wiring (`src/cli/commands/init.ts`, spec §3.1, §3.3) — LOCKED error ordering:**
- Signature → `initCommand(cwd, opts?: { template?: string })`; return type unchanged (`InitResult`).
1. **Validate the `--template` name FIRST** (pure arg error, fs-independent, cheapest): if `opts.template` is set and `!isTemplateName(opts.template)`, throw a clear `SubstrateError` listing the available templates (`templateNames()`). This runs **before** the `existsSync(root)` conflict check and **before any fs work**, so `--template bogus` fails **before `.substrate/` is created**, and template-validation **wins over** the existing-`.substrate/` conflict.
2. **`existsSync(root)` conflict check** — the existing `conflict`, unchanged, after the name is known good.
3. **Create `.substrate/` + write the template board** — inside the **existing try/rollback window**, after `openDatabaseAndMigrate(...)`/`client.close()` and **before** `updateGitignore(cwd)`. Call `createBoardFile(root, loadTemplateBoard(opts.template))` (the parsed-and-validated `Board`). Board id is the fixed `delivery` → `boards/delivery.json`; `assertSafeBoardId('delivery')` passes; the `wx` create cannot clobber on a fresh init. A write failure triggers the existing `rm(root)` rollback (partial `.substrate/` removed).
- Bare `init` (no `--template`) is **byte-for-byte the current behavior** — existing init tests must pass unchanged.

**Single source of truth + parse-equal drift test (spec §3.2, §7-R5):** the `examples/.../delivery.json` JSON stays authoritative; the `.ts` module mirrors it. A test (extending `tests/integration/example-substrate.test.ts`) asserts **canonicalized parse-equality, NOT byte-identity**: parse both, canonicalize (key-sorted), compare `JSON.stringify(canonicalize(a))` to `JSON.stringify(canonicalize(b))`. Fails on divergence.

**Tests (spec §5):**
- `src/cli/commands/init.test.ts` extended + integration: bare init unchanged (existing tests green); `--template web-delivery` writes `boards/delivery.json`, the written board passes `loadSubstrate` (Zod + integrity) and its Done gate blocks/allows (reuse `example-substrate.test.ts` assertions); `--template=web-delivery` form works; unknown `--template bogus` errors **and does not create `.substrate/`** (assert `!existsSync(root)`); `--template bogus` when `.substrate/` already exists → template-name error wins; `--template web-delivery` when `.substrate/` already exists → existing `conflict`; `--template` with no value → error.
- Template registry unit test: `isTemplateName` / `loadTemplateBoard` return a `BoardSchema`-valid `Board`; unknown name handled; **assert `loadTemplateBoard` actually calls `BoardSchema.parse`** (it rejects a deliberately-corrupted board) since `createBoardFile` does not validate.
- Parse-equal drift test (canonicalized) between the `.ts` module and `examples/web-delivery/.substrate/boards/delivery.json`.
- **Arg-parsing unit test (B1):** `--template=web-delivery` and `--out=x.html` are **accepted** and their values extracted (head-compare); the space forms extract too; an unknown `--bogus` is still rejected (`process.exit(1)`); a flag-shaped value after `--template ` is consumed as the value, not flagged.

_Reviewer focus (Step 3):_ template reaches `dist/` as a compiled module (no post-build copy / `resolveJsonModule`); `loadTemplateBoard` parses with `BoardSchema` before returning; init error ordering (name → conflict → fs) + board written inside the try/rollback window before `updateGitignore`; both `--template`/`--out` flag forms parse (head-compare `arg.split('=')[0]`; value pre-extracted before `rejectUnknownFlags` so a flag-shaped value can't misfire); bare init unchanged.

Commit: `feat(cli): init --template web-delivery (bundled .ts template + registry) (Step 1)`.

### Step 2 — `substrate explain` (Backend Engineer)

New read-only command (closest existing pattern: `diagnose` — loads the substrate, never writes it) + a pure inline-SVG/HTML renderer split into testable pure functions.

**CLI surface (`src/cli/index.ts`, spec §3.4):**
- New `explain` case in the dispatch `switch`; `import { explainCommand } from './commands/explain.js'`.
- `ALLOWED_FLAGS_BY_COMMAND.explain = new Set(['--out'])`. Support `--out <file>` and `--out=<file>`; bare `--out` with no value is an error. **No `--offline` flag** — inline SVG is inherently offline.
- HELP text: add `substrate explain [--out <file>]   Write a self-contained HTML map of the substrate (default: ./substrate-explain.html)`.

**`src/cli/commands/explain.ts` (new, spec §3.4):**
- `explainCommand(cwd, opts: { out?: string })`:
  1. **`loadSubstrate(root)` only** — substrate-as-code (boards/groups/policies). Does **NOT** open `data.sqlite`, so it works when `data.sqlite` is absent. A no-`.substrate/` case surfaces a normal `SubstrateError` via the top-level handler; no file written.
  2. Render the HTML via `renderSubstrateHtml(substrate)` (below).
  3. Write to `opts.out ?? './substrate-explain.html'` (resolved against `cwd`). Default = **project root** (discoverable, gitignore-friendly; not buried in `.substrate/`).
  4. stdout: `Wrote substrate explanation to <abs path> (<N> board(s)).` + a hint to open it in a browser.
- Empty substrate (no boards): emit a valid HTML file with a "No boards yet" message (don't error, exit 0). A board with no groups/policies renders its header + empty sections.

**Pure renderer module `src/explain/` (spec §3.5) — all pure functions (substrate in → string out), no fs/browser:**
- `src/explain/html.ts` — the **two escaping passes** + the page shell.
  - **`escHtml(s)`** — escapes `& < > " '` for HTML text/attribute contexts.
  - **`escXml(s)`** — escapes for SVG `<text>`/`<title>` content.
  - `pageShell(title, bodyHtml)` — fixed `<!doctype html>` + a `<style>` block (CSS `:hover` rules, table/badge styling); **no `<script src=`, no external refs, no markdown** (descriptions are escaped plain text only — do NOT pull `marked`/DOMPurify into the CLI path).
- `src/explain/conditions.ts` — `describeConditions(conds: Condition[]): string`, a pure condition→prose renderer over the locked operator set (`src/policy/types.ts`), reused by edge labels/tooltips and the policy list.
  - Leaf ops → phrases: `exists`→"is set", `not_exists`→"is not set", `is_empty`→"is empty", `not_empty`→"is non-empty", `eq`→"= …", `neq`→"≠ …", `in`→"in {…}", `not_in`→"not in {…}", `gt`/`gte`/`lt`/`lte`→`> ≥ < ≤`, `contains`→"contains …", `not_contains`→"does not contain …", `starts_with`→"starts with …", `ends_with`→"ends with …", `matches_regex`→"matches /…/", `matches_any_keyword`→"matches any keyword {…}", `has_any`→"includes any of {…}", `has_all`→"includes all of {…}".
  - Compound `all_of`/`any_of`/`none_of` → "all of: …", "any of: …", "none of: …".
  - **Field-reference legend (spec §3.5.3, Architect CONCERN 4):** special-case **literal task fields vs. custom fields**. `group_id` (and `title`, `description`, `parent_id`, …) are real task fields that resolve **literally** and never fall back to `custom_data`; so `task.group_id` is shown as `group_id`. A custom field `task.spec_approved` is shown as `spec_approved` with the note it resolves from `custom_data`. A one-time legend at the top of the doc states the `task.<field>` → `custom_data.<field>` rule once and **explicitly carves out the literal fields** so it doesn't mislead.
  - **Defensive parsing:** an unparseable condition renders `(unparseable condition)` rather than throwing — `explain` must never crash on a malformed-but-loadable policy (`definition` is `Record<string, unknown>`; a schema-valid board can still carry a junk condition).
- `src/explain/svg.ts` — `boardSvg(board): string`, a board → inline-SVG diagram. Deterministic layout (fixed box width/height, fixed horizontal gap, straight/simple-orthogonal edge paths) so the same substrate always produces **byte-identical SVG** (testable). Node id/class = a **collision-free slug of the group id sanitized to `[A-Za-z0-9_-]`** (C2: NOT merely escaped — a quote-bearing group id is an attribute-injection vector into `id=`/`class=`, distinct from `<text>` escaping); all visible text escaped via `escXml`. **Edge-derivation rules (spec §3.5.2, LOCKED):**
  1. **Sequential backbone** — connect consecutive **non-archived** groups by `position` (`g[i] -> g[i+1]`) with a plain edge **unless** a concrete-from/to guard already covers that exact transition (rule 2 replaces it — no double edge). Suppression is narrow: only the *adjacent plain* edge a guard overlaps.
  2. **Guarded edges (concrete from→to)** — for each enabled, non-archived `transition_guard`, parse its `definition` through **`parseGuardDefinition` (src/policy/transition-guard.ts) — the SAME parser the engine uses** (C3), not an ad-hoc `definition['from_group']` read; a guard the engine treats as non-engaging (parser returns `null`, e.g. non-string from/to) draws **no edge**. When the parsed `fromGroup`/`toGroup` are both concrete group ids on the board, draw `from -> to` labeled with the `describeConditions` summary (truncated; full text in the SVG `<title>` + policy list). **Multiple guards on one `from→to` edge → ONE edge** labeled `N gates` (+ concatenated-truncated conditions); list all in the policy detail. **Non-adjacent concrete guard** (both real but not position-adjacent, e.g. `backlog → done`) → a truthful **long labeled edge** (backbone suppression only removes the adjacent plain edge it overlaps). A guard referencing a group id **not present** on the board → listed in the policy section, **edge skipped, no invented node**.
  3. **Wildcard `"*" -> X`** (definition-of-done style, e.g. `gate-done`) → a **single gate annotation on node X**: X's label gains a gate marker + one edge from a small synthetic "any stage" node carrying the DoD summary — **NOT** an edge from every group. At most one synthetic entry-gate node per wildcard-target. `"*" -> "*"` → a board-level note, not edges.
  4. **`agent_responsibility` attachment** — for each enabled, non-archived responsibility, parse via **`parseResponsibilityDefinition` (src/policy/agent-responsibility.ts) — the engine's own parser** (C3); inspect the parsed `when` for a leaf `{ field: "task.group_id", op: "eq", value: <gid> }`, and if present attach its short message to node `<gid>` (tooltip + node section). Otherwise (empty `when`, `when` on non-group fields like `scope`, or compound `when`) it is **not drawn on the graph** — it goes into the per-board "Always-on / conditional suggestions" list with its full human-readable `when`.
  - Archived groups: rendered but styled distinctly (`archived` class / dashed stroke) + labeled `(archived)`, and **NOT woven into the backbone**.
  - Determinism: nodes by `position` then id; policies in engine order (priority then `created_at`).
- `src/explain/render.ts` — top-level `renderSubstrateHtml(substrate): string`. Per board, after the diagram: the **field_schema table** (two sub-tables — task fields, comment fields: name, type, `required?`, enum `values`/`format`); the **policy list** (name, type badge, enabled/disabled + archived state, priority, `describeConditions`; for guards the `from → to` / `* → to` + `on_failure_message`; for responsibilities the `when` summary + `message`; disabled/archived de-emphasized + labeled); the **Always-on / conditional suggestions** list (rule-4 responsibilities not on a node).

**Two-pass escaping coverage (spec §3.5.4, §7-R7) — LOCKED:** every author-controlled string routes through `escHtml` (HTML text/attribute) or `escXml` (SVG `<text>`/`<title>`), **including the easy-to-forget ones (C2):** field names, field `type`/`format` cells, enum `values`, `created_by_agent`, board/group/policy `name` + `description`, `on_failure_message`, and the `from_group`/`to_group` + `* → to` group-id strings that appear on SVG edge labels and in the policy list. **Separately, the slug used in SVG `id=`/`class=` (derived from a group id) is sanitized to `[A-Za-z0-9_-]`, not escaped** (attribute-injection vector). SVG `<text>`/`<title>` labels are length-capped (full text in the escaped policy list / `<title>`). No markdown rendering anywhere in the CLI output.

**Tests (spec §5) — pure unit tests over web-delivery + a CLI integration test:**
- `conditions.test.ts`: each operator → its phrase (table-driven); compound trees; unparseable → `(unparseable condition)`; `task.group_id` → literal `group_id` (not `custom_data`); `task.<custom>` → `<custom>` (custom_data note).
- `svg.test.ts`: sequential backbone for a plain board; a concrete guard replaces the adjacent edge (no double edge); multiple guards on one edge → one edge; a non-adjacent guard → a long edge that doesn't suppress the backbone; an archived group not in the backbone; `"*" -> done` → exactly one gate annotation (**assert NOT N edges**); a `group_id` `when` responsibility attaches to the node, others don't; **deterministic byte-identical SVG** for a fixed board. (The four edge shapes from §4.)
- `html.test.ts` (two passes): `escHtml` escapes `& < > " '`; `escXml` escapes SVG `<text>`/`<title>` content; a crafted **malicious `<script>`-bearing group name** appears nowhere unescaped and doesn't break the SVG; spot-check field names / enum `values` / `created_by_agent` / `on_failure_message` are escaped; a group id containing `"`/`<`/`>` **cannot break out of an attribute** (`id=`/`class=`, sanitized slug) **nor out of a `<text>`/`<title>` element** (escaped) — assert both. Multi-board input; no-boards case → "No boards yet".
- `explain` CLI integration: `init --template web-delivery` → `explain` → assert the file is written at the default path, is non-empty **valid self-contained HTML** containing the board name, an `<svg` block, the field_schema table, and the `gate-done` policy, with **no `<script src=` and no external refs**; `--out` honored; empty substrate → "No boards yet"; `explain` works with `data.sqlite` deleted/absent.
- Manual smoke (`tests/manual/run-smoke.mjs`): add an `init --template web-delivery` path + an `explain` step (run, assert exit 0 + file exists + contains `<svg`).

_Reviewer focus (Step 3):_ escaping (both passes, all author strings); edge derivation routed through `parseGuardDefinition`/`parseResponsibilityDefinition` (engine parsers), not ad-hoc `definition[...]` reads; edge-derivation correctness (the four shapes); `explain` reads substrate-as-code only (no DB); deterministic SVG; no markdown / no external refs in output.

Commit: `feat(cli): substrate explain — self-contained inline-SVG HTML map (Step 2)`.

### Step 3 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. **This is the SINGLE consolidated gate.** Mandated focus:
- **Escaping (both passes, all author strings):** every substrate-derived string reaches the output through `escHtml` (HTML contexts) or `escXml` (SVG `<text>`/`<title>`); the enumerated easy-to-forget strings (field names, field `type`/`format`, enum `values`, `created_by_agent`, `name`/`description`, `on_failure_message`, the `from_group`/`to_group`/`* → to` label strings) are covered; a `<script>`-bearing name appears nowhere unescaped; no markdown rendering; no `<script src=`/external refs in the emitted file.
- **Edge-derivation correctness:** edges derived via the engine's own `parseGuardDefinition`/`parseResponsibilityDefinition` (a parser-`null`/non-engaging guard draws no edge); sequential backbone over non-archived groups; concrete guard replaces the adjacent edge (no double edge); multiple guards → one edge; non-adjacent guard → truthful long edge; `"*" -> X` → single entry-gate annotation (never N edges); missing-group guard skipped (no invented node); archived groups off the backbone; group-scoped responsibilities attach, others list conditionally; group-id slug sanitized to `[A-Za-z0-9_-]` for `id=`/`class=`; deterministic SVG.
- **Template-reaches-dist guarantee:** the `.ts` template compiles into `dist/server/cli/templates/` (no post-build copy, no `resolveJsonModule`); `loadTemplateBoard` calls `BoardSchema.parse` before returning (since `createBoardFile` does not validate); **the reviewer runs `pnpm build` and confirms `dist/server/cli/templates/web-delivery.board.js` exists** (C4 — so a broken tsconfig include/exclude or a bad import extension is caught at this gate, not only at Step 4 acceptance).
- **Init error ordering / rollback:** name validation → `existsSync` conflict → fs; board written inside the try/rollback window before `updateGitignore`; `--template bogus` leaves no `.substrate/`.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 7 Code Reviewer findings (Step 3)` (only if findings).

### Step 4 — Acceptance + 0.2.0 + audit + merge (Backend Engineer → Assistant)

**Full acceptance gate (spec §5):**
- `pnpm build` (server + ui).
- `pnpm test` (server unit + integration).
- `pnpm --dir ui test` (UI sanitizer + components).
- `tsc` root + ui.
- `eslint` (root) + `pnpm --dir ui lint`.
- `prettier --check`.
- `pnpm test:smoke:concurrency`.
- manual MCP smoke (`node tests/manual/run-smoke.mjs`) — now includes the `init --template web-delivery` + `explain` steps.
- `pnpm test:smoke:ui` (Playwright; builds the UI first).
- **Packaging:** `pnpm build` THEN `pnpm publish --dry-run` (file list = whitelist exactly: `dist/**` incl. `dist/ui/**` + `README.md` + `LICENSE` + `CHANGELOG.md` + `package.json`, no extras) — **verify `dist/server/cli/templates/web-delivery.board.js` is present in the tarball** (the bundled template ships as a compiled module; no vendored lib, no new asset, whitelist unaffected). THEN `pnpm pack` + `npx ./<tarball> --help`.
- **C7 build-isolation grep:** `dist/server/` contains no `react`/`marked`/`dompurify` (the server/CLI bundle stays UI-dep-free — `explain` pulls in no markdown lib).
- **NEW acceptance checks:** in a temp dir, `npx ./<tarball> init --template web-delivery` writes a working board (round-trips via `loadSubstrate`); `npx ./<tarball> explain` produces a valid self-contained HTML file (`<svg`, no external refs).

**Version bump → 0.2.0 (spec §3.6) — 4 sources + 1 guard:**
- `src/core/version.ts` `BINARY_VERSION` → `'0.2.0'`. **`BINARY_SCHEMA_VERSION` stays `2`.**
- `package.json` `version` → `0.2.0`.
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → `'v0.2.0 (init templates + explain)'` (replaces `'v0.1.0 (public release)'`).
- `CHANGELOG.md` → a `0.2.0` entry (added: `init --template web-delivery`, `substrate explain [--out]`).
- **Guard (test, not a source):** `src/mcp/tools/read/whoami.test.ts` — update the `/public release/` copy assertion to the new phase string (e.g. `/init templates|explain/`); the `PHASE_STRING ⊇ BINARY_VERSION` invariant (`toContain(\`v${BINARY_VERSION}\`)`) is preserved.
- README quick-start: add the `--template web-delivery` alternative first step + an `explain` one-liner (keep bare-`init` primary).
- Confirm all four sources read `0.2.0` and the drift guard passes.

Then:
- Spawn Assistant → `.agents/audits/phase-07-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag **`phase-07-complete`**.
- **STOP here.** Do NOT push the `v0.2.0` release tag, do NOT publish — operator triggers (§Operator).

Commits: `chore(phase-07): acceptance pass + 0.2.0 lockstep (Step 4)`, `docs(phase-07): assistant audit (Step 4)`.

## 4. Edge cases (spec §4)

| Case | Expected |
|---|---|
| `substrate init` (no flag) | unchanged: blank `.substrate/`, gitignore block, no board |
| `init --template web-delivery` | blank init **plus** `boards/delivery.json`; loads + validates; Done gate engages |
| `init --template=web-delivery` | same (equals form) |
| `init --template bogus` | error listing available templates; `.substrate/` **NOT** created (name validated first) |
| `init --template` (no value) | error: `--template requires a value` |
| `--template` on a non-init command | rejected by `rejectUnknownFlags` |
| `init --template bogus` when `.substrate/` exists | template-name error **wins** |
| `init --template web-delivery` when `.substrate/` exists | existing `conflict` |
| template write fails mid-init | partial `.substrate/` rolled back |
| `explain` with no `.substrate/` | normal `SubstrateError`; no file written |
| `explain` empty substrate | valid HTML "No boards yet"; exit 0 |
| `explain --out path/x.html` / default | writes there / `./substrate-explain.html`; prints abs path |
| `"*" -> done` guard | one gate annotation on `done`, NOT an edge from every group |
| guard referencing a missing group id | listed in policy section; edge skipped; no invented node |
| multiple concrete guards on one edge | ONE edge (`N gates`); all listed in detail |
| non-adjacent concrete guard (`backlog → done`) | truthful long labeled edge; backbone only suppresses the adjacent plain edge |
| archived group present | rendered, styled + `(archived)`; NOT on the backbone |
| guard/responsibility on `task.group_id` | shown as literal `group_id` (no `custom_data` fallback) |
| `agent_responsibility` `when` on `scope` / empty `when` | not on graph; in "always-on / conditional" list |
| name with `" < > & ' <script>` / newlines | HTML-escaped in HTML, XML-escaped in SVG; file valid + renders |
| malformed `definition` in a schema-valid board | `(unparseable condition)`; no crash |
| `explain` with `.substrate/` but no `data.sqlite` | works (DB never opened) |
| shipped `.ts` template diverges from `examples/` | parse-equal drift test fails (canonicalized) |

## 5. Test mapping (spec §5 → plan)

| Spec requirement | Plan location |
|---|---|
| bare init unchanged | Step 1 (`init.test.ts` — existing tests) |
| `--template web-delivery` writes `boards/delivery.json`; loads + Done gate engages | Step 1 (integration, reuses `example-substrate.test.ts`) |
| unknown template errors + no `.substrate/` created | Step 1 |
| `--template` no-value error; `--template=name` form | Step 1 |
| template-name-wins-over-conflict ordering | Step 1 |
| registry: `isTemplateName`/`loadTemplateBoard` return `BoardSchema`-valid board; parse is called | Step 1 (registry unit test) |
| parse-equal drift test (`.ts` ↔ `examples/` JSON, canonicalized) | Step 1 |
| `describeConditions` operator table; compound; unparseable; `group_id` literal vs custom | Step 2 (`conditions.test.ts`) |
| backbone; concrete-guard-replaces-edge; multi-guard→one; non-adjacent long edge; archived off-backbone; `*→done` single annotation; responsibility attach; deterministic SVG | Step 2 (`svg.test.ts`) |
| two-pass escaping; malicious name; easy-to-forget strings; multi-board; no-boards | Step 2 (`html.test.ts`) |
| `explain` CLI: file written, valid self-contained HTML, `<svg`, tables, `gate-done`, no `<script src=`/external; `--out`; empty; DB-absent | Step 2 (CLI integration) |
| manual smoke: `init --template` + `explain` steps | Step 2 + Step 4 (`run-smoke.mjs`) |
| dry-run whitelist incl. `dist/server/cli/templates/web-delivery.board.js`; pack/npx | Step 4 |
| `npx <tarball> init --template` writes working board; `npx <tarball> explain` valid HTML | Step 4 (new acceptance checks) |
| C7 build-isolation grep (`dist/server` UI-dep-free) | Step 4 |
| version: 4 sources at `0.2.0`; `PHASE_STRING ⊇ BINARY_VERSION` guard; whoami copy assertion updated; schema stays 2 | Step 4 |
| full suite green (build/test/ui test/tsc/eslint/prettier/concurrency/manual MCP/ui Playwright) | Step 4 |

## 6. Risks

- **R1 (escaping miss — broken/script-bearing file):** the headline correctness risk. Mitigation: two distinct passes (`escHtml`/`escXml`), enumerated coverage of author strings, a malicious-name unit test, mandated Step 3 audit + grep.
- **R2 (edge-derivation wrong — a misleading diagram):** the four under-specified shapes are locked (§3 Step 2 / spec §3.5.2) and each has a dedicated `svg.test.ts` case incl. the `*→X` "not N edges" assertion.
- **R3 (template missing from `dist/`):** eliminated by design — the `.ts` module compiles like any source file (no post-build copy / asset read); Step 4 verifies `web-delivery.board.js` is in the tarball.
- **R4 (template invalid / drifts from `examples/`):** `loadTemplateBoard` parses with `BoardSchema` (loud at write time); the canonicalized parse-equal test catches divergence.
- **R5 (init regression):** bare init is unchanged and its existing tests must pass; the new path is fully behind `--template`.
- **R6 (version drift recurrence):** mitigated by the preserved `PHASE_STRING ⊇ BINARY_VERSION` assertion.

## 7. Definition of Done

- All step commits on `feature/phase-07-init-templates-and-explain`.
- Single Code Reviewer pass done (Step 3); BLOCKER/CONCERN findings resolved.
- Spec §5 acceptance gate met; dry-run + pack/npx smoke clean (incl. the two new `npx <tarball>` checks + the bundled-template-in-tarball verification); C7 build-isolation grep clean.
- All four version sources at `0.2.0` / `v0.2.0 (init templates + explain)`; `BINARY_SCHEMA_VERSION` still `2`; drift guard passing; whoami copy assertion updated.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-07-complete`. **Live publish + `v0.2.0` tag remain operator-gated.**

## Operator tasks (NOT done by the agent — spec §6)

```
Unchanged from Phase 6 §6. The agent ships in-repo + dry-run-verified and stops
at `phase-07-complete`. Diego performs the live, credentialed, irreversible steps:

1. Review `pnpm publish --dry-run` for the 0.2.0 tarball.
2. Push the real `v0.2.0` release tag → fires `publish.yml`, which runs the live
   `pnpm publish --access public` (the 0.2.0 release is cut by the operator's tag
   push, not the agent).
3. npm token / `NPM_TOKEN` secret config remains Diego's.
4. (CI runs on the Phase 7 PR — confirming CI green on a real PR is an operator step.)
```
