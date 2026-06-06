# Phase 7 Spec — `init --template` + `substrate explain`

**Status:** APPROVED (incorporates Architect Reviewer changes + product-owner rendering decision) — ready for planning.
**Standing directive:** Diego's standing instruction is to proceed without per-phase approval pauses; no separate confirmation gate is required before planning begins.
**Author:** Spec Team
**Last updated:** 2026-06-06
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) (post-v1 adoption/ergonomics work)
**Predecessor:** Phase 6 (`phase-06-complete`, v0.1.0) — OSS artifacts + CI + npm publishing config + full `reverse_captcha`. The package is in-repo + dry-run-verified; live publish is operator-gated. A "Track A" docs change has since landed: `skills/substrate/AUTHORING.md` (the policy DSL + process→substrate recipe) and a worked example substrate at `examples/web-delivery/`.

---

## 1. Goal

Two CLI features that make a substrate easier to **adopt** and easier to **understand** — the two friction points Track A surfaced.

1. **`substrate init --template <name>`** — an opt-in starter board. Bare `substrate init` stays blank (unchanged). With `--template web-delivery`, init additionally writes a ready-to-use Spec→Plan→Build→Review→QA→Done board (the `examples/web-delivery` delivery board, with working policy gates) into `.substrate/boards/`. The template is **bundled into the npm package** so it works for `npx` users, where `examples/` does not ship.
2. **`substrate explain [--out <file>]`** — generate a self-contained HTML document that explains the current substrate: per board, a **hand-rolled inline-SVG** flow diagram (groups → nodes, `transition_guard` policies → labeled/gated edges, the definition-of-done gate, `agent_responsibility` annotations), the `field_schema` table, and the policy list with human-readable conditions. The diagram is **plain inline SVG** — no Mermaid, no CDN, no vendored library, **zero new runtime dependencies** — so every output file is self-contained, offline, and tiny. The skill's "explain the substrate" capability calls this command.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. These are additive features → `BINARY_VERSION` → `0.2.0` at acceptance (§3.6).

## 2. Scope

**In scope:**
- **`src/cli/commands/init.ts`** gains an optional `template` argument; the dispatcher (`src/cli/index.ts`) parses `--template <name>` and adds it to init's flag allowlist (§3.1).
- **A bundled template registry** (`src/cli/templates/`): the web-delivery board as a **type-checked `.ts` module** (`web-delivery.board.ts` → `export const WEB_DELIVERY_BOARD = {...}`) that tsc compiles straight into `dist/` — **no post-build copy** (§3.2). Validated against `BoardSchema` on load.
- **A new `explain` command** (`src/cli/commands/explain.ts`) + an inline-SVG generator module (`src/explain/`) (§3.4–3.5). Renders per board: a hand-rolled inline-SVG flow diagram, the field_schema table, the policy list with human-readable conditions.
- **A condition→prose renderer** reused by the diagram edge labels/tooltips and the policy list (§3.5.3).
- **Two-pass author-string escaping** — HTML-escape for HTML text/attribute contexts, XML/SVG-text escape for `<text>`/`<title>` contents — covering all author-controlled strings (§3.5.4).
- **Version bump** to `0.2.0` across the four lockstep sync points + the existing drift-guard test (§3.6).
- **CHANGELOG** `0.2.0` entry; **README** quick-start gains the `--template` and `explain` lines.

**Out of scope (locked):**
- Changing bare-init behavior — it **stays blank** (opt-in, not default).
- Making `web-delivery` the default template.
- More than the one `web-delivery` template in v1 (the flag is *designed* to extend; only one ships).
- A UI / served version of `explain` (it is a CLI-generated static file only — no new HTTP route).
- Live `npm publish` / real tag push (still operator-gated, unchanged from Phase 6 §6).

**Out of scope (not this phase):**
- Auto-deriving `BINARY_VERSION` from `package.json` (still manual lockstep — a v1.x candidate noted in `version.ts`).
- Any headless-browser or rasterization step (the output is a self-contained HTML file with inline SVG that the user opens directly).
- Optional click-to-focus-a-path JS in the diagram — deferred to the plan (the baseline is CSS-`:hover`-only, no JS required).

## 3. Design

### 3.0 Locked decisions (product owner)

