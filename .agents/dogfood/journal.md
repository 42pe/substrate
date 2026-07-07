# Diego's dogfood journal

The PRD §9 journal proper — **your** dated, first-person moments across all dogfood
projects. This is the single highest-signal input (higher than agent self-report). Log
things *as they happen*; a moment not written down didn't happen for the week-8 review.

**Entry format:** `- [YYYY-MM-DD] (project) [category] — what happened, concretely.`
Categories below map to PRD §9's capture list.

---

## ✅ "Markdown/Linear would have failed me here" (kill-criterion 2 — need ≥3 distinct, specific)
_The load-bearing evidence. A specific caught-something moment, not "felt organized."_

- _(none yet)_

## 🧩 Policy patterns authored (kill-criterion 4 — need ≥3 distinct *shapes*, not instances)
_New shapes of `transition_guard` / `agent_responsibility`. Note the shape + what it enforces._

_(observed across the 3 dogfood boards — 2026-07-07; ≥3 distinct shapes → criterion 4 likely GREEN)_
- **doc-required gate** (`transition_guard`) — can't advance to a review/closed stage until a
  doc-path field is set (mailsimp "Spec/Plan doc required"; astrology `gate-closed` requires
  `merged`+`launch_notes_doc`).
- **human-approval gate** (`transition_guard`) — a `*_approved` boolean must be true to advance
  (astrology `gate-*-approved`; StackChan `gate-plan-approved`). ⚠️ currently honor-system (B3).
- **handoff / carry-fields suggestion** (`agent_responsibility`) — on a stage move, remind the
  agent to create downstream tasks and carry named fields (StackChan `note-handoff-to-build`).
- **spawn-the-right-workers suggestion** (`agent_responsibility`) — mailsimp "Spawn the right analysts."
- **format/convention reminder** (`agent_responsibility`) — astrology `note-tech-plans` ("specs/plans are HTML").

## 🧱 Friction points
_Anything that made the tool annoying — DX, ergonomics, UI, setup, errors._

- _(none yet)_

## 🏳️ Silent bails (kill-criterion 1)
_Times you edited markdown/Linear on the side instead of the board, or stopped using it. Why._

- _(none yet)_

## 🕳️ Missing-feature workarounds
_Times you worked around something the tool couldn't do — **including ones you didn't consciously
notice wanting** (the subtlest, most important signal; the "wanted `automation` but didn't realize" mode)._

- _(none yet)_

## ⏳ Board went stale / diverged from reality (**watch hardest**)
_The board said X, reality was Y — a write that didn't happen at the right moment. When, how
long until anyone noticed, what (if anything) caught it. Per PRD §9 this is the failure mode
to watch harder than agents ignoring suggestions._

_(agent-observed — 2026-07-07 collection; confirm/annotate)_
- [2026-07-07] (StackChanExperiments) — `expected_review_date` read `2026-06-29` while today was
  07-07: **8 days stale, no signal** the "waiting on Diego" date was blown.
- [2026-07-07] (StackChanExperiments) — task `9acf4f71` (nightly observability) shown as an
  **unstarted plan though ~80% already shipped**; the board can't reflect it — the agent only
  knew from session memory. (Substrate can't observe work — the core §9 risk, live.)
- [2026-06-26] (mailsimp) — a Planning-board card was moved into the **Execution board's "Merged"
  group** and `update_task` **accepted a cross-board `group_id` with no error** → the board shows a
  structurally-impossible placement you'd misread. (Bug B2.)

## 🖥️ Web UI
_Did you open it? For what? Did read-only-ness frustrate you? (Directly prioritizes the
interactivity phases 13–15.)_

- _(none yet)_

## 🎯 Gut check (log periodically)
_If Substrate vanished tomorrow: would you miss it / shrug / be relieved? Trend over weeks._

- _(none yet)_
