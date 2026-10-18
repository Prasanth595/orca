import { describe, expect, it, vi } from 'vitest'
import { dispatchStructuredAgentSessionComposerCommand } from './structured-agent-session-composer'
import type { NativeChatMessage } from './native-chat-types'
import {
  buildNativeChatBtwPrompt,
  isNativeChatBtwCommand,
  nativeChatBtwTranscriptExcerpt,
  nativeChatSideQuestionAgentId,
  parseNativeChatBtwCommand,
  withNativeChatBtwCommand
} from './native-chat-btw'

function message(
  role: 'user' | 'assistant' | 'system' | 'tool',
  text: string,
  id = role
): NativeChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: 1,
    source: 'transcript'
  }
}

describe('nativeChatSideQuestionAgentId', () => {
  it('maps Claude-family chats onto the Claude one-shot spec', () => {
    expect(nativeChatSideQuestionAgentId('claude')).toBe('claude')
    expect(nativeChatSideQuestionAgentId('openclaude')).toBe('claude')
    expect(nativeChatSideQuestionAgentId('claude-agent-teams')).toBe('claude')
  })

  it('rejects an agent with no non-interactive print mode', () => {
    expect(nativeChatSideQuestionAgentId('unknown-agent')).toBeNull()
  })
})

describe('parseNativeChatBtwCommand', () => {
  it('reads a question after /btw', () => {
    expect(parseNativeChatBtwCommand('/btw which file holds the retry?')).toEqual({
      question: 'which file holds the retry?'
    })
  })

  it('accepts a bare /btw so the overlay can take the question', () => {
    expect(parseNativeChatBtwCommand(' /btw  ')).toEqual({ question: '' })
    expect(isNativeChatBtwCommand('/BTW why')).toBe(true)
    expect(isNativeChatBtwCommand('/clear')).toBe(false)
  })
})

describe('withNativeChatBtwCommand', () => {
  it('inserts the host row once', () => {
    const once = withNativeChatBtwCommand([{ name: 'clear' }])
    expect(once.map((command) => command.name)).toEqual(['btw', 'clear'])
    expect(withNativeChatBtwCommand(once).map((command) => command.name)).toEqual(['btw', 'clear'])
  })
})

describe('nativeChatBtwTranscriptExcerpt', () => {
  it('keeps user and assistant prose and drops tools and system lines', () => {
    expect(
      nativeChatBtwTranscriptExcerpt([
        message('system', 'Ran /clear'),
        message('user', 'Fix the flaky test'),
        message('tool', '{"cmd":"rm"}'),
        message('assistant', 'I will patch the timer.')
      ])
    ).toBe('User: Fix the flaky test\n\nAssistant: I will patch the timer.')
  })
})

describe('dispatchStructuredAgentSessionComposerCommand /btw', () => {
  const controller = {
    agent: 'claude' as const,
    snapshot: [],
    invokeAction: async () => true,
    setOption: async () => true
  }

  it('opens the overlay instead of sending a chat turn', async () => {
    const runBtw = vi.fn()
    await expect(
      dispatchStructuredAgentSessionComposerCommand('/btw which file holds the retry?', {
        ...controller,
        runBtw
      })
    ).resolves.toEqual({ handled: true, accepted: true, error: null })
    expect(runBtw).toHaveBeenCalledWith('which file holds the retry?')
  })

  it('does not fall through to the model when the overlay is missing', async () => {
    await expect(dispatchStructuredAgentSessionComposerCommand('/btw why', controller)).resolves.toEqual(
      {
        handled: true,
        accepted: false,
        error: '/btw is not available in this chat session.'
      }
    )
  })
})

describe('buildNativeChatBtwPrompt', () => {
  it('asks for a toolless answer from the excerpt', () => {
    const prompt = buildNativeChatBtwPrompt([message('user', 'Use a debounce')], 'why debounce?')
    expect(prompt).toContain('You have no tools')
    expect(prompt).toContain('User: Use a debounce')
    expect(prompt).toContain('why debounce?')
  })
})
