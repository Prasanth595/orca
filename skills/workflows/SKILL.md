---
name: workflows
description: >-
  Create, save, load, list, run, and inspect Orca Agent Workflows — visual graphs of
  shell commands, agent calls, file reads/writes, HTTP requests, branches, and loops
  that Orca executes step by step. Use when the user says "workflow", "/workflow",
  "Agent Workflow", "create a workflow that…", "automate this as a workflow",
  "check disk space and write to a file", or asks to schedule or chain steps on one
  execution host. For scheduled agent *prompts* that open a workspace each run,
  use `orca-cli` (automations); workflows run a fixed graph of steps instead.
---

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

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. Orca exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside Orca's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Orca build.

## Load the version-matched guide before running Orca commands

```text
ORCA skills get workflows
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers authoring and the `workflows` CLI verbs. If no reference gates
apply, prefer defaulting to the guide as written and verify with `ORCA <command> --help`.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Orca is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Orca. If
`skills get` is unknown, explain that updating Orca restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
