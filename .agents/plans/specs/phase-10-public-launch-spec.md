# Phase 10 Spec — Public launch (go public + first real npm publish)

**Status:** APPROVED — Architect-Reviewer pass incorporated (APPROVE-WITH-CHANGES: doc-scrub CONCERN + 4 precision SUGGESTIONs folded in); **D1–D4 all LOCKED to the recommended defaults by Diego 2026-06-10** (D1 = scrub local paths, keep `.agents/`/`prd.md` public, no history rewrite; D2 = 0.5.0; D3 = provenance ON; D4 = B→A). NOT a plan; the live go-live steps are operator-only (§6).
**Standing directive:** Diego proceeds without per-phase approval pauses for *engineering* — but the two irreversible go-live triggers in this phase (§6) are explicitly NOT covered by that directive: they require deliberate, per-trigger operator action and the open decisions in §7 to be settled first.
**Author:** Spec Team (Orchestrator synthesis)
**Last updated:** 2026-06-10
**Architecture plan:** [`../v1-architecture.md`](../v1-architecture.md) §5 (Phase 6 armed packaging; this phase fires it)
**Predecessor:** Phase 7b (`phase-07b-complete`, **v0.4.0**, error logging) — the latest *chronological* acceptance on `main`. Phase 9 (kanban inspector, `phase-09-complete`) and Phase 7b are both merged; Phase 8 (shareable templates) is specced + planned but **unbuilt** (no `phase-08-audit.md`). This phase takes the next free integer, **10**, and is independent of Phase 8.
**Phase-numbering note:** phases ship out of numeric order here (7b accepted after 9). "Phase 10" is a label, not a claim that 8 shipped. Diego may renumber to a release designation; the number is not load-bearing.

---

## 1. Goal

Phase 6 **armed** publishing (dropped `private`, added `publishConfig`/`files`/`bin`, wrote `ci.yml`/`publish.yml`/issue-hygiene, dry-run-verified). Everything since has shipped in-repo, **private and unpublished**. Today `npx @diegoferreyra/substrate` does **not** resolve and the source is not public.

This phase makes Substrate **actually installable** by preparing and sequencing the **two irreversible, operator-only go-live triggers**:

- **(A) Publish to npm** — push a `vX.Y.Z` tag → `publish.yml` runs `pnpm publish`. This is what makes `npx` resolve. Technically possible while the repo is still private.
- **(B) Flip the GitHub repo `42pe/substrate` from private → public** — exposes the entire repo + git history.

Neither is cleanly reversible (§3.0-1). The agent's deliverable mirrors Phase 6's contract — **"arm everything; Diego pulls the triggers"** — but this is the trigger-pull phase, so the agent's job is: (1) resolve the **exposure decision** (what going public reveals) and execute the agreed scrub; (2) re-enable **npm provenance** (the Phase-6 deferral, now unblocked — see §3.3); (3) update the **README/docs** that currently say "not published / repo private"; (4) **bump the version** for the launch artifact; (5) **re-verify** the publish pipeline end-to-end in-repo; (6) write the **operator go-live runbook** that orders the two triggers and gates each one. The agent stops with everything publish-ready and the runbook written; **Diego performs A and B** (§6).

**No code change to the product. No schema change.** `BINARY_SCHEMA_VERSION` stays `2`; no migration. The only source edits are docs, `package.json`/`version.ts`/`whoami` version lockstep, the two workflow/config provenance lines, and the exposure scrub. This is a **release/go-live phase**, not a feature phase.

## 2. Scope

