# Phase 10 Plan — Public launch (go public + first real npm publish → v0.5.0)

**Status:** Reviewed v1.1 — Architect-Reviewer APPROVE-WITH-CHANGES (all cited loci verified correct; CONCERN-1 CHANGELOG-ownership + CONCERN-2 UI-smoke-rationale + guard-commit-home + manifest-location folded in). Written against the spec's recommended D1–D4 defaults; §"Decision dependencies" maps what changes if Diego chooses otherwise.
**Author:** Architect
**Last updated:** 2026-06-10
**Spec:** [`specs/phase-10-public-launch-spec.md`](specs/phase-10-public-launch-spec.md) (Architect-Reviewer pass incorporated; pending D1–D4)
**Workflow:** [`../workflow.md`](../workflow.md)
**Predecessor:** Phase 7b (`phase-07b-complete`, v0.4.0). Phase 9 merged; Phase 8 unbuilt + independent.
**Feature branch:** `feature/phase-10-public-launch`

---

## 1. Overview

Phase 6 armed publishing; this phase **fires** it. The agent prepares and sequences the two irreversible, **operator-only** go-live triggers — **(B)** flip `42pe/substrate` public, **(A)** push the launch tag → `publish.yml` publishes — and stops at `phase-10-complete` with everything publish-ready + the go-live runbook written. **Diego pulls both triggers** (spec §6).

**No product code, no schema change.** `BINARY_SCHEMA_VERSION` stays `2`. The only edits are: an exposure scrub (working tree), provenance config (2 files + CHANGELOG note), go-live doc phrasing, the version lockstep → `0.5.0`, and a new operator runbook. The agent's gate is acceptance + packaging re-verification + scrub sweeps (spec §5); the only thing it cannot prove in-repo is the workflows running on a real push (operator §6.4).

**5 build steps + 1 consolidated Code Reviewer gate + 1 acceptance/audit/merge step.** Config and docs front-load so the single reviewer pass sees the whole diff (same shape as Phase 6/7b).

## 2. Branching & merge strategy

- Create `feature/phase-10-public-launch` from `main` (HEAD `776a879`).
- Commit per step. ONE Code Reviewer pass (Step 6).
- Fast-forward merge to `main`, **no squash**, tag **`phase-10-complete`**.
- **The release tag `v0.5.0` is NOT pushed by the agent** — it is operator trigger (A). The agent stops at `phase-10-complete`.
- **If D1 = history rewrite** (NOT the default): that is a separate, pre-everything operation on a fresh clone (re-tag + force-push) performed by the operator **before** B — it is out of the feature-branch flow and must not be attempted by the agent. The plan below assumes the default (no rewrite).

## 3. Decision dependencies — all LOCKED to defaults (Diego, 2026-06-10)

All four resolved to the recommended default, so this plan executes **as written** with no re-routing. Table retained for traceability.

