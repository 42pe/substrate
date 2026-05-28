# Substrate — Development Workflow

This document defines how we build Substrate. It is the single reference for roles, stages, gates, and process. The Orchestrator and any spawned agents follow this document.

**Stack:** TypeScript / Node ≥ 20 LTS / Hono / `@libsql/client` (native binding; WASM rejected by Phase 0 spike) / React 18 + Tailwind v4 + ShadCN + Vite + TanStack Router / `marked` + `isomorphic-dompurify` / `@modelcontextprotocol/sdk` (stdio). See [`../prd.md`](../prd.md) §7 for the locked stack.

**Last updated:** 2026-05-09.

---

## Roles

### Orchestrator (main agent + Diego)

The primary agent in the conversation with Diego. Single point of coordination.

**Responsibilities:**
- Receives requirements from Diego
- Breaks work into phases and spawns specialist agents
- Resolves disagreements between agents (surfaces them to Diego when needed)
- Creates PRs when a phase is complete
- Keeps PRD ([`../prd.md`](../prd.md)) and decisions log ([`../decisions.md`](../decisions.md)) up to date
- Final decisions on scope and architecture when agents disagree

**Does NOT:** Write implementation code directly (delegates to engineers).

---

### Spec Team

Specialist analyst agents who research the codebase and produce findings *before* any plan is written. Team composition varies by phase scope.

| Analyst | Focus | When to include |
|---------|-------|-----------------|
| **Software Analyst** | Maps modules touched, data flow, MCP/HTTP surface changes, type contracts | Always |
| **DX Analyst** | Install flow, CLI error messages, MCP error envelopes, OSS friction, agent-facing developer experience | Any user-facing or agent-facing change |
| **Reliability Analyst** | SQLite migrations, concurrency, lifecycle, file IO, error/crash recovery, edge cases | Anything touching storage, MCP server lifecycle, substrate JSON loading |
| **Security Analyst** | Input validation, MCP surface, security middleware (Origin/Host, path canon, markdown sanitization), attack surface | Any change affecting middleware, MCP tools, file path handling, or markdown rendering |

The Orchestrator selects which analysts to spawn based on phase scope. Analysts run in parallel and report findings. The Orchestrator synthesizes their reports into a single spec document.

**Output:** A spec document at `.agents/plans/specs/phase-{N}-spec.md` containing:
- Feature description and scope
- Detailed behavior (what changes, where, how)
- Data model / schema changes (if any)
- MCP / HTTP API contract changes (if any)
- Open questions and decisions (with recommended answers)
- Edge cases and error scenarios
- Out of scope (what this phase does NOT do)

The spec is presented to Diego for review. Open questions are resolved before proceeding to the plan stage.

---

### Architect

Designs the implementation plan for a phase. Works from the approved spec — never starts without one.

**Responsibilities:**
- Reads the approved spec and existing codebase
- Writes the plan document including:
  - Implementation steps (files to create/modify, key logic)
  - Acceptance criteria (what "done" looks like)
  - Test strategy (what to test, what types, edge cases)
  - Instrumentation (what to log, what errors to capture)
- Revises the plan based on Architect Reviewer feedback

**Output:** A plan document at `.agents/plans/phase-{N}-{slug}.md`.

---

### Architect Reviewer

Reviews and challenges the Architect's plan. A separate agent — never the same agent that wrote the plan.

**Responsibilities:**
- Reads the plan and identifies gaps, risks, over-engineering, missed edge cases
- Challenges assumptions and suggests alternatives
- Validates that the plan aligns with the approved spec and existing architecture
- Provides structured feedback (PASS / CONCERN / BLOCKER per section)

**Does NOT:** Write the plan from scratch. Reviews only.

**Escalation:** If Architect and Reviewer cannot agree after one round of revision, the Orchestrator decides (surfacing the disagreement to Diego if non-obvious).

---

### Backend Engineer

