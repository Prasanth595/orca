// A task notification or cross-session message reaches a structured Claude
// session as a user frame Orca never sent. The transcript fold splits a turn
// into replies at such a delivery; when the live path dropped the frame, the
// earlier answer folded away behind "Worked for N".

import { describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity,
  AgentJournalRenderItem
} from '../../shared/agent-session-journal-types'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import { projectNativeChatTranscript } from '../../shared/native-chat-transcript-projection'
import { latestStructuredAgentSessionUserItem } from '../../shared/structured-agent-session-latest-request'
import { projectStructuredItemsToNativeChat } from '../../shared/structured-agent-session-projection'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { createClaudeJournalTranslator } from './claude-structured-journal-translation'

const SESSION = 'claude-session'
const NOTIFICATION = '<task-notification>\n<task-id>bfnmj08v6</task-id>\n<status>completed</status>'

function harness() {
  const appended: { identity: AgentJournalItemIdentity; body: AgentJournalItemBody }[] = []
  const sink: StructuredAgentSessionEventSink = {
    appendItem: (identity, body) => appended.push({ identity, body }),
    appendTombstone: () => {},
    publish: vi.fn()
  }
  const translator = createClaudeJournalTranslator({ sink, fallbackIdPrefix: 'test' })
  const items = (): AgentJournalRenderItem[] => {
    const byKey = new Map<string, AgentJournalRenderItem>()
    appended.forEach(({ identity, body }, index) => {
      const key = agentJournalItemKey(identity)
      const existing = byKey.get(key)
      byKey.set(key, {
        itemId: key,
        revision: (existing?.revision ?? 0) + 1,
        body,
        sequence: existing?.sequence ?? index,
        observedAt: existing?.observedAt ?? index
      })
    })
    return [...byKey.values()].sort((a, b) => a.sequence - b.sequence)
  }
  return { translator, items }
}

function frame(
  type: 'assistant' | 'user',
  uuid: string,
  text: string,
  parentToolUseId: string | null = null
) {
  return {
    type: 'message' as const,
    sessionId: 'orca-session',
    message: {
      type,
      uuid,
      session_id: SESSION,
      parent_tool_use_id: parentToolUseId,
      message: { role: type, content: [{ type: 'text', text }] }
    }
  }
}

describe('Claude structured delivery replies', () => {
  it('journals a delivery so the reply after it keeps its own answer', () => {
    const { translator, items } = harness()
    translator.handle(frame('assistant', 'a1', 'First answer'))
    translator.handle(frame('user', 'u-delivery', NOTIFICATION))
    translator.handle(frame('assistant', 'a2', 'Second answer'))

    const delivery = items().find((item) => item.itemId.includes('u-delivery'))
    expect(delivery?.body).toEqual({
      kind: 'message',
      role: 'system',
      blocks: [{ type: 'text', text: NOTIFICATION }]
    })

    const projection = projectNativeChatTranscript(projectStructuredItemsToNativeChat(items()))
    const answers = projection.conversation.map((message) => message.id)
    expect(answers).not.toContain(delivery?.itemId)
    const second = projection.conversation.find((message) =>
      message.blocks.some((block) => block.type === 'text' && block.text === 'Second answer')
    )
    expect(second && projection.replyStartIds.has(second.id)).toBe(true)
  })

  it('never offers a delivery as the latest user prompt', () => {
    const { translator, items } = harness()
    translator.handle(frame('user', 'u-delivery', NOTIFICATION))
    expect(latestStructuredAgentSessionUserItem(items())).toBeNull()
  })

  it('keeps dropping user echoes that are not deliveries', () => {
    const { translator, items } = harness()
    translator.handle(frame('user', 'u-reminder', '<system-reminder>ctx</system-reminder>'))
    translator.handle(frame('user', 'u-child', NOTIFICATION, 'toolu_child'))
    const ids = items().map((item) => item.itemId)
    expect(ids.filter((id) => id.includes('u-reminder') || id.includes('u-child'))).toEqual([])
  })
})
