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

An agent workflow is a named graph Orca runs for the user on a chosen execution host
(this machine or an SSH server). Each node is one step (a shell command, an agent call,
a file read/write, an HTTP request, a branch, a loop, …) and edges define the order and
which outputs go where. Users author them on the Workflows page; you author them through
the `orca workflows` CLI by importing a version-1 workflow JSON document.

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
running anything; do not create a shell variable or run `ORCA` literally.

If a `workflows` command reports that Orca is not running, start it with `ORCA open --json`
and retry. If Orca is old enough to lack the `workflows.*` methods, say so (the user should
update Orca) — do not edit persisted store files behind the app's back.

## CLI commands

```text
ORCA workflows list --json
ORCA workflows show <workflowId> --json
ORCA workflows import <file> --json
ORCA workflows import - --json          # read the JSON document from stdin
ORCA workflows import <file> --execution-target <serverId> --json
ORCA workflows run <workflowId> --json
ORCA workflows runs <workflowId> --json
ORCA workflows rm <workflowId> --json
```

- `list` prints every workflow with its id, name, enabled state, schedule, target, and
  node count. Capture `id` from here for later commands.
- `show` prints the node/edge graph and every data field: read it before editing or
  naming nodes in templates, and return it to the user as the current state.
- `import` creates a new workflow. Use a file path or `-` for stdin. Nodes and edges get
  fresh ids and template references are rewritten, so the same document imports twice
  safely and never collides with existing graphs. Imports always arrive disabled.
- `run` executes the workflow once and returns the run record. A workflow whose graph
  contains a `trigger_cron` node gets its schedule activated by this first run.
- `runs` lists run history; filter to one workflow by passing its `id`. A run with a
  final status (`completed`, `failed`, `cancelled`) is settled; `running`/`pending`
  means re-read `runs` a little later.
- `rm` deletes the workflow and its runs. Deleting a workflow is destructive: confirm the
  user wants deletion rather than "disable it" (the Workflows page is where toggling
  happens).

## Authoring recipe

Given a request like "check how much disk space is left and write it to a timestamped
file", pick nodes that do the units of work, chain them with edges, and import:

1. Draft the document below (node shapes in the next section). Keep it multiple lines of
   shell over cleverness: prefer one `shell_command` whose output the next node consumes
   over a dense chain of transforms.
2. Name the workflow from the intent ("Disk space report"), not the user's full sentence.
3. Import and report the returned workflow's `id` so the user can open it on the
   Workflows page and enable it.
4. Confirm behavior with `ORCA workflows run <id> --json` when the user wants a test now,
   then summarize `nodeRuns` statuses and outputs.

## Workflow JSON (version 1)

```json
{
  "version": 1,
  "name": "Disk space report",
  "executionTargetType": "local",
  "nodes": [
    {
      "id": "shell-df",
      "type": "shell_command",
      "pos": { "x": 0, "y": 0 },
      "data": {
        "command": "df -h / | tail -1 > disk-usage-$(date +%Y%m%d-%H%M%S).txt",
        "workingDirectory": "",
        "timeoutSeconds": 60,
        "failOnNonZeroExit": true
      }
    },
    {
      "id": "trigger",
      "type": "trigger_cron",
      "pos": { "x": 0, "y": 160 },
      "data": { "schedule": "0 9 * * 1-5" }
    }
  ],
  "edges": [
    { "id": "e1", "sourceNodeId": "trigger", "targetNodeId": "shell-df" }
  ]
}
```

- `id` values under your control (the CLI re-ids on import; keep them stable and readable:
  `shell-df`, `branch-ok`).
- `pos` is the canvas position for the editor. Space nodes so overlays are readable
  (160px steps between rows).
- `executionTargetType` is `"local"` (steps run on this machine) or `"ssh"` (steps run on
  the named paired server). An `"ssh"` import via stdin or file needs
  `--execution-target <serverId>`; local imports ignore that flag.

## Node types

Every node: `{ "id", "type", "pos": {"x","y"}, "data", optional "label" }`. Action nodes
(shell_command, python_script, agent_call, file_read, file_write, email_send, http_request,
json_transform, workflow_call) also accept `"retryCount"` and `"retryDelaySeconds"`,
ignored triggers, branch, and collect.

- `trigger_manual` — data `{}`; an entry point for `workflows run` (graph runs edge-wise
  from every node with no incoming edge otherwise).
- `trigger_cron` — data `{ "schedule": "<5-field cron>" }`; enables scheduling.
- `shell_command` — `{ "command", "workingDirectory" ("" = run in the Orca process cwd /
  configure on ssh), "timeoutSeconds", "shell"?, "env"?, "failOnNonZeroExit"? }`. stdout
  becomes the step `output`; the JSON value under `json`.
