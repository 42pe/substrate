/**
 * The schema version of the .substrate/data.sqlite file this binary expects.
 *
 * Incremented when a new migration ships. On startup, the runner reads
 * `PRAGMA user_version` from data.sqlite and:
 *   - If file_version > BINARY_SCHEMA_VERSION: refuse to open (binary too old).
 *   - If file_version < BINARY_SCHEMA_VERSION: apply pending migrations forward.
 *   - If equal: open normally.
 */
export const BINARY_SCHEMA_VERSION = 2;

/**
 * The release version of this Substrate binary. Single source of truth — both
 * the MCP server's `name/version` (mcp/server.ts) and the HTTP `/api/health`
 * endpoint (http/routes/health.ts) read this. Bump in lockstep with
 * `package.json`'s `version` field.
 *
 * v1.x candidate: replace with a generated `version.generated.ts` written
 * from `package.json` during the build step. For Phase 1, the manual
 * lockstep is acceptable — there are only a handful of files to keep in sync.
 */
export const BINARY_VERSION = '0.1.0';