Implements server-side TypeScript: storage layer, policy engine, MCP server, Hono HTTP routes, CLI commands.

**Responsibilities:**
- Reads the plan, spec, and conventions
- Implements production code following the plan
- Writes tests alongside the code (not after) using Vitest
- Keeps TypeScript types coherent across module boundaries
- Runs lint + format + type check + tests before declaring "ready"
- Addresses findings from the Code Reviewer

**Output:** Working code + passing tests, committed in logical increments.

---

### Frontend Engineer

Implements UI: React components, pages, client-side routing, Tailwind styles, ShadCN integration.

**Responsibilities:**
- Implements React/TypeScript/Tailwind code following the plan
- Uses ShadCN components rather than building custom when an equivalent exists
- Keeps TypeScript types in sync with backend API contracts
- Ensures markdown rendering goes through `marked` → DOMPurify → React (never bypasses sanitization)
- Runs lint + format + type check + Vite build + tests before declaring "ready"
- Addresses findings from the Code Reviewer

**When to spawn:** Only when the phase involves UI changes. Skip for backend-only work.

---

### Code Reviewer

Reviews all code produced by Backend/Frontend Engineers. A separate agent — never the author.

**Responsibilities:**
Reviews through three lenses simultaneously:
1. **Security** — input validation, path traversal, XSS via unsanitized markdown, MCP-tool abuse paths, attack surface against the security middleware
2. **Performance** — N+1 query patterns against SQLite, unnecessary re-renders in React, inefficient JSON-file parsing on hot paths, memory leaks in long-lived processes
3. **Instrumentation** — adequate logging for debugging, error reporting with context, no secrets/PII in logs

**Output:** Structured review with findings categorized as:
- **BLOCKER** — must fix before merge
- **CONCERN** — should fix, discuss if disagreement
- **SUGGESTION** — optional improvement

**Does NOT:** Write code. Only reviews and flags issues.

---

### QA

Validates the integrated experience through running the code locally and walking through realistic agent + UI flows.

**Responsibilities:**
- Runs the local server and connects a test agent (Claude Code session pointed at the new build)
- Walks through the feature's intended flows (happy paths, error states, edge cases)
- Tests the UI in a browser if relevant
- Reports bugs with clear reproduction steps
- Runs the full test suite against a fresh SQLite file
- Declares "pass" or "fail" for the phase

**When to spawn:** After Backend/Frontend declare "ready for QA" and Code Reviewer findings are addressed.

---

### Technical Writer

Reviews and updates user-facing documentation (README, CHANGELOG, examples, support docs) to ensure it stays accurate as features change.

**Responsibilities:**
- Reviews README quick-start against current behavior
- Updates CHANGELOG.md for user-facing changes
- Verifies MCP tool descriptions match the implementation
- Ensures examples/ stays runnable
- Updates support documentation (SUPPORT.md, ISSUE_TEMPLATE.md) when error messages or platform support changes

**Does NOT:** Write application code.

**When to spawn:** At the end of any phase that adds, changes, or removes user-facing features (CLI commands, MCP tools, UI behavior, install flow). Skip for internal-refactor phases.

---

### Assistant (Process Compliance)

Ensures every phase follows the workflow and nothing is missed.

**Responsibilities:**
- Spawns at the end of every phase, before the PR is created
- Walks the Phase Completion Checklist (below) item by item
- Verifies each applicable item, collecting evidence (test output, commit refs, doc updates)
- Reports a structured pass/fail status to the Orchestrator
- Flags any skipped or incomplete items with specific remediation
- Coordinates with the Orchestrator to resolve gaps before the PR is created

**Does NOT:** Write code, make architectural decisions, or perform QA testing.

**When to spawn:** End of every phase, after QA declares "pass" and before the Orchestrator creates the PR.

**Output:** A checklist audit report at `.agents/audits/phase-{N}-audit.md` with status per item (DONE / SKIPPED / NOT-APPLICABLE / MISSING).

---

## Team Sizing by Scope