- `python_script` — `{ "script", "workingDirectory", "timeoutSeconds", "pythonBin"?,
  "failOnNonZeroExit"? }`.
- `agent_call` — `{ "agentId": "<claude|codex|cursor|…>" | "custom", "prompt",
  "structuredOutputSchema" (null or a JSON-schema string), "workingDirectory",
  "timeoutSeconds", 'customExecutable'?, 'customArgTemplate'? (with "{prompt}" replaced)
  }` — ask the agent and use its reply as the step output.
- `file_read` — `{ "filePath" }` → output is file content, `json` is parsed content.
- `file_write` — `{ "filePath", "content", "mode": "overwrite" | "append",
  "createParents" }`.
- `email_send` — `{ "to", "subject", "body", "smtpProfileId" }`; profile chosen on the
  Workflows page.
- `http_request` — `{ "method", "url", "auth": {"type": "none|basic|digest|bearer|header|query", …},
  "sendQuery", "queryMode", "queryParameters", "queryJson", "sendHeaders", "headerMode",
  "headers", "headersJson", "sendBody", "bodyContentType", "bodyMode", "bodyParameters",
  "bodyJson", "rawContentType", "rawBody", "binaryFilePath", "options" }` — mirrors the
  Workflows page editor; build requests there in canvas when in doubt, and keep imported
  HTTP nodes simple (`method` + `url`, defaults elsewhere).
- `json_transform` — `{ "expression" }` over the incoming JSON.
- `branch` — `{ "conditions": [{ "label", "field", "operator", "value" }],
  "defaultLabel" }`. `field` is a dot-path (`exitCode`, `output`, `json.field.path`),
  `operator` one of `eq|neq|contains|gt|lt|exitCode0|regex|truthy`. Every condition is an
  edge label; unset edges take `outputSelector` (next section) matching it.
- `for_each` — `{ "itemsExpression": "{{steps.<id>.json.items}}", "maxIterations" }`. The
  body runs for every item; edges leaving a for_each node need `outputSelector`
  `"body"` or `"done"`.
- `collect` — `{}`; marker node terminating a loop body and collecting iteration outputs.
- `form_input` — `{ "fields": [{ "id", "label", "type": "string|number|multi_choice|json",
  "value", "options" }] }`; values edited on the canvas before runs.
- `workflow_call` — `{ "targetWorkflowId", "inputExpression"?, "timeoutSeconds" }`; runs
  another workflow as a step.

Edges: `{ "id", "sourceNodeId", "targetNodeId", "outputSelector"? }`. `outputSelector`
routes branch outputs ("success", "failure", "otherwise", or condition labels) and
for_each ports ("body"/"done"); omit it on regular edges.

## Templates in node data

Any string value may embed `{{…}}`:

- `{{steps.<nodeId>.output}}` — a completed step's stdout/derived output.
- `{{steps.<nodeId>.json.<path>}}` — a dot-path into that step's parsed JSON.
- `{{$vars.KEY}}` — a workflow variable (Workflows page → Variables tab; secrets replace
  `plaintext` values at render time and render as `••••` in the panel).
- `{{loop.item}}` / `{{loop.index}}` — inside a for_each body.
- `{{$pageCount}}` / `{{$response.body.…}}` — http_request pagination expressions.

Never depend on a step that is not upstream of the node using it; unresolved templates
surface as a failed node in the run record. After import, `ORCA workflows show <id>`
always echoes the current graph, so you can validate your template names against real ids.

## Running and inspecting data

```text
ORCA workflows run <id> --json
ORCA workflows runs <id> --json
```

Every run carries `nodeRuns[]` with per-node `status`, `stdout`, `stderr`, `outputValue`,
`error`, and `durationMs` — pass those back when reporting results, and reuse them to
find why a node failed before editing the graph. The same run rows appear on the
Workflows page's bottom panel; the user's view and your CLI results are one record.

If a run fails because a step errored (non-zero exit, timeout, unreachable ssh target),
fix that node: shorten the command, raise `timeoutSeconds`, add `retryCount` +
`retryDelaySeconds`, or correct `executionTargetId` (an ssh import without
`--execution-target` is rejected with the flag name in the message).

## Workflows vs automations

Automations (`orca-cli` skill, `ORCA automations …`) schedule one *agent prompt* against a
worktree — heavier, resizable, agentic. Workflows run a *fixed graph of steps* on one host
without workspace management. Choose automations for "review my repo every morning",
workflows for "check disk space and write a timestamped file at 9 on weekdays". Do not
schedule both for the same job.
