import { describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem,
  AgentJournalTurnScope
} from './agent-session-journal-types'
import type { NativeChatMessage } from './native-chat-types'
import {
  projectNativeChatTranscript,
  projectNativeChatTranscriptMessages
} from './native-chat-transcript-projection'

let sequence = 0

function row(
  id: string,
  blocks: NativeChatMessage['blocks'],
  overrides: Partial<NativeChatMessage> = {}
): NativeChatMessage {
  sequence += 1
  return {
    id,
    role: 'assistant',
    blocks,
    timestamp: 1,
    source: 'transcript',
    journalPosition: { sequence, index: 0 },
    ...overrides
  }
}

const say = (value: string) => [{ type: 'text' as const, text: value }]
const call = (name: string) => [{ type: 'tool-call' as const, name, input: {} }]
const child = { agentId: 'task-1', producerKind: 'agent' as const }

/** A journal item as a host that states each row's turn writes it; `turnItemId` absent: none. */
function item(
  itemId: string,
  body: AgentJournalItemBody,
  turnItemId?: string,
  agentId?: string
): AgentJournalRenderItem {
  const turnScope: AgentJournalTurnScope =
    turnItemId === undefined ? { kind: 'thread' } : { kind: 'turn', turnItemId }
  return {
    itemId,
    body,
    sequence: 0,
    observedAt: 0,
    revision: 1,
    turnScope,
    ...(agentId === undefined ? {} : { agentId })
  }
}
const message = (role: 'user' | 'assistant'): AgentJournalItemBody => ({
  kind: 'message',
  role,
  blocks: []
})
const turn = (turnId: string, userItemId: string): AgentJournalItemBody => ({
  kind: 'turn',
  turnId,
  state: 'completed',
  userItemId,
  startedAt: 0
})

