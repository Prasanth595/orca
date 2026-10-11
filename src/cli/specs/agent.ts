import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'mcp-readiness'],
    summary: 'Report effective MCP readiness for a running agent session',
    usage:
      'orca agent mcp-readiness (--session <session-id> | --worktree <selector> --agent <id>) [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'session', 'worktree', 'agent'],
    notes: [
      'Reads the selected provider session, not MCP config files.',
      'Output excludes provider config, URLs, errors, environment values, and credentials.'
    ],
    examples: [
      'orca agent mcp-readiness --session claude_12345678 --json',
      'orca agent mcp-readiness --worktree active --agent claude --json'
    ]
  }
]
