# Phase 6 Spec — OSS artifacts + CI + npm publishing + full `reverse_captcha`

**Status:** APPROVED (incorporates Architect Reviewer changes; B1 + C1–C7 + N1–N5 addressed) — ready for planning.
**Standing directive:** Diego's standing instruction is to proceed without per-phase approval pauses; no separate confirmation gate is required before planning begins.
**Author:** Spec Team
**Last updated:** 2026-06-05
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 Phase 6 (~line 412)
**Predecessor:** Phase 5b (`phase-05b-complete`, v0.0.6) — read-only React UI on the 5a JSON API. Full 30-tool MCP surface; HTTP server with security middleware + read API + SPA. `reverse_captcha` is still the Phase 3 stub.

---

## 1. Goal

Make Substrate ship-ready for public release **v0.1.0**. This is the FINAL v1 phase. It delivers everything an open-source npm package needs — root OSS docs, a GitHub Actions CI + publish + issue-hygiene pipeline, npm publishing config verified by `--dry-run` — and replaces the `reverse_captcha` stub with the real, self-verifiable, timed agent puzzle (the easter egg `whoami` has been pointing at since Phase 3).

Everything in this phase is delivered **in-repo + dry-run-verified**. The live `npm publish`, the real tag push, repo creation, and credential/secret setup are **operator tasks Diego performs** (§6); the agent cannot and must not do them.

**No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. `BINARY_VERSION` → `0.1.0` at acceptance.

## 2. Scope

**In scope:**
- **OSS root artifacts** (§3.1): `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SUPPORT.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/`, `examples/README.md`.
- **GitHub Actions** (§3.2): `.github/workflows/ci.yml`, `publish.yml`, `auto-close-incomplete-issues.yml`.
- **npm publishing setup** (§3.3): `package.json` `files` whitelist, `publishConfig`, confirm `bin`; `pnpm publish --dry-run` shows the right files with no extras.
- **Full `reverse_captcha`** (§3.4): two-step issue/verify protocol over an in-memory challenge store in the long-lived MCP process; deterministic puzzle generator; ~10s deadline; success + two failure responses. Replaces the stub; stays read-shaped.
- **Version bump** to `0.1.0` across the lockstep files (§3.5).

**Out of scope (operator-only — §6):**
- The live `npm publish`, the real `v0.1.0` tag push, creating the public GitHub repo.
- npm scope/token/2FA setup and the GitHub `NPM_TOKEN` secret.
- Real fresh-machine cross-platform testing (CI surfaces it; Diego does the final manual fresh-laptop walk-through).

**Out of scope (not v1):**
- Any new MCP tool or HTTP endpoint beyond the `reverse_captcha` rework.
- Persisting `reverse_captcha` state to disk/DB (in-memory only; see §3.4).
- A real example substrate in `examples/` (Phase 7 dogfood; this phase ships only the placeholder).
- Auto-deriving `BINARY_VERSION` from `package.json` at build time (still manual lockstep — a v1.x candidate noted in `version.ts`).

## 3. Design

### 3.0 Locked decisions (approved)

1. **`reverse_captcha` protocol — single tool, two call shapes, in-memory store.** One `reverse_captcha` tool. Called with **no args** → *issues* a challenge `{ challenge_id, puzzle, expires_at, instructions }`. Called with **`{ challenge_id, answer }`** → *verifies* correctness + timing against an in-memory store in the long-lived stdio MCP process. No new DB table, no file. The tool stays read-shaped (no substrate mutation, returns data directly, not a write envelope).
2. **In-memory challenge store with TTL + lazy cleanup.** A module-level `Map<challenge_id, { answer, expiresAt }>` scoped to the running MCP process. Entries expire at `expiresAt` (issue time + ~10s). Cleanup is lazy (sweep expired entries on each issue) plus single-use deletion on verify — no timers, no `setInterval`. State dies with the process; that is acceptable for an easter egg.
3. **Puzzle is deterministic per-instance, trivially LLM-solvable in <10s, and requires reading the payload.** The generator picks a template, fills it with freshly-randomised values, and computes the canonical answer at issue time (stored, never sent). The agent must actually parse the issued `puzzle` string to answer; the puzzle is not guessable without reading it. Two templates ship (§3.4.3).
4. **`Math.random()` / `Date.now()` are allowed here.** They are runtime *source*, not workflow scripts. The project's "no `Math.random`/`Date.now`" rule applies only to the deterministic build/CI **scripts** (`scripts/*.mjs`), never to runtime tool source. The generator uses both.
5. **CI Windows is non-blocking but visible.** The `windows-latest` matrix leg runs install+build+test under `continue-on-error: true` so a Windows failure is surfaced in the CI UI but does not red the required check. Ubuntu + macOS are blocking; macOS additionally runs the Playwright UI smoke.
6. **Version → `0.1.0`** at acceptance (public release). Schema unchanged (stays `2`).