1. **`init --template <name>` — opt-in only; bare init stays blank.** `substrate init` keeps its current behavior exactly (creates `.substrate/` + the `.gitignore` block + an empty `boards/` dir, **no board**). `--template web-delivery` additionally writes one starter board into `.substrate/boards/`. `web-delivery` is the only template in v1; the flag is designed so adding templates is trivial (§3.2).
2. **The template content is the `examples/web-delivery/.substrate/boards/delivery.json` board**, bundled into the package (not read from `examples/`, which is not in the `files` whitelist). Single source of truth resolved at §3.2 / §7-R5.
3. **The written template board must pass the loader/validator** (`BoardSchema` + `validateSubstrate`) — `init --template` is not allowed to write a board the binary would later reject.
4. **`substrate explain` emits one self-contained HTML file** (no served route, no new dependency in `dependencies` *or* `devDependencies`). Per board: a **hand-rolled inline-SVG** diagram, the field_schema table, the policy list with human-readable conditions. **Product-owner rendering decision: plain inline SVG, chosen over Mermaid** — no CDN, no ~3 MB vendored library, zero new runtime dependencies; every output file is self-contained, offline, and tiny.
5. **`explain` reads substrate-as-code only.** It calls `loadSubstrate` (boards/groups/policies) and does **not** touch the SQLite DB — so it works even when `data.sqlite` is absent (e.g. a fresh `.substrate/` that has never run a tool, or a checked-out substrate definition with no local DB).
6. **Default output path is `./substrate-explain.html`** (project-root, gitignore-friendly, discoverable), NOT inside `.substrate/`. Rationale in §3.4 / §7-R2.
7. **Edge-derivation rules are locked** (§3.5.2): position-adjacent non-archived groups get a plain sequential edge; a `transition_guard` with concrete `from_group`/`to_group` *replaces* that edge with a labeled, gated one (or is drawn as a truthful long edge when non-adjacent); multiple concrete guards on the same edge collapse to one labeled edge; a `"*" -> X` guard renders as a **single gate annotation on the entry to X**, never N edges from every node; archived groups render but are not woven into the backbone; `agent_responsibility` policies whose `when` references a concrete `group_id` attach to that node, all others go in a per-board "always-on / conditional" list.
8. **Two-pass escaping (§3.5.4).** (a) HTML-escape (`& < > " '`) for every author string in HTML text/attribute contexts; (b) XML/SVG-text escape for every author string inside SVG `<text>`/`<title>`. Every author-controlled string routes through one of the two — including field names, enum `values`, `created_by_agent`, board/group/policy `name`+`description`, and `on_failure_message`. No markdown rendering. Lower stakes than the served UI (a local file the author generates from their own substrate), but `explain` must never emit a broken or script-bearing file.
9. **Version → `0.2.0`** (minor; additive). `BINARY_SCHEMA_VERSION` stays `2`.

### 3.1 `init --template` — CLI surface

**Flag parsing (`src/cli/index.ts`).** Add `--template` to init's allowlist and pass the value through:

- `ALLOWED_FLAGS_BY_COMMAND.init` becomes `new Set(['--no-starter-board', '--template'])`.
- `rejectUnknownFlags` currently rejects any `-`-prefixed token not in the set. `--template` takes a **value**, so the rejecter must not treat the value as a positional-or-flag in a way that breaks. Two accepted forms: `--template web-delivery` (space) and `--template=web-delivery` (equals). The dispatcher extracts the value before `rejectUnknownFlags` runs, or `rejectUnknownFlags` is taught that `--template` consumes the next token. **Locked form:** support both `--template <name>` and `--template=<name>`; a bare `--template` with no value is an error (`--template requires a value: --template <name>`).
- The `init` case extracts `template` from `rest` and calls `initCommand(cwd, { template })`.
- HELP text: add `substrate init --template <name>   Initialize with a starter board (templates: web-delivery)` and a one-line note that bare `init` is blank.

**`initCommand` signature.** `initCommand(cwd, opts?: { template?: string })`. **Locked error ordering (Architect CONCERN 3):**
1. **Validate the `--template` name** against the registry (§3.2) — a pure argument error, cheapest and fs-independent. An unknown name fails fast with the available list. This runs **first**, so `--template bogus` fails **before `.substrate/` is created** and template-validation wins over the existing-`.substrate/` conflict.
2. **`existsSync(root)` conflict check** — the existing `.substrate/`-already-exists `conflict`, unchanged, after the name is known good.
3. **Create `.substrate/` + write the template board.** The board is written **inside the existing try/rollback window** in `initCommand`, after the db is initialized and before `updateGitignore`, via `createBoardFile(root, board)` (§3.3). A write failure triggers the existing `rm(root)` rollback (partial `.substrate/` removed). The fixed id `delivery` → `boards/delivery.json`; `assertSafeBoardId('delivery')` passes; the `wx` create cannot clobber on a fresh init.
- The post-init stdout message (currently printed in `index.ts`) gains a line naming the written board when a template was used: `Starter board 'delivery' added (template: web-delivery).`

