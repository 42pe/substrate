import type { Member } from '../../core/types.js';

/**
 * Default member registry shipped by the bundled 'web-delivery' template
 * (written by `substrate init --template web-delivery` alongside the board).
 *
 * SOURCE OF TRUTH: `examples/web-delivery/.substrate/members/*.json`. This module
 * MIRRORS them so the template ships inside `dist/` (the `examples/` dir is not
 * in the npm `files` whitelist). A parse-equal test
 * (tests/integration/example-substrate.test.ts) fails if the two diverge.
 *
 * These members are DESCRIPTIVE metadata — a starting roster for a fresh
 * project, targeting the template's working groups. Nothing is gated on them.
 * Typed `as const satisfies Member[]` for compile-time shape-checking; the
 * bundled defaults are validated STRICTLY through `MemberSchema` at load/init
 * (loadTemplateMembers) — distinct from the lenient runtime member path.
 */
export const WEB_DELIVERY_MEMBERS = [
  {
    id: 'planner',
    name: 'Planner',
    full_description:
      'Defines behavior, data, and edge cases up front, then turns the spec into an implementation plan with a test strategy.',
    traits: ['writes crisp specs', 'weighs trade-offs', 'plans the test strategy'],
    concerns: ['scope creep', 'fuzzy acceptance criteria', 'unhandled edge cases'],
    memory_dir: '.substrate/members/planner/memory',
  },
  {
    id: 'builder',
    name: 'Builder',
    full_description:
      'Implements the change on a feature branch in the surrounding style, writing tests alongside the code.',
    traits: [
      'implements in the surrounding style',
      'tests during development',
      'small honest commits',
    ],
    concerns: ['a green suite before review', 'preserving invariants', 'not smuggling extra scope'],
    memory_dir: '.substrate/members/builder/memory',
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    full_description:
      'Checks correctness, security, and conventions against the code — skeptical, verifies claims, tries to break the change.',
    traits: ['skeptical', 'verifies claims against the code', 'checks conventions'],
    concerns: ['correctness', 'security', 'never rubber-stamping'],
    memory_dir: '.substrate/members/reviewer/memory',
  },
  {
    id: 'qa',
    name: 'QA',
    full_description:
      'Runs manual / browser verification plus the full automated suite on a clean database before Done.',
    traits: ['manual + browser verification', 'runs the full suite on a clean database'],
    concerns: ['acceptance criteria met', 'docs in sync', 'no secrets committed'],
    memory_dir: '.substrate/members/qa/memory',
  },
] as const satisfies Member[];
