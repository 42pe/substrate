# Phase 5a Audit — HTTP JSON Read API

**Date:** 2026-06-05
**Auditor:** Assistant agent (separate from authors and reviewers)
**Branch:** `feature/phase-05a-http-read-api`
**HEAD:** `642704a` — `chore(phase-05a): acceptance pass + 0.0.5 (Step 3)`
**Commits this phase produced:** 2 on top of `main` (tag `phase-04-complete`), plus the spec/plan doc commit.

## Summary table

| Category | Status |
|---|---|
| Stage 1 — Spec | DONE (APPROVED Diego 2026-06-03; §3.0 decisions locked; §7 recommendations all confirmed) |
| Stage 2 — Planning | DONE (Architect Reviewer v1.1, approve-with-changes, no BLOCKERs; C1–C4/N1–N4 incorporated) |
| Stage 3 — Development | DONE — Step 1 committed; lint/format/types/build all clean |
| Stage 4 — QA | DONE — 408 unit+integration green; concurrency + manual smoke run separately this session, passing |
| Stage 5 — Phase-end | DONE with notes (accepted residuals + the persistently-deferred sanitizer, now load-bearing in 5b) |

## Hard gates compliance (workflow.md §"Hard Gates")

| # | Gate | Evidence |
|---|---|---|
| 1 | No plan without an approved spec | `.agents/plans/specs/phase-05a-spec.md` — `Status: APPROVED (Diego, 2026-06-03)`. |
| 2 | No development without an approved plan | `.agents/plans/phase-05a-http-read-api.md` — `Status: Reviewed v1.1 … ready for development`. |
| 3 | No commits without code review | Plan §Step 2 is a single Code Reviewer pass, "fix BLOCKERs + CONCERNs in a `fix(review)` commit **(only if findings)**." No `fix(review)` commit exists on the branch — the review ran with **no actionable findings** (the plan explicitly made the fix commit conditional). See Commit-list note. |
| 4 | No PR without Assistant audit | This document, written by an agent separate from the authors. |

All four hard gates are satisfied. Gate 3 is satisfied by a clean review (no fix commit by design); see the commit-list deviation note for the one caveat.

## Commit list (`main..HEAD`)

```
642704a chore(phase-05a): acceptance pass + 0.0.5 (Step 3)
22e8f2d feat(http): read-only JSON API mirroring MCP reads (Step 1)
91962b3 docs: Phase 5a spec (approved) + plan (reviewed, ready for development)
```

The plan choreographed three implementation phases: Step 1 (`feat(http): …`), Step 2 (`fix(review): …` *only if findings*), Step 3 (`chore(phase-05a): acceptance + 0.0.5`, plus a separate `docs(phase-05a): assistant audit`). In practice: Step 1 landed as `22e8f2d`; the Step 2 Code Reviewer pass produced **no** `fix(review)` commit (the plan made it conditional — a clean review leaves no commit); Step 3's acceptance/version bump landed as `642704a`, and this audit doc lands separately. **Deviation note:** because the review left no commit artifact, there is no in-repo evidence the Code Reviewer gate actually ran — only its absence-of-findings is inferable. For a phase this small (one route file, one query helper, thin wiring) a no-findings review is plausible, but the gate's audit trail is weaker than Phase 4's two-fix-commit trail. Non-blocking; flagged for the record.

