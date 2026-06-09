# Product review of the docs — 2026-06-09

**Reviewer:** external product pass (Claude, requested by Diego).
**Scope reviewed:** README.md, prd.md (v0.3 incl. critique section), skills/substrate/SKILL.md, skills/substrate/AUTHORING.md, AGENTS.md, decisions.md, CHANGELOG.md, examples/web-delivery.
**Question asked:** is Substrate genuinely useful for a software engineer working with agent teams, or a gimmick?

**Verdict:** not a gimmick — but the real value is narrower than the docs frame it, and concentrated in two mechanisms the docs undersell. This file lists the actionable changes.

---

## The two load-bearing value props (reframe docs around these)

1. **Enforcement at write time.** The honest competitor isn't Linear or markdown — it's CLAUDE.md prose conventions and harness-native todo/task tools. Against those, `transition_guard` has a structural edge: CLAUDE.md is advisory and agents drift from it as context fills; a guard returning `transition_blocked` at the moment of the violating action is a hard rail with perfectly-timed feedback. This is the non-gimmick core.
2. **Durable state across sessions and agents.** Harness-native todos are per-session and evaporate with the context window. A new session reading `.substrate/` knows where work stands and which gates are unmet without re-deriving state from git log. This pays off even in the solo-engineer-one-agent workflow (PRD R8's worry) — it may be the strongest *everyday* value prop, and the docs barely mention it.

## Actionable changes

### 1. README — lead with the problem, not the mechanism (highest priority)

- The README opens with mechanism ("local-first, per-project project-management substrate") and never states the problem. Lead with the orchestrator-memory pitch: *orchestrators shouldn't keep the process in their heads; define it in the substrate and follow it, so the agent focuses on the work.*
- Add a short **"Why not X?"** section answering the question every target user asks in the first 30 seconds: why not TodoWrite / harness-native tasks / GitHub Issues / a markdown file? Make the two arguments above (enforcement at write time; state that survives the context window). The PRD has this reasoning (§1) but OSS visitors won't read the PRD.

### 2. Be honest that gates gate the *report*, not the *reality*

- Every gate is a self-attested boolean: the agent flips `tests_passing: true` itself. Nothing verifies tests passed. An agent that would skip review under pressure will also set the flag under pressure — it's a confession step, not a control.
- The internals are quietly honest ("audit tag, not auth"; "self-attested, not forensic") but the product framing of "enforceable gates" / "working gates" (README, examples, AUTHORING.md) oversells what's enforced. Add one honest sentence where gates are pitched.
- Roadmap note (v1.x/v2 candidate, don't build now): gates backed by verifiable evidence (command exit codes, CI status, file existence) is where enforcement becomes real. Claude Code hooks can already do deterministic verification at the harness level — Substrate's counter-argument is runtime portability + in-repo data model + the UI; the docs never make that argument and should.

### 3. PRD — decide now whether kill criterion 3 alone is really fatal

- Prediction: `transition_guard` greens, `agent_responsibility` underperforms (it's context injection at write time — good timing, but suggestions compete with everything else in context; the PRD itself flags this as the untested bet, R1).
- The PRD's framing says that outcome = "a worse Linear with extra JSON." That conclusion looks wrong: durable shared state + guards justify the tool even if the suggestion class flops. Decide before week 8 whether criterion 3 firing kills the *paradigm* or just kills that *class* (i.e. reduce scope to guards + state, don't shelve).

### 4. Name the third failure mode in the dogfood journal: the stale board

- Substrate can't observe work; it only sees what agents self-report. If writes don't happen at the right moments, the board silently diverges from reality and the human's "visibility" is fiction.
- The dogfood journal prompts (PRD §9) track "moments markdown would have failed" and "workarounds for missing classes" — add: **"moments the board went stale / diverged from reality, and how long until anyone noticed."** This is the failure mode to watch hardest, more than agents-ignore-suggestions.

### 5. Strategic positioning section (README or PRD): platform absorption

- The biggest strategic risk isn't gimmickry — it's harnesses shipping native task lists, queues, and hooks. Substrate's durable moat: runtime-agnostic, in-repo, version-controlled, inspectable via UI. State this argument explicitly somewhere; it's the answer to "why does this exist" in 12 months.

### 6. Smaller items

- **MCP context tax:** 29 tools is a real context cost in an era where users prune MCP servers. Document the actual loaded-schema cost somewhere, and/or consider a slimmer default toolset (substrate-edit tools behind a flag/opt-in) — at minimum acknowledge the trade-off.
- **Name collision:** "Substrate" collides hard with Polkadot's Substrate framework — SEO/discoverability headwind directly against the PRD's stars/installs metrics. At minimum, choose README keywords/tagline with that in mind ("agent task manager", "MCP", etc.).
- **R8 needs a blunt answer before further investment:** does Diego actually run concurrent agents on one repo today? If yes — dogfood as planned. If it's one agent at a time — lead the positioning with the durable-cross-session-state story (which conveniently is the undersold one).

## What's already strong (don't touch)

- **prd.md** is unusually honest — pre-committed kill criteria, an adversarial critique naming its own weakest claims, OSS-only as the accepted default outcome. Keep that discipline.
- **AUTHORING.md**'s "policies fail silently — prove the gate blocks before declaring done" probe-task ritual is exactly what separates working agent tooling from aspirational agent tooling.
- **SKILL.md** conventions block is tight; the self-installing AGENTS.md flow is a clever distribution mechanism.
- The live kanban (v0.3.0) is the shareable/demoable surface — genuinely valuable for the human-visibility half of the pitch.
