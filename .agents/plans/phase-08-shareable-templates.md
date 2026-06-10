# Phase 8 Plan — Shareable substrate templates (`substrate add` + `init --template <path>`) → v0.3.0

**Status:** COMPLETE — shipped as `phase-08-complete` (**v0.5.0**, not the plan's 0.3.0 — renumbered behind Phase 9/7b). Code Reviewer APPROVE-WITH-CHANGES (C1 fixed, no blockers); audit PASS. (Reviewed v1.1: B1–B2 + C1–C5 + N1–N2 incorporated.)
**Author:** Architect
**Last updated:** 2026-06-06
**Spec:** [`specs/phase-08-shareable-templates-spec.md`](specs/phase-08-shareable-templates-spec.md) (APPROVED — B1–B3 + C1–C6 + O1–O7 folded in)
**Architecture plan:** [`v1-architecture.md`](v1-architecture.md)
**Predecessor:** Phase 7 (`phase-07-complete`, v0.2.0) — `substrate init --template <bundled-name>` (type-checked `.ts` registry: `web-delivery`) + `substrate explain` (self-contained inline-SVG HTML). In-repo + dry-run-verified; live publish operator-gated; repo private at `42pe/substrate`, unpublished. Toolchain **pnpm 9.15.9** (corepack pin); CI green on ubuntu + macos.
**Feature branch:** `feature/phase-08-shareable-templates` (from `main`, tag `phase-07-complete`).

---

## 1. Overview

Phase 8 lets people **share a substrate's workflow** — boards + their groups/field_schema/policies, NEVER tasks/comments/DB — by publishing it in a Git repo or local dir, and lets a human point their agent at that source to **apply** it. A shared substrate is a **template** (same artifact kind as the bundled `web-delivery`, but author-published). **The agent does the network fetch (it has `git`); the CLI stays network-free and takes a LOCAL PATH only.** Two entry points:

1. **`substrate add <path> [--yes] [--as <id>]`** — merge a template's boards into an _existing_ `.substrate/`. **Dry-run by default** (validate + preview, write nothing); `--yes` applies transactionally. Board-id collisions **refuse by default**; `--as <id>` renames a single-board template on apply.
2. **`substrate init --template <name-or-path>`** — Phase 7's flag now resolves a **bundled name** OR a **local path** for a _fresh_ project (writes all the template's boards).

New artifacts: a `substrate-template.json` manifest (Zod, `.strict()`), a network-free fs-only resolver, and a shared safe-board-id validator.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. Additive → `BINARY_VERSION` → **`0.3.0`** at acceptance (Step 6).

**6 steps, ONE consolidated Code Reviewer gate (Step 5).** Foundations land first (Steps 1–4 build bottom-up: manifest+resolver → `add` → `init` extension → example/docs), then the single reviewer pass over the whole diff, then acceptance + version bump + audit + merge (Step 6).

## 2. Branching & merge strategy

- Create `feature/phase-08-shareable-templates` from `main` (tag `phase-07-complete`).
- Commit per step. ONE Code Reviewer pass (Step 5).
- Fast-forward merge to `main`, no squash, tag **`phase-08-complete`**.
- **The `v0.3.0` release tag is NOT pushed by the agent** — it is the operator trigger that fires `publish.yml`. The agent stops at `phase-08-complete`, everything publish-ready + dry-run-verified.

## 3. Implementation order

### Step 1 — Manifest schema + resolver + shared board-id validator (Backend Engineer)

The network-free foundation: the `substrate-template.json` schema, the local-path resolver, and the shared safe-board-id check that `writer.ts` and `add` both consume.

**Shared safe-board-id validator (spec §3.5 / C2).** Extract the safe-id rule out of `writer.ts`'s private `assertSafeBoardId` (today it throws a deliberately-misleading `not_found` "Board '<id>' not found." tuned for read paths) into a shared module so `writer.ts` and `add` share **one** definition:

- New `src/substrate/board-id.ts` (or co-locate in an existing shared spot): `isSafeBoardId(id: string): boolean` — the predicate (`id.length>0 && id===basename(id) && !id.includes('/') && !'\\' && !'..')`). No throw.
- `writer.ts` keeps its read-path wrapper that throws `not_found` for `createBoardFile`/`mutateBoardFile` (behavior unchanged — its tests stay green) but now derives the boolean from `isSafeBoardId` rather than duplicating the rule.
- `add`'s `--as` path calls `isSafeBoardId` and, on failure, raises a **rename-specific** `schema_violation`: ``--as id '<id>' is not a valid board id: must be a single path component, no '/', '\\', or '..'.`` (NOT writer.ts's `not_found`.)

**Manifest schema (`src/cli/templates/manifest.ts`, spec §3.2):**

