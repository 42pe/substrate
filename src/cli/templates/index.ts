import { BoardSchema, MemberSchema } from '../../substrate/schemas.js';
import type { Board, Member } from '../../core/types.js';
import { WEB_DELIVERY_BOARD } from './web-delivery.board.js';
import { WEB_DELIVERY_MEMBERS } from './web-delivery.members.js';

/**
 * Starter-board templates for `substrate init --template <name>`. Adding a
 * template is a one-entry change: add a `*.board.ts` module + a registry entry.
 * A template ships a board plus a default `members` registry (both scaffolded by
 * `init`).
 */
export const TEMPLATES = {
  'web-delivery': {
    board: WEB_DELIVERY_BOARD,
    members: WEB_DELIVERY_MEMBERS,
    summary: 'Spec → Plan → Build → Review → QA → Done, with policy gates',
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export function isTemplateName(s: string): s is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, s);
}

export function templateNames(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Return a fresh, validated `Board` for the named template. The
 * `BoardSchema.parse` is the ONLY validation gate — `createBoardFile` writes
 * verbatim (it only checks the board id), so a corrupted bundled template must
 * fail loudly here rather than producing a board the binary later rejects.
 */
export function loadTemplateBoard(name: TemplateName): Board {
  // `as Board`: the Zod-inferred output widens optionals to `| undefined`,
  // which `exactOptionalPropertyTypes` rejects against the hand-written
  // interface. The loader (substrate/loader.ts) uses the same cast.
  return BoardSchema.parse(TEMPLATES[name].board) as Board;
}

/**
 * Return the fresh, STRICTLY-validated default member registry for the named
 * template. `MemberSchema.parse` throws on a corrupt shipped default — this is a
 * build-time invariant on Substrate's OWN artifacts, deliberately distinct from
 * the LENIENT (warn+skip) runtime path for user-project member files
 * (substrate/loader.ts `loadMembers`). Loosening one must not loosen the other.
 */
export function loadTemplateMembers(name: TemplateName): Member[] {
  // `as Member`: same Zod-optional widening bridge as loadTemplateBoard.
  return TEMPLATES[name].members.map((m) => MemberSchema.parse(m) as Member);
}