**In scope (agent — in-repo + verified, lands in this phase's PR):**
- **Exposure scrub** of the working tree per the D1 decision (§3.2): at minimum remove the absolute local filesystem paths from the three tracked files that carry them; a full secret/path sweep across the tree; a written record of what remains intentionally public.
- **Re-enable npm provenance** (§3.3): `publish.yml` gains `permissions: id-token: write` + `--provenance`; `package.json` `publishConfig.provenance: true`; the stale "pinned pnpm 7" comment in `publish.yml` and the provenance-deferral note in `CHANGELOG.md` are corrected. (Recommended; D3 is the on/off call.)
- **Go-live doc updates** (§3.4): README's "Pre-release note", the "repo is private" language, and the "once Substrate is on npm…" lines updated to present-tense install; `SUPPORT.md`/`CONTRIBUTING.md`/`AGENTS.md` reviewed for now-stale private/unpublished phrasing. README + CHANGELOG ship in the tarball → they motivate the version bump.
- **Version bump** to the launch version (§3.5; D2) across the established 4 sources + 1 drift-guard, plus the CHANGELOG entry.
- **Pre-flight re-verification at the launch version** (§5): `pnpm build` → `pnpm publish --dry-run` whitelist-exact → `pnpm pack` + `npx ./<tgz> --help`/`init` smoke → `dist/server` UI-dep-free grep → full test suite green.
- **Operator go-live runbook** (§3.6, §6): a new doc with the exact ordered operator steps, the prerequisites gating **each** trigger, the verification between steps, and the irreversibility/rollback notes. **This is the heart of the deliverable.**

**Out of scope (operator-only — the irreversible triggers + account state; §6):**
- **(B)** flipping the repo public; **(A)** pushing the release tag → the live `pnpm publish`.
- npm: claiming/owning the `@diegoferreyra` scope, publish access, 2FA, the **automation** `NPM_TOKEN`, and adding it as the GitHub Actions secret.
- Confirming CI green on a real push and observing real provenance generation (both need the public repo + a live Actions run).
- Any post-launch announcement/marketing/website work.

**Out of scope (not this phase):**
- Building **Phase 8** (shareable templates) or any product feature/bugfix — this phase touches no product code paths.
- Auto-deriving `BINARY_VERSION` from `package.json` (still manual lockstep; a v1.x item).
- A `tag == package.json version` guard in `publish.yml` — noted as optional hardening in §3.6, decided in the plan, not a blocker.
- History rewriting **unless** D1 selects it (default recommendation: **no** history rewrite — §3.2).

## 3. Design

### 3.0 Locked facts (verified 2026-06-10) and framing decisions

1. **Both triggers are irreversible — the core constraint this phase exists to manage.**
   - **(A) npm publish is immutable.** A published version number can never be reused, and unpublish is heavily restricted (npm blocks unpublish after 72h, and for any version others may depend on). A mistaken publish is permanent; the only remedy is publishing a *new* version.
   - **(B) public→private does not recall exposure.** Once public, the repo + full history can be cloned, forked, cached (search engines, GHArchive, archive.org), and scraped by training crawlers within minutes. Re-privatizing later does **not** retract any of that. Treat the first public push as **permanent disclosure of current HEAD *and all history*.**
2. **The repo is already armed for publish.** `private` is gone; `publishConfig.access: public`, `files: ["dist","README.md","LICENSE","CHANGELOG.md"]`, `bin`, and the three workflows all exist (Phase 6). This phase does **not** re-design packaging — it fires it. (Re-confirm at go-live, not assume.)
3. **The toolchain moved to pnpm 9.** `package.json` `packageManager` is now **`pnpm@9.15.9`** (not the `7.18.2` Phase 6 pinned). pnpm 9 supports `--provenance`. **The Phase-6 reason for deferring provenance no longer holds** — `publish.yml`'s "pinned pnpm 7 predates that flag" comment and `CHANGELOG.md`'s deferral note are **stale** and must be corrected whichever way D3 lands.
4. **The scrub does not change the published tarball.** `.agents/`, `decisions.md`, `prd.md`, `tests/manual/`, and `v1-architecture.md` are **not** in the `files` whitelist (verified: tarball = `dist/**` + README + LICENSE + CHANGELOG + package.json). So the exposure scrub is about **what the public GitHub repo reveals**, *not* about npm. Only README/CHANGELOG/version/provenance edits affect the npm artifact.
5. **`.claude/` is NOT in the repo and never was.** `git ls-files .claude` is empty and history has no `.claude/**` or `.env*` commit. The brief's assumption that going public ships `.claude/` settings is **incorrect** — there is nothing to scrub there. (`.gitignore` already covers `.claude/local/`+`.claude/cache/`; the local untracked `settings.local.json` is not tracked and won't ship — but the scrub sweep §3.2 re-confirms nothing under `.claude/` is staged.)
6. **No real secrets found in the tree or history.** A sweep for key/token/secret/password/private-key patterns across tracked files returns only test fixtures (e.g. `"DB password is hunter2"`) and legitimate `secrets.NPM_TOKEN`/`NODE_AUTH_TOKEN` workflow references. The privacy keystone from Phase 7b holds: **Substrate stores no secrets.**