describe("a subagent's rows are not the conversation's", () => {
  // The shape a background subagent leaves: its rows interleave with its parent's.
  const transcript = [
    row('ask', say('review the PR'), { role: 'user' }),
    row('delegate', say('Delegating the review.')),
    row('child-look', say('Looking at the diff.'), child),
    row('parent-read', call('Read')),
    row('child-grep', call('Grep'), child),
    row('child-verdict', say('The PR is CLEAN.'), child),
    row('answer', say('The review found nothing.'))
  ]

  it("keeps the session's own rows as the conversation, and none of the subagent's", () => {
    const { conversation, subagentRows } = projectNativeChatTranscript(transcript)
    expect(conversation.map((message) => message.id)).toEqual(['ask', 'delegate', 'answer'])
    expect(conversation[1]?.blocks).toEqual([...say('Delegating the review.'), ...call('Read')])
    expect(
      subagentRows.get('task-1')?.map(({ message, turnKey }) => [message.id, turnKey])
    ).toEqual([
      ['child-look', 'ask'],
      ['child-verdict', 'ask']
    ])
    expect(projectNativeChatTranscriptMessages(transcript)).toEqual(conversation)
  })

  it("folds the subagent's calls into its own run however its parent's interleave", () => {
    const [look] = projectNativeChatTranscript(transcript).subagentRows.get('task-1') ?? []
    expect(look?.message.blocks).toEqual([...say('Looking at the diff.'), ...call('Grep')])
  })

  it('splits a subagent run at the turn it crossed, so each call stays in its own turn', () => {
    const rows = projectNativeChatTranscript([
      row('first', say('go'), { role: 'user' }),
      row('child-start', say('Starting.'), child),
      row('second', say('and then'), { role: 'user' }),
      row('child-edit', call('Edit'), child)
    ]).subagentRows.get('task-1')
    expect(rows?.map(({ message, turnKey }) => [message.id, turnKey])).toEqual([
      ['child-start', 'first'],
      ['child-edit', 'second']
    ])
  })

  // The conversation's grouping rule, not position: a send made mid-turn does not own the
  // rows written before its own turn opened, and a turn keyed to its record owns its rows.
  it("takes each row's turn from the journal's turn records, as the conversation's rows do", () => {
    const rows = [
      row('first', say('go'), { role: 'user' }),
      row('child-start', say('Starting.'), child),
      row('second', say('and then'), { role: 'user' }),
      row('child-edit', call('Edit'), child),
      row('child-woke', call('Write'), child)
    ]
    const journal = {
      items: [
        item('first', message('user')),
        item('turn-1', turn('1', 'first')),
        item('child-start', message('assistant'), 'turn-1', 'task-1'),
        item('second', message('user')),
        item('child-edit', message('assistant'), 'turn-1', 'task-1'),
        item('turn-2', turn('2', 'second')),
        // Its opener is outside the loaded window, so the turn keys to its own record.
        item('turn-3', turn('3', 'older-send')),
        item('child-woke', message('assistant'), 'turn-3', 'task-1')
      ],
      submissions: []
    }
    const projected = projectNativeChatTranscript(rows, undefined, journal).subagentRows.get(
      'task-1'
    )
    expect(projected?.map(({ message, turnKey }) => [message.id, turnKey])).toEqual([
      ['child-start', 'first'],
      ['child-woke', 'turn-3']
    ])
    expect(projected?.[0]?.message.blocks).toEqual([...say('Starting.'), ...call('Edit')])
  })

  it("never lets a subagent's own prompt open a conversation turn", () => {
    const transcript = [
      row('ask', say('go'), { role: 'user' }),
      row('child-prompt', say('Review the diff.'), { ...child, role: 'user' }),
      row('child-look', say('Looking.'), child)
    ]
    const rows = projectNativeChatTranscript(transcript).subagentRows.get('task-1')
    expect(rows?.every(({ turnKey }) => turnKey === 'ask')).toBe(true)
    // A host that states turns scopes a prompt written after the turn ended to none.
    const journal = {
      items: [
        item('ask', message('user')),
        item('turn-1', turn('1', 'ask')),
        item('child-prompt', message('user'), undefined, 'task-1'),
        item('child-look', message('assistant'), 'turn-1', 'task-1')
      ],
      submissions: []
    }
    const scoped = projectNativeChatTranscript(transcript, undefined, journal).subagentRows
    expect(scoped.get('task-1')?.map(({ turnKey }) => turnKey)).toEqual([undefined, 'ask'])
  })

  it('projects a transcript that names no producer exactly as before', () => {
    const plain = transcript.map(({ agentId: _agentId, producerKind: _kind, ...rest }) => rest)
    const { conversation, subagentRows } = projectNativeChatTranscript(plain)
    expect(subagentRows.size).toBe(0)
    expect(conversation.map((message) => message.id)).toEqual([
      'ask',
      'delegate',
      'child-look',
      'child-verdict',
      'answer'
    ])
  })

  it('drops a delivery and marks the row after it as a new reply', () => {
    const prompt = row('prompt', say('Write a handoff'), { role: 'user' })
    const answer = row('answer', say('Here is the handoff'))
    const crossSession = row(
      'cross-session',
      say(
        'Another Claude session sent a message: <cross-session-message from="uds:peer">May I swap the JAR?</cross-session-message>'
      ),
      { role: 'user' }
    )
    const reply = row('reply', say('No conflict, go ahead'))
    const { conversation, replyStartIds } = projectNativeChatTranscript([
      prompt,
      answer,
      crossSession,
      reply
    ])
    expect(conversation.map((m) => m.id)).toEqual(['prompt', 'answer', 'reply'])
    expect([...replyStartIds]).toEqual(['reply'])
  })

  it('keeps a reply boundary when the reply’s first tool run folds into the prior row', () => {
    const prompt = row('prompt', say('Write a handoff'), { role: 'user' })
    const answer = row('answer', say('Here is the handoff'))
    const crossSession = row(
      'cross-session',
      say(
        'Another Claude session sent a message: <cross-session-message from="uds:peer">May I swap the JAR?</cross-session-message>'
      ),
      { role: 'user' }
    )
    const send = row('send', call('SendMessage'))
    const reply = row('reply', say('No conflict, go ahead'))
    const { conversation, replyStartIds } = projectNativeChatTranscript([
      prompt,
      answer,
      crossSession,
      send,
      reply
    ])
    expect(conversation.map((m) => m.id)).toEqual(['prompt', 'answer', 'reply'])
    expect([...replyStartIds]).toEqual(['reply'])
  })

  it('does not split a turn on reminders, which the agent does not answer', () => {
    const prompt = row('prompt', say('Write a handoff'), { role: 'user' })
    const answer = row('answer', say('Here is the handoff'))
    const reminder = row('reminder', say('<system-reminder>Todo list is empty</system-reminder>'), {
      role: 'user'
    })
    const reply = row('reply', say('No conflict, go ahead'))
    const { conversation, replyStartIds } = projectNativeChatTranscript([
      prompt,
      answer,
      reminder,
      reply
    ])
    expect(conversation.map((m) => m.id)).toEqual(['prompt', 'answer', 'reply'])
    expect(replyStartIds.size).toBe(0)
  })
})
