import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const AUTOMATION_TARGET_FLAGS = [
  'repo',
  'workspace',
  'project',
  'host',
  'project-host-setup',
  'source-context',
  'workspace-mode',
  'base-branch'
]
const AUTOMATION_SCHEDULE_FLAGS = ['trigger', 'schedule', 'time', 'day', 'timezone']
const AUTOMATION_PRECHECK_FLAGS = ['precheck', 'precheck-timeout']
const AUTOMATION_STATE_FLAGS = [
  'enabled',
  'disabled',
  'missed-run-grace-minutes',
  'require-receipt',
  'no-require-receipt',
  'jev-evaluation',
  'jev-rubric',
  'no-jev-evaluation',
  'reuse-session',
  'fresh-session'
]

export const AUTOMATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['automations', 'list'],
    summary: 'List scheduled Orca automations',
    usage: 'orca automations list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca automations list', 'orca automations list --json']
  },
  {
    path: ['automations', 'doctor'],
    summary: 'Check automation schedule and run health',
    usage: 'orca automations doctor [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca automations doctor', 'orca automations doctor --json']
  },
  {
    path: ['automations', 'show'],
    summary: 'Show one Orca automation',
    usage: 'orca automations show <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca automations show 2f9e...', 'orca automations show --id 2f9e... --json']
  },
  {
    path: ['automations', 'create'],
    summary: 'Create a scheduled Orca automation',
    usage:
      'orca automations create --name <name> --trigger <preset|cron|rrule> --prompt <text> --provider <agent> [--precheck <command>] [--repo <selector>|--workspace <selector>|--project <id> [--host <id>]|--project-host-setup <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'name',
      'prompt',
      'provider',
      'extra-agent-args',
      ...AUTOMATION_PRECHECK_FLAGS,
      ...AUTOMATION_TARGET_FLAGS,
      ...AUTOMATION_SCHEDULE_FLAGS,
      ...AUTOMATION_STATE_FLAGS
    ],
    notes: [
      'Trigger accepts hourly, daily, weekdays, weekly, a 5-field cron expression, or an RRULE string.',
      'When --repo is omitted, the CLI uses the enclosing Orca worktree when one can be resolved from cwd.',
      'Use --project with --host, or --project-host-setup, to run on a specific project host setup.',
      '--host runtime:<environment-id> targets that paired Orca server; use the id from `orca environment list`, not the environment name.',
      'Use --source-context with a JSON TaskSourceContext when task/provider data should come from a specific host/account; pass null on edit to clear it.',
      'Use --workspace to run in an existing worktree; otherwise the automation creates a new worktree per run.',
      'Use --precheck to run a bounded command before scheduled runs; exit code 0 continues, anything else records a skipped run.',
      'Use --reuse-session only with existing-workspace automations to submit later runs to the previous live automation session when it is still available. Use --fresh-session to disable reuse.',
      'Use --extra-agent-args="--model opus --effort high" to add arguments after the host\'s default agent Arguments on each fresh run. Only model, effort, and a few safe options are accepted (Claude, Codex, CodeBuddy, Cursor, Grok, OMP); extras cannot be combined with --reuse-session. On edit, --extra-agent-args= clears them.'
    ],
    examples: [
      'orca automations create --name "Daily review" --trigger daily --prompt "Review open changes" --provider codex',
      'orca automations create --name "Weekday triage" --trigger "0 9 * * 1-5" --prompt "Triage issues" --provider claude --repo my-repo',
      'orca automations create --name "PR review" --trigger hourly --precheck "gh pr list --json number -q .[0].number" --prompt "Review requested PRs" --provider codex',
      'orca automations create --name "Docs pass" --trigger daily --prompt "Tidy the docs" --provider claude --extra-agent-args="--model opus --effort high --add-dir docs"'
    ]
  },
  {
    path: ['automations', 'edit'],
    summary: 'Edit an Orca automation',
    usage: 'orca automations edit <id> [--name <name>] [--trigger <preset|cron|rrule>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'id',
      'name',
      'prompt',
      'provider',
      'extra-agent-args',
      ...AUTOMATION_PRECHECK_FLAGS,
      ...AUTOMATION_TARGET_FLAGS,
      ...AUTOMATION_SCHEDULE_FLAGS,
      ...AUTOMATION_STATE_FLAGS
    ],
    positionalArgs: ['id'],
    examples: [
      'orca automations edit 2f9e... --disabled',
      'orca automations edit --id 2f9e... --trigger "30 * * * *" --json',
      'orca automations edit 2f9e... --extra-agent-args='
    ]
  },
  {
    path: ['automations', 'remove'],
    destructive: true,
    summary: 'Remove an Orca automation and its run history',
    usage: 'orca automations remove <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca automations remove 2f9e...', 'orca automations remove --id 2f9e... --json']
  },
  {
    path: ['automations', 'run'],
    summary: 'Run an Orca automation now',
    usage: 'orca automations run <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca automations run 2f9e...', 'orca automations run --id 2f9e... --json']
  },
  {
    path: ['automations', 'run-show'],
    summary: 'Show one automation run',
    usage: 'orca automations run-show <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca automations run-show 819a...', 'orca automations run-show --id 819a... --json']
  },
  {
    path: ['automations', 'receipt'],
    summary: 'Record a semantic workflow result for an automation run',
    usage:
      'orca automations receipt [<run-id>] --outcome <passed|failed|blocked> [--summary <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'outcome', 'summary'],
    positionalArgs: ['run'],
    examples: [
      'orca automations receipt --outcome passed --summary "Artifact validated" --json',
      'orca automations receipt 819a... --outcome blocked --summary "Waiting for credentials"'
    ]
  },
  {
    path: ['automations', 'jev-evaluate'],
    summary: 'Evaluate automation evidence with the configured Jev rubric',
    usage: 'orca automations jev-evaluate [<run-id>] --state-file <json-path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'state-file'],
    positionalArgs: ['run'],
    notes: [
      'Requires AI_GATEWAY_API_KEY in the process environment; the key is never persisted.',
      'The state JSON may include evidenceRefs as an array of non-secret references.'
    ],
    examples: [
      'orca automations jev-evaluate --state-file /tmp/customer-memory-evidence.json --json',
      'orca automations jev-evaluate 819a... --state-file ./tmp/evidence.json'
    ]
  },
  {
    path: ['automations', 'runs'],
    summary: 'List automation run history',
    usage:
      'orca automations runs [--id <automation-id>] [--limit <n>] [--cursor <cursor>] [--status <status>] [--since <iso>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'limit', 'cursor', 'status', 'since'],
    notes: [
      '--since takes an ISO 8601 timestamp with an offset, for example 2026-10-01T00:00:00-04:00.',
      'Use nextCursor from the JSON response with --cursor to continue a bounded history scan.'
    ],
    examples: [
      'orca automations runs',
      'orca automations runs --id 2f9e... --limit 25 --json',
      'orca automations runs --status dispatch_failed --since 2026-10-01T00:00:00-04:00 --json'
    ]
  }
]
