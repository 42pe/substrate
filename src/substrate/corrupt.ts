import { SubstrateError } from '../core/errors.js';

/**
 * Build a `substrate_corrupt` error for a broken on-disk board file.
 *
 * The load path is strict: one malformed board file fails the whole substrate
 * load (a broken gate should never silently vanish). But the *old* error was a
 * generic `internal_error`, which reads as "server bug" when the truth is "an
 * authored config file you can fix." This helper makes the error actionable:
 * it names the exact file and problem, and embeds a ready-to-paste prompt a
 * human can hand to an AI agent to repair the file. The prompt is also exposed
 * in `details.fix_prompt` so a UI can surface a copy button.
 */
export function corruptBoardError(opts: {
  /** Path relative to `.substrate/`, e.g. `boards/delivery.json`. */
  file: string;
  /** What's wrong, as a short human phrase (no trailing period needed). */
  problem: string;
  details?: Record<string, unknown> | undefined;
}): SubstrateError {
  const { file, problem } = opts;
  const path = `.substrate/${file}`;
  const fixPrompt =
    `The Substrate board file ${path} is invalid: ${problem}. ` +
    `Open it and correct it so it matches the board schema (see the substrate skill's ` +
    `AUTHORING.md for the board/group/field_schema/policy shapes), keeping the file as ` +
    `valid JSON. Don't change board, group, or policy ids unless that's the actual fault. ` +
    `Then retry the operation.`;
  const message =
    `Substrate could not load ${path}: ${problem}. This is an authored substrate file you ` +
    `can fix by hand or with an agent — to use an agent, paste:\n\n${fixPrompt}`;
  return SubstrateError.substrateCorrupt(message, {
    file,
    fix_prompt: fixPrompt,
    ...opts.details,
  });
}
