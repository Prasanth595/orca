// Hermes reports its work as tool calls and publishes no roster or task notifications of its own.
// A `delegate_task` call answers with the delegation it dispatched and a backgrounded `terminal`
// call answers "Background process started" with the session id it runs under, so both are read
// from the call's own result text. Hermes titles every call `name: detail`.
import { z } from 'zod'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { NativeChatSubagentState } from '../../../shared/native-chat-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import type { AcpBackgroundTaskUpdate, AcpDialect, AcpSubagentUpdate } from './acp-dialect'

/** The delegation Hermes answers `delegate_task` with, before the children report. */
const delegationResultSchema = z.looseObject({
  delegation_id: z.string().optional(),
  goals: z.array(z.string()).optional(),
  count: z.number().optional(),
  mode: z.string().optional()
})

/** `- **session_id:** proc_…` in the result of a backgrounded command. */
const BACKGROUND_SESSION_ID = /session_id:?\**\s*(proc_[A-Za-z0-9_-]+)/

/** Hermes titles a call `name: detail`, and Orca's journal name falls back to that title. */
function bareToolName(raw: string | null | undefined): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  const colon = text.indexOf(':')
  return (colon === -1 ? text : text.slice(0, colon)).trim()
}

/** The call's own title, which Hermes sets to the goal or the command it ran. */
function callLabel(update: ToolCallUpdate, fallback: string): string {
  const title = typeof update.title === 'string' ? update.title.trim() : ''
  return title.length > 0 ? title : fallback
}

/** Every text the call reported, result blocks and raw output alike, joined for one search. */
function resultText(update: ToolCallUpdate): string {
  const parts: string[] = []
  const blocks = Array.isArray(update.content) ? update.content : []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    // ACP wraps a result's text as `{type:'content', content:{type:'text', text}}`; a loose
    // sender may hand the text block over directly.
    const inner = (block as { content?: unknown }).content
    const candidate = inner && typeof inner === 'object' ? inner : block
    if ((candidate as { type?: string }).type !== 'text') continue
    const text = (candidate as { text?: unknown }).text
    if (typeof text === 'string') parts.push(text)
  }
  const raw = update.rawOutput
  if (typeof raw === 'string') parts.push(raw)
  return parts.join('\n')
}

/** Every in-flight provider status collapses to `working`; only an end is definite. */
function subagentState(status: string | null | undefined): NativeChatSubagentState | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'pending' || status === 'in_progress') return 'working'
  return undefined
}

function dispatchedDelegation(text: string): z.infer<typeof delegationResultSchema> | null {
  const start = text.indexOf('{"status"')
  if (start === -1) return null
  const end = text.lastIndexOf('}')
  if (end <= start) return null
  try {
    const parsed = delegationResultSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function hermesToolSubagents(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpSubagentUpdate[] {
  if (bareToolName(tool.name) !== 'delegate_task') return []
  const state = subagentState(update.status)
  if (!state) return []
  const dispatched = dispatchedDelegation(resultText(update))
  // A delegation that answered `dispatched` runs its children in the background: the call is over
  // but they are not. Its goals are the roster; without them the call is one unnamed child.
  const goals = dispatched?.goals ?? []
  const base = dispatched?.delegation_id ?? update.toolCallId
  const ids = goals.length > 1 ? goals.map((_, index) => `${base}:${index}`) : [base]
  const childState: NativeChatSubagentState = dispatched ? 'working' : state
  return ids.map((id, index) => ({
    id,
    state: childState,
    label: goals[index] ?? callLabel(update, 'Subagent')
  }))
}

export function hermesToolBackgroundTasks(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpBackgroundTaskUpdate[] {
  if (bareToolName(tool.name) !== 'terminal') return []
  const text = resultText(update)
  if (!text.includes('Background process started')) return []
  const sessionId = BACKGROUND_SESSION_ID.exec(text)?.[1] ?? update.toolCallId
  const title = typeof update.title === 'string' ? update.title : ''
  const command = title.includes(':') ? title.slice(title.indexOf(':') + 1).trim() : ''
  return [
    {
      taskId: sessionId,
      kind: 'command',
      label: command.length > 0 ? command : callLabel(update, 'Background command'),
      state: update.status === 'failed' ? 'blocked' : 'working',
      parentToolUseId: update.toolCallId
    }
  ]
}

export const HERMES_ACP_DIALECT: AcpDialect = {
  // Hermes titles a call `name: detail`; the journal reads the name before the detail.
  toolName: (update) => bareToolName(update.name ?? update.title) || undefined,
  toolSubagents: hermesToolSubagents,
  toolBackgroundTasks: hermesToolBackgroundTasks
}