## Spec §6 acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Each endpoint in §3.2 returns the documented shape against a seeded substrate | PASS | `api.test.ts` covers all 8: `/api/project` (line 115), `/api/boards` (124), `/api/boards/:id` (131), `/api/tasks` (146), `/api/tasks/:id` (165), `/api/tasks/:id/history` (171), `/api/tasks/:id/comments` (181), `/api/comments/:id` (190). Each asserts the raw shape against a real temp DB + authored board fixture. |
| 2 | `curl -H "Origin: https://evil.com" …/api/boards` → 403 (test-equivalent via `app.request`) | PASS | `api.test.ts:217` "cross-origin request → 403". The allowlist is `app.use('*')` in `server.ts:55`, so it gates `/api` (and every route). |
| 3 | Unknown task/board id → 404 with an error body; a bad query → 400 | PASS | 404: `/api/boards/ghost` (line 139, asserts `error.code === 'not_found'`), `/api/tasks/nope` (167), `/api/comments/ghost` (192). 400: `missing_required_fields` w/o board_id (195, `schema_violation`), `page_size=9999` (202), `page_size=abc` (207), `archived=maybe` (212). |
| 4 | No write verb is routable under `/api` | PASS | `api.test.ts:222` `POST /api/boards` → 404. Source: `grep app.post/put/patch/delete src/http/routes/api/` → **no matches**; `index.ts` registers `app.get` only (8 routes). |
| 5 | `pnpm test`, `tsc` (root+ui), `eslint`, `prettier`, `pnpm build`, concurrency smoke, manual MCP smoke all green | PASS | See Test results. **408 tests, 54 files, 0 failures.** All static gates exit 0; build clean. Concurrency + manual smoke run separately this session, passing (per instruction; not re-executed in this audit). |
| 6 | `BINARY_VERSION` → `0.0.5` (no schema change) | PASS | `src/core/version.ts`: `BINARY_VERSION = '0.0.5'`; `package.json` version `0.0.5`; `BINARY_SCHEMA_VERSION = 2` (unchanged). `npm pack --dry-run` → `diegoferreyra-substrate-0.0.5.tgz`, 85 files, exit 0. |

## Spot-checked correctness claims

- **8 GET endpoints, all reads, mirroring the MCP read tools.** `index.ts:43–122` registers exactly eight `app.get` handlers, each importing and calling the named MCP read handler (`getProjectHandler`, `listBoardsHandler`, `getBoardSubstrateHandler`, `listTasksToolHandler`, `getTaskToolHandler`, `getTaskHistoryHandler`, `listCommentsToolHandler`, `getCommentToolHandler`) — single source of truth, no duplicated query logic. No `app.post/put/patch/delete` anywhere under `/api`. A write verb on a read route is unregistered → Hono returns 404 (confirmed by test).
- **`apiDeps` omits `root`; cast to `ToolDeps` is provably sound.** `ApiDeps = Pick<ToolDeps, 'client' | 'config' | 'loadSubstrate'>` (`index.ts:41`); the handlers are typed on `ToolDeps` and the route adapter casts `deps as unknown as ToolDeps` (`index.ts:44`). `grep 'deps.root\|\.root' src/mcp/tools/read/` → **no matches**: no read handler references `root`, so the omission is structurally safe — the HTTP surface cannot reach the substrate-write root. `serve.ts:90` builds `apiDeps = { client, config, loadSubstrate: () => loadSubstrate(root) }` (no `root`), distinct from `httpConfig.projectRoot = cwd` which locates `dist/ui` (`server.ts:26` documents the deliberate split).
- **Bad query → 400 `schema_violation`, never 500.** Coercion in `query.ts`: `boolParam` rejects anything but `'true'`/`'false'` with `schemaViolation` (line 19); `intParam` rejects non-integers (line 29); `validateInput` runs the candidate through the tool's own Zod shape and throws `schemaViolation` on failure (line 89). The shared `paginationShape` is `.max(200)` which **rejects** (does not clamp) — `page_size=9999` → 400, asserted at `api.test.ts:202`. All thrown `SubstrateError`s propagate to `app.onError(errorHandler)` → `httpStatusFor(code)` maps `schema_violation`→400, `not_found`→404, `internal_error`→500.
- **Malformed cursor → 400.** `decodeCursor` (`pagination.ts:69`) throws `SubstrateError.schemaViolation` on a corrupt token (bad base64url JSON *or* a structurally-wrong tuple). `list-boards.ts:51` and the other paginated handlers call it, so a malformed `?cursor=` surfaces as 400 through the same error path. (Unit-tested at `pagination.test.ts:31,41`; see Coverage gap 1 for the missing HTTP-level assertion.)
- **Origin allowlist gates `/api`; ordering is defensive.** `originAllowlist` is the first `app.use('*')` middleware (`server.ts:55`), before any route — Origin-not-in-list → 403, Host-not-in-list → 403 (`origin-allowlist.ts:35–43`). `/api` is registered before `registerStaticFallback` (`server.ts:67–70`). The static route today is only `/` + `/assets/*` (`static.ts:95,97`) — **not** a `*` catch-all — so there is no live shadowing; the ordering is defensive for 5b's eventual SPA catch-all. `api.test.ts:227` locks it: `/api/project` returns `application/json`, not SPA HTML.
- **No fs path-traversal surface in `/api`.** Every `:id` path param (`board_id`, task `id`, comment `id`) flows into a DB lookup or the in-memory loaded substrate, never into a filesystem path. The only fs-serving route is the static `/assets/*`, which serves from an in-memory map built at registration (`static.ts:92–93,99`) — a crafted `/assets/../…` matches no map key. The Phase-4 path-canonical guard remains on the static/attachments path, not `/api`.
- **Reads return raw shapes, not MCP envelopes.** Every success path is `c.json(result)` directly (`index.ts:46,53,58,84,89,102,115,120`) — the handler's raw return value, no `{ ok, result }` MCP wrapper. Tests assert top-level fields (`body.project_id`, `body.results`, `body.board.id`) with no envelope unwrap. **Minor shape note:** the *error* path reuses the shared `errorEnvelope`, which emits `{ ok: false, error: { code, message, details? } }` (`envelope.ts`) — i.e. it carries an extra `ok: false` the spec §3.4 sketch (`{ error: { … } }`) omitted. Tests read `body.error.code`, so it's functionally correct and consistent with the MCP error object; the `ok` field is an additive superset, not a regression. Noted, non-blocking.
- **Live wiring proven over a bound port.** `tests/integration/serve-lifecycle.test.ts:114` spawns a real `serve`, waits for health, then fetches `GET /api/project` over `127.0.0.1:<port>` and asserts a 200 with a UUID `project_id` — end-to-end through the actual CLI → `createApp` → `apiDeps` path, not just `app.request`.

