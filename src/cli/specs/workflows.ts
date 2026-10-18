import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const WORKFLOW_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['workflows', 'list'],
    summary: 'List Orca agent workflows',
    usage: 'orca workflows list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca workflows list', 'orca workflows list --json']
  },
  {
    path: ['workflows', 'show'],
    summary: 'Show one Orca agent workflow, including its nodes and edges',
    usage: 'orca workflows show <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca workflows show 2f9e...', 'orca workflows show --id 2f9e... --json']
  },
  {
    path: ['workflows', 'import'],
    summary: 'Import an agent workflow from a version-1 export JSON file (or "-" for stdin)',
    usage:
      'orca workflows import <file|-> [--execution-target <server id>] [--json]\nPass "-" to read the export JSON from stdin. SSH exports need --execution-target with the server id from `orca server list`.',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'execution-target'],
    positionalArgs: ['file'],
    examples: [
      'orca workflows import ./disk-space.workflow.json',
      'orca workflows import - <<EOF  (reads stdin)',
      'orca workflows import ./remote.workflow.json --execution-target ssh-1a2b'
    ],
    notes: [
      'Nodes and edges get fresh ids on import, so the same file can be imported twice safely.',
      'The workflow is created disabled; enable it on the Workflows page or run it with `orca workflows run`.'
    ]
  },
  {
    path: ['workflows', 'rm'],
    summary: 'Delete an Orca agent workflow',
    usage: 'orca workflows rm <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca workflows rm 2f9e...']
  },
  {
    path: ['workflows', 'run'],
    summary: 'Run an Orca agent workflow once (activates its schedule if it has a cron trigger)',
    usage: 'orca workflows run <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca workflows run 2f9e...', 'orca workflows run --id 2f9e... --json']
  },
  {
    path: ['workflows', 'runs'],
    summary: 'List workflow run history (optionally for one workflow)',
    usage: 'orca workflows runs [<workflow id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca workflows runs', 'orca workflows runs 2f9e...']
  }
]
