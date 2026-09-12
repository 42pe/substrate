# docs-site/ — the public documentation site (Mintlify)

The user-facing documentation for Substrate, built with [Mintlify](https://mintlify.com).
Content lives here as `.mdx`; `docs.json` defines the theme and the navigation.

> Not to be confused with `docs/`, which holds the **internal** specs and plans for
> `dev`-board work (self-contained HTML, see `docs/README.md`). Nothing in `docs/`
> is published.

## Run it locally

```sh
npm i -g mint          # once
cd docs-site
mint dev               # http://localhost:3000
```

`mint dev` serves the folder it is run from, so it must be run from `docs-site/`.
Run `mint broken-links` before pushing to catch dangling internal links.

## Layout

| Path                | Contents                                                     |
| ------------------- | ------------------------------------------------------------ |
| `docs.json`         | Theme, colors, navigation. Every page must be listed here.   |
| `index.mdx`         | Site landing page.                                           |
| `getting-started/`  | Install, quickstart, connecting an agent over MCP.           |
| `concepts/`         | The model: boards, tasks, fields, policies, members, the UI. |
| `agents/`           | How an agent should drive a substrate.                       |
| `authoring/`        | Turning a process into boards, fields, and gates.            |
| `operations/`       | Backup, diagnostics, upgrading.                              |
| `cli/`              | One page per `substrate` command.                            |
| `mcp/`              | One page per MCP tool family.                                |
| `images/`           | Screenshots and diagrams.                                    |
| `snippets/`         | Reusable MDX fragments.                                      |

## Conventions

- **The docs are versioned with the release.** They document the current release
  only — v0.7.0 as of this writing — and no earlier version is backfilled. A
  release is not complete until these pages match what actually ships: treat the
  `release` board's **Docs Verified** step as covering `docs-site/`, not just
  the root `README.md`.
- **These are usage docs.** How someone installs Substrate, connects an agent,
  authors a board, runs a command. Not how the Substrate project itself is run —
  no dev-board flow, no gate list, no release runbook. Those live in `CLAUDE.md`,
  `RELEASING.md`, `CONTRIBUTING.md` and `docs/`.
- **A page is not live until it is in `docs.json`.** Adding a file is not enough.
- Every page starts with `title` and `description` frontmatter.
- Prose here is hand-formatted — `.mdx` is in `.prettierignore`. `docs.json` is
  not, so run Prettier on it after editing.
- **Source of truth for behaviour is the code, not `README.md`.** Verify a claim
  against `src/` (or `tools/list` for MCP tool shapes) before documenting it.
