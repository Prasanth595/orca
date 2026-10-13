// Hermes reports its work as tool calls and sends no roster or task notifications of its own: a
// `delegate_task` call is a subagent, and a `terminal` call that asked for `background: true`
// starts a service that outlives the call. Both are read from the call's own input and status.
import { z } from 'zod'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { NativeChatSubagentState } from '../../../shared/native-chat-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import type { AcpBackgroundTaskUpdate, AcpDialect, AcpSubagentUpdate } from './acp-dialect'

const delegateInputSchema = z.looseObject({
  goal: z.string().optional(),
  tasks: z.array(z.looseObject({ goal: z.string().optional() })).optional()
})

const backgroundTerminalInputSchema = z.looseObject({
  command: z.string().optional(),
  background: z.literal(true)
})

const processInputSchema = z.looseObject({ action: z.string() })

/** Every in-flight provider status collapses to `working`; only an end is definite. */
function subagentState(status: string | null | undefined): NativeChatSubagentState | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'pending' || status === 'in_progress') return 'working'
  return undefined
}

/** The call's own title, which Hermes sets to the goal or the command it ran. */
function callLabel(update: ToolCallUpdate, fallback: string): string {
  const title = typeof update.title === 'string' ? update.title.trim() : ''
  return title.length > 0 ? title : fallback
}

/** Hermes titles a call `name: detail`, and Orca's journal name falls back to that title. */
function bareToolName(raw: string | null | undefined): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  const colon = text.indexOf(':')
  return (colon === -1 ? text : text.slice(0, colon)).trim()
}

function replyText(update: ToolCallUpdate): string | undefined {
  const blocks = Array.isArray(update.content) ? update.content : []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    // ACP wraps a result's text as `{type:'content', content:{type:'text', text}}`; a loose
    // sender may hand the text block over directly.
    const inner = (block as { content?: unknown }).content
    const candidate = inner && typeof inner === 'object' ? inner : block
    if ((candidate as { type?: string }).type !== 'text') continue
    const text = (candidate as { text?: unknown }).text
    if (typeof text === 'string' && text.trim().length > 0) return text
  }
  return undefined
}

export function hermesToolSubagents(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpSubagentUpdate[] {
  if (bareToolName(tool.name) !== 'delegate_task') return []
  const parsed = delegateInputSchema.safeParse(tool.input)
  if (!parsed.success) return []
  const state = subagentState(update.status)
  if (!state) return []
  const result = state === 'completed' ? replyText(update) : undefined
  const goals = (parsed.data.tasks ?? []).flatMap((task) =>
    task.goal ? [task.goal] : []
  )
  // A batch spawns one child per goal under the call that asked for them; a single call is one
  // child. The call id keeps them apart from every other spawn in the session.
  const ids = goals.length > 1 ? goals.map((_, index) => `${update.toolCallId}:${index}`) : [update.toolCallId]
  return ids.map((id, index) => ({
    id,
    state,
    label: callLabel(update, goals[index] ?? 'Subagent'),
    ...(result ? { result } : {})
  }))
}

export function hermesToolBackgroundTasks(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpBackgroundTaskUpdate[] {
  const launch = backgroundTerminalInputSchema.safeParse(tool.input)
  const name = bareToolName(tool.name)
  if (name === 'terminal' && launch.success) {
    const command = launch.data.command?.trim()
    return [
      {
        taskId: update.toolCallId,
        kind: 'command',
        label: callLabel(update, command && command.length > 0 ? command : 'Background command'),
        state: update.status === 'failed' ? 'blocked' : 'working',
        parentToolUseId: update.toolCallId
      }
    ]
  }
  // A kill names the processes it ends; the same call id they were launched under settles them.
  const kill = processInputSchema.safeParse(tool.input)
  if (name !== 'process' || !kill.success || kill.data.action !== 'kill') return []
  return [
    {
      taskId: update.toolCallId,
      kind: 'command',
      label: callLabel(update, 'Background command'),
      state: 'done'
    }
  ]
}

export const HERMES_ACP_DIALECT: AcpDialect = {
  // Hermes titles a call `name: detail`; the journal reads the name before the detail.
  toolName: (update) => bareToolName(update.name ?? update.title) || undefined,
  toolSubagents: hermesToolSubagents,
  toolBackgroundTasks: hermesToolBackgroundTasks
}
