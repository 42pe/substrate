# Agent feedback prompt

Give agents that have been using Substrate this prompt to collect honest, specific
feedback. **Caveat that governs everything:** agents are sycophantic, unreliable narrators
of their own UX. Ask "how was it?" and you get "great!". So the prompt is adversarial and
demands specifics tied to real tool calls — and you weight what agents *did* (event log,
retry loops, bails) over what they *say*. Normalize replies into [feedback-schema.md](feedback-schema.md).

---

## End-of-run retro (main prompt — paste at the end of a session)

```
You've been using Substrate (the MCP task board) during this work. I'm deciding whether it
actually helps agents or gets in the way — I want PROBLEMS, not praise. Be blunt. If
something was fine, say "no issue"; do not invent positives. Ground every point in a real
tool call you made this session (name the tool + what happened).

1. Friction — which Substrate tool calls were awkward, slow, confusing, or returned too
   much/too little? Any response you couldn't fully use (too big for context, missing a
   field you needed)?
2. Errors & recovery — did you hit transition_blocked / version_mismatch / schema_violation
   / not_found / conflict / substrate_corrupt? For each: could you recover from ONLY the
   error message + envelope, or did you have to guess or give up?
3. Did policies change your behavior? For any transition_blocked or agent_responsibility
   suggestion: would you have done the right thing anyway, or did the policy genuinely
   redirect you? Say so plainly if it was just noise.
4. Suggestions/envelope — did you notice and act on `policies_fired` / suggestion messages,
   or ignore them? Useful or clutter?
5. Bail moments — was there any point you wanted to ditch the board and just use a markdown
   file or your own notes? What triggered it?
6. Missing capability — what did you want to do that no tool supported, or had to work
   around (a query, bulk op, field, relationship)?
7. Situational awareness — from the board ALONE, could you accurately state "what's the
   state of this project and what happens next"? If not, what was missing?
8. Staleness — was the board ever out of sync with what had actually happened (a write you
   skipped, a status that lagged reality)? When, and did anything catch it?

Format: one-line verdict + one concrete example per item. End with the single biggest thing
you'd change.
```

## As-you-go variant (put in the agent's instructions at the START of a run)

Catches friction the retro forgets — memory decays, and "it was fine in aggregate" hides
the sharp moments.

```
While using Substrate, keep a running friction log: whenever a tool call is confusing,
oversized, errors in a way you can't recover from from the message alone, or makes you
reach for a markdown file instead of the board — jot one line (tool + what happened). I'll
ask for the list at the end. Don't soften it.
```

## Notes on wording

- Error-code and field names above (`transition_blocked`, `version_mismatch`,
  `policies_fired`, etc.) match this repo's surface as of the last check. If the tool
  descriptions have changed, re-check and re-word so agents recognize the terms.
- If you run **multiple agents/roles** on one board, ask each separately and tag the report
  with the role — different roles hit different tools (a "reviewer" vs a "builder" stress
  different parts of the write path + policies).