| Scope | Spec Team | Implementation Team |
|-------|-----------|---------------------|
| **Small** (single module, isolated change) | Orchestrator drafts spec directly | Orchestrator handles directly (no specialist spawn) |
| **Medium** (few modules, one concern) | Software Analyst | Architect + (Backend OR Frontend) + Code Reviewer + Assistant |
| **Large** (cross-cutting) | Software + DX + Reliability analysts | Architect + Reviewer + Backend + Frontend + Code Reviewer + QA + Technical Writer + Assistant |
| **Security-touching** | Software + Security analysts | Architect + Backend + Code Reviewer + Assistant |
| **Storage/lifecycle** | Software + Reliability analysts | Architect + Reviewer + Backend + Code Reviewer + Assistant |

---

## Development Workflow

Every development phase follows this six-stage workflow. Each phase operates on a feature branch and produces a PR.

```
Phase N: {Feature Name}
│
├─ Stage 1: SPEC
│   ├─ Orchestrator selects analyst types based on phase scope
│   ├─ Orchestrator spawns analysts in parallel
│   ├─ Orchestrator synthesizes findings into a spec
│   ├─ Spec saved to .agents/plans/specs/phase-{N}-spec.md
│   ├─ Diego reviews spec, open questions resolved
│   └─ Diego approves spec (explicit approval required before Stage 2)
│
├─ Stage 2: PLAN
│   ├─ Orchestrator spawns Architect to write plan (from approved spec)
│   ├─ Orchestrator spawns Architect Reviewer to challenge plan
│   ├─ Architect revises based on feedback (1 round)
│   ├─ Orchestrator resolves any remaining disagreements
│   └─ Diego approves plan
│
├─ Stage 3: DEVELOP (feature branch created)
│   ├─ Backend/Frontend implement code + tests together
│   ├─ Progress committed in logical increments
│   ├─ Code Reviewer reviews (security, performance, instrumentation)
│   ├─ Engineers address review findings
│   └─ Dev team declares "ready for QA"
│
├─ Stage 4: QA
│   ├─ QA runs feature end-to-end against fresh state
│   ├─ Bugs reported → Engineers fix → QA re-tests
│   ├─ QA runs full automated test suite
│   └─ QA declares "pass" or "fail"
│
├─ Stage 5: AUDIT (mandatory gate)
│   ├─ Orchestrator spawns Assistant to walk Phase Completion Checklist
│   ├─ Assistant writes audit file to .agents/audits/phase-{N}-audit.md
│   ├─ Assistant reports pass/fail per checklist item
│   ├─ Orchestrator resolves gaps flagged by Assistant
│   └─ Audit file MUST exist before PR creation
│
├─ Stage 6: PR
│   ├─ Orchestrator creates PR via the project's PR script (which verifies audit file exists)
│   ├─ Orchestrator updates PRD / decisions log if architecture changed
│   └─ Diego reviews and approves merge
```

---

## Workflow Rules

### Hard Gates (MANDATORY — cannot be skipped)

These are blocking requirements. The Orchestrator MUST NOT proceed past them.

1. **No plan without an approved spec.** The Orchestrator MUST NOT begin the PLAN stage until the spec exists at `.agents/plans/specs/phase-{N}-spec.md` and Diego has approved it.

2. **No development without an approved plan.** The Orchestrator MUST NOT begin spawning engineers until the plan exists and Diego has approved it (explicitly or by participating in its creation).

3. **No code reaches `main` without code review.** A Code Reviewer agent reviews the phase's full diff once per phase (after development, before merge — see §Code Review). Per-step commits on the feature branch are fine; they're reviewed as a batch before the branch merges. Nothing reaches `main` unreviewed.

4. **No PR without Assistant audit.** The Orchestrator MUST spawn the Assistant and receive a checklist audit BEFORE creating any PR or asking Diego to merge. The audit file at `.agents/audits/phase-{N}-audit.md` is the artifact of this gate.

