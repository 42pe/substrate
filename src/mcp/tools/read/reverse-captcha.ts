import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: reverse_captcha — the "small puzzle for agents" the `whoami` hint
 * points at. An easter egg, not a security control.
 *
 * Protocol (ONE tool, two call shapes — MCP tools are stateless, so a timed
 * challenge needs a two-step handshake against in-process state):
 *   - No args                      → ISSUE a challenge: returns
 *     `{ result: 'challenge', challenge_id, instructions, puzzle, expires_at }`.
 *   - `{ challenge_id, answer }`   → VERIFY: returns `{ result: 'solved' }`,
 *     `{ result: 'wrong_answer' }`, or `{ result: 'expired' }`.
 *   - Exactly one of the two args  → `schema_violation` (paired refine).
 *
 * State lives in a module-level Map for the life of the long-lived stdio MCP
 * process (issue and verify are separate tool calls on the same process).
 * Challenges are single-use (deleted on verify) and expire after `TTL_MS`;
 * expired entries are swept lazily on the next issue. An unknown or expired id
 * both return `expired` — there is intentionally no oracle distinguishing
 * "never existed" from "timed out".
 *
 * IMPORTANT: every response is plain read data with NO `ok` field, so the tool
 * wrapper marks them all `isError: false` (a wrong/expired answer is a normal
 * result, not an MCP error). See wrapper.ts:55 `isErrorEnvelope`.
 *
 * `Math.random()`/`Date.now()` are used here deliberately — this is runtime
 * source, where nondeterminism is allowed (only workflow scripts forbid it).
 * Tests inject `now`/`ttlMs` and call `__resetStore()` for determinism.
 */

const ABOUT = { built_by: 'Diego Ferreyra', site: 'https://diegoferreyra.com' } as const;

export const DEFAULT_TTL_MS = 10_000;

interface Challenge {
  answer: string; // normalized expected answer
  expiresAt: number; // epoch ms
}

const store = new Map<string, Challenge>();

/** Test-only: clear the in-memory challenge store between cases. */
export function __resetStore(): void {
  store.clear();
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pick<T>(arr: readonly T[]): T {
  // Non-empty by construction at call sites.
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function sample<T>(arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

const KEY_WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
] as const;
const COLOR_WORDS = ['red', 'blue', 'green', 'amber', 'violet', 'cyan', 'coral', 'olive'] as const;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function randomCode(len = 3): string {
  let s = '';
  for (let i = 0; i < len; i++) s += pick(CODE_ALPHABET.split(''));
  return s;
}

interface GeneratedPuzzle {
  instructions: string;
  puzzle: string;
  answer: string; // normalized
}

/** Template A — keyed extraction: read the value at a named key. */
function genKeyedExtraction(): GeneratedPuzzle {
  const keys = sample(KEY_WORDS, 4);
  const entries = keys.map((k) => [k, randomCode()] as const);
  const target = pick(entries);
  const obj: Record<string, string> = {};
  for (const [k, v] of entries) obj[k] = v;
  return {
    instructions: `Return ONLY the value stored under the key "${target[0]}".`,
    puzzle: JSON.stringify(obj),
    answer: normalize(target[1]),
  };
}

/** Template B — ordered transform: reverse a token list, join with hyphens. */
function genOrderedTransform(): GeneratedPuzzle {
  const words = sample(COLOR_WORDS, 4);
  const answer = [...words].reverse().join('-');
  return {
    instructions:
      'Reverse the ORDER of the words below and join them with a single hyphen "-". Return ONLY the result.',
    puzzle: words.join(', '),
    answer: normalize(answer),
  };
}

const TEMPLATES = [genKeyedExtraction, genOrderedTransform] as const;

export interface ReverseCaptchaOpts {
  now?: () => number;
  ttlMs?: number;
}

export type ReverseCaptchaInput = {
  challenge_id?: string | undefined;
  answer?: string | undefined;
};

export type ReverseCaptchaResult =
  | {
      result: 'challenge';
      challenge_id: string;
      instructions: string;
      puzzle: string;
      expires_at: string;
    }
  | { result: 'solved' | 'wrong_answer' | 'expired'; message: string; about: typeof ABOUT };

export function reverseCaptchaHandler(
  input: ReverseCaptchaInput,
  opts: ReverseCaptchaOpts = {},
): ReverseCaptchaResult {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const t = now();

  // VERIFY path: both args present (the schema refine guarantees paired input).
  if (input.challenge_id !== undefined && input.answer !== undefined) {
    const challenge = store.get(input.challenge_id);
    if (challenge !== undefined) store.delete(input.challenge_id); // single-use
    if (challenge === undefined || challenge.expiresAt <= t) {
      return {
        result: 'expired',
        message:
          'That challenge has expired or does not exist. Call reverse_captcha with no arguments to get a fresh one — and be quicker this time.',
        about: ABOUT,
      };
    }
    if (normalize(input.answer) === challenge.answer) {
      return {
        result: 'solved',
        message: 'Solved. You are (probably) not a human. Welcome.',
        about: ABOUT,
      };
    }
    return {
      result: 'wrong_answer',
      message: 'Not quite. Call reverse_captcha with no arguments to try a fresh puzzle.',
      about: ABOUT,
    };
  }

  // ISSUE path: no args. Sweep expired entries lazily, then mint a challenge.
  for (const [id, c] of store) {
    if (c.expiresAt <= t) store.delete(id);
  }
  const gen = pick(TEMPLATES)();
  const challengeId = randomUUID();
  const expiresAt = t + ttlMs;
  store.set(challengeId, { answer: gen.answer, expiresAt });
  return {
    result: 'challenge',
    challenge_id: challengeId,
    instructions: `${gen.instructions} You have ${Math.round(ttlMs / 1000)} seconds. Call reverse_captcha again with { challenge_id, answer }.`,
    puzzle: gen.puzzle,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

export const reverseCaptchaShape = {
  challenge_id: z.string().min(1).optional(),
  answer: z.string().optional(),
};

/**
 * Paired refine: VALID when neither arg is present (issue path) or BOTH are
 * (verify path); INVALID when exactly one is present. wrapToolHandler turns a
 * parse failure into a `schema_violation` envelope.
 */
export const reverseCaptchaSchema = z
  .object(reverseCaptchaShape)
  .refine((d) => (d.challenge_id === undefined) === (d.answer === undefined), {
    message:
      'Provide neither argument (to receive a challenge) or BOTH challenge_id and answer (to solve one).',
  });

export function registerReverseCaptcha(server: McpServer, _deps: ToolDeps): void {
  server.tool(
    'reverse_captcha',
    'A small timed puzzle for agents. Call with no arguments to get a challenge, then call again with { challenge_id, answer } within the time limit.',
    reverseCaptchaShape,
    wrapToolHandler('reverse_captcha', reverseCaptchaSchema, (input) =>
      Promise.resolve(reverseCaptchaHandler(input)),
    ),
  );
}