### 3.1 OSS root artifacts

| File | Content (concise, authoritative) |
|---|---|
`README.md`, `LICENSE`, and `CHANGELOG.md` **already exist at the repo root** (placeholders/stubs) — this phase **overwrites** them with the authoritative content below. `CONTRIBUTING.md`, `SUPPORT.md`, and `examples/README.md` are **net-new (create)**. `CONTRIBUTING.md`/`SUPPORT.md` are correctly **NOT** in the `files` whitelist (they document the repo, they don't ship in the package).

| File | Create/overwrite | Content (concise, authoritative) |
|---|---|---|
| `README.md` | overwrite | One-paragraph "what it is" (local-first, per-project, agent-collaborative PM substrate via MCP + localhost UI). **3-command quick-start**: `npx @diegoferreyra/substrate init` → `npx @diegoferreyra/substrate serve` (UI on `http://localhost:7475`) → `npx @diegoferreyra/substrate mcp` (or the `.mcp.json` snippet for Claude Code). Supported-platforms statement: **macOS + Linux primary; Windows + WSL best-effort, CI-visible**. Link to `LICENSE`, link to `examples/`, link to `SUPPORT.md`/`CONTRIBUTING.md`. |
| `LICENSE` | overwrite | MIT, `Copyright (c) 2026 Diego Ferreyra`. Standard MIT text. |
| `CONTRIBUTING.md` | create | Bug-fix PRs **with a repro** welcome. **Architecture-changing PRs declined by default** (solo-owned design; open an issue first). How to run the test suite. Point to `SUPPORT.md` for expectations. |
| `SUPPORT.md` | create | Solo project; **weekly triage cadence; no SLAs**. Generic **Windows/WSL best-effort** support line. Where to file (issue templates). *(No jsdom/dompurify caveat — see N2 below; it does not apply to the shipped binary.)* |
| `CHANGELOG.md` | overwrite | "Keep a Changelog"-style. **Starts at `v0.1.0`** (the first public release). May fold the Phase 1–5b build-up into a single summarized "0.1.0 — initial public release" entry (MCP surface, policy engine, read API, read-only UI, OSS artifacts). |
| `.github/ISSUE_TEMPLATE/` | create | A `bug_report.yml` (GitHub issue **forms**) with **required** fields whose labels render to the exact headings the auto-close workflow greps (§3.2 / C7): `Node version`, `Operating system`, `` `substrate diagnose` output ``, `Reproduction steps`. Plus `config.yml` (`blank_issues_enabled: false`) so the form is enforced. Carries a cross-referencing comment naming `auto-close-incomplete-issues.yml`. |
| `examples/README.md` | create | Placeholder: "Real substrates will live here as Diego dogfoods; first one lands in Phase 7." Keeps the `examples/` link in the README from 404-ing. |

- The issue-form labels and the auto-close workflow are coupled via the **rendered `### ` headings** (not field ids) — the exact heading strings are pinned in §3.2 (C7), and each file cross-references the other.
- **N2 (R-P6-2 resolved):** there is **no `isomorphic-dompurify`** in the tree; `ui/` uses browser `dompurify`, and `jsdom` is a **`ui/` test-only devDependency** that is never in the shipped binary or the root `pnpm install`. The earlier Windows jsdom/dompurify install caveat is therefore **moot** and is omitted from `SUPPORT.md`. R-P6-2 downgrades to *"resolved — jsdom is a ui/ devDep only"*.

### 3.2 GitHub Actions

**pnpm pinning (C1).** There is currently no `packageManager` field and no pnpm pin, so `pnpm/action-setup` would be ambiguous. Lock the mechanism: add **`"packageManager": "pnpm@<x.y.z>"`** to `package.json` (Corepack-friendly, the preferred pin), and have **both** `ci.yml` and `publish.yml` use `pnpm/action-setup` consistently. The exact version is set in the plan/dev step by reading `pnpm --version` on the dev machine (currently `7.18.2`) and writing the matching `pnpm@7.18.2` — the dev step pins the real installed version rather than guessing.

**`.github/workflows/ci.yml`** — on push + PR:
- `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]`, `fail-fast: false`.
- Steps: checkout → setup pnpm (`pnpm/action-setup`, version from `packageManager`) → setup Node (`>=20`, matches `engines`) → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm test` → `pnpm lint` → `pnpm format:check` → concurrency smoke (`pnpm test:smoke:concurrency`).
- **`continue-on-error: ${{ matrix.os == 'windows-latest' }}`** — Windows runs but never blocks; its result is still shown.
- **macOS additionally runs the Playwright UI smoke** (`pnpm test:smoke:ui`, which builds the UI + downloads the browser). Gate it to `matrix.os == 'macos-latest'` (the architecture pins the UI smoke to macOS-only in CI). Cache/install the Playwright browser on that leg only.

**`.github/workflows/publish.yml`** — on tag matching `v*`:
- `permissions: { contents: read, id-token: write }` (required for `--provenance`).
- checkout → setup pnpm (`pnpm/action-setup`) → **`actions/setup-node` with `registry-url: 'https://registry.npmjs.org'`** (C2 — npm provenance requires the registry URL be wired through `setup-node`) → `pnpm install --frozen-lockfile` → **`pnpm build` (C3 — hard requirement; `dist/` is gitignored so the tarball contents only exist after build)** → `pnpm publish --access public --provenance --no-git-checks`.
- **Auth (C2):** `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` env on the publish step (operator-configured — §6), in addition to the `id-token: write` permission. Note: pnpm may need the token written into `.npmrc` (`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`) rather than reading `NODE_AUTH_TOKEN` directly the way npm does — the plan/dev step verifies the exact wiring against the pinned pnpm.
- Confirm `pnpm publish --provenance` is supported by the pinned pnpm version (verified in the plan/dev step).
- Runs on a single OS (`ubuntu-latest`); publish is platform-agnostic (pure JS/`dist/`).

**`.github/workflows/auto-close-incomplete-issues.yml`** — on `issues: [opened, edited]`:
- A script step (`actions/github-script`) that greps the **rendered issue BODY for the required-field section HEADINGS** (NOT the form `id:` — GitHub issue-forms render each field's `label` as a markdown `### ` heading in the body, so the workflow must match headings, not ids). If any required section is missing/blank, post a templated comment explaining what's required and **close** the issue (label `incomplete`); reopen path is "edit to add the fields."
- **Pinned coupling (C7).** The exact rendered headings the form labels and the workflow grep MUST share (any wording change breaks auto-close silently, so it's locked here):
  - `### Node version`
  - `### Operating system`
  - `` ### `substrate diagnose` output ``
  - `### Reproduction steps`
  Each file (`bug_report.yml` and this workflow) carries a cross-referencing comment naming the other (e.g. `# Headings must match auto-close-incomplete-issues.yml §C7` and vice versa) so an editor of one is warned about the other.
- **Maintainer opt-out:** skip any issue carrying the **`needs-info-exempt`** label, so legitimate non-bug discussions a maintainer flags aren't auto-closed.

### 3.3 npm publishing setup

- **`package.json` `files`** whitelist: `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` (already present — confirm it produces a clean tarball). `files:["dist"]` ships **all of `dist/**`, including `dist/ui/**`** — the built SPA the server serves — **which is intended and required** (the `serve` command serves it). What must NOT ship: `ui/` *source*, `src/`, `tests/`, `.agents/`, `.substrate/`, dotfiles. There is **no `.npmignore`**, so the `files` whitelist alone governs (whitelist beats the absence of an ignore file) — confirm there's no risk of shipping source/tests/`.substrate/`.
- **`publishConfig`**: add `{ "access": "public", "provenance": true }`.
- **`bin`**: confirm `{ "substrate": "./dist/server/cli/index.js" }` resolves to the built CLI and is executable (shebang present after build; `post-build.mjs` already runs).
- **Drop `"private": true`** so the package is publishable (it is currently `private`). Note this in §6 as the gate that arms publishing — without it `pnpm publish` refuses.
- **Build precedes dry-run (C3, hard requirement):** `dist/` is gitignored, so on a clean checkout there is nothing to pack. The whitelist check is only meaningful **after `pnpm build`** — a `--dry-run` on a clean tree with no `dist/` gives false confidence. The plan runs `pnpm build` immediately before any `--dry-run`/`pack`.
- **Verification:** `pnpm publish --dry-run` (after `pnpm build`) lists exactly `dist/**` (including `dist/ui/**`) + the three root docs + `package.json`, no extras. A `pnpm pack` tarball + local `npx ./<tarball> init` smoke is the belt-and-suspenders check (R-P1-3) — run manually, documented in the plan.

### 3.4 Full `reverse_captcha`

Replaces `src/mcp/tools/read/reverse-captcha.ts` (the stub) with the two-step timed puzzle. Still registered as the last read tool (unchanged registry order); `whoami`'s `REVERSE_CAPTCHA_HINT` still points here.

#### 3.4.1 Protocol (single tool, two shapes)

Input schema (Zod): `{ challenge_id?: string, answer?: string }`.

**Critical shape constraint (B1).** Every `reverse_captcha` response is a normal **read payload** returned with `isError: false`. It must **never** carry an `ok` field. `src/mcp/wrapper.ts` `isErrorEnvelope()` flags ANY object with `ok === false` as MCP `isError: true` (`wrapper.ts:55-57`: `return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;`). An `{ ok: false, ... }` verify-failure payload would therefore be misclassified as a tool error — contradicting the intent that success/failure is *data*. So every payload uses a `result` discriminant instead of `ok`, and the handler returns plain data (no envelope, no `ok`).

- **Issue** (`challenge_id` and `answer` both absent): generate a challenge, store `{ answer, expiresAt }` under a fresh `challenge_id`, return:
  ```
  {
    result: "challenge",
    challenge_id: string,        // opaque id (e.g. crypto.randomUUID())
    puzzle: string,              // the human/agent-readable puzzle text
    expires_at: string,          // ISO; issue time + TTL_MS (~10s)
    instructions: "Call reverse_captcha again with { challenge_id, answer } before expires_at."
  }
  ```
- **Verify** (`challenge_id` + `answer` present): look up the challenge.
  - **Solved** (found, not expired, answer matches canonical): delete the entry (single-use) and return a playful win:
    ```
    { result: "solved", message: "Solved it. You read the payload — that's the whole point. 🤖", about: { built_by: "Diego Ferreyra", site: "https://diegoferreyra.com" } }
    ```
  - **Wrong answer** (found, not expired, answer mismatches): delete the entry (no infinite retries on one challenge) and return:
    ```
    { result: "wrong_answer", message: "Not quite. Issue a fresh one with no args and try again.", about: {...} }
    ```
  - **Expired or unknown** (not found, or found-but-past-`expiresAt`): delete if present and return:
    ```
    { result: "expired", message: "Too slow — challenges live ~10 seconds. Issue a fresh one. ⏱️", about: {...} }
    ```
- `challenge_id` provided **without** `answer` (or vice versa) → a `schema_violation` (the paired refine rejects exactly-one-present) so a malformed call reads like any other bad input via the wrapper. (Define this with a Zod paired `.refine` — see §3.4.4.)

All five payloads (`result: "challenge" | "solved" | "wrong_answer" | "expired"`) are returned as the read payload (same `jsonResult` text path as other reads) and surface with `isError: false`. The tool mutates nothing and never goes through the write envelope. The challenge/solved/wrong/expired distinction is data the agent reads from `result`, not an MCP `isError`.

#### 3.4.2 In-memory store + TTL

- Module-level `const store = new Map<string, { answer: string; expiresAt: number }>()`.
- `TTL_MS = 10_000` (the ~10-second limit). `expires_at` = `new Date(Date.now() + TTL_MS).toISOString()`.
- **Lazy cleanup:** on every *issue*, sweep and delete entries whose `expiresAt < Date.now()` (bounds memory without timers). On *verify*, the looked-up entry is always deleted (single-use), so the store self-trims under normal use. No `setInterval`/`setTimeout`.
- The store lives for the life of the stdio MCP process — correct for the long-lived `substrate mcp` server. A fresh process starts empty; that is fine.
- Concurrency: MCP stdio handlers run on one event loop; Map ops are synchronous, so no locking needed.

#### 3.4.3 Puzzle generator (deterministic per challenge, LLM-trivial, payload-dependent)

A `generatePuzzle()` returns `{ puzzle: string, answer: string }`. It picks one of two templates at random and fills it with randomised values so the answer differs per challenge and **cannot be produced without reading the issued `puzzle` text**:

- **Template A — keyed extraction.** Emit a small JSON-ish payload of labelled items and ask for one field of one item, e.g.:
  > "Here are three records. Reply with the `color` of the record whose `id` is `47`: `[{id:12,color:teal},{id:47,color:amber},{id:88,color:rose}]`."
  Answer: `amber`. Forces reading the payload; trivial for an LLM; the id/colors are randomised each issue.
- **Template B — ordered transform.** Give a short list of tokens and a one-step instruction, e.g.:
  > "Take this list — `[sky, 9, fern, 4, dusk]` — and reply with the words only, in reverse order, comma-separated."
  Answer: `dusk, fern, sky`. Single deterministic transform; needs the payload; easy for an LLM in <10s.

- **Answer comparison** is normalised: trim, lowercase, collapse internal whitespace (and, for list answers, normalise comma spacing) before comparing to the stored canonical answer — so trivial formatting differences don't fail a correct agent. Spell out the exact normalisation in the plan and unit-test it.
- The generator is the only place `Math.random()` is used; the answer is computed at generation time and stored — never re-derived on verify.

#### 3.4.4 Shape / registration

- `reverseCaptchaShape = { challenge_id: z.string().optional(), answer: z.string().optional() }` with a **paired refine** (N1). Predicate intent: count how many of `{challenge_id, answer}` are present —
  - **both absent → VALID** (the issue path; the wrapper coerces `rawInput ?? {}` to `{}`, so a no-arg call is the empty object and must pass).
  - **both present → VALID** (the verify path).
  - **exactly one present → `schema_violation`** (the refine fails; reads like any other bad input).
  Tool description updated from "(Coming soon …)" to a real one-liner: "A timed logic puzzle for agents. Call with no args to get a challenge, then call again with `{ challenge_id, answer }` within ~10 seconds."
- Handler signature changes from `(): ReverseCaptchaResult` to one taking the parsed input (and nothing else — it needs no `ToolDeps`; the store is module-local). Keep it a pure-ish function the test can drive directly, with the store injectable or resettable for tests.
- **Injectable TTL/clock (N4/N5):** the handler reads "now" and the TTL through injectable seams (e.g. a `now: () => number` and `ttlMs` parameter, defaulting to `Date.now` and `TTL_MS`) so the test can deterministically produce the **expired** branch without sleeping. Note explicitly: **unknown-`challenge_id` and past-TTL both return `result: "expired"` by design** — there is deliberately no oracle distinguishing "never existed" from "timed out".
- Registry order unchanged (`registerReverseCaptcha` stays last in the read block).

### 3.5 Version bump

The manual lockstep **has already silently drifted**: `package.json` version and `BINARY_VERSION` are `0.0.6`, but `whoami`'s `PHASE_STRING` still reads `'v0.0.3 (policy engine + envelope)'` (`src/mcp/tools/read/whoami.ts:35`) — it was never updated across 0.0.4 / 0.0.5 / 0.0.6. This phase resyncs all four sync points AND adds a cheap regression guard so it can't drift again.

Sync points (all four updated in lockstep):
- `package.json` `version` → `0.1.0`. Drop `"private": true`.
- `src/core/version.ts`: `BINARY_VERSION` → `'0.1.0'`. `BINARY_SCHEMA_VERSION` stays `2`.
- `whoami`'s `PHASE_STRING` → **`'v0.1.0 (public release)'`** (replacing the stale `v0.0.3 …`).
- `CHANGELOG.md` → a `0.1.0` entry (see §3.1).

- **Drift regression guard (C5/C6):** add a cheap acceptance assertion — a unit test/check that `PHASE_STRING` *contains* `BINARY_VERSION` (e.g. `expect(PHASE_STRING).toContain(BINARY_VERSION)`). This catches future version drift between `version.ts` and `whoami` automatically. (Note: `whoami.test.ts:73` currently asserts `result.phase` matches `/policy engine/` — update that stale assertion to the new copy as part of this change.)
- Health endpoint + MCP server name/version read `BINARY_VERSION` already (no edit needed).

## 4. Edge cases

| Case | Expected |
|---|---|
| `reverse_captcha` with no args | issues `{ result: "challenge", challenge_id, puzzle, expires_at, instructions }`, `isError:false` |
| verify with correct answer in time | `{ result: "solved", message, about }`, `isError:false`; entry deleted (single-use) |
| verify with wrong answer in time | `{ result: "wrong_answer", ... }`, `isError:false`; entry deleted |
| verify after `expires_at` | `{ result: "expired", ... }`, `isError:false` |
| verify with unknown `challenge_id` | `{ result: "expired", ... }` (unknown and timed-out are intentionally indistinguishable — no oracle) |
| verify reusing a `challenge_id` already verified | `{ result: "expired", ... }` (single-use deletion → now reads as unknown) |
| `challenge_id` without `answer`, or `answer` without `challenge_id` | `schema_violation` (paired refine) |
| answer with extra whitespace / different case | accepted (normalisation) |
| many issues without verifies | lazy sweep on each issue bounds the store |
| `pnpm publish --dry-run` (after `pnpm build`) | lists `dist/**` (incl. `dist/ui/**`) + README + LICENSE + CHANGELOG + package.json only |
| issue opened missing `substrate diagnose` output | auto-close workflow comments + closes with `incomplete` |
| Windows CI leg fails | job shows failure, marked `continue-on-error`, required check stays green |

## 5. Test strategy

- **`reverse-captcha.test.ts` (rewritten):** unit-drive the handler — issue returns the documented issue shape; correct-answer-in-time → success; wrong answer → `wrong_answer`; expired (inject/override the clock or TTL) → `expired`; unknown id → `expired`; reused id → `expired`; whitespace/case normalisation accepted; paired-refine rejects half-supplied input. Make the store resettable between tests (export a reset hook or a factory).
- **Generator unit test:** for each template, the computed `answer` is actually derivable from the `puzzle` text (sanity that the puzzle is self-consistent), and answers vary across many generations (not constant).
- **Determinism note:** the *tool source* uses `Math.random`/`Date.now` (allowed). Tests must not depend on real wall-clock for the expiry case — inject the clock/TTL. The "no `Math.random`/`Date.now` in scripts" rule still applies to any `scripts/*.mjs` touched here.
- **Workflows:** YAML lint / `actionlint` if available; otherwise a careful manual read + the plan's checklist. CI itself is the real test — it runs on the Phase 6 PR (R: verify CI on a PR before publishing).
- **Packaging:** `pnpm build` **first (C3 — mandatory; `dist/` is gitignored, a dry-run on a clean tree is meaningless)**, then `pnpm publish --dry-run` asserted by eye (and ideally a tiny test/script that fails if the file list contains anything outside the whitelist). The whitelist checker must treat **`dist/ui/**` as EXPECTED-present** (the built SPA — not an "extra"); it only flags paths outside `dist/**` + the three root docs + `package.json`. `pnpm pack` + local `npx ./<tarball> init` manual smoke.
- **Full suite green:** `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build` (server+ui), concurrency smoke, manual MCP smoke (call `reverse_captcha` twice end-to-end against a running `substrate mcp`).

## 6. Operator tasks (NOT done by the agent)

The phase delivers everything in-repo and dry-run-verified. **Diego performs the live steps:**
1. Create the public GitHub repo and push.
2. Configure the npm `@diegoferreyra` scope + publish access + 2FA (R-P6-1).
3. Add the GitHub `NPM_TOKEN` secret for `publish.yml`.
4. Confirm CI is green on a real PR (macOS + Linux blocking; Windows visible).
5. Run the final fresh-machine quick-start walk-through (macOS + Linux).
6. `pnpm publish --dry-run` review → push the real `v0.1.0` tag → `publish.yml` does the live `--provenance` publish.

The agent's deliverable is "arm everything; Diego pulls the trigger." Note: removing `"private": true` (§3.5) is what *arms* publishing — it lands in this phase's PR but the live publish remains operator-gated.

## 7. Locked decisions (approved)

1. **`reverse_captcha` = one tool, two call shapes (issue with no args / verify with `{ challenge_id, answer }`), backed by a module-level in-memory `Map` with a ~10s TTL and lazy cleanup.** No DB, no file, no timers; state dies with the process. Stays read-shaped; payloads use the `result` discriminant (never `ok`) per B1.
2. **Two puzzle templates — LOCKED at two (N3):** keyed extraction (read one field by id) + ordered transform (reverse/filter a short list) — randomised per challenge, answer computed at issue time and normalised (trim/lowercase/whitespace) on compare. No third template.
3. **CI matrix `[ubuntu, macos, windows]`, `fail-fast: false`, Windows `continue-on-error: true` (visible, non-blocking); macOS additionally runs the Playwright UI smoke.** pnpm pinned via `packageManager` (C1).
4. **Version → `0.1.0`; `BINARY_SCHEMA_VERSION` stays `2`; drop `"private": true`.** `whoami` `PHASE_STRING` → **`'v0.1.0 (public release)'`** (resyncs the drifted lockstep), with a `PHASE_STRING ⊇ BINARY_VERSION` regression-guard assertion (C5/C6).
5. **Operator-only line** (§6): live publish, real tag push, repo creation, npm scope/token/2FA + `NPM_TOKEN` secret (wired via `NODE_AUTH_TOKEN` + `registry-url`, C2), and fresh-machine cross-platform testing are Diego's; the phase ships in-repo + `--dry-run`.
6. **`Math.random`/`Date.now` allowed in the `reverse_captcha` runtime source** (the no-nondeterminism rule binds only `scripts/*.mjs`); TTL/clock are injectable for deterministic expiry tests (N4/N5).
7. **Issue-template required fields** (`Node version`, `Operating system`, `` `substrate diagnose` output ``, `Reproduction steps`) drive `auto-close-incomplete-issues.yml` via **rendered `### ` headings** (not field ids), cross-referenced in both files, with a `needs-info-exempt` opt-out label (C7).

## 8. Definition of Done (for this spec)

Spec is **APPROVED** — all §3.0/§7 decisions are locked and the Architect Reviewer's B1 + C1–C7 + N1–N5 changes are incorporated. Per Diego's standing directive there is no separate per-phase approval pause. Next, per workflow.md Stage 2: Architect drafts the Phase 6 plan → Architect Reviewer → revision → development. This is the last v1 phase before Phase 7 (dogfood).