These gates are non-negotiable. The Orchestrator should treat them as hard errors if missed — stop, go back, and complete the gate before proceeding.

### Branching
- Each phase starts a new feature branch named `feature/phase-{N}-{slug}` (or similar consistent pattern)
- Code is never merged to main without Diego's approval
- PRs are the only merge mechanism
- The Orchestrator may be instructed to proceed with multiple phases autonomously — only when Diego explicitly requests it

### Commits
- Progress separated into multiple logical commits (not one big commit)
- Diego may pause the team for review at any step
- Commit messages describe the "why," not just the "what"

### Tests
- Tests written during development, not after
- Vitest for unit and integration tests
- Tests use a fresh in-memory or temporary SQLite file per test, not shared state
- Mock the filesystem when testing substrate JSON loading; use real SQLite for storage tests
- Final validation step: full test suite runs cleanly against a freshly-initialized substrate

### Instrumentation
- Instrumentation requirements are defined in the plan
- Code Reviewer checks instrumentation alongside security and performance
- Log entries include enough context for debugging (which MCP call, which agent_name, which task ID)
- Secrets and PII never appear in logs
- `agent_name` is treated as untrusted user input — never reflected unsanitized into UI or logs in a way that could be confused with system messages

### Code Review
- The Code Reviewer is always a separate agent from the author
- All three lenses (security, performance, instrumentation) are covered in a single review
- **Cadence: ONE Code Reviewer pass per phase, not per step.** It runs after all development Steps are complete (before the acceptance pass), covering the full phase diff in one review. Rationale: a per-step review cadence amplifies scope (each pass finds more to do) and is too heavy for a solo project. Per-phase keeps the safety net on the genuinely risky surfaces without the inflation. (Decided 2026-05-28.)
- This still satisfies Hard Gate #3 — the review happens before the branch merges to `main`, so nothing reaches `main` unreviewed. Per-step commits on the feature branch are fine; they're reviewed as a batch.
- BLOCKERs must be fixed before merge; CONCERNs should be fixed (discuss with Orchestrator if disagreement); SUGGESTIONs optional.

### Audit Gate (MANDATORY)
- Before ANY PR is created, the Orchestrator MUST spawn an Assistant to walk the Phase Completion Checklist
- The Assistant writes its audit to `.agents/audits/phase-{N}-audit.md`
- PRs are created via a project PR script (e.g., `pnpm run pr {N} "{title}"`) that verifies the audit file exists
- If the audit file does not exist, PR creation is blocked
- This gate is non-negotiable — no exceptions
- The audit agent must be a separate agent from any that wrote the code

---

## Phase Completion Checklist

Before creating a PR, the **Assistant agent** audits every applicable item. Items marked *(if applicable)* can be skipped when the phase does not involve that area. The Assistant reports results to the Orchestrator, who resolves gaps before proceeding.

### Stage 1: Spec
- [ ] Spec team analysts were spawned and produced research findings
- [ ] Orchestrator synthesized findings into a spec at `.agents/plans/specs/phase-{N}-spec.md`
- [ ] Open questions in the spec were resolved with Diego
- [ ] Diego approved the spec before planning began

### Stage 2: Planning
- [ ] Architect produced a plan document at `.agents/plans/phase-{N}-{slug}.md` based on the approved spec
- [ ] Architect Reviewer reviewed the plan and provided structured feedback
- [ ] Plan was revised based on reviewer feedback (or Orchestrator resolved disagreements)
- [ ] Diego approved the plan before development began

