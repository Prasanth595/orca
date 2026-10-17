import { describe, expect, it } from 'vitest'
import { TerminalRunFactsRegister } from '../runtime/terminal-run-facts'
import { AgentReplySubmissions } from './agent-reply-submissions'
import { createHookListenerState } from '../../shared/agent-hook-listener/listener-state'
import {
  normalizeAndAccept,
  PANE_KEY,
  CLAUDE_PROMPT_ID,
  CLAUDE_PREVIOUS_PROMPT_ID
} from '../../shared/agent-hook-listener-test-harness'
import type { AgentHookSource } from '../../shared/agent-hook-relay'

function rig(source: AgentHookSource = 'codex') {
  const facts = new TerminalRunFactsRegister()
  facts.setSubmissionTracking(true)
  const state = createHookListenerState()
  const tracker = new AgentReplySubmissions(() => facts.takeSubmitAuthor('pty'))
  const hook = (name: string, id = CLAUDE_PROMPT_ID, extra: Record<string, unknown> = {}) => {
    const event = normalizeAndAccept(state, source, {
      hook_event_name: name,
      session_id: 'invented-session',
      prompt_id: id,
      turn_id: id,
      prompt: 'invented input',
      ...(name === 'SessionStart' ? { source: 'startup' } : {}),
      ...extra
    })
    if (!event) {
      throw new Error('fixture hook was not normalized')
    }
    const enriched = { ...event, receivedAt: 1, stateStartedAt: 1 }
    tracker.observe(enriched)
    return enriched
  }
  const input = (author: 'human' | 'programmatic', data = '\r') =>
    facts.recordInput('pty', 'driving', data, undefined, author)
  hook('SessionStart')
  return { facts, tracker, hook, input, human: () => tracker.completion(PANE_KEY)?.human === true }
}