Bare `init` (no `--template`) is byte-for-byte the current behavior — **no regression**; the existing init tests must still pass unchanged.

### 3.2 Bundled template registry — type-checked `.ts` module (Architect CONCERN 1)

**The shipping problem and its resolution.** `tsconfig.build.json` compiles `src/**/*` to `dist/server/`, but **`tsc` does not copy `.json` files into `outDir`** — so any `.json`-based bundling needs a post-build copy step, and a "bundled-template-missing-from-dist" failure is then possible at a user's `npx`. **Locked: bundle the board as a type-checked `.ts` module, not a JSON copy.** Keep the board at **`src/cli/templates/web-delivery.board.ts`**:

```ts
export const WEB_DELIVERY_BOARD = { /* the delivery board object, typed */ } as const;
```

tsc compiles it to `dist/server/cli/templates/web-delivery.board.js` like any other source file — **no post-build copy, no runtime file read, and compile-time type-checking of the board shape.** A bundled-template-missing-from-dist failure becomes *impossible* (it is an ordinary module import, not a side-car asset). This is simpler and safer than the rejected "post-build copies `src/cli/templates/*.json` into `dist/` + read via `import.meta.url`" mechanism (rejected in favor of the `.ts` module). In dev (tsx) and in `dist/` the same `import` resolves identically.

**Registry module (`src/cli/templates/index.ts`).**
```ts
import { WEB_DELIVERY_BOARD } from './web-delivery.board.js';
export const TEMPLATES = {
  'web-delivery': { board: WEB_DELIVERY_BOARD, summary: 'Spec→Plan→Build→Review→QA→Done with policy gates' },
} as const;
export type TemplateName = keyof typeof TEMPLATES;
export function isTemplateName(s: string): s is TemplateName { return s in TEMPLATES; }
export function loadTemplateBoard(name: TemplateName): Board { return BoardSchema.parse(TEMPLATES[name].board); }
```
- **`loadTemplateBoard` MUST call `BoardSchema.parse` before returning** — this is locked, because `createBoardFile` does **not** validate (confirmed: it only calls `assertSafeBoardId` + writes the board verbatim). So validation here is the *only* guard that a corrupted bundled template fails loudly at write time rather than producing a board the binary later rejects. It returns a typed `Board`.
- Adding a future template = add a `*.board.ts` module + one registry entry. No other code change. (Honors "design the flag so more templates are easy to add.")

**Single source of truth + drift test (§7-R5, Architect R5).** The **`examples/web-delivery/.substrate/boards/delivery.json` JSON remains the human-facing reference** (authoritative for repo readers). The `.ts` module **mirrors** it. To prevent drift, **a test asserts parse-equality, NOT byte-identity:** it parses both, canonicalizes each (key-sorted / canonicalized), and compares `JSON.stringify(canonicalize(parse(a)))` to `JSON.stringify(canonicalize(parse(b)))`. Byte-identity is rejected as brittle to trailing newlines and key order. The test (extending `tests/integration/example-substrate.test.ts`) fails if the `.ts` module and the `examples/` JSON diverge.

### 3.3 Writing the template board (validity)