### 3.1 The two triggers — dependency analysis and recommended order

The triggers are **technically independent** (A can run from a private repo; B does not require A). But three couplings make the order matter, and all point the same way:

- **Provenance wants a public repo.** With provenance on (§3.3), `publish.yml` records the source repo + commit + workflow. Consumers verifying provenance follow a link to the source; if the repo is private at publish time, that link 404s for everyone but Diego. Publishing **after** going public yields a fully verifiable, viewable attestation.
- **Package metadata wants a public repo.** `package.json` `homepage`/`repository` point to `github.com/42pe/substrate`, and the shipped README links there. Publish-before-public ships a package whose "view source"/repository links are dead until B fires.
- **CI proof wants a public repo.** The three workflows have **never run** (Phase 6 residual R3). A real push to the public repo is the first time `ci.yml`/`publish.yml` actually execute. Confirming CI green on the public repo **before** the immutable publish de-risks A.

**Recommended order: B → A**, gated behind the in-repo work:

```
[in-repo, this phase]  exposure decision (D1) settled + scrub done + final human review of the
                       exact diff/tree about to become public  →  launch version merged to main
        │
        ▼
(B) flip repo public  →  verify ci.yml runs green on a push (operator §6.4); eyeball the public
                         repo (history, .agents/, prd.md) matches the D1 decision
        │
        ▼
(A) review `pnpm publish --dry-run` on the now-public repo  →  push the launch `vX.Y.Z` tag
                         →  publish.yml publishes with provenance  →  verify `npx @diegoferreyra/substrate`
                         resolves + the provenance attestation is viewable
```

There is **no benefit to A-before-B** (you cannot "test publish" privately and redo — a private dry run is already `pnpm publish --dry-run`), and A-before-B produces a package pointing at a dead repo with a private provenance link. **B is the more catastrophic-if-wrong trigger** (permanent disclosure of all history) so it is gated hardest — but it must still precede A for a clean artifact. (D4 lets Diego override the order; the recommendation is B→A.)

### 3.2 Exposure decision and scrub (the HEADLINE decision — D1)

Going public ships the **entire working tree and full git history**, including the whole `.agents/` planning corpus (every spec/plan/audit, `workflow.md`, the initial design doc, `v1-architecture.md`, this product-review file), `prd.md` (with its §9 pre-committed **kill criteria**, §4 success metrics, the §8 "riskiest assumption", the "worse Linear with extra JSON" competitive framing, and the v2 "Shelve" outcome), and `decisions.md`. Concretely, the sweep found:

- **Absolute local filesystem paths in three tracked files** (the one genuine "internal note" smell):
  - [`decisions.md:23`](../../decisions.md) and [`.agents/plans/v1-architecture.md:148`](../v1-architecture.md) — `/Users/diegoferreyra/WebDevelopment/substrate-spike-libsql/` (the libsql spike dir).
  - [`tests/manual/README.md`](../../tests/manual/README.md) (lines ~57, 58, 77, 198, 201) — several `/Users/diegoferreyra/WebDevelopment/substrate` paths in example commands.
- **No secrets, tokens, credentials, private hostnames, or customer data** anywhere in tree or history (§3.0-6).
- **Author identity in history** — `git log` exposes commit author name/email (`Diego Ferreyra <diego@404.pe>`) and the `Co-Authored-By` Claude trailers. Normal for OSS; **accepted**, listed so it is a conscious call, not a surprise.