- `TemplateManifestSchema = z.object({ name: z.string().min(1), description: z.string(), version: z.string().min(1), boards: z.array(z.string().min(1)).min(1), author: z.string().optional(), homepage: z.string().optional(), source: z.string().optional() }).strict()`.
- `.strict()` is deliberate (C4): an unknown key is a hard error; relaxing later is backward-safe, tightening would break. `version` is author metadata only — echoed, never enforced, never compared to `BINARY_VERSION`. `homepage`/`source` are informational, **never fetched**.
- Export the inferred `TemplateManifest` type.

**Resolver (`src/cli/templates/external.ts`, spec §3.3) — `loadExternalTemplate(path): Promise<ResolvedTemplate>`** where `ResolvedTemplate = { manifest: TemplateManifest | null; source: 'manifest' | 'convention'; boards: Board[] }`. Network-free, fs-only (`node:fs/promises`, `node:path` only — no git/HTTP import). Resolution precedence (locked, deterministic):

1. **URL-shaped arg** (matches `^[a-z][a-z0-9+.-]*://` or `git@`) → reject FIRST with the network-free message: "Substrate does not fetch over the network. Have your agent clone the repo, then run `substrate add <local-clone-dir>`."
2. **`path` does not exist** → `not_found` ("No such path: `<path>`").
3. **`path` is a `.json` file** → it MUST be named `substrate-template.json` (its dir is the template root). A `.json` file with any other name → the distinct **O3** error: "that's a board file, not a template; point at the template directory or its substrate-template.json." (Detected by filename only — we do not sniff contents.) **C5: the O3 filename check applies ONLY to the top-level CLI arg — never to board files discovered under a resolved directory** (manifest `boards[]` entries and convention-scan `*.json` files are board files by definition and are not subject to the `substrate-template.json` name check).
4. **`path` is a directory** → look for `substrate-template.json` at the dir root:
   - **Found** → manifest mode. Parse JSON; `TemplateManifestSchema.parse`; for each `boards[]` entry resolve against the manifest dir, assert the resolved real path stays inside the root subtree (path-traversal guard, reject `..`/absolute/`~`), assert the `.json` exists (else error naming the missing file), read + `BoardSchema.parse` each.
   - **Not found** → **convention mode.** Probe in fixed order, the **first** that exists and contains ≥1 `*.json`: (a) `<dir>/.substrate/boards/`, (b) `<dir>/boards/`. Load **every** `*.json` in that one dir, **sorted**, parse + `BoardSchema.parse` each. No union (O7).
   - Neither → `not_found`: "No `substrate-template.json` and no boards under `.substrate/boards/` or `boards/` at `<path>`. Is this a substrate template?"
   - **Present-but-broken manifest** (invalid JSON or fails the schema) → hard `schema_violation` naming the manifest; **no silent fallback to convention** (would mask a typo).

**Validation depth (locked, spec §3.3):**

- Each board passes `BoardSchema.parse` (shape) — `createBoardFile` does NOT validate, so this parse is load-bearing; a failure names the offending file.
- **Cross-file duplicate-board-id detection (C3)** in BOTH modes, AFTER per-file parse and BEFORE `validateSubstrate`: name **BOTH** files (e.g. "Duplicate board id 'delivery' in `a.json` and `b.json`").
- **Bundle integrity** via the existing `validateSubstrate(substrate)` — construct a throwaway `{ config: <synthetic>, boards }`. The synthetic config is **type-level only** (B2): `validateSubstrate` reads `.boards` exclusively, never `ConfigSchema.parse`s `.config`, so it's never validated at runtime. `Config` is the hand-written all-required interface and the repo runs `exactOptionalPropertyTypes` — so **use a single `as Config` cast** (e.g. `{ boards } as unknown as Substrate`, or a minimal object cast `as Config`), mirroring the existing `loadTemplateBoard`'s `as Board` pattern (C3), rather than hand-filling all six fields or a `Partial`. This catches dup board id, an `enum` field missing `values`, and a `transition_guard` whose `from`/`to` resolves to a non-existent group within its own board (validateSubstrate is board-LOCAL except board-id uniqueness).
- The loader **never mutates** board fields (no re-stamping `created_at`/`version`); boards copied verbatim. The `--as` rename (Step 2) is the only field mutation.

**Tests (`manifest.test.ts`, `external.test.ts`, spec §5) using fixtures under `tests/fixtures/templates/`:**

- Manifest: valid parses; missing required field rejected; unknown key rejected (`.strict()`); `boards: []` rejected (`.min(1)`); absolute / `..`-escaping board paths rejected.
- Resolver: manifest mode loads exactly the listed boards; convention `.substrate/boards/` preferred over `boards/`; `boards/`-only works; first-non-empty wins (no union); absent manifest → convention; **present-but-broken manifest → error, NOT convention**; no-manifest+no-boards → `not_found`; a board failing `BoardSchema` fails the load naming the file; internal dup ids → `validateSubstrate`; **cross-file dup (C3) names BOTH files** (manifest + convention modes); board path escaping the root → traversal error; bare board `.json` file arg → the O3 "that's a board file" error; URL-shaped arg → network-free rejection.
- Shared board-id: `isSafeBoardId` accepts a plain id, rejects `../x`, `a/b`, `a\b`, ``, `..`; `writer.ts`'s read-path wrapper still throws the `not_found` form (unchanged).

