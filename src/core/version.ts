/**
 * The schema version of the .substrate/data.sqlite file this binary expects.
 *
 * Incremented when a new migration ships. On startup, the runner reads
 * `PRAGMA user_version` from data.sqlite and:
 *   - If file_version > BINARY_SCHEMA_VERSION: refuse to open (binary too old).
 *   - If file_version < BINARY_SCHEMA_VERSION: apply pending migrations forward.
 *   - If equal: open normally.
 */
export const BINARY_SCHEMA_VERSION = 1;
