import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';
import { BINARY_VERSION } from '../../../core/version.js';

/**
 * MCP tool: submit_feedback — turn "an agent noticed a rough edge in Substrate"
 * into a ready-to-file GitHub issue, WITHOUT leaving the runtime and WITHOUT
 * breaking Substrate's no-accounts / no-cloud / no-telemetry promise.
 *
 * The tool is a pure string-builder: it maps { title, body, agent_name? } to a
 * prefilled `issues/new` URL for the upstream repo and hands it back. It does
 * NOT call the GitHub API, needs no credentials, writes nothing (no task, no
 * comment, no event), and reaches no network. A human clicks the URL to submit.
 *
 * Every response is plain read data with NO `ok` field, so the wrapper marks it
 * `isError: false` — mirroring whoami / reverse_captcha. See wrapper.ts.
 *
 * The body footer is version-stamped from BINARY_VERSION (src/core/version.ts)
 * so it can never drift from the running binary — the same single-source import
 * whoami's PHASE_STRING uses.
 */

/** Feedback about Substrate itself always targets the upstream repo. */
export const REPO = '42pe/substrate';

/** The "tag" convention: every filed issue title carries this prefix. */
const TITLE_PREFIX = 'Substrate Feedback: ';

export interface SubmitFeedbackInput {
  title: string;
  body: string;
  agent_name?: string | undefined;
}

export interface SubmitFeedbackResult {
  result: 'feedback_url';
  url: string;
  issue_title: string;
  repo: string;
  instructions: string;
}

/**
 * Pure handler: assemble the prefixed title, the version-stamped body (plus an
 * optional attribution line), and the prefilled issues/new URL. Deterministic —
 * the same inputs always produce the same URL (no clock, no randomness, no I/O).
 */
export function submitFeedbackHandler(input: SubmitFeedbackInput): SubmitFeedbackResult {
  const issue_title = TITLE_PREFIX + input.title;

  const footerLines = [`Filed via Substrate v${BINARY_VERSION}`];
  if (input.agent_name !== undefined) footerLines.push(`Agent: ${input.agent_name}`);
  const body = `${input.body}\n\n---\n${footerLines.join('\n')}`;

  // encodeURIComponent escapes every special character (&, #, =, newlines, and
  // spaces → %20) so user input cannot inject or override query params; `labels`
  // is a literal. Values round-trip via decodeURIComponent (and URL.searchParams).
  const enc = encodeURIComponent;
  const url =
    `https://github.com/${REPO}/issues/new` +
    `?title=${enc(issue_title)}&body=${enc(body)}&labels=feedback`;

  return {
    result: 'feedback_url',
    url,
    issue_title,
    repo: REPO,
    instructions:
      "Open this URL in a browser and click 'Submit new issue' to file it. Nothing was sent automatically.",
  };
}

export const submitFeedbackShape = {
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4096),
  agent_name: z.string().min(1).max(80).optional(),
};

export const submitFeedbackSchema = z.object(submitFeedbackShape);

export function registerSubmitFeedback(server: McpServer, _deps: ToolDeps): void {
  server.tool(
    'submit_feedback',
    'File feedback about Substrate itself. Give a short `title` and a `body`; returns a prefilled GitHub issue URL for 42pe/substrate that a human opens and submits. Nothing is sent automatically — no network, no credentials, no data stored.',
    submitFeedbackShape,
    wrapToolHandler('submit_feedback', submitFeedbackSchema, (input) =>
      Promise.resolve(submitFeedbackHandler(input)),
    ),
  );
}
