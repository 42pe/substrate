# Support

Substrate is a **solo-maintained, open-source project**. Please set expectations
accordingly:

- **Triage cadence:** roughly **weekly**. There are **no SLAs** and no guaranteed
  response time. Issues with a clear reproduction get looked at first.
- **Best way to get help:** open a GitHub issue using the bug-report template.
  Include your Node.js version, OS, the output of
  `npx @diegoferreyra/substrate diagnose`, and reproduction steps. Issues missing
  these are likely to be auto-closed asking for them — just add the details and
  it can be reopened.
  - **For MCP-server or running-UI bugs**, also include the output of
    `npx @diegoferreyra/substrate logs --errors` (or attach
    `.substrate/logs/substrate.log`). The long-lived `mcp`/`serve` processes
    record warnings + errors there, with stack traces for unexpected failures.
    The log is **local and gitignored** — it never leaves your machine until you
    paste it, so review it first.
- **Feature requests:** open an issue to discuss. Substrate's v1 scope is
  intentionally narrow (see `.agents/plans/v1-architecture.md`); most new-feature
  requests will be parked rather than declined.

## Platform support

- **macOS and Linux** — primary, exercised in CI.
- **Windows / WSL** — **best-effort**. The CI matrix runs a Windows leg so
  platform problems are *visible*, but Windows failures are **non-blocking** and
  may go unfixed. If you're on Windows, **WSL is the recommended path**. If you
  hit a Windows-specific install or runtime issue, please file it with full
  `diagnose` output — visibility helps even when a fix isn't promised.

## Security

If you find a security issue (e.g. a way to reach the localhost server
cross-origin, or content that escapes the UI's markdown sanitizer), please
**do not** open a public issue. Email the maintainer at the address on
<https://diegoferreyra.com> with details and a reproduction, and allow
reasonable time to address it before any disclosure.