**Sensitivity read:** the local paths reveal only a macOS username (`diegoferreyra`) and a dev-dir layout — and the username is *already* disclosed by the npm scope `@diegoferreyra`, the `homepage`, and the author email in every commit. So their residual value to a reader is ~nil. The `.agents/`/`prd.md` content is candid but **not embarrassing or risky**; the 2026-06-09 product review explicitly calls the PRD's honesty (pre-committed kill criteria, self-adversarial critique) a **credibility asset** ("keep that discipline"). For an experimental, solo OSS tool, radical transparency is defensible and arguably on-brand.

**Options (D1 — Diego's final call; spec recommends b + keep-`.agents` + no-history-rewrite):**

| Option | What it does | Trade-off |
|---|---|---|
| **(a) Publish everything as-is** | Flip public with no scrub. | Maximum transparency; ships the `/Users/diegoferreyra/...` paths (cosmetic leak). Zero effort, but the paths read as "didn't proofread." |
| **(b) Scrub local paths, keep `.agents/`+`prd.md` public** ✅ *recommended* | Replace the absolute paths with a neutral placeholder (`~/dev/substrate-spike-libsql`, `<repo-root>`); keep all planning docs public. | Removes the only smell; preserves the transparency asset. Working-tree only — the strings remain in **history** (see history note). |
| **(c) Move `.agents/` (± `prd.md`/`decisions.md`) out of the public repo** | Relocate planning docs to a separate private repo / orphan branch / submodule **before** the first public push. | Cleanest separation of "product" vs "internal process"; loses the transparency asset and the self-installing `AGENTS.md`/`skills` story partly assumes these docs are co-located. Heaviest option. |
| **(d) Mix** | e.g. (b) + selectively trim specific paragraphs (kill criteria, competitive framing) from `prd.md` while keeping the rest. | Fine-grained, but "partial honesty" is a worse look than either full transparency or a clean private split; high fiddle. |

**History rewriting — explicitly scoped:** scrubbing the **working tree does not remove anything from history.** Anyone who goes public can `git log -p` the old blobs. So D1 has a sub-question: rewrite history (e.g. `git filter-repo`) to purge the strings, or accept them in history?
- **Recommendation: do NOT rewrite history.** The only candidates are the low-sensitivity local paths (a username already public via the npm scope). Rewriting history **invalidates every commit SHA**, **breaks all ten `phase-NN-complete` tags** (and the SHAs cited throughout the audit docs), and breaks any existing clone — a large, error-prone cost for ~zero security gain. If Diego deems *any* content history-sensitive, the clean answer is **option (c)** (move it out *before* the first public push so it was never public), not a rewrite.
- **History rewrite is therefore OUT OF SCOPE by default**; it enters scope only if D1 explicitly selects it, in which case the plan must treat it as its own high-risk step (fresh clone, re-tag, force-push, verify) performed **before** B.

**Recommended D1 answer:** **(b) + keep `.agents/`/`prd.md` public + no history rewrite.** Scrub the three files' absolute paths in the working tree; everything else ships as-is, transparency intact. Surface to Diego as his call.

### 3.3 Re-enable npm provenance (D3 — recommended ON)

Phase 6 deferred provenance solely because pnpm 7.18.2 lacked `--provenance` and a pnpm-9 bump would have forced a lockfile migration pre-release. **Both conditions are now resolved** — the repo is already on `pnpm@9.15.9` (§3.0-3). Re-enabling provenance for the *first public publish* is the right moment (supply-chain trust is most valuable at first publish, and it's the Phase-6 acceptance's named "carry into v1.x" item).

Changes (all in-repo; the real attestation is generated by the operator's tag-push run):
- `package.json`: `publishConfig` → `{ "access": "public", "provenance": true }`.
- `.github/workflows/publish.yml`: `permissions:` → `{ contents: read, id-token: write }`; the publish step → `pnpm publish --access public --provenance --no-git-checks`; **rewrite the stale header comment** — it currently reads "NOT used in **v0.1.0** — the pinned **pnpm 7** predates that flag" (lines 4–7), BOTH halves stale (v0.5.0 now, pnpm 9 now). Replace with a note that provenance is **on** as of this release on pnpm 9; drop the `v0.1.0` reference so it doesn't re-stale.
- `CHANGELOG.md`: remove/replace the "provenance is deferred (pnpm 7…)" note; the launch entry states provenance is enabled.
- **In-repo verification is limited** (R: provenance only truly exercises in Actions with `id-token` on a push): confirm the pinned pnpm 9 accepts `--provenance` (`pnpm publish --provenance --dry-run` does not error on the flag) and the config is well-formed. **Observing a real provenance attestation is operator step §6.6.**
- **Fallback (keeps the trigger safe):** if `--provenance` misbehaves during the operator's go-live run, the operator can publish **without** it (drop the flag) and re-add later — provenance is additive, not a publish blocker. The runbook (§3.6) documents this fallback so a provenance hiccup never strands the release.

**D3 is the on/off call.** Recommended **ON**. If OFF, the stale comments are still corrected (to "deferred, still on pnpm 9" — no longer blaming pnpm 7).

### 3.4 Go-live doc updates

These edits flip the docs from "armed but private/unpublished" to "installable." README + CHANGELOG **ship in the tarball**, so they (with the version bump) are why the published artifact legitimately differs from the existing `0.4.0`.

- **`README.md`** (edit points re-located by content, not line number):
  - **Remove the "Pre-release note"** ("Substrate isn't published to npm yet, so `npx …` won't resolve…") — at go-live it resolves.
  - **Update the "repo is private" paragraph** ("The repo is private, so use the local clone path… works once it's public") → present-tense: clone the public repo or use `npx`.
  - **Update "Once Substrate is on npm, the link step goes away…"** → the npm path is now the primary path; keep the from-source path as the contributor alternative.
  - Ensure the resulting README is coherent for **both** install paths (npm and from-source) post-launch — no half-edited sentence implying it's still private.
  - **Sequencing caveat (important):** these README edits describe a *published, public* state. They land in the **merge commit** (so the launch tarball is correct) but the **state they describe is only true after B+A fire.** The window between merge and go-live has a README that "lies" briefly. Acceptable because (i) the repo is private in that window so no one sees it, and (ii) B precedes A by a short operator session. The runbook notes this; do **not** merge-and-sit-public for days with a "resolves now" README before publishing.
- **`SUPPORT.md` / `CONTRIBUTING.md` / `AGENTS.md` / `skills/substrate/{SKILL,AUTHORING}.md`:** these carry go-live-stale phrasing that ships in the public repo. **Use a broad sweep, not a narrow term list** (the obvious terms miss "published to npm"): `git grep -niE 'published to npm|not (yet )?published|isn.t published|on npm|repo is private|once.*public|local clone|won.t resolve|pre-release'`. **Known hits to fix (verified 2026-06-10), not "quick scan":**
  - `AGENTS.md:28` — "(Once Substrate is **published to npm** this step disappears…)".
  - `skills/substrate/SKILL.md:36` — "Until Substrate is **published to npm** it is…".
  Update each to present-tense install while **keeping the from-source path documented for contributors**. Re-run the sweep after editing (§5) to confirm only intentional contributor-path mentions remain.

### 3.5 Version bump (D2)

Current built + **unpublished** binary is **0.4.0** (`phase-07b-complete`). npm has nothing, so the first publish defines npm's starting version. Because README/CHANGELOG/provenance changes alter the tarball, publishing the *existing* `0.4.0` blob is no longer what we'd ship — a bump is warranted.

| Option | Pros | Cons |
|---|---|---|
| **0.5.0** ✅ *recommended* | Clean minor; matches the repo's "next available minor above shipped" convention (Phase 9 used it); CHANGELOG `0.5.0 — public launch (npm + provenance)`. | None material. |
| 0.4.1 | Minimal bump. | Implies a patch to "error logging"; the launch is more than a patch (provenance + public). |
| 1.0.0 | Strong "launch" signal. | **Oversells maturity** — the PRD explicitly frames v1 as a *paradigm test* with kill criteria pending, self-attested gates, and a read-only UI. `1.0.0` would imply API/stability commitments Diego hasn't made. **Recommend against.** |

**Recommended D2 answer: 0.5.0.** Bump via the established **4 sources + 1 guard** lockstep:
- `src/core/version.ts` `BINARY_VERSION` → `'0.5.0'`; `BINARY_SCHEMA_VERSION` stays `2`.
- `package.json` `version` → `0.5.0`.
- `src/mcp/tools/read/whoami.ts` `PHASE_STRING` → `` `v${BINARY_VERSION} (public launch)` `` (the `v${BINARY_VERSION}` prefix is templated — the only edit is the parenthetical, so the drift guard can't break).
- `CHANGELOG.md` → a dated `0.5.0` entry (public launch; provenance enabled; the README go-live edits; note nothing in the *product* changed).
- **Guard (not a source):** `whoami.test.ts` has **two** adjacent assertions (verified at `:76–77`): `:76` `expect(result.phase).toContain(\`v${BINARY_VERSION}\`)` — the drift guard, **leave untouched**; `:77` `toMatch(/error log/)` — the copy assertion, **change to** `/public launch/`. Only `:77` changes.

**Forward note:** unbuilt Phase 8 assigns its version at *its* acceptance ("next available minor above shipped"), so once this ships `0.5.0`, Phase 8 takes `0.6.0` — no collision (same rule Phase 9 used). No Phase 8 doc edit here.

### 3.6 Operator go-live runbook (the heart of the deliverable)

A new doc — `.agents/runbooks/public-launch-runbook.md` (create `.agents/runbooks/`) — that the operator follows to fire B then A. It is **not** prose; it is an ordered checklist with a gate before each irreversible action. Required sections:

1. **Pre-flight (all must be ✅ before *any* trigger):** D1–D4 settled; the launch version merged to `main` + tagged `phase-10-complete`; the in-repo acceptance battery green (§5); a **final human review of the exact tree + `git log` about to go public** against the D1 decision; npm account ready (scope owned, 2FA, automation `NPM_TOKEN` minted); `NPM_TOKEN` added as the GitHub Actions secret.
2. **Trigger B — go public** (irreversible; the gate spells out *permanent disclosure of all history*): the GitHub setting path, then **post-B verification** — `ci.yml` runs green on a push (Ubuntu + macOS blocking, Windows visible); the public repo shows what D1 intended (history, `.agents/`, `prd.md`); the auto-close issue workflow and templates render.
3. **Trigger A — publish** (irreversible; gate spells out *version immutability*): review `pnpm publish --dry-run` on the public repo; push the **exact** launch tag `vX.Y.Z` (must equal `package.json` version — a mismatch publishes the wrong number); watch `publish.yml`; **post-A verification** — `npx @diegoferreyra/substrate@<version> --help` resolves on a clean machine, `init` works, and the provenance attestation is viewable on npm.
4. **Rollback / failure modes:** what to do if `publish.yml` fails mid-run. **Resolve token/scope errors BEFORE the tag push, not after** — npm provenance via Actions OIDC also requires the automation token's account to have publish rights on the `@diegoferreyra` scope; an OIDC/provenance `4xx` means provenance generation failed. **The fallback's trigger condition (explicit):** *if* you hit a provenance/OIDC error on the publish run, drop `--provenance` and republish — **but only if that version number was not already consumed** (a failed-after-consume run forces a patch bump, since the version is now immutable). So fix token/scope first; the no-provenance fallback (§3.3) is the safety valve, not the first move. Also: a *successful but wrong* publish is **not** rollback-able (publish a new patch); B cannot be undone (only re-privatized, which doesn't recall exposure).
5. **Optional hardening (note, decide in plan):** a `publish.yml` guard asserting the pushed tag matches `package.json` `version` before publishing, so a stray tag can't ship the wrong version.

The runbook ships in `.agents/` (public if D1 keeps `.agents/` public — that's fine; it documents process, exposes nothing sensitive).

## 4. Edge cases / failure scenarios

| Case | Expected / handling |
|---|---|
| Operator publishes (A) while repo still private | Works, but provenance source-link + `repository`/`homepage` 404 for consumers. Runbook recommends B→A to avoid this. |
| `@diegoferreyra` npm scope not owned by Diego's account | `pnpm publish` fails (403). Operator prereq §6.2 — claim/verify scope **before** go-live. |
| npm account has 2FA on publish but `NPM_TOKEN` is a *read/publish* token requiring OTP | CI publish fails. The token MUST be an **automation** token (bypasses interactive OTP). Runbook §1 + §6.3 call this out. |
| Pushed tag `vX.Y.Z` ≠ `package.json` version | `publish.yml` (`--no-git-checks`) publishes whatever `package.json` says, under the tag's commit — risk of a version-label mismatch. Mitigation: runbook's "tag must equal version" gate; optional workflow guard (§3.6-5). |
| `--provenance` errors during the live run | Fallback: drop `--provenance`, publish, re-add later (§3.3). Documented in runbook §4 so it never strands the release. |
| Re-running publish after a partial failure | A version that already published cannot be re-published; bump to the next patch and retry. Runbook §4. |
| README says "resolves now" but A hasn't fired yet | Brief, private-window-only inconsistency (§3.4). Don't sit public-with-unpublished for long. |
| History rewrite selected (D1=rewrite) | Breaks all `phase-NN-complete` tags + commit SHAs in audits; must re-tag and force-push on a fresh clone **before** B. High-risk; plan treats as its own step. (Default: not selected.) |
| Going public exposes author email in `git log` | Accepted, normal for OSS; listed in §3.2 so it's a conscious call. |
| `.claude/settings.local.json` accidentally staged | The scrub sweep (§5) re-confirms nothing under `.claude/` is tracked before B. (Currently untracked; never committed.) |
| Scrub of `.agents`/`decisions.md` expected to change the npm tarball | It does **not** (§3.0-4) — those files aren't in `files`. Only README/CHANGELOG/version/provenance change the artifact. Stated so no one re-runs the dry-run expecting a diff there. |

## 5. Verification / test strategy (in-repo — the agent's gate)

This phase ships ~no product logic, so verification is **acceptance + packaging + scrub re-verification**, not new unit tests (beyond the version drift-guard copy update).

- **Version drift guard:** `whoami.test.ts` updated; `PHASE_STRING ⊇ v${BINARY_VERSION}` holds at the launch version.
- **Full suite green (regression — nothing should change):** `pnpm test` (server unit + integration), `pnpm --dir ui test`, `tsc` root + ui, `eslint` root + ui, `prettier --check`, `pnpm build` (server + ui), `pnpm test:smoke:concurrency`, the manual MCP smoke (`tests/manual/run-smoke.mjs`). Expect identical results to `phase-07b-complete`/`phase-09-complete` save the version string + drift-guard assertion.
- **Packaging at the launch version (mirrors Phase 6 §5 / 7b):** `pnpm build` **first** (dist is gitignored) → `pnpm publish --dry-run` is **whitelist-exact** (`dist/**` incl. `dist/ui/**` + README + LICENSE + CHANGELOG + package.json; **no** `src/`/`tests/`/`.agents/`/`.substrate/`/dotfiles; `CONTRIBUTING`/`SUPPORT` absent) → `pnpm pack` + `npx ./<tgz> --help` (prints `Substrate v0.5.0`) + `npx ./<tgz> init` in a temp dir.
- **Provenance flag accepted (D3=ON):** `pnpm publish --provenance --dry-run` does not error on the flag under pnpm 9 (the real attestation is operator-observed, §6.6).
- **`dist/server` UI-dep-free grep** (C7 carryover): no `react`/`marked`/`dompurify` imports in `dist/server/`.
- **Exposure scrub re-verification:** after the scrub, `git grep -nE '/Users/|/home/'` over tracked files returns **nothing** (or only intentional placeholders); the secret-pattern sweep is clean; `git ls-files .claude` is empty. A short written "exposure manifest" lists what is intentionally public (`.agents/`, `prd.md`, `decisions.md`, author identity in history) per the D1 decision.
- **Go-live phrasing scrub re-verification:** after the §3.4 doc edits, `git grep -niE 'published to npm|not (yet )?published|repo is private|pre-release|won.t resolve'` over `README.md AGENTS.md SUPPORT.md CONTRIBUTING.md skills/` returns **nothing** (or only intentional contributor/from-source mentions). This closes the loop on the doc-scrub completeness CONCERN.
- **CI on a real push is explicitly operator §6.4** — the three workflows still have never run; this remains the one thing the agent cannot prove in-repo.

## 6. Operator tasks (NOT done by the agent — the irreversible triggers)

The agent ships everything in-repo + verified and stops at merge + tag `phase-10-complete`. **Diego performs all of the following**, in this order, following the §3.6 runbook:

1. **(prereq) Settle D1–D4** (§7) — the spec recommends defaults; Diego confirms.
2. **(prereq) npm account:** own/verify the `@diegoferreyra` scope; enable 2FA; mint an **automation** access token.
3. **(prereq) GitHub:** add the automation token as the `NPM_TOKEN` Actions secret on `42pe/substrate`.
4. **(B) Flip the repo public** → confirm `ci.yml` runs green on a push (macOS + Linux blocking, Windows visible — their **first real execution**); eyeball the public repo against D1.
5. **(between) Final review** that the public tree + history match the D1 decision (this is the last reversible moment before A).
6. **(A) Publish:** review `pnpm publish --dry-run` → push the exact `vX.Y.Z` launch tag → `publish.yml` publishes with provenance → verify `npx @diegoferreyra/substrate` resolves on a clean machine and the provenance attestation is viewable.
7. **(post) Fresh-machine walk-through** of the README quick-start (macOS + Linux), as in Phase 6 §6.

Removing `private` (Phase 6) already armed publish; this phase arms the *rest* (provenance, docs, runbook). **Nothing in the agent's deliverable pulls either trigger.**

## 7. Decisions (LOCKED by Diego 2026-06-10 — all four to the recommended default)

> **D1 = (b)** scrub local paths, keep `.agents/`/`prd.md`/`decisions.md` public, **no history rewrite**. **D2 = 0.5.0.** **D3 = provenance ON.** **D4 = B→A.** The plan is written against exactly these; no re-routing needed.

- **D1 — Exposure / scrub (HEADLINE).** ✅ **(b)** scrub the absolute local paths in the working tree, **keep `.agents/`/`prd.md`/`decisions.md` public** (transparency is a documented asset), **no history rewrite** (local paths are low-sensitivity; a rewrite breaks all tags/SHAs for ~zero gain — use option (c) move-out instead if anything is deemed truly sensitive). §3.2.
- **D2 — Launch version.** Recommended: **0.5.0** (clean minor; not `1.0.0`, which oversells maturity the PRD disclaims). §3.5.
- **D3 — Provenance now?** Recommended: **ON** (toolchain is on pnpm 9; first-publish is the right moment; safe fallback documented). §3.3.
- **D4 — Trigger order.** Recommended: **B → A** (public first, then publish — for verifiable provenance, live repository links, and CI-proof-before-immutable-publish). §3.1.

## 8. Definition of Done (for this spec)

Spec defines a **release/go-live phase** that: (1) resolves the exposure decision and scrubs the working tree per D1 (default: scrub local paths, keep `.agents/` public, no history rewrite); (2) re-enables npm provenance now that the toolchain is pnpm 9, correcting the stale pnpm-7 deferral notes (D3); (3) updates the README/SUPPORT/AGENTS go-live language; (4) bumps to the launch version via the 4-source + 1-guard lockstep (D2, default 0.5.0); (5) re-verifies the publish pipeline in-repo (build → dry-run whitelist → pack/npx smoke → suite green → scrub sweep clean); and (6) ships the operator go-live runbook that orders the two irreversible triggers **B → A** (D4), gates each, and documents irreversibility + the provenance fallback. The two triggers themselves — flipping the repo public and pushing the release tag to publish — plus npm scope/2FA/token/secret setup and the first-ever real CI run, are **operator-only** (§6). **Next, per workflow.md Stage 2:** Architect-Reviewer pass on this spec → incorporate → Architect drafts the Phase 10 plan → Architect-Reviewer on the plan → development. The four §7 decisions should be confirmed by Diego at or before the spec gate, since they shape the plan.