## Test results

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `pnpm test` (unit + integration) | 54 | **408** passed | 18.36 s | green |
| `pnpm test:smoke:concurrency` (60 s) | — | — | — | run separately this session, passing |
| `pnpm exec tsc --noEmit` (root) | — | — | — | clean (exit 0) |
| `pnpm --dir ui exec tsc --noEmit` | — | — | — | clean (exit 0) |
| `pnpm exec eslint .` | — | — | — | clean (exit 0) |
| `pnpm exec prettier --check .` | — | — | — | clean ("All matched files use Prettier code style!", exit 0) |
| `pnpm build` | — | — | — | clean (UI 192.13 KB JS / 8.33 KB CSS, 90 ms, exit 0) |
| `npm pack --dry-run` | — | — | — | `diegoferreyra-substrate-0.0.5.tgz`, 85 files, 123 KB, exit 0 |
| Manual MCP-client smoke (`run-smoke.mjs`) | — | — | — | run separately this session, passing |

**408 passing** — +18 over Phase 4's 390; 54 test files (+1, the new `api.test.ts`), plus a new live-port case folded into `serve-lifecycle.test.ts`.

## Coverage notes (tested vs. gaps)

**Well covered.** `api.test.ts` exercises all 8 endpoints' happy paths against a real temp DB + authored board fixture, plus the cursor pagination round-trip (`?page_size=1` then `?cursor=`), and the full §4 edge table below. The MCP read handlers are reused verbatim, so the deep query/filter/pagination logic is already covered by the existing read-tool unit tests; `api.test.ts` correctly scopes itself to the HTTP adapter layer (coercion, status mapping, ordering, origin). The live-port integration test proves the `serve` wiring end-to-end.

Spec §4 edge-case table maps cleanly:

