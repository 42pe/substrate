# SampleSaaS fixture

Sanitized substrate fixture for tests, starting Phase 2.

A generic SaaS-product-being-built workflow: phases move through stages
(`proposed` → `spec` → `spec-review` → `plan` → `plan-review` → `develop`
→ `code-review` → `qa` → `audit` → `pr` → `merged`).

## Phase 1 contribution

`config.json` only. Phase 2 adds `boards/phases.json` (board definition +
groups + field_schema). Phase 3 adds policies on that board
(transition_guards for stage gates + agent_responsibility hints).

## Not used in Phase 1 tests

Phase 1 tests use temp directories and `initCommand` to bootstrap fresh
substrates per test. The fixture is set up here so the directory exists
and the convention is documented; later phases will reference it.
