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

- **macOS and Linux (x64/arm64)** — primary, exercised in CI.
- **Windows x64** — **supported, best-effort.** The CI matrix runs a Windows x64
  leg and it passes. It is kept **non-blocking** because the SQLite driver
  (`@libsql/client`) has rough edges on Windows (see below), so a future
  Windows-only flake shouldn't block unrelated work. File Windows issues with
  full `diagnose` output.
- **Windows on ARM (arm64)** — **not supported.** `@libsql/client` ships no
  `win32-arm64` native binding, so the database layer can't load. Use **WSL** (or
  an x64 machine) on Windows-on-ARM hardware.

### Known Windows quirk (libsql)

On Windows, `@libsql/client`'s `close()` does not release the underlying SQLite
file handle the way standard SQLite does (verified: the built-in `node:sqlite`
closes and deletes the same WAL database cleanly). Practical effect, minor for
normal single-process use: a command that **opens** the database and then, in the
*same process*, tries to **delete** `data.sqlite` can fail with `EBUSY`. Each CLI
command runs in a fresh process, so this isn't normally hit — but if `substrate
import` errors this way over an existing substrate, stop any running
`serve`/`mcp` process and retry.

Separately, a heavy **multi-process** concurrency stress test (four processes
writing to the same WAL database for 60s) has been observed to *intermittently*
crash a worker with a native access violation (`0xC0000005`) on Windows — i.e.
libsql's binding isn't rock-solid under concurrent multi-process writes on
Windows. Single-agent and single-process use is unaffected. This is the main
reason the Windows CI leg is kept **non-blocking**.

## Security

If you find a security issue (e.g. a way to reach the localhost server
cross-origin, or content that escapes the UI's markdown sanitizer), please
**do not** open a public issue. Email the maintainer at the address on
<https://diegoferreyra.com> with details and a reproduction, and allow
reasonable time to address it before any disclosure.