| Spec §4 case | Covered by |
|---|---|
| `GET /api/tasks/:id` unknown id → 404 + `not_found` | `api.test.ts:165–169` |
| `GET /api/boards/:id` unknown board → 404 | `api.test.ts:139` (asserts `error.code === 'not_found'`) |
| `missing_required_fields=true` (no board_id) → 400 `schema_violation` | `api.test.ts:195` |
| `page_size=9999` → 400 (rejects, no clamp) | `api.test.ts:202` |
| `page_size=abc` → 400 | `api.test.ts:207` |
| cross-origin `Origin: https://evil.com` → 403 | `api.test.ts:217` |
| `POST /api/boards` → 404 (no write route) | `api.test.ts:222` |
| substrate malformed on disk → 500 `internal_error` | NOT directly tested at the HTTP layer (see gap 2) |
| malformed cursor → 400 `schema_violation` | NOT directly tested at the HTTP layer (see gap 1) — `decodeCursor` unit-tested at `pagination.test.ts:31,41` |

Plus two cases beyond the spec table, both tested: unknown task on `/history` + `/comments` → **empty 200, not 404** (by design, N2; `api.test.ts:171,181`), and a bad boolean (`archived=maybe`) → 400 (`api.test.ts:212`).

**Gaps / thin spots (none blocking):**

1. **No HTTP-level malformed-cursor test.** Spec §4 lists "malformed cursor → 400 `schema_violation` (decodeCursor throws it)". `decodeCursor` is unit-tested (`pagination.test.ts:31,41`) and the propagation path through the error-handler is the same one exercised by every other 400 case, so the behavior is correct by composition — but there is no `app.request('/api/tasks?cursor=!!!bad')` assertion locking the wired-up 400. Low risk; one-line follow-up.
2. **No HTTP-level "substrate malformed on disk → 500" test.** Spec §4's last row (loadSubstrate strict → `internal_error`). `loadSubstrate` strictness is covered in the loader's own tests, and the error-handler's non-`SubstrateError` → 500 branch is exercised elsewhere, but no `/api` test seeds a corrupt board file and asserts 500. Low risk; the 500 path is the generic fallback.
3. **Code Reviewer gate left no commit artifact** (see commit-list note). The plan made the `fix(review)` commit conditional on findings; a clean review is consistent with the phase's small surface, but the in-repo audit trail for Gate 3 is weaker than Phase 4's. Process observation, not a code gap.
4. **Concurrency + manual smoke not re-executed in this audit** — accepted on instruction that both ran green this session. This audit did not independently observe them.

## Scope deviations from spec

