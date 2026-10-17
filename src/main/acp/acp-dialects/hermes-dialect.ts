// Hermes reports its work as tool calls and publishes no roster or task notifications of its own.
// A `delegate_task` call answers with the delegation it dispatched and a backgrounded `terminal`
// call answers "Background process started" with the session id it runs under, so both are read
// from the call's own result text. Hermes titles every call `name: detail`.
import { z } from 'zod'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { NativeChatSubagentState } from '../../../shared/native-chat-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import type { AcpBackgroundTaskUpdate, AcpDialect, AcpDialectNotification, AcpSubagentUpdate } from './acp-dialect'

/** A delegation Hermes dispatched, whose children keep running after the call completes. */
const dispatchedSchema = z.looseObject({
  status: z.literal('dispatched'),
  delegation_id: z.string().optional(),
  goals: z.array(z.string()).optional()
})

/** A delegation Hermes ran synchronously: one entry per task, already finished. */
const syncResultsSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      task_index: z.number().optional(),
      status: z.string().optional(),
      summary: z.string().nullish(),
      error: z.string().nullish()
    })
  )
})

/** `- **session_id:** proc_…` in a result that started or ended a background process. */
const PROCESS_SESSION_ID = /session_id:?\**\s*(proc_[A-Za-z0-9_-]+)/

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
  if (status === 'completed' || status === 'ok') return 'completed'
  if (status === 'failed' || status === 'error' || status === 'timeout' || status === 'interrupted') {
    return 'failed'
  }
  if (status === 'pending' || status === 'in_progress') return 'working'
  return undefined
}

/**
 * Each JSON object in `text`, in order, matched by its own braces: a result may carry the call's
 * input, its answer, and prose after them, so the objects are read one at a time rather than as one
 * span from the first `{` to the last `}`.
 */
function jsonObjects(text: string): unknown[] {
  const found: unknown[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        try {
          found.push(JSON.parse(text.slice(start, index + 1)))
        } catch {
          // A malformed object is skipped; the next one may still parse.
        }
        start = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return found
}

/** The rows a spawn's answer describes, or none when the call was a control action. */
function spawnRows(update: ToolCallUpdate, objects: readonly unknown[]): AcpSubagentUpdate[] {
  for (const object of objects) {
    const dispatched = dispatchedSchema.safeParse(object)
    if (dispatched.success) {
      const goals = dispatched.data.goals ?? []
      const base = dispatched.data.delegation_id ?? update.toolCallId
      // The children are still running: the call is over, they are not.
      const ids = goals.length > 1 ? goals.map((_, index) => `${base}:${index}`) : [base]
      return ids.map((id, index) => ({
        id,
        state: 'working' as NativeChatSubagentState,
        label: goals[index] ?? callLabel(update, 'Subagent')
      }))
    }
    const sync = syncResultsSchema.safeParse(object)
    if (sync.success) {
      return sync.data.results.map((entry, index) => {
        const result = (entry.summary ?? entry.error ?? '').trim()
        return {
          id: `${update.toolCallId}:${entry.task_index ?? index}`,
          state: subagentState(entry.status) ?? 'completed',
          label: callLabel(update, `Subagent ${(entry.task_index ?? index) + 1}`),
          ...(result.length > 0 ? { result } : {})
        }
      })
    }
  }
  return []
}

export function hermesToolSubagents(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpSubagentUpdate[] {
  if (bareToolName(tool.name) !== 'delegate_task') return []
  const state = subagentState(update.status)
  if (!state) return []
  // Control actions (`stop`, `steer`, `list`) reuse the tool but spawn nothing, and they answer
  // with no dispatch and no results, so only a spawn's own answer makes rows.
  return spawnRows(update, jsonObjects(resultText(update)))
}

export function hermesToolBackgroundTasks(
  update: ToolCallUpdate,
  tool: AgentJournalToolCallItem
): AcpBackgroundTaskUpdate[] {
  const name = bareToolName(tool.name)
  const text = resultText(update)
  const title = typeof update.title === 'string' ? update.title : ''
  const detail = title.includes(':') ? title.slice(title.indexOf(':') + 1).trim() : ''
  if (name === 'terminal') {
    if (!text.includes('Background process started')) return []
    const sessionId = PROCESS_SESSION_ID.exec(text)?.[1] ?? update.toolCallId
    return [
      {
        taskId: sessionId,
        kind: 'command',
        label: detail.length > 0 ? detail : callLabel(update, 'Background command'),
        state: update.status === 'failed' ? 'blocked' : 'working',
        parentToolUseId: update.toolCallId
      }
    ]
  }
  // A kill settles the task it names, which was launched under its own process session id.
  if (name !== 'process_manage') return []
  const killed = jsonObjects(text).some(
    (object) => (object as { action?: unknown }).action === 'kill'
  )
  const sessionId = PROCESS_SESSION_ID.exec(text)?.[1]
  if (!killed || !sessionId) return []
  return [
    {
      taskId: sessionId,
      kind: 'command',
      label: detail.length > 0 ? detail : callLabel(update, 'Background command'),
      state: 'done'
    }
  ]
}

/**
 * A finished background delegation, as Hermes' ACP adapter reports it: a `session/update` carrying
 * the roster under `_meta.hermes.subagents`. The children are detached, so this notice is the only
 * thing in the stream that can settle the rows a client drew for them.
 */
const HERMES_SUBAGENT_STATES = [
  'working',
  'idle',
  'completed',
  'stopped',
  'failed',
  'unverifiable'
] as const

const delegationNoticeSchema = z.looseObject({
  update: z.looseObject({
    _meta: z.looseObject({
      hermes: z.looseObject({
        subagents: z.array(
          z.looseObject({
            id: z.string().min(1),
            state: z.string(),
            summary: z.string().optional(),
            label: z.string().optional(),
            activity: z.string().optional()
          })
        )
      })
    })
  })
})

function hermesDelegationNotice(_method: string, params: unknown): AcpDialectNotification | undefined {
  const parsed = delegationNoticeSchema.safeParse(params)
  if (!parsed.success) return undefined
  const subagents: AcpSubagentUpdate[] = []
  for (const row of parsed.data.update._meta.hermes.subagents) {
    const state = HERMES_SUBAGENT_STATES.find((known) => known === row.state)
    if (!state) continue
    subagents.push({
      id: row.id,
      state,
      ...(row.summary ? { result: row.summary } : {}),
      ...(row.label ? { label: row.label } : {}),
      // A progress notice names the tool each child is in; the settle that follows carries none.
      ...(row.activity ? { activity: row.activity } : {})
    })
  }
  return subagents.length > 0 ? { disposition: 'map', subagents } : undefined
}

export const HERMES_ACP_DIALECT: AcpDialect = {
  // Hermes titles a call `name: detail`; the journal reads the name before the detail.
  toolName: (update) => bareToolName(update.name ?? update.title) || undefined,
  toolSubagents: hermesToolSubagents,
  toolBackgroundTasks: hermesToolBackgroundTasks,
  notification: hermesDelegationNotice
}