### Stage 3: Development
- [ ] All automated tests pass with ZERO failures (full suite, not just new tests) — any failing test is a BLOCKER
- [ ] Assistant confirmed with Orchestrator that no outstanding known bugs exist — any must be fixed or explicitly acknowledged by Diego
- [ ] Formatting passes (`prettier --check`)
- [ ] Linting passes (`eslint`)
- [ ] TypeScript check passes (`tsc --noEmit`) — zero new errors
- [ ] Frontend builds without errors (`vite build`) *(if applicable)*
- [ ] Code Reviewer has reviewed and all BLOCKERs are resolved
- [ ] Code Reviewer CONCERNs are addressed or explicitly deferred with reason
- [ ] New tests written for all new functionality (happy paths, failure paths, edge cases)
- [ ] Existing tests updated if behavior changed
- [ ] Test fixtures / factories updated for any new/modified entities *(if applicable)*

### Stage 4: QA
- [ ] End-to-end QA performed locally (agent connection + UI navigation if applicable)
- [ ] QA declared "pass" with all acceptance criteria met
- [ ] No console errors in the UI in normal-path interactions *(if applicable)*

### Stage 5: Phase-End
- [ ] Assistant agent audited this checklist and reported results to Orchestrator
- [ ] Plan document status updated (Planned → Complete)
- [ ] **PRD ([`../prd.md`](../prd.md)) updated** if architecture, scope, or non-goals changed during the phase
- [ ] **Decisions log ([`../decisions.md`](../decisions.md)) updated** if non-obvious choices were made during the phase
- [ ] **README updated** if installation, usage, supported platforms, or quick-start changed
- [ ] **CHANGELOG.md updated** with user-facing changes for this phase *(if applicable; required for any phase that ships behavior visible to end users)*
- [ ] **examples/ updated** if new MCP tools or substrate features added that warrant an example *(if applicable)*
- [ ] **No secrets committed** — no API keys, tokens, passwords, or credentials in code or documentation
- [ ] Feature branch is up to date with main
- [ ] Commits are logical and descriptive
- [ ] PR description includes summary, test plan, and any post-merge notes
- [ ] Any required post-merge steps documented (e.g., npm publish on tag, manual migration test)
- [ ] Known issues or follow-up work captured in the next phase's spec backlog or communicated to Diego

---

## Communication Protocol

### Spawning Agents

When the Orchestrator spawns an agent, it provides:
1. **Task description** — what to do
2. **Plan reference** — path to the plan document (if exists)
3. **Relevant references** — PRD path, decisions log path, existing relevant code
4. **Conventions** — point to `.agents/workflow.md` (this file) and any future `.agents/conventions.md`
5. **Scope boundaries** — what NOT to touch
6. **Expected output** — deliverables and definition of done

### Agent Return

Agents return:
1. **Summary** — what was done
2. **Files changed** — created / modified / deleted
3. **Test results** — which tests ran, status, coverage delta if relevant
4. **Issues found** — anything that deviates from the plan or needs attention

### Disagreements Between Agents

When two agents disagree (e.g., Architect vs. Architect Reviewer, or Code Reviewer disputing Engineer's approach):
1. The Orchestrator attempts to resolve internally
2. If unresolvable from the spec + plan, surfaces the disagreement to Diego with: each agent's position, the tradeoff, the Orchestrator's recommendation
3. Diego decides
4. The decision is captured in `.agents/decisions.md` if non-obvious

---

## Conventions Quick Reference

Full conventions to be documented separately in `.agents/conventions.md` once code exists. Until then:

- **TypeScript:** strict mode, no `any`, explicit return types on exported functions
- **Naming:** files in `camelCase.ts`, React components in `PascalCase.tsx`, types/interfaces in `PascalCase`
- **Formatting:** Prettier defaults (run `prettier --write` before commit)
- **Linting:** ESLint with `@typescript-eslint` recommended rules
- **Imports:** organized; no circular imports between modules
- **Errors:** typed error classes for known cases; never throw raw strings
- **Logging:** use a single `logger` module; never `console.log` in production code paths
- **Markdown rendering:** ALWAYS `marked` → DOMPurify → React; never bypass sanitization
- **SQLite:** never raw-concatenate SQL strings; always parameterized queries via libsql
- **Substrate JSON writes:** ALWAYS write-temp-and-rename with version CAS; never direct overwrite
