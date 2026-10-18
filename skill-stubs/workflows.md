# Orca Agent Workflows

This file is a discovery stub, not the usage guide. The full, version-matched Orca
agent workflows reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Orca agent workflows whenever the user asks to create, save, load, list, run, or
inspect a workflow of concrete steps — "create a workflow that checks how much space my
local disk has left", "automate this as a workflow", "chain these commands in a workflow",
or any `/workflow` request in Orca chat. You author the graph by importing a workflow JSON
document through `ORCA workflows …` commands; the guide covers every node type, template
expression (`{{steps.*.output}}`, `{{$vars.KEY}}`), the run record, and step-by-step
authoring rules. For scheduled single-agent prompts that open a workspace per run, use the
`orca-cli` skill (`automations`) instead.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get workflows
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers authoring and the `workflows` CLI verbs. If no reference gates
apply, prefer defaulting to the guide as written and verify with `ORCA <command> --help`.

<!-- shared: no-guessing -->
