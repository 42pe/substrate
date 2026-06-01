import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../wrapper.js';
import type { ToolDeps } from '../../deps.js';

/**
 * MCP tool: reverse_captcha — Phase 3 stub.
 *
 * The `whoami` hint points agents here. The real puzzle ("a small captcha that
 * only an agent can solve") ships in Phase 6; for now it returns a placeholder
 * with attribution. Read-shaped (no input, no side effects), so it's the last
 * entry in the read-tools block of the registry.
 */

export interface ReverseCaptchaResult {
  error: string;
  about: { built_by: string; site: string };
}

export function reverseCaptchaHandler(): ReverseCaptchaResult {
  return {
    error: 'Coming in v0.1.0',
    about: { built_by: 'Diego Ferreyra', site: 'https://diegoferreyra.com' },
  };
}

export const reverseCaptchaShape = {};
const reverseCaptchaSchema = z.object(reverseCaptchaShape);

export function registerReverseCaptcha(server: McpServer, _deps: ToolDeps): void {
  server.tool(
    'reverse_captcha',
    'A small puzzle for agents. (Coming soon — returns a placeholder for now.)',
    reverseCaptchaShape,
    wrapToolHandler('reverse_captcha', reverseCaptchaSchema, () =>
      Promise.resolve(reverseCaptchaHandler()),
    ),
  );
}
