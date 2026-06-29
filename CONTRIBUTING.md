# Contributing to Substrate

Thanks for your interest. Substrate is a solo-maintained project with a
deliberately narrow contribution model — please read this before opening a PR.

## Bug reports

Bug reports **with a reproduction** are the most valuable contribution. Open an
issue using the bug-report template and include:

- Your **Node.js version** (`node --version`) and **OS**.
- The output of **`npx @diegoferreyra/substrate diagnose`**.
- **Reproduction steps** — the smaller and more deterministic, the better.

Issues missing these fields may be auto-closed by a bot asking for them; just
edit the issue to add the details and it can be reopened.

## Pull requests

- **Bug fixes with a reproduction and a test** are welcome. Keep them focused:
  one fix per PR, with a test that fails before and passes after.
- **Architecture-changing PRs are declined by default.** Substrate's design
  (single npm package, stdio MCP + localhost UI, substrate-as-code + SQLite,
  two policy classes) is intentional and documented in
  `.agents/plans/v1-architecture.md`. Please open an issue to discuss before
  investing in anything that changes module boundaries, the storage model, the
  tool surface, or the security posture — unsolicited large refactors will be
  closed.

## Local development

```sh
pnpm install
pnpm build            # builds the server (tsc) and the UI (vite)
pnpm test             # unit + integration (server)
pnpm --dir ui test    # UI unit tests (jsdom: sanitizer + components)
pnpm lint && pnpm format:check
```

Before submitting, make sure `pnpm build`, `pnpm test`, `pnpm --dir ui test`,
`pnpm lint`, and `pnpm format:check` all pass. PRs are validated by CI on
Ubuntu, macOS, and Windows (Windows is non-blocking).

**Writing a test that opens the database?** Clean its temp dir up with `rmrf` /
`rmrfSync` from `tests/helpers/tmp.ts` — never a bare `rm(dir, { recursive,
force })`. On Windows, `@libsql/client` doesn't release the SQLite file handle on
`close()`, so a plain `rm` throws `EBUSY` (and adding `maxRetries` makes it
*hang*). `rmrf` is fail-fast + best-effort and leaks the temp dir instead. See
the decisions-log entry "Windows CI" for the full story.

## Code of conduct

Be decent. Harassment or hostility gets you blocked. There's no formal CoC
document for a project this size, but the bar is "act like a professional."

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