1. **`custom_field` filter omitted from the HTTP surface** — intentional, spec §3.2/§7.3 decision 3 (compound query object is awkward over a query-string; the UI's board-detail filters use group/text_search/archived). `index.ts` builds the `list_tasks` filter object without `custom_field`. **Accepted / intentional**; can be added in 5b if the UI needs it.
2. **Per-board task counts on the overview deferred to 5b** — spec §2/§7.5 decision 5. Not in `/api/boards`. **Accepted / intentional.**
3. **Error body carries an extra `ok: false`** vs. the spec §3.4 sketch's bare `{ error: { … } }`. The error path reuses the shared `errorEnvelope`; success paths are raw (no `ok`). Additive superset, tests pass on `error.code`. **Cosmetic; noted.**
4. **Markdown sanitizer (`src/shared/sanitize.ts`) still deferred.** Per spec §3.0 decision 3, 5a returns raw markdown and sanitization is **5b's** browser-side DOMPurify job. This is now the fourth consecutive phase the sanitizer has been deferred (Phase 2/3/4 audits tracked it as a slipping Phase-5 prerequisite). 5a is the read API that ships those raw author-supplied `description` / policy `message` strings to a browser-bound client — so the deferral is now **one hop** from rendering. **Per-spec for 5a; hard prerequisite for 5b — must not slip again.**

## Residual risks / deferrals

1. **R1 — route ordering is load-bearing in 5b, not 5a.** Today the static route is `/` + `/assets/*` (no `*` catch-all), so nothing shadows `/api`. 5b will add a client-side-routing SPA catch-all that makes the `/api`-before-static ordering load-bearing. The ordering is already in place (`server.ts:67–70`) and locked by `api.test.ts:227`. **Accepted; carry the catch-all + the ordering test into 5b's review focus.**
2. **R2 — markdown sanitizer (deviation 4)** becomes load-bearing the moment 5b renders these strings as HTML. **Track as the gating 5b prerequisite.**
3. **R3 — `apiDeps as unknown as ToolDeps` cast.** Sound today because no read handler references `root` (verified by grep). If a future "read" handler ever reaches for `root`, the cast would hand it `undefined` at runtime with no compile-time warning. **Accepted residual; the `Pick` type is the intended guardrail — keep read handlers `root`-free.**
4. **Coverage gaps 1–2** (HTTP-level malformed-cursor + corrupt-substrate-500). Both behaviors are correct by composition and unit-tested at the layer that throws; only the wired-up HTTP assertion is missing. **Accepted; low-risk follow-up.**
5. **Localhost-only, no auth/tokens** — by design (spec §2, §3.3). The API inherits the Phase-1 origin/Host allowlist + 127.0.0.1 bind. **Accepted / intentional for v1.**

## Verdict

**SHIP — go for fast-forward merge to `main` + tag `phase-05a-complete`.**

Phase 5a substantively meets every spec §6 acceptance criterion. All locally-run gates are clean: **408 tests green** (54 files, 0 failures), root + ui `tsc` clean, eslint clean, prettier clean, build clean, `npm pack --dry-run` clean. `BINARY_VERSION` is `0.0.5`, `package.json` is `0.0.5`, and `BINARY_SCHEMA_VERSION` stays `2` (no migration this phase, as specified). The concurrency and manual smoke suites were run separately this session and pass.

Spot-checks confirm the load-bearing claims: exactly **8 `GET` endpoints**, each reusing its MCP read handler (single source of truth) with **no write verb registered anywhere under `/api`** (POST → 404, tested); `apiDeps` is a `Pick` that **omits `root`**, and no read handler references `root` (grep-verified), so the `as ToolDeps` cast is provably sound and the HTTP surface structurally cannot reach the write path; bad queries become a clean **400 `schema_violation`** (over-max `page_size` rejects, not clamps; non-int, bad bool, and — by composition — malformed cursor all 400, never 500); the **origin allowlist** is the first `app.use('*')` so it gates `/api` (cross-origin → 403, tested); `/api` mounts **before** the static fallback (defensive for 5b, locked by a JSON-not-HTML test); there is **no fs path-traversal surface** in `/api` (every `:id` → DB/in-memory); and reads return **raw shapes, not MCP envelopes**. The live-port integration test proves the `serve` → `apiDeps` wiring end-to-end.

The gaps are low-risk: no HTTP-level malformed-cursor or corrupt-substrate-500 assertion (both correct by composition, unit-tested where they throw), and the Code Reviewer gate left no commit artifact because the plan made the `fix(review)` commit conditional and the review found nothing actionable — plausible for a one-file-route phase, but a thinner audit trail than Phase 4. The one deviation to carry forward is the **markdown sanitizer**, now deferred a fourth consecutive phase: per-spec for 5a (raw markdown by design), but a hard prerequisite for 5b's HTML rendering — it can no longer slip. The accepted residuals (route ordering becoming load-bearing in 5b, the `root`-free cast guardrail, localhost-only/no-auth) are all consistent with the spec's locked decisions.

Recommended next actions (Orchestrator):
1. Optionally add two HTTP-level edge tests — malformed `?cursor=` → 400 and a corrupt board file → 500 — to lock spec §4's last two rows at the API layer. Non-blocking.
2. **Carry the markdown sanitizer into 5b as a gating prerequisite** — it renders raw author strings as HTML; the deferral ends there.
3. **Carry the `/api`-before-SPA-catch-all ordering into 5b's review focus** — it becomes load-bearing when the catch-all lands.
4. Flip plan status to `Complete`.
5. Fast-forward merge to `main`, tag `phase-05a-complete`.