Commit: `feat(cli): substrate-template.json manifest + local-path resolver + shared board-id validator (Step 1)`.

### Step 2 — `substrate add <path> [--yes] [--as <id>]` (Backend Engineer)

New command + dispatch + HELP. `add` is the FIRST command combining a positional `<path>` AND a value-flag (`--as`), so arg-parsing order is **locked (C5)**.

**CLI surface (`src/cli/index.ts`, `src/cli/args.ts`):**

- `ALLOWED_FLAGS_BY_COMMAND.add = new Set(['--yes', '--as'])` (in `args.ts`).
- Dispatcher `case 'add'` order (C5): (1) `extractFlagValue(rest, '--as')` FIRST (handles `--as id` and `--as=id`; bare `--as` errors; removes its value token from the residual so it can't be mistaken for the positional); (2) take the positional from the residual: `residual.find(a => !a.startsWith('-'))` (missing → usage error `substrate add <path> [--yes] [--as <id>]`); (3) `rejectUnknownFlags('add', residual)` (`--yes` is boolean, stays in residual, is in the allowlist); (4) call `addCommand(cwd, path, { yes: residual.includes('--yes'), as })`.
- `import { addCommand } from './commands/add.js'`.
- HELP: `substrate add <path> [--yes] [--as <id>]   Apply a shared substrate template (dry-run unless --yes)` + a one-line note that `<path>` is a local dir (the agent clones first). **Also refresh the existing `init --template` HELP line (N2)** — it currently reads "(templates: web-delivery)"; update it to note `--template` now also accepts a local template path.
- **`addCommand` owns its own stdout (C1):** unlike `init` (where the dispatcher prints), `addCommand` writes its OWN preview/applied summary, and the dispatcher prints nothing for `add`. This gives `add.test.ts` a direct seam to assert the preview content + the "Dry run — nothing written" line by calling `addCommand` and capturing stdout.

**`src/cli/commands/add.ts` — `addCommand(cwd, path, opts: { yes?: boolean; as?: string })`, locked step order (folds C1 + B3):**

1. **Resolve the existing substrate.** Require `.substrate/` to exist (else `not_found`: "No .substrate/ — run `substrate init` first, or use `substrate init --template <path>` for a fresh project."). `loadSubstrate(root)` to get current board ids — it runs `validateSubstrate` over the EXISTING substrate (B3). If it throws on a latent defect, this is a **conscious, documented abort**: emit a message attributing failure to the **EXISTING** substrate ("Your existing substrate is invalid and must be fixed before adding a template: <error>"), BEFORE resolving the template. Nothing written.
2. **Resolve the template** via `loadExternalTemplate(path)` (Step 1). Errors surface through the normal `SubstrateError` handler; nothing written.
3. **`--as` handling (single-board order, C1):** (a) count template boards; if `--as` && N>1 → **reject** ("`--as` renames a single board, but this template has <N> boards (<ids>). Resolve the collision by removing/renaming the existing board(s) instead.") before any further work; (b) if `--as` && N==1 → `isSafeBoardId(as)` check (rename-specific `schema_violation` on failure) → **mutate that board's `id`** to the new value.
4. **Collision check** (spec §3.5): build the existing-id set from `loadSubstrate(root).boards.map((b) => b.id)` (C4 — the loader returns **all** boards including archived, so this covers active OR archived; an archived board still owns its `boards/<id>.json` and `createBoardFile`'s `wx` would `EEXIST`). For each template board id (post-`--as`), refuse if it's in that set. Message includes the colliding id + the `--as` hint; nothing written; exit non-zero.
5. **Combined-validity** (B2 — forward-compat scaffolding, NOT today's collision defense): build `{ config: existing.config, boards: [...existing.boards, ...incoming] }` and run `validateSubstrate`. Re-confirms only board-id uniqueness across the merged set today (step 4 already enforces); will pick up any future cross-board rule for free. Two boards may legitimately share a GROUP id (unique only within a board) — not flagged.
6. **Branch on `--yes`:**
   - **No `--yes` (DRY-RUN, default):** print the preview summary (below) to stdout, exit 0, **write nothing**. Last line: `Dry run — nothing written. Re-run with --yes to apply.`
   - **`--yes` (APPLY):** write all template boards transactionally (below), then print `Applied <N> board(s) from <path> into .substrate/boards/: <id>, <id>, …`.

**Preview summary (locked shape, spec §3.4):**

```
Template: <manifest.name or "(no manifest — convention)">  v<manifest.version or "n/a">
Source: <abs path>  (<source: manifest | convention>)
Author: <manifest.author or "unknown">
Boards to add (<N>):
  - <board id>  "<board name>"  — <G> group(s), <P> policy(ies) (<T> transition_guard, <R> agent_responsibility)
  …
Collisions with existing substrate: <none | the colliding ids + the --as hint>
Dry run — nothing written. Re-run with --yes to apply.
```

- **Counted categories (locked minimum, B1):** boards, groups, and the **two real `PolicySchema.type` members only** — `transition_guard` and `agent_responsibility`. A simple type tally over `PolicySchema.type` is the locked minimum. **Do NOT print a "definition-of-done" count** — there is no such policy type; routing a DoD subtlety through `src/explain/flow.ts`'s wildcard classification is OUT of scope for the preview.
- Strings emitted as **plain text** (stdout, not HTML — no escaping concern); do not interpret author free-text as commands. The deeper safety (surfacing descriptions) is the skill's `substrate explain`-before-apply step (Step 4 / §3.1), not the counts.

**Transactional apply (locked, spec §3.5):**

- Pre-flight (steps 4–5) runs before any write so the common failure (a colliding id) can't half-land. `createBoardFile`'s `wx` prevents clobbering even under a race.
- Write boards one at a time, **tracking files created in write order**. If any `createBoardFile` throws, **roll back by `unlink`-ing ONLY the files this apply created, in REVERSE write order, best-effort** (swallow rollback errors; the original error is the actionable signal), then **rethrow**. Never roll back pre-existing boards. Mirrors `initCommand`'s try/rollback discipline.

**Tests (`add.test.ts`, spec §5):**

- dry-run (no `--yes`) prints the preview and **writes no `boards/*.json`** (assert the boards dir unchanged byte-for-byte);
- `--yes` writes the board(s); a subsequent `loadSubstrate` accepts the merged substrate;
- collision (incoming id already present, active and archived cases) refuses and writes nothing;
- `--as <newid>` applies a single-board template under the new id; `--as` rejected for multi-board (before any other work, C1); `--as` onto an existing id refuses; `--as` with an unsafe id rejected via the **shared** check with the **rename-specific** message (assert it is the `--as` message, not writer.ts's `not_found`);
- **arg-parsing order (C5):** `add ./dir --as foo --yes` extracts `--as foo`, takes `./dir`, leaves `--yes`; `add --as foo ./dir` parses identically; a bogus extra flag rejected by `rejectUnknownFlags`;
- **existing-substrate-invalid abort (B3):** with a corrupt existing substrate, `add` aborts attributing failure to the EXISTING substrate, before the template is resolved; nothing written;
- **transactional rollback (C4):** force a mid-apply failure on a multi-board template by **injecting a writer fault** (do NOT "pre-create board 2's file" — a present-and-loadable `boards/<id>.json` would be caught by the step-4 pre-flight collision check and never reach the write loop). Assert board 1's file was rolled back (reverse-order best-effort unlink), pre-existing untouched;
- `add` with no `.substrate/` → init hint;
- URL / bare-board-file args → the respective resolver errors (network-free / O3);
- preview group/policy counts match a hand-counted fixture, counting only `transition_guard` + `agent_responsibility` (no DoD category, B1).

Commit: `feat(cli): substrate add <path> — dry-run-by-default template apply with --yes/--as (Step 2)`.

### Step 3 — Extend `init --template` to accept a path (Backend Engineer)

Phase 7's `--template <name>` resolves a bundled name; Phase 8 makes it resolve a **name OR a path**, reusing Step 1's resolver.

**Disambiguation (locked, O4):** given `--template <value>`:

1. `isTemplateName(value)` → bundled, unchanged behavior (one board).
2. Else → treat as a filesystem path, `loadExternalTemplate(value)` (applies even to bare names like `web-delivery-fork` and `./x`, `../y`, `/abs`). No `./` requirement; a user wanting the path `./web-delivery` writes `./web-delivery` (not `isTemplateName`).
3. Neither bundled nor a resolvable path → **ALWAYS** the dual-failure error (no bare-name heuristic): "Unknown template 'foo': not a bundled template (available: web-delivery) and not a readable path." This **replaces** Phase 7's bundled-only message.

**`initCommand` changes (`src/cli/commands/init.ts`) — locked ordering (O5, EXTENDS Phase 7's "template error wins over conflict"):**

1. **Resolve + validate the template FIRST** (bundled-name check, else `loadExternalTemplate`) — before `existsSync(root)`, so `init --template ./bogus` fails before creating `.substrate/`. Resolution reads only the template dir, never creates `.substrate/`.
2. `existsSync(root)` conflict (unchanged).
3. Create `.substrate/` + write boards inside the existing try/rollback window. For a **multi-board** path template, loop `createBoardFile` over all boards; a write failure triggers the existing `rm(root)` rollback (whole partial `.substrate/` removed — simpler than `add`'s per-file rollback because a fresh init owns the entire dir).

- `--as` is NOT offered on `init` (a fresh project has no collisions). `add` is the rename surface.

**Success message (locked, C6) — REVISED per plan-review B1/B2.** The success message is built and printed in the **`index.ts` dispatcher** (`case 'init'`), NOT in `initCommand`, and it is a hardcoded `'Starter board 'delivery' added …'` literal that **no test currently asserts** (`init.test.ts` calls `initCommand` directly and never checks stdout). So:

- **`initCommand` must return the written board ids.** Extend `InitResult` → `{ config, root, boardIds: string[] }` (bare init → `[]`; bundled → `['delivery']`; path template → all written ids). The dispatcher cannot enumerate ids today (it only has the raw `template` string + a hardcoded `'delivery'`), so this signature change is required for the multi-board id-list message — it is a real Step-3 work item.
- **Relocate the C6 message edit to the dispatcher** (`index.ts`), printing from `result.boardIds`: unify to `Starter boards added (<template name-or-path>): <id>, <id>, …` for BOTH bundled (one-element list) and path templates. There is NO old test assertion to "update" — instead **add a spawn/smoke-level assertion** for the new message (the only seam that drives `index.ts` stdout is `tests/manual/run-smoke.mjs` / `tests/helpers/spawn.ts`; add it in Step 6's smoke or a spawn test). **Bare `init` (no `--template`) message stays unchanged.**

**Tests (extend `init.test.ts`, spec §5):**

- `initCommand` now returns `boardIds` (bare `[]`, bundled `['delivery']`, path = all ids) — assert this in `init.test.ts` (the unit seam); the success-message STRING is asserted at the spawn/smoke level (Step 6), since `init.test.ts` can't see the dispatcher's stdout (B1/B2);
- bundled name still writes its one board (`init.test.ts` asserts the board file + `boardIds === ['delivery']`);
- a path template (single + multi board) writes all its boards, `loadSubstrate` accepts them, and `boardIds` lists them all;
- bundled-name-first disambiguation (a path equal to a bundled name resolves bundled — documented);
- not-bundled-not-a-path → the **dual error always** (no bare-name heuristic, O4);
- template resolution failure leaves **no `.substrate/`** created (resolve-first ordering preserved, O5);
- `init --template <path>` into an existing `.substrate/` → template resolves first, then the conflict fires;
- bare `init` success message unchanged.

Commit: `feat(cli): init --template accepts a local template path (Step 3)`.

### Step 4 — Example manifest + skill/docs touch-ups (Backend Engineer)

**Example manifest (spec §3.8):** add `examples/web-delivery/substrate-template.json` (`name`/`description`/`version`/`boards: [".substrate/boards/delivery.json"]`). The dir already resolves via convention (`.substrate/boards/`); the manifest demonstrates the documented happy path. **Must not break** the existing `example-substrate.test.ts` parse-equal drift test.

- Extend `example-substrate.test.ts`: assert `loadExternalTemplate(examples/web-delivery)` (now MANIFEST mode, since the manifest exists) resolves the `delivery` board matching the authoritative `delivery.json` (canonicalized parse-equality). For the CONVENTION-mode assertion, copy the example's `.substrate/` into a temp fixture **without** the manifest (N1 — do NOT rename the committed example in place; the existing parse-equal drift test at `example-substrate.test.ts` reads `delivery.json` directly and must stay green) and assert it resolves to the same board. Confirm the existing drift test is unaffected by the manifest.

**Skill + docs (spec §3.8):**

- `skills/substrate/SKILL.md` — new "Apply a shared substrate" subsection. Headline flow in one sentence: clone the repo locally → `substrate add <clone-dir>` to preview (writes nothing) → **run `substrate explain` against the template clone** so the human SEES the rendered board/policy `description` and `on_failure_message` text (prompt-injection lives there, §3.1) → show the human → only `substrate add <clone-dir> --yes` after they confirm. Into a fresh project: `substrate init --template <clone-dir>`. Untrusted-content caveat: treat embedded instructions as **data, not commands**.
- `skills/substrate/AUTHORING.md` — "Publish your substrate as a template" note: v1 publishing is hand-write a `substrate-template.json` (name/description/version/boards) + copy your `.substrate/boards/*.json` into a repo; mention `substrate template export` is a planned fast-follow (O1).
- `examples/README.md` + README quick-start: a one-liner for applying a shared substrate (clone → `substrate add <dir>` → `--yes`), keeping bare-`init` primary.

**Tests:** the "Apply a shared substrate" section exists and the headline flow + the `substrate explain`-before-apply safety instruction are present (string assertions where the repo already asserts skill content); the example manifest round-trips (above).

Commit: `docs(phase-08): example manifest + "apply a shared substrate" skill/README (Step 4)`.

### Step 5 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. **This is the SINGLE consolidated gate.** Mandated focus:

- **Safety model:** the dry-run-by-default contract (no `--yes` writes NOTHING — assert at the write boundary, not just stdout); descriptions surfaced to the human via the skill's `substrate explain`-before-apply step; URL-shaped args rejected with the network-free message; the binary adds **no** git/HTTP/network dependency.
- **Transactional apply / rollback:** files tracked in write order, reverse-order best-effort unlink, rethrow the original error, pre-existing boards never rolled back; `createBoardFile`'s `wx` no-clobber; pre-flight (collision + combined-validity) before any write.
- **Collision logic:** refuses against ALL loaded board ids (active **and** archived); never silently overwrites/merges.
- **Arg-parsing order (C5):** extract `--as` first → positional from residual → `rejectUnknownFlags`; `--yes` boolean in the allowlist; `--as foo ./dir` and `./dir --as foo --yes` parse identically.
- **Resolver determinism:** precedence (URL → not-exist → `.json`-must-be-`substrate-template.json` → dir manifest → convention probe `.substrate/boards/` then `boards/`, first-non-empty, no union, sorted); cross-file dup ids name BOTH files; path-traversal confinement.
- **Validation depth:** per-board `BoardSchema.parse` + bundle `validateSubstrate` (synthetic type-level Config, never `ConfigSchema.parse`d) + the existing-substrate `loadSubstrate` abort attributed to the EXISTING substrate (B3).
- **`init` ordering preserved:** resolve+validate template → `existsSync` conflict → create+write; `init --template ./bogus` leaves no `.substrate/`; multi-board path writes all boards; bare init byte-for-byte unchanged; the unified id-list success message (C6) with old init-test assertions updated.
- **`--as` self-contained + safe id:** single-board only; rejected for multi-board before other work; `isSafeBoardId` via the **shared** validator with the **rename-specific** message (not writer.ts's `not_found`); rename touches the id only (policies reference GROUP ids; templates carry no tasks).

Fix BLOCKERs + CONCERNs in a `fix(review)` commit.

Commit: `fix(review): address Phase 8 Code Reviewer findings (Step 5)` (only if findings).

### Step 6 — Acceptance + 0.3.0 + audit + merge (Backend Engineer → Assistant)

**Full acceptance gate (spec §5):**

- `pnpm build` (server + ui).
- `pnpm test` (server unit + integration).
- `pnpm --dir ui test`.
- `tsc` root + ui.
- `eslint` (root) + `pnpm --dir ui lint`.
- `prettier --check`.
- `pnpm test:smoke:concurrency`.
- manual MCP smoke (`node tests/manual/run-smoke.mjs`) — **add an `add`/template-apply step:** `init` a project, point `add` at `examples/web-delivery/` (dry-run: assert exit 0 + **no boards written** + summary contains `delivery`), then `--as delivery2 --yes` (assert `boards/delivery2.json` exists + `loadSubstrate` passes).
- `pnpm test:smoke:ui` (Playwright; builds UI first).
- **Packaging:** `pnpm build` THEN `pnpm publish --dry-run` (file list = whitelist exactly: `dist/**` incl. `dist/ui/**` + `README.md` + `LICENSE` + `CHANGELOG.md` + `package.json`, no extras — the resolver is ordinary compiled source; no new asset). THEN `pnpm pack` + `npx ./<tarball> --help`. **Add a real apply-from-a-local-template-dir round-trip:** in a temp dir `npx ./<tarball> init`, then `npx ./<tarball> add <a local template dir> --yes`, assert the board round-trips via `loadSubstrate`; also `npx ./<tarball> init --template <local dir>` writes all boards.
- **C7 build-isolation grep:** `dist/server/` contains no `react`/`marked`/`dompurify`.
- **Confirm NO new runtime dependency / still network-free:** `package.json` `dependencies` unchanged (no git/HTTP lib); grep the resolver/`add` sources import only `node:fs`/`node:path`/`zod`/internal modules.

**Version bump → 0.3.0 (spec §3.7) — 4 sources + 1 guard. `BINARY_SCHEMA_VERSION` stays `2`:**

- `src/core/version.ts` `BINARY_VERSION` → `'0.3.0'`.
- `package.json` `version` → `0.3.0`.
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → `'v0.3.0 (shareable templates)'` (replaces `'v0.2.0 (init templates + explain)'`).
- `CHANGELOG.md` → a `0.3.0` entry (added: `substrate add <path>` for applying shared templates; `init --template <path>` accepts a local template dir; `substrate-template.json` manifest).
- **Guard (test, not a source):** `src/mcp/tools/read/whoami.test.ts` — the current assertion is `toMatch(/init templates|explain/)`; update it to `toMatch(/shareable templates/)` (C2 — `PHASE_STRING` becomes `'v0.3.0 (shareable templates)'`, which does NOT contain "substrate add", so don't use that alternative); the `PHASE_STRING ⊇ BINARY_VERSION` invariant (`expect(result.phase).toBe(PHASE_STRING)` + `toContain(\`v${BINARY_VERSION}\`)`) is preserved.
- Confirm all four sources read `0.3.0` and the drift guard passes.

Then:

- Spawn Assistant → `.agents/audits/phase-08-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag **`phase-08-complete`**.
- **STOP here.** Do NOT push the `v0.3.0` release tag, do NOT publish — operator triggers (§Operator).

Commits: `chore(phase-08): acceptance pass + 0.3.0 lockstep (Step 6)`, `docs(phase-08): assistant audit (Step 6)`.

## 4. Edge cases (spec §4)

| Case                                                        | Expected                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `substrate add` (no path)                                   | usage error `substrate add <path> [--yes] [--as <id>]`; nothing written                               |
| `add <dir>` (no `--yes`)                                    | DRY-RUN: validate + preview; write nothing; exit 0; "Dry run — nothing written. Re-run with --yes…"   |
| `add <dir> --yes`                                           | apply all boards transactionally; applied summary                                                     |
| `add <url>` / `git@…`                                       | network-free rejection (clone first)                                                                  |
| `add <dir>` with `substrate-template.json`                  | manifest mode; loads `boards[]`                                                                        |
| `add <dir>` no manifest, has `.substrate/boards/*.json`     | convention (`.substrate/boards/` first)                                                               |
| `add <dir>` no manifest, has `boards/*.json` only           | convention (`boards/`)                                                                                 |
| `add <dir>` no manifest, no boards                          | `not_found` "Is this a substrate template?"                                                           |
| `add <dir>` manifest present but invalid/fails schema       | hard `schema_violation`; NO convention fallback                                                       |
| manifest `boards` entry escapes the dir (`../x`)            | traversal error; nothing written                                                                      |
| manifest `boards` entry missing on disk                     | error naming the missing file                                                                         |
| a template board fails `BoardSchema`                        | load fails naming the file                                                                            |
| template has internal duplicate board ids                   | `validateSubstrate` rejects                                                                            |
| cross-file duplicate board ids                              | error naming BOTH files (C3)                                                                           |
| `add` when `.substrate/` absent                             | `not_found`: "run `substrate init` first, or use `substrate init --template <path>`"                  |
| `add` when EXISTING substrate is invalid                    | abort BEFORE resolving the template; failure attributed to the existing substrate (B3); nothing written |
| `add`/`--template` pointed at a bare board `.json`          | O3 error "that's a board file, not a template…"                                                       |
| `add <dir>` template board id already exists locally        | REFUSE: collision + `--as` hint; nothing written                                                      |
| `add <dir>` collision + `--as <newid>` (single-board)       | applied under `<newid>` (after collision + `isSafeBoardId`)                                            |
| `--as <newid>` where `<newid>` ALSO exists                  | refuse (collision on renamed id)                                                                      |
| `--as` with a multi-board template                          | rejected ("`--as` renames a single board, but this template has N boards…")                           |
| `--as` unsafe id (`../x`, `a/b`)                            | rejected via the shared check, rename-specific message                                                |
| multi-board apply, board 2 write fails after board 1        | roll back board 1 (reverse order, best-effort); rethrow; pre-existing untouched                       |
| collision against an ARCHIVED board's file                  | still refuses (`wx` would EEXIST)                                                                      |
| `init --template web-delivery`                              | bundled, one board; `Starter boards added (web-delivery): delivery` (C6)                              |
| `init --template ./my-template` (fresh)                     | resolves path, writes ALL boards; id-list message; `--as` not offered                                 |
| `init --template <path>` into existing `.substrate/`        | template resolves first; then the conflict fires                                                      |
| `init --template foo` (not bundled, not a path)             | dual error (not bundled + not a readable path)                                                        |
| template text contains agent-directed instructions          | applied verbatim as data; skill caveats human approval; CLI never executes it                         |

## 5. Test mapping (spec §5 → plan)

| Spec requirement                                                                            | Plan location                          |
| ------------------------------------------------------------------------------------------- | -------------------------------------- |
| manifest: valid; missing required; unknown key (`.strict()`); `boards:[]`; abs/`..` paths   | Step 1 (`manifest.test.ts`)            |
| resolver: manifest mode loads listed boards                                                 | Step 1 (`external.test.ts`)            |
| convention `.substrate/boards/` preferred; `boards/`-only; first-non-empty (no union)       | Step 1                                 |
| absent manifest → convention; present-but-broken → error not convention                     | Step 1                                 |
| no manifest + no boards → `not_found`                                                       | Step 1                                 |
| board fails `BoardSchema` → load fails naming file                                          | Step 1                                 |
| internal dup ids → `validateSubstrate`; cross-file dup names BOTH files (C3, both modes)    | Step 1                                 |
| board path escaping dir → traversal error                                                   | Step 1                                 |
| bare board `.json` arg → O3 distinct error                                                  | Step 1                                 |
| URL-shaped arg → network-free rejection                                                     | Step 1                                 |
| shared board-id validator; writer.ts read-path wrapper unchanged (C2)                       | Step 1                                 |
| dry-run prints preview + writes no `boards/*.json`                                          | Step 2 (`add.test.ts`)                 |
| `--yes` writes board(s); merged `loadSubstrate` accepts                                     | Step 2                                 |
| collision (active + archived) refuses, writes nothing                                       | Step 2                                 |
| `--as` single-board apply; rejected multi-board (C1); onto existing id refuses; unsafe (C2) | Step 2                                 |
| arg-parsing order C5 (both flag orders; bogus flag rejected)                                | Step 2                                 |
| existing-substrate-invalid abort attributed to existing substrate (B3)                      | Step 2                                 |
| multi-board transactional rollback (reverse-order best-effort unlink)                       | Step 2                                 |
| `add` no `.substrate/` → init hint                                                          | Step 2                                 |
| preview counts only `transition_guard` + `agent_responsibility` (no DoD, B1)                | Step 2                                 |
| bundled `init --template` writes one board, id-list success message updated (C6)            | Step 3 (`init.test.ts`)                |
| path template (single + multi) writes all boards, id-list message                           | Step 3                                 |
| bundled-name-first disambiguation                                                           | Step 3                                 |
| not-bundled-not-path → dual error always (O4)                                               | Step 3                                 |
| template-resolution failure leaves no `.substrate/` (O5)                                    | Step 3                                 |
| bare init success message unchanged                                                         | Step 3                                 |
| example manifest round-trips manifest + convention to same board; drift test intact         | Step 4 (`example-substrate.test.ts`)   |
| "Apply a shared substrate" section + `substrate explain`-before-apply step present          | Step 4                                 |
| manual smoke: `add` dry-run (no write) + `--as … --yes` apply                               | Step 6 (`run-smoke.mjs`)               |
| dry-run whitelist unchanged; pack/npx; real apply-from-local-dir round-trip                 | Step 6                                 |
| C7 build-isolation grep; no new dependency / network-free                                   | Step 6                                 |
| version: 4 sources at `0.3.0`; `PHASE_STRING ⊇ BINARY_VERSION` guard; whoami copy; schema 2 | Step 6                                 |
| full suite green (build/test/ui test/tsc/eslint/prettier/concurrency/manual MCP/ui smoke)   | Step 6                                 |

## 6. Risks

- **R1 (silent write in dry-run):** the headline safety risk. Mitigation: dry-run branch writes NOTHING; the `add.test.ts` dry-run case asserts the boards dir is byte-for-byte unchanged; Step 5 reviews the write boundary.
- **R2 (partial multi-board apply):** mitigated by pre-flight collision/validity before any write, `wx` no-clobber, and the tracked reverse-order best-effort rollback with a dedicated test.
- **R3 (path traversal via author-controlled `boards[]`/filenames):** mitigated by the resolver confining reads to the template subtree and writes through `createBoardFile`'s `isSafeBoardId`-backed id check.
- **R4 (network creep):** mitigated by URL rejection, the no-new-dependency check, and the import grep in Step 6.
- **R5 (init ordering regression):** resolve-first preserved (O5); `init --template ./bogus` leaves no `.substrate/`; bare init unchanged with its existing tests green.
- **R6 (writer.ts refactor breaks read paths):** mitigated by keeping writer.ts's `not_found` wrapper behavior identical, derived from the shared predicate; its existing tests must stay green.
- **R7 (version drift recurrence):** mitigated by the preserved `PHASE_STRING ⊇ BINARY_VERSION` assertion.

## 7. Definition of Done

- All step commits on `feature/phase-08-shareable-templates`.
- Single Code Reviewer pass done (Step 5); BLOCKER/CONCERN findings resolved.
- Spec §5 acceptance gate met; dry-run + pack/npx smoke clean (incl. the real apply-from-a-local-template-dir round-trip); C7 build-isolation grep clean; no new dependency; still network-free.
- All four version sources at `0.3.0` / `v0.3.0 (shareable templates)`; `BINARY_SCHEMA_VERSION` still `2`; drift guard passing; whoami copy assertion updated.
- Assistant audit clean.
- Fast-forward merge to `main`, tag `phase-08-complete`. **Live publish + `v0.3.0` tag remain operator-gated.**

## Operator tasks (NOT done by the agent — spec §6)

```
Unchanged from Phase 6/7 §6. The agent ships in-repo + dry-run-verified and stops
at `phase-08-complete`. Diego performs the live, credentialed, irreversible steps:

1. Review `pnpm publish --dry-run` for the 0.3.0 tarball.
2. Push the real `v0.3.0` release tag → fires `publish.yml`, which runs the live
   `pnpm publish --access public` (the 0.3.0 release is cut by the operator's tag
   push, not the agent).
3. npm token / `NPM_TOKEN` secret config remains Diego's.
4. (CI runs on the Phase 8 PR — confirming CI green on a real PR is an operator step.)
```
