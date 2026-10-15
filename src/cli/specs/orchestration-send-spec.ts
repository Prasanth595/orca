import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const ORCHESTRATION_SEND_COMMAND_SPEC: CommandSpec = {
  path: ['orchestration', 'send'],
  summary: 'Send an inter-agent message',
  usage:
    'orca orchestration send --subject <text> [--to <run:id|dispatch:id|legacy_handle>] [--run <run_id>] [--from <handle>] [--body <text>] [--type <type>] [--priority <level>] [--deliver <queue|now>] [--thread-id <id>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>] [--outcome <succeeded|failed>] [--files-modified <csv>] [--report-path <path>] [--phase <text>] [--retry-request <id>] [--json]',
  allowedFlags: [
    ...GLOBAL_FLAGS,
    'to',
    'run',
    'from',
    'subject',
    'body',
    'type',
    'priority',
    'deliver',
    'thread-id',
    'payload',
    'task-id',
    'dispatch-id',
    'dispatch-capability',
    'retry-request',
    'outcome',
    'files-modified',
    'report-path',
    'phase'
  ],
  identityFlagRoles: { from: 'caller' },
  notes: [
    'Valid --type values: status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat.',
    'To answer a worker question, use orchestration reply --id <msg_id> --body <text> with the same Orca CLI executable.',
    'Group addresses (@all, @idle, @codex, ...) reach the live Dispatches of your own Run; a sender in no Run must use run:<id> or dispatch:<id>. @worktree:<id> names one workspace.',
    'Run groups exclude their owning coordinator; send to run:<id> to raise something with yours. Nested coordinators receive group mail in their child Run mailbox; @worktree:<id> includes workspace coordinators.',
    'On Windows PowerShell, quote group addresses such as --to "@all" or --to "@worktree:<id>".',
    "worker_done and heartbeat are exact-Dispatch signals and cannot target groups; omit --to to use the Dispatch's Run mailbox.",
    'worker_done requires --outcome succeeded or --outcome failed.',
    'From an active Dispatch, an omitted recipient defaults to its owning Run mailbox.',
    'Use --to dispatch:<id> for attempt-specific coordinator guidance; Orca durably relays it to a connected worker server.',
    '--deliver now steers a chat-mode recipient (Chat UI on) that is mid-turn: the "you have mail" nudge joins its running turn instead of waiting as a queued card until the turn ends. The default, queue, waits. An idle chat starts a turn either way; a terminal recipient is always nudged at its next idle prompt.',
    'A worker_done with the active task/dispatch IDs completes that task only from the dispatched pane. When stable pane identity is unavailable, the sender handle must exactly match the dispatch assignee; injected preambles include the correct --from value.',
    'Prefer --task-id/--dispatch-id/etc. over raw --payload JSON in worker commands; PowerShell strips JSON quotes easily.'
  ]
}
