# Examples

Example substrates. An example is just a `.substrate/` directory (boards,
groups, `field_schema`, and policies as JSON) you can copy into a project and
explore with `substrate serve`.

## [`web-delivery/`](web-delivery/)

A stack-agnostic web-development delivery process: a Spec → Plan → Build →
Review → QA → Done board with **policy gates** that block a task from advancing
until each stage's gate field is set (the fields are self-attested by the agent —
the gate records the claim, it doesn't verify it). Copy its `boards/delivery.json`
into your own project, or explore it with `substrate serve` from that directory. See
[`web-delivery/README.md`](web-delivery/README.md).

## Build your own

```sh
npx @diegoferreyra/substrate init     # create an empty .substrate/
npx @diegoferreyra/substrate serve    # inspect it at http://localhost:7475
```

Then author boards/groups/policies with the substrate-edit MCP tools (or by
hand in `.substrate/boards/*.json`).