- `init --template web-delivery` calls `createBoardFile(root, board)` with the parsed-and-validated board from `loadTemplateBoard('web-delivery')`. **`createBoardFile` does NOT validate** (confirmed: it only calls `assertSafeBoardId` to guard the id from escaping `boards/`, then writes the board verbatim with a `wx` create that refuses to clobber → `EEXIST` → `conflict`). The `BoardSchema.parse` in `loadTemplateBoard` (§3.2) is therefore the load-bearing validation gate.
- Because the board passed `BoardSchema.parse` in `loadTemplateBoard`, and `createBoardFile` writes it verbatim, a subsequent `loadSubstrate(root)` (Zod + `validateSubstrate` integrity) is guaranteed to accept it. An acceptance test does exactly this round-trip: `init --template web-delivery` → `loadSubstrate` → assert the `delivery` board is present and its Done gate engages (reusing the §example-substrate assertions).
- The written board file is `boards/delivery.json` (the board's `id` is `delivery`), pretty-printed (`createBoardFile` already does `JSON.stringify(board, null, 2)` + trailing newline) so it reads cleanly and diffs nicely.

### 3.4 `substrate explain` — CLI surface + output path

- New command `explain` in the dispatch `switch`; `import { explainCommand } from './commands/explain.js'`.
- `ALLOWED_FLAGS_BY_COMMAND.explain = new Set(['--out'])`. `--out <file>` / `--out=<file>` sets the output path; bare `--out` with no value is an error. **No offline flag** — inline SVG is inherently offline, so one is unnecessary.
- `explainCommand(cwd, opts: { out?: string })`:
  1. **`loadSubstrate(root)` only — substrate-as-code (boards/groups/policies).** `explain` does **not** open the SQLite DB, so it works even when `data.sqlite` is absent. A no-`.substrate/` case still surfaces a normal `SubstrateError` through the existing top-level handler.
  2. Render the HTML (§3.5).
  3. Write to `opts.out ?? './substrate-explain.html'` (resolved against `cwd`). Refuse to overwrite a path **outside** the cwd subtree is unnecessary (the user chose it), but **do** print the absolute path written.
  4. stdout: `Wrote substrate explanation to <abs path> (<N> board(s)).` plus a hint to open it in a browser.
- **Default output path = `./substrate-explain.html`** (§3.0-6, kept per R2). Rationale: (i) discoverable at the project root, not buried in `.substrate/`; (ii) `.substrate/` is partly gitignored and conceptually the *substrate state*, not generated docs — writing an artifact there muddies that boundary and risks a confusing partial-commit; (iii) a root file is easy to `open`/share and easy to add to `.gitignore` if undesired. `--out` overrides.
- Empty substrate (no boards): still emit a valid HTML file with a "No boards yet" message (don't error). A board with no groups/policies renders its header + empty sections.

### 3.5 `substrate explain` — HTML + inline-SVG generation (`src/explain/`)

Module layout: `src/explain/render.ts` (top-level `renderSubstrateHtml(substrate, opts)`), `src/explain/svg.ts` (board → inline-SVG diagram string), `src/explain/conditions.ts` (condition → prose), `src/explain/html.ts` (the two escaping passes + the page shell). All **pure functions** (substrate in → string out) so they unit-test without filesystem or browser.

#### 3.5.1 Rendering: plain inline SVG (product-owner decision) — §7-R1 resolved

Diagrams are emitted as **plain inline SVG** in the HTML — **no Mermaid, no CDN, no ~3 MB vendored library, zero new runtime dependencies.** This makes every output file self-contained, offline, and tiny. (Mermaid, the prior recommendation, is **rejected in favor of inline SVG**; §7-R1 is resolved.)

**Baseline (locked):**
- Per board, stages render as **boxes left-to-right** (groups ordered by `position`).
- **Gate edges** are drawn between stages, labeled with the short condition (e.g. `requires spec_approved`).
- **CSS `:hover`** highlights the node/edge under the cursor — defined in a `<style>` block in the page shell, **no JS**.
- **SVG `<title>` tooltips** give detail on hover: on a gate edge, the full `require` conditions + `on_failure_message`; on a stage node, its description + the suggestion policies that apply there.
- **Below the diagram:** the field_schema table + the full policy list with human-readable conditions. The diagram is the at-a-glance view; the tables are the detail.
- Optional light inline JS for click-to-focus-a-path is **deferred to the plan** (not required for the baseline).

`svg.ts` computes a deterministic layout (fixed box width/height, fixed horizontal gap, edges as straight or simple orthogonal paths) so the same substrate always produces byte-identical SVG (testable). Node ids/classes are sanitized slugs of the group id; all visible text is escaped per §3.5.4.

#### 3.5.2 Board → inline-SVG diagram (edge-derivation rules) — LOCKED

Nodes = groups, ordered by `position` ascending, drawn as boxes left-to-right. Node id = a sanitized, collision-free slug of the group id; node label = the group **name** (escaped, §3.5.4). Archived groups are rendered but styled distinctly (e.g. an `archived` CSS class / dashed stroke) and labeled `(archived)`, and are **NOT woven into the sequential backbone**.

Edge derivation (the rules the diagram must follow):
1. **Sequential backbone.** The backbone connects **consecutive non-archived groups by `position`**: between each pair of position-adjacent non-archived groups `g[i] -> g[i+1]`, draw a plain edge **unless** a concrete-`from`/`to` guard already covers that exact transition (then rule 2 replaces it — no double edge). The suppression is narrow: a guard only suppresses the *adjacent plain* edge it actually overlaps.
2. **Guarded edges (concrete from→to).** For each enabled, non-archived `transition_guard` whose parsed `from_group`/`to_group` are both concrete group ids, draw `from -> to` labeled with the human-readable `require` summary from §3.5.3 (e.g. `requires spec_approved`), truncated to a sane length with the full text in the SVG `<title>` and the policy list below. If `from`/`to` reference a group id not present on the board, list the policy in the policy section and **skip** the edge (don't invent a node).
   - **Multiple concrete guards on the same `from→to` edge:** draw **ONE edge**; label it with a count (`N gates`) and/or concatenated-truncated conditions; list **all** of them in the policy detail section.
   - **Non-adjacent concrete guard** (both groups real but not position-adjacent, e.g. `backlog → done`): draw it as a **labeled edge between the two real nodes** (it is truthful). The backbone's suppression rule (1) only removes the *adjacent plain* edge a guard overlaps, so such long edges remain as extra edges.
3. **Wildcard `"*" -> X` (definition-of-done style).** A guard with `from_group: "*"` and a concrete `to_group: X` (e.g. the `gate-done` policy) is rendered as a **single gate annotation on node X** — X's label gains a gate marker and one edge from a small synthetic "any stage" node carrying the DoD summary, **NOT** an edge from every group. At most one synthetic entry-gate node per wildcard-target, regardless of how many real groups exist. `"*" -> "*"` (if ever authored) is rendered as a board-level note, not edges.
4. **`agent_responsibility` attachment.** For each enabled, non-archived `agent_responsibility`: if its `when` contains a leaf `{ field: "task.group_id", op: "eq", value: <gid> }` (the common case the templates use), attach its short message to node `<gid>` (in that node's `<title>` tooltip and section). Otherwise (empty `when`, or `when` referencing non-group fields like `scope`, or compound `when`), it is **not** drawn on the graph — it goes into the per-board "Always-on / conditional suggestions" list (§3.5.3) with its full human-readable condition.

Determinism: nodes and edges are emitted in a stable order (groups by `position` then id; policies by the engine's `priority` then `created_at` order) so the same substrate always produces byte-identical SVG (testable).

#### 3.5.3 Condition → prose (`conditions.ts`) + policy list

A pure `describeConditions(conds: Condition[]): string` that renders the locked operator set (`src/policy/types.ts`) to short human phrases, reused by both edge labels/tooltips and the policy list:
- Leaf ops map to phrases: `eq`→"= ", `neq`→"≠", `in`→"in {…}", `exists`→"is set", `not_empty`→"is non-empty", `gt`/`gte`/`lt`/`lte`→`> ≥ < ≤`, `contains`→"contains", `matches_regex`→"matches /…/", `has_all`→"includes all of {…}", etc. (Full table in the plan.)
- The **field-reference rule** is reflected, and it **special-cases literal task fields vs. custom fields (Architect CONCERN 4):** `group_id` is a real task field, not `custom_data`. The legend must distinguish the literal task fields (`group_id`, `title`, `description`, `parent_id`, …), which resolve **literally** and never fall back to `custom_data`, from custom fields, where `task.<field>` resolves from `custom_data.<field>`. So `task.group_id` is shown as `group_id` (a literal field), while `task.spec_approved` is shown as `spec_approved` with the note that it resolves from `custom_data`. The `task.<field>` → `custom_data.<field>` legend at the top of the doc states this once and explicitly carves out the literal fields so it does not mislead.
- Compound `all_of`/`any_of`/`none_of` render as "all of: …", "any of: …", "none of: …".
- Parsing is **defensive** like the engine: an unparseable definition renders as "(unparseable condition)" rather than throwing — `explain` must never crash on a malformed-but-loadable policy. (A board that fails `BoardSchema` never reaches `explain` because `loadSubstrate` rejects it; but `definition` is `Record<string, unknown>`, so within a valid board a policy condition can still be junk.)

Per board the HTML renders, after the diagram:
- **field_schema table** — two sub-tables (task fields, comment fields): field name, type, `required?`, enum `values`/`format` where present.
- **Policy list** — each policy: name, type badge, enabled/disabled + archived state, priority, the human-readable condition (`describeConditions`), and for guards the `from → to` (or `* → to`) and the `on_failure_message`; for responsibilities the `when` summary and the `message`. Disabled/archived policies are shown but visually de-emphasized and labeled (they don't affect the diagram per §3.5.2's enabled/non-archived filter).
- **Always-on / conditional suggestions** — the `agent_responsibility` policies not attached to a node (rule 4), each with its full human-readable `when`.

#### 3.5.4 HTML + SVG safety — two distinct passes (Architect NIT 5) — §3.0-8

The inline-SVG output puts author strings in **two different syntactic contexts**, so escaping is **two distinct passes, not one**:
- **(a) HTML escape — `escHtml(s)`** (escapes `& < > " '`): for **all** author strings placed in HTML text or attribute contexts (table cells, list items, the page shell).
- **(b) XML/SVG-text escape — `escXml(s)`**: for **all** author strings placed inside SVG `<text>` and `<title>` elements (node labels, edge labels, tooltips). `<title>` tooltip content and `<text>` node/edge labels must be XML-escaped so an adversarial group name can neither break the SVG nor inject markup. Labels are also length-capped (full text appears in the escaped policy list / `<title>`).

**Enumerated coverage — every author-controlled string routes through (a) or (b), including the easy-to-forget ones:** field names, enum `values`, `created_by_agent`, board/group/policy `name` + `description`, and `on_failure_message`. The Code Reviewer audits that no substrate-derived string reaches the output un-escaped in either context.

- **No markdown rendering.** Unlike the served UI, `explain` does **not** run author markdown through `marked`/DOMPurify; descriptions are emitted as **escaped plain text only** (don't pull the served-UI's `marked`/DOMPurify into the CLI path). The only markup in the document is the fixed HTML shell + the hand-rolled SVG + escaped text.
- **Stakes note.** This is a local file the author generates from *their own* substrate and opens themselves — strictly lower stakes than the localhost-served UI. Escaping here is about not producing a **broken** or accidentally-script-bearing file, not defending against a remote attacker — but escaping is **still mandatory**.

### 3.6 Version bump → 0.2.0

Additive features, no schema change. Version → **`0.2.0`**. Count consistently (Architect NIT 6): **4 *sources*** that must change, plus **1 *guard*** (a test, not a source) that must be updated. `BINARY_SCHEMA_VERSION` stays `2`.

**The 4 sources:**
- `src/core/version.ts` `BINARY_VERSION` → `'0.2.0'`.
- `package.json` `version` → `0.2.0`.
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → **`'v0.2.0 (init templates + explain)'`** (replacing `'v0.1.0 (public release)'`).
- `CHANGELOG.md` → a `0.2.0` entry (added: `init --template web-delivery`, `substrate explain [--out]`).

**The guard (not a source):**
- `src/mcp/tools/read/whoami.test.ts` enforces the `PHASE_STRING ⊇ BINARY_VERSION` invariant (asserts `result.phase` contains `v${BINARY_VERSION}`). Its `/public release/` copy assertion **must be updated to the new phase string** (e.g. `/init templates|explain/`). The invariant itself is preserved.
- Health endpoint + MCP server name/version read `BINARY_VERSION` already — no edit.

### 3.7 README + docs touch-ups

- README quick-start: add `npx @diegoferreyra/substrate init --template web-delivery` as an alternative first step, and a one-liner for `npx @diegoferreyra/substrate explain` ("generate a self-contained, offline HTML map of your substrate"). Keep the bare-`init` path primary.
- The Substrate skill's "explain the substrate" capability is wired to call `substrate explain` (the skill doc change is light; the command is the deliverable). No skill behavior is in scope beyond noting the command exists.

## 4. Edge cases

| Case | Expected |
|---|---|
| `substrate init` (no flag) | unchanged: blank `.substrate/`, gitignore block, no board |
| `substrate init --template web-delivery` | blank init **plus** `boards/delivery.json`; loads + validates; Done gate engages |
| `substrate init --template=web-delivery` | same as above (equals form accepted) |
| `substrate init --template bogus` | error listing available templates; `.substrate/` NOT created (name validated **first**, before the conflict check and any fs work) |
| `substrate init --template` (no value) | error: `--template requires a value` |
| `--template` on a non-init command | rejected by `rejectUnknownFlags` (not in that command's allowlist) |
| `init --template bogus` when `.substrate/` already exists | **template-name error wins** (name validation runs before the conflict check) |
| `init --template web-delivery` when `.substrate/` already exists | existing `conflict` from `initCommand` (name OK → conflict check fires next) |
| template write fails mid-init | partial `.substrate/` rolled back (existing try/rollback window) |
| `substrate explain` with no `.substrate/` | normal `SubstrateError` via top-level handler; no file written |
| `substrate explain` empty substrate (no boards) | valid HTML with "No boards yet"; exit 0 |
| `substrate explain --out path/to/x.html` | writes there; prints abs path |
| `substrate explain` (default) | writes `./substrate-explain.html`; prints abs path |
| board with a `"*" -> done` guard | one gate annotation on `done`, NOT an edge from every group |
| guard referencing a missing group id | listed in policy section, edge skipped, no invented node |
| multiple concrete guards on the same `from→to` edge | ONE edge drawn (`N gates` / concatenated label); all listed in the policy detail |
| non-adjacent concrete guard (e.g. `backlog → done`) | drawn as a truthful long labeled edge; backbone only suppresses the adjacent plain edge it overlaps |
| archived group present | rendered, styled distinctly + `(archived)`; NOT woven into the sequential backbone |
| guard/responsibility referencing `task.group_id` | shown as literal field `group_id` (never `custom_data` fallback) |
| `agent_responsibility` with `when` on `scope` (not group_id) | not on graph; in "always-on / conditional" list with full prose |
| `agent_responsibility` with empty `when` | always-on; in the conditional list, labeled always-on |
| group/policy name containing `"`, `<`, `>`, `&`, `'`, `<script>`, newlines | HTML-escaped in HTML contexts, XML-escaped in SVG `<text>`/`<title>`; file still valid + renders |
| malformed `definition` inside a schema-valid board | condition renders "(unparseable condition)"; no crash |
| `explain` with `.substrate/` but no `data.sqlite` | works (reads substrate-as-code only; DB never opened) |
| shipped `.ts` template diverges from `examples/` board | the parse-equal drift test fails (canonicalized parse-equality, not byte-identity) |

## 5. Test strategy

- **`init` template tests (`init.test.ts` extended + integration):** bare init unchanged (existing tests pass); `--template web-delivery` writes `boards/delivery.json`; the written board passes `loadSubstrate` (Zod + integrity) and its Done gate blocks/allows (reuse `example-substrate.test.ts` assertions); unknown template errors and **does not create** `.substrate/`; `--template` with no value errors; `--template=name` form works.
- **Template registry unit test:** `isTemplateName` / `loadTemplateBoard` return a `BoardSchema`-valid board from the bundled `.ts` module; unknown name handled. Assert `loadTemplateBoard` does call `BoardSchema.parse` (e.g. it rejects a deliberately-corrupted board), since `createBoardFile` does not validate.
- **Parse-equal drift test:** the bundled `web-delivery.board.ts` and `examples/web-delivery/.substrate/boards/delivery.json` are equal by **canonicalized parse-equality** (`JSON.stringify` of a key-sorted/canonicalized parse of each), NOT byte-identical — fails on divergence (§3.2 / §7-R5). The `examples/` JSON is authoritative; the `.ts` module mirrors it.
- *(No post-build-copy test — the `.ts` module compiles into `dist/` like any source file, so a missing-bundled-template failure is impossible. Dropped per Architect CONCERN 1.)*
- **`explain` generator unit tests (pure, no fs/browser):**
  - `describeConditions` renders each operator to its phrase (table-driven); compound trees; unparseable → "(unparseable condition)"; `task.group_id` → literal `group_id` (not `custom_data`), `task.<custom>` → `<custom>` (custom_data note).
  - `svg.ts`: sequential backbone for a plain board; a concrete guard replaces the adjacent edge (no double edge); multiple guards on one edge → one edge; a non-adjacent guard → a long edge that doesn't suppress the backbone; an archived group is not in the backbone; `"*" -> done` yields exactly one gate annotation (assert NOT N edges); `agent_responsibility` with `group_id` `when` attaches to the node, others don't; deterministic byte-identical SVG for a fixed board.
  - `html.ts` escaping (two passes): `escHtml` escapes `& < > " '`; `escXml` escapes SVG `<text>`/`<title>` content; a `<script>`-bearing group name appears nowhere unescaped; a `"`/`<`-bearing label doesn't break the SVG; spot-check the easy-to-forget strings (field names, enum `values`, `created_by_agent`, `on_failure_message`) are escaped.
- **`explain` command integration:** init `--template web-delivery` → `explain` → assert the file is written at the default path, is non-empty valid HTML, contains the board name, an `<svg` block, the field_schema table, and the `gate-done` policy; `--out` honored; empty substrate → "No boards yet" file; `explain` works with `data.sqlite` deleted/absent.
- **Manual smoke (`tests/manual/run-smoke.mjs`):** add an `explain` step (run `explain`, assert exit 0 + file exists + contains `<svg`). Add `init --template web-delivery` as a covered path. Optionally open the generated file once by hand to confirm the inline SVG renders (no network needed) — a documented check.
- **Version drift guard:** existing `whoami.test.ts` assertion updated; `PHASE_STRING ⊇ BINARY_VERSION` holds.
- **Full suite green:** `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build` (server+ui), concurrency smoke, manual MCP smoke. `pnpm publish --dry-run` (after build) still lists only `dist/**` + the three root docs + `package.json` — the bundled template is a compiled `.ts` module under `dist/`, so it ships correctly and the whitelist is unaffected (no vendored library, no new asset).

## 6. Operator tasks (NOT done by the agent)

Unchanged from Phase 6 §6: live `npm publish`, the real `v0.2.0` tag push, npm token/secret config remain Diego's. This phase ships in-repo + dry-run-verified; removing nothing about the operator gate. The agent additionally **does not** publish — the `0.2.0` release is cut by the existing `publish.yml` on the operator's tag push.

## 7. Resolved decisions (Architect Reviewer changes + product-owner rendering)

The Architect Reviewer returned APPROVE-WITH-CHANGES; the product owner picked the rendering. All items below are now **locked** (no open questions remain).

1. **Rendering — RESOLVED: hand-rolled inline SVG (Mermaid rejected).** The product owner chose plain inline SVG over Mermaid: no CDN, no `--offline`/`--inline` flag, no ~3 MB vendored library, zero new runtime dependencies — every output file is self-contained, offline, and tiny (§3.5.1). The prior CDN-vs-vendor tradeoff is moot; this R1 is closed.
2. **Default output path — RESOLVED: `./substrate-explain.html`** (project root) over `.substrate/explain.html`: discoverable, doesn't muddy `.substrate/` state vs. generated docs, easy to share/gitignore. `--out` overrides (§3.4).
3. **Version → `0.2.0`** (minor, additive); `BINARY_SCHEMA_VERSION` stays `2`; **4 sources + 1 guard** (§3.6, Architect NIT 6).
4. **Edge-derivation rules** (§3.5.2): sequential backbone over non-archived groups, concrete guards replace the adjacent edge (or draw truthful long edges when non-adjacent), multiple guards on one edge collapse to one, `"*" -> X` is a single entry-gate annotation (never N edges), archived nodes render but stay off the backbone, group-scoped responsibilities attach to nodes and the rest list in a conditional section (Architect CONCERN 4).
5. **Template source of truth + drift test — RESOLVED (Architect R5):** `examples/web-delivery/.substrate/boards/delivery.json` is the **human-facing authoritative reference**; the `.ts` module mirrors it; a **parse-equal** test (canonicalized parse-equality, NOT byte-identical) fails on divergence (§3.2).
6. **Bundling mechanism — RESOLVED (Architect CONCERN 1):** a type-checked `.ts` template module (`web-delivery.board.ts`) compiled straight into `dist/` — **no post-build copy, no runtime asset read** — chosen over the JSON-copy mechanism because it makes a missing-from-`dist/` failure impossible and adds compile-time type-checking. `loadTemplateBoard` MUST still call `BoardSchema.parse` (since `createBoardFile` does not validate) (§3.2–3.3).
7. **HTML + SVG safety — RESOLVED (Architect NIT 5):** TWO distinct escaping passes — HTML-escape (`& < > " '`) for HTML text/attribute contexts and XML/SVG-text escape for `<text>`/`<title>` content — with every author string (field names, enum `values`, `created_by_agent`, `name`/`description`, `on_failure_message`) routed through one of them; no markdown rendering in the CLI output; lower-stakes-than-served-UI noted (§3.5.4).
8. **Init error ordering — RESOLVED (Architect CONCERN 3):** (1) validate `--template` name → (2) `existsSync(root)` conflict check → (3) create `.substrate/` + write template; write failure rolls back via the existing `rm(root)` (§3.1).

## 8. Definition of Done (for this spec)

**Status: APPROVED (incorporates Architect Reviewer changes + product-owner rendering decision) — ready for planning.** The Architect Reviewer returned APPROVE-WITH-CHANGES; the product owner chose hand-rolled inline SVG over Mermaid. All seven decisions are folded in: R1 is resolved (inline SVG, no Mermaid/CDN/`--offline`); the §3.2 shipping mechanism is a type-checked `.ts` template module (no post-build copy); the §7-R5 drift test is parse-equal; init error ordering, the four under-specified edge shapes, two-pass HTML/SVG escaping, and the 0.2.0 lockstep counting are all locked. Per Diego's standing directive there is no separate approval pause: Architect drafts the Phase 7 plan → Architect Reviewer → revision → development.