| Decision | LOCKED value (this plan executes) | If Diego had chosen otherwise |
|---|---|---|
| **D1** exposure | (b) scrub local paths; keep `.agents/`/`prd.md` public; no history rewrite | (a) skip Step 1 scrub edits (keep manifest); (c) Step 1 becomes "relocate `.agents/` out" (larger, operator-coordinated); (rewrite) adds a pre-B operator step, see §2 |
| **D2** version | `0.5.0` | Step 4 uses the chosen number across the same 4 sources + 1 guard |
| **D3** provenance | ON | OFF → Step 2 still corrects the stale comments, but omits `id-token`/`--provenance`/`provenance:true`. If OFF, the comment **must state a reason** for deferring (we're on pnpm 9, which supports it) or it reads as the same oversight this phase is removing. |
| **D4** order | B → A | Step 5 runbook re-orders; A-before-B documented as not-recommended (spec §3.1) |

These shape steps but don't block planning. Confirm with Diego at the spec gate.

## 4. Implementation order

### Step 1 — Exposure scrub + exposure manifest (D1 default: b) — (Backend/Docs)

Scrub the absolute local filesystem paths from the working tree and record the public-surface decision.

- **Edit the 3 tracked files** (re-located by content; verified hits 2026-06-10):
  - `decisions.md:23` — `/Users/diegoferreyra/WebDevelopment/substrate-spike-libsql/` → a neutral placeholder (`~/dev/substrate-spike-libsql/` or `<local spike dir>`). Keep the sentence's meaning.
  - `.agents/plans/v1-architecture.md:148` — same path, same placeholder.
  - `tests/manual/README.md` (~57, 58, 77, 198, 201) — replace `/Users/diegoferreyra/WebDevelopment/substrate` with a placeholder (`<substrate-repo>` / `~/dev/substrate`) consistent across the file; ensure the example commands still read correctly.
- **Write the exposure manifest** — a standalone `.agents/exposure-manifest.md` (fixed location, so Step 5's pre-flight gate and Step 6/7 have one target) stating what is **intentionally public** per D1: all of `.agents/` (specs/plans/audits/workflow/product-review/initial-design), `prd.md` (incl. kill criteria + competitive framing — a deliberate transparency choice), `decisions.md`, `skills/`, `tests/`, and author identity in `git log`. This is the artifact that makes "we chose to publish this" auditable.
- **Re-confirm `.claude/` is clean:** `git ls-files .claude` is empty (it is; never committed) — no action, but the manifest notes it.

_Reviewer focus (Step 6):_ no `/Users/`,`/home/` left in tracked files; placeholders read sensibly; manifest matches the actual tracked surface; no tarball-affecting file touched (these aren't in `files`).

Commit: `chore(launch): scrub local paths + exposure manifest (Step 1)`.

### Step 2 — Re-enable npm provenance (D3 default: ON) — (DevOps)

The Phase-6 deferral is unblocked (`packageManager: pnpm@9.15.9`; pnpm 9 accepts `--provenance` — reviewer confirmed `pnpm publish --provenance --dry-run` exits 0).

- `package.json` → `publishConfig: { "access": "public", "provenance": true }`.
- `.github/workflows/publish.yml`:
  - `permissions:` → `{ contents: read, id-token: write }`.
  - publish step → `pnpm publish --access public --provenance --no-git-checks` (keep the `NODE_AUTH_TOKEN`/`registry-url` wiring).
  - **Rewrite the header comment** (lines 4–7): it currently says provenance "NOT used in **v0.1.0** — the pinned **pnpm 7** predates that flag" — both halves stale. Replace with: provenance is **enabled** as of this release on pnpm 9. Drop the `v0.1.0` reference.
- `CHANGELOG.md:100–101` — **only delete** the "provenance is deferred (pnpm 7…)" note here. The **replacement** "provenance enabled" statement lives in the Step 4 `0.5.0` entry, **not** in this step (avoids two steps both editing the provenance line). Between Step 2 and Step 4 the CHANGELOG transiently has neither — harmless mid-branch; Step 6 reviews the whole diff.
- **`tag==version` publish guard (recommended; see Step 5/§7-R2):** add a small pre-publish step to `publish.yml` **in this commit** that asserts the pushed tag equals `package.json` `version` and exits non-zero on mismatch — placed **before** `pnpm publish`. Works with the `tags: ['v*']` trigger + `--no-git-checks` (npm otherwise publishes whatever `package.json` says, ignoring the tag). Step 5 documents the decision; the implementation lands here so there is one commit home. If Diego declines the guard, drop this bullet and the runbook's manual "tag must equal version" gate is the control.
- **In-repo verification (limited):** `pnpm publish --provenance --dry-run --no-git-checks` does not error on the flag. The **real attestation is operator-observed** (§6, needs `id-token` on a public-repo Actions run).
- **Lockfile note:** none of these change dependencies → `pnpm-lock.yaml` unchanged; `--frozen-lockfile` still passes.

_Reviewer focus (Step 6):_ `id-token: write` present; `--provenance` on the publish step; `publishConfig.provenance: true`; header comment no longer blames pnpm 7 / names v0.1.0; CHANGELOG deferral note gone.

Commit: `ci(launch): enable npm provenance (pnpm 9) + fix stale publish.yml/CHANGELOG notes (Step 2)`.

### Step 3 — Go-live doc updates (§3.4) — (Technical Writer)

Flip the docs from "armed but private/unpublished" to "installable." **Broad sweep, not a narrow term list:** `git grep -niE 'published to npm|not (yet )?published|isn.t published|on npm|repo is private|once.*public|local clone|won.t resolve|pre-release'` over `README.md AGENTS.md SUPPORT.md CONTRIBUTING.md skills/`.

- **`README.md`:**
  - Remove the **"Pre-release note"** (`:51`).
  - Update the **"repo is private…works once it's public"** paragraph (`:79–80`) → present-tense (clone the public repo or use `npx`).
  - Update **"Once Substrate is on npm, the link step goes away…"** (`:96–98`) → npm is the primary path; keep from-source as the contributor alternative.
- **Known stale hits to fix** (verified): `AGENTS.md:28` ("Once Substrate is **published to npm**…") and `skills/substrate/SKILL.md:36` ("Until Substrate is **published to npm**…"). Update to present-tense install; **keep the from-source/`pnpm link` path documented** for contributors.
- **`SUPPORT.md` / `CONTRIBUTING.md` / `skills/substrate/AUTHORING.md`:** apply the sweep; fix any hit.
- **Sequencing caveat (do NOT mis-handle):** these edits describe a *published, public* state and land in the **merge commit** so the launch **tarball's README** is correct — but the state is only true after B+A. Acceptable because the repo stays private until B and B precedes A in one operator session. The runbook (Step 5) restates: don't merge-then-sit-public-for-days before publishing.

_Reviewer focus (Step 6):_ post-edit sweep returns only intentional contributor mentions; README coherent for **both** install paths; no half-edited "still private" sentence.

Commit: `docs(launch): present-tense install in README/AGENTS/SKILL + support docs (Step 3)`.

### Step 4 — Version bump → launch version (D2 default: 0.5.0) (§3.5) — (Backend)

4 sources + 1 guard (the repo's established lockstep; all loci verified to exist):

1. `src/core/version.ts:22` `BINARY_VERSION` → `'0.5.0'`. `:10` `BINARY_SCHEMA_VERSION` stays `2`.
2. `package.json:3` `version` → `0.5.0`.
3. `src/mcp/tools/read/whoami.ts:39` `PHASE_STRING` → `` `v${BINARY_VERSION} (public launch)` `` (prefix is templated; **only the parenthetical changes** — the guard can't drift).
4. `CHANGELOG.md` → dated `0.5.0` entry: "public launch — first npm publish; provenance enabled; install docs updated; **no product/schema change**." Folds in the Step 2 provenance flip.
- **Guard (not a source):** `whoami.test.ts` has two adjacent assertions at `:76–77` — `:76` `toContain(\`v${BINARY_VERSION}\`)` **stays untouched** (drift guard); `:77` `toMatch(/error log/)` **→ `/public launch/`** (only this line changes). Health endpoint + MCP server name/version already read `BINARY_VERSION` — no edit.

_Reviewer focus (Step 6):_ all 4 sources at `0.5.0`/`v0.5.0 (public launch)`; schema still `2`; the `:76` guard line untouched; `:77` copy assertion updated; whoami hint + registry intact (no tool change).

Commit: `chore(launch): v0.5.0 version lockstep + CHANGELOG entry (Step 4)`.

### Step 5 — Operator go-live runbook (§3.6) — (Technical Writer / Architect)

Create `.agents/runbooks/` + `public-launch-runbook.md`. An **ordered checklist with a gate before each irreversible action**, not prose. Required sections (spec §3.6):

1. **Pre-flight (all ✅ before any trigger):** D1–D4 confirmed; `v0.5.0` merged to `main` + `phase-10-complete` tagged; in-repo acceptance battery green (Step 7); **final human review of the exact tree + `git log` about to go public** vs the exposure manifest; npm scope `@diegoferreyra` owned + 2FA on; **automation** `NPM_TOKEN` minted (NOT an OTP-gated token); `NPM_TOKEN` added as the `42pe/substrate` Actions secret.
2. **Trigger B — go public** (gate: *permanent disclosure of HEAD + all history; re-privatizing does not recall it*): GitHub setting path → **post-B**: `ci.yml` green on a push (Ubuntu+macOS blocking, Windows visible — first real run); public repo matches the manifest; issue templates + auto-close render.
3. **Trigger A — publish** (gate: *npm version is immutable*): review `pnpm publish --dry-run` on the public repo → push the **exact** `v0.5.0` tag (**must equal `package.json` version** — `--no-git-checks` will publish whatever `package.json` says) → watch `publish.yml` → **post-A**: `npx @diegoferreyra/substrate@0.5.0 --help` + `init` on a clean machine; provenance attestation viewable on the npm page.
4. **Rollback / failure modes:** resolve token/scope errors **before** the tag push; an OIDC/provenance `4xx` → use the no-provenance fallback (drop `--provenance`, republish) **only if the version wasn't consumed** (else patch-bump — version is immutable); a successful-but-wrong publish is not reversible (publish a new patch); B cannot be undone.
5. **Optional hardening (decide here):** a `publish.yml` pre-publish guard asserting the pushed tag == `package.json` version. **Recommendation: include it** — it's a few lines and directly defends the §4 "tag ≠ version" failure mode. If included, it's a Step-2 addition to `publish.yml` and the reviewer checks it; if Diego declines, the runbook's manual "tag must equal version" gate is the control.

_Reviewer focus (Step 6):_ runbook orders B→A (or D4 choice); every irreversible step has a gate naming its irreversibility; the automation-token-not-OTP and tag==version points are present; the provenance fallback's trigger condition is explicit.

Commit: `docs(launch): operator go-live runbook (B→A, gated, irreversibility notes) (Step 5)`.

### Step 6 — 🛑 Code Reviewer pass (whole phase)

One Code Reviewer over `git diff main...HEAD`. No product logic, so the lenses skew to **correctness-of-config** and **completeness-of-scrub** over security/perf:

- **Provenance config:** `id-token: write` + `--provenance` + `publishConfig.provenance:true` all present and consistent; stale comments corrected; no dependency/lockfile change.
- **Scrub completeness:** `git grep -nE '/Users/|/home/'` clean; the go-live phrasing sweep clean (only intentional contributor mentions); `git ls-files .claude` empty; the exposure manifest matches the tracked surface.
- **Version lockstep:** 4 sources = `0.5.0`/`v0.5.0 (public launch)`; schema `2`; `whoami.test.ts:76` guard untouched, `:77` updated.
- **Docs coherence:** README valid for both install paths; no sentence still implying private/unpublished.
- **Runbook:** orders B→A, gates each trigger, names irreversibility, automation-token + tag==version + provenance-fallback present.
- **Tag==version guard** (if included in Step 5/2): correct.

Fix BLOCKERs + CONCERNs in a `fix(review)` commit (only if findings).

### Step 7 — Acceptance + audit + merge (Backend → Assistant)

**Acceptance gate (spec §5 — regression-only; nothing in the product changed):**
- `pnpm build` (server + ui).
- `pnpm test` + `pnpm --dir ui test`.
- `tsc` root + ui; `eslint` root + ui; `prettier --check`.
- `pnpm test:smoke:concurrency`; manual MCP smoke (`node tests/manual/run-smoke.mjs`) — expect identical to `phase-07b-complete` save the `v0.5.0` string + the `:77` assertion.
- **Packaging at 0.5.0:** `pnpm build` THEN `pnpm publish --dry-run` (whitelist-exact: `dist/**` incl. `dist/ui/**` + README + LICENSE + CHANGELOG + package.json; no `src`/`tests`/`.agents`/`.substrate`/dotfiles; `CONTRIBUTING`/`SUPPORT` absent) THEN `pnpm pack` + `npx ./<tgz> --help` (prints `Substrate v0.5.0`) + `init`.
- **Provenance flag (D3=ON):** `pnpm publish --provenance --dry-run` does not error.
- **`dist/server` UI-dep-free grep** (no react/marked/dompurify).
- **UI smoke (`pnpm test:smoke:ui`, Playwright) intentionally skipped** — no UI code path changed since `phase-09-complete`, and `dist/ui/**` shipping is already asserted by the dry-run whitelist. (Consistent with `phase-07b-complete`, which also omitted it.) Stated so the omission is a conscious call, not a silent gap, for the phase that cuts the first public tarball.
- **Scrub sweeps clean** (both: `/Users|/home` paths AND go-live phrasing).
- Confirm the 4 version sources + the `PHASE_STRING ⊇ BINARY_VERSION` guard.

Then:
- Spawn Assistant → `.agents/audits/phase-10-audit.md`. Resolve gaps.
- Fast-forward merge to `main`, tag **`phase-10-complete`**.
- **STOP.** Do NOT flip the repo public, do NOT push `v0.5.0`, do NOT publish — those are operator triggers (§6, run via the Step 5 runbook).

Commits: `chore(phase-10): acceptance pass + v0.5.0 (Step 7)`, `docs(phase-10): assistant audit (Step 7)`.

## 5. Operator tasks (NOT done by the agent — spec §6)

Per the Step 5 runbook, in order: confirm D1–D4 → own/verify the `@diegoferreyra` npm scope + 2FA + mint an **automation** token → add `NPM_TOKEN` Actions secret → **(B)** flip repo public + confirm CI green on a push → final review of the public tree/history vs the manifest → **(A)** review dry-run + push `v0.5.0` + watch `publish.yml` + verify `npx` resolves and provenance is viewable → fresh-machine quick-start walk-through (macOS + Linux). Removing `private` (Phase 6) armed publish; this phase arms the rest. **Nothing in the agent's deliverable pulls either trigger.**

## 6. Test mapping (spec §5 → plan)

| Spec requirement | Plan location |
|---|---|
| version drift guard updated; `PHASE_STRING ⊇ v${BINARY_VERSION}` holds | Step 4 + Step 7 |
| full suite green (build/test/tsc/eslint/prettier/concurrency/manual MCP) — regression-identical | Step 7 |
| packaging at 0.5.0: build → dry-run whitelist → pack/npx smoke | Step 7 |
| provenance flag accepted under pnpm 9 (`--provenance --dry-run`) | Step 2 + Step 7 |
| `dist/server` UI-dep-free | Step 7 |
| exposure scrub sweep clean (`/Users|/home`); `.claude` empty; manifest written | Step 1 + Step 7 |
| go-live phrasing sweep clean (README/AGENTS/SKILL/SUPPORT/CONTRIBUTING) | Step 3 + Step 7 |
| CI on a real push (workflows' first run) | **operator §6.4** (not provable in-repo) |
| real provenance attestation observed | **operator §6.6** |

## 7. Risks

- **R1 — irreversibility of both triggers.** The defining risk. Mitigated by: the agent never triggers; the runbook gates each with an irreversibility statement; B→A ordering; a final human review before B (last reversible moment).
- **R2 — tag ≠ `package.json` version** publishes the wrong number (immutably). Mitigated by the runbook's "tag must equal version" gate + the optional `publish.yml` guard (Step 5/2, recommended).
- **R3 — provenance/OIDC failure on the live run.** Mitigated by the no-provenance fallback (drop `--provenance`, republish) **with the explicit trigger condition** (only if the version wasn't consumed) — resolve token/scope first.
- **R4 — `@diegoferreyra` scope unowned / OTP-gated token.** Operator prereq (§6.2–6.3); publish fails fast (403/OTP) if unmet — a *blocked* publish, not a wrong one. The automation-token-not-OTP point is in the runbook.
- **R5 — workflows still never run.** `ci.yml`/`publish.yml`/auto-close have no real execution (Phase 6 R3 carries). First proof is operator §6.4 on the public repo. Carry as the first thing to watch.
- **R6 — README "briefly lies" window.** Mitigated by private-until-B + B-precedes-A-in-one-session + the runbook's "don't sit public-with-unpublished" note.
- **R7 — history retains scrubbed paths (D1 default = no rewrite).** Accepted: low-sensitivity (username already public via the npm scope/author email); rewrite would break all 10 tags + audit-cited SHAs for ~zero gain. If anything is truly sensitive, D1 option (c) move-out is the answer, not a rewrite.

## 8. Definition of Done

- All step commits on `feature/phase-10-public-launch`.
- D1–D4 confirmed by Diego (plan written for defaults; non-default choices re-route per §3).
- Exposure scrub clean (both sweeps) + manifest written; provenance config in place + flag-accepted (D3=ON); go-live docs present-tense + coherent; `v0.5.0` lockstep across 4 sources + guard.
- Single Code Reviewer pass done (Step 6); BLOCKER/CONCERN resolved.
- Acceptance battery green; packaging whitelist-exact at 0.5.0; `dist/server` UI-dep-free.
- Operator go-live runbook shipped (B→A, gated, irreversibility + fallback documented).
- Assistant audit clean → `.agents/audits/phase-10-audit.md`.
- Fast-forward merge to `main`, tag `phase-10-complete`. **The repo-public flip and the `v0.5.0` publish remain operator-gated** — fired by Diego via the runbook.