describe('live submit keys joined to exact main-agent hook turns', () => {
  it.each(['codex', 'claude'] as const)(
    'S1/S6/S13/S18: %s manual Enter owns the send, including program-filled drafts',
    (source) => {
      const r = rig(source)
      r.input('programmatic', 'invented draft')
      r.input('human')
      r.hook('UserPromptSubmit')
      r.hook('Stop')
      expect(r.human()).toBe(true)
    }
  )
  it('S3b/S3c: a person steering a running program turn makes that Codex turn eligible', () => {
    const r = rig()
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(true)
  })
  it('S4/S9/S14/S16: a wake without a submission hook cannot borrow an old Enter', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    r.input('human') // A permission/menu Enter is not itself a submission hook.
    r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
    expect(r.human()).toBe(false)
  })
  it('S5/S7/S17: a program submit supersedes approval, menu, and status Enters', () => {
    const r = rig()
    r.input('human')
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(false)
  })
  it('accepts independent Claude submissions whose hooks arrive after each previous Stop', () => {
    const r = rig('claude')
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(true)
    r.input('human')
    r.hook('UserPromptSubmit', CLAUDE_PREVIOUS_PROMPT_ID)
    r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
    expect(r.human()).toBe(true)
  })
  it('A3/L4: a different queued prompt ID submitted before Stop is discarded by that Stop', () => {
    const r = rig('claude')
    r.input('human')
    r.hook('UserPromptSubmit')
    r.input('human')
    r.hook('UserPromptSubmit', CLAUDE_PREVIOUS_PROMPT_ID)
    r.hook('Stop')
    expect(r.human()).toBe(true)
    r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
    expect(r.human()).toBe(false)
  })
  it.each([
    ['human', 'programmatic', false],
    ['programmatic', 'human', true]
  ] as const)(
    'starts a reused Claude prompt ID after Stop afresh: %s then %s',
    (first, next, expected) => {
      const r = rig('claude')
      r.input(first)
      r.hook('UserPromptSubmit')
      r.hook('Stop')
      expect(r.human()).toBe(first === 'human')
      r.input(next)
      r.hook('UserPromptSubmit')
      r.hook('Stop')
      expect(r.human()).toBe(expected)
    }
  )
  it('preserves a human completion across two Stop hooks without a new submission', () => {
    const r = rig('claude')
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    r.hook('Stop')
    expect(r.human()).toBe(true)
  })
  it('A6: Codex Tab-queued input has no submit key, unless a later approval Enter is borrowed', () => {
    for (const approval of [false, true]) {
      const r = rig()
      r.input('human')
      r.hook('UserPromptSubmit')
      r.input('human', 'invented queued prompt\t')
      if (approval) {
        r.input('human')
      }
      r.hook('Stop')
      expect(r.human()).toBe(true)
      r.hook('UserPromptSubmit', CLAUDE_PREVIOUS_PROMPT_ID)
      r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
      expect(r.human()).toBe(approval)
    }
  })
  it('retains only the completed prompt, discarding submissions without a Stop', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.input('programmatic')
    r.hook('UserPromptSubmit', CLAUDE_PREVIOUS_PROMPT_ID)
    r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
    r.hook('Stop')
    expect(r.human()).toBe(false)
  })

  it('A4: a queued Claude submit can attach to the running prompt, including rejected screening', () => {
    const r = rig('claude')
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.input('human')
    r.hook('UserPromptSubmit')
    // Claude's separate screening hook may reject B; its already-posted hook still names A.
    r.hook('Stop')
    expect(r.human()).toBe(true)
    r.hook('Stop', CLAUDE_PREVIOUS_PROMPT_ID)
    expect(r.human()).toBe(false) // A3: cached screening need not post a new B hook.
  })
  it('A1: a launch Enter does not prove an argv prompt was manually submitted', () => {
    const r = rig()
    r.input('human')
    r.hook('SessionStart')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(false)
  })
  it('A2: program submission before the human hook arrives closes that hook', () => {
    const r = rig()
    r.input('human')
    r.input('programmatic')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(false)
  })
  it('S11: missing IDs, restart, and a disabled tracking epoch stay unknown', () => {
    const r = rig('claude')
    r.input('human')
    r.hook('UserPromptSubmit', '', { prompt_id: undefined })
    r.hook('Stop', '', { prompt_id: undefined })
    expect(r.human()).toBe(false)
    r.facts.setSubmissionTracking(false)
    r.input('human')
    r.facts.setSubmissionTracking(true)
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(false)
    r.tracker.clear()
    r.hook('Stop')
    expect(r.human()).toBe(false)
  })
  it('does not spend a main-agent Enter on a child submission hook', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit', CLAUDE_PROMPT_ID, {
      session_id: 'child',
      agent_id: 'child',
      agent_type: 'reviewer'
    })
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    expect(r.human()).toBe(true)
  })
  it('keeps a submitted turn eligible through a Stop-hook continuation', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    r.hook('PreToolUse')
    expect(r.tracker.completion(PANE_KEY)).toBeUndefined()
    r.hook('Stop')
    expect(r.human()).toBe(true)
  })

  it('keeps a completed main reply while the combined pane still has background work', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    const stopped = r.hook('Stop')
    r.tracker.observe({
      ...stopped,
      hookEventName: 'PostToolUse',
      payload: {
        ...stopped.payload,
        state: 'working',
        mainAgent: { state: 'done', stateStartedAt: 1, outcome: 'success' }
      }
    })
    expect(r.human()).toBe(true)
  })

  it('a new turn or pane close invalidates a pending completion', () => {
    const r = rig()
    r.input('human')
    r.hook('UserPromptSubmit')
    r.hook('Stop')
    r.hook('UserPromptSubmit', CLAUDE_PREVIOUS_PROMPT_ID)
    expect(r.tracker.completion(PANE_KEY)).toBeUndefined()
    r.tracker.clear(PANE_KEY)
    expect(r.tracker.completion(PANE_KEY)).toBeUndefined()
  })
})
