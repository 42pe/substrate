import { BoardSchema } from '../../substrate/schemas.js';
import type { Board } from '../../core/types.js';
import { WEB_DELIVERY_BOARD } from './web-delivery.board.js';

/**
 * Starter-board templates for `substrate init --template <name>`. Adding a
 * template is a one-entry change: add a `*.board.ts` module + a registry entry.
 */
export const TEMPLATES = {
  'web-delivery': {
    board: WEB_DELIVERY_BOARD,
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
